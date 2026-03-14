import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { TextFadeEffect } from './uiEffects.js';

const PixelSnappedBox = GObject.registerClass(
    class PixelSnappedBox extends St.BoxLayout {
        vfunc_allocate(box) {
            box.x1 = Math.round(box.x1);
            box.y1 = Math.round(box.y1);
            box.x2 = Math.round(box.x2);
            box.y2 = Math.round(box.y2);
            super.vfunc_allocate(box);
        }
    });

export const CrossfadeArt = GObject.registerClass(
    class CrossfadeArt extends St.Widget {
        _init() {
            super._init({ layout_manager: new Clutter.BinLayout(), style_class: 'art-widget', clip_to_allocation: false, x_expand: false, y_expand: false });
            this._radius = 10;
            this._shadowCSS = 'box-shadow: none;';
        }

        setRadius(r) {
            this._radius = (typeof r === 'number' && !isNaN(r)) ? r : 10;
            this._updateContainerStyle();
            this.get_children().forEach(c => this._refreshLayerStyle(c));
        }

        setShadowStyle(cssString) {
            this._shadowCSS = cssString || 'box-shadow: none;';
            this._updateContainerStyle();
            this.get_children().forEach(c => this._refreshLayerStyle(c));
        }

        _updateContainerStyle() {
            let safeR = (typeof this._radius === 'number' && !isNaN(this._radius)) ? this._radius : 10;
            let hasArt = (this._currentUrl && this._currentUrl.length > 0);
            let activeShadow = hasArt ? this._shadowCSS : 'box-shadow: none;';
            let bgColor = hasArt ? 'background-color: #000000;' : 'background-color: transparent;';
            this.set_style(`border-radius: ${safeR}px; ${bgColor} ${activeShadow}`);
        }

        _refreshLayerStyle(layer) {
            if (!layer || !layer.get_parent()) return;
            let url = layer._bgUrl;
            let bgPart = url ? `background-image: url("${url}");` : '';
            let safeR = (typeof this._radius === 'number' && !isNaN(this._radius)) ? this._radius : 10;
            let newCss = `border-radius: ${safeR}px; background-size: cover; box-shadow: none; ${bgPart}`;
            if (layer._lastCss === newCss) return;
            layer._lastCss = newCss;

            if (layer.get_parent()) {
                layer.set_style(newCss);
            }
        }

        setArt(newUrl, force = false) {
            let children = this.get_children();

            if (children.length > 0 && children[children.length - 1]._bgUrl === newUrl) {
                return;
            }

            this._currentUrl = newUrl;
            this._updateContainerStyle();

            this.get_children().forEach(c => c.remove_all_transitions());

            let newLayer = new St.Widget({ x_expand: true, y_expand: true, opacity: 0 });
            newLayer._bgUrl = newUrl;

            this.add_child(newLayer);
            this._refreshLayerStyle(newLayer);

            newLayer.ease({
                opacity: 255,
                duration: 1800,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: (isFinished) => {
                    if (!isFinished) return;

                    newLayer.opacity = 255;

                    let currentChildren = this.get_children();
                    let myIndex = currentChildren.indexOf(newLayer);
                    if (myIndex > 0) {
                        for (let i = 0; i < myIndex; i++) {
                            let oldLayer = currentChildren[i];
                            oldLayer.ease({
                                opacity: 0,
                                duration: 300,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onStopped: () => oldLayer.destroy()
                            });
                        }
                    }
                }
            });
        }
    });

