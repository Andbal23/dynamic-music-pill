import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';

import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

// --- DEBUG HELPER & SAFE SETTER ---
function setStyleSafe(actor, css, owner) {
    if (!actor) return;
    try {
        actor.set_style(css);
    } catch (e) {
        console.log(`💥 CRASH ${owner}: ${e.message}`);
    }
}

// --- MPRIS Interface ---
const MPRIS_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read" />
    <property name="PlaybackStatus" type="s" access="read" />
    <property name="Position" type="x" access="read" />
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="SetPosition">
        <arg direction="in" type="o" name="TrackId"/>
        <arg direction="in" type="x" name="Position"/>
    </method>
    <signal name="Seeked">
      <arg type="x" name="Position"/>
    </signal>
    </interface>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <method name="Raise"/>
  </interface>
</node>`;
let NodeInfo = Gio.DBusNodeInfo.new_for_xml(MPRIS_IFACE);
let PlayerInterfaceInfo = NodeInfo.interfaces.find(i => i.name === 'org.mpris.MediaPlayer2.Player');

//const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE);

// --- Helpers ---

function smartUnpack(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof GLib.Variant) {
        try { return smartUnpack(value.deep_unpack()); } catch (e) {}
    }
    if (Array.isArray(value)) return value.map(smartUnpack);
    if (typeof value === 'object') return value;
    return value;
}

function getAverageColor(pixbuf) {
    let w = pixbuf.get_width();
    let h = pixbuf.get_height();
    let pixels = pixbuf.get_pixels();
    let rowstride = pixbuf.get_rowstride();
    let n_channels = pixbuf.get_n_channels();
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = 0; y < h; y += 20) {
      for (let x = 0; x < w; x += 20) {
        let idx = y * rowstride + x * n_channels;
        r += pixels[idx]; g += pixels[idx + 1]; b += pixels[idx + 2];
        count++;
      }
    }
    return { r: Math.floor(r / count), g: Math.floor(g / count), b: Math.floor(b / count) };
}

function formatTime(microSeconds) {
    if (!microSeconds || microSeconds < 0) return "0:00";
    let seconds = Math.floor(microSeconds / 1000000);
    let min = Math.floor(seconds / 60);
    let sec = seconds % 60;
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
}

// --- UI Komponensek ---

const CrossfadeArt = GObject.registerClass(
class CrossfadeArt extends St.Widget {
    _init() {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            style_class: 'art-widget',
            clip_to_allocation: false,
            x_expand: false,
            y_expand: false
        });
        this._radius = 10;
        this._shadowCSS = 'box-shadow: none;';
        const layerStyle = 'background-size: cover;';
        this._layerA = new St.Widget({ x_expand: true, y_expand: true, opacity: 255, style: layerStyle });
        this._layerB = new St.Widget({ x_expand: true, y_expand: true, opacity: 0, style: layerStyle });
        this._layerA._bgUrl = null;
        this._layerB._bgUrl = null;
        this._layerA._lastCss = null; // Cache
        this._layerB._lastCss = null; // Cache

        this.add_child(this._layerA);
        this.add_child(this._layerB);
        this._activeLayer = this._layerA;
        this._nextLayer = this._layerB;
        this._currentUrl = null;
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

        setStyleSafe(layer, newCss, 'CrossfadeArt Layer');
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

        this._activeLayer.ease({
            opacity: 0,
            duration: 600,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                let temp = this._activeLayer;
                this._activeLayer = this._nextLayer;
                this._nextLayer = temp;
                this._nextLayer.opacity = 0;
            }
        });


        this._nextLayer.opacity = 255;
    }
});

const ScrollLabel = GObject.registerClass(
class ScrollLabel extends St.Widget {
    _init(styleClass, settings) {
        super._init({
            layout_manager: new Clutter.BinLayout(),
            x_expand: true,
            y_expand: false,
            clip_to_allocation: true
        });
        
        this._isDestroyed = false;
        this._settings = settings;
        this._styleClass = styleClass;
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

        this._settingsId = this._settings.connect('changed::scroll-text', () => this.setText(this._text, true));

        this._allocId = this.connect('notify::allocation', () => {
            if (this._isDestroyed || this._resizeTimer) return; 
            
            this._resizeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._resizeTimer = null;
                if (!this._isDestroyed && this.has_allocation()) this._checkResize();
                return GLib.SOURCE_REMOVE;
            });
        });
    }

    destroy() {
        this._isDestroyed = true;
        this._container.remove_all_transitions();
        
        if (this._resizeTimer) { GLib.source_remove(this._resizeTimer); this._resizeTimer = null; }
        if (this._measureTimeout) { GLib.source_remove(this._measureTimeout); this._measureTimeout = null; }
        if (this._scrollTimer) { GLib.source_remove(this._scrollTimer); this._scrollTimer = null; }
        
        if (this._settingsId) { this._settings.disconnect(this._settingsId); this._settingsId = null; }
        if (this._allocId) { this.disconnect(this._allocId); this._allocId = null; }
        
        super.destroy();
    }

    setGameMode(active) {
        this._gameMode = active;
        if (active) {
            this._stopAnimation();
        } else {
            this._checkResize();
        }
    }

    _checkResize() {
        if (!this._text || this._gameMode || this._isDestroyed) return;
        if (!this.get_parent()) return;

        let boxWidth = this.get_allocation_box().get_width();
        let textWidth = this._label1.get_preferred_width(-1)[1];
        let needsScroll = (textWidth > boxWidth) && this._settings.get_boolean('scroll-text');
        let isScrolling = (this._scrollTimer != null);

        if (needsScroll && !isScrolling) {
            this._startInfiniteScroll(textWidth);
        }
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
            if (!this._isDestroyed && this.has_allocation()) this._checkOverflow();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopAnimation() {
        if (this._isDestroyed) return;
        this._container.remove_all_transitions();
        this._container.translation_x = 0;
        if (this._scrollTimer) {
            GLib.source_remove(this._scrollTimer);
            this._scrollTimer = null;
        }
    }

    _checkOverflow() {
        if (!this._settings.get_boolean('scroll-text') || this._gameMode || this._isDestroyed) return;
        if (!this.get_parent()) return;

        let boxWidth = this.get_allocation_box().get_width();
        let textWidth = this._label1.get_preferred_width(-1)[1];
        if (textWidth > boxWidth) {
            this._startInfiniteScroll(textWidth);
        }
    }

    _startInfiniteScroll(textWidth) {
        if (this._isDestroyed) return;
        this._label2.show();
        this._separator.show();
        const gap = 30;
        const distance = textWidth + gap;
        const speed = 30;
        const duration = (distance / speed) * 1000;
        
        const loop = () => {
            if (this._isDestroyed || this._gameMode) return; 
            
            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._scrollTimer = null; 
                if (this._isDestroyed || this._gameMode || !this.get_parent()) return GLib.SOURCE_REMOVE;
                
                this._container.ease({
                    translation_x: -distance,
                    duration: duration,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
                        if (this._isDestroyed || this._gameMode) return; 
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

// --- VIZUAL ---
const WaveformVisualizer = GObject.registerClass(
class WaveformVisualizer extends St.BoxLayout {
  _init() {
    super._init({ vertical: false, style: 'spacing: 3px;', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END });
    this._bars = [];
    this._color = '255,255,255';
    this._mode = 1;
    this._isPlaying = false;
    this._timerId = null;

    for (let i = 0; i < 4; i++) {
      let bar = new St.Bin({ style_class: 'visualizer-bar', y_align: Clutter.ActorAlign.END });
      setStyleSafe(bar, 'height: 4px; background-color: rgba(255,255,255,0.5);', 'Visualizer Init');
      this.add_child(bar);
      this._bars.push(bar);
    }
  }

  setMode(m) {
      this._mode = m;
      let align = (m === 2) ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
      this._bars.forEach(bar => { bar.y_align = align; });
  }

  setColor(c) {
      let r = 255, g = 255, b = 255;
      if (c && typeof c.r === 'number' && !isNaN(c.r)) r = Math.min(255, c.r + 100);
      if (c && typeof c.g === 'number' && !isNaN(c.g)) g = Math.min(255, c.g + 100);
      if (c && typeof c.b === 'number' && !isNaN(c.b)) b = Math.min(255, c.b + 100);

      this._color = `${Math.floor(r)},${Math.floor(g)},${Math.floor(b)}`;
      if (!this._isPlaying) this._updateVisuals(0);
  }

  setPlaying(playing) {
    if (this._isPlaying === playing) return;
    this._isPlaying = playing;

    if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null; }

    if (playing && this._mode !== 0) {
        this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
            if (!this.get_parent()) return GLib.SOURCE_REMOVE;
            let t = Date.now() / 200;
            this._updateVisuals(t);
            return GLib.SOURCE_CONTINUE;
        });
    } else {
        this._updateVisuals(0);
    }
  }

  _updateVisuals(t) {
      if (!this.get_parent()) return;

      this._bars.forEach((bar, idx) => {
          let h = 4;
          let opacity = this._isPlaying ? 1.0 : 0.4;

          if (this._isPlaying) {
              if (this._mode === 1) {
                  h = 6 + Math.abs(Math.sin(t + idx)) * 12;
              } else if (this._mode === 2) {
                  h = 6 + Math.abs(Math.sin(t + (idx * 1.3))) * 12;
                  if (Math.random() > 0.8) h += 4;
              }
          }

          if (typeof h !== 'number' || isNaN(h) || !isFinite(h)) h = 4;

          bar.set_height(h);
          let css = `background-color: rgba(${this._color}, ${opacity});`;

          // CACHING FIX
          if (bar._lastCss !== css) {
              bar._lastCss = css;
              setStyleSafe(bar, css, `Visualizer Bar ${idx}`);
          }
      });
  }
});

// --- POPUP MENU ---
const ExpandedPlayer = GObject.registerClass(
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
        this._backgroundBtn.connect('clicked', () => {
            this.hide(); 
        });
        this.add_child(this._backgroundBtn);

        this._box = new St.BoxLayout({
            style_class: 'music-pill-expanded',
            vertical: true,
            reactive: true
        });
        this._box.connect('button-press-event', () => { return Clutter.EVENT_STOP; });
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

        this._sliderBin.connect('button-release-event', (actor, event) => {
            this._handleSeek(event);
            return Clutter.EVENT_STOP;
        });

        progressBox.add_child(this._currentTimeLabel);
        progressBox.add_child(this._sliderBin);
        progressBox.add_child(this._totalTimeLabel);
        this._box.add_child(progressBox);

        let controlsRow = new St.BoxLayout({ style_class: 'controls-row', vertical: false, x_align: Clutter.ActorAlign.CENTER, reactive: true });
        
        let prevBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-backward-symbolic' }), reactive: true, can_focus: true });
        prevBtn.connect('button-release-event', () => { this._controller.previous(); return Clutter.EVENT_STOP; });
        
        this._playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic' });
        let playPauseBtn = new St.Button({ style_class: 'control-btn', child: this._playPauseIcon, reactive: true, can_focus: true });
        playPauseBtn.connect('button-release-event', () => { this._controller.togglePlayback(); return Clutter.EVENT_STOP; });

        let nextBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-forward-symbolic' }), reactive: true, can_focus: true });
        nextBtn.connect('button-release-event', () => { this._controller.next(); return Clutter.EVENT_STOP; });

        controlsRow.add_child(prevBtn);
        controlsRow.add_child(playPauseBtn);
        controlsRow.add_child(nextBtn);
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

        let finalAlpha = followTrans ? (alpha || 1.0) : 0.95;
        
        let safeR = (typeof r === 'number' && !isNaN(r)) ? Math.floor(r) : 40;
        let safeG = (typeof g === 'number' && !isNaN(g)) ? Math.floor(g) : 40;
        let safeB = (typeof b === 'number' && !isNaN(b)) ? Math.floor(b) : 40;

        let bgStyle = `background-color: rgba(${safeR}, ${safeG}, ${safeB}, ${finalAlpha});`;
        let shadowStyle = useShadow ? 'box-shadow: 0px 8px 30px rgba(0,0,0,0.5);' : 'box-shadow: none;';
        let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255,255,255,0.1);`;
        
        let css = `${bgStyle} ${borderStyle} border-radius: ${radius}px; padding: 20px; ${shadowStyle} min-width: 320px; max-width: 600px;`;
        
        if (this._lastPopupCss === css) return;
        this._lastPopupCss = css;
        
        setStyleSafe(this._box, css, 'ExpandedPlayer Popup');
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

        if (!artUrl) {
            this._vinylBin.hide();
            this._stopVinyl();
            this._currentArtUrl = null;
        } else {
            this._vinylBin.show(); 
            if (trackChanged) {
                this._currentArtUrl = artUrl;
                let bg = `url("${artUrl}")`;
                let style = `background-image: ${bg}; background-size: cover; border-radius: 50px;`;

                if (this._topIsActive) {
                    setStyleSafe(this._artBottom, style, 'ExpandedPlayer Vinyl Bottom');
                    this._artBottom.opacity = 255;
                    
                    this._artTop.ease({
                        opacity: 0,
                        duration: 800,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                    this._topIsActive = false;
                } else {
                    setStyleSafe(this._artTop, style, 'ExpandedPlayer Vinyl Top');
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
                    } catch(e) {}
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
            onComplete: () => {
                this.visible = false;
                if (this._controller) {
                    this._controller.closeMenu();
                }
            } 
        });
    }

    destroy() {
        if (this._tickId) { GLib.source_remove(this._tickId); this._tickId = null; }
        if (this._updateTimer) { GLib.source_remove(this._updateTimer); this._updateTimer = null; }
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

        try {
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
                        try { conn.call_finish(res); } catch (e) { }
                    }
                );
            }
        } catch(e) { }
    }

    _startVinyl() {
        if (!this._vinyl || !this._settings.get_boolean('popup-vinyl-rotate')) return;

        if (this._isSpinning) return;
        this._isSpinning = true;

        this._vinyl.remove_all_transitions();
        
        let currentAngle = this._vinyl.rotation_angle_z || 0;

        this._vinyl.ease({
            rotation_angle_z: currentAngle + 90,
            duration: 800,
            mode: Clutter.AnimationMode.EASE_IN_QUAD,
            onComplete: () => {
                if (!this._isSpinning || !this._vinyl) return;
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
        if (!this._vinyl) return;
        
        if (!this._isSpinning) return;
        this._isSpinning = false;
        
        let currentAngle = this._vinyl.rotation_angle_z || 0;
        this._vinyl.remove_all_transitions();
        
        this._vinyl.ease({
            rotation_angle_z: currentAngle + 90, 
            duration: 800,
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onComplete: () => {
                if (this._vinyl) {
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


            if (Math.abs(targetX - currentX) < 40) {
                targetX = currentX;
            }
            if (Math.abs(targetY - currentY) < 40) {
                targetY = currentY;
            }


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

// --- Main Widget (MusicPill) ---
const MusicPill = GObject.registerClass(
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

    this._textWrapper = new St.Widget({
        layout_manager: new Clutter.BinLayout(),
        x_expand: true, y_expand: true,
        clip_to_allocation: true, // gnome 46 fix by ticket
        style: 'min-width: 50px; margin-right: 4px; margin-left: 2px;'
    });

    this._textBox = new St.BoxLayout({
        vertical: true,
        x_expand: true,
        y_align: Clutter.ActorAlign.CENTER,
        x_align: Clutter.ActorAlign.FILL,
        style: 'padding-left: 0px; padding-right: 0px;'
    });
    this._titleScroll = new ScrollLabel('music-label-title', this._controller._settings);
    this._artistScroll = new ScrollLabel('music-label-artist', this._controller._settings);
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

    // --- Click ---
    this.connect('button-press-event', () => {
        if (!this._body) return;
        this._body.ease({ scale_x: 0.96, scale_y: 0.96, duration: 80, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        return Clutter.EVENT_STOP;
    });

    this.connect('button-release-event', (actor, event) => {
        if (!this._body) return;
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
    });

    this.connect('scroll-event', (actor, event) => {
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
            if (Math.abs(dx) > 0.1 || Math.abs(dy) > 0.1) {
                if (dy < 0 || dx > 0) shouldNext = true;
                else if (dy > 0 || dx < 0) shouldPrev = true;
            }
        }

        if (shouldNext || shouldPrev) {
            let now = Date.now();
            if (now - this._lastScrollTime < 500) return Clutter.EVENT_STOP;
            this._lastScrollTime = now;

            let invert = this._settings.get_boolean('invert-scroll-animation');
            let offset = 12;

            if (shouldNext) {
                this._animateSlide(invert ? -offset : offset);
                this._controller.next();
            } else {
                this._animateSlide(invert ? offset : -offset);
                this._controller.previous();
            }
        }
        return Clutter.EVENT_STOP;
    });

    // Listeners
    this._settings.connect('changed::enable-transparency', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-strength', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-art', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-text', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-vis', () => this._updateTransparencyConfig());

    this._settings.connect('changed::pill-width', () => this._updateDimensions());
    this._settings.connect('changed::pill-height', () => this._updateDimensions());
    this._settings.connect('changed::art-size', () => this._updateDimensions());
    this._settings.connect('changed::panel-pill-height', () => this._updateDimensions());
    this._settings.connect('changed::panel-art-size', () => this._updateDimensions());
    this._settings.connect('changed::dock-art-size', () => this._updateDimensions());
    this._settings.connect('changed::panel-pill-width', () => this._updateDimensions());
    this._settings.connect('changed::vertical-offset', () => this._updateDimensions());
    this._settings.connect('changed::horizontal-offset', () => this._updateDimensions());
    this._settings.connect('changed::dock-position', () => this._controller._queueInject());
    this._settings.connect('changed::position-mode', () => this._controller._queueInject());
    this._settings.connect('changed::target-container', () => this._controller._queueInject());
    this._settings.connect('changed::visualizer-style', () => this._updateDimensions());
    this._settings.connect('changed::border-radius', () => this._updateDimensions());
    this._settings.connect('changed::enable-shadow', () => this._updateDimensions());
    this._settings.connect('changed::shadow-opacity', () => this._updateDimensions());
    this._settings.connect('changed::shadow-blur', () => this._updateDimensions());
    this._settings.connect('changed::show-album-art', () => this._updateArtVisibility());
    this._settings.connect('changed::visualizer-padding', () => this._updateDimensions());
    

    this._updateTransparencyConfig();
    this._updateDimensions();
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

        if (width < 220 || visStyle === 0) {
            this._visBin.hide();
            this._visBin.set_width(0);
            setStyleSafe(this._visBin, 'margin: 0px;', 'VisBin Margin Hide');
            let artMargin = (width < 180) ? 4 : 8;
            setStyleSafe(this._artBin, `margin-right: ${artMargin}px;`, 'ArtBin Margin Hide');
            this._fadeLeft.set_width(10);
            this._fadeRight.set_width(10);
        } else {
            this._visBin.show();
            let sideMargin = this._settings.get_int('visualizer-padding');
            
            setStyleSafe(this._visBin, `margin-left: ${sideMargin}px;`, 'VisBin Margin Show');
            this._visBin.set_width(-1);
            setStyleSafe(this._artBin, `margin-right: ${sideMargin}px;`, 'ArtBin Margin Show');
            this._fadeLeft.set_width(30);
            this._fadeRight.set_width(30);
        }

        if (height < 46 && !this._inPanel) {
            this._artistScroll.hide();
        } else if (this._inPanel && height < 30) {
             this._artistScroll.hide();
        } else {
            this._artistScroll.show();
        }

        setStyleSafe(this._titleScroll, `font-size: ${fontSizeTitle}; font-weight: 800; color: white;`, 'Title Font');
        setStyleSafe(this._artistScroll, `font-size: ${fontSizeArtist}; font-weight: 500; color: rgba(255,255,255,0.7);`, 'Artist Font');

        this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);


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
          onComplete: () => { this._body.ease({ translation_x: 0, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_BACK }); }
      });
  }

  updateDisplay(title, artist, artUrl, status, busName, isSkipActive, player = null) {
    if (!this.get_parent()) return;


    //console.log(`[MusicPill DEBUG] Frissítés - Cím: ${title} | Art: ${artUrl ? 'VAN' : 'NINCS'} | Busz: ${busName}`);

    this._currentStatus = status;
    let forceUpdate = false;

    if (this._currentBusName !== busName) {
        //console.log(`[MusicPill DEBUG] Lejátszó váltás történt: ${this._currentBusName} -> ${busName}`);
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
                this._body.ease({ width: targetW, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                
                this.ease({
                    width: targetW, 
                    duration: 500, 
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
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
        //console.log(`[MusicPill DEBUG] Pill kényszerített megjelenítése.`);
        this._isActiveState = true;
        this.reactive = true;
        this.visible = true;
        
        this._updateDimensions();
        let finalWidth = this._targetWidth;
        
        this.set_width(0);
        this._body.set_width(0);
        this.opacity = 0;
        
        this.ease({
            width: finalWidth,
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

    if (this._lastTitle !== title || this._lastArtist !== artist || forceUpdate) {
        this._titleScroll.setText(title || 'Loading...', forceUpdate);
        this._artistScroll.setText(artist || '', forceUpdate);
        this._lastTitle = title;
        this._lastArtist = artist;
    }

    this._visualizer.setPlaying(status === 'Playing' && !this._gameModeActive);


    if (forceUpdate || artUrl !== this._lastArtUrl) {
        //console.log(`[MusicPill DEBUG] Kép frissítése: ${artUrl}`);
        this._lastArtUrl = artUrl;

        if (artUrl) {

            if (this._artDebounceTimer) {
                GLib.source_remove(this._artDebounceTimer);
                this._artDebounceTimer = null;
            }
            this._artBin.show();
            this._artBin.opacity = 255;
            this._artWidget.setArt(artUrl, true);
            this._loadColorFromArt(artUrl);
        } else {
            //console.log(`[MusicPill DEBUG] Nincs kép, indítom az art visibility kezelőt.`);
            this._updateArtVisibility();
        }
    } else {
        this._startColorTransition();
    }


    if (this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
        if (player) {
            this._controller._expandedPlayer.setPlayer(player);
        }
        this._controller._expandedPlayer.updateContent(this._lastTitle, this._lastArtist, this._lastArtUrl, this._currentStatus);
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

      // FIX: border
      let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255, 255, 255, ${borderOp});`;

      let paddingStyle = `padding: ${safePadY}px ${safePadX}px;`;
      let radiusStyle = `border-radius: ${safeRadius}px;`;

      let shadow = this._shadowCSS ? this._shadowCSS : 'box-shadow: none;';

      let css = `${bgStyle} ${borderStyle} ${paddingStyle} ${radiusStyle} ${shadow}`;

      // FIX: Cache check
      if (this._lastBodyCss !== css) {
          this._lastBodyCss = css;
          setStyleSafe(this._body, css, 'MusicPill Main');
      }

      let startColor = `rgba(${safeR}, ${safeG}, ${safeB}, ${alpha})`;
      let endColor = `rgba(${safeR}, ${safeG}, ${safeB}, 0)`;

      // FIX
      let gradientLeft = `background-image: linear-gradient(to right, ${startColor}, ${endColor});`;
      if (this._lastLeftCss !== gradientLeft) {
          this._lastLeftCss = gradientLeft;
          setStyleSafe(this._fadeLeft, gradientLeft, 'FadeLeft');
      }

      let gradientRight = `background-image: linear-gradient(to right, ${endColor}, ${startColor});`;
      if (this._lastRightCss !== gradientRight) {
          this._lastRightCss = gradientRight;
          setStyleSafe(this._fadeRight, gradientRight, 'FadeRight');
      }

      this._displayedColor = { r: safeR, g: safeG, b: safeB };

      if (this._controller && this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
          if (typeof this._controller._expandedPlayer.updateStyle === 'function') {
              this._controller._expandedPlayer.updateStyle(safeR, safeG, safeB, alpha);
          }
      }
  }
});

// --- Extension Entry ---
export default class DynamicMusicExtension extends Extension {
  enable() {
    this.initTranslations();
    this._settings = this.getSettings('org.gnome.shell.extensions.dynamic-music-pill');
    this._pill = new MusicPill(this);
    this._expandedPlayer = null;
    this._proxies = new Map();
    this._lastWinnerName = null;
    this._lastStatusTime = 0;
    this._lastActionTime = 0;
    this._updateTimeoutId = null;
    this._recheckTimer = null;
    this._connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
    this._artCache = new Map();
    this._lastValidArtUrl = null;
    this._dockSignals = [];
    this._currentDock = null;
    this._injectTimeout = null;
    this._isMovingItem = false;

    this._focusSignal = global.display.connect('notify::focus-window', () => {
        this._monitorGameMode();
    });

    this._inject();
    this._ownerId = this._connection.signal_subscribe('org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged', '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE, () => this._scan());
    this._scan();

    this._watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
        this._monitorGameMode();
        if (this._pill && !this._pill.get_parent()) {
             this._inject();
        }
        return GLib.SOURCE_CONTINUE;
    });
    this._settings.connect('changed::hide-default-player', () => this._updateDefaultPlayerVisibility());
    this._updateDefaultPlayerVisibility();
  }

  // --- Action Handler ---
  performAction(action) {
      if (action === 'play_pause') this.togglePlayback();
      else if (action === 'next') this.next();
      else if (action === 'previous') this.previous();
      else if (action === 'open_app') this.openApp();
      else if (action === 'toggle_menu') this.toggleMenu();
  }

  openApp() {
        let player = this._getActivePlayer();
        if (!player) return;

        this._connection.call(
            player._busName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2', 
            'Raise',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
        );

        let rawBus = player._busName.replace('org.mpris.MediaPlayer2.', '').split('.')[0].toLowerCase();
        
        let appSystem = Shell.AppSystem.get_default();
        let runningApps = appSystem.get_running();

        for (let app of runningApps) {
            let appName = app.get_name().toLowerCase();
            let appId = app.get_id().toLowerCase();

            if (appId.includes(rawBus) || appName.includes(rawBus)) {
                let windows = app.get_windows();
                if (windows && windows.length > 0) {
                    if (Main.activateWindow) Main.activateWindow(windows[0]);
                    else windows[0].activate(global.get_current_time());
                    return;
                }
                app.activate();
                return;
            }
        }
    }


       
  toggleMenu() {
        if (this._expandedPlayer) {
            this._expandedPlayer.hide();
            return;
        }

        this._expandedPlayer = new ExpandedPlayer(this);
        Main.layoutManager.addChrome(this._expandedPlayer);

        let player = this._getActivePlayer();
        if (!player) return;

        let [px, py] = this._pill.get_transformed_position();
        let [pw, ph] = this._pill.get_transformed_size();
        let monitor = Main.layoutManager.findMonitorForActor(this._pill);

        let c = this._pill._displayedColor;
        this._expandedPlayer.updateStyle(c.r, c.g, c.b, this._pill._currentBgAlpha);
        
        let startW = 320;
        let startH = 260;
        let startX = px + (pw / 2) - (startW / 2);
        let startY = py > monitor.y + (monitor.height / 2) ? py - startH - 15 : py + ph + 15;
        this._expandedPlayer.setPosition(startX, startY);

        let artUrl = this._pill._lastArtUrl;
        this._expandedPlayer.showFor(player, artUrl);

        this._expandedPlayer.animateResize();
    }

  closeMenu() {
      if (this._expandedPlayer) {
          Main.layoutManager.removeChrome(this._expandedPlayer);
          this._expandedPlayer.destroy();
          this._expandedPlayer = null;
      }
  }

  _isGameModeActive() {
      if (!this._settings.get_boolean('enable-gamemode')) return false;
      if (Main.overview.visible) return false;

      let win = global.display.get_focus_window();
      if (win && win.get_monitor() === Main.layoutManager.primaryIndex) {
          if (win.is_fullscreen()) {
              return true;
          }
      }
      return false;
  }

  _monitorGameMode() {
      let isGame = this._isGameModeActive();
      this._pill.setGameMode(isGame);
  }

  _queueInject() {
      if (this._injectTimeout) GLib.source_remove(this._injectTimeout);
      this._injectTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
          this._inject();
          this._injectTimeout = null;
          return GLib.SOURCE_REMOVE;
      });
  }

  _disconnectDockSignals() {
      if (this._currentDock && this._dockSignals.length > 0) {
          this._dockSignals.forEach(id => this._currentDock.disconnect(id));
          this._dockSignals = [];
      }
      this._currentDock = null;
  }

  _ensurePosition(container) {
      if (!container || this._isMovingItem) return false;

      let mode = this._settings ? this._settings.get_int('position-mode') : 1;
      let manualIndex = this._settings ? this._settings.get_int('dock-position') : 0;

      let children = container.get_children();
      let otherChildren = children.filter(c => c !== this._pill);
      let realItemCount = otherChildren.length;
      let targetIndex = 0;

      if (mode === 0) { targetIndex = manualIndex; }
      else if (mode === 1) { targetIndex = 0; }
      else if (mode === 2) { targetIndex = Math.floor(realItemCount / 2); }
      else if (mode === 3) { targetIndex = realItemCount; }

      if (targetIndex > realItemCount) targetIndex = realItemCount;
      if (targetIndex < 0) targetIndex = 0;

      let currentIndex = children.indexOf(this._pill);

      if (currentIndex !== targetIndex) {
          this._isMovingItem = true;
          try {
              if (currentIndex !== -1) { container.remove_child(this._pill); }
              container.insert_child_at_index(this._pill, targetIndex);
              this._isMovingItem = false;
              return true;
          } catch(e) { console.error(e); }
          this._isMovingItem = false;
      }
      return false;
  }

  _inject() {
    if (this._isMovingItem) return;

    let target = this._settings ? this._settings.get_int('target-container') : 0;
    let container = null;

    if (target === 0) {
        let dtd = Main.panel.statusArea['dash-to-dock'];
        container = (dtd && dtd._box) ? dtd._box : (Main.overview.dash._box || null);
    } else if (target === 1) container = Main.panel._leftBox;
    else if (target === 2) container = Main.panel._centerBox;
    else if (target === 3) container = Main.panel._rightBox;

    if (!container) return;

    let oldParent = this._pill.get_parent();
    let parentChanged = (oldParent && oldParent !== container);

    if (parentChanged) {
        oldParent.remove_child(this._pill);
        this._disconnectDockSignals();
    }

    if (target === 0 && this._currentDock !== container) {
        this._disconnectDockSignals();
        this._currentDock = container;

        let addId = container.connect('child-added', (c, actor) => {
            if (actor !== this._pill && !this._isMovingItem) this._queueInject();
        });
        let remId = container.connect('child-removed', (c, actor) => {
            if (actor !== this._pill && !this._isMovingItem) this._queueInject();
        });
        this._dockSignals.push(addId);
        this._dockSignals.push(remId);
    }

    let moved = this._ensurePosition(container);

    if (parentChanged || moved || !oldParent) {
        this._pill._updateDimensions();
    }
  }

  _scan() {
    this._connection.call(
        'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
        null, null, Gio.DBusCallFlags.NONE, -1, null,
        (c, res) => {
            try {
                let r = smartUnpack(c.call_finish(res));
                let names = Array.isArray(r[0]) ? r[0] : (Array.isArray(r) ? r : []);
                let mprisNames = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));

                let changed = false;

                mprisNames.forEach(n => {
                    if (!this._proxies.has(n)) {
                        this._add(n);
                        changed = true;
                    }
                });

                for (let [name, proxy] of this._proxies) {
                    if (!mprisNames.includes(name)) {
                        this._proxies.delete(name);
                        this._artCache.delete(name);
                        changed = true;
                    }
                }


                if (changed) {
                    this._updateUI();
                }
            } catch (e) {}
        }
    );
}


    _add(name) {
        if (this._proxies.has(name)) return;


        Gio.DBusProxy.new(
            this._connection,
            Gio.DBusProxyFlags.NONE,
            PlayerInterfaceInfo,
            name,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            null,
            (source, res) => {
                try {

                    let p = Gio.DBusProxy.new_finish(res);
                    p._busName = name;
                    p._lastSeen = Date.now();
                    p._lastStatusTime = Date.now();


                    let status = p.PlaybackStatus;
                    p._lastPlayingTime = (status === 'Playing') ? Date.now() : 0;
                    p._lastPosition = 0;
                    p._lastPositionTime = Date.now();

                    p.connectSignal('Seeked', (proxy, senderName, [position]) => {
                        p._lastPosition = position;
                        p._lastPositionTime = Date.now();

                        if (this._expandedPlayer && this._expandedPlayer.visible && this._lastWinnerName === p._busName) {
                            this._expandedPlayer._tick();
                        }
                    });

                    p.connect('g-properties-changed', (proxy, changed, invalidated) => {
                        if (!this._proxies.has(p._busName)) return;

                        let keys = changed.deep_unpack();
                        let now = Date.now();

                        p._lastSeen = now;
                        p._lastStatusTime = now;

                        // PlaybackStatus
                        if (keys.PlaybackStatus) {
                            let s = keys.PlaybackStatus;
                            if (s !== 'Playing') {
                                p._lastPosition += (now - p._lastPositionTime) * 1000;
                            }
                            p._lastPositionTime = now;
                            if (s === 'Playing') p._lastPlayingTime = now;
                        }

                        if (keys.Position !== undefined) {
                            p._lastPosition = keys.Position;
                            p._lastPositionTime = now;
                            this._triggerUpdate();
                            return;
                        }

                        if (keys.Metadata) {
                            p._lastPosition = 0;
                            p._lastPositionTime = now;
                            this._triggerUpdate();
                        } else if (keys.PlaybackStatus) {
                            this._triggerUpdate();
                        }
                    });

                    p.connect('notify::g-name-owner', () => {
                        this._scan();
                    });

                    // 5. Proxy
                    this._proxies.set(name, p);
                    this._triggerUpdate();

                } catch (e) {
                    console.error(`[DynamicMusicPill] Hiba a proxy létrehozásakor (${name}): ${e.message}`);
                }
            }
        );
    }

    _triggerUpdate() {
        if (this._updateTimeoutId) {
            GLib.Source.remove(this._updateTimeoutId);
        }

        this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._updateUI();
            this._updateTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateUI() {

        if (this._recheckTimer) {
            GLib.source_remove(this._recheckTimer);
            this._recheckTimer = null;
        }


        let target = this._settings ? this._settings.get_int('target-container') : 0;
        let container = null;
        if (target === 0) {
            let dtd = Main.panel.statusArea['dash-to-dock'];
            container = (dtd && dtd._box) ? dtd._box : (Main.overview.dash._box || null);
        } else if (target === 1) container = Main.panel._leftBox;
        else if (target === 2) container = Main.panel._centerBox;
        else if (target === 3) container = Main.panel._rightBox;

        if (container) {
            this._ensurePosition(container);
        }

        let active = this._getActivePlayer();
        if (active) {

            let playerChanged = (this._lastWinnerName !== active._busName);
            this._lastWinnerName = active._busName;

            let m = active.Metadata;
            let title = null, artist = null, artUrl = null;
            let currentArt = null;

            if (m) {
                let metaObj = (m instanceof GLib.Variant) ? m.deep_unpack() : m;
                title = smartUnpack(metaObj['xesam:title']);
                artist = smartUnpack(metaObj['xesam:artist']);
                if (Array.isArray(artist)) artist = artist.map(a => smartUnpack(a)).join(', ');
                currentArt = smartUnpack(metaObj['mpris:artUrl']);
            }

            // --- CACHE  ---

            let rawName = active._busName || "";
            let cacheKey = rawName;
            if (cacheKey.includes('.instance')) {
                cacheKey = cacheKey.split('.instance')[0];
            }

            if (currentArt && typeof currentArt === 'string' && currentArt.trim() !== "") {
                this._artCache.set(cacheKey, currentArt);
                artUrl = currentArt;
            }

            else if (this._artCache.has(cacheKey)) {
                artUrl = this._artCache.get(cacheKey);
            }
            else {
                artUrl = null;
            }

            if (!artUrl && active.PlaybackStatus === 'Playing' && !this._retryArtTimer) {
                this._retryArtTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._retryArtTimer = null;
                    if (this._proxies.has(active._busName)) {
                        this._updateUI();
                    }
                    return GLib.SOURCE_REMOVE;
                });
            }

            let now = Date.now();
            let isSkipActive = (now - this._lastActionTime < 3000);


            this._pill.updateDisplay(title, artist, artUrl, active.PlaybackStatus, active._busName, isSkipActive, active);
        } else {

            this._pill.updateDisplay(null, null, null, 'Stopped', null, false);
        }
    }



    _getActivePlayer() {
        let proxiesArr = Array.from(this._proxies.values());
        if (proxiesArr.length === 0) return null;
        let now = Date.now();

        if (now - this._lastActionTime < 3000 && this._lastWinnerName) {
            let lockedPlayer = proxiesArr.find(p => p._busName === this._lastWinnerName);
            if (lockedPlayer) return lockedPlayer;
        }

        let scoredPlayers = proxiesArr.map(p => {
            let score = 0;
            let status = p.PlaybackStatus;
            let m = p.Metadata;
            let hasTitle = m && smartUnpack(m['xesam:title']);
            if (status === 'Playing' && hasTitle) score = 500;
            else if (status === 'Paused' && hasTitle) score = 100;
            return { player: p, score: score };
        });

        scoredPlayers.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.player._lastPlayingTime - a.player._lastPlayingTime;
        });

        let winner = scoredPlayers[0].player;
        if (winner.PlaybackStatus !== 'Playing') {
            let anyPlaying = scoredPlayers.find(s => s.player.PlaybackStatus === 'Playing' && smartUnpack(s.player.Metadata['xesam:title']));
            if (anyPlaying) winner = anyPlaying.player;
        }
        return winner;
    }

    togglePlayback() { let p = this._getActivePlayer(); if (p) p.PlayPauseRemote(); }
    next() { this._lastActionTime = Date.now(); let p = this._getActivePlayer(); if (p) p.NextRemote(); }
    previous() { this._lastActionTime = Date.now(); let p = this._getActivePlayer(); if (p) p.PreviousRemote(); }

    disable() {
        this._disconnectDockSignals();
        if (this._focusSignal) global.display.disconnect(this._focusSignal);
        if (this._injectTimeout) GLib.source_remove(this._injectTimeout);
        if (this._watchdog) GLib.source_remove(this._watchdog);
        if (this._recheckTimer) GLib.source_remove(this._recheckTimer);
        if (this._updateTimeoutId) GLib.source_remove(this._updateTimeoutId);
        if (this._ownerId) this._connection.signal_unsubscribe(this._ownerId);
        
        if (this._expandedPlayer) {
            this._expandedPlayer.destroy();
            this._expandedPlayer = null;
        }
        if (this._pill) this._pill.destroy();
        this._proxies.clear();
        
        this._updateDefaultPlayerVisibility(true);

        this._settings = null;
    }
    _updateDefaultPlayerVisibility(shouldReset = false) {
        if (!this._settings) return;
        const hide = this._settings.get_boolean('hide-default-player');

        const MprisSource = Mpris.MprisSource ?? Mpris.MediaSection;
        const mediaSection = Main.panel.statusArea.dateMenu?._messageList?._messageView?._mediaSource ?? 
                             Main.panel.statusArea.dateMenu?._messageList?._mediaSection;
        const qsMedia = Main.panel.statusArea.quickSettings?._media || 
                        Main.panel.statusArea.quickSettings?._mediaSection;

        if (this._origMediaAddPlayer && (shouldReset || hide === false)) {
            MprisSource.prototype._addPlayer = this._origMediaAddPlayer;
            this._origMediaAddPlayer = null;

            if (mediaSection && typeof mediaSection._onProxyReady === 'function') mediaSection._onProxyReady();
            if (qsMedia && typeof qsMedia._onProxyReady === 'function') qsMedia._onProxyReady();
        } else if (!this._origMediaAddPlayer && hide === true) {
            this._origMediaAddPlayer = MprisSource.prototype._addPlayer;
            MprisSource.prototype._addPlayer = function () {};

            [mediaSection, qsMedia].forEach(section => {
                if (section && section._players) {
                    for (const player of section._players.values()) {
                        const busName = player._busName || player.busName;
                        if (typeof section._onNameOwnerChanged === 'function') {
                            section._onNameOwnerChanged(null, null, [busName, busName, ""]);
                        }
                    }
                }
            });
        }
    }
}
