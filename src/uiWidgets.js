import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Pango from 'gi://Pango';
import St from 'gi://St';
import { TextFadeEffect } from './uiEffects.js';

const PixelSnappedBox = St.BoxLayout;

export const CrossfadeArt = GObject.registerClass(
    class CrossfadeArt extends St.Widget {
        _init(params = {}) {
            super._init(Object.assign({
                name: 'pill-crossfade-art',
                layout_manager: new Clutter.BinLayout(),
                style_class: 'art-widget',
                clip_to_allocation: false,
                x_expand: false,
                y_expand: false
            }, params));
            this._radius = 10;
            this._shadowCSS = 'box-shadow: none;';
        }

        setRadius(r) {
            this._radius = (typeof r === 'number' && !isNaN(r)) ? r : 10;
            this._updateContainerStyle();
            let children = this.get_children ? this.get_children() : [];
            children.forEach(c => this._refreshLayerStyle(c));
        }

        setShadowStyle(cssString) {
            this._shadowCSS = cssString || 'box-shadow: none;';
            this._updateContainerStyle();
            let children = this.get_children ? this.get_children() : [];
            children.forEach(c => this._refreshLayerStyle(c));
        }

        _updateContainerStyle() {
            let safeR = (typeof this._radius === 'number' && !isNaN(this._radius)) ? this._radius : 10;
            let hasArt = (this._currentUrl && this._currentUrl.length > 0);
            let activeShadow = hasArt ? this._shadowCSS : 'box-shadow: none;';
            let bgColor = 'background-color: transparent;';
            this.set_style(`border-radius: ${safeR}px; ${bgColor} ${activeShadow}`);
        }

        _refreshLayerStyle(layer) {
            if (!layer || !layer.get_parent || !layer.get_parent()) return;
            let url = layer._bgUrl;
            let bgPart = url ? `background-image: url("${url}");` : '';
            let safeR = (typeof this._radius === 'number' && !isNaN(this._radius)) ? this._radius : 10;
            let newCss = `border-radius: ${safeR}px; background-size: cover; box-shadow: none; ${bgPart}`;
            if (layer._lastCss === newCss) return;
            layer._lastCss = newCss;

            if (layer.get_parent && layer.get_parent()) {
                layer.set_style(newCss);
            }
        }

        setArt(newUrl, force = false) {
            if (!newUrl) {
                this._currentUrl = null;
                let cur = this.get_children ? this.get_children() : [];
                for (let c of cur) {
                    try { c.destroy(); } catch (_) {}
                }
                return;
            }

            let children = this.get_children ? this.get_children() : [];
            if (!force && children.length > 0 && children[children.length - 1]._bgUrl === newUrl) {
                return;
            }

            this._currentUrl = newUrl;
            this._updateContainerStyle();

            let shouldCrossfade = (children.length > 0 && this.visible);

            let newLayer = new St.Widget({
                name: 'pill-cover-layer',
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                opacity: shouldCrossfade ? 0 : 255
            });
            if (this.width > 0) newLayer.width = this.width;
            if (this.height > 0) newLayer.height = this.height;
            newLayer._bgUrl = newUrl;

            this.add_child(newLayer);
            this._refreshLayerStyle(newLayer);

            if (shouldCrossfade) {
                newLayer.ease({
                    opacity: 255,
                    duration: 250,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => {
                        if (!this.get_parent && !this.get_children) return;
                        let curChildren = this.get_children ? this.get_children() : [];
                        let myIdx = curChildren.indexOf(newLayer);
                        if (myIdx > 0) {
                            for (let i = 0; i < myIdx; i++) {
                                try { curChildren[i].destroy(); } catch (_) {}
                            }
                        }
                    }
                });
            } else {
                for (let c of children) {
                    try { c.destroy(); } catch (_) {}
                }
            }
        }

        destroy() {
            this._currentUrl = null;
            let children = this.get_children ? this.get_children() : [];
            for (let c of children) {
                c.remove_all_transitions();
                try { c.destroy(); } catch (_) {}
            }
            super.destroy();
        }
    });

