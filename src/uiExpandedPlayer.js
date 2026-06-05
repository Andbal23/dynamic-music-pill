import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { formatTime, smartUnpack, disableDashToDockAutohide, restoreDashToDockAutohide, getPlayerIcon } from './utils.js';
import { COPY_ICON_RESET_DELAY, COPY_ICON_FADE_IN_DURATION, COPY_ICON_FADE_OUT_DURATION, SUBPAGE_ANIM_IN_DURATION, SUBPAGE_ANIM_OUT_DURATION, SUBPAGE_BACK_BTN_WIDTH, SUBPAGE_HEADER_ICON_SIZE } from './constants.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { PixelSnappedBox, ScrollLabel, _addBtnPressAnim } from './uiWidgets.js';
import { WaveformVisualizer } from './uiVisualizers.js';
import { LyricsClient } from './LyricsClient.js';
import { LyricsWidget } from './uiLyricsWidget.js';

export const ExpandedPlayer = GObject.registerClass(
    class ExpandedPlayer extends St.Widget {
        _init(controller) {
            let [bgW, bgH] = global.display.get_size();

            super._init({
                width: bgW,
                height: bgH,
                reactive: true,
                visible: false,
                x: 0,
                y: 0
            });

            this._controller = controller;
            this._settings = controller._settings;
            this._player = null;
            this._updateTimer = null;
            this._seekLockTime = 0;
            this._currentArtUrl = null;
            this._lastPopupCss = null;
            this._isSpinning = false;

            this._backgroundBtn = new St.Button({
                style: 'background-color: transparent; border: none; box-shadow: none;',
                reactive: true,
                x_expand: true,
                y_expand: true,
                width: bgW,
                height: bgH
            });
            this._backgroundBtn.connectObject('clicked', () => { this.hide(); }, this);
            this._backgroundBtn.connectObject('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_END) { this.hide(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._backgroundBtn.connectObject('button-release-event', (actor, event) => {
                if (event.get_button() === 8) {
                    if (this._currentSubPage) this._popPage();
                    else this.hide();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this.connectObject('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) {
                    if (this._currentSubPage) this._popPage();
                    else this.hide();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this.add_child(this._backgroundBtn);

            this._box = new St.Widget({
                style_class: 'music-pill-expanded',
                style: 'background-color: transparent; border: none; box-shadow: none;',
                reactive: true,
                x_expand: false,
                y_expand: false,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.START
            });

            this._box.connect('notify::allocation', () => {
                let box = this._box.get_allocation_box();
                let w = box.get_width();
                let h = box.get_height();
                if (this._mainPage) {
                    this._mainPage.set_size(w, h);
                }
                if (this._currentSubPage) {
                    this._currentSubPage.set_size(w, h);
                }
            });
            const _boxEventOverHint = (event) => {
                if (!this._firstHintBox || !this._firstHintBox.visible) return false;
                let [hx, hy] = this._firstHintBox.get_transformed_position();
                let [hw, hh] = this._firstHintBox.get_transformed_size();
                let [ex, ey] = event.get_coords();
                return ex >= hx && ex <= hx + hw && ey >= hy && ey <= hy + hh;
            };
            this._box.connectObject('button-press-event', (actor, event) => {
                if (_boxEventOverHint(event)) return Clutter.EVENT_PROPAGATE;
                return Clutter.EVENT_STOP;
            }, this);
            this._box.connectObject('button-release-event', (actor, event) => {
                if (_boxEventOverHint(event)) return Clutter.EVENT_PROPAGATE;
                if (event.get_button() === 8) {
                    if (this._currentSubPage) this._popPage();
                    else this.hide();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_STOP;
            }, this);
            this._leaveHideTimeoutId = null;

            this._box.connectObject('touch-event', (actor, event) => {
                if (!this._firstHintBox || !this._firstHintBox.visible) return Clutter.EVENT_STOP;
                let [hx, hy] = this._firstHintBox.get_transformed_position();
                let [hw, hh] = this._firstHintBox.get_transformed_size();
                let [ex, ey] = event.get_coords();
                if (ex >= hx && ex <= hx + hw && ey >= hy && ey <= hy + hh) return Clutter.EVENT_PROPAGATE;
                return Clutter.EVENT_STOP;
            }, this);
            this._box.connectObject('scroll-event', (actor, event) => {
                let dir = event.get_scroll_direction();
                let doBack = false;
                if (dir === Clutter.ScrollDirection.SMOOTH) {
                    let [dx, dy] = event.get_scroll_delta();
                    if (Math.abs(dx) > Math.abs(dy) && dx > 0.3) doBack = true;
                } else if (dir === Clutter.ScrollDirection.RIGHT) {
                    doBack = true;
                }
                if (doBack) {
                    if (this._currentSubPage) this._popPage();
                    else this.hide();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._currentSubPage = null;
            this.add_child(this._box);

            this._mainPage = new St.BoxLayout({ 
                vertical: true, 
                style: 'padding: 20px;'
            });
            this._box.add_child(this._mainPage);

            this._playerSelectorBox = new PixelSnappedBox({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                style: 'margin-bottom: 12px; spacing: 10px;'
            });
            this._mainPage.add_child(this._playerSelectorBox);

            this._settings.connectObject('changed::popup-show-player-selector', () => {
                this._updatePlayerSelector();
                if (this.visible) this.animateResize();
            }, this);

            let topRow = new PixelSnappedBox({ style_class: 'expanded-top-row', vertical: false, y_align: Clutter.ActorAlign.CENTER, x_expand: true });

            this._vinyl = new St.Widget({
                style_class: 'vinyl-container',
                layout_manager: new Clutter.BinLayout(),
                width: 100,
                height: 100
            });
            this._vinyl.set_pivot_point(0.5, 0.5);

            this._vinylBin = new St.Bin({
                child: this._vinyl,
                width: 100,
                height: 100,
                x_expand: false,
                y_expand: false,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.CENTER
            });
            topRow.add_child(this._vinylBin);

            this._vinylBin.reactive = true;
            this._vinylBin.track_hover = true;
            this._vinyl.reactive = true;

            this._vinylBin.connectObject('enter-event', () => {
                this._vinyl.ease({ opacity: 175, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._vinylBin.connectObject('leave-event', () => {
                this._vinyl.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._vinylBin.connectObject('button-release-event', (actor, event) => {
                if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
                if (this._currentSubPage) { this._popPage(); return Clutter.EVENT_STOP; }
                this._showLyricsPage();
                return Clutter.EVENT_STOP;
            }, this);
            this._vinylBin.connectObject('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_END) {
                    if (this._currentSubPage) { this._popPage(); return Clutter.EVENT_STOP; }
                    this._showLyricsPage();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            let infoBox = new PixelSnappedBox({
                style_class: 'track-info-box',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                x_expand: true,
                clip_to_allocation: true,
                style: 'min-width: 0px; margin-left: 15px;'
            });
            infoBox.layout_manager.orientation = Clutter.Orientation.VERTICAL;

            this._titleLabel = new ScrollLabel('expanded-title', this._settings);
            this._titleLabel.setForceScroll(true);
            this._artistLabel = new ScrollLabel('expanded-artist', this._settings);
            this._artistLabel.setForceScroll(true);

            this._visualizer = new WaveformVisualizer(80, this._settings, true);

            this._visBin = new St.Bin({
                child: this._visualizer,
                x_expand: false,
                x_align: Clutter.ActorAlign.END,
                y_align: Clutter.ActorAlign.CENTER
            });

            infoBox.add_child(this._titleLabel);
            infoBox.add_child(this._artistLabel);

            topRow.add_child(infoBox);
            topRow.add_child(this._visBin);

            this._mainPage.add_child(topRow);

            let progressBox = new PixelSnappedBox({ style_class: 'progress-container', vertical: false, y_align: Clutter.ActorAlign.CENTER });

            this._currentTimeLabel = new St.Label({
                style_class: 'progress-time',
                text: '0:00',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.START,
                style: 'text-align: left; margin-right: 0px;'
            });

            this._totalTimeLabel = new St.Label({
                style_class: 'progress-time',
                text: '0:00',
                y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.END,
                style: 'text-align: right;'
            });

            this._sliderBin = new St.Widget({
                style_class: 'progress-slider-bg',
                x_expand: true,
                reactive: true,
                y_align: Clutter.ActorAlign.CENTER
            });
            this._sliderBin.set_style('margin: 0; padding: 0;');

            this._sliderFill = new St.Widget({ style_class: 'progress-slider-fill' });
            this._sliderFill.set_position(0, 0);
            this._sliderBin.add_child(this._sliderFill);

            this._sliderBin.connectObject('button-release-event', (actor, event) => {
                if (event.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                this._handleSeek(event);
                return Clutter.EVENT_STOP;
            }, this);

            this._sliderBin.connectObject('touch-event', (actor, event) => {
                if (event.type() === Clutter.EventType.TOUCH_END) {
                    this._handleSeek(event);
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            progressBox.add_child(this._currentTimeLabel);
            progressBox.add_child(this._sliderBin);
            progressBox.add_child(this._totalTimeLabel);
            this._mainPage.add_child(progressBox);

            let controlsRow = new PixelSnappedBox({ style_class: 'controls-row', vertical: false, x_align: Clutter.ActorAlign.CENTER, reactive: true });

            this._shuffleIcon = new St.Icon({ icon_name: 'media-playlist-shuffle-symbolic', icon_size: 16 });
            this._shuffleBtn = new St.Button({ style_class: 'control-btn-secondary', child: this._shuffleIcon, reactive: true, can_focus: true });
            _addBtnPressAnim(this._shuffleBtn);
            this._shuffleBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; this._controller.toggleShuffle(); return Clutter.EVENT_STOP; }, this);
            this._shuffleBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.toggleShuffle(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

            this._prevBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 24 }), reactive: true, can_focus: true });
            _addBtnPressAnim(this._prevBtn);
            this._prevBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; this._controller.previous(); return Clutter.EVENT_STOP; }, this);
            this._prevBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.previous(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

            this._playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 24 });
            this._playPauseBtn = new St.Button({ style_class: 'control-btn', child: this._playPauseIcon, reactive: true, can_focus: true });
            _addBtnPressAnim(this._playPauseBtn);
            this._playPauseBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; this._controller.togglePlayback(); return Clutter.EVENT_STOP; }, this);
            this._playPauseBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.togglePlayback(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

            this._nextBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 24 }), reactive: true, can_focus: true });
            _addBtnPressAnim(this._nextBtn);
            this._nextBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; this._controller.next(); return Clutter.EVENT_STOP; }, this);
            this._nextBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.next(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

            this._repeatIcon = new St.Icon({ icon_name: 'media-playlist-repeat-symbolic', icon_size: 16 });
            this._repeatBtn = new St.Button({ style_class: 'control-btn-secondary', child: this._repeatIcon, reactive: true, can_focus: true });
            _addBtnPressAnim(this._repeatBtn);
            this._repeatBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; this._controller.toggleLoop(); return Clutter.EVENT_STOP; }, this);
            this._repeatBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.toggleLoop(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

            this._customBtn1 = new St.Button({
                style_class: 'control-btn-secondary',
                child: new St.Icon({ icon_name: 'view-more-symbolic', icon_size: 16 }),
                reactive: true,
                can_focus: true,
                visible: false
            });
            _addBtnPressAnim(this._customBtn1);
            this._customBtn2 = new St.Button({
                style_class: 'control-btn-secondary',
                child: new St.Icon({ icon_name: 'view-more-symbolic', icon_size: 16 }),
                reactive: true,
                can_focus: true,
                visible: false
            });
            _addBtnPressAnim(this._customBtn2);


            const _makeCustomBtnHandler = (getActionFn, isBtn1) => {
                return (actor, event) => {
                    if (event.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                    let action = getActionFn();
                    if (action === 'seek_step' && this._bothButtonsAreSeekStep()) {

                        this._controller.seekStep(!isBtn1);
                    } else {
                        this._openCustomAction(action, null);
                    }
                    return Clutter.EVENT_STOP;
                };
            };

            const _makeCustomBtnTouchHandler = (getActionFn, isBtn1) => {
                return (actor, event) => {
                    if (event.type() === Clutter.EventType.TOUCH_END) {
                        let action = getActionFn();
                        if (action === 'seek_step' && this._bothButtonsAreSeekStep()) {
                            this._controller.seekStep(!isBtn1);
                        } else {
                            this._openCustomAction(action, null);
                        }
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                };
            };

            this._customBtn1.connectObject('button-release-event',
                _makeCustomBtnHandler(() => this._settings.get_string('custom-button-1'), true), this);
            this._customBtn1.connectObject('touch-event',
                _makeCustomBtnTouchHandler(() => this._settings.get_string('custom-button-1'), true), this);

            this._customBtn2.connectObject('button-release-event',
                _makeCustomBtnHandler(() => this._settings.get_string('custom-button-2'), false), this);
            this._customBtn2.connectObject('touch-event',
                _makeCustomBtnTouchHandler(() => this._settings.get_string('custom-button-2'), false), this);


            controlsRow.add_child(this._shuffleBtn);
            controlsRow.add_child(this._customBtn1);
            controlsRow.add_child(this._prevBtn);
            controlsRow.add_child(this._playPauseBtn);
            controlsRow.add_child(this._nextBtn);
            controlsRow.add_child(this._customBtn2);
            controlsRow.add_child(this._repeatBtn);

            this._settings.connectObject('changed::popup-show-album-title', () => {
                if (this.visible && this._player) {
                    let m = this._player.Metadata;
                    let title = m ? smartUnpack(m['xesam:title']) : null;
                    let artist = m ? smartUnpack(m['xesam:artist']) : null;
                    if (Array.isArray(artist)) artist = artist.join(', ');
                    let artUrl = this._currentArtUrl;
                    this.updateContent(title, artist, artUrl, this._lastStatus);
                }
            }, this);
            this._settings.connectObject('changed::enable-custom-buttons', () => this._updateCustomButtons(), this);
            this._settings.connectObject('changed::custom-button-1', () => this._updateCustomButtons(), this);
            this._settings.connectObject('changed::custom-button-2', () => this._updateCustomButtons(), this);

            this._mainPage.add_child(controlsRow);

            this._firstHintBox = new St.BoxLayout({
                vertical: false,
                x_expand: true,
                reactive: true,
                track_hover: true,
                style: 'spacing: 8px; margin-top: 12px; padding: 8px 10px; border-radius: 10px; background-color: rgba(255,255,255,0.08);',
                y_align: Clutter.ActorAlign.CENTER
            });
            this._firstHintLabelBtn = new St.Button({
                child: new St.Label({
                    text: _('First time? Check settings for custom buttons, scroll actions & more'),
                    style: 'font-size: 9pt; color: rgba(255,255,255,0.85);'
                }),
                x_expand: true,
                reactive: true,
                style: 'border: none; background-color: transparent; padding: 0; min-width: 0;',
                y_align: Clutter.ActorAlign.CENTER
            });
            this._firstHintSettingsBtn = new St.Button({
                child: new St.Icon({ icon_name: 'preferences-system-symbolic', icon_size: 18 }),
                style_class: 'control-btn-secondary',
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER
            });
            this._firstHintCloseBtn = new St.Button({
                child: new St.Icon({ icon_name: 'window-close-symbolic', icon_size: 16 }),
                style_class: 'control-btn-secondary',
                reactive: true,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER
            });
            _addBtnPressAnim(this._firstHintSettingsBtn);
            _addBtnPressAnim(this._firstHintCloseBtn);
            const _dismissHint = (openSettings) => {
                this._settings.set_boolean('has-seen-first-hint', true);
                this._firstHintBox.hide();
                if (openSettings) {
                    this.hide();
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                        this._controller.openSettings();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            };
            this._firstHintBox.add_child(this._firstHintLabelBtn);
            this._firstHintBox.add_child(this._firstHintSettingsBtn);
            this._firstHintBox.add_child(this._firstHintCloseBtn);
            this._firstHintLabelBtn.connectObject('clicked', () => _dismissHint(false), this);
            this._firstHintLabelBtn.connectObject('button-release-event', (a, e) => {
                if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                _dismissHint(false);
                return Clutter.EVENT_STOP;
            }, this);
            this._firstHintLabelBtn.connectObject('touch-event', (a, e) => {
                if (e.type() === Clutter.EventType.TOUCH_END) { _dismissHint(false); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._firstHintSettingsBtn.connectObject('clicked', () => _dismissHint(true), this);
            this._firstHintSettingsBtn.connectObject('button-release-event', (a, e) => {
                if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                _dismissHint(true);
                return Clutter.EVENT_STOP;
            }, this);
            this._firstHintSettingsBtn.connectObject('touch-event', (a, e) => {
                if (e.type() === Clutter.EventType.TOUCH_END) { _dismissHint(true); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._firstHintCloseBtn.connectObject('clicked', () => _dismissHint(false), this);
            this._firstHintCloseBtn.connectObject('button-release-event', (a, e) => {
                if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                _dismissHint(false);
                return Clutter.EVENT_STOP;
            }, this);
            this._firstHintCloseBtn.connectObject('touch-event', (a, e) => {
                if (e.type() === Clutter.EventType.TOUCH_END) { _dismissHint(false); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._mainPage.add_child(this._firstHintBox);

            this._box.connectObject('enter-event', () => {
                if (this._leaveHideTimeoutId) {
                    GLib.Source.remove(this._leaveHideTimeoutId);
                    this._leaveHideTimeoutId = null;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this._box.connectObject('leave-event', () => {
                if (this._settings.get_boolean('popup-hide-on-leave')) {
                    if (this._leaveHideTimeoutId) GLib.Source.remove(this._leaveHideTimeoutId);
                    this._leaveHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                        this._leaveHideTimeoutId = null;
                        this.hide();
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this.connect('destroy', this._cleanup.bind(this));
        }

        _updatePlayerSelector() {
            if (!this._settings.get_boolean('popup-show-player-selector')) {
                this._playerSelectorBox.hide();
                return;
            }
            this._playerSelectorBox.show();
            this._playerSelectorBox.destroy_all_children();

            let currentSelected = this._settings.get_string('selected-player-bus');

            let autoIcon = new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 20 });
            let autoBtn = new St.Button({
                child: autoIcon,
                reactive: true,
                can_focus: true,
                track_hover: true,
                style: `border-radius: 12px; padding: 8px; background-color: ${currentSelected === '' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`
            });

            autoBtn.connectObject('button-release-event', (a, e) => {
                if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                this._settings.set_string('selected-player-bus', '');
                this._controller._updateUI();
                this._updatePlayerSelector();
                return Clutter.EVENT_STOP;
            }, this);
            autoBtn.connectObject('touch-event', (actor, event) => {
                let type = event.type();
                if (type === Clutter.EventType.TOUCH_BEGIN) {
                    return Clutter.EVENT_PROPAGATE;
                }
                if (type === Clutter.EventType.TOUCH_END) {
                    this._settings.set_string('selected-player-bus', '');
                    this._controller._updateUI();
                    this._updatePlayerSelector();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            autoBtn.connect('notify::hover', () => {
                if (this._settings.get_string('selected-player-bus') === '') return;
                autoBtn.set_style(`border-radius: 12px; padding: 8px; background-color: ${autoBtn.hover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`);
            });
            this._playerSelectorBox.add_child(autoBtn);

            for (let [busName, proxy] of this._controller._proxies) {
                let isSelected = (currentSelected === busName);

                let icon = new St.Icon({
                    gicon: proxy._gicon || getPlayerIcon(proxy, busName),
                    fallback_icon_name: 'audio-x-generic-symbolic',
                    icon_size: 20
                });

                let btn = new St.Button({
                    child: icon,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    style: `border-radius: 12px; padding: 8px; background-color: ${isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`
                });

                btn.connectObject('button-release-event', (a, e) => {
                    if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                    this._settings.set_string('selected-player-bus', busName);
                    this._controller._updateUI();
                    this._updatePlayerSelector();
                    return Clutter.EVENT_STOP;
                }, this);
                btn.connectObject('touch-event', (actor, event) => {
                    let type = event.type();
                    if (type === Clutter.EventType.TOUCH_BEGIN) {
                        return Clutter.EVENT_PROPAGATE;
                    }
                    if (type === Clutter.EventType.TOUCH_END) {
                        this._settings.set_string('selected-player-bus', busName);
                        this._controller._updateUI();
                        this._updatePlayerSelector();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, this);

                btn.connect('notify::hover', () => {
                    if (this._settings.get_string('selected-player-bus') === busName) return;
                    btn.set_style(`border-radius: 12px; padding: 8px; background-color: ${btn.hover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`);
                });

                this._playerSelectorBox.add_child(btn);
            }
        }

        setPosition(x, y) {
            if (this._box) this._box.set_position(x, y);
        }

        setPlayer(player) {
            if (this._player !== player) {
                this._player = player;
            }
        }

        updateStyle(r, g, b, alpha) {
            if (!this._box) return;

            let useShadow = this._settings.get_boolean('popup-enable-shadow');
            let followTrans = this._settings.get_boolean('popup-follow-transparency');
            let followRadius = this._settings.get_boolean('popup-follow-radius');

            let rawRadius = followRadius ? this._settings.get_int('border-radius') : 24;
            let radius = (typeof rawRadius === 'number' && !isNaN(rawRadius)) ? rawRadius : 24;

            let finalAlpha = 0.95;
            let enableTrans = this._settings.get_boolean('enable-transparency');

            if (followTrans) {
                if (enableTrans) {
                    finalAlpha = this._settings.get_int('transparency-strength') / 100.0;
                } else {
                    finalAlpha = 1.0;
                }
            }

            let safeR = (typeof r === 'number' && !isNaN(r)) ? Math.floor(r) : 40;
            let safeG = (typeof g === 'number' && !isNaN(g)) ? Math.floor(g) : 40;
            let safeB = (typeof b === 'number' && !isNaN(b)) ? Math.floor(b) : 40;

            if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-bg')) {
                let customBg = this._settings.get_string('custom-bg-color').split(',');
                let rVal = parseInt(customBg[0]);
                safeR = (!isNaN(rVal)) ? rVal : 40;
                let gVal = parseInt(customBg[1]);
                safeG = (!isNaN(gVal)) ? gVal : 40;
                let bVal = parseInt(customBg[2]);
                safeB = (!isNaN(bVal)) ? bVal : 40;
            }

            let bgStyle = `background-color: rgba(${safeR}, ${safeG}, ${safeB}, ${finalAlpha});`;

            let shadowOp = 0;
            let shadowStyle = 'box-shadow: none;';

            let borderOp = Math.min(0.1, finalAlpha * 0.2);
            let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255,255,255,${borderOp});`;

            let minWLimit = this._computeMinControlsWidth();
            let css = `${bgStyle} ${borderStyle} border-radius: ${radius}px; ${shadowStyle} max-width: 600px;`;

            if (this._lastPopupCss !== css) {
                this._lastPopupCss = css;
                this._box.set_style(css);
            }

            if (this._vinylBin) this._vinylBin.opacity = 255;
            if (this._titleLabel) this._titleLabel.opacity = 255;
            if (this._artistLabel) this._artistLabel.opacity = 255;
            if (this._visualizer) { this._visualizer.setColor({ r: safeR, g: safeG, b: safeB }); }

            let fgR = 255, fgG = 255, fgB = 255;

            if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-text')) {
                let customTextStr = this._settings.get_string('custom-text-color').split(',');
                let rVal = parseInt(customTextStr[0]);
                fgR = (!isNaN(rVal)) ? rVal : 255;
                let gVal = parseInt(customTextStr[1]);
                fgG = (!isNaN(gVal)) ? gVal : 255;
                let bVal = parseInt(customTextStr[2]);
                fgB = (!isNaN(bVal)) ? bVal : 255;
            } else {
                let brightness = (safeR * 299 + safeG * 587 + safeB * 114) / 1000;
                if (brightness > 160) {
                    fgR = 30; fgG = 30; fgB = 30;
                }
            }

            let textColor = `rgb(${fgR}, ${fgG}, ${fgB})`;
            let textAlpha = `rgba(${fgR}, ${fgG}, ${fgB}, 0.7)`;
            let iconCss = `color: ${textColor};`;

            if (this._titleLabel) this._titleLabel.setLabelStyle(`color: ${textColor};`);
            if (this._artistLabel) this._artistLabel.setLabelStyle(`color: ${textAlpha};`);
            if (this._currentTimeLabel) this._currentTimeLabel.set_style(`color: ${textColor}; font-weight: bold;`);
            if (this._totalTimeLabel) this._totalTimeLabel.set_style(`color: ${textAlpha}; font-weight: bold;`);

            if (this._prevBtn) this._prevBtn.set_style(iconCss);
            if (this._playPauseBtn) this._playPauseBtn.set_style(iconCss);
            if (this._nextBtn) this._nextBtn.set_style(iconCss);
            if (this._shuffleBtn) this._shuffleBtn.set_style(iconCss);
            if (this._repeatBtn) this._repeatBtn.set_style(iconCss);
            if (this._customBtn1) this._customBtn1.set_style(iconCss);
            if (this._customBtn2) this._customBtn2.set_style(iconCss);

            if (this._sliderFill) this._sliderFill.set_style(`background-color: ${textColor};`);
            if (this._sliderBin) this._sliderBin.set_style(`background-color: rgba(${fgR}, ${fgG}, ${fgB}, 0.2);`);

        }

        updateContent(title, artist, artUrl, status) {
            if (this._titleLabel && this._titleLabel._text !== title) {
                this._titleLabel.setText(title || _('Unknown Title'), false);
            }

            let displayArtist = artist || _('Unknown Artist');
            if (this._settings.get_boolean('popup-show-album-title') && this._player) {
                let m = this._player.Metadata;
                let album = m ? smartUnpack(m['xesam:album']) : null;
                if (album) displayArtist = `${displayArtist}  •  ${album}`;
            }
            if (this._artistLabel && this._artistLabel._text !== displayArtist) {
                this._artistLabel.setText(displayArtist, false);
            }

            this._seekLockTime = 0;

            let trackChanged = (this._currentArtUrl !== artUrl || this._lastTrackTitle !== title);
            this._lastTrackTitle = title;
            if (trackChanged && this._player) {
                this._player._lastPosition = 0;
                this._player._lastPositionTime = Date.now();

                // Reset stale detection and seeker state for new track
                this._lastTickPosition = undefined;
                this._lastTickTime = undefined;
                this._lastPositionSync = 0;
                this._lastTickLength = 0;

                // Force slider to start and recalculate time label widths
                if (this._sliderFill) this._sliderFill.width = 6;
                if (this._currentTimeLabel) {
                    this._currentTimeLabel.text = '0:00';
                    this._currentTimeLabel.set_width(-1);
                }
                if (this._totalTimeLabel) {
                    this._totalTimeLabel.text = '0:00';
                    this._totalTimeLabel.set_width(-1);
                }
            }

            let showVinyl = this._settings.get_boolean('popup-show-vinyl');
            if (!artUrl || !showVinyl) {
                if (!this._artVisibilityTimer) {
                    this._artVisibilityTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                        this._artVisibilityTimer = null;
                        this._vinylBin.hide();
                        this._vinyl.hide();
                        this._stopVinyl();
                        this._currentArtUrl = null;

                        if (this._titleLabel && this._titleLabel.get_parent()) {
                            let infoBox = this._titleLabel.get_parent();
                            infoBox.x_expand = false;
                            infoBox.set_style('min-width: 0px; margin-left: 0px; margin-right: 15px;');

                            let topRow = infoBox.get_parent();
                            if (topRow) {
                                topRow.x_align = Clutter.ActorAlign.CENTER;
                            }
                        }
                        return GLib.SOURCE_REMOVE;
                    });
                }
            } else {
                if (this._artVisibilityTimer) {
                    GLib.Source.remove(this._artVisibilityTimer);
                    this._artVisibilityTimer = null;
                }
                this._vinylBin.show();
                this._vinyl.show();

                if (this._titleLabel && this._titleLabel.get_parent()) {
                    let infoBox = this._titleLabel.get_parent();
                    infoBox.x_expand = true;
                    infoBox.set_style('min-width: 0px; margin-left: 15px; margin-right: 0px;');

                    let topRow = infoBox.get_parent();
                    if (topRow) {
                        topRow.x_align = Clutter.ActorAlign.FILL;
                    }
                }

                let isSquare = this._settings.get_boolean('popup-vinyl-square');
                let radius = isSquare ? 12 : 50;
                let newClass = isSquare ? 'vinyl-container-square' : 'vinyl-container';

                if (this._vinyl.get_style_class_name() !== newClass) {
                    this._vinyl.set_style_class_name(newClass);
                }

                if (trackChanged) {
                    this._currentArtUrl = artUrl;

                    let children = this._vinyl.get_children();
                    if (children.length === 0 || children[children.length - 1]._bgUrl !== artUrl) {
                        let bg = `url("${artUrl}")`;
                        let style = `background-image: ${bg}; background-size: cover; border-radius: ${radius}px;`;

                        children.forEach(c => c.remove_all_transitions());

                        let newLayer = new St.Widget({
                            style: style,
                            width: 100,
                            height: 100,
                            x_expand: true,
                            y_expand: true,
                            opacity: children.length > 0 ? 0 : 255
                        });
                        newLayer._bgUrl = artUrl;

                        this._vinyl.add_child(newLayer);

                        if (this._vinyl.get_children().length > 1) {
                            newLayer.ease({
                                opacity: 255,
                                duration: 1800,
                                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                                onStopped: (isFinished) => {
                                    if (!isFinished) return;

                                    newLayer.opacity = 255;

                                    let currentChildren = this._vinyl.get_children();
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
                    }
                } else {
                    this._vinyl.get_children().forEach(c => {
                        let layerUrl = c._bgUrl || artUrl;
                        let bg = `url("${layerUrl}")`;
                        let style = `background-image: ${bg}; background-size: cover; border-radius: ${radius}px;`;
                        c.set_style(style);
                    });
                }

                if (status === 'Playing') {
                    this._playPauseIcon.icon_name = 'media-playback-pause-symbolic';
                    if (this._visualizer) this._visualizer.setPlaying(true);
                    if (this._lastStatus !== 'Playing' || trackChanged) {
                        this._startVinyl();
                    }
                } else {
                    this._playPauseIcon.icon_name = 'media-playback-start-symbolic';
                    if (this._visualizer) this._visualizer.setPlaying(false);
                    if (this._lastStatus === 'Playing') {
                        this._stopVinyl();
                    }
                }
                this._lastStatus = status;

                if (this.visible && trackChanged) {
                    this.animateResize();
                }

                let caps = this._controller.getPlayerCapabilities();
                this._lastCaps = caps;

                if (this._prevBtn) {
                    this._prevBtn.reactive = caps.canGoPrevious;
                    this._prevBtn.opacity = caps.canGoPrevious ? 255 : 80;
                }
                if (this._nextBtn) {
                    this._nextBtn.reactive = caps.canGoNext;
                    this._nextBtn.opacity = caps.canGoNext ? 255 : 80;
                }

                if (this._player) {
                    let shuffle = this._player.Shuffle;
                    let loop = this._player.LoopStatus;

                    if (this._shuffleBtn) {
                        if (!caps.canShuffle) {
                            this._shuffleBtn.reactive = false;
                            this._shuffleIcon.opacity = 40;
                        } else {
                            this._shuffleBtn.reactive = true;
                            this._shuffleIcon.opacity = shuffle ? 255 : 100;
                        }
                    }

                    if (this._repeatBtn) {
                        if (!caps.canLoop) {
                            this._repeatBtn.reactive = false;
                            this._repeatIcon.icon_name = 'media-playlist-repeat-symbolic';
                            this._repeatIcon.opacity = 40;
                        } else {
                            this._repeatBtn.reactive = true;
                            if (loop === 'Track') {
                                this._repeatIcon.icon_name = 'media-playlist-repeat-song-symbolic';
                                this._repeatIcon.opacity = 255;
                            } else if (loop === 'Playlist') {
                                this._repeatIcon.icon_name = 'media-playlist-repeat-symbolic';
                                this._repeatIcon.opacity = 255;
                            } else {
                                this._repeatIcon.icon_name = 'media-playlist-repeat-symbolic';
                                this._repeatIcon.opacity = 100;
                            }
                        }
                    }
                }
                let showShufLoop = this._settings.get_boolean('show-shuffle-loop');
                if (this._shuffleBtn) this._shuffleBtn.visible = showShufLoop;
                if (this._repeatBtn) this._repeatBtn.visible = showShufLoop;

                this._updateCustomButtons();
                this._updatePlayerSelector();
            }
        }


        static _ACTION_META = {
            'none': { icon: 'view-more-symbolic' },
            'volume': { icon: 'audio-volume-high-symbolic' },
            'seek_step': { icon: 'media-seek-forward-symbolic' },
            'output_switch': { icon: 'audio-card-symbolic' },
            'sleep_timer': { icon: 'alarm-symbolic' },
            'playback_speed': { icon: 'power-profile-performance-symbolic' },
            'history': { icon: 'document-open-recent-symbolic' },
        };


        _bothButtonsAreSeekStep() {
            return this._settings.get_boolean('enable-custom-buttons') &&
                this._settings.get_string('custom-button-1') === 'seek_step' &&
                this._settings.get_string('custom-button-2') === 'seek_step';
        }

        _getPageColors() {
            let col = (this._controller._pill && this._controller._pill._displayedColor)
                ? this._controller._pill._displayedColor
                : { r: 30, g: 30, b: 30 };
            let br = (col.r * 299 + col.g * 587 + col.b * 114) / 1000;
            return {
                tc: br > 160 ? 'rgb(30,30,30)' : 'rgb(255,255,255)',
                ta: br > 160 ? 'rgba(30,30,30,0.6)' : 'rgba(255,255,255,0.6)',
            };
        }

        _pushPage(title, iconName, buildFn) {
            if (this._currentSubPage) {
                this._currentSubPage.destroy();
                this._currentSubPage = null;
            }

            this._savedBoxHeight = this._box.height;
            this._box.set_height(this._savedBoxHeight);

            if (this._mainPage) this._mainPage.hide();

            let { tc, ta } = this._getPageColors();

            let pillCol = (this._controller._pill && this._controller._pill._displayedColor)
                ? this._controller._pill._displayedColor : { r: 255, g: 255, b: 255 };

            let page = new St.BoxLayout({
                vertical: true, x_expand: true, y_expand: true,
                clip_to_allocation: true,
                style: `padding: 2px 8px 8px 8px; margin: 4px; border-radius: 20px; background-color: rgba(${pillCol.r},${pillCol.g},${pillCol.b},0.07);`
            });
            this._currentSubPage = page;
            page.translation_x = 32;
            page.opacity = 0;

            let headerWrapper = new St.BoxLayout({
                vertical: true, x_expand: true, y_expand: false,
                y_align: Clutter.ActorAlign.START,
                style: 'spacing: 4px; margin-bottom: 6px; min-height: 0;'
            });
            let header = new St.BoxLayout({
                vertical: false, x_expand: true, y_expand: false,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'min-height: 0;'
            });

            let backBtn = new St.Button({
                reactive: true, can_focus: true,
                style_class: 'subpage-back-btn',
                child: new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 14 }),
                y_align: Clutter.ActorAlign.CENTER
            });
            _addBtnPressAnim(backBtn);
            const _doBack = () => this._popPage();
            backBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, page);
            backBtn.connectObject('button-release-event', () => { _doBack(); return Clutter.EVENT_STOP; }, page);
            backBtn.connectObject('touch-event', (a, e) => {
                if (e.type() === Clutter.EventType.TOUCH_END) { _doBack(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, page);
            header.add_child(backBtn);

            let titleGroup = new St.BoxLayout({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 5px;'
            });
            if (iconName) titleGroup.add_child(new St.Icon({ icon_name: iconName, icon_size: SUBPAGE_HEADER_ICON_SIZE, style: `color:${tc};` }));
            titleGroup.add_child(new St.Label({
                text: title, y_align: Clutter.ActorAlign.CENTER,
                style: `font-weight: bold; font-size: 11pt; color: ${tc};`
            }));
            let titleBin = new St.Bin({
                x_expand: true, y_align: Clutter.ActorAlign.CENTER,
                x_align: Clutter.ActorAlign.CENTER,
                child: titleGroup
            });
            header.add_child(titleBin);


            let mirrorSpacer = new St.Widget({ reactive: false, y_align: Clutter.ActorAlign.CENTER, width: SUBPAGE_BACK_BTN_WIDTH });
            header.add_child(mirrorSpacer);

            headerWrapper.add_child(header);
            headerWrapper.add_child(new St.Widget({
                x_expand: true, height: 1,
                style: 'background-color: rgba(255,255,255,0.13);'
            }));
            page.add_child(headerWrapper);

            let contentScroll = new St.ScrollView({
                x_expand: true, y_expand: true,
                reactive: true,
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                overlay_scrollbars: false
            });
            let contentBox = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing: 10px;' });
            contentScroll.set_child(contentBox);
            page.add_child(contentScroll);

            buildFn(contentBox, tc, ta, page);
            this._box.add_child(page);

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (page.get_parent() && page === this._currentSubPage) {
                    page.ease({
                        translation_x: 0, opacity: 255,
                        duration: SUBPAGE_ANIM_IN_DURATION, mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
                return false;
            });
        }

        _popPage() {
            if (!this._currentSubPage) return;
            let p = this._currentSubPage;
            this._currentSubPage = null;
            p.ease({
                translation_x: 32, opacity: 0,
                duration: SUBPAGE_ANIM_OUT_DURATION, mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: () => {
                    if (p.get_parent()) p.get_parent().remove_child(p);
                    p.destroy();
                    if (this._mainPage) this._mainPage.show();
                    this._box.set_height(-1);
                    if (this._sliderFill) this._sliderFill.set_width(-1);
                    this.animateResize();
                }
            });
        }

        _showLyricsPage() {
            if (this._currentSubPage) return;

            this._savedBoxHeight = this._box.height;
            this._box.set_height(this._savedBoxHeight);
            if (this._mainPage) this._mainPage.hide();

            let pillCol = (this._controller._pill && this._controller._pill._displayedColor)
                ? this._controller._pill._displayedColor : { r: 40, g: 40, b: 40 };

            let brightness = (pillCol.r * 299 + pillCol.g * 587 + pillCol.b * 114) / 1000;
            let isDark = brightness <= 160;
            let btnRgb = isDark ? '255,255,255' : '0,0,0';
            let iconClr = isDark ? 'rgba(255,255,255,0.92)' : 'rgba(30,30,30,0.92)';

            let followRadius = this._settings.get_boolean('popup-follow-radius');
            let rawRadius = followRadius ? this._settings.get_int('border-radius') : 24;
            let dynRadius = (typeof rawRadius === 'number' && !isNaN(rawRadius)) ? rawRadius : 24;

            let page = new St.Widget({
                layout_manager: new Clutter.BinLayout(),
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.FILL,
                y_align: Clutter.ActorAlign.FILL,
                clip_to_allocation: true,
                style: `background-color: transparent;`
            });
            this._currentSubPage = page;
            page.translation_x = 28;
            page.opacity = 0;

            const seekCb = (timeMs) => {
                if (!this._player) return;
                let m = this._player.Metadata;
                if (!m) return;
                let trackId = '/org/mpris/MediaPlayer2/TrackList/NoTrack';
                let tid = smartUnpack(m['mpris:trackid']);
                if (tid) trackId = tid;
                let positionMicro = Math.round(timeMs * 1000);
                this._player._lastPosition = positionMicro;
                this._player._lastPositionTime = Date.now();
                if (this._controller && this._controller._connection) {
                    this._controller._connection.call(
                        this._player._busName,
                        '/org/mpris/MediaPlayer2',
                        'org.mpris.MediaPlayer2.Player',
                        'SetPosition',
                        new GLib.Variant('(ox)', [trackId, positionMicro]),
                        null, Gio.DBusCallFlags.NONE, -1, null,
                        (conn, res) => { try { conn.call_finish(res); } catch (e) { } }
                    );
                }
            };

            let lyricsWidget = new LyricsWidget(seekCb);
            lyricsWidget.showLoading();

            lyricsWidget.x_expand = true;
            lyricsWidget.y_expand = true;
            lyricsWidget.x_align = Clutter.ActorAlign.FILL;
            lyricsWidget.y_align = Clutter.ActorAlign.FILL;

            let fgR = isDark ? 255 : 30;
            let fgG = isDark ? 255 : 30;
            let fgB = isDark ? 255 : 30;
            lyricsWidget.setTextColor(fgR, fgG, fgB);
            page.add_child(lyricsWidget);

            const _backBtnStyle = (hover, disableAnim = false) =>
                `width: 32px; height: 32px;` +
                `margin: 8px;` +
                `padding: 0px;` +
                `border-radius: 8px;` +
                `background-color: rgba(${btnRgb}, ${hover ? 0.30 : 0.15});` +
                `border: 1px solid rgba(${btnRgb}, ${hover ? 0.20 : 0.10});` +
                (disableAnim ? `transition-duration: 0ms;` : `transition-duration: 140ms;`);

            let backIcon = new St.Icon({ icon_name: 'go-previous-symbolic', icon_size: 16, style: `color: ${iconClr};` });
            backIcon.set_x_align(Clutter.ActorAlign.CENTER);
            backIcon.set_y_align(Clutter.ActorAlign.CENTER);

            let backBtn = new St.Button({
                reactive: true,
                can_focus: true,
                child: backIcon,
                style: _backBtnStyle(false)
            });


            let backBtnWrapper = new St.Bin({
                x_expand: true,
                y_expand: true,
                x_align: Clutter.ActorAlign.START,
                y_align: Clutter.ActorAlign.START,
                child: backBtn
            });

            backBtn.connect('notify::hover', () => {
                if (!backBtn.get_parent() || page !== this._currentSubPage) return;
                backBtn.set_style(_backBtnStyle(backBtn.hover));
            });

            _addBtnPressAnim(backBtn);
            backBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, page);

            const _doBack = () => {
                backBtn.set_style(_backBtnStyle(false, true));
                this._popPage();
            };

            backBtn.connectObject('button-release-event', () => { _doBack(); return Clutter.EVENT_STOP; }, page);
            backBtn.connectObject('touch-event', (a, e) => {
                if (e.type() === Clutter.EventType.TOUCH_END) { _doBack(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, page);

            page.add_child(backBtnWrapper);

            this._lyricsWidget = lyricsWidget;
            this._box.add_child(page);
            this.animateResize();

            GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                if (page.get_parent() && page === this._currentSubPage) {
                    page.ease({
                        translation_x: 0, opacity: 255,
                        duration: SUBPAGE_ANIM_IN_DURATION,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
                return false;
            });

            if (!this._lyricsClient) this._lyricsClient = new LyricsClient();

            if (this._player) {
                let m = this._player.Metadata;
                if (m) {
                    let fetchTitle = smartUnpack(m['xesam:title']) || '';
                    let fetchArtist = smartUnpack(m['xesam:artist']) || '';
                    if (Array.isArray(fetchArtist)) fetchArtist = fetchArtist.join(', ');
                    let fetchAlbum = smartUnpack(m['xesam:album']) || '';
                    let lengthMicro = smartUnpack(m['mpris:length']) || 0;
                    let durationSec = Math.round(lengthMicro / 1_000_000);

                    this._lyricsClient.getLyrics(
                        fetchTitle, fetchArtist, fetchAlbum, durationSec, this._settings
                    ).then(lyrics => {
                        if (page !== this._currentSubPage || !page.get_parent()) return;
                        if (!lyricsWidget || (lyricsWidget.is_finalized && lyricsWidget.is_finalized())) return;
                        if (lyrics && lyrics.length > 0) {
                            lyricsWidget.setLyrics(lyrics);
                            lyricsWidget.updatePosition(this._getCurrentPositionMs());
                        } else {
                            lyricsWidget.showEmpty();
                        }
                    }).catch(() => {
                        if (page === this._currentSubPage && page.get_parent())
                            if (!lyricsWidget.is_finalized || !lyricsWidget.is_finalized())
                                lyricsWidget.showError();
                    });
                }
            }

            this._lyricsTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                if (page !== this._currentSubPage || !page.get_parent()) {
                    this._lyricsTimerId = null;
                    return GLib.SOURCE_REMOVE;
                }
                if (this._lyricsWidget)
                    this._lyricsWidget.updatePosition(this._getCurrentPositionMs());
                return GLib.SOURCE_CONTINUE;
            });

            page.connect('destroy', () => {
                if (this._lyricsTimerId) {
                    GLib.Source.remove(this._lyricsTimerId);
                    this._lyricsTimerId = null;
                }
                this._lyricsWidget = null;
            });
        }

        _getCurrentPositionMs() {
            if (!this._player) return 0;
            let now = Date.now();
            let cachedPos = this._player._lastPosition || 0;
            let lastUpdate = this._player._lastPositionTime || now;
            let posUs = cachedPos;
            if (this._player.PlaybackStatus === 'Playing')
                posUs += (now - lastUpdate) * 1000;
            return posUs / 1000;
        }

        _applyCustomButton(btn, enabled, action, isBtn1) {
            if (!btn) return;
            if (!enabled || !action || action === 'none') { btn.visible = false; return; }
            btn.visible = true;
            let meta = ExpandedPlayer._ACTION_META[action] || ExpandedPlayer._ACTION_META['none'];
            let icon = btn.get_child();
            if (action === 'seek_step') {
                if (this._bothButtonsAreSeekStep()) {
                    if (icon) icon.icon_name = isBtn1 ? 'media-skip-backward-symbolic' : 'media-skip-forward-symbolic';
                } else {
                    if (icon) icon.icon_name = 'media-seek-forward-symbolic';
                }
            } else {
                if (icon) icon.icon_name = meta.icon;
            }
            if (action === 'sleep_timer' && this._controller._sleepTimerActive)
                if (icon) icon.icon_name = 'alarm-symbolic';

            let caps = this._lastCaps;
            if (caps) {
                let supported = true;
                if (action === 'seek_step') supported = caps.canSeek;
                else if (action === 'playback_speed') supported = caps.canChangeRate;
                if (icon) icon.opacity = supported ? 255 : 80;
            }
        }

        _updateCustomButtons() {
            let enabled = this._settings.get_boolean('enable-custom-buttons');
            let action1 = this._settings.get_string('custom-button-1');
            let action2 = this._settings.get_string('custom-button-2');
            this._applyCustomButton(this._customBtn1, enabled, action1, true);
            this._applyCustomButton(this._customBtn2, enabled, action2, false);
        }
        _openCustomAction(action, _sourceBtn) {
            if (this._currentSubPage) { this._popPage(); return; }
            switch (action) {
                case 'volume': this._showVolumePopup(); break;
                case 'seek_step': this._showSeekStepPopup(); break;
                case 'output_switch': this._showOutputPopup(); break;
                case 'sleep_timer': this._showSleepTimerPopup(); break;
                case 'playback_speed': this._showSpeedPopup(); break;
                case 'history': this._showHistoryPopup(); break;
            }
        }
        _showVolumePopup() {
            this._pushPage(_('Volume'), 'audio-volume-high-symbolic', (contentBox, tc, ta, subpage) => {
                let mixer = getMixerControl();
                let maxVol = mixer ? mixer.get_vol_max_norm() : 65536;

                let streamsToShow = [];
                if (mixer) {
                    let masterStream = mixer.get_default_sink();
                    if (masterStream) {
                        streamsToShow.push({ stream: masterStream, title: _('System Volume'), isMaster: true });
                    }
                }

                let addedStreamIds = new Set();
                if (streamsToShow.length > 0) addedStreamIds.add(streamsToShow[0].stream.id || streamsToShow[0].stream);

                let proxies = Array.from(this._controller._proxies.values());
                for (let p of proxies) {
                    let { stream } = this._controller._getAppStream(p);
                    if (stream && !addedStreamIds.has(stream.id || stream)) {
                        addedStreamIds.add(stream.id || stream);
                        let name = p._identity || _('Player');
                        streamsToShow.push({ stream, title: name, isMaster: false });
                    }
                }

                if (streamsToShow.length === 0) {
                    contentBox.add_child(new St.Label({ text: _('No audio stream available'), style: `color:${ta};` }));
                    return;
                }

                let allSliders = [];

                for (let item of streamsToShow) {
                    let { stream, title, isMaster } = item;
                    let wrapper = new St.BoxLayout({ vertical: true, style: 'margin-bottom: 12px;' });
                    
                    let titleBox = new St.BoxLayout({ vertical: false, style: 'margin-bottom: 6px;', x_align: Clutter.ActorAlign.START });
                    titleBox.add_child(new St.Icon({ icon_name: isMaster ? 'audio-speakers-symbolic' : 'audio-x-generic-symbolic', icon_size: 14, style: `color:${ta};margin-right:6px;`, y_align: Clutter.ActorAlign.CENTER }));
                    titleBox.add_child(new St.Label({ text: title, style: `color:${ta};font-size:9pt;font-weight:bold;`, y_align: Clutter.ActorAlign.CENTER }));
                    wrapper.add_child(titleBox);

                    let frac0 = stream.is_muted ? 0 : Math.min(1, stream.volume / maxVol);
                    let sliderRow = new St.BoxLayout({ vertical: false, style: 'spacing: 10px;', x_expand: true });
                    let sliderBg = new St.Widget({ style: `background-color:rgba(128,128,128,0.25);border-radius:5px;`, x_expand: true, y_align: Clutter.ActorAlign.CENTER, reactive: true, height: 10 });
                    let sliderFill = new St.Widget({ style: `background-color:${tc};border-radius:5px;`, height: 10, reactive: false });
                    sliderFill.set_position(0, 0);
                    sliderBg.add_child(sliderFill);
                    let volLabel = new St.Label({ text: `${Math.round(frac0 * 100)}%`, style: `color:${tc};min-width:38px;text-align:right;`, y_align: Clutter.ActorAlign.CENTER });

                    const upd = (f) => { f = Math.max(0, Math.min(1, f)); if (!sliderBg.has_allocation || !sliderBg.has_allocation()) { volLabel.text = `${Math.round(f * 100)}%`; return; } let w = sliderBg.get_width(); if (w > 0) sliderFill.width = Math.round(w * f); volLabel.text = `${Math.round(f * 100)}%`; };
                    const applyVol = (f) => { f = Math.max(0, Math.min(1, f)); stream.volume = Math.round(f * maxVol); stream.push_volume(); if (stream.is_muted && f > 0) stream.change_is_muted(false); };

                    let _lastApplyTime = 0;
                    const applyVolThrottled = (f) => {
                        sliderBg._dragFrac = f;
                        let now = Date.now();
                        if (now - _lastApplyTime < 30) return;
                        _lastApplyTime = now;
                        applyVol(f);
                    };

                    const drag = (ev) => {
                        let [ex, ey] = ev.get_coords();
                        let [ok, relX, relY] = sliderBg.transform_stage_point(ex, ey);
                        if (ok) {
                            let sw = sliderBg.get_width();
                            if (sw <= 0) return;
                            let f = Math.max(0, Math.min(1, relX / sw));
                            upd(f);
                            applyVolThrottled(f);
                        }
                    };

                    const syncFromStream = () => {
                        if (!sliderBg.get_parent()) return;
                        if (sliderBg._drag) return;
                        let f = stream.is_muted ? 0 : Math.min(1, stream.volume / maxVol);
                        upd(f);
                    };

                    stream.connectObject('notify::volume', syncFromStream, subpage);
                    stream.connectObject('notify::is-muted', syncFromStream, subpage);

                    sliderBg.connectObject('button-press-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; sliderBg._drag = true; sliderBg._dragFrac = stream.is_muted ? 0 : Math.min(1, stream.volume / maxVol); drag(e); return Clutter.EVENT_STOP; }, subpage);
                    sliderBg.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; sliderBg._drag = false; applyVol(sliderBg._dragFrac || 0); return Clutter.EVENT_STOP; }, subpage);
                    sliderBg.connectObject('motion-event', (a, e) => { if (sliderBg._drag) drag(e); return Clutter.EVENT_STOP; }, subpage);
                    sliderBg.connectObject('touch-event', (a, e) => { let t = e.type(); if (t === Clutter.EventType.TOUCH_BEGIN || t === Clutter.EventType.TOUCH_UPDATE) { drag(e); return Clutter.EVENT_STOP; } if (t === Clutter.EventType.TOUCH_END) { applyVol(sliderBg._dragFrac || 0); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);

                    sliderRow.add_child(sliderBg);
                    sliderRow.add_child(volLabel);
                    wrapper.add_child(sliderRow);

                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        if (!sliderBg.get_parent() || !subpage.get_parent()) return GLib.SOURCE_REMOVE;
                        if (sliderBg.has_allocation && sliderBg.has_allocation() && sliderBg.get_width() > 0) {
                            upd(frac0);
                            return GLib.SOURCE_REMOVE;
                        }
                        return GLib.SOURCE_CONTINUE;
                    });

                    allSliders.push({ sliderBg, drag, applyVol });
                    contentBox.add_child(wrapper);
                }

                global.stage.connectObject('captured-event', (stage, ev) => {
                    let t = ev.type();
                    if (t === Clutter.EventType.MOTION) {
                        for (let s of allSliders) if (s.sliderBg._drag) s.drag(ev);
                    } else if (t === Clutter.EventType.BUTTON_RELEASE) {
                        for (let s of allSliders) {
                            if (s.sliderBg._drag) { s.sliderBg._drag = false; s.applyVol(s.sliderBg._dragFrac || 0); }
                        }
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, subpage);

                let muteAllBtn = new St.Button({
                    label: _('Toggle Mute All'),
                    reactive: true, can_focus: true, x_expand: true,
                    style: `border-radius:12px;padding:9px 12px;margin-top:4px;background-color:rgba(128,128,128,0.18);color:${tc};`
                });
                _addBtnPressAnim(muteAllBtn);
                const doMuteAll = () => {
                    let anyUnmuted = streamsToShow.some(item => !item.stream.is_muted);
                    for (let item of streamsToShow) {
                        item.stream.change_is_muted(anyUnmuted);
                    }
                };
                muteAllBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, subpage);
                muteAllBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; doMuteAll(); return Clutter.EVENT_STOP; }, subpage);
                muteAllBtn.connectObject('touch-event', (a, e) => { if (e.type() === Clutter.EventType.TOUCH_END) { doMuteAll(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);
                contentBox.add_child(muteAllBtn);

            });
        }

        _showSeekStepPopup() {
            this._pushPage(_('Seek'), 'media-seek-forward-symbolic', (contentBox, tc, ta, subpage) => {
                let caps = this._controller.getPlayerCapabilities();
                if (!caps.canSeek) {
                    contentBox.add_child(new St.Label({
                        text: _('This player does not support seeking'),
                        style: `color:${ta};font-size:9pt;margin-bottom:4px;`,
                        x_align: Clutter.ActorAlign.CENTER
                    }));
                }
                let row = new St.BoxLayout({ vertical: false, style: 'spacing: 12px;', x_align: Clutter.ActorAlign.CENTER, x_expand: true });
                const mkBtn = (icon, fwd) => {
                    let btn = new St.Button({
                        child: new St.Icon({ icon_name: icon, icon_size: 28, style: `color:${tc};opacity:${caps.canSeek ? 1 : 0.35};` }),
                        reactive: caps.canSeek, can_focus: true, x_expand: true,
                        style: `border-radius:14px;padding:12px 10px;background-color:rgba(255,255,255,0.1);`
                    });
                    _addBtnPressAnim(btn);
                    const doIt = () => { this._controller.seekStep(fwd); this._popPage(); };
                    btn.connectObject('button-press-event', () => Clutter.EVENT_STOP, subpage);
                    btn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; doIt(); return Clutter.EVENT_STOP; }, subpage);
                    btn.connectObject('touch-event', (a, e) => { if (e.type() === Clutter.EventType.TOUCH_END) { doIt(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);
                    return btn;
                };
                row.add_child(mkBtn('media-seek-backward-symbolic', false));
                row.add_child(mkBtn('media-seek-forward-symbolic', true));
                contentBox.add_child(row);
            });
        }

        _showOutputPopup() {
            this._pushPage(_('Audio Output'), 'audio-card-symbolic', (contentBox, tc, ta, subpage) => {
                let mixer = getMixerControl();
                if (!mixer) { contentBox.add_child(new St.Label({ text: _('Audio control unavailable'), style: `color:${ta};` })); return; }
                let defaultSink = mixer.get_default_sink();
                let sinks = mixer.get_sinks();
                if (!sinks || sinks.length === 0) { contentBox.add_child(new St.Label({ text: _('No output devices found'), style: `color:${ta};` })); return; }
                sinks.forEach(sink => {
                    let isDef = defaultSink && (sink.id === defaultSink.id);
                    let desc = sink.get_description() || sink.get_name() || _('Unknown Device');
                    if (desc.length > 46) desc = desc.substring(0, 44) + '\u2026';
                    let row = new St.BoxLayout({ vertical: false, style: 'spacing: 10px;', x_expand: true });
                    row.add_child(new St.Icon({ icon_name: isDef ? 'audio-speakers-symbolic' : 'audio-card-symbolic', icon_size: 18, style: `color:${tc};` }));
                    row.add_child(new St.Label({ text: desc, y_align: Clutter.ActorAlign.CENTER, style: `color:${tc};`, x_expand: true }));
                    if (isDef) row.add_child(new St.Icon({ icon_name: 'object-select-symbolic', icon_size: 14, style: `color:${tc};` }));
                    let btn = new St.Button({ child: row, x_expand: true, reactive: true, can_focus: true, style: `border-radius:12px;padding:10px 12px;margin-bottom:4px;background-color:${isDef ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.07)'};` });
                    _addBtnPressAnim(btn);
                    const doIt = () => { mixer.set_default_sink(sink); this._popPage(); };
                    btn.connectObject('button-press-event', () => Clutter.EVENT_STOP, subpage);
                    btn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; doIt(); return Clutter.EVENT_STOP; }, subpage);
                    btn.connectObject('touch-event', (a, e) => { if (e.type() === Clutter.EventType.TOUCH_END) { doIt(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);
                    contentBox.add_child(btn);
                });
            });
        }

        _showSleepTimerPopup() {
            let ctrl = this._controller;
            let isActive = ctrl._sleepTimerActive;
            let remaining = ctrl.getSleepTimerRemaining();
            let title = isActive ? (_('Sleep Timer') + ' (' + Math.ceil(remaining / 60) + ' ' + _('min left') + ')') : _('Sleep Timer');
            this._pushPage(title, 'alarm-symbolic', (contentBox, tc, ta, subpage) => {
                if (isActive) {
                    let cancelBtn = new St.Button({ label: _('Cancel Timer'), x_expand: true, reactive: true, can_focus: true, style: 'border-radius:12px;padding:9px 12px;margin-bottom:8px;background-color:rgba(210,50,50,0.35);color:' + tc + ';' });
                    _addBtnPressAnim(cancelBtn);
                    const doCancel = () => { ctrl.cancelSleepTimer(); this._updateCustomButtons(); this._popPage(); };
                    cancelBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, subpage);
                    cancelBtn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; doCancel(); return Clutter.EVENT_STOP; }, subpage);
                    cancelBtn.connectObject('touch-event', (a, e) => { if (e.type() === Clutter.EventType.TOUCH_END) { doCancel(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);
                    contentBox.add_child(cancelBtn);
                }
                let presets = [5, 10, 15, 20, 30, 45, 60, 90];
                [[0, 4], [4, 8]].forEach(([s, e]) => {
                    let row = new St.BoxLayout({ vertical: false, style: 'spacing: 8px;', x_align: Clutter.ActorAlign.CENTER });
                    presets.slice(s, e).forEach(min => {
                        let btnLabel = new St.Label({ text: min + 'm', y_align: Clutter.ActorAlign.CENTER, style: 'color:' + tc + ';' });
                        let btn = new St.Button({ child: btnLabel, reactive: true, can_focus: true, style: 'border-radius:12px;padding:8px 12px;min-width:42px;background-color:rgba(255,255,255,0.1);' });
                        _addBtnPressAnim(btn);
                        const doTimer = (m, b, lbl) => {
                            lbl.text = '\u2713';
                            b.set_style('border-radius:12px;padding:8px 12px;min-width:42px;background-color:rgba(255,255,255,0.38);');
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                                if (this.is_finalized && this.is_finalized()) return GLib.SOURCE_REMOVE;
                                ctrl.startSleepTimer(m);
                                this._updateCustomButtons();
                                this._popPage();
                                return GLib.SOURCE_REMOVE;
                            });
                        };
                        btn.connectObject('button-press-event', () => Clutter.EVENT_STOP, subpage);
                        btn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; doTimer(min, btn, btnLabel); return Clutter.EVENT_STOP; }, subpage);
                        btn.connectObject('touch-event', (a, ev) => { if (ev.type() === Clutter.EventType.TOUCH_END) { doTimer(min, btn, btnLabel); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);
                        row.add_child(btn);
                    });
                    contentBox.add_child(row);
                });
                contentBox.add_child(new St.Label({ text: _('Runs inside the shell \u2014 works on lock screen'), style: 'color:' + ta + ';font-size:8pt;margin-top:2px;', x_align: Clutter.ActorAlign.CENTER }));
            });
        }

        _showSpeedPopup() {
            this._pushPage(_('Playback Speed'), 'power-profile-performance-symbolic', (contentBox, tc, ta, subpage) => {
                let caps = this._controller.getPlayerCapabilities();
                let rates = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0];
                let currentRate = this._controller.getPlaybackRate();

                if (!caps.canChangeRate) {
                    contentBox.add_child(new St.Label({
                        text: _('This player does not support playback speed'),
                        style: 'color:' + ta + ';font-size:9pt;margin-bottom:4px;',
                        x_align: Clutter.ActorAlign.CENTER
                    }));
                }

                [[0, 4], [4, 7]].forEach(([s, e]) => {
                    let row = new St.BoxLayout({ vertical: false, style: 'spacing: 8px;', x_align: Clutter.ActorAlign.CENTER });
                    rates.slice(s, e).forEach(rate => {
                        let isAct = Math.abs(rate - currentRate) < 0.05;
                        let btnLabel = new St.Label({ text: rate + '\u00d7', y_align: Clutter.ActorAlign.CENTER, style: 'color:' + tc + ';font-weight:' + (isAct ? 'bold' : 'normal') + ';' });
                        let btnBox = new St.BoxLayout({ vertical: false, style: 'spacing:4px;', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.CENTER });
                        if (isAct) {
                            let checkIco = new St.Icon({ icon_name: 'object-select-symbolic', icon_size: 12, style: 'color:' + tc + ';' });
                            btnBox.add_child(checkIco);
                        }
                        btnBox.add_child(btnLabel);
                        let btn = new St.Button({
                            child: btnBox, can_focus: true,
                            reactive: caps.canChangeRate,
                            style: 'border-radius:12px;padding:8px 14px;min-width:42px;background-color:' + (isAct ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.08)') + ';opacity:' + (caps.canChangeRate ? 1 : 0.35) + ';'
                        });
                        _addBtnPressAnim(btn);
                        const doRate = (r, b, lbl) => {
                            lbl.text = '\u2713';
                            b.set_style('border-radius:12px;padding:8px 14px;min-width:42px;background-color:rgba(255,255,255,0.38);');
                            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                                if (this.is_finalized && this.is_finalized()) return GLib.SOURCE_REMOVE;
                                this._controller.setPlaybackRate(r);
                                this._popPage();
                                return GLib.SOURCE_REMOVE;
                            });
                        };
                        btn.connectObject('button-press-event', () => Clutter.EVENT_STOP, subpage);
                        btn.connectObject('button-release-event', (a, e) => { if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE; doRate(rate, btn, btnLabel); return Clutter.EVENT_STOP; }, subpage);
                        btn.connectObject('touch-event', (a, ev) => { if (ev.type() === Clutter.EventType.TOUCH_END) { doRate(rate, btn, btnLabel); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, subpage);
                        row.add_child(btn);
                    });
                    contentBox.add_child(row);
                });
                let hint = caps.canChangeRate ? _('Player must support MPRIS Rate') : _('Not supported by this player');
                contentBox.add_child(new St.Label({ text: hint, style: 'color:' + ta + ';font-size:8pt;margin-top:2px;', x_align: Clutter.ActorAlign.CENTER }));
            });
        }

        _showHistoryPopup() {
            this._pushPage(_('Recently Played'), 'document-open-recent-symbolic', (contentBox, tc, ta) => {
                let history = this._controller.getTrackHistory();
                if (!history || history.length === 0) { contentBox.add_child(new St.Label({ text: _('No history yet'), style: `color:${ta};` })); return; }

                let subpage = contentBox.get_parent()?.get_parent();
                let copyTimeouts = [];
                let copyIcons = [];

                const fmtTime = (ms) => {
                    if (!ms) return '';
                    let d = new Date(ms);
                    let now = new Date();
                    let diffH = (now - d) / 3600000;
                    if (diffH < 24) {
                        let hh = d.getHours().toString().padStart(2, '0');
                        let mm = d.getMinutes().toString().padStart(2, '0');
                        return hh + ':' + mm;
                    } else {
                        let mo = (d.getMonth() + 1).toString().padStart(2, '0');
                        let dd = d.getDate().toString().padStart(2, '0');
                        return mo + '.' + dd;
                    }
                };

                history.slice(0, 20).forEach(track => {
                    let c = track.avgColor;
                    let rowBg = (c && typeof c.r === 'number')
                        ? ('background-color:rgba(' + c.r + ',' + c.g + ',' + c.b + ',0.28);')
                        : 'background-color:rgba(128,128,128,0.10);';

                    let innerRow = new St.BoxLayout({ vertical: false, style: 'spacing: 10px;', x_expand: true });
                    let thumb = new St.Widget({ width: 38, height: 38, style: track.artUrl ? ('background-image:url("' + track.artUrl + '");background-size:cover;border-radius:6px;') : 'background-color:rgba(128,128,128,0.2);border-radius:6px;' });
                    innerRow.add_child(thumb);

                    let infoBox = new St.BoxLayout({ vertical: true, x_expand: true, style: 'spacing:1px;', y_align: Clutter.ActorAlign.CENTER });
                    infoBox.add_child(new St.Label({ text: (track.title || _('Unknown')).substring(0, 38), style: 'color:' + tc + ';font-weight:600;font-size:9.5pt;', x_expand: true }));
                    let art = (track.artist || '').substring(0, 34);
                    if (art) infoBox.add_child(new St.Label({ text: art, style: 'color:' + ta + ';font-size:8.5pt;' }));
                    innerRow.add_child(infoBox);

                    let rightCol = new St.BoxLayout({ vertical: true, y_align: Clutter.ActorAlign.CENTER, style: 'spacing:4px;' });
                    let tsLabel = new St.Label({ text: fmtTime(track.time), style: 'color:' + ta + ';font-size:7.5pt;', x_align: Clutter.ActorAlign.END });
                    let copyIcon = new St.Icon({ icon_name: 'edit-copy-symbolic', icon_size: 13, style: 'color:' + ta + ';', x_align: Clutter.ActorAlign.END });
                    rightCol.add_child(tsLabel);
                    rightCol.add_child(copyIcon);
                    innerRow.add_child(rightCol);

                    let rowBtn = new St.Button({
                        child: innerRow, x_expand: true, reactive: true, can_focus: true,
                        style: rowBg + ' border-radius:10px; padding:8px 10px; margin-bottom:4px;'
                    });
                    _addBtnPressAnim(rowBtn);

                    copyIcons.push(copyIcon);
                    const doCopy = () => {
                        let text = track.title || '';
                        if (track.artist) text += ' - ' + track.artist;
                        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, text);
                        copyIcon.icon_name = 'object-select-symbolic';
                        copyIcon.opacity = 0;
                        copyIcon.ease({ opacity: 255, duration: COPY_ICON_FADE_IN_DURATION, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                        let tid = GLib.timeout_add(GLib.PRIORITY_DEFAULT, COPY_ICON_RESET_DELAY, () => {
                            const idx = copyTimeouts.indexOf(tid);
                            if (idx >= 0) copyTimeouts.splice(idx, 1);
                            if (!copyIcon.get_parent()) return GLib.SOURCE_REMOVE;
                            copyIcon.ease({
                                opacity: 0, duration: COPY_ICON_FADE_OUT_DURATION, mode: Clutter.AnimationMode.EASE_IN_QUAD, onStopped: () => {
                                    if (copyIcon.get_parent()) { copyIcon.icon_name = 'edit-copy-symbolic'; copyIcon.opacity = Math.round(255 * 0.6); }
                                }
                            });
                            return GLib.SOURCE_REMOVE;
                        });
                        copyTimeouts.push(tid);
                    };
                    rowBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, contentBox);
                    rowBtn.connectObject('button-release-event', (a, e) => {
                        if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                        doCopy();
                        return Clutter.EVENT_STOP;
                    }, contentBox);
                    rowBtn.connectObject('touch-event', (a, e) => { if (e.type() === Clutter.EventType.TOUCH_END) { doCopy(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, contentBox);
                    contentBox.add_child(rowBtn);
                });

                if (subpage) subpage.connect('destroy', () => {
                    copyTimeouts.forEach(id => GLib.Source.remove(id));
                    copyIcons.forEach(icon => { icon.remove_transition('opacity'); });
                });

                let clearBtn = new St.Button({
                    label: _('Clear History'), x_expand: true, reactive: true, can_focus: true,
                    style: 'border-radius:12px;padding:9px 12px;margin-top:6px;background-color:rgba(210,50,50,0.35);color:' + tc + ';'
                });
                _addBtnPressAnim(clearBtn);
                const doClear = () => { this._controller.clearTrackHistory(); this._popPage(); };
                clearBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, contentBox);
                clearBtn.connectObject('button-release-event', (a, e) => {
                    if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                    doClear();
                    return Clutter.EVENT_STOP;
                }, contentBox);
                clearBtn.connectObject('touch-event', (a, e) => { if (e.type() === Clutter.EventType.TOUCH_END) { doClear(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, contentBox);
                contentBox.add_child(clearBtn);
            });
        }

        showFor(player, artUrl, initialRect = null) {
            disableDashToDockAutohide();
            this.setPlayer(player);
            this._isOpening = true;
            this._isHiding = false;
            this.visible = true;
            this.grab_key_focus();

            if (initialRect) {
                this._lastPillRect = initialRect;
                this.opacity = 255;
                this._box.set_position(initialRect.x, initialRect.y);
                this._box.set_size(initialRect.width, initialRect.height);
                this._mainPage.opacity = 0;
                this._mainPage.ease({
                    opacity: 255,
                    duration: 400,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });
            } else {
                this.opacity = 0;
                this.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            }

            let status = player.PlaybackStatus;
            let m = player.Metadata;
            let title = m ? smartUnpack(m['xesam:title']) : null;
            let artist = m ? smartUnpack(m['xesam:artist']) : null;
            if (Array.isArray(artist)) artist = artist.join(', ');

            this.updateContent(title, artist, artUrl, status);

            this._controller._connection.call(
                player._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                null, Gio.DBusCallFlags.NONE, -1, null,
                (conn, res) => {
                    let result = conn.call_finish(res);
                    let val = smartUnpack(result.deep_unpack()[0]);
                    if (typeof val === 'number' && val >= 0) {
                        player._lastPosition = val;
                        player._lastPositionTime = Date.now();
                    }
                }
            );

            this._startTimer();
            let visStyle = this._settings.get_int('visualizer-style');
            this._visualizer.setMode(visStyle);

            let showVis = this._settings.get_boolean('popup-show-visualizer') && visStyle !== 0;
            this._visBin.visible = showVis;
            this._visualizer.visible = showVis;

            if (showVis && this._settings.get_boolean('popup-hide-pill-visualizer')) {
                if (this._controller._pill) this._controller._pill._setPopupOpen(true);
            }

            this._updateCustomButtons();

            if (this._settings.get_boolean('has-seen-first-hint')) {
                this._firstHintBox.hide();
            } else {
                this._firstHintBox.show();
            }
        }

        hide() {
            if (this._isHiding) return;
            this._isHiding = true;

            if (this._leaveHideTimeoutId) {
                GLib.Source.remove(this._leaveHideTimeoutId);
                this._leaveHideTimeoutId = null;
            }

            if (this._currentSubPage) {
                this._currentSubPage.destroy();
                this._currentSubPage = null;
                if (this._mainPage) this._mainPage.show();
            }

            restoreDashToDockAutohide();
            this._stopTimer();
            this._stopVinyl();
            if (this._controller._pill) this._controller._pill._setPopupOpen(false);

            let animStyle = this._settings.get_int('popup-animation-style');
            if (animStyle === 0) {
                this.visible = false;
                if (this._controller) this._controller.closeMenu();
                return;
            }

            let pill = this._controller._pill;
            if (pill) {
                let [px, py] = pill.get_transformed_position();
                let [pw, ph] = pill.get_transformed_size();

                this._mainPage.ease({
                    opacity: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD
                });

                this._box.ease({
                    width: pw,
                    height: ph,
                    x: px,
                    y: py,
                    duration: 350,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => {
                        this.visible = false;
                        if (this._controller) this._controller.closeMenu();
                        pill.visible = true;
                        pill.reactive = true;
                        pill.opacity = 0;
                        pill.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                    }
                });
            } else {
                this.ease({
                    opacity: 0,
                    duration: 200,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: (isFinished) => {
                        if (!isFinished) return;
                        this.visible = false;
                        if (this._controller) {
                            this._controller.closeMenu();
                        }
                    }
                });
            }
        }

        _cleanup() {
            if (this._updateTimer) { GLib.Source.remove(this._updateTimer); this._updateTimer = null; }
            if (this._resizeDebounceId) { GLib.Source.remove(this._resizeDebounceId); this._resizeDebounceId = null; }
            if (this._leaveHideTimeoutId) { GLib.Source.remove(this._leaveHideTimeoutId); this._leaveHideTimeoutId = null; }
            if (this._artVisibilityTimer) { GLib.Source.remove(this._artVisibilityTimer); this._artVisibilityTimer = null; }
            if (this._currentSubPage) { this._currentSubPage.destroy(); this._currentSubPage = null; }
            if (this._lyricsTimerId) { GLib.Source.remove(this._lyricsTimerId); this._lyricsTimerId = null; }
            if (this._lyricsClient) { this._lyricsClient.destroy(); this._lyricsClient = null; }
            this._lyricsWidget = null;
        }

        _startTimer() {
            if (this._updateTimer) GLib.Source.remove(this._updateTimer);
            // Reset stale detection state for fresh popup session
            this._lastTickPosition = undefined;
            this._lastTickTime = undefined;
            this._lastPositionSync = 0;
            this._lastTickLength = 0;
            this._updateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._tick();
                return GLib.SOURCE_CONTINUE;
            });
            this._tick();
        }

        _stopTimer() {
            if (this._updateTimer) { GLib.Source.remove(this._updateTimer); this._updateTimer = null; }
        }

        _tick() {
            try {
                if (!this._player || !this.get_parent()) return GLib.SOURCE_REMOVE;

                let meta = this._player.Metadata;
                let length = meta ? smartUnpack(meta['mpris:length']) : 0;
                if (length <= 0) return;

                let now = Date.now();
                if (now - this._seekLockTime < 2000) return GLib.SOURCE_CONTINUE;

                // Periodically sync position from DBus to keep _lastPositionTime fresh
                // Most MPRIS players don't push Position updates, only send Seeked on seek
                if (this._player.PlaybackStatus === 'Playing' &&
                    (!this._lastPositionSync || now - this._lastPositionSync > 5000)) {
                    this._lastPositionSync = now;
                    if (this._controller) this._controller._syncPosition(this._player);
                }

                let cachedPos = this._player._lastPosition || 0;
                let lastUpdate = this._player._lastPositionTime || now;

                // Stale position detection for KDE Connect / GS Connect
                // Only triggers when position hasn't been updated by DBus for >6s
                // AND the raw cached position hasn't changed (rules out normal interpolation)
                let isStale = false;
                if (this._player.PlaybackStatus === 'Playing') {
                    if (cachedPos === (this._lastTickPosition || 0) && (now - lastUpdate) > 6000
                        && this._lastTickTime && (now - this._lastTickTime) > 6000) {
                        isStale = true;
                    }
                    if (cachedPos !== (this._lastTickPosition || 0)) this._lastTickTime = now;
                    this._lastTickPosition = cachedPos;
                }

                let currentPos = cachedPos;
                if (this._player.PlaybackStatus === 'Playing' && !isStale) {
                    currentPos += (now - lastUpdate) * 1000;
                }
                if (currentPos > length) currentPos = length;

                let useHours = length >= 3600000000 && this._settings.get_boolean('show-hours-format');

                // Detect track length change (format switch mm:ss <-> hh:mm:ss)
                // Force label width recalculation when format changes
                if (this._lastTickLength && this._lastTickLength !== length) {
                    let prevUseHours = this._lastTickLength >= 3600000000 && this._settings.get_boolean('show-hours-format');
                    if (prevUseHours !== useHours) {
                        // Format changed - force width recalc by clearing fixed widths
                        this._currentTimeLabel.set_width(-1);
                        this._totalTimeLabel.set_width(-1);
                    }
                }
                this._lastTickLength = length;

                let newCurrentText = isStale ? '--:--' : formatTime(currentPos, useHours);
                if (this._currentTimeLabel.text !== newCurrentText) {
                    this._currentTimeLabel.text = newCurrentText;
                    this._currentTimeLabel.set_width(-1);
                    let [, natWC] = this._currentTimeLabel.get_preferred_width(-1);
                    this._currentTimeLabel.set_width(Math.ceil(natWC) + 2);
                }
                let newTotalText = isStale ? '--:--' : formatTime(length, useHours);
                if (this._totalTimeLabel.text !== newTotalText) {
                    this._totalTimeLabel.text = newTotalText;
                    this._totalTimeLabel.set_width(-1);
                    let [, natWT] = this._totalTimeLabel.get_preferred_width(-1);
                    this._totalTimeLabel.set_width(Math.ceil(natWT) + 2);
                }

                if (isStale) return;

                let percent = Math.min(1, Math.max(0, currentPos / length));
                let totalW = Math.round(this._sliderBin.get_width());

                if (totalW > 0) {
                    let targetWidth = Math.max(6, Math.min(totalW, Math.round(totalW * percent)));
                    if (Math.abs(this._sliderFill.width - targetWidth) >= 1) {
                        this._sliderFill.width = targetWidth;
                    }
                }
            } catch (e) {
                console.debug(`[Dynamic Music Pill] _tick error: ${e.message}`);
            }
        }

        _handleSeek(event) {
            if (!this._player) return;
            let meta = this._player.Metadata;
            let length = meta ? smartUnpack(meta['mpris:length']) : 0;
            if (length <= 0) return;

            let [x, y] = event.get_coords();
            let [ok, relX, relY] = this._sliderBin.transform_stage_point(x, y);
            if (!ok) return;
            let width = this._sliderBin.get_width();

            if (width <= 0) return;
            let percent = Math.min(1, Math.max(0, relX / width));
            let targetPos = Math.floor(length * percent);

            this._seekLockTime = Date.now();
            this._player._lastPosition = targetPos;
            this._player._lastPositionTime = Date.now();

            let useHours = length >= 3600000000 && this._settings.get_boolean('show-hours-format');
            this._currentTimeLabel.text = formatTime(targetPos, useHours);
            let totalW = Math.round(this._sliderBin.get_width());

            if (totalW > 0) {
                let targetWidth = Math.round(totalW * percent);
                this._sliderFill.width = Math.max(6, targetWidth);
            }

            let trackId = '/org/mpris/MediaPlayer2/TrackList/NoTrack';
            if (meta && meta['mpris:trackid']) {
                let tid = smartUnpack(meta['mpris:trackid']);
                if (tid) trackId = tid;
            }

            if (this._controller && this._controller._connection) {
                this._controller._connection.call(
                    this._player._busName,
                    '/org/mpris/MediaPlayer2',
                    'org.mpris.MediaPlayer2.Player',
                    'SetPosition',
                    new GLib.Variant('(ox)', [trackId, targetPos]),
                    null, Gio.DBusCallFlags.NONE, -1, null,
                    (conn, res) => {
                        try { conn.call_finish(res); } catch (e) { console.debug(e.message); }
                    }
                );
            }
        }

        _startVinyl() {
            if (!this._vinyl || !this._settings.get_boolean('popup-vinyl-rotate')) return;
            if (this._settings.get_boolean('popup-vinyl-square')) return;
            if (this._isSpinning) return;

            this._isSpinning = true;

            let speedVal = this._settings.get_int('popup-vinyl-speed') || 10;
            let durationFactor = 10 / speedVal;
            let initialDuration = Math.round(800 * durationFactor);
            let loopDuration = Math.round(350000 * durationFactor);

            this._vinyl.remove_all_transitions();
            let currentAngle = this._vinyl.rotation_angle_z || 0;

            this._vinyl.ease({
                rotation_angle_z: currentAngle + 90,
                duration: initialDuration,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onStopped: (isFinished) => {
                    if (!isFinished || !this._isSpinning || !this._vinyl) return;
                    let nextAngle = this._vinyl.rotation_angle_z || 0;
                    this._vinyl.ease({
                        rotation_angle_z: nextAngle + 36000,
                        duration: loopDuration,
                        mode: Clutter.AnimationMode.LINEAR
                    });
                }
            });
        }

        _stopVinyl() {
            if (!this._vinyl || !this._isSpinning) return;
            this._isSpinning = false;

            let speedVal = this._settings.get_int('popup-vinyl-speed') || 10;
            let durationFactor = 10 / speedVal;
            let stopDuration = Math.round(800 * durationFactor);

            let currentAngle = this._vinyl.rotation_angle_z || 0;
            this._vinyl.remove_all_transitions();

            this._vinyl.ease({
                rotation_angle_z: currentAngle + 90,
                duration: stopDuration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                onStopped: (isFinished) => {
                    if (isFinished && this._vinyl) {
                        this._vinyl.rotation_angle_z = this._vinyl.rotation_angle_z % 360;
                    }
                }
            });
        }


        _computeMinControlsWidth() {
            const controlsRow = this._mainPage
                ? this._mainPage.get_children().find(c => c.style_class === 'controls-row')
                : null;

            if (controlsRow) {
                let [, natW] = controlsRow.get_preferred_width(-1);
                if (natW > 0) return natW + 40;
            }

            const SEC = 36, PRI = 48, GAP = 8;
            let visCount = 3;
            let widthSum = PRI * 3;

            const showShufLoop = this._settings.get_boolean('show-shuffle-loop');
            if (showShufLoop) { visCount += 2; widthSum += SEC * 2; }

            const customEnabled = this._settings.get_boolean('enable-custom-buttons');
            const a1 = this._settings.get_string('custom-button-1');
            const a2 = this._settings.get_string('custom-button-2');
            if (customEnabled && a1 && a1 !== 'none') { visCount++; widthSum += SEC; }
            if (customEnabled && a2 && a2 !== 'none') { visCount++; widthSum += SEC; }

            return widthSum + (visCount - 1) * GAP + 40;
        }

        animateResize() {
            if (!this._box || !this._controller || !this._controller._pill) return;
            if (this._currentSubPage || this._isHiding) return;
            
            let animStyle = this._settings.get_int('popup-animation-style');

            if (this._resizeDebounceId) {
                GLib.Source.remove(this._resizeDebounceId);
                this._resizeDebounceId = null;
            }

            this._resizeDebounceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                this._resizeDebounceId = null;
                if (!this._box) return GLib.SOURCE_REMOVE;

                let currentW = this._box.width;
                let currentH = this._box.height;
                let currentX = Math.round(this._box.x);
                let currentY = Math.round(this._box.y);

                this._box.set_size(-1, -1);
                let [minW, natW] = this._box.get_preferred_width(-1);
                natW = Math.ceil(natW);
                let [minH, natH] = this._box.get_preferred_height(natW);
                natH = Math.ceil(natH);
                this._box.set_size(currentW, currentH);

                let animStyle = this._settings.get_int('popup-animation-style');
                if (animStyle === 0) {
                    this._box.set_size(-1, -1);
                    let [, nW] = this._box.get_preferred_width(-1);
                    nW = Math.max(Math.ceil(nW), 260);
                    let [, nH] = this._box.get_preferred_height(nW);
                    this._box.set_size(nW, Math.ceil(nH));
                    return GLib.SOURCE_REMOVE;
                }

                let baseMinW = this._computeMinControlsWidth();

                if (this._settings.get_boolean('popup-show-visualizer') && this._settings.get_int('visualizer-style') !== 0) {
                    let bCount = this._settings.get_int('popup-visualizer-bars') || 10;
                    let bWidth = this._settings.get_int('popup-visualizer-bar-width') || 2;
                    let actualVisW = bCount * (bWidth + 2) - 2;

                    if (this._visBin) {
                        this._visBin.set_width(-1);
                        this._visBin.show();
                    }
                    baseMinW += actualVisW;
                } else {
                    if (this._visBin) {
                        this._visBin.hide();
                    }
                }
                if (this._vinylBin) this._vinylBin.set_width(100);

                let minWLimit = baseMinW;
                let menuW;

                if (this._settings.get_boolean('popup-use-custom-width')) {
                    menuW = Math.max(this._settings.get_int('popup-custom-width'), minWLimit);
                } else {
                    menuW = Math.min(Math.max(natW > 0 ? natW : minWLimit, minWLimit), 600);
                }

                menuW = Math.round(menuW);

                let menuH = Math.round(natH > 0 ? natH : 260);
                if (menuH % 2 !== 0) menuH++;

                if (!this._initialWidthSet) {
                    currentW = menuW;
                    this._initialWidthSet = true;
                }

                if (currentW > 0 && Math.abs(menuW - currentW) < 20) {
                    menuW = currentW;
                }

                let pill = this._controller._pill;
                if (!pill || !pill.get_parent()) return GLib.SOURCE_REMOVE;

                let px, py, pw, ph;
                if (this._lastPillRect) {
                    px = this._lastPillRect.x;
                    py = this._lastPillRect.y;
                    pw = this._lastPillRect.width;
                    ph = this._lastPillRect.height;
                } else {
                    [px, py] = pill._body.get_transformed_position();
                    [pw, ph] = pill._body.get_transformed_size();
                }

                let monitor = Main.layoutManager.findMonitorForActor(pill);
                if (!monitor) return GLib.SOURCE_REMOVE;

                px = Math.round(px); py = Math.round(py);
                pw = Math.round(pw); ph = Math.round(ph);

                let targetX, targetY;

                if (pill._isSidePanel) {
                    let isLeftEdge = (px < monitor.x + (monitor.width / 2));

                    targetY = Math.round(py + (ph / 2) - (menuH / 2));
                    if (targetY < monitor.y + 10) targetY = monitor.y + 10;
                    if (targetY + menuH > monitor.y + monitor.height - 10) targetY = monitor.y + monitor.height - menuH - 10;

                    if (isLeftEdge) {
                        targetX = Math.round(px + pw + 15);
                    } else {
                        targetX = Math.round(px - menuW - 15);
                    }

                    if (targetX < monitor.x + 10) targetX = monitor.x + 10;
                    if (targetX + menuW > monitor.x + monitor.width - 10) targetX = monitor.x + monitor.width - menuW - 10;

                } else {
                    targetX = Math.round(px + (pw / 2) - (menuW / 2));
                    if (targetX < monitor.x + 10) targetX = monitor.x + 10;
                    else if (targetX + menuW > monitor.x + monitor.width - 10) targetX = monitor.x + monitor.width - menuW - 10;

                    targetY = Math.round(py);
                    if (targetY + menuH > monitor.y + monitor.height - 10) targetY = monitor.y + monitor.height - menuH - 10;
                }

                let isCurrentlySafe = (currentX >= monitor.x + 10 && (currentX + menuW) <= (monitor.x + monitor.width - 10));

                if (isCurrentlySafe && Math.abs(targetX - currentX) < 40) targetX = currentX;
                if (isCurrentlySafe && Math.abs(targetY - currentY) < 40) targetY = currentY;

                if (currentW === menuW && currentX === targetX && currentY === targetY) {
                    this._isOpening = false;
                    return GLib.SOURCE_REMOVE;
                }

                if (this._isOpening) {
                    this._isOpening = false;
                    this._box.remove_all_transitions();
                    this._box.ease({
                        width: menuW,
                        height: menuH,
                        x: targetX,
                        y: targetY,
                        duration: 400,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onStopped: () => {
                            if (this._box) this._box.set_size(menuW, menuH);
                        }
                    });
                    return GLib.SOURCE_REMOVE;
                }

                this._box.remove_all_transitions();
                this._box.ease({
                    width: menuW,
                    height: menuH,
                    x: targetX,
                    y: targetY,
                    duration: 300,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => {
                        if (this._box) this._box.set_size(menuW, menuH);
                    }
                });

                return GLib.SOURCE_REMOVE;
            });
        }
    });
