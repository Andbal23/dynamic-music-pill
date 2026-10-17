import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { disableDockAutohide, restoreDockAutohide, getPlayerIcon } from './utils.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { _addBtnPressAnim } from './uiWidgets.js';
import { ActorBlurController } from './blurHelper.js';

export const PlayerSelectorMenu = GObject.registerClass(
    class PlayerSelectorMenu extends St.Widget {
        _init(controller) {
            let [bgW, bgH] = global.display.get_size();
            super._init({ width: bgW, height: bgH, reactive: true, can_focus: true, visible: false, x: 0, y: 0 });

            this._controller = controller;
            this._settings = controller._settings;

            this._backgroundBtn = new St.Button({ style: 'background-color: transparent;', reactive: true, x_expand: true, y_expand: true, width: bgW, height: bgH });
            this._backgroundBtn.connectObject('clicked', () => { this.hide(); }, this);
            this._backgroundBtn.connectObject('button-release-event', (actor, event) => {
                if (event.get_button() === 8) { this.hide(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this.connectObject('key-press-event', (actor, event) => {
                if (event.get_key_symbol() === Clutter.KEY_Escape) { this.hide(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this._backgroundBtn.connectObject('scroll-event', (actor, event) => {
                let dir = event.get_scroll_direction();
                if (dir === Clutter.ScrollDirection.SMOOTH) {
                    let [dx, dy] = event.get_scroll_delta();
                    if (Math.abs(dx) > Math.abs(dy) && dx > 0.3) { this.hide(); return Clutter.EVENT_STOP; }
                } else if (dir === Clutter.ScrollDirection.RIGHT) {
                    this.hide();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);
            this.add_child(this._backgroundBtn);

            this._blurBackdrop = new St.Widget({
                name: 'player-menu-blur-backdrop',
                reactive: false,
                visible: false
            });
            this.add_child(this._blurBackdrop);

            this._box = new St.BoxLayout({ reactive: true });
            this._box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
            this.add_child(this._box);

            this._blurBackdrop.add_constraint(new Clutter.BindConstraint({
                source: this._box,
                coordinate: Clutter.BindCoordinate.ALL,
            }));

            this._box.connectObject(
                'notify::translation-x', () => {
                    if (this._blurBackdrop && this._box) this._blurBackdrop.translation_x = this._box.translation_x;
                },
                'notify::translation-y', () => {
                    if (this._blurBackdrop && this._box) this._blurBackdrop.translation_y = this._box.translation_y;
                },
                'notify::scale-x', () => {
                    if (this._blurBackdrop && this._box) this._blurBackdrop.scale_x = this._box.scale_x;
                },
                'notify::scale-y', () => {
                    if (this._blurBackdrop && this._box) this._blurBackdrop.scale_y = this._box.scale_y;
                },
                this
            );

            this.connectObject(
                'notify::opacity', () => {
                    if (this._blurController) {
                        this._blurController.setOpacityFactor(this.opacity / 255.0);
                    }
                },
                this
            );

            this._blurController = new ActorBlurController(
                this._blurBackdrop,
                () => 20,
                () => this._settings.get_int('blur-sigma'),
                'popup',
                () => this._settings.get_boolean('bms-follow-pipeline')
            );

            this._settings.connectObject(
                'changed::enable-blur-popup', () => {
                    if (this.visible) {
                        let pill = this._controller._getAnchorPill ? this._controller._getAnchorPill() : this._controller._pill;
                        let c = pill ? pill._displayedColor : null;
                        this._updateStyle(c ? c.r : null, c ? c.g : null, c ? c.b : null);
                    }
                },
                'changed::blur-blend-color', () => {
                    if (this.visible) {
                        let pill = this._controller._getAnchorPill ? this._controller._getAnchorPill() : this._controller._pill;
                        let c = pill ? pill._displayedColor : null;
                        this._updateStyle(c ? c.r : null, c ? c.g : null, c ? c.b : null);
                    }
                },
                'changed::blur-sigma', () => {
                    if (this._blurController) this._blurController.updateSigma(this._settings.get_int('blur-sigma'));
                },
                'changed::bms-follow-pipeline', () => {
                    if (this._blurController) this._blurController._refreshEffect();
                },
                this
            );

            this._box.connectObject('enter-event', () => {
                if (this._leaveHideTimeoutId) {
                    GLib.Source.remove(this._leaveHideTimeoutId);
                    this._leaveHideTimeoutId = null;
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this._box.connectObject('leave-event', () => {
                if (this._settings.get_boolean('popup-hide-on-leave')) {
                    if (this._leaveHideTimeoutId) {
                        GLib.Source.remove(this._leaveHideTimeoutId);
                    }
                    this._leaveHideTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 300, () => {
                        this._leaveHideTimeoutId = null;
                        this.hide();
                        return GLib.SOURCE_REMOVE;
                    });
                }
                return Clutter.EVENT_PROPAGATE;
            }, this);

            this._box.connectObject('button-release-event', (actor, event) => {
                if (event.get_button() === 8) { this.hide(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
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
                if (doBack) { this.hide(); return Clutter.EVENT_STOP; }
                return Clutter.EVENT_PROPAGATE;
            }, this);

        }

        destroy() {
            this._cleanup();
            super.destroy();
        }

        _cleanup() {
            if (this._leaveHideTimeoutId) {
                GLib.Source.remove(this._leaveHideTimeoutId);
                this._leaveHideTimeoutId = null;
            }
            if (this._blurController) {
                this._blurController.destroy();
                this._blurController = null;
            }
            if (this._blurBackdrop) {
                this._blurBackdrop.destroy();
                this._blurBackdrop = null;
            }
            this._settings.disconnectObject(this);
            this.disconnectObject(this);
        }

        populate() {
            this._box.destroy_all_children();

            let isBlurActive = this._settings.get_boolean('enable-blur-popup');
            let blurBlend = this._settings.get_boolean('blur-blend-color');
            let isLightMode = this._settings.get_boolean('light-mode');
            let defChan = isLightMode ? 242 : 40;
            let pill = this._controller._pill;
            let c = pill ? pill._displayedColor : { r: defChan, g: defChan, b: isLightMode ? 245 : 40 };
            let r = c.r, g = c.g, b = c.b;

            if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-bg')) {
                let customBg = this._settings.get_string('custom-bg-color').split(',');
                r = parseInt(customBg[0]) || 40;
                g = parseInt(customBg[1]) || 40;
                b = parseInt(customBg[2]) || 40;
            }

            if (isBlurActive && !blurBlend) {
                r = isLightMode ? 242 : 25;
                g = isLightMode ? 242 : 25;
                b = isLightMode ? 245 : 25;
            }

            let brightness = (r * 299 + g * 587 + b * 114) / 1000;
            let isLightBg = brightness > 160;
            let selBg = isLightBg ? 'rgba(0,0,0,0.14)' : 'rgba(255,255,255,0.2)';
            let hovBg = isLightBg ? 'rgba(0,0,0,0.09)' : 'rgba(255,255,255,0.15)';
            let normBg = isLightBg ? 'rgba(0,0,0,0.04)' : 'rgba(255,255,255,0.05)';

            let textColorStyle = '';
            if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-text')) {
                let customTextStr = this._settings.get_string('custom-text-color');
                textColorStyle = `color: rgb(${customTextStr});`;
            } else if (isLightBg) {
                textColorStyle = `color: rgb(28, 28, 30);`;
            } else {
                textColorStyle = `color: rgb(255, 255, 255);`;
            }

            let titleLabel = new St.Label({
                text: _('Select Media Player'),
                style: `font-weight: bold; margin-bottom: 15px; font-size: 12pt; ${textColorStyle}`,
                x_align: Clutter.ActorAlign.CENTER
            });
            this._box.add_child(titleLabel);

            let currentSelected = this._settings.get_string('selected-player-bus');

            if (!this._settings.get_boolean('hide-auto-smart-selection')) {
                // ==== Auto (Smart Selection) Button ====
                let autoContent = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, style: 'spacing: 12px;' });
                let autoIcon = new St.Icon({ icon_name: 'emblem-system-symbolic', icon_size: 24, style: textColorStyle });
                let autoLabel = new St.Label({ text: _('Auto (Smart Selection)'), y_align: Clutter.ActorAlign.CENTER, style: textColorStyle });
                autoContent.add_child(autoIcon);
                autoContent.add_child(autoLabel);

                let autoBtn = new St.Button({
                    child: autoContent,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    x_expand: true,
                    style: `margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${currentSelected === '' ? selBg : normBg}; transition-duration: 150ms;`
                });
                _addBtnPressAnim(autoBtn);

                const selectAuto = () => {
                    this._settings.set_string('selected-player-bus', '');
                    this._controller._updateUI();
                    this.hide();
                };

                autoBtn.connectObject('clicked', selectAuto, this);
                autoBtn.connectObject('touch-event', (actor, event) => {
                    let type = event.type();
                    if (type === Clutter.EventType.TOUCH_END) {
                        selectAuto();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, this);

                autoBtn.connectObject('notify::hover', () => {
                    if (this._settings.get_string('selected-player-bus') === '') return;
                    autoBtn.set_style(`margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${autoBtn.hover ? hovBg : normBg}; transition-duration: 150ms;`);
                }, this);

                this._box.add_child(autoBtn);
            }

            // ==== Aktive Players Button ====
            for (let [busName, proxy] of this._controller._proxies) {

                let rawAppName = busName.replace('org.mpris.MediaPlayer2.', '').split('.')[0];
                let identity = (proxy._identity || (rawAppName.charAt(0).toUpperCase() + rawAppName.slice(1))).replace(/\b\w/g, c => c.toUpperCase());
                let btnContent = new St.BoxLayout({ orientation: Clutter.Orientation.HORIZONTAL, style: 'spacing: 12px;' });

                let icon = new St.Icon({
                    gicon: proxy._gicon || getPlayerIcon(proxy, busName),
                    fallback_icon_name: 'audio-x-generic-symbolic',
                    icon_size: 24,
                    style: textColorStyle
                });
                let label = new St.Label({ text: identity, y_align: Clutter.ActorAlign.CENTER, style: textColorStyle });

                btnContent.add_child(icon);
                btnContent.add_child(label);

                let isSelected = (currentSelected === busName);
                let btn = new St.Button({
                    child: btnContent,
                    reactive: true,
                    can_focus: true,
                    track_hover: true,
                    x_expand: true,
                    style: `margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${isSelected ? selBg : normBg}; transition-duration: 150ms;`
                });
                _addBtnPressAnim(btn);

                btn.connectObject('button-release-event', (a, e) => {
                    if (e.get_button() === 8) return Clutter.EVENT_PROPAGATE;
                    return Clutter.EVENT_PROPAGATE;
                }, this);
                btn.connectObject('clicked', () => {
                    this._settings.set_string('selected-player-bus', busName);
                    this._controller._updateUI();
                    this.hide();
                }, this);

                btn.connectObject('touch-event', (actor, event) => {
                    let type = event.type();
                    if (type === Clutter.EventType.TOUCH_END) {
                        this._settings.set_string('selected-player-bus', busName);
                        this._controller._updateUI();
                        this.hide();
                        return Clutter.EVENT_STOP;
                    }
                    return Clutter.EVENT_PROPAGATE;
                }, this);

                btn.connect('notify::hover', () => {
                    if (this._settings.get_string('selected-player-bus') === busName) return;
                    btn.set_style(`margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${btn.hover ? hovBg : normBg}; transition-duration: 150ms;`);
                });

                this._box.add_child(btn);
            }
        }

        _updateStyle(r, g, b) {
            let isBlurActive = this._settings.get_boolean('enable-blur-popup');
            let blurBlend = this._settings.get_boolean('blur-blend-color');
            let isLightMode = this._settings.get_boolean('light-mode');
            let defChan = isLightMode ? 242 : 40;

            let finalAlpha = 0.95;
            let enableTrans = this._settings.get_boolean('enable-transparency');

            if (isBlurActive) {
                if (blurBlend) {
                    finalAlpha = isLightMode ? 0.58 : 0.45;
                } else {
                    finalAlpha = isLightMode ? 0.65 : 0.50;
                }
            } else if (enableTrans) {
                finalAlpha = this._settings.get_int('transparency-strength') / 100.0;
            }

            let safeR = (typeof r === 'number' && !isNaN(r)) ? Math.floor(r) : defChan;
            let safeG = (typeof g === 'number' && !isNaN(g)) ? Math.floor(g) : defChan;
            let safeB = (typeof b === 'number' && !isNaN(b)) ? Math.floor(b) : (isLightMode ? 245 : 40);

            if (!isBlurActive || blurBlend) {
                if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-bg')) {
                    let customBg = this._settings.get_string('custom-bg-color').split(',');
                    safeR = parseInt(customBg[0]) || 40;
                    safeG = parseInt(customBg[1]) || 40;
                    safeB = parseInt(customBg[2]) || 40;
                }
            } else {
                safeR = isLightMode ? 242 : 25;
                safeG = isLightMode ? 242 : 25;
                safeB = isLightMode ? 245 : 25;
            }

            let bgStyle = `background-color: rgba(${safeR}, ${safeG}, ${safeB}, ${finalAlpha});`;

            let brightness = (safeR * 299 + safeG * 587 + safeB * 114) / 1000;
            let isLightBg = brightness > 160;
            let borderRgb = (isLightBg && !isBlurActive) ? '0,0,0' : '255,255,255';
            let borderOp = isBlurActive ? (isLightBg ? 0.45 : 0.22) : (isLightBg ? 0.12 : Math.min(0.1, finalAlpha * 0.2));
            let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(${borderRgb},${borderOp});`;

            let shadowStyle = isBlurActive ? 'box-shadow: none;' : 'box-shadow: 0px 8px 30px rgba(0,0,0,0.5);';
            this._box.set_style(`${bgStyle} ${borderStyle} padding: 15px; border-radius: 20px; ${shadowStyle}`);

            if (this._blurBackdrop) {
                if (isBlurActive) {
                    this._blurBackdrop.set_style('border-radius: 20px; background-color: transparent;');
                    this._blurBackdrop.opacity = 255;
                    this._blurBackdrop.show();
                    if (this._blurController) {
                        this._blurController.enable();
                        this._blurController.updateRadius(20);
                        this._blurController.updateSigma();
                    }
                } else {
                    this._blurBackdrop.hide();
                    if (this._blurController) this._blurController.disable();
                }
            }
        }

        showMenu() {
            disableDockAutohide();
            this.populate();
            this.visible = true;
            this.opacity = 0;
            this.grab_key_focus();
            this.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

            let pill = this._controller._getAnchorPill ? this._controller._getAnchorPill() : this._controller._pill;
            if (!pill || !pill.get_parent()) {
                this.hide();
                return;
            }
            let [px, py] = pill.get_transformed_position();
            let [pw, ph] = pill.get_transformed_size();
            let monitor = Main.layoutManager.findMonitorForActor(pill);

            let isLightMode = this._settings.get_boolean('light-mode');
            let defChan = isLightMode ? 242 : 40;
            let c = pill._displayedColor || { r: defChan, g: defChan, b: isLightMode ? 245 : 40 };

            let r = c.r, g = c.g, b = c.b;
            if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-bg')) {
                let customBg = this._settings.get_string('custom-bg-color').split(',');
                r = parseInt(customBg[0]) || 40;
                g = parseInt(customBg[1]) || 40;
                b = parseInt(customBg[2]) || 40;
            }

            this._updateStyle(r, g, b);

            this._box.set_width(-1);
            let [minW, natW] = this._box.get_preferred_width(-1);
            let menuW = Math.round(Math.max(natW, 200));
            if (menuW % 2 !== 0) menuW++;

            let [minH, natH] = this._box.get_preferred_height(menuW);
            let menuH = Math.round(natH);
            if (menuH % 2 !== 0) menuH++;

            px = Math.round(px); py = Math.round(py);
            pw = Math.round(pw); ph = Math.round(ph);

            let startX, startY;

            if (pill._isSidePanel) {
                let isLeftEdge = (px < monitor.x + (monitor.width / 2));
                startY = Math.round(py + (ph / 2) - (menuH / 2));
                if (startY < monitor.y + 10) startY = monitor.y + 10;
                if (startY + menuH > monitor.y + monitor.height - 10) startY = monitor.y + monitor.height - menuH - 10;

                if (isLeftEdge) {
                    startX = Math.round(px + pw + 15);
                } else {
                    startX = Math.round(px - menuW - 15);
                }
            } else {
                startX = Math.round(px + (pw / 2) - (menuW / 2));
                if (monitor) {
                    if (startX < monitor.x + 10) startX = monitor.x + 10;
                    else if (startX + menuW > monitor.x + monitor.width - 10) startX = monitor.x + monitor.width - menuW - 10;
                }

                let isTopEdge = (py < monitor.y + (monitor.height / 2));
                if (isTopEdge) {
                    startY = Math.round(py + ph + 15);
                } else {
                    startY = Math.round(py - menuH - 15);
                }
            }

            this._box.set_position(startX, startY);
            this._box.set_width(menuW);
            if (this._blurBackdrop) {
                this._blurBackdrop.set_position(startX, startY);
                this._blurBackdrop.set_size(menuW, menuH);
            }
        }

        hide() {
            if (this._isHiding) return;
            restoreDockAutohide();

            if (this._leaveHideTimeoutId) {
                GLib.Source.remove(this._leaveHideTimeoutId);
                this._leaveHideTimeoutId = null;
            }

            this._isHiding = true;
            this.ease({
                opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: () => {
                    this.visible = false;
                    this._isHiding = false;
                    if (this._blurController) this._blurController.disable();
                    if (this._blurBackdrop) this._blurBackdrop.hide();
                    if (this._controller) this._controller.closePlayerMenu();
                }
            });
        }
    });