export const ScrollLabel = GObject.registerClass(
    class ScrollLabel extends St.Widget {
        _init(styleClass, settings) {
            super._init({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: false, clip_to_allocation: true });
            this._settings = settings;
            this._text = "";
            this._gameMode = false;
            this._isScrolling = false;
            this._container = new PixelSnappedBox({ x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
            this._container.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
            this.add_child(this._container);

            this._label1 = new St.Label({ style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
            this._label2 = new St.Label({ style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
            this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label1.clutter_text.line_wrap = false;
            this._label2.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label2.clutter_text.line_wrap = false;

            this._container.add_child(this._label1);
            this._separator = new St.Widget({ width: 30 });
            this._container.add_child(this._separator);
            this._container.add_child(this._label2);

            this._settings.connectObject('changed::scroll-text', () => this.setText(this._text, true), this);

            this.connectObject('notify::allocation', () => {
                if (this._resizeTimer) { GLib.Source.remove(this._resizeTimer); this._resizeTimer = null; }
                this._resizeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._resizeTimer = null;
                    if (this.has_allocation()) this._checkResize();
                    return GLib.SOURCE_REMOVE;
                });
            }, this);

            this.connect('destroy', this._cleanup.bind(this));
        }

        vfunc_get_preferred_width(forHeight) {
            if (this._label1) {
                let [minW, natW] = this._label1.get_preferred_width(forHeight);
                return [0, natW];
            }
            return super.vfunc_get_preferred_width(forHeight);
        }

        setLabelStyle(css) {
            if (this._label1) this._label1.set_style(css);
            if (this._label2) this._label2.set_style(css);
        }

        _setFadeOutEffect(enableLeft = true, enableRight = true, animate = false) {
            if (!this._label1) return;

            let fontDesc = this._label1.get_theme_node().get_font();
            let fadeWidth = (fontDesc.get_size() / Pango.SCALE) + 4;

            if (!this._fadeEffect) {
                this._fadeEffect = new TextFadeEffect(fadeWidth);
                this.add_effect(this._fadeEffect);
            } else if (!this._fadeEffectAttached) {
                this.add_effect(this._fadeEffect);
            }
            this._fadeEffectAttached = true;

            this._fadeEffect.setFadePixels(fadeWidth);
            this._fadeEffect.setEdges(enableLeft, enableRight, animate);
        }

        _clearFadeOutEffect() {
            if (this._fadeEffect && this._fadeEffectAttached) {
                this._fadeEffect.setEdges(false, false, false);
                this.remove_effect(this._fadeEffect);
                this._fadeEffectAttached = false;
            }
        }

        _cleanup() {
            this._stopAnimation();
            if (this._fadeEffect) {
                if (this._fadeEffectAttached) this.remove_effect(this._fadeEffect);
                this._fadeEffect = null;
                this._fadeEffectAttached = false;
            }
            if (this._resizeTimer) { GLib.Source.remove(this._resizeTimer); this._resizeTimer = null; }
            if (this._measureTimeout) { GLib.Source.remove(this._measureTimeout); this._measureTimeout = null; }
            if (this._idleResizeId) { GLib.Source.remove(this._idleResizeId); this._idleResizeId = null; }
        }

        setGameMode(active) {
            this._gameMode = active;
            if (active) this._stopAnimation();
            else this._checkResize();
        }

        _checkResize() {
            if (!this._text || this._gameMode) return;

            if (this._ignoreResizeUntil && Date.now() < this._ignoreResizeUntil) return;

            if (this._idleResizeId) { GLib.Source.remove(this._idleResizeId); this._idleResizeId = null; }

            this._idleResizeId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._idleResizeId = null;
                if (!this || (this.is_finalized && this.is_finalized()) || !this.get_parent())
                    return GLib.SOURCE_REMOVE;

                if (this._lyricFinished) return GLib.SOURCE_REMOVE;

                let boxWidth = this.get_allocation_box().get_width();
                if (boxWidth <= 1) return GLib.SOURCE_REMOVE;

                this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                let textWidth = this._label1.get_preferred_width(-1)[1];

                let needsScroll = (textWidth > boxWidth + 5) && (this._settings.get_boolean('scroll-text') || this._lyricTime > 0);
                let isScrolling = (this._scrollTimer != null) || this._isScrolling;

                if (needsScroll && !isScrolling) {
                    this._container.x_align = Clutter.ActorAlign.START;
                    if (this._lyricTime > 0) this._startLyricScroll(textWidth);
                    else this._startInfiniteScroll(textWidth);
                } else if (!needsScroll && isScrolling) {
                    this._stopAnimation(true);
                    this._container.x_align = Clutter.ActorAlign.CENTER;
                    this._label2.hide();
                    this._separator.hide();
                } else if (!needsScroll) {
                    this._stopAnimation(true);
                    this._container.x_align = Clutter.ActorAlign.CENTER;
                }

                return GLib.SOURCE_REMOVE;
            });
        }

        setText(text, force = false, lyricTime = 0) {
            if (!force && this._text === text) return;
            this._text = text || "";
            this._lyricTime = lyricTime;
            this._lyricFinished = false;

            this._stopAnimation(true);
            this._container.x_align = Clutter.ActorAlign.CENTER;

            this._label1.text = this._text;
            this._label2.text = this._text;
            this._label2.hide();
            this._separator.hide();
            this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

            this._label1.remove_transition('opacity');
            let isLyric = (lyricTime > 0);
            let lyricFadeEnabled = this._settings ? this._settings.get_boolean('lyric-fade-enable') : false;

            if (!isLyric || (isLyric && lyricFadeEnabled)) {
                let duration = (isLyric && this._settings) ? this._settings.get_int('lyric-fade-duration') : 300;
                this._label1.opacity = 0;
                this._label1.ease({
                    opacity: 255,
                    duration: duration,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            } else {
                this._label1.opacity = 255;
            }

            if (!this._settings.get_boolean('scroll-text') && !this._lyricTime) {
                return;
            }

            let isDynamic = this._settings && this._settings.get_boolean('pill-dynamic-width');
            if (isDynamic) {
                this._ignoreResizeUntil = Date.now() + 450;
            }

            let delay = isDynamic ? 450 : 100;

            if (this._measureTimeout) { GLib.Source.remove(this._measureTimeout); this._measureTimeout = null; }
            this._measureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._measureTimeout = null;
                if (this.has_allocation()) this._checkOverflow();
                return GLib.SOURCE_REMOVE;
            });
        }

        _stopAnimation(resetPosition = true) {
            this._isScrolling = false;
            this._clearFadeOutEffect();
            this._container.remove_all_transitions();
            if (resetPosition) this._container.translation_x = 0;
            if (this._scrollTimer) { GLib.Source.remove(this._scrollTimer); this._scrollTimer = null; }
        }

        _checkOverflow() {
            if (this._gameMode || !this.get_parent()) return;
            let boxWidth = this.get_allocation_box().get_width();
            if (boxWidth <= 1) return;

            let textWidth = this._label1.get_preferred_width(-1)[1];
            let needsScroll = textWidth > boxWidth + 5;

            if (needsScroll) {
                this._container.x_align = Clutter.ActorAlign.START;
                if (this._lyricTime > 0) {
                    this._startLyricScroll(textWidth);
                } else if (this._settings.get_boolean('scroll-text')) {
                    this._startInfiniteScroll(textWidth);
                }
            } else {
                this._stopAnimation(true);
                this._container.x_align = Clutter.ActorAlign.CENTER;
            }
        }

        _startInfiniteScroll(textWidth) {
            this._stopAnimation(true);
            this._isScrolling = true;
            this._label2.show();
            this._separator.show();
            const distance = textWidth + 30;
            const duration = (distance / 30) * 1000;

            const loop = () => {
                if (this._gameMode || !this.get_parent()) return;

                this._setFadeOutEffect(false, true, true);

                if (this._scrollTimer) GLib.Source.remove(this._scrollTimer);
                this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    this._scrollTimer = null;
                    if (this._gameMode || !this.get_parent()) return GLib.SOURCE_REMOVE;

                    this._setFadeOutEffect(true, true, true);

                    this._container.ease({
                        translation_x: -distance, duration: duration, mode: Clutter.AnimationMode.LINEAR,
                        onStopped: (isFinished) => {
                            if (!isFinished || this._gameMode) {
                                this._isScrolling = false;
                                return;
                            }

                            this._container.translation_x = 0;
                            loop();
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                });
            };
            loop();
        }

        _startLyricScroll(textWidth) {
            this._stopAnimation(true);
            this._isScrolling = true;
            this._label2.hide();
            this._separator.hide();

            let boxWidth = this.get_allocation_box().get_width();
            const distance = textWidth - boxWidth;

            if (distance <= 5) return;

            const totalDurationMs = this._lyricTime * 1000;
            const pauseTime = (boxWidth / textWidth) * totalDurationMs * 0.5;
            const tailTime = totalDurationMs * 0.2;
            const scrollDuration = totalDurationMs - pauseTime - tailTime;

            if (scrollDuration <= 0) return;

            this._clearFadeOutEffect();

            if (this._scrollTimer) GLib.Source.remove(this._scrollTimer);

            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, Math.max(100, pauseTime), () => {
                this._scrollTimer = null;
                if (this._gameMode || !this.get_parent()) return GLib.SOURCE_REMOVE;

                this._container.ease({
                    translation_x: -distance,
                    duration: scrollDuration,
                    mode: Clutter.AnimationMode.LINEAR,
                    onStopped: () => {
                        this._isScrolling = false;
                        this._lyricFinished = true;
                    }
                });
                return GLib.SOURCE_REMOVE;
            });
        }
    });

export function _addBtnPressAnim(btn) {
    btn.set_pivot_point(0.5, 0.5);
    btn.connectObject('button-press-event', () => {
        btn.remove_all_transitions();
        btn.ease({
            scale_x: 0.84, scale_y: 0.84,
            duration: 75, mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
        return Clutter.EVENT_PROPAGATE;
    }, btn);
    btn.connectObject('button-release-event', () => {
        btn.ease({
            scale_x: 1.0, scale_y: 1.0,
            duration: 160, mode: Clutter.AnimationMode.EASE_OUT_BACK
        });
        return Clutter.EVENT_PROPAGATE;
    }, btn);
    btn.connectObject('leave-event', () => {
        btn.ease({
            scale_x: 1.0, scale_y: 1.0,
            duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
        return Clutter.EVENT_PROPAGATE;
    }, btn);
}

export { PixelSnappedBox };
