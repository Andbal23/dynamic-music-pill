import GdkPixbuf from 'gi://GdkPixbuf';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { formatTime, getAverageColor, smartUnpack } from './utils.js';

export const CrossfadeArt = GObject.registerClass(
class CrossfadeArt extends St.Widget {
    _init() {
        super._init({ layout_manager: new Clutter.BinLayout(), style_class: 'art-widget', clip_to_allocation: false, x_expand: false, y_expand: false });
        this._radius = 10;
        this._shadowCSS = 'box-shadow: none;';
        const layerStyle = 'background-size: cover;';
        this._layerA = new St.Widget({ x_expand: true, y_expand: true, opacity: 255, style: layerStyle });
        this._layerB = new St.Widget({ x_expand: true, y_expand: true, opacity: 0, style: layerStyle });
        this.add_child(this._layerA);
        this.add_child(this._layerB);
        this._activeLayer = this._layerA;
        this._nextLayer = this._layerB;
    }

    setRadius(r) {
        this._radius = (typeof r === 'number' && !isNaN(r)) ? r : 10;
        this._refreshLayerStyle(this._layerA);
        this._refreshLayerStyle(this._layerB);
    }

    setShadowStyle(cssString) {
        this._shadowCSS = cssString || 'box-shadow: none;';
        this._refreshLayerStyle(this._layerA);
        this._refreshLayerStyle(this._layerB);
    }

    _refreshLayerStyle(layer) {
        if (!layer) return;
        let url = layer._bgUrl;
        let bgPart = url ? `background-image: url("${url}");` : '';
        let safeR = (typeof this._radius === 'number' && !isNaN(this._radius)) ? this._radius : 10;
        let activeShadow = (url && url.length > 0) ? this._shadowCSS : 'box-shadow: none;';
        let newCss = `border-radius: ${safeR}px; background-size: cover; ${activeShadow} ${bgPart}`;
        if (layer._lastCss === newCss) return;
        layer._lastCss = newCss;
        layer.set_style(newCss);
    }

    setArt(newUrl, force = false) {
        let isVisible = (this._activeLayer.opacity > 250);
        if (!force && this._currentUrl === newUrl && isVisible) return;
        this._currentUrl = newUrl;
        this._nextLayer._bgUrl = newUrl;
        this._refreshLayerStyle(this._nextLayer);
        this._nextLayer.opacity = 0;
        this._nextLayer.show();
        this.set_child_below_sibling(this._nextLayer, this._activeLayer);
        this._activeLayer.remove_all_transitions();
        
        // 46-os scroll/anim fix: onStopped
        this._activeLayer.ease({
            opacity: 0, duration: 600, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: (isFinished) => {
                if (!isFinished) return;
                let temp = this._activeLayer;
                this._activeLayer = this._nextLayer;
                this._nextLayer = temp;
                this._nextLayer.opacity = 0;
            }
        });
        this._nextLayer.opacity = 255;
    }
});

export const ScrollLabel = GObject.registerClass(
class ScrollLabel extends St.Widget {
    _init(styleClass, settings) {
        super._init({ layout_manager: new Clutter.BinLayout(), x_expand: true, y_expand: false, clip_to_allocation: true });
        this._settings = settings;
        this._text = "";
        this._gameMode = false;
        this._container = new St.BoxLayout({ vertical: false });
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
            if (this._resizeTimer) { GLib.source_remove(this._resizeTimer); this._resizeTimer = null; }
            this._resizeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._resizeTimer = null;
                if (this.has_allocation()) this._checkResize();
                return GLib.SOURCE_REMOVE;
            });
        }, this);
    }
    setLabelStyle(css) {
        if (this._label1) this._label1.set_style(css);
        if (this._label2) this._label2.set_style(css);
    }

    destroy() {
        this._stopAnimation();
        if (this._resizeTimer) { GLib.source_remove(this._resizeTimer); this._resizeTimer = null; }
        if (this._measureTimeout) { GLib.source_remove(this._measureTimeout); this._measureTimeout = null; }
        super.destroy();
    }

    setGameMode(active) {
        this._gameMode = active;
        if (active) this._stopAnimation();
        else this._checkResize();
    }

    _checkResize() {
        if (!this._text || this._gameMode || !this.get_parent()) return;
        let boxWidth = this.get_allocation_box().get_width();
        if (boxWidth <= 1) return;
        this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        let textWidth = this._label1.get_preferred_width(-1)[1];
        let needsScroll = (textWidth > boxWidth) && this._settings.get_boolean('scroll-text');
        let isScrolling = (this._scrollTimer != null);

        if (needsScroll && !isScrolling) this._startInfiniteScroll(textWidth);
        else if (!needsScroll && isScrolling) {
            this._stopAnimation();
            this._label2.hide();
            this._separator.hide();
            this._label1.clutter_text.ellipsize = (textWidth > boxWidth) ? Pango.EllipsizeMode.END : Pango.EllipsizeMode.NONE;
        }
    }

    setText(text, force = false) {
        if (!force && this._text === text) return;
        this._text = text || "";
        this._stopAnimation();
        this._label1.text = this._text;
        this._label2.text = this._text;
        this._label2.hide();
        this._separator.hide();

        if (!this._settings.get_boolean('scroll-text')) {
            this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            return;
        }
        this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
        if (this._measureTimeout) { GLib.source_remove(this._measureTimeout); this._measureTimeout = null; }
        this._measureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._measureTimeout = null;
            if (this.has_allocation()) this._checkOverflow();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopAnimation() {
        this._container.remove_all_transitions();
        this._container.translation_x = 0;
        if (this._scrollTimer) { GLib.source_remove(this._scrollTimer); this._scrollTimer = null; }
    }

    _checkOverflow() {
        if (!this._settings.get_boolean('scroll-text') || this._gameMode || !this.get_parent()) return;
        let boxWidth = this.get_allocation_box().get_width();
        if (boxWidth <= 1) return;
        let textWidth = this._label1.get_preferred_width(-1)[1];
        if (textWidth > boxWidth) this._startInfiniteScroll(textWidth);
        else this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
    }

    _startInfiniteScroll(textWidth) {
        this._stopAnimation();
        this._label2.show();
        this._separator.show();
        const distance = textWidth + 30;
        const duration = (distance / 30) * 1000;
        
        const loop = () => {
            if (this._gameMode || !this.get_parent()) return; 
            if (this._scrollTimer) GLib.source_remove(this._scrollTimer);
            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._scrollTimer = null; 
                if (this._gameMode || !this.get_parent()) return GLib.SOURCE_REMOVE;
                this._container.ease({
                    translation_x: -distance, duration: duration, mode: Clutter.AnimationMode.LINEAR,
                    onStopped: (isFinished) => {
                        if (!isFinished || this._gameMode) return; 
                        this._container.translation_x = 0;
                        loop();
                    }
                });
                return GLib.SOURCE_REMOVE;
            });
        };
        loop();
    }
});

