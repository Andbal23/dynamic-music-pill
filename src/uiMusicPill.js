import GdkPixbuf from 'gi://GdkPixbuf';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { getAverageColor, getClosestGnomeAccent } from './utils.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { CrossfadeArt, ScrollLabel, _addBtnPressAnim } from './uiWidgets.js';
import { WaveformVisualizer } from './uiVisualizers.js';

export const MusicPill = GObject.registerClass(
    class MusicPill extends St.Widget {
        _init(controller) {
            super._init({
                style_class: 'music-pill-container',
                reactive: false,
                layout_manager: new Clutter.BinLayout(),
                y_expand: true,
                y_align: Clutter.ActorAlign.FILL,
                x_align: Clutter.ActorAlign.CENTER,
                opacity: 0,
                width: 0,
                visible: false
            });
            this._delegate = { app: null };
            this.child = { _delegate: this._delegate };

            this._lastScrollTime = 0;
            this._controller = controller;
            this._settings = controller._settings;

            this._isActiveState = false;
            this._targetWidth = 250;
            this._artDebounceTimer = null;
            this._padX = 14;
            this._padY = 6;
            this._radius = 28;
            this._shadowCSS = 'box-shadow: none;';
            this._inPanel = false;
            this._gameModeActive = false;

            this._currentBusName = null;
            this._lyricObj = null;
            this._displayedColor = { r: 40, g: 40, b: 40 };
            this._targetColor = { r: 40, g: 40, b: 40 };
            this._colorAnimId = null;
            this._hideGraceTimer = null;

            this._lastBodyCss = null;
            this._lastLeftCss = null;
            this._lastRightCss = null;

            // UI Construction
            this._body = new St.BoxLayout({
                style_class: 'pill-body',
                x_expand: false,
                y_expand: false,
                y_align: Clutter.ActorAlign.CENTER
            });
            this._body.set_pivot_point(0.5, 0.5);

            this._artWidget = new CrossfadeArt();
            this._artBin = new St.Bin({
                child: this._artWidget,
                style: 'margin-right: 8px;',
                x_expand: false,
                y_expand: false
            });
            this._body.add_child(this._artBin);
            this._prevBtn = new St.Button({ style_class: 'tablet-skip-btn', child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 20 }), reactive: true });
            this._playPauseBtnTablet = new St.Button({ style_class: 'tablet-skip-btn', child: new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 20 }), reactive: true });
            this._nextBtn = new St.Button({ style_class: 'tablet-skip-btn', child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 20 }), reactive: true });

            this._prevBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);
            this._playPauseBtnTablet.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);
            this._nextBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);

            this._prevBtn.connectObject('button-release-event', () => {
                if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                this._controller.previous(); return Clutter.EVENT_STOP;
            }, this);
            this._prevBtn.connectObject('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_BEGIN) return Clutter.EVENT_STOP;
                if (event.type() === Clutter.EventType.TOUCH_END) {
                    if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                    this._controller.previous(); return Clutter.EVENT_STOP;
                } return Clutter.EVENT_PROPAGATE;
            }, this);

            this._playPauseBtnTablet.connectObject('button-release-event', () => {
                if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                this._controller.togglePlayback(); return Clutter.EVENT_STOP;
            }, this);
            this._playPauseBtnTablet.connectObject('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_BEGIN) return Clutter.EVENT_STOP;
                if (event.type() === Clutter.EventType.TOUCH_END) {
                    if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                    this._controller.togglePlayback(); return Clutter.EVENT_STOP;
                } return Clutter.EVENT_PROPAGATE;
            }, this);

            this._nextBtn.connectObject('button-release-event', () => {
                if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                this._controller.next(); return Clutter.EVENT_STOP;
            }, this);
            this._nextBtn.connectObject('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_BEGIN) return Clutter.EVENT_STOP;
                if (event.type() === Clutter.EventType.TOUCH_END) {
                    if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                    this._controller.next(); return Clutter.EVENT_STOP;
                } return Clutter.EVENT_PROPAGATE;
            }, this);

            this._tabletControls = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER, style: 'margin-left: 6px;' });
            this._tabletControls.add_child(this._prevBtn);
            this._tabletControls.add_child(this._playPauseBtnTablet);
            this._tabletControls.add_child(this._nextBtn);
            this._body.add_child(this._tabletControls);

            this._textWrapper = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true, y_expand: true,
                clip_to_allocation: true,
                style: 'min-width: 10px; margin-right: 4px; margin-left: 2px;'
            });

            this._textBox = new St.BoxLayout({
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.FILL,
                style: 'padding-left: 0px; padding-right: 0px; spacing: 0px;'
            });
            this._textBox.layout_manager.orientation = Clutter.Orientation.VERTICAL;
            this._titleScroll = new ScrollLabel('music-label-title', this._settings);
            this._artistScroll = new ScrollLabel('music-label-artist', this._settings);
            this._textBox.add_child(this._titleScroll);
            this._textBox.add_child(this._artistScroll);
            this._textWrapper.add_child(this._textBox);

            this._body.add_child(this._textWrapper);

            this._visualizer = new WaveformVisualizer(24, this._settings, false);
            this._visBin = new St.Bin({
                child: this._visualizer,
                style: 'margin-left: 8px;',
                x_align: Clutter.ActorAlign.END
            });
            this._body.add_child(this._visBin);
            this.add_child(this._body);

            // --- Clicks ---
            this.connectObject('button-press-event', () => {
                if (!this._body) return Clutter.EVENT_STOP;
                this._body.ease({ scale_x: 0.96, scale_y: 0.96, duration: 80, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                return Clutter.EVENT_STOP;
            }, this);

            this.connectObject('touch-event', (actor, event) => {
                let type = event.type();
                if (type === Clutter.EventType.TOUCH_BEGIN) {
                    if (!this._body) return Clutter.EVENT_STOP;
                    this._body.ease({ scale_x: 0.96, scale_y: 0.96, duration: 80, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                    return Clutter.EVENT_STOP;
                } else if (type === Clutter.EventType.TOUCH_END) {
                    if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                    if (!this._body) return Clutter.EVENT_STOP;
                    this._body.ease({ scale_x: 1.0, scale_y: 1.0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_BACK });
                    this._handleLeftClick();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.connectObject('button-release-event', (actor, event) => {
                if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                if (!this._body) return Clutter.EVENT_STOP;
                this._body.ease({ scale_x: 1.0, scale_y: 1.0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_BACK });

                let button = event.get_button();

                if (button === 2) {
                    let action = this._settings.get_string('action-middle-click');
                    if (action && action !== 'none') this._controller.performAction(action);
                    return Clutter.EVENT_STOP;
                } else if (button === 3) {
                    let action = this._settings.get_string('action-right-click');
                    if (action && action !== 'none') this._controller.performAction(action);
                    return Clutter.EVENT_STOP;
                }

                if (button === 1) {
                    this._handleLeftClick();
                }

                return Clutter.EVENT_STOP;
            }, this);

            this.connectObject('enter-event', () => {
                let delay = this._settings.get_int('hover-delay');
                if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); }
                this._hoverTimeout = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, delay, () => {
                    this._hoverTimeout = null;
                    let action = this._settings.get_string('action-hover');
                    if (action && action !== 'none') {
                        this._controller.performAction(action);
                    }
                });
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.connectObject('leave-event', () => {
                if (this._hoverTimeout) {
                    GLib.Source.remove(this._hoverTimeout);
                    this._hoverTimeout = null;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.connectObject('scroll-event', (actor, event) => {
                try {
                    if (!this._settings.get_boolean('enable-scroll-controls')) return Clutter.EVENT_STOP;
                    if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
                    let direction = event.get_scroll_direction();
                    let shouldNext = false;
                    let shouldPrev = false;

                    if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.RIGHT) {
                        shouldNext = true;
                    } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.LEFT) {
                        shouldPrev = true;
                    } else if (direction === Clutter.ScrollDirection.SMOOTH) {
                        let [dx, dy] = event.get_scroll_delta();

                        if (this._scrollDelta === undefined) this._scrollDelta = 0;
                        let delta = Math.abs(dy) > Math.abs(dx) ? dy : -dx;
                        this._scrollDelta += delta;

                        let threshold = 1.0;
                        if (this._scrollDelta > threshold) {
                            shouldPrev = true;
                            this._scrollDelta = 0;
                        } else if (this._scrollDelta < -threshold) {
                            shouldNext = true;
                            this._scrollDelta = 0;
                        } else {
                            return Clutter.EVENT_STOP;
                        }
                    }

                    if (this._settings.get_boolean('invert-scroll-direction')) {
                        let temp = shouldNext;
                        shouldNext = shouldPrev;
                        shouldPrev = temp;
                    }

                    if (shouldNext || shouldPrev) {
                        let now = Date.now();
                        let action = this._settings.get_string('scroll-action');
                        let delayLimit = (action === 'volume') ? 50 : 500;

                        if (now - this._lastScrollTime < delayLimit) return Clutter.EVENT_STOP;
                        this._lastScrollTime = now;

                        let invert = this._settings.get_boolean('invert-scroll-animation');
                        let offset = 12;

                        if (shouldNext) {
                            this._animateSlide(invert ? -offset : offset);
                            if (action === 'volume') this._controller.changeVolume(true);
                            else if (action === 'player') this._controller.switchPlayer(true);
                            else this._controller.next();
                        } else {
                            this._animateSlide(invert ? offset : -offset);
                            if (action === 'volume') this._controller.changeVolume(false);
                            else if (action === 'player') this._controller.switchPlayer(false);
                            else this._controller.previous();
                        }
                    }
                } catch (e) {
                    // Without it sometimes trigger the virtal windows switching on the dash-to-dock, maybe if you scroll too fast. 
                    console.debug(`[Dynamic Music Pill] Scroll handled with safe-skip: ${e.message}`);
                }

                return Clutter.EVENT_STOP;
            }, this);

            // Listeners
            this._settings.connectObject('changed::edge-margin', () => {
                this._updateDimensions();
                this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);
            }, this);
            this._settings.connectObject('changed::hide-text', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::pill-dynamic-width', () => { this._updateDimensions(); if (this._isActiveState) this._body.ease({ width: this._targetWidth, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); }, this);
            this._settings.connectObject('changed::inline-artist', () => this._updateTextDisplay(true), this);
            this._settings.connectObject('changed::use-custom-colors', () => { this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); this._updateDimensions(); }, this);
            this._settings.connectObject('changed::custom-bg-color', () => this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b), this);
            this._settings.connectObject('changed::custom-text-color', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::tablet-mode', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::scroll-action', () => { this._scrollDelta = 0; }, this);
            this._settings.connectObject('changed::enable-transparency', () => this._updateTransparencyConfig(), this);
            this._settings.connectObject('changed::transparency-strength', () => this._updateTransparencyConfig(), this);
            this._settings.connectObject('changed::transparency-art', () => this._updateTransparencyConfig(), this);
            this._settings.connectObject('changed::transparency-text', () => this._updateTransparencyConfig(), this);
            this._settings.connectObject('changed::transparency-vis', () => this._updateTransparencyConfig(), this);
            this._settings.connectObject('changed::popup-follow-transparency', () => {
                this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);
            }, this);
            this._settings.connectObject('changed::popup-enable-shadow', () => {
                this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);
            }, this);
            this._settings.connectObject('changed::popup-follow-radius', () => {
                this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);
            }, this);
            this._settings.connectObject('changed::pill-width', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::pill-height', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::art-size', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::panel-pill-height', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::panel-art-size', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::dock-art-size', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::panel-pill-width', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::vertical-offset', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::horizontal-offset', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::dock-position', () => this._controller._queueInject(), this);
            this._settings.connectObject('changed::position-mode', () => this._controller._queueInject(), this);
            this._settings.connectObject('changed::target-container', () => this._controller._queueInject(), this);
            this._settings.connectObject('changed::visualizer-style', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::border-radius', () => { this._updateDimensions(); this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); }, this);
            this._settings.connectObject('changed::enable-shadow', () => { this._updateDimensions(); this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); }, this);
            this._settings.connectObject('changed::shadow-opacity', () => { this._updateDimensions(); this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); }, this);
            this._settings.connectObject('changed::shadow-blur', () => { this._updateDimensions(); this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); }, this);
            this._settings.connectObject('changed::show-album-art', () => this._updateArtVisibility(), this);
            this._settings.connectObject('changed::show-pill-border', () => { this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); }, this);
            this._settings.connectObject('changed::always-show-pill', () => {
                if (!this._settings.get_boolean('always-show-pill') && this._currentStatus === 'Stopped' && this._isActiveState) {
                    this.updateDisplay(null, null, null, 'Stopped', null, false);
                }
            }, this);
            this._settings.connectObject('changed::visualizer-padding', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::visualizer-bars', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::visualizer-bar-width', () => this._updateDimensions(), this);
            this._settings.connectObject('changed::visualizer-height', () => this._updateDimensions(), this);
            this.connect('notify::allocation', () => {
                if (this._allocTimer) return;
                this._allocTimer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 100, () => {
                    this._allocTimer = null;
                    let parent = this.get_parent();
                    if (parent && !this._inPanel) {
                        let [pw, ph] = parent.get_size();
                        let side = (pw > 0 && ph > 0 && pw < ph);
                        if (this._isSidePanel !== side) {
                            this._updateDimensions();
                        }
                    }
                });
            });

            this.connect('notify::mapped', () => {
                this._checkRealVisibility();
            });

            this._updateTransparencyConfig();
            this._updateDimensions();

            this._isActuallyVisible = true;
            this._cancellable = new Gio.Cancellable();

            this._realVisibilityTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                if (!this || (this.is_finalized && this.is_finalized())) {
                    this._realVisibilityTimerId = null;
                    return GLib.SOURCE_REMOVE;
                }
                if (!this.get_parent()) return GLib.SOURCE_CONTINUE;
                this._checkRealVisibility();
                return GLib.SOURCE_CONTINUE;
            });

            try {
                this._interfaceSettings = new Gio.Settings({ schema_id: 'org.gnome.desktop.interface' });
                this._originalAccent = this._interfaceSettings.get_string('accent-color');
            } catch (e) {
                this._interfaceSettings = null; //for older gnomes
            }

            this.connect('destroy', this._cleanup.bind(this));
        }

        _cleanup() {
            if (this._interfaceSettings && this._settings.get_boolean('sync-accent-color')) {
                try {
                    this._interfaceSettings.set_string('accent-color', this._originalAccent || 'blue');
                } catch (e) { }
            }
            if (this._realVisibilityTimerId) { GLib.Source.remove(this._realVisibilityTimerId); this._realVisibilityTimerId = null; }
            if (this._allocTimer) { GLib.Source.remove(this._allocTimer); this._allocTimer = null; }
            if (this._colorAnimId) { GLib.Source.remove(this._colorAnimId); this._colorAnimId = null; }
            if (this._artDebounceTimer) { GLib.Source.remove(this._artDebounceTimer); this._artDebounceTimer = null; }
            if (this._hideGraceTimer) { GLib.Source.remove(this._hideGraceTimer); this._hideGraceTimer = null; }
            if (this._hoverTimeout) { GLib.Source.remove(this._hoverTimeout); this._hoverTimeout = null; }
            if (this._singleClickTimerId) { GLib.Source.remove(this._singleClickTimerId); this._singleClickTimerId = null; }
            if (this._idleDimId) { GLib.Source.remove(this._idleDimId); this._idleDimId = null; }
            if (this._cancellable) { this._cancellable.cancel(); this._cancellable = null; }
        }
        animateOutAndDestroy() {
        }

        _handleLeftClick() {
            let singleAction = this._settings.get_string('action-left-click');
            let doubleAction = this._settings.get_string('action-double-click');

            if (!doubleAction || doubleAction === 'none') {
                if (singleAction && singleAction !== 'none') this._controller.performAction(singleAction);
                return;
            }

            let now = Date.now();
            let doubleClickTime = 200;

            if (this._lastLeftClickTime && (now - this._lastLeftClickTime) <= doubleClickTime) {
                this._lastLeftClickTime = 0;
                if (this._singleClickTimerId) {
                    GLib.Source.remove(this._singleClickTimerId);
                    this._singleClickTimerId = null;
                }
                this._controller.performAction(doubleAction);
            } else {
                this._lastLeftClickTime = now;
                if (this._singleClickTimerId) {
                    GLib.Source.remove(this._singleClickTimerId);
                }
                this._singleClickTimerId = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, doubleClickTime, () => {
                    this._singleClickTimerId = null;
                    this._lastLeftClickTime = 0;
                    if (singleAction && singleAction !== 'none') {
                        this._controller.performAction(singleAction);
                    }
                });
            }
        }



        _checkRealVisibility() {
            let isVisible = false;

            if (this.mapped && this.get_paint_opacity() > 0) {
                let [x, y] = this.get_transformed_position();
                let [w, h] = this.get_transformed_size();
                let monitor = Main.layoutManager.findMonitorForActor(this);

                if (monitor) {
                    if (x + w > monitor.x && x < monitor.x + monitor.width &&
                        y + h > monitor.y && y < monitor.y + monitor.height) {
                        isVisible = true;
                    }
                }
            }

            if (this._isActuallyVisible !== isVisible) {
                this._isActuallyVisible = isVisible;
                this._updatePlayingStates();
            }
        }


        _updatePlayingStates() {
            let isVisibleAndActive = this._isActuallyVisible && !this._gameModeActive;

            if (this._visualizer) {
                let isPlaying = this._currentStatus === 'Playing';
                let popupOpen = this._controller?._expandedPlayer?.visible;
                this._visualizer.setPlaying(isPlaying && (isVisibleAndActive || popupOpen));
            }
            if (this._titleScroll) {
                this._titleScroll.setGameMode(!isVisibleAndActive);
            }
            if (this._artistScroll) {
                this._artistScroll.setGameMode(!isVisibleAndActive);
            }
        }

        _updateTransparencyConfig() {
            if (!this._body) return;

            let enableTrans = this._settings.get_boolean('enable-transparency');
            let strength = this._settings.get_int('transparency-strength');

            let enableArtTrans = this._settings.get_boolean('transparency-art');
            let enableTextTrans = this._settings.get_boolean('transparency-text');
            let enableVisTrans = this._settings.get_boolean('transparency-vis');

            let bgAlpha = enableTrans ? (strength / 100.0) : 1.0;
            let targetOpacity = Math.floor(bgAlpha * 255);

            const setOp = (actor, isEnabled) => {
                if (isEnabled && enableTrans) {
                    actor.set_opacity(targetOpacity);
                } else {
                    actor.set_opacity(255);
                }
            };

            setOp(this._artBin, enableArtTrans);
            setOp(this._textBox, enableTextTrans);
            setOp(this._visBin, enableVisTrans);

            this._currentBgAlpha = bgAlpha;
            this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);
        }

        setGameMode(active) {
            if (this._gameModeActive === active) return;
            this._gameModeActive = active;

            this._updatePlayingStates();

            if (!active && this._isActiveState && this.mapped && this._isActuallyVisible) {
                this.opacity = 255;
            }
        }

        _setPopupOpen(isOpen) {
            this._isPopupOpen = isOpen;
            this._updateDimensions();
        }

        _updateArtVisibility() {
            let showSetting = this._settings.get_boolean('show-album-art');
            if (!showSetting) {
                if (this._artDebounceTimer) {
                    GLib.Source.remove(this._artDebounceTimer);
                    this._artDebounceTimer = null;
                }
                this._artBin.visible = false;
                return;
            }

            let hasMeta = this._lastArtUrl && this._lastArtUrl.length > 0;

            if (hasMeta) {
                if (this._artDebounceTimer) {
                    GLib.Source.remove(this._artDebounceTimer);
                    this._artDebounceTimer = null;
                }
                this._artBin.visible = true;
                this._artBin.opacity = 255;
            } else {
                if (!this._artDebounceTimer) {
                    this._artDebounceTimer = GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, 1000, () => {
                        this._artBin.visible = false;
                        this._artWidget.setArt(null);
                        this._artDebounceTimer = null;
                    });
                }
            }
        }

        _updateDimensions() {
            if (!this.get_parent()) return;
            let target = this._settings.get_int('target-container');
            this._inPanel = (target > 0);

            let parent = this.get_parent();
            let isSidePanel = false;
            if (parent && !this._inPanel) {
                let [pw, ph] = parent.get_size();
                if (pw > 0 && ph > 0 && pw < ph) {
                    isSidePanel = true;
                }
            }
            this._isSidePanel = isSidePanel;

            this.set_width(-1);

            let width, height, prefArtSize;

            let confWidth = this._inPanel ? this._settings.get_int('panel-pill-width') : this._settings.get_int('pill-width');
            width = confWidth;

            if (this._inPanel) {
                height = this._settings.get_int('panel-pill-height');
                prefArtSize = this._settings.get_int('panel-art-size');
            } else {
                height = this._settings.get_int('pill-height');
                prefArtSize = this._settings.get_int('dock-art-size');
            }

            let vOffset = this._settings.get_int('vertical-offset');
            let hOffset = this._settings.get_int('horizontal-offset');
            let visStyle = this._settings.get_int('visualizer-style');
            this._radius = this._settings.get_int('border-radius');

            let shadowEnabled = this._settings.get_boolean('enable-shadow');
            let shadowBlur = this._settings.get_int('shadow-blur');
            let shadowOpacity = this._settings.get_int('shadow-opacity') / 100.0;

            let fontSizeTitle = '11pt';
            let fontSizeArtist = '9pt';

            if (this._inPanel) {
                this._padY = 0;
                fontSizeTitle = '9.5pt';
                fontSizeArtist = '8pt';
            } else {
                let rawPadY = Math.floor(height / 10);
                this._padY = Math.max(2, Math.min(8, rawPadY));
            }

            this._padX = this._settings.get_int('edge-margin');

            if (isSidePanel) {
                let temp = this._padX;
                this._padX = this._padY;
                this._padY = temp;
            }

            let hideText = this._settings.get_boolean('hide-text');

            if (isSidePanel) {
                hideText = true;
                this._body.layout_manager.orientation = Clutter.Orientation.VERTICAL;
            } else {
                this._body.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
            }

            if (hideText) {
                this._textWrapper.hide();
            } else {
                this._textWrapper.show();
            }

            this._body.translation_y = vOffset;
            this._body.translation_x = hOffset;

            if (shadowEnabled) {
                this._shadowCSS = `box-shadow: 0px 2px ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity});`;
            } else {
                this._shadowCSS = `box-shadow: none;`;
            }

            let artRadius = Math.max(4, this._radius - (isSidePanel ? this._padX : this._padY));
            let maxArtHeight = (isSidePanel ? width : height) - (2 * (isSidePanel ? this._padX : this._padY));
            if (maxArtHeight < 10) maxArtHeight = 10;
            let finalArtSize = Math.min(prefArtSize, maxArtHeight);

            this._artWidget.set_width(finalArtSize);
            this._artWidget.set_height(finalArtSize);
            this._artBin.set_width(finalArtSize);
            this._artBin.set_height(finalArtSize);

            this._artWidget.setRadius(artRadius);
            this._artWidget.setShadowStyle(this._shadowCSS);
            this._visualizer.setMode(visStyle);
            this._visualizer.setHeightClamped(maxArtHeight);

            let tabletSetting = 0;
            try {
                let type = this._settings.settings_schema.get_key('tablet-mode').get_value_type().dup_string();
                tabletSetting = type === 'b' ? (this._settings.get_boolean('tablet-mode') ? 3 : 0) : this._settings.get_int('tablet-mode');
            } catch (e) { tabletSetting = 0; }

            if (tabletSetting > 0 && !this._gameModeActive) {
                this._tabletControls.show();
                this._prevBtn.visible = (tabletSetting === 1 || tabletSetting === 3);
                this._nextBtn.visible = (tabletSetting === 1 || tabletSetting === 3);
                if (this._playPauseBtnTablet)
                    this._playPauseBtnTablet.visible = (tabletSetting === 2 || tabletSetting === 3);
            } else {
                this._tabletControls.hide();
            }

            if (this._isSidePanel) {
                this._tabletControls.layout_manager.orientation = Clutter.Orientation.VERTICAL;
                this._tabletControls.set_style('margin: 0px;');
            } else {
                this._tabletControls.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
                this._tabletControls.set_style('margin-left: 6px; margin-top: 0px;');
            }

            let forceHideVis = this._isPopupOpen && this._settings.get_boolean('popup-hide-pill-visualizer') && this._settings.get_boolean('popup-show-visualizer');

            if (this._currentStatus === 'Stopped' && (!this._origTitle || this._origTitle === _('No Media') || this._origTitle === 'No Media')) {
                forceHideVis = true;
            }

            let isDynamic = this._settings.get_boolean('pill-dynamic-width');

            if ((width < 220 && !hideText && !isDynamic) || visStyle === 0 || forceHideVis) {
                this._visBin.hide();
                this._visBin.set_width(0);
                this._visBin.set_height(0);
                this._visBin.set_style('margin: 0px;');

                if (!tabletSetting || this._gameModeActive) {
                    let artMargin = hideText ? 0 : ((width < 180) ? 4 : 8);
                    if (isSidePanel) this._artBin.set_style(`margin-bottom: ${artMargin}px; margin-right: 0px;`);
                    else this._artBin.set_style(`margin-right: ${artMargin}px; margin-bottom: 0px;`);
                } else {
                    let artMargin = hideText ? 0 : 2;
                    this._artBin.set_style(isSidePanel ? `margin-bottom: ${artMargin}px; margin-right: 0px;` : `margin-right: ${artMargin}px; margin-bottom: 0px;`);
                }
            } else {
                this._visBin.show();
                let sideMargin = hideText ? 6 : this._settings.get_int('visualizer-padding');

                if (isSidePanel) {
                    this._visBin.set_style(`margin-top: ${sideMargin}px; margin-left: 0px;`);
                    this._visBin.set_height(-1);
                    this._visBin.set_width(finalArtSize);
                    this._artBin.set_style(`margin-bottom: ${sideMargin}px; margin-right: 0px;`);
                } else {
                    this._visBin.set_style(`margin-left: ${sideMargin}px; margin-top: 0px;`);
                    this._visBin.set_width(-1);
                    this._visBin.set_height(-1);
                    this._artBin.set_style(`margin-right: ${sideMargin}px; margin-bottom: 0px;`);
                }
            }

            let customTextStr = this._settings.get_boolean('use-custom-colors') ? `rgb(${this._settings.get_string('custom-text-color')})` : 'white';
            let customTextAlpha = this._settings.get_boolean('use-custom-colors') ? `rgba(${this._settings.get_string('custom-text-color')}, 0.7)` : 'rgba(255,255,255,0.7)';

            if (height < 46 && !this._inPanel) {
                this._artistScroll.hide();
            } else if (this._inPanel && height < 30) {
                this._artistScroll.hide();
            } else {
                this._artistScroll.show();
            }

            this._titleScroll.setLabelStyle(`font-size: ${fontSizeTitle}; font-weight: 800; color: ${customTextStr};`);
            this._artistScroll.setLabelStyle(`font-size: ${fontSizeArtist}; font-weight: 500; color: ${customTextAlpha};`);

            this._updateTextDisplay();

            let targetWidth = confWidth;
            let targetHeight = height;

            if (isSidePanel) {
                targetWidth = height;
                let elementsH = this._padY * 2;

                if (this._artBin.visible) {
                    let artM = (!tabletSetting || this._gameModeActive) ? (((width < 220 && !hideText) || visStyle === 0) ? ((width < 180 && !hideText) ? 4 : 8) : this._settings.get_int('visualizer-padding')) : 2;
                    elementsH += finalArtSize + artM;
                }
                if (this._visBin.visible) elementsH += this._visBin.get_preferred_height(-1)[1] + this._settings.get_int('visualizer-padding');
                if (this._tabletControls.visible) elementsH += this._tabletControls.get_preferred_height(-1)[1];

                targetHeight = Math.max(elementsH, 60);
                this._targetHeight = targetHeight;
                this._targetWidth = targetWidth;

                if (this._isActiveState && this._body.height > 0 && this._body.height !== targetHeight) {
                    this._body.ease({ height: targetHeight, width: targetWidth, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                } else {
                    this._body.set_height(targetHeight);
                    this._body.set_width(targetWidth);
                }
            } else {
                if (this._settings.get_boolean('pill-dynamic-width') || hideText) {
                    let currentWidth = this._body.width;
                    this._body.remove_transition('width');

                    let elementsW = this._padX * 2;
                    let currentSideMargin = hideText ? 4 : this._settings.get_int('visualizer-padding');

                    if (this._artBin.visible) {
                        let isVisHidden = ((width < 220 && !hideText) || visStyle === 0 || forceHideVis);
                        let artM = 0;
                        if (isVisHidden) {
                            artM = hideText ? 0 : ((!tabletSetting || this._gameModeActive) ? ((width < 180) ? 4 : 8) : 2);
                        } else {
                            artM = currentSideMargin;
                        }
                        elementsW += finalArtSize + artM;
                    }
                    if (this._tabletControls.visible) elementsW += this._tabletControls.get_preferred_width(-1)[1];
                    if (this._visBin.visible) elementsW += this._visBin.get_preferred_width(-1)[1] + currentSideMargin;

                    let titleW = hideText ? 0 : this._titleScroll._label1.get_preferred_width(-1)[1];
                    let artistW = (hideText || !this._artistScroll.visible) ? 0 : this._artistScroll._label1.get_preferred_width(-1)[1];

                    elementsW += Math.max(titleW, artistW) + (hideText ? 0 : 12);
                    let monitor = Main.layoutManager.findMonitorForActor(this);
                    let maxAvailableW = monitor ? monitor.width - 40 : 800;

                    let isLyricActive = (this._lyricObj && this._lyricObj.content);

                    if (isLyricActive && !hideText) {
                        targetWidth = Math.min(confWidth, maxAvailableW);
                    } else {
                        targetWidth = hideText ? elementsW : Math.min(Math.max(elementsW, 120), confWidth);
                        targetWidth = Math.min(targetWidth, maxAvailableW);
                    }

                    if (currentWidth > 0 && Math.abs(targetWidth - currentWidth) < 10) {
                        targetWidth = currentWidth;
                    }
                }

                this._targetWidth = targetWidth;
                this._targetHeight = targetHeight;

                if (this._isActiveState && this._body.width > 0 && this._body.width !== targetWidth) {
                    this._body.ease({ width: targetWidth, height: targetHeight, duration: 400, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                } else {
                    this._body.set_width(targetWidth);
                    this._body.set_height(targetHeight);
                }
            }

            if (this._idleDimId) { GLib.Source.remove(this._idleDimId); this._idleDimId = null; }

            this._idleDimId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
                this._idleDimId = null;
                if (this._titleScroll) this._titleScroll._checkResize();
                if (this._artistScroll) this._artistScroll._checkResize();

                if (this._isActiveState && this._settings.get_boolean('pill-dynamic-width')
                    && !this._isSidePanel && !this._settings.get_boolean('hide-text')) {
                    let titleW = this._titleScroll._label1.get_preferred_width(-1)[1];
                    let artistW = this._artistScroll.visible
                        ? this._artistScroll._label1.get_preferred_width(-1)[1] : 0;
                    let textW = Math.max(titleW, artistW) + 12;

                    let elementsW = this._padX * 2;
                    let confWidth = this._inPanel
                        ? this._settings.get_int('panel-pill-width')
                        : this._settings.get_int('pill-width');
                    let finalArtSize = this._artBin.visible ? this._artBin.width : 0;
                    let visStyle = this._settings.get_int('visualizer-style');
                    let sideMargin = this._settings.get_int('visualizer-padding');

                    if (finalArtSize > 0) {
                        let artM = (visStyle === 0 || !this._visBin.visible) ? 8 : sideMargin;
                        elementsW += finalArtSize + artM;
                    }
                    if (this._tabletControls.visible)
                        elementsW += this._tabletControls.get_preferred_width(-1)[1];
                    if (this._visBin.visible)
                        elementsW += this._visBin.get_preferred_width(-1)[1] + sideMargin;

                    elementsW += textW;
                    let isLyric = (this._lyricObj && this._lyricObj.content);
                    let monitor = Main.layoutManager.findMonitorForActor(this);
                    let maxAvailableW = monitor ? monitor.width - 40 : 800;

                    let newTarget;
                    if (isLyric) {
                        newTarget = Math.min(confWidth, maxAvailableW);
                    } else {
                        newTarget = Math.min(Math.max(elementsW, 120), confWidth);
                        newTarget = Math.min(newTarget, maxAvailableW);
                    }

                    if (Math.abs(newTarget - this._targetWidth) > 10) {
                        this._targetWidth = newTarget;
                        this._body.ease({
                            width: newTarget,
                            duration: 300,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD
                        });
                    }
                }

            });

            if (!this._isActiveState) {
                this.visible = false;
                this.set_width(0);
                return;
            }

            this.visible = true;
        }

        _animateSlide(offset) {
            if (!this._body) return;
            this._body.ease({
                translation_x: offset, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: (isFinished) => {
                    if (isFinished && this._body) {
                        this._body.ease({ translation_x: 0, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_BACK });
                    }
                }
            });
        }

        setLyric(lyricObj) {
            let wasActive = !!(this._lyricObj && this._lyricObj.content);
            this._lyricObj = lyricObj;
            let isActive = !!(this._lyricObj && this._lyricObj.content);

            if (!this._isActiveState) return;
            this._updateTextDisplay(true);

            if (wasActive !== isActive) {
                this._updateDimensions();
            }
        }

        updateDisplay(title, artist, artUrl, status, busName, isSkipActive, player = null) {
            if (!this.get_parent()) return;

            let statusChanged = this._currentStatus !== status;
            let busChanged = this._currentBusName !== busName;
            let titleChanged = this._origTitle !== title;
            let artistChanged = this._origArtist !== artist;
            let artChanged = this._lastArtUrl !== artUrl;

            let forceUpdate = busChanged;
            let contentChanged = forceUpdate || statusChanged || titleChanged || artistChanged || artChanged;

            if (!contentChanged && this._isActiveState && this.opacity > 0) {
                this._updatePlayingStates();

                if (this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
                    if (player) this._controller._expandedPlayer.setPlayer(player);
                    this._controller._expandedPlayer.updateContent(title, artist, artUrl, status);
                }
                return;
            }

            this._currentStatus = status;

            if (this._playPauseBtnTablet) {
                let icon = this._playPauseBtnTablet.get_child();
                if (icon) {
                    icon.icon_name = (status === 'Playing')
                        ? 'media-playback-pause-symbolic'
                        : 'media-playback-start-symbolic';
                }
            }


            if (busChanged) {
                this._currentBusName = busName;
                this._lastTitle = null;
                this._lastArtist = null;
                this._lastArtUrl = null;
                this._origTitle = null;
                this._origArtist = null;
                this._lyricObj = null;
                if (this._hideGraceTimer) {
                    GLib.Source.remove(this._hideGraceTimer);
                    this._hideGraceTimer = null;
                }
            }

            if (!title || status === 'Stopped') {
                if (isSkipActive) return;

                this._lyricObj = null;
                let tempTitle = title || this._origTitle;
                let tempArtist = artist || this._origArtist;

                let anyPlaying = false;
                if (this._controller && this._controller._proxies) {
                    for (let p of this._controller._proxies.values()) {
                        if (p.PlaybackStatus === 'Playing') {
                            anyPlaying = true;
                            break;
                        }
                    }
                }

                let alwaysShow = this._settings.get_boolean('always-show-pill');

                let manualBus = this._settings.get_string('selected-player-bus');
                let isManuallySelected = (manualBus !== '' && busName === manualBus);

                let shouldKeepOpen = alwaysShow || anyPlaying || isManuallySelected;

                if (shouldKeepOpen && (!tempTitle || tempTitle === '')) {
                    tempTitle = _('No Media');
                    tempArtist = _('Waiting for playback...');

                    this._targetColor = { r: 40, g: 40, b: 40 };
                    this._lastArtUrl = null;
                }

                if (this._titleScroll) this._titleScroll.setText(tempTitle || '', true, 0);
                if (this._artistScroll) this._artistScroll.setText(tempArtist || '', true);

                if (shouldKeepOpen) {
                    this._origTitle = tempTitle;
                    this._origArtist = tempArtist;

                    if (this._hideGraceTimer) {
                        GLib.Source.remove(this._hideGraceTimer);
                        this._hideGraceTimer = null;
                    }

                    this._currentStatus = 'Stopped';
                    this._updatePlayingStates();

                    this._updateDimensions();

                    if (!this._isActiveState || this.opacity === 0 || this.width <= 1) {
                        this._isActiveState = true;
                        this.reactive = true;
                        this.visible = true;

                        this._updateDimensions();
                        let finalWidth = this._targetWidth;
                        let finalHeight = this._targetHeight;

                        this.set_width(-1);
                        if (this._isSidePanel) {
                            this._body.set_height(0);
                            this._body.set_width(finalWidth);
                        } else {
                            this._body.set_width(0);
                            this._body.set_height(finalHeight);
                        }

                        this.opacity = 0;
                        this.ease({ opacity: 255, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                        this._body.ease({ width: finalWidth, height: finalHeight, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                    }

                    if (forceUpdate || artUrl !== this._lastArtUrl || titleChanged) {
                        this._lastArtUrl = artUrl;
                        if (artUrl) {
                            if (this._artDebounceTimer) {
                                GLib.Source.remove(this._artDebounceTimer);
                                this._artDebounceTimer = null;
                            }
                            if (this._settings.get_boolean('show-album-art')) {
                                this._artBin.show();
                                this._artBin.opacity = 255;
                            } else {
                                this._artBin.hide();
                            }
                            this._artWidget.setArt(artUrl, true);
                            this._loadColorFromArt(artUrl);
                        } else {
                            this._updateArtVisibility();
                            this._startColorTransition();
                        }
                    } else {
                        this._startColorTransition();
                    }

                    if (this._controller && this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
                        this._controller._expandedPlayer.updateContent(this._origTitle, this._origArtist, this._lastArtUrl, 'Stopped');
                    }
                    return;
                }

                if (!this._hideGraceTimer && this._isActiveState) {
                    this._hideGraceTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                        if (!this || (this.is_finalized && this.is_finalized())) {
                            this._hideGraceTimer = null;
                            return GLib.SOURCE_REMOVE;
                        }
                        if (!this.get_parent()) return GLib.SOURCE_REMOVE;

                        this._isActiveState = false;
                        this.reactive = false;

                        let targetW = this._isSidePanel ? this._body.width : 0;
                        let targetH = this._isSidePanel ? 0 : this._body.height;

                        this.ease({ opacity: 0, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

                        this._body.ease({
                            width: targetW,
                            height: targetH,
                            duration: 500,
                            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                            onStopped: (isFinished) => {
                                if (!isFinished) return;
                                this._lastTitle = null;
                                this._lastArtist = null;
                                this._lastArtUrl = null;
                                this._currentBusName = null;
                                this.set_width(0);
                                this.visible = false;
                            }
                        });

                        this._visualizer.setPlaying(false);
                        this._hideGraceTimer = null;
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return;
            }

            if (this._hideGraceTimer) {
                GLib.Source.remove(this._hideGraceTimer);
                this._hideGraceTimer = null;
            }

            let origTitle = title;
            let origArtist = artist;
            this._origTitle = origTitle;
            this._origArtist = origArtist;
            this._updateTextDisplay(forceUpdate);

            if (!this._isActiveState || this.opacity === 0 || this.width <= 1) {
                this._isActiveState = true;
                this.reactive = true;
                this.visible = true;

                this._updateDimensions();
                let finalWidth = this._targetWidth;
                let finalHeight = this._targetHeight;

                this.set_width(-1);

                if (this._isSidePanel) {
                    this._body.set_height(0);
                    this._body.set_width(finalWidth);
                } else {
                    this._body.set_width(0);
                    this._body.set_height(finalHeight);
                }

                this.opacity = 0;
                this.ease({ opacity: 255, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                this._body.ease({ width: finalWidth, height: finalHeight, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            } else {
                this._updateDimensions();
            }

            this._updatePlayingStates();

            if (forceUpdate || artUrl !== this._lastArtUrl || titleChanged) {
                this._lastArtUrl = artUrl;

                if (artUrl) {
                    if (this._artDebounceTimer) {
                        GLib.Source.remove(this._artDebounceTimer);
                        this._artDebounceTimer = null;
                    }

                    if (this._settings.get_boolean('show-album-art')) {
                        this._artBin.show();
                        this._artBin.opacity = 255;
                    } else {
                        this._artBin.hide();
                    }

                    this._artWidget.setArt(artUrl, true);
                    this._loadColorFromArt(artUrl);
                } else {
                    this._updateArtVisibility();
                }
            } else if (statusChanged) {
                this._startColorTransition();
            }

            if (this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
                if (player) {
                    this._controller._expandedPlayer.setPlayer(player);
                }
                this._controller._expandedPlayer.updateContent(origTitle, origArtist, this._lastArtUrl, this._currentStatus);
            }
        }

        _updateTextDisplay(forceUpdate = false) {
            let t = this._origTitle;
            let a = this._origArtist;
            let lyricTime = 0;

            let isSqueezed = (this._inPanel && this._settings.get_int('panel-pill-height') < 30) || (!this._inPanel && this._settings.get_int('pill-height') < 46);
            if (this._settings.get_boolean('inline-artist') && isSqueezed && a && t) {
                t = `${t} • ${a}`;
                a = null;
            }

            if (this._lyricObj && this._lyricObj.content) {
                t = this._lyricObj.content;
                lyricTime = this._lyricObj.time || 0;
            }

            if (this._lastTitle !== t || this._lastArtist !== a || forceUpdate) {
                if (this._titleScroll) this._titleScroll.setText(t || _('Loading...'), forceUpdate, lyricTime);
                if (this._artistScroll) this._artistScroll.setText(a || '', forceUpdate);
                this._lastTitle = t;
                this._lastArtist = a;
            }
        }

        _loadColorFromArt(artUrl) {
            let file = Gio.File.new_for_uri(artUrl);
            if (!this._cancellable) this._cancellable = new Gio.Cancellable();

            file.load_contents_async(this._cancellable, (f, res) => {
                try {
                    let [ok, bytes] = f.load_contents_finish(res);
                    if (ok && this._visualizer) {
                        let stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                        let pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
                        this._targetColor = getAverageColor(pixbuf);

                        if (this._controller && this._controller._trackHistory && this._controller._trackHistory.length > 0) {
                            let entry = this._controller._trackHistory[0];
                            if (!entry.avgColor) {
                                entry.avgColor = { r: Math.round(this._targetColor.r), g: Math.round(this._targetColor.g), b: Math.round(this._targetColor.b) };
                                try { this._controller._settings.set_string('playback-history', JSON.stringify(this._controller._trackHistory)); } catch (e) { }
                            }
                        }

                        try {
                            if (this._interfaceSettings && this._settings.get_boolean('sync-accent-color')) {
                                let closestAccent = getClosestGnomeAccent(this._targetColor.r, this._targetColor.g, this._targetColor.b);
                                this._interfaceSettings.set_string('accent-color', closestAccent);
                            }
                        } catch (err) {
                            console.debug('[Dynamic Music Pill] Native accent sync failed: ', err.message);
                        }

                        if (this._visualizer && this._visualizer.setColor) {
                            this._visualizer.setColor(this._targetColor);
                            this._startColorTransition();
                        }
                    }
                } catch (e) {
                    if (!e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED)) {
                        console.debug('Failed to load art color: ' + e.message);
                    }
                }
            });
        }

        _startColorTransition() {
            if (this._colorAnimId) { GLib.Source.remove(this._colorAnimId); this._colorAnimId = null; }
            let base = this._targetColor;
            let factor = (this._currentStatus === 'Playing') ? 0.6 : 0.4;
            let targetR = Math.floor(base.r * factor);
            let targetG = Math.floor(base.g * factor);
            let targetB = Math.floor(base.b * factor);

            let targetBorderOp = (this._currentStatus === 'Playing') ? 0.2 : 0.1;
            let startBorderOp = (typeof this._currentBorderOp === 'number') ? this._currentBorderOp : targetBorderOp;

            let startR = this._displayedColor.r;
            let startG = this._displayedColor.g;
            let startB = this._displayedColor.b;
            let steps = 60; let count = 0;
            this._colorAnimId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
                if (!this || (this.is_finalized && this.is_finalized())) {
                    this._colorAnimId = null;
                    return GLib.SOURCE_REMOVE;
                }
                if (!this.get_parent()) return GLib.SOURCE_REMOVE;
                count++;
                let progress = count / steps;
                let t = progress * progress * (3 - 2 * progress);
                let r = Math.floor(startR + (targetR - startR) * t);
                let g = Math.floor(startG + (targetG - startG) * t);
                let b = Math.floor(startB + (targetB - startB) * t);
                this._currentBorderOp = startBorderOp + (targetBorderOp - startBorderOp) * t;
                this._applyStyle(r, g, b);
                if (count >= steps) { this._displayedColor = { r: targetR, g: targetG, b: targetB }; this._currentBorderOp = targetBorderOp; this._colorAnimId = null; return GLib.SOURCE_REMOVE; }
                return GLib.SOURCE_CONTINUE;
            });
        }

        _applyStyle(r, g, b) {
            let dynR = r, dynG = g, dynB = b;

            let safeDynR = (typeof dynR === 'number' && !isNaN(dynR)) ? Math.floor(dynR) : 40;
            let safeDynG = (typeof dynG === 'number' && !isNaN(dynG)) ? Math.floor(dynG) : 40;
            let safeDynB = (typeof dynB === 'number' && !isNaN(dynB)) ? Math.floor(dynB) : 40;

            if (this._settings.get_boolean('use-custom-colors')) {
                let customBg = this._settings.get_string('custom-bg-color').split(',');
                r = parseInt(customBg[0]) || 40;
                g = parseInt(customBg[1]) || 40;
                b = parseInt(customBg[2]) || 40;
            }
            if (!this._body || !this._body.get_parent()) return;

            let alpha = (typeof this._currentBgAlpha === 'number' && !isNaN(this._currentBgAlpha)) ? this._currentBgAlpha : 1.0;

            let safeR = (typeof r === 'number' && !isNaN(r)) ? Math.floor(r) : 40;
            let safeG = (typeof g === 'number' && !isNaN(g)) ? Math.floor(g) : 40;
            let safeB = (typeof b === 'number' && !isNaN(b)) ? Math.floor(b) : 40;

            let safePadY = (typeof this._padY === 'number' && !isNaN(this._padY)) ? Math.floor(this._padY) : 6;
            let safePadX = (typeof this._padX === 'number' && !isNaN(this._padX)) ? Math.floor(this._padX) : 14;
            let safeRadius = (typeof this._radius === 'number' && !isNaN(this._radius)) ? Math.floor(this._radius) : 28;

            let bgStyle = `background-color: rgba(${safeR}, ${safeG}, ${safeB}, ${alpha});`;

            let borderStyle = '';
            if (this._settings.get_boolean('show-pill-border')) {
                let borderOp = (typeof this._currentBorderOp === 'number') ? this._currentBorderOp : ((this._currentStatus === 'Playing') ? 0.2 : 0.1);
                borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255, 255, 255, ${borderOp});`;
            } else {
                borderStyle = `border-width: 0px; border-color: transparent;`;
            }

            let paddingStyle = `padding: ${safePadY}px ${safePadX}px;`;

            let radiusStyle = `border-radius: ${safeRadius}px;`;
            let shadow = this._shadowCSS ? this._shadowCSS : 'box-shadow: none;';

            let css = `${bgStyle} ${borderStyle} ${paddingStyle} ${radiusStyle} ${shadow}`;

            if (this._lastBodyCss !== css) {
                this._lastBodyCss = css;
                this._body.set_style(css);
            }
            this._displayedColor = { r: safeDynR, g: safeDynG, b: safeDynB };

            if (this._controller && this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
                if (this._controller._expandedPlayer.updateStyle) {
                    this._controller._expandedPlayer.updateStyle(safeDynR, safeDynG, safeDynB, alpha);
                }
            }
        }
    });