export const ScrollLabel = GObject.registerClass(
    class ScrollLabel extends St.Widget {
        _init(styleClass, settings, isPopup = false) {
            super._init({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: false, clip_to_allocation: true });
            this._settings = settings;
            this._isPopup = isPopup;
            this._text = "";
            this._gameMode = false;
            this._playerPaused = false;
            this._paused = false;
            this._isScrolling = false;
            this._hoverOnly = settings.get_boolean('scroll-on-hover-only');
            this._hovered = false;
            this._forceScroll = false;
            this._pendingScrollStop = false;
            this._container = new PixelSnappedBox({ x_expand: true, y_expand: true, x_align: Clutter.ActorAlign.CENTER, y_align: Clutter.ActorAlign.CENTER });
            this._container.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
            this.add_child(this._container);

            this._label1 = new St.Label({ style_class: styleClass, y_align: Clutter.ActorAlign.CENTER, x_expand: true });
            this._label2 = new St.Label({ style_class: styleClass, y_align: Clutter.ActorAlign.CENTER });
            this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            this._label1.clutter_text.line_wrap = false;
            this._label2.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label2.clutter_text.line_wrap = false;

            this._container.add_child(this._label1);
            this._separator = new St.Widget({
                name: 'scroll-label-separator',
                width: 30
            });
            this._container.add_child(this._separator);
            this._container.add_child(this._label2);

            this._settings.connectObject('changed::scroll-text', () => this.setText(this._text, true), this);
            this._settings.connectObject('changed::scroll-on-hover-only', () => {
                this._hoverOnly = this._settings.get_boolean('scroll-on-hover-only');
                if (this._hoverOnly && !this._hovered) this._stopAnimation();
                else this.setText(this._text, true);
            }, this);
            this._settings.connectObject('changed::freeze-scroll-on-pause', () => {
                this._updatePausedState();
            }, this);

            this.connectObject('notify::allocation', () => {
                if (this._ignoreResizeUntil && Date.now() < this._ignoreResizeUntil) return;
                if (this._resizeTimer) { GLib.Source.remove(this._resizeTimer); this._resizeTimer = null; }
                this._resizeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._resizeTimer = null;
                    if (this.has_allocation()) this._checkResize();
                    return GLib.SOURCE_REMOVE;
                });
            }, this);
        }

        vfunc_get_preferred_width(forHeight) {
            if (this._label1) {
                let natW = this.getNaturalTextWidth();
                return [0, natW];
            }
            return super.vfunc_get_preferred_width(forHeight);
        }

        getNaturalTextWidth() {
            if (!this._label1 || !this._label1.clutter_text) return 0;
            let ct = this._label1.clutter_text;
            let prevMode = ct.ellipsize;
            if (prevMode !== Pango.EllipsizeMode.NONE) {
                ct.ellipsize = Pango.EllipsizeMode.NONE;
            }
            let natW = 0;
            let layout = ct.get_layout();
            if (layout) {
                let [pixelW] = layout.get_pixel_size();
                natW = pixelW;
            }
            let [, prefW] = this._label1.get_preferred_width(-1);
            if (prevMode !== Pango.EllipsizeMode.NONE) {
                ct.ellipsize = prevMode;
            }
            return Math.ceil(Math.max(natW, prefW || 0));
        }

        setLabelStyle(css) {
            if (this._label1) this._label1.set_style(css);
            if (this._label2) this._label2.set_style(css);
        }

        _setFadeOutEffect(enableLeft = true, enableRight = true, animate = false) {
            if (!this._label1 || !TextFadeEffect.isSupported()) return;

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

        destroy() {
            this._cleanup();
            super.destroy();
        }

        _cleanup() {
            this._stopAnimation();
            if (this._settings) {
                this._settings.disconnectObject(this);
            }
            this.disconnectObject(this);
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

        setPlayerPaused(isPaused) {
            this._playerPaused = isPaused;
            this._updatePausedState();
        }

        _updatePausedState() {
            let shouldPause = this._playerPaused && this._settings && this._settings.get_boolean('freeze-scroll-on-pause');
            if (shouldPause) {
                if (!this._paused) {
                    this._paused = true;
                    // Cancel all pending timers so none of them can restart the scroll
                    if (this._idleResizeId) { GLib.Source.remove(this._idleResizeId); this._idleResizeId = null; }
                    if (this._measureTimeout) { GLib.Source.remove(this._measureTimeout); this._measureTimeout = null; }
                    if (this._resizeTimer) { GLib.Source.remove(this._resizeTimer); this._resizeTimer = null; }

                    let boxWidth = this.has_allocation() ? this.get_allocation_box().get_width() : 0;
                    let textWidth = (boxWidth > 1) ? this.getNaturalTextWidth() : 0;
                    let overflows = (boxWidth > 1) && (textWidth > boxWidth + 2);

                    this._stopAnimation(true);
                    this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                    if (overflows) {
                        this._setFadeOutEffect(false, true, true);
                    }
                }
            } else {
                if (this._paused) {
                    this._paused = false;
                    this._checkResize();
                }
            }
        }

        setHoverMode(hovered) {
            this._hovered = hovered;
            if (!this._hoverOnly) return;
            if (hovered) {
                this._checkResize();
            } else {
                // Don't stop lyrics scroll when un-hovering
                if (this._lyricTime > 0) return;
                // Don't stop if forceScroll is set (popup labels)
                if (this._forceScroll) return;
                // Let current scroll cycle finish, then stop
                if (this._isScrolling) {
                    this._pendingScrollStop = true;
                } else {
                    this._stopAnimation(true);
                    let boxWidth = this.has_allocation() ? this.get_allocation_box().get_width() : 0;
                    let textW = (boxWidth > 1) ? this.getNaturalTextWidth() : 0;
                    let overflows = (boxWidth > 1) && (textW > boxWidth + 2);
                    this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                    this._label2.hide();
                    this._separator.hide();
                }
            }
        }

        setForceScroll(force) {
            this._forceScroll = force;
            if (force) this._checkResize();
        }

        setPendingScrollStop(stop) {
            this._pendingScrollStop = stop;
        }

        ignoreResizeFor(ms = 500) {
            this._ignoreResizeUntil = Date.now() + ms;
            if (this._resizeTimer) { GLib.Source.remove(this._resizeTimer); this._resizeTimer = null; }
            if (this._measureTimeout) { GLib.Source.remove(this._measureTimeout); this._measureTimeout = null; }
            if (this._idleResizeId) { GLib.Source.remove(this._idleResizeId); this._idleResizeId = null; }
            this._measureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, ms + 50, () => {
                this._measureTimeout = null;
                this._ignoreResizeUntil = 0;
                if (this.has_allocation()) this._checkResize();
                return GLib.SOURCE_REMOVE;
            });
        }

        _checkResize() {
            if (!this._text || this._gameMode || this._paused) return;

            if (this._ignoreResizeUntil && Date.now() < this._ignoreResizeUntil) return;

            if (this._idleResizeId) { GLib.Source.remove(this._idleResizeId); this._idleResizeId = null; }

            this._idleResizeId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._idleResizeId = null;
                if (!this.get_parent())
                    return GLib.SOURCE_REMOVE;

                if (this._lyricFinished) return GLib.SOURCE_REMOVE;
                // Re-check paused/gameMode state — may have changed since idle was scheduled
                if (this._gameMode || this._paused) return GLib.SOURCE_REMOVE;
                if (this._ignoreResizeUntil && Date.now() < this._ignoreResizeUntil) return GLib.SOURCE_REMOVE;

                let boxWidth = this.get_allocation_box().get_width();
                if (boxWidth <= 1) return GLib.SOURCE_REMOVE;

                let textWidth = this.getNaturalTextWidth();
                let overflows = textWidth > boxWidth + 2;
                let needsScroll = overflows && (this._settings.get_boolean('scroll-text') || this._lyricTime > 0);
                let isScrolling = (this._scrollTimer != null) || this._isScrolling;

                if (needsScroll && !isScrolling) {
                    this._container.x_align = Clutter.ActorAlign.START;
                    if (this._lyricTime > 0) this._startLyricScroll(textWidth);
                    else if (!this._hoverOnly || this._hovered || this._forceScroll) this._startInfiniteScroll(textWidth);
                    else {
                        this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                        this._label1.x_expand = true;
                    }
                } else if (!needsScroll && isScrolling) {
                    this._stopAnimation(true);
                    this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                    this._label2.hide();
                    this._separator.hide();
                    this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    this._label1.x_expand = true;
                } else if (!needsScroll) {
                    this._stopAnimation(true);
                    this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                    this._label1.clutter_text.ellipsize = overflows ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE;
                    this._label1.x_expand = true;
                }

                return GLib.SOURCE_REMOVE;
            });
        }

        updateLyricMarkup(markup) {
            if (!markup) return;
            if (this._label1 && this._label1.clutter_text) {
                this._label1.clutter_text.set_markup(markup);
                if (this._label2 && this._label2.clutter_text && this._isScrolling) {
                    this._label2.clutter_text.set_markup(markup);
                }
            }
        }

        setText(text, force = false, lyricTime = 0) {
            if (!force && this._text === text) return;
            this._text = text || "";
            this._lyricTime = lyricTime;
            this._lyricFinished = false;

            this._stopAnimation(true);

            this._label1.text = this._text;
            this._label2.text = this._text;
            this._label2.hide();
            this._separator.hide();

            // Determine if the text overflows and will scroll to avoid ellipsis flicker
            let isDynamic = !this._isPopup && this._settings && this._settings.get_boolean('pill-dynamic-width');
            let boxWidth = this.has_allocation() ? this.get_allocation_box().get_width() : 0;
            let textWidth = this.getNaturalTextWidth();
            let confWidth = this._settings ? (this._settings.get_int('target-container') > 0 ? this._settings.get_int('panel-pill-width') : this._settings.get_int('pill-width')) : 300;
            let maxAvailableWidth = this._isPopup ? (boxWidth > 1 ? boxWidth : 260) : (isDynamic ? Math.max(60, confWidth - 80) : (boxWidth > 1 ? boxWidth : confWidth - 80));
            let overflows = (boxWidth > 1) ? (textWidth > boxWidth + 2) : (textWidth > maxAvailableWidth);
            let willOverflowMax = textWidth > maxAvailableWidth;
            let scrollSetting = this._settings ? this._settings.get_boolean('scroll-text') : false;
            let willScroll = (overflows || willOverflowMax) && (scrollSetting || lyricTime > 0);

            if (willScroll) {
                this._container.x_align = Clutter.ActorAlign.START;
                this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
                this._label1.x_expand = false;
                if (lyricTime <= 0) {
                    this._setFadeOutEffect(false, true, false);
                } else {
                    this._clearFadeOutEffect();
                }
            } else {
                this._clearFadeOutEffect();
                this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                this._label1.x_expand = true;
                if (isDynamic && lyricTime <= 0 && !overflows && !willOverflowMax) {
                    this._container.x_align = Clutter.ActorAlign.CENTER;
                } else if (overflows || willOverflowMax) {
                    this._container.x_align = Clutter.ActorAlign.START;
                } else {
                    this._container.x_align = Clutter.ActorAlign.CENTER;
                }
            }

            this._label1.remove_transition('opacity');
            let isLyric = (lyricTime > 0);
            let lyricFadeEnabled = this._settings ? this._settings.get_boolean('lyric-fade-enable') : false;

            if (isLyric) {
                if (lyricFadeEnabled) {
                    let duration = this._settings ? this._settings.get_int('lyric-fade-duration') : 600;
                    this._label1.opacity = 0;
                    this._label1.ease({
                        opacity: 255,
                        duration: duration,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                } else {
                    this._label1.opacity = 255;
                }
            } else if (force || this._label1.opacity < 255) {
                this._label1.opacity = 0;
                this._label1.ease({
                    opacity: 255,
                    duration: 600,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            } else {
                this._label1.opacity = 255;
            }

            // Don't schedule scroll measurement while paused
            if (this._paused) return;

            let delay = isDynamic ? 450 : 100;
            this.ignoreResizeFor(delay);
        }

        _stopAnimation(resetPosition = true) {
            this._isScrolling = false;
            this._clearFadeOutEffect();
            this._container.remove_all_transitions();
            if (resetPosition) this._container.translation_x = 0;
            if (this._scrollTimer) { GLib.Source.remove(this._scrollTimer); this._scrollTimer = null; }
            if (this._label1) {
                let scrollSetting = this._settings && this._settings.get_boolean('scroll-text');
                if (!scrollSetting && this._lyricTime <= 0) {
                    this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    this._label1.x_expand = true;
                }
            }
        }

        _checkOverflow() {
            if (this._gameMode || this._paused || !this.get_parent()) return;
            if (this._ignoreResizeUntil && Date.now() < this._ignoreResizeUntil) return;
            let boxWidth = this.get_allocation_box().get_width();
            if (boxWidth <= 1) return;

            let textWidth = this.getNaturalTextWidth();
            let overflows = textWidth > boxWidth + 2;
            let needsScroll = overflows && (this._settings.get_boolean('scroll-text') || this._lyricTime > 0);

            if (needsScroll) {
                this._container.x_align = Clutter.ActorAlign.START;
                if (this._lyricTime > 0) {
                    this._startLyricScroll(textWidth);
                } else if (!this._hoverOnly || this._hovered || this._forceScroll) {
                    this._startInfiniteScroll(textWidth);
                } else {
                    this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                    this._label1.x_expand = true;
                }
            } else {
                this._stopAnimation(true);
                this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
                this._label1.x_expand = true;
            }
        }

        _startInfiniteScroll(textWidth) {
            this._stopAnimation(true);
            this._isScrolling = true;
            this._label2.show();
            this._separator.show();
            this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label2.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label1.x_expand = false;
            this._label2.x_expand = false;
            const distance = textWidth + 30;
            const duration = (distance / 30) * 1000;

            const loop = () => {
                if (this._gameMode || !this.get_parent()) return;

                this._setFadeOutEffect(false, true, true);

                if (this._scrollTimer) GLib.Source.remove(this._scrollTimer);
                this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                    this._scrollTimer = null;
                    if (this._gameMode || !this.get_parent()) return GLib.SOURCE_REMOVE;

                    // Check pending stop during the pause before scrolling starts
                    if (this._pendingScrollStop) {
                        this._pendingScrollStop = false;
                        this._isScrolling = false;
                        this._stopAnimation(true);
                        let boxWidth = this.has_allocation() ? this.get_allocation_box().get_width() : 0;
                        let textW = (boxWidth > 1) ? this.getNaturalTextWidth() : 0;
                        let overflows = (boxWidth > 1) && (textW > boxWidth + 2);
                        this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                        this._label2.hide();
                        this._separator.hide();
                        return GLib.SOURCE_REMOVE;
                    }

                    this._setFadeOutEffect(true, true, true);

                    this._container.ease({
                        translation_x: -distance, duration: duration, mode: Clutter.AnimationMode.LINEAR,
                        onStopped: (isFinished) => {
                            if (!isFinished || this._gameMode || this._pendingScrollStop) {
                                this._isScrolling = false;
                                this._pendingScrollStop = false;
                                this._stopAnimation(true);
                                let boxWidth = this.has_allocation() ? this.get_allocation_box().get_width() : 0;
                                let textW = (boxWidth > 1) ? this.getNaturalTextWidth() : 0;
                                let overflows = (boxWidth > 1) && (textW > boxWidth + 2);
                                this._container.x_align = overflows ? Clutter.ActorAlign.START : Clutter.ActorAlign.CENTER;
                                this._label2.hide();
                                this._separator.hide();
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
            this._clearFadeOutEffect();
            this._isScrolling = true;
            this._label2.hide();
            this._separator.hide();
            this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            this._label1.x_expand = false;

            let boxWidth = this.get_allocation_box().get_width();
            const distance = Math.max(0, textWidth - boxWidth + 6);

            if (distance <= 5) return;

            const totalDurationMs = this._lyricTime * 1000;
            const pauseTime = Math.min(350, Math.max(150, totalDurationMs * 0.10));
            const tailTime = Math.min(1200, Math.max(600, totalDurationMs * 0.25));
            const scrollDuration = Math.max(300, totalDurationMs - pauseTime - tailTime);

            if (scrollDuration <= 0) return;

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

export const PillTextWrapper = GObject.registerClass(
    class PillTextWrapper extends St.Widget {
        vfunc_get_preferred_width(forHeight) {
            let textBox = this.get_first_child();
            if (textBox) {
                let [, natW] = textBox.get_preferred_width(forHeight);
                return [0, Math.max(0, natW)];
            }
            return [0, 0];
        }
    });

export { PixelSnappedBox };