export const WaveformVisualizer = GObject.registerClass(
class WaveformVisualizer extends St.BoxLayout {
    _init() {
        super._init({ vertical: false, style: 'spacing: 3px;', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END });
        this.set_height(22);
        this._bars = [];
        this._color = '255,255,255';
        this._mode = 1;
        this._isPlaying = false;
        this._timerId = null;

        for (let i = 0; i < 4; i++) {
            let bar = new St.Widget({ style_class: 'visualizer-bar' });
            bar.set_size(3, 20);
            bar.set_pivot_point(0.5, 1.0);
            this.add_child(bar);
            this._bars.push(bar);
        }
        this._updateBarsCss();
    }

    destroy() {
        if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null; }
        super.destroy();
    }

    setMode(m) {
        this._mode = m;
        let pivotY = (m === 2) ? 0.5 : 1.0;
        this._bars.forEach(bar => { bar.set_pivot_point(0.5, pivotY); });
    }

    setColor(c) {
        let r = 255, g = 255, b = 255;
        if (c && typeof c.r === 'number' && !isNaN(c.r)) r = Math.min(255, c.r + 100);
        if (c && typeof c.g === 'number' && !isNaN(c.g)) g = Math.min(255, c.g + 100);
        if (c && typeof c.b === 'number' && !isNaN(c.b)) b = Math.min(255, c.b + 100);
        this._color = `${Math.floor(r)},${Math.floor(g)},${Math.floor(b)}`;
        this._updateBarsCss();
        if (!this._isPlaying) this._updateVisuals(0);
    }

    setPlaying(playing) {
        if (this._isPlaying === playing) return;
        this._isPlaying = playing;

        this._updateBarsCss();

        if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null; }

        if (playing && this._mode !== 0) {
            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (!this.get_parent()) return GLib.SOURCE_REMOVE;
                let t = Date.now() / 250;
                this._updateVisuals(t);
                return GLib.SOURCE_CONTINUE;
            });
        } else {
            this._updateVisuals(0);
        }
    }

    _updateBarsCss() {
        let opacity = this._isPlaying ? 1.0 : 0.4;
        let css = `background-color: rgba(${this._color}, ${opacity}); border-radius: 2px;`;
        this._bars.forEach(bar => {
            bar.set_style(css);
        });
    }


    _updateVisuals(t) {
        if (!this.get_parent()) return;

        this._bars.forEach((bar, idx) => {
            let scaleY = 0.2;

            if (this._isPlaying) {
                if (this._mode === 1) {
                    let wave = (Math.sin(t - idx * 1.0) + 1) / 2;
                    scaleY = 0.3 + (wave * 0.7);
                }
                else if (this._mode === 2) {
                    let speeds = [1.1, 1.6, 1.3, 1.8];
                    let pulse = (Math.sin(t * speeds[idx]) + 1) / 2;
                    scaleY = 0.3 + (pulse * 0.7);
                }
            }

            bar.scale_y = scaleY;
        });
    }
});

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
            style: 'background-color: transparent;',
            reactive: true,
            x_expand: true,
            y_expand: true,
            width: bgW,
            height: bgH
        });
        this._backgroundBtn.connectObject('clicked', () => { this.hide(); }, this);
        this.add_child(this._backgroundBtn);

        this._box = new St.BoxLayout({
            style_class: 'music-pill-expanded',
            vertical: true,
            reactive: true
        });
        this._box.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);
        this.add_child(this._box);

        let topRow = new St.BoxLayout({ style_class: 'expanded-top-row', vertical: false, y_align: Clutter.ActorAlign.CENTER });

        this._vinyl = new St.Widget({
            style_class: 'vinyl-container',
            layout_manager: new Clutter.BinLayout(),
            width: 100,
            height: 100
        });
        this._vinyl.set_pivot_point(0.5, 0.5);

        this._artBottom = new St.Widget({ style: 'background-size: cover; border-radius: 50px;', width: 100, height: 100, opacity: 255 });
        this._artTop = new St.Widget({ style: 'background-size: cover; border-radius: 50px;', width: 100, height: 100, opacity: 0 });

        this._vinyl.add_child(this._artBottom);
        this._vinyl.add_child(this._artTop);
        this._topIsActive = false;

        this._vinylBin = new St.Bin({
            child: this._vinyl,
            width: 100,
            height: 100,
            x_expand: false,
            y_expand: false
        });
        topRow.add_child(this._vinylBin);

        let infoBox = new St.BoxLayout({
            style_class: 'track-info-box',
            vertical: true,
            y_align: Clutter.ActorAlign.CENTER,
            x_expand: true,
            clip_to_allocation: true,
            style: 'min-width: 0px;'
        });
        this._titleLabel = new ScrollLabel('expanded-title', this._settings);
        this._artistLabel = new ScrollLabel('expanded-artist', this._settings);

        infoBox.add_child(this._titleLabel);
        infoBox.add_child(this._artistLabel);
        topRow.add_child(infoBox);
        this._box.add_child(topRow);

        let progressBox = new St.BoxLayout({ style_class: 'progress-container', vertical: false, y_align: Clutter.ActorAlign.CENTER });
        this._currentTimeLabel = new St.Label({ style_class: 'progress-time', text: '0:00', x_align: Clutter.ActorAlign.END });
        this._totalTimeLabel = new St.Label({ style_class: 'progress-time', text: '0:00', x_align: Clutter.ActorAlign.START });

        this._sliderBin = new St.Widget({ style_class: 'progress-slider-bg', x_expand: true, reactive: true, y_align: Clutter.ActorAlign.CENTER });
        this._sliderFill = new St.Widget({ style_class: 'progress-slider-fill' });
        this._sliderBin.add_child(this._sliderFill);

        this._sliderBin.connectObject('button-release-event', (actor, event) => {
            this._handleSeek(event);
            return Clutter.EVENT_STOP;
        }, this);

        progressBox.add_child(this._currentTimeLabel);
        progressBox.add_child(this._sliderBin);
        progressBox.add_child(this._totalTimeLabel);
        this._box.add_child(progressBox);

        let controlsRow = new St.BoxLayout({ style_class: 'controls-row', vertical: false, x_align: Clutter.ActorAlign.CENTER, reactive: true });
        
        this._shuffleIcon = new St.Icon({ icon_name: 'media-playlist-shuffle-symbolic', icon_size: 16 });
        this._shuffleBtn = new St.Button({ style_class: 'control-btn-secondary', child: this._shuffleIcon, reactive: true, can_focus: true });
        this._shuffleBtn.connectObject('button-release-event', () => { this._controller.toggleShuffle(); return Clutter.EVENT_STOP; }, this);

        let prevBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 24 }), reactive: true, can_focus: true });
        prevBtn.connectObject('button-release-event', () => { this._controller.previous(); return Clutter.EVENT_STOP; }, this);

        this._playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 24 });
        let playPauseBtn = new St.Button({ style_class: 'control-btn', child: this._playPauseIcon, reactive: true, can_focus: true });
        playPauseBtn.connectObject('button-release-event', () => { this._controller.togglePlayback(); return Clutter.EVENT_STOP; }, this);

        let nextBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 24 }), reactive: true, can_focus: true });
        nextBtn.connectObject('button-release-event', () => { this._controller.next(); return Clutter.EVENT_STOP; }, this);

        this._repeatIcon = new St.Icon({ icon_name: 'media-playlist-repeat-symbolic', icon_size: 16 });
        this._repeatBtn = new St.Button({ style_class: 'control-btn-secondary', child: this._repeatIcon, reactive: true, can_focus: true });
        this._repeatBtn.connectObject('button-release-event', () => { this._controller.toggleLoop(); return Clutter.EVENT_STOP; }, this);

        controlsRow.add_child(this._shuffleBtn);
        controlsRow.add_child(prevBtn);
        controlsRow.add_child(playPauseBtn);
        controlsRow.add_child(nextBtn);
        controlsRow.add_child(this._repeatBtn);

        this._box.add_child(controlsRow);
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

        let bgStyle = `background-color: rgba(${safeR}, ${safeG}, ${safeB}, ${finalAlpha});`;

        let shadowOp = Math.min(0.5, finalAlpha);
        let shadowStyle = useShadow ? `box-shadow: 0px 8px 30px rgba(0,0,0,${shadowOp});` : 'box-shadow: none;';

        let borderOp = Math.min(0.1, finalAlpha * 0.2);
        let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255,255,255,${borderOp});`;

        let css = `${bgStyle} ${borderStyle} border-radius: ${radius}px; padding: 20px; ${shadowStyle} min-width: 320px; max-width: 600px;`;

        if (this._lastPopupCss !== css) {
            this._lastPopupCss = css;
            this._box.set_style(css);
        }

        if (this._vinylBin) this._vinylBin.opacity = 255;
        if (this._titleLabel) this._titleLabel.opacity = 255;
        if (this._artistLabel) this._artistLabel.opacity = 255;
    }

    updateContent(title, artist, artUrl, status) {
        if (this._titleLabel && this._titleLabel._text !== title) {
            this._titleLabel.setText(title || 'Unknown Title', false);
        }
        if (this._artistLabel && this._artistLabel._text !== artist) {
            this._artistLabel.setText(artist || 'Unknown Artist', false);
        }

        this._seekLockTime = 0;

        let trackChanged = (this._currentArtUrl !== artUrl || this._lastTrackTitle !== title);
        this._lastTrackTitle = title;

        let showVinyl = this._settings.get_boolean('popup-show-vinyl');
        if (!artUrl || !showVinyl) {
            this._vinylBin.hide();
            this._stopVinyl();
            this._currentArtUrl = null;
        } else {
            this._vinylBin.show();
            let isSquare = this._settings.get_boolean('popup-vinyl-square');
            let radius = isSquare ? 12 : 50;
            let newClass = isSquare ? 'vinyl-container-square' : 'vinyl-container';
            
            if (this._vinyl.get_style_class_name() !== newClass) {
                this._vinyl.set_style_class_name(newClass);
            }
            
            if (trackChanged) {
                this._currentArtUrl = artUrl;
                let bg = `url("${artUrl}")`;
                let style = `background-image: ${bg}; background-size: cover; border-radius: ${radius}px;`;

                if (this._topIsActive) {
                    this._artBottom.set_style(style);
                    this._artBottom.opacity = 255;

                    this._artTop.ease({
                        opacity: 0,
                        duration: 800,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                    this._topIsActive = false;
                } else {
                    this._artTop.set_style(style);
                    this._artTop.opacity = 0;
                    this._artTop.show();

                    this._artTop.ease({
                        opacity: 255,
                        duration: 800,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                    this._topIsActive = true;
                }
            }
        }

        if (status === 'Playing') {
            this._playPauseIcon.icon_name = 'media-playback-pause-symbolic';
            if (this._lastStatus !== 'Playing' || trackChanged) {
                this._startVinyl();
            }
        } else {
            this._playPauseIcon.icon_name = 'media-playback-start-symbolic';
            if (this._lastStatus === 'Playing') {
                this._stopVinyl();
            }
        }
        this._lastStatus = status;

        if (this.visible && trackChanged) {
            this.animateResize();
        }
        
        if (this._player) {
            let shuffle = this._player.Shuffle;
            let loop = this._player.LoopStatus;

            if (this._shuffleIcon && shuffle !== undefined) {
                this._shuffleIcon.opacity = shuffle ? 255 : 100;
            }

            if (this._repeatIcon && loop !== undefined) {
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
        let showShufLoop = this._settings.get_boolean('show-shuffle-loop');
        if (this._shuffleBtn) this._shuffleBtn.visible = showShufLoop;
        if (this._repeatBtn) this._repeatBtn.visible = showShufLoop;
    }

    showFor(player, artUrl) {
        this.setPlayer(player);
        this.visible = true;
        this.opacity = 0;
        this.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        let status = player.PlaybackStatus;
        let m = player.Metadata;
        let title = smartUnpack(m['xesam:title']);
        let artist = smartUnpack(m['xesam:artist']);
        if (Array.isArray(artist)) artist = artist.join(', ');

        this.updateContent(title, artist, artUrl, status);

        if (this._controller && this._controller._connection) {
            this._controller._connection.call(
                player._busName,
                '/org/mpris/MediaPlayer2',
                'org.freedesktop.DBus.Properties',
                'Get',
                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                null, Gio.DBusCallFlags.NONE, -1, null,
                (conn, res) => {
                    try {
                        let result = conn.call_finish(res);
                        let val = smartUnpack(result.deep_unpack()[0]);
                        if (typeof val === 'number') {
                            player._lastPosition = val;
                            player._lastPositionTime = Date.now();
                        }
                    } catch (e) { console.debug(e.message); }
                }
            );
        }

        this._startTimer();
    }

    hide() {
        this._stopTimer();
        this._stopVinyl();
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

    destroy() {
        if (this._updateTimer) { GLib.source_remove(this._updateTimer); this._updateTimer = null; }
        if (this._resizeDebounceId) { GLib.source_remove(this._resizeDebounceId); this._resizeDebounceId = null; }
        if (this._titleLabel) { this._titleLabel.destroy(); this._titleLabel = null; }
        if (this._artistLabel) { this._artistLabel.destroy(); this._artistLabel = null; }
        super.destroy();
    }

    _startTimer() {
        if (this._updateTimer) GLib.source_remove(this._updateTimer);
        this._updateTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._tick();
            return GLib.SOURCE_CONTINUE;
        });
        this._tick();
    }

    _stopTimer() {
        if (this._updateTimer) { GLib.source_remove(this._updateTimer); this._updateTimer = null; }
    }

    _tick() {
        if (!this._player || !this.get_parent()) return GLib.SOURCE_REMOVE;

        let meta = this._player.Metadata;
        let length = meta ? smartUnpack(meta['mpris:length']) : 0;
        if (length <= 0) return;

        let now = Date.now();
        if (now - this._seekLockTime < 2000) return GLib.SOURCE_CONTINUE;

        let cachedPos = this._player._lastPosition || 0;
        let lastUpdate = this._player._lastPositionTime || now;

        let currentPos = cachedPos;
        if (this._player.PlaybackStatus === 'Playing') {
            currentPos += (now - lastUpdate) * 1000;
        }
        if (currentPos > length) currentPos = length;

        this._currentTimeLabel.text = formatTime(currentPos);
        this._totalTimeLabel.text = formatTime(length);

        let percent = Math.min(1, Math.max(0, currentPos / length));
        let totalW = this._sliderBin.width;
        if (totalW > 0) {
            this._sliderFill.width = Math.max(6, totalW * percent);
        }
    }

    _handleSeek(event) {
        if (!this._player) return;
        let meta = this._player.Metadata;
        let length = meta ? smartUnpack(meta['mpris:length']) : 0;
        if (length <= 0) return;

        let [x, y] = event.get_coords();
        let [sliderX, sliderY] = this._sliderBin.get_transformed_position();
        let relX = x - sliderX;
        let width = this._sliderBin.width;

        let percent = Math.min(1, Math.max(0, relX / width));
        let targetPos = Math.floor(length * percent);

        this._seekLockTime = Date.now();
        this._player._lastPosition = targetPos;
        this._player._lastPositionTime = Date.now();

        this._currentTimeLabel.text = formatTime(targetPos);
        let totalW = this._sliderBin.width;
        if (totalW > 0) {
            this._sliderFill.width = Math.max(6, totalW * percent);
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

        this._vinyl.remove_all_transitions();
        let currentAngle = this._vinyl.rotation_angle_z || 0;

        this._vinyl.ease({
            rotation_angle_z: currentAngle + 90,
            duration: 800,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onStopped: (isFinished) => {
                if (!isFinished || !this._isSpinning || !this._vinyl) return;
                let nextAngle = this._vinyl.rotation_angle_z || 0;
                this._vinyl.ease({
                    rotation_angle_z: nextAngle + 36000,
                    duration: 350000,
                    mode: Clutter.AnimationMode.LINEAR
                });
            }
        });
    }

    _stopVinyl() {
        if (!this._vinyl || !this._isSpinning) return;
        this._isSpinning = false;

        let currentAngle = this._vinyl.rotation_angle_z || 0;
        this._vinyl.remove_all_transitions();

        this._vinyl.ease({
            rotation_angle_z: currentAngle + 90,
            duration: 800,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: (isFinished) => {
                if (isFinished && this._vinyl) {
                    this._vinyl.rotation_angle_z = this._vinyl.rotation_angle_z % 360;
                }
            }
        });
    }

    animateResize() {
        if (!this._box || !this._controller || !this._controller._pill) return;

        if (this._resizeDebounceId) {
            GLib.source_remove(this._resizeDebounceId);
            this._resizeDebounceId = null;
        }

        this._resizeDebounceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._resizeDebounceId = null;
            if (!this._box) return GLib.SOURCE_REMOVE;

            let currentW = this._box.width;
            let currentX = Math.floor(this._box.x);
            let currentY = Math.floor(this._box.y);

            this._box.set_width(-1);
            let [minW, natW] = this._box.get_preferred_width(-1);
            let [minH, natH] = this._box.get_preferred_height(natW);

            let menuW = Math.min(Math.max(natW > 0 ? natW : 320, 320), 600);
            let menuH = natH > 0 ? natH : 260;

            if (currentW > 0 && Math.abs(menuW - currentW) < 20) {
                menuW = currentW;
            }
            if (currentW > 0) this._box.set_width(currentW);

            let pill = this._controller._pill;
            let [px, py] = pill.get_transformed_position();
            let [pw, ph] = pill.get_transformed_size();
            let monitor = Main.layoutManager.findMonitorForActor(pill);

            if (!monitor) return GLib.SOURCE_REMOVE;

            let targetX = Math.floor(px + (pw / 2) - (menuW / 2));
            if (targetX < monitor.x + 10) targetX = monitor.x + 10;
            else if (targetX + menuW > monitor.x + monitor.width - 10) targetX = monitor.x + monitor.width - menuW - 10;

            let targetY;
            if (py > monitor.y + (monitor.height / 2)) {
                targetY = Math.floor(py - menuH - 15);
                if (targetY < monitor.y + 10) targetY = monitor.y + 10;
            } else {
                targetY = Math.floor(py + ph + 15);
                if (targetY + menuH > monitor.y + monitor.height - 10) targetY = monitor.y + monitor.height - menuH - 10;
            }

            let isCurrentlySafe = (currentX >= monitor.x + 10 && (currentX + menuW) <= (monitor.x + monitor.width - 10));

            if (isCurrentlySafe && Math.abs(targetX - currentX) < 40) targetX = currentX;
            if (isCurrentlySafe && Math.abs(targetY - currentY) < 40) targetY = currentY;

            if (currentW === menuW && currentX === targetX && currentY === targetY) {
                return GLib.SOURCE_REMOVE;
            }

            this._box.remove_all_transitions();
            this._box.ease({
                width: menuW,
                x: targetX,
                y: targetY,
                duration: 300,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });

            return GLib.SOURCE_REMOVE;
        });
    }
});

export const MusicPill = GObject.registerClass(
class MusicPill extends St.Widget {
  _init(controller) {
    super._init({
        style_class: 'music-pill-container',
        reactive: false,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.CENTER,
        opacity: 0,
        width: 0,
        visible: false
    });
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
    this._displayedColor = { r: 40, g: 40, b: 40 };
    this._targetColor = { r: 40, g: 40, b: 40 };
    this._colorAnimId = null;
    this._hideGraceTimer = null;

    this._lastBodyCss = null;
    this._lastLeftCss = null;
    this._lastRightCss = null;

    // UI Construction
    this._body = new St.BoxLayout({ style_class: 'pill-body', x_expand: false });
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
    this._nextBtn = new St.Button({ style_class: 'tablet-skip-btn', child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 20 }), reactive: true });
   
    this._prevBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);
    this._nextBtn.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);

    this._prevBtn.connectObject('button-release-event', () => { 
        this._controller.previous(); 
        return Clutter.EVENT_STOP; 
    }, this);
    
    this._nextBtn.connectObject('button-release-event', () => { 
        this._controller.next(); 
        return Clutter.EVENT_STOP; 
    }, this);

    this._tabletControls = new St.BoxLayout({ vertical: false, y_align: Clutter.ActorAlign.CENTER, style: 'margin-left: 6px;' });
    this._tabletControls.add_child(this._prevBtn);
    this._tabletControls.add_child(this._nextBtn);
    this._body.add_child(this._tabletControls);

    this._textWrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true, y_expand: true,
        clip_to_allocation: true,
        style: 'min-width: 10px; margin-right: 4px; margin-left: 2px;'
    });

    this._textBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.FILL,
        style: 'padding-left: 0px; padding-right: 0px;'
    });
    this._titleScroll = new ScrollLabel('music-label-title', this._settings);
    this._artistScroll = new ScrollLabel('music-label-artist', this._settings);
    this._textBox.add_child(this._titleScroll);
    this._textBox.add_child(this._artistScroll);
    this._textWrapper.add_child(this._textBox);

    this._fadeLeft = new St.Widget({
        x_expand: false, y_expand: true,
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.FILL,
    });
    this._fadeLeft.set_width(30);
    this._fadeLeft.set_z_position(9999);
    this._textWrapper.add_child(this._fadeLeft);

    this._fadeRight = new St.Widget({
        x_expand: false, y_expand: true,
        x_align: Clutter.ActorAlign.END,
        y_align: Clutter.ActorAlign.FILL,
    });
    this._fadeRight.set_width(30);
    this._fadeRight.set_z_position(9999);
    this._textWrapper.add_child(this._fadeRight);

    this._body.add_child(this._textWrapper);

    this._visualizer = new WaveformVisualizer();
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

    this.connectObject('button-release-event', (actor, event) => {
        if (!this._body) return Clutter.EVENT_STOP;
        this._body.ease({ scale_x: 1.0, scale_y: 1.0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_BACK });

        let button = event.get_button();
        let action = null;

        if (button === 1) action = this._settings.get_string('action-left-click');
        else if (button === 2) action = this._settings.get_string('action-middle-click');
        else if (button === 3) action = this._settings.get_string('action-right-click');

        if (action) {
            this._controller.performAction(action);
        }

        return Clutter.EVENT_STOP;
    }, this);

    this.connectObject('scroll-event', (actor, event) => {
        try {
            if (!this._settings.get_boolean('enable-scroll-controls')) return Clutter.EVENT_STOP;

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
                    else this._controller.next();
                } else {
                    this._animateSlide(invert ? offset : -offset);
                    if (action === 'volume') this._controller.changeVolume(false);
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
this._settings.connectObject('changed::inline-artist', () => this._updateTextDisplay(true), this);
    this._settings.connectObject('changed::use-custom-colors', () => { this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b); this._updateDimensions(); }, this);
    this._settings.connectObject('changed::custom-bg-color', () => this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b), this);
    this._settings.connectObject('changed::custom-text-color', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::tablet-mode', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::scroll-action', () => {  this._scrollDelta = 0; }, this);
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
    this._settings.connectObject('changed::border-radius', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::enable-shadow', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::shadow-opacity', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::shadow-blur', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::show-album-art', () => this._updateArtVisibility(), this);
    this._settings.connectObject('changed::visualizer-padding', () => this._updateDimensions(), this);

    this._updateTransparencyConfig();
    this._updateDimensions();
  }

  destroy() {
      if (this._colorAnimId) { GLib.source_remove(this._colorAnimId); this._colorAnimId = null; }
      if (this._artDebounceTimer) { GLib.source_remove(this._artDebounceTimer); this._artDebounceTimer = null; }
      if (this._hideGraceTimer) { GLib.source_remove(this._hideGraceTimer); this._hideGraceTimer = null; }
      if (this._titleScroll) { this._titleScroll.destroy(); this._titleScroll = null; }
      if (this._artistScroll) { this._artistScroll.destroy(); this._artistScroll = null; }
      if (this._visualizer) { this._visualizer.destroy(); this._visualizer = null; }
      super.destroy();
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

      if (active) {
          this._visualizer.setPlaying(false);
          this._titleScroll.setGameMode(true);
          this._artistScroll.setGameMode(true);
      } else {
          this._visualizer.setPlaying(this._currentStatus === 'Playing');
          this._titleScroll.setGameMode(false);
          this._artistScroll.setGameMode(false);
          if (this._isActiveState) {
              this.opacity = 255;
          }
      }
  }

  _updateArtVisibility() {
      let showSetting = this._settings.get_boolean('show-album-art');
      if (!showSetting) {
          if (this._artDebounceTimer) {
              GLib.source_remove(this._artDebounceTimer);
              this._artDebounceTimer = null;
          }
          this._artBin.visible = false;
          return;
      }

      let hasMeta = this._lastArtUrl && this._lastArtUrl.length > 0;

      if (hasMeta) {
          if (this._artDebounceTimer) {
              GLib.source_remove(this._artDebounceTimer);
              this._artDebounceTimer = null;
          }
          this._artBin.visible = true;
          this._artBin.opacity = 255;
      } else {
          if (!this._artDebounceTimer) {
              this._artDebounceTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1000, () => {
                   this._artBin.visible = false;
                   this._artWidget.setArt(null);
                   this._artDebounceTimer = null;
                   return GLib.SOURCE_REMOVE;
              });
          }
      }
  }

  _updateDimensions() {
        let target = this._settings.get_int('target-container');
        this._inPanel = (target > 0);
        
        this.set_width(-1);

        let width, height, prefArtSize;

        if (this._inPanel) {
            width = this._settings.get_int('panel-pill-width');
            height = this._settings.get_int('panel-pill-height');
            prefArtSize = this._settings.get_int('panel-art-size');
        } else {
            width = this._settings.get_int('pill-width');
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

        this._targetWidth = width;
        this._body.set_width(width);
        this._body.set_height(height);

        this.translation_y = vOffset;
        this.translation_x = hOffset;

        if (shadowEnabled) {
            this._shadowCSS = `box-shadow: 0px 2px ${shadowBlur}px rgba(0, 0, 0, ${shadowOpacity});`;
        } else {
            this._shadowCSS = `box-shadow: none;`;
        }

        let rawPadX = Math.floor((width - 160) * (10 / 140) + 4);
        this._padX = Math.max(4, Math.min(14, rawPadX));

        let artRadius = Math.max(4, this._radius - this._padY);
        let maxArtHeight = height - (2 * this._padY);
        let finalArtSize = Math.min(prefArtSize, maxArtHeight);

        this._artWidget.set_width(finalArtSize);
        this._artWidget.set_height(finalArtSize);
        this._artBin.set_width(finalArtSize);
        this._artBin.set_height(finalArtSize);

        this._artWidget.setRadius(artRadius);
        this._artWidget.setShadowStyle(this._shadowCSS);
        this._visualizer.setMode(visStyle);

        let tabletMode = this._settings.get_boolean('tablet-mode');
        
        if (tabletMode && !this._gameModeActive) {
            this._tabletControls.show();
        } else {
            this._tabletControls.hide();
        }

        if (width < 220 || visStyle === 0) {
            this._visBin.hide();
            this._visBin.set_width(0);
            this._visBin.set_style('margin: 0px;');
            this._fadeLeft.set_width(10);
            this._fadeRight.set_width(10);
            
            if (!tabletMode || this._gameModeActive) {
                let artMargin = (width < 180) ? 4 : 8;
                this._artBin.set_style(`margin-right: ${artMargin}px;`);
            } else {
                this._artBin.set_style('margin-right: 2px;');
            }
        } else {
            this._visBin.show();
            let sideMargin = this._settings.get_int('visualizer-padding');
            this._visBin.set_style(`margin-left: ${sideMargin}px;`);
            this._visBin.set_width(-1);
            this._fadeLeft.set_width(30);
            this._fadeRight.set_width(30);
            
            if (!tabletMode || this._gameModeActive) {
                this._artBin.set_style(`margin-right: ${sideMargin}px;`);
            } else {
                this._artBin.set_style('margin-right: 2px;');
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

        this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);
        
        this._updateTextDisplay();
        
        GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            if (this._titleScroll) this._titleScroll._checkResize();
            if (this._artistScroll) this._artistScroll._checkResize();
            return GLib.SOURCE_REMOVE;
        });

        if (!this._isActiveState) {
            this.visible = false;
            this.set_width(0);
            return;
        }

        this._body.set_height(height);
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

  updateDisplay(title, artist, artUrl, status, busName, isSkipActive, player = null) {
    if (!this.get_parent()) return;

    this._currentStatus = status;
    let forceUpdate = false;

    if (this._currentBusName !== busName) {
        this._currentBusName = busName;
        this._lastTitle = null;
        this._lastArtist = null;
        this._lastArtUrl = null;
        forceUpdate = true;
        if (this._hideGraceTimer) {
            GLib.source_remove(this._hideGraceTimer);
            this._hideGraceTimer = null;
        }
    }

    if (!title || status === 'Stopped') {
        if (isSkipActive) return;
        if (!this._hideGraceTimer && this._isActiveState) {
            this._hideGraceTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 5000, () => {
                if (!this.get_parent()) return GLib.SOURCE_REMOVE;

                this._isActiveState = false;
                this.reactive = false;

                let targetW = 0;
                this.ease({ opacity: 0, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                
                this._body.ease({
                    width: targetW,
                    duration: 500,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: (isFinished) => {
                        if (!isFinished) return;
                        this._lastTitle = null;
                        this._lastArtist = null;
                        this._lastArtUrl = null;
                        this._currentBusName = null;
                        this.set_width(targetW);
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
        GLib.source_remove(this._hideGraceTimer);
        this._hideGraceTimer = null;
    }

    if (!this._isActiveState || this.opacity === 0 || this.width <= 1) {
        this._isActiveState = true;
        this.reactive = true;
        this.visible = true;

        this._updateDimensions();
        let finalWidth = this._targetWidth;

        this.set_width(-1);
        this._body.set_width(0);
        this.opacity = 0;

        this.ease({
            opacity: 255,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });

        this._body.ease({
            width: finalWidth,
            duration: 500,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD
        });
    }
    let origTitle = title;
    let origArtist = artist;
    
    this._origTitle = origTitle;
    this._origArtist = origArtist;
    this._updateTextDisplay(forceUpdate);

    let isSqueezed = (this._inPanel && this._settings.get_int('panel-pill-height') < 30) || (!this._inPanel && this._settings.get_int('pill-height') < 46);
    if (this._settings.get_boolean('inline-artist') && isSqueezed && artist && title) {
        title = `${title} • ${artist}`;
        artist = null; 
    }

    if (this._lastTitle !== title || this._lastArtist !== artist || forceUpdate) {
        this._titleScroll.setText(title || 'Loading...', forceUpdate);
        this._artistScroll.setText(artist || '', forceUpdate);
        this._lastTitle = title;
        this._lastArtist = artist;
    }

    this._visualizer.setPlaying(status === 'Playing' && !this._gameModeActive);

    if (forceUpdate || artUrl !== this._lastArtUrl) {
        this._lastArtUrl = artUrl;

        if (artUrl) {
            if (this._artDebounceTimer) {
                GLib.source_remove(this._artDebounceTimer);
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
    } else {
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

      let isSqueezed = (this._inPanel && this._settings.get_int('panel-pill-height') < 30) || (!this._inPanel && this._settings.get_int('pill-height') < 46);
      if (this._settings.get_boolean('inline-artist') && isSqueezed && a && t) {
          t = `${t} • ${a}`;
          a = null; 
      }

      if (this._lastTitle !== t || this._lastArtist !== a || forceUpdate) {
          if (this._titleScroll) this._titleScroll.setText(t || 'Loading...', forceUpdate);
          if (this._artistScroll) this._artistScroll.setText(a || '', forceUpdate);
          this._lastTitle = t;
          this._lastArtist = a;
      }
  }

  _loadColorFromArt(artUrl) {
    let file = Gio.File.new_for_uri(artUrl);
    file.load_contents_async(null, (f, res) => {
        try {
            if (!this || !this.get_parent) return;
            if (this.get_parent() === null) return;

            let [ok, bytes] = f.load_contents_finish(res);
            if (ok) {
                if (!this._visualizer) return;
                let stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                let pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
                this._targetColor = getAverageColor(pixbuf);

                if (this._visualizer && this._visualizer.setColor) {
                    this._visualizer.setColor(this._targetColor);
                    this._startColorTransition();
                }
            }
        } catch (e) {
            // Nem kell try-catch log, ha csak a kép betöltés hiusult meg.
        }
    });
  }

  _startColorTransition() {
      if (this._colorAnimId) { GLib.source_remove(this._colorAnimId); this._colorAnimId = null; }
      let base = this._targetColor;
      let factor = (this._currentStatus === 'Playing') ? 0.6 : 0.4;
      let targetR = Math.floor(base.r * factor);
      let targetG = Math.floor(base.g * factor);
      let targetB = Math.floor(base.b * factor);

      let steps = 60; let count = 0;
      this._colorAnimId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 33, () => {
          if (!this.get_parent()) return GLib.SOURCE_REMOVE;
          count++;
          let progress = count / steps;
          let t = progress * progress * (3 - 2 * progress);
          let r = Math.floor(this._displayedColor.r + (targetR - this._displayedColor.r) * t);
          let g = Math.floor(this._displayedColor.g + (targetG - this._displayedColor.g) * t);
          let b = Math.floor(this._displayedColor.b + (targetB - this._displayedColor.b) * t);
          this._applyStyle(r, g, b);
          if (count >= steps) { this._displayedColor = { r: targetR, g: targetG, b: targetB }; this._colorAnimId = null; return GLib.SOURCE_REMOVE; }
          return GLib.SOURCE_CONTINUE;
      });
  }

  _applyStyle(r, g, b) {
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
      let borderOp = (this._currentStatus === 'Playing') ? 0.2 : 0.1;

      let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255, 255, 255, ${borderOp});`;
      let paddingStyle = `padding: ${safePadY}px ${safePadX}px;`;
      let radiusStyle = `border-radius: ${safeRadius}px;`;
      let shadow = this._shadowCSS ? this._shadowCSS : 'box-shadow: none;';

      let css = `${bgStyle} ${borderStyle} ${paddingStyle} ${radiusStyle} ${shadow}`;

      if (this._lastBodyCss !== css) {
          this._lastBodyCss = css;
          this._body.set_style(css);
      }

      let startColor = `rgba(${safeR}, ${safeG}, ${safeB}, ${alpha})`;
      let endColor = `rgba(${safeR}, ${safeG}, ${safeB}, 0)`;

      let gradientLeft = `background-image: linear-gradient(to right, ${startColor}, ${endColor});`;
      if (this._lastLeftCss !== gradientLeft) {
          this._lastLeftCss = gradientLeft;
          this._fadeLeft.set_style(gradientLeft);
      }

      let gradientRight = `background-image: linear-gradient(to right, ${endColor}, ${startColor});`;
      if (this._lastRightCss !== gradientRight) {
          this._lastRightCss = gradientRight;
          this._fadeRight.set_style(gradientRight);
      }

      this._displayedColor = { r: safeR, g: safeG, b: safeB };

      if (this._controller && this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
          if (this._controller._expandedPlayer.updateStyle) {
              this._controller._expandedPlayer.updateStyle(safeR, safeG, safeB, alpha);
          }
      }
  }
});
