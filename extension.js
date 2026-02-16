import Shell from 'gi://Shell';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Pango from 'gi://Pango';
import GdkPixbuf from 'gi://GdkPixbuf';

import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const MPRIS_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Metadata" type="a{sv}" access="read" />
    <property name="PlaybackStatus" type="s" access="read" />
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
  </interface>
</node>`;

const PlayerProxy = Gio.DBusProxy.makeProxyWrapper(MPRIS_IFACE);

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
        const layerStyle = 'background-size: cover; background-position: center;';
        this._layerA = new St.Widget({ x_expand: true, y_expand: true, opacity: 255, style: layerStyle });
        this._layerB = new St.Widget({ x_expand: true, y_expand: true, opacity: 0, style: layerStyle });
        this._layerA._bgUrl = null;
        this._layerB._bgUrl = null;
        this.add_child(this._layerA);
        this.add_child(this._layerB);
        this._activeLayer = this._layerA;
        this._nextLayer = this._layerB;
        this._currentUrl = null;
    }

    setRadius(r) {
        this._radius = r;
        this._refreshLayerStyle(this._layerA);
        this._refreshLayerStyle(this._layerB);
    }

    setShadowStyle(cssString) {
        this._shadowCSS = cssString;
        this._refreshLayerStyle(this._layerA);
        this._refreshLayerStyle(this._layerB);
    }

    _refreshLayerStyle(layer) {
        let url = layer._bgUrl;
        let bgPart = url ? `background-image: url("${url}");` : '';
        let common = `border-radius: ${this._radius}px; background-size: cover; background-position: center; ${this._shadowCSS}`;
        layer.set_style(`${bgPart} ${common}`);
    }

    setArt(newUrl, force = false) {
        if (!force && this._currentUrl === newUrl) return;
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

        this._settings.connect('changed::scroll-text', () => this.setText(this._text, true));

        this.connect('notify::allocation', () => {
            if (this._resizeTimer) GLib.source_remove(this._resizeTimer);
            this._resizeTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
                this._checkResize();
                this._resizeTimer = null;
                return GLib.SOURCE_REMOVE;
            });
        });
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
        if (!this._text || this._gameMode) return;
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

        if (this._measureTimeout) GLib.source_remove(this._measureTimeout);
        this._measureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 600, () => {
            this._checkOverflow();
            this._measureTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopAnimation() {
        this._container.remove_all_transitions();
        this._container.translation_x = 0;
        if (this._scrollTimer) {
            GLib.source_remove(this._scrollTimer);
            this._scrollTimer = null;
        }
    }

    _checkOverflow() {
        if (!this._settings.get_boolean('scroll-text') || this._gameMode) return;
        let boxWidth = this.get_allocation_box().get_width();
        let textWidth = this._label1.get_preferred_width(-1)[1];
        if (textWidth > boxWidth) {
            this._startInfiniteScroll(textWidth);
        }
    }

    _startInfiniteScroll(textWidth) {
        this._label2.show();
        this._separator.show();
        const gap = 30;
        const distance = textWidth + gap;
        const speed = 30;
        const duration = (distance / speed) * 1000;
        const loop = () => {
            this._scrollTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 2000, () => {
                this._container.ease({
                    translation_x: -distance,
                    duration: duration,
                    mode: Clutter.AnimationMode.LINEAR,
                    onComplete: () => {
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

const WaveformVisualizer = GObject.registerClass(
class WaveformVisualizer extends St.BoxLayout {
  _init() {
    super._init({ vertical: false, style: 'spacing: 3px;', y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END });
    this._bars = [];
    this._color = '255,255,255';
    this._mode = 1;
    for (let i = 0; i < 4; i++) {
      let bar = new St.Bin({ style_class: 'visualizer-bar', y_align: Clutter.ActorAlign.END });
      this.add_child(bar);
      this._bars.push(bar);
    }
  }

  setMode(m) {
      this._mode = m;
      let align = (m === 2) ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
      this._bars.forEach(bar => {
          bar.y_align = align;
      });
  }

  setColor(c) {
      let r = Math.min(255, c.r + 100);
      let g = Math.min(255, c.g + 100);
      let b = Math.min(255, c.b + 100);
      this._color = `${r},${g},${b}`;
  }

  setPlaying(playing) {
    if (this._isPlaying === playing) return;
    this._isPlaying = playing;
    if (this._timerId) { GLib.source_remove(this._timerId); this._timerId = null; }

    if (playing) {
      this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 80, () => {
        let t = Date.now() / 200;
        this._bars.forEach((bar, idx) => {
          let h = 4;
          if (this._mode === 1) {
              h = 4 + Math.abs(Math.sin(t + idx)) * 14;
          } else if (this._mode === 2) {
              h = 4 + Math.abs(Math.sin(t + (idx * 1.3))) * 14;
          }
          bar.set_style(`height: ${Math.floor(h)}px; background-color: rgb(${this._color});`);
        });
        return GLib.SOURCE_CONTINUE;
      });
    } else {
      this._bars.forEach(bar => bar.set_style(`height: 4px; opacity: 0.4; background-color: rgb(${this._color});`));
    }
  }
});

// --- Main Widget ---
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
        style: 'min-width: 50px; overflow: hidden; margin-right: 4px; margin-left: 2px;'
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

    this.connect('button-press-event', () => {
        this._body.ease({ scale_x: 0.96, scale_y: 0.96, duration: 80, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        return Clutter.EVENT_STOP;
    });

    this.connect('button-release-event', () => {
        this._body.ease({ scale_x: 1.0, scale_y: 1.0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_BACK });
        this._controller.togglePlayback();
        return Clutter.EVENT_STOP;
    });

    this.connect('scroll-event', (actor, event) => {
        let direction = event.get_scroll_direction();
        if (direction === Clutter.ScrollDirection.UP || direction === Clutter.ScrollDirection.RIGHT) {
            this._animateSlide(12);
            this._controller.next();
        } else if (direction === Clutter.ScrollDirection.DOWN || direction === Clutter.ScrollDirection.LEFT) {
            this._animateSlide(-12);
            this._controller.previous();
        }
        return Clutter.EVENT_STOP;
    });

    // Listeners for Transparency
    this._settings.connect('changed::enable-transparency', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-strength', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-art', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-text', () => this._updateTransparencyConfig());
    this._settings.connect('changed::transparency-vis', () => this._updateTransparencyConfig());

    // Other listeners
    this._settings.connect('changed::pill-width', () => this._updateDimensions());
    this._settings.connect('changed::pill-height', () => this._updateDimensions());
    this._settings.connect('changed::art-size', () => this._updateDimensions());
    this._settings.connect('changed::panel-pill-height', () => this._updateDimensions());
    this._settings.connect('changed::panel-art-size', () => this._updateDimensions());
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
    this._settings.connect('changed::fix-dock-autohide', () => {
         if (!this._isActiveState) this._updateDimensions();
    });

    // Initial Apply
    this._updateTransparencyConfig();
    this._updateDimensions();
  }

  _updateTransparencyConfig() {
      if (!this._body) return;

      let enableTrans = this._settings.get_boolean('enable-transparency');
      let strength = this._settings.get_int('transparency-strength'); // 0-100

      let enableArtTrans = this._settings.get_boolean('transparency-art');
      let enableTextTrans = this._settings.get_boolean('transparency-text');
      let enableVisTrans = this._settings.get_boolean('transparency-vis');

      // 1. Háttér Opacity
      // Ha ki van kapcsolva, akkor 1.0 (SOLID)
      let bgAlpha = enableTrans ? (strength / 100.0) : 1.0;

      // 2. Elemek Opacity-je
      // Ha az elemre is vonatkozik a transzparencia, akkor megkapja a strength értékét
      // (Skálázva 0-255). Ha nem, akkor 255 (Tömör).
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

      // Tárolás és stílusfrissítés
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
            prefArtSize = this._settings.get_int('art-size');
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
            this._shadowCSS = `box-shadow: 0 2px ${shadowBlur}px rgba(0,0,0,${shadowOpacity});`;
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
            this._visBin.set_style('margin: 0px;');
            let artMargin = (width < 180) ? 4 : 8;
            this._artBin.set_style(`margin-right: ${artMargin}px;`);
            this._fadeLeft.set_width(10);
            this._fadeRight.set_width(10);
        } else {
            this._visBin.show();
            let sideMargin = 12;
            this._visBin.set_style(`margin-left: ${sideMargin}px;`);
            this._visBin.set_width(-1);
            this._artBin.set_style(`margin-right: ${sideMargin}px;`);
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

        this._titleScroll.set_style(`font-size: ${fontSizeTitle}; font-weight: 800; color: white;`);
        this._artistScroll.set_style(`font-size: ${fontSizeArtist}; font-weight: 500; color: rgba(255,255,255,0.7);`);

        this._applyStyle(this._displayedColor.r, this._displayedColor.g, this._displayedColor.b);

        let fixDock = this._settings.get_boolean('fix-dock-autohide');

        if (!this._isActiveState) {
            if (fixDock) {
                this.set_width(1);
                this.set_height(height);
                this.opacity = 0;
                this.visible = true;
            } else {
                this.visible = false;
                this.set_width(0);
            }
            return;
        }

        this.set_width(width);
        this.set_height(height);
        this.visible = true;
    }

  _animateSlide(offset) {
      this._body.ease({
          translation_x: offset, duration: 100, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
          onComplete: () => { this._body.ease({ translation_x: 0, duration: 250, mode: Clutter.AnimationMode.EASE_OUT_BACK }); }
      });
  }

  updateDisplay(title, artist, artUrl, status, busName, isSkipActive) {
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
                let fixDock = this._settings.get_boolean('fix-dock-autohide');
                this._isActiveState = false;
                this.reactive = false;
                let targetW = fixDock ? 1 : 0;
                this.ease({ opacity: 0, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                this._body.ease({ width: targetW, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
                this.ease({
                    width: targetW, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onComplete: () => {
                        this._lastTitle = null;
                        this._lastArtist = null;
                        this._lastArtUrl = null;
                        this._currentBusName = null;
                        this.set_width(targetW);
                        if (!fixDock) this.visible = false; else this.visible = true;
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
        let fixDock = this._settings.get_boolean('fix-dock-autohide');
        let startW = fixDock ? 1 : 0;
        this._updateDimensions();
        this.set_width(startW);
        this._body.set_width(startW);
        this.ease({ width: this._targetWidth, opacity: 255, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_BACK });
        this._body.ease({ width: this._targetWidth, duration: 500, mode: Clutter.AnimationMode.EASE_OUT_BACK });
    }

    if (this._lastTitle !== title || this._lastArtist !== artist || forceUpdate) {
        this._titleScroll.setText(title || 'Loading...', forceUpdate);
        this._artistScroll.setText(artist || '', forceUpdate);
        this._lastTitle = title;
        this._lastArtist = artist;
    }

    this._visualizer.setPlaying(status === 'Playing' && !this._gameModeActive);

    if (forceUpdate || (artUrl && artUrl !== this._lastArtUrl)) {
        this._lastArtUrl = artUrl;
        this._artWidget.setArt(artUrl, forceUpdate);
        if (artUrl) {
             this._loadColorFromArt(artUrl);
        }
    } else {
        this._startColorTransition();
    }
    this._updateArtVisibility();
  }

  _loadColorFromArt(artUrl) {
    let file = Gio.File.new_for_uri(artUrl);
    file.load_contents_async(null, (f, res) => {
        try {
            let [ok, bytes] = f.load_contents_finish(res);
            if (ok) {
                let stream = Gio.MemoryInputStream.new_from_bytes(bytes);
                let pixbuf = GdkPixbuf.Pixbuf.new_from_stream(stream, null);
                this._targetColor = getAverageColor(pixbuf);
                this._visualizer.setColor(this._targetColor);
                this._startColorTransition();
            }
        } catch (e) {}
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
      let alpha = (this._currentBgAlpha !== undefined) ? this._currentBgAlpha : 1.0;

      let bgStyle = `background-color: rgba(${r}, ${g}, ${b}, ${alpha});`;
      let borderStyle = `border: 1px solid rgba(255,255,255,${this._currentStatus === 'Playing' ? 0.2 : 0.1});`;
      let paddingStyle = `padding: ${this._padY}px ${this._padX}px;`;
      let radiusStyle = `border-radius: ${this._radius}px;`;

      this._body.set_style(`${bgStyle} ${borderStyle} ${paddingStyle} ${radiusStyle} ${this._shadowCSS}`);

      this._fadeLeft.set_style(`background-gradient-direction: horizontal; background-gradient-start: rgba(${r}, ${g}, ${b}, ${alpha}); background-gradient-end: rgba(${r}, ${g}, ${b}, 0);`);
      this._fadeRight.set_style(`background-gradient-direction: horizontal; background-gradient-start: rgba(${r}, ${g}, ${b}, 0); background-gradient-end: rgba(${r}, ${g}, ${b}, ${alpha});`);

      this._displayedColor = { r, g, b };
  }
});

// --- Extension Entry ---
export default class DynamicMusicExtension extends Extension {
  enable() {
    this._settings = this.getSettings('org.gnome.shell.extensions.dynamic-music-pill');
    this._pill = new MusicPill(this);
    this._proxies = new Map();
    this._lastWinnerName = null;
    this._lastStatusTime = 0;
    this._lastActionTime = 0;
    this._recheckTimer = null;
    this._connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);

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

    this._watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 1, () => {
        this._monitorGameMode();
        if (!this._pill.get_parent()) {
             this._inject();
        }
        return GLib.SOURCE_CONTINUE;
    });
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
    this._connection.call('org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames', null, null, Gio.DBusCallFlags.NONE, -1, null, (c, res) => {
        try {
            let r = smartUnpack(c.call_finish(res));
            let names = Array.isArray(r[0]) ? r[0] : (Array.isArray(r) ? r : []);
            let mprisNames = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
            mprisNames.forEach(n => this._add(n));
            for (let [name, proxy] of this._proxies) {
                if (!mprisNames.includes(name)) this._proxies.delete(name);
            }
            this._updateUI();
        } catch (e) {}
    });
  }

  _add(name) {
    if (this._proxies.has(name)) return;
    try {
        let p = new PlayerProxy(this._connection, name, '/org/mpris/MediaPlayer2');
        p._busName = name;
        p._lastSeen = Date.now();
        p._lastStatusTime = Date.now();
        p._lastPlayingTime = 0;

        p.connect('g-properties-changed', (proxy, changed) => {
            let keys = changed.unpack();
            let now = Date.now();
            p._lastSeen = now;
            p._lastStatusTime = now;

            if (keys.Metadata && this._lastWinnerName === p._busName) {
                this._lastActionTime = now;
            }

            if (keys.PlaybackStatus && smartUnpack(keys.PlaybackStatus) === 'Playing') {
                p._lastPlayingTime = now;
            }
            this._updateUI();
        });
        this._proxies.set(name, p);
    } catch (e) {}
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
        this._lastWinnerName = active._busName;
        let m = active.Metadata;
        let title = null, artist = null, artUrl = null;
        if (m) {
            title = smartUnpack(m['xesam:title']);
            artist = smartUnpack(m['xesam:artist']);
            if (Array.isArray(artist)) artist = artist.map(a => smartUnpack(a)).join(', ');
            artUrl = smartUnpack(m['mpris:artUrl']);
        }
        let now = Date.now();
        let isSkipActive = (now - this._lastActionTime < 3000);
        this._pill.updateDisplay(title, artist, artUrl, active.PlaybackStatus, active._busName, isSkipActive);
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
          if (lockedPlayer) {
              if (lockedPlayer.PlaybackStatus !== 'Playing' && !this._recheckTimer) {
                  let remaining = 3100 - (now - this._lastActionTime);
                  this._recheckTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, remaining, () => {
                      this._updateUI();
                      return GLib.SOURCE_REMOVE;
                  });
              }
              return lockedPlayer;
          }
      }

      let scoredPlayers = proxiesArr.map(p => {
          let score = 0;
          let status = p.PlaybackStatus;
          let m = p.Metadata;
          let hasTitle = m && smartUnpack(m['xesam:title']);
          if (status === 'Playing' && hasTitle) score = 500;
          else if (status === 'Paused' && hasTitle) score = 100;
          else score = 0;
          return { player: p, score: score };
      });

      scoredPlayers.sort((a, b) => {
          if (b.score !== a.score) return b.score - a.score;
          if (b.player._lastPlayingTime !== a.player._lastPlayingTime) {
              return b.player._lastPlayingTime - a.player._lastPlayingTime;
          }
          return b.player._lastSeen - a.player._lastSeen;
      });

      let winner = scoredPlayers[0].player;

      if (winner.PlaybackStatus !== 'Playing') {
          let anyPlaying = scoredPlayers.find(s => s.player.PlaybackStatus === 'Playing' && smartUnpack(s.player.Metadata['xesam:title']));
          if (anyPlaying) winner = anyPlaying.player;
      }

      let winM = winner.Metadata;
      if (!winM || !smartUnpack(winM['xesam:title']) || (winner.PlaybackStatus === 'Stopped' && (now - this._lastActionTime >= 3000))) {
          let backup = scoredPlayers.find(s => s.player.PlaybackStatus === 'Playing' && smartUnpack(s.player.Metadata['xesam:title']));
          if (backup) return backup.player;
          return null;
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
    if (this._ownerId) this._connection.signal_unsubscribe(this._ownerId);
    this._pill.destroy();
    this._proxies.clear();
    this._settings = null;
  }
}