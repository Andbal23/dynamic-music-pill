import Cairo from 'cairo';
import GdkPixbuf from 'gi://GdkPixbuf';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { formatTime, getAverageColor, smartUnpack } from './utils.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';
const _ = Extension.lookupByURL(import.meta.url).gettext;

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
        if (!force && this._currentUrl === newUrl && this.get_children().length > 0) return;
        this._currentUrl = newUrl;
        this._updateContainerStyle();

        let newLayer = new St.Widget({ x_expand: true, y_expand: true, opacity: 0 });
        newLayer._bgUrl = newUrl;
        
        this.add_child(newLayer);
        this._refreshLayerStyle(newLayer);
        
        this._activeLayer = newLayer;

        newLayer.ease({
            opacity: 255,
            duration: 1800, 
            mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            onStopped: (isFinished) => {
		    if (!isFinished) return;
		    this.get_children().forEach(c => {
			if (c !== this._activeLayer) {
			    c.destroy();
			}
		    });
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

    _cleanup() {
        this._stopAnimation();
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

        let fadeEnabled = false;
        let fadeDuration = 250;
        if (this._settings) {
            fadeEnabled = this._settings.get_boolean('lyric-fade-enable');
            fadeDuration = this._settings.get_int('lyric-fade-duration');
        }

        if (lyricTime > 0 && fadeEnabled) {
            this._label1.remove_transition('opacity');
            this._label1.opacity = 0;
            this._label1.ease({
                opacity: 255,
                duration: fadeDuration,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
        } else {
            this._label1.remove_transition('opacity');
            this._label1.opacity = 255;
        }

        this._label1.text = this._text;
        this._label2.text = this._text;
        this._label2.hide();
        this._separator.hide();

        this._label1.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        if (!this._settings.get_boolean('scroll-text') && !this._lyricTime) {
            return;
        }

        if (this._measureTimeout) { GLib.Source.remove(this._measureTimeout); this._measureTimeout = null; }
        this._measureTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._measureTimeout = null;
            if (this.has_allocation()) this._checkOverflow();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopAnimation(resetPosition = true) {
        this._isScrolling = false;
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
            if (this._scrollTimer) GLib.Source.remove(this._scrollTimer);
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

const CavaVisualizer = GObject.registerClass(
class CavaVisualizer extends St.DrawingArea {
    _init(settings, isPopup = false) {
        super._init({ y_expand: true, x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL });
        this._settings = settings;
        this._isPopup = isPopup;
        this._barCount = this._isPopup ? (this._settings.get_int('popup-visualizer-bars') || 10) : (this._settings.get_int('visualizer-bars') || 10);
        
        this._prevHeights = new Array(this._barCount).fill(1);
        this._peakValues = new Array(this._barCount).fill(0);
        this._bins = new Array(this._barCount).fill(0);
        this._silentFrames = 0;
        
        this._colorR = 1.0; this._colorG = 1.0; this._colorB = 1.0;
        this._isPlaying = false;
        
        this.set_width(this._barCount * 4);
        
        this.connect('repaint', this._onRepaint.bind(this));
        this.connect('destroy', this._cleanup.bind(this));
    }

    _updateBarCount() {
        this._barCount = this._isPopup ? (this._settings.get_int('popup-visualizer-bars') || 10) : (this._settings.get_int('visualizer-bars') || 10);
        let bw = this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2);
        this._prevHeights = new Array(this._barCount).fill(1);
        this._peakValues = new Array(this._barCount).fill(0);
        this._bins = new Array(this._barCount).fill(0);
        this.set_width(this._barCount * (bw + 2) - 2);
        
        if (this._isPlaying) {
            this._stopCava();
            this._startCava();
        }
    }

    setColor(c) {
        let r = 255, g = 255, b = 255;
        if (c && typeof c.r === 'number' && !isNaN(c.r)) r = Math.min(255, c.r + 100);
        if (c && typeof c.g === 'number' && !isNaN(c.g)) g = Math.min(255, c.g + 100);
        if (c && typeof c.b === 'number' && !isNaN(c.b)) b = Math.min(255, c.b + 100);
        
        this._colorR = r / 255.0;
        this._colorG = g / 255.0;
        this._colorB = b / 255.0;
        this.queue_repaint();
    }

    setPlaying(playing) {
        this._isPlaying = playing;
        if (playing) {
            this._startCava();
        } else {
            this._stopCava();
            this._prevHeights.fill(1);
            this._peakValues.fill(0);
            this.queue_repaint();
        }
    }

    _startCava() {
        if (this._process) return;
        try {
            if (!GLib.find_program_in_path('cava')) return;

            let tmpConfig = `${GLib.get_tmp_dir()}/dynamic-pill-cava-${GLib.get_monotonic_time()}`;
            
            let cfg = `[general]\n` +
                      `bars = ${this._barCount}\n` +
                      `framerate = 60\n` +
                      `autosens = 1\n` +
                      `lower_cutoff_freq = 50\n` +
                      `higher_cutoff_freq = 8000\n` +  
                      `[smoothing]\n` +
                      `monstercat = 1.5\n` +        
                      `waves = 0\n` +
                      `noise_reduction = 60\n` +   
                      `gravity = 140\n` +             
                      `[input]\n` +
                      `method = pulse\n` +
                      `source = auto\n` +
                      `[output]\n` +
                      `method = raw\n` +
                      `bit_format = 16bit\n` +
                      `channels = mono\n` +
                      `raw_target = /dev/stdout\n`;

            GLib.file_set_contents(tmpConfig, new TextEncoder().encode(cfg));
            this._tmpConfigPath = tmpConfig;

            this._process = Gio.Subprocess.new(['cava', '-p', tmpConfig], Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE);
            this._stdout = this._process.get_stdout_pipe();
            this._cancellable = new Gio.Cancellable();
            this._bufferUsed = 0;
            this._rawBuffer = new Uint8Array(8192);

            this._readStdoutBytes();
        } catch (e) {
            console.error("[Dynamic Music Pill] Cava error: " + e.message);
        }
    }

    _readStdoutBytes() {
        if (!this._stdout || !this._cancellable || this._cancellable.is_cancelled()) return;

        let readSize = Math.max(4096, this._barCount * 2 * 4);
        this._stdout.read_bytes_async(readSize, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
            try {
                if (!this || (this.is_finalized && this.is_finalized())) return;

                let gbytes = stream.read_bytes_finish(res);
                if (!gbytes) return;

                let chunk = gbytes.get_data();
                if (!chunk || chunk.length === 0) {
                    this._readStdoutBytes();
                    return;
                }

                let needed = this._bufferUsed + chunk.length;
                if (needed > this._rawBuffer.length) {
                    let newBuffer = new Uint8Array(Math.max(needed, this._rawBuffer.length * 2));
                    newBuffer.set(this._rawBuffer.subarray(0, this._bufferUsed));
                    this._rawBuffer = newBuffer;
                }
                this._rawBuffer.set(chunk, this._bufferUsed);
                this._bufferUsed += chunk.length;

                let frameSize = this._barCount * 2;
                let totalFrames = Math.floor(this._bufferUsed / frameSize);

                if (totalFrames > 0) {
                    let lastFrameOffset = (totalFrames - 1) * frameSize;
                    let dv = new DataView(this._rawBuffer.buffer, this._rawBuffer.byteOffset + lastFrameOffset, frameSize);

                    if (this._rollingMax === undefined) this._rollingMax = 2000;

                    let currentFrameMax = 1;
                    for (let i = 0; i < this._barCount; i++) {
                        let v = dv.getUint16(i * 2, true);
                        this._bins[i] = v;
                        if (v > currentFrameMax) currentFrameMax = v;
                    }

                    if (currentFrameMax < 100) {
                        this._silentFrames++;
                    } else {
                        this._silentFrames = 0;
                    }

                    if (this._silentFrames >= 30) {
                        this._prevHeights.fill(1);
                        this._peakValues.fill(0);
                        this._rollingMax = 2000; // Reset
                    } else {
                        if (currentFrameMax > this._rollingMax) {
                            this._rollingMax = currentFrameMax;
                        } else {
                            this._rollingMax = this._rollingMax * 0.98 + currentFrameMax * 0.02;
                        }
                        
                        let safeMax = Math.max(this._rollingMax, 5000); 
                        let invMaxVal = 1 / safeMax;
                        
                        let totalHeight = this.get_height() || 24;
                        let maxHalfHeight = totalHeight / 2;

                        for (let i = 0; i < this._barCount; i++) {
                            let v = this._bins[i];
                            
                            let norm = Math.min(1.0, v * invMaxVal); 
                            
                            let visualCurve = Math.pow(norm, 0.8); 
                            let target = Math.max(1, Math.round(visualCurve * maxHalfHeight));
                            
                            if (this._silentFrames === 0 && v > 0 && target < 3) target = 3;

                            let prev = this._prevHeights[i];
                            let alpha = target < prev ? 0.6 : 0.95;
                            let height = Math.round(prev * (1 - alpha) + target * alpha);
                            this._prevHeights[i] = height;

                            if (height > this._peakValues[i]) {
                                this._peakValues[i] = height;
                            } else {
                                this._peakValues[i] -= this._peakValues[i] * 0.06;
                            }
                        }
                    }

                    this._rawBuffer.copyWithin(0, totalFrames * frameSize, this._bufferUsed);
                    this._bufferUsed -= totalFrames * frameSize;
                    this.queue_repaint();
                }
                this._readStdoutBytes();
            } catch (e) { }
        });
    }

    _stopCava() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._process) {
            try { this._process.force_exit(); } catch (e) { }
            this._process = null;
        }
        if (this._stdout) {
            try { this._stdout.close(null); } catch (e) { }
            this._stdout = null;
        }
        if (this._tmpConfigPath) {
            try {
                let file = Gio.File.new_for_path(this._tmpConfigPath);
                if (file.query_exists(null)) file.delete(null);
            } catch (e) { }
            this._tmpConfigPath = null;
        }
    }

    _onRepaint() {
        let cr = this.get_context();
        let width = this.get_width();
        let height = this.get_height();
        if (width <= 0 || height <= 0) return;

        cr.setOperator(Cairo.Operator.CLEAR);
        cr.paint();
        cr.setOperator(Cairo.Operator.OVER);
        let barWidth = this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2);
        let gap = 2;
        let totalBarWidth = this._barCount * (barWidth + gap) - gap;
	let offsetX = 0;
        let centerY = Math.floor(height / 2);
        let isSilent = this._silentFrames >= 30;

        for (let i = 0; i < this._barCount; i++) {
            let halfHeight = Math.max(1, this._prevHeights[i]);
            let x = offsetX + i * (barWidth + gap);
            let edgeFade = 1 - (Math.abs(i - (this._barCount - 1) / 2) / ((this._barCount - 1) / 2)) * 0.35;
            let barAlpha = isSilent ? 0.3 * edgeFade : 1.0 * edgeFade;

            cr.setSourceRGBA(this._colorR, this._colorG, this._colorB, barAlpha);
            cr.rectangle(x, centerY - halfHeight, barWidth, halfHeight * 2);
            cr.fill();

            if (!isSilent) {
                let peak = Math.max(1, this._peakValues[i]);
                cr.setSourceRGBA(this._colorR, this._colorG, this._colorB, barAlpha * 0.55);
                cr.rectangle(x, centerY - peak - 1, barWidth, 1);
                cr.fill();
                cr.rectangle(x, centerY + peak, barWidth, 1);
                cr.fill();
            }
        }
        cr.$dispose();
    }

    _cleanup() {
        this._stopCava();
    }
});

const SimulatedVisualizer = GObject.registerClass(
class SimulatedVisualizer extends St.BoxLayout {
    _init(settings, isPopup = false) {
        super._init({ style: `spacing: 2px;`, y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END });
        this.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
        this._settings = settings;
        this._isPopup = isPopup;
        this._bars = [];
        this._color = '255,255,255';
        this._mode = 1;
        this._isPlaying = false;
        this._timerId = null;

        this._updateBarCount();
        this.connect('destroy', this._cleanup.bind(this));
    }

    _updateBarCount() {
        this.destroy_all_children();
        this._bars = [];
        let count = this._isPopup ? (this._settings.get_int('popup-visualizer-bars') || 10) : (this._settings.get_int('visualizer-bars') || 4);
        let barWidth = this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2);

        for (let i = 0; i < count; i++) {
            let bar = new St.Widget({ style_class: 'visualizer-bar' });
            bar.set_width(barWidth);
            bar.set_pivot_point(0.5, this._mode === 2 ? 0.5 : 1.0);
            this.add_child(bar);
            this._bars.push(bar);
        }
        this._updateBarsCss();
    }

    _cleanup() {
        if (this._timerId) {
            GLib.Source.remove(this._timerId);
            this._timerId = null;
        }
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
        if (this._timerId) { GLib.Source.remove(this._timerId); this._timerId = null; }

        if (playing && this._mode !== 0) {
            this._timerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                if (!this || this.is_finalized && this.is_finalized() || !this.get_parent()) 
                    return GLib.SOURCE_REMOVE;
                
                if (!this.mapped) return GLib.SOURCE_CONTINUE;
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
        let barWidth = this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2);
        let bRad = barWidth >= 4 ? 2 : (barWidth > 1 ? 1 : 0);
        let css = `background-color: rgba(${this._color}, ${opacity}); border-radius: ${bRad}px;`;
        this._bars.forEach(bar => { bar.set_style(css); });
    }

    _updateVisuals(t) {
        if (!this.get_parent()) return;
        if (!this._isPlaying) {
            this._bars.forEach(bar => bar.scale_y = 0.2);
            return;
        }
        let speeds = [1.1, 1.6, 1.3, 1.8, 1.5, 1.2, 1.7, 1.4];
        this._bars.forEach((bar, idx) => {
            let scaleY = 0.2;
            if (this._mode === 1) {
                let wave = (Math.sin(t - idx * 1.0) + 1) / 2;
                scaleY = 0.3 + (wave * 0.7);
            } else if (this._mode === 2) {
                let pulse = (Math.sin(t * speeds[idx % speeds.length]) + 1) / 2;
                scaleY = 0.3 + (pulse * 0.7);
            }
            bar.scale_y = scaleY;
        });
    }
});

export const WaveformVisualizer = GObject.registerClass(
class WaveformVisualizer extends St.Bin {
    _init(defaultHeight = 24, settings, isPopup = false) {
        super._init({ y_align: Clutter.ActorAlign.CENTER, x_align: Clutter.ActorAlign.END, y_expand: true });
        this._settings = settings;
        this._isPopup = isPopup;
        this._baseHeight = defaultHeight;
        
        this._simulated = new SimulatedVisualizer(this._settings, isPopup);
        this._cava = null;
        this._mode = 1;
        this._isPlaying = false;
        
        this.set_child(this._simulated);

        if (this._isPopup) {
            this._settings.connectObject('changed::popup-visualizer-bars', () => this._updateSize(), this);
            this._settings.connectObject('changed::popup-visualizer-bar-width', () => this._updateSize(), this);
            this._settings.connectObject('changed::popup-visualizer-height', () => this._updateSize(), this);
        } else {
            this._settings.connectObject('changed::visualizer-bars', () => this._updateSize(), this);
            this._settings.connectObject('changed::visualizer-bar-width', () => this._updateSize(), this);
            this._settings.connectObject('changed::visualizer-height', () => this._updateSize(), this);
        }
        
        this._updateSize();
    }

    _updateSize() {
        let h = this._isPopup ? (this._settings.get_int('popup-visualizer-height') || 80) : (this._settings.get_int('visualizer-height') || 24);
        if (this._maxHeight && !this._isPopup) h = Math.min(h, this._maxHeight);
        
        this.set_height(h);
        this._simulated.set_height(h);
        this._simulated._updateBarCount();
        if (this._cava) {
            this._cava.set_height(h);
            this._cava._updateBarCount();
        }
    }

    setHeightClamped(maxH) {
        this._maxHeight = maxH;
        this._updateSize();
    }

    setMode(m) {
        if (m === 3 && !GLib.find_program_in_path('cava')) {
            Main.notify('Dynamic Music Pill', _('Please install "cava" for real-time mode.'));
            m = 2;
        }

        this._mode = m;
        if (m === 3) {
            if (!this._cava) {
		this._cava = new CavaVisualizer(this._settings, this._isPopup);
                if (this._lastColor) this._cava.setColor(this._lastColor);
            }
            if (this.get_child() !== this._cava) this.set_child(this._cava);
            this._cava.setPlaying(this._isPlaying);
            this._simulated.setPlaying(false);
        } else {
            if (this.get_child() !== this._simulated) {
                this.set_child(this._simulated);
                if (this._cava) this._cava.setPlaying(false);
            }
            this._simulated.setMode(m);
            this._simulated.setPlaying(this._isPlaying);
        }
    }

    setColor(c) {
        this._lastColor = c;
        this._simulated.setColor(c);
        if (this._cava) this._cava.setColor(c);
    }

    setPlaying(playing) {
        this._isPlaying = playing;
        if (this._mode === 3 && this._cava) this._cava.setPlaying(playing);
        else this._simulated.setPlaying(playing);
    }
});

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

        this._box = new PixelSnappedBox({
            style_class: 'music-pill-expanded',
            reactive: true
        });
        this._box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        this._box.connectObject('button-press-event', () => Clutter.EVENT_STOP, this);
        this._box.connectObject('touch-event', () => Clutter.EVENT_STOP, this);
        this.add_child(this._box);
        
        this._playerSelectorBox = new PixelSnappedBox({
            vertical: false,
            x_align: Clutter.ActorAlign.CENTER,
            style: 'margin-bottom: 12px; spacing: 10px;'
        });
        this._box.add_child(this._playerSelectorBox);
        
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
        this._artistLabel = new ScrollLabel('expanded-artist', this._settings);

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
        
        this._box.add_child(topRow);

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
	    style:'text-align: right;'
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
        this._box.add_child(progressBox);

        let controlsRow = new PixelSnappedBox({ style_class: 'controls-row', vertical: false, x_align: Clutter.ActorAlign.CENTER, reactive: true });
        
        this._shuffleIcon = new St.Icon({ icon_name: 'media-playlist-shuffle-symbolic', icon_size: 16 });
        this._shuffleBtn = new St.Button({ style_class: 'control-btn-secondary', child: this._shuffleIcon, reactive: true, can_focus: true });
        this._shuffleBtn.connectObject('button-release-event', () => { this._controller.toggleShuffle(); return Clutter.EVENT_STOP; }, this);
        this._shuffleBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.toggleShuffle(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

        this._prevBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-backward-symbolic', icon_size: 24 }), reactive: true, can_focus: true });
        this._prevBtn.connectObject('button-release-event', () => { this._controller.previous(); return Clutter.EVENT_STOP; }, this);
        this._prevBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.previous(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

        this._playPauseIcon = new St.Icon({ icon_name: 'media-playback-start-symbolic', icon_size: 24 });
        this._playPauseBtn = new St.Button({ style_class: 'control-btn', child: this._playPauseIcon, reactive: true, can_focus: true });
        this._playPauseBtn.connectObject('button-release-event', () => { this._controller.togglePlayback(); return Clutter.EVENT_STOP; }, this);
        this._playPauseBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.togglePlayback(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

        this._nextBtn = new St.Button({ style_class: 'control-btn', child: new St.Icon({ icon_name: 'media-skip-forward-symbolic', icon_size: 24 }), reactive: true, can_focus: true });
        this._nextBtn.connectObject('button-release-event', () => { this._controller.next(); return Clutter.EVENT_STOP; }, this);
        this._nextBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.next(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

        this._repeatIcon = new St.Icon({ icon_name: 'media-playlist-repeat-symbolic', icon_size: 16 });
        this._repeatBtn = new St.Button({ style_class: 'control-btn-secondary', child: this._repeatIcon, reactive: true, can_focus: true });
        this._repeatBtn.connectObject('button-release-event', () => { this._controller.toggleLoop(); return Clutter.EVENT_STOP; }, this);
        this._repeatBtn.connectObject('touch-event', (actor, event) => { if (event.type() === Clutter.EventType.TOUCH_END) { this._controller.toggleLoop(); return Clutter.EVENT_STOP; } return Clutter.EVENT_PROPAGATE; }, this);

        controlsRow.add_child(this._shuffleBtn);
        controlsRow.add_child(this._prevBtn);      
        controlsRow.add_child(this._playPauseBtn);   
        controlsRow.add_child(this._nextBtn);       
        controlsRow.add_child(this._repeatBtn);

        this._box.add_child(controlsRow);

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
        
        autoBtn.connectObject('button-release-event', () => {
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
            let rawAppName = busName.replace('org.mpris.MediaPlayer2.', '').split('.')[0];
            let isSelected = (currentSelected === busName);
            
            let icon = new St.Icon({ 
                icon_name: rawAppName.toLowerCase(), 
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

            btn.connectObject('button-release-event', () => {
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
            safeR = parseInt(customBg[0]) || 40;
            safeG = parseInt(customBg[1]) || 40;
            safeB = parseInt(customBg[2]) || 40;
        }

        let bgStyle = `background-color: rgba(${safeR}, ${safeG}, ${safeB}, ${finalAlpha});`;

        let shadowOp = Math.min(0.5, finalAlpha);
        let shadowStyle = useShadow ? `box-shadow: 0px 8px 30px rgba(0,0,0,${shadowOp});` : 'box-shadow: none;';

        let borderOp = Math.min(0.1, finalAlpha * 0.2);
        let borderStyle = `border-width: 1px; border-style: solid; border-color: rgba(255,255,255,${borderOp});`;

	let minWLimit = this._settings.get_boolean('show-shuffle-loop') ? 310 : 240;
        let css = `${bgStyle} ${borderStyle} border-radius: ${radius}px; padding: 20px; ${shadowStyle} min-width: ${minWLimit}px; max-width: 600px;`;

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
            fgR = parseInt(customTextStr[0]) || 255;
            fgG = parseInt(customTextStr[1]) || 255;
            fgB = parseInt(customTextStr[2]) || 255;
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

        if (this._sliderFill) this._sliderFill.set_style(`background-color: ${textColor};`);
        if (this._sliderBin) this._sliderBin.set_style(`background-color: rgba(${fgR}, ${fgG}, ${fgB}, 0.2);`);

    }

    updateContent(title, artist, artUrl, status) {
        if (this._titleLabel && this._titleLabel._text !== title) {
            this._titleLabel.setText(title || _('Unknown Title'), false);
        }
        if (this._artistLabel && this._artistLabel._text !== artist) {
            this._artistLabel.setText(artist || _('Unknown Artist'), false);
        }

        this._seekLockTime = 0;

        let trackChanged = (this._currentArtUrl !== artUrl || this._lastTrackTitle !== title);
        this._lastTrackTitle = title;
        if (trackChanged && this._player) {
            this._player._lastPosition = 0;
            this._player._lastPositionTime = Date.now();
        }

        let showVinyl = this._settings.get_boolean('popup-show-vinyl');
        if (!artUrl || !showVinyl) {
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
        } else {
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
                let bg = `url("${artUrl}")`;
                let style = `background-image: ${bg}; background-size: cover; border-radius: ${radius}px;`;

                let newLayer = new St.Widget({ 
                    style: style, 
                    width: 100,      
                    height: 100,
                    x_expand: true, 
                    y_expand: true, 
                    opacity: this._vinyl.get_children().length > 0 ? 0 : 255 
                });

                this._vinyl.add_child(newLayer);
                
                this._activeVinylLayer = newLayer;

                if (this._vinyl.get_children().length > 1) {
                    newLayer.ease({
                        opacity: 255,
                        duration: 1200, 
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                        onStopped: (isFinished) => {
                            if (isFinished) {
                                this._vinyl.get_children().forEach(c => {
                                    if (c !== this._activeVinylLayer) {
                                        c.destroy();
                                    }
                                });
                            }
                        }
                    });
                }
            } else {
                let bg = `url("${artUrl}")`;
                let style = `background-image: ${bg}; background-size: cover; border-radius: ${radius}px;`;
                this._vinyl.get_children().forEach(c => c.set_style(style));
            }
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
        
        this._updatePlayerSelector();
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

        this._controller._connection.call(
            player._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                let result = conn.call_finish(res);
                let val = smartUnpack(result.deep_unpack()[0]);
                if (typeof val === 'number') {
                    player._lastPosition = val;
                    player._lastPositionTime = Date.now();
                }
            }
        );

        this._startTimer();
        this._visualizer.setMode(this._settings.get_int('visualizer-style'));
        let showVis = this._settings.get_boolean('popup-show-visualizer') && this._settings.get_int('visualizer-style') !== 0;
        this._visBin.visible = showVis;
        this._visualizer.visible = showVis;
        
        if (showVis && this._settings.get_boolean('popup-hide-pill-visualizer')) {
            if (this._controller._pill) this._controller._pill._setPopupOpen(true);
        }
    }

    hide() {
        this._stopTimer();
        this._stopVinyl();
        if (this._controller._pill) this._controller._pill._setPopupOpen(false);
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

    _cleanup() {
        if (this._updateTimer) { GLib.Source.remove(this._updateTimer); this._updateTimer = null; }
        if (this._resizeDebounceId) { GLib.Source.remove(this._resizeDebounceId); this._resizeDebounceId = null; }
        if (this._leaveHideTimeoutId) { GLib.Source.remove(this._leaveHideTimeoutId); this._leaveHideTimeoutId = null; }
    }

    _startTimer() {
        if (this._updateTimer) GLib.Source.remove(this._updateTimer);
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
        let totalW = Math.round(this._sliderBin.get_width());
        
        if (totalW > 0) {
            let targetWidth = Math.round(totalW * percent);
            if (Math.abs(this._sliderFill.width - targetWidth) >= 1) {
                this._sliderFill.width = Math.max(6, targetWidth);
            }
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
            GLib.Source.remove(this._resizeDebounceId);
            this._resizeDebounceId = null;
        }

        this._resizeDebounceId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._resizeDebounceId = null;
            if (!this._box) return GLib.SOURCE_REMOVE;

            let currentW = this._box.width;
            let currentX = Math.round(this._box.x);
            let currentY = Math.round(this._box.y);

            this._box.set_width(-1);
            let [minW, natW] = this._box.get_preferred_width(-1);
            natW = Math.ceil(natW);
            let [minH, natH] = this._box.get_preferred_height(natW);
            natH = Math.ceil(natH);

            let baseMinW = this._settings.get_boolean('show-shuffle-loop') ? 310 : 240;
            
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
            if (currentW > 0) this._box.set_width(currentW);

            let pill = this._controller._pill;
            if (!pill || !pill.get_parent()) return GLib.SOURCE_REMOVE;
            let [px, py] = pill.get_transformed_position();
            let [pw, ph] = pill.get_transformed_size();
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

                let isTopEdge = (py < monitor.y + (monitor.height / 2));
                if (isTopEdge) {
                    targetY = Math.round(py + ph + 15);
                } else {
                    targetY = Math.round(py - menuH - 15);
                }
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
        layout_manager: new Clutter.BinLayout(), 
        y_expand: true,
        y_align: Clutter.ActorAlign.FILL,
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
        this._hoverTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._hoverTimeout = null;
            let action = this._settings.get_string('action-hover');
            if (action && action !== 'none') {
                this._controller.performAction(action);
            }
            return GLib.SOURCE_REMOVE;
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
    this._settings.connectObject('changed::hide-text', () => this._updateDimensions(), this);
    this._settings.connectObject('changed::pill-dynamic-width', () => { this._updateDimensions(); if(this._isActiveState) 		this._body.ease({ width: this._targetWidth, duration: 300, mode: Clutter.AnimationMode.EASE_OUT_QUAD }); }, this);
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
        this._allocTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._allocTimer = null;
            let parent = this.get_parent();
            if (parent && !this._inPanel) {
                let [pw, ph] = parent.get_size();
                let side = (pw > 0 && ph > 0 && pw < ph);
                if (this._isSidePanel !== side) {
                    this._updateDimensions();
                }
            }
            return GLib.SOURCE_REMOVE;
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
        if (!this.get_parent()) return GLib.SOURCE_CONTINUE;
        this._checkRealVisibility();
        return GLib.SOURCE_CONTINUE;
    });

    this.connect('destroy', this._cleanup.bind(this));
  }

  _cleanup() {
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
          this._singleClickTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, doubleClickTime, () => {
              this._singleClickTimerId = null;
              this._lastLeftClickTime = 0; 
              if (singleAction && singleAction !== 'none') {
                  this._controller.performAction(singleAction);
              }
              return GLib.SOURCE_REMOVE;
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
          this._visualizer.setPlaying(this._currentStatus === 'Playing' && isVisibleAndActive);
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

        let rawPadX = Math.floor((width - 160) * (10 / 140) + 4);
        this._padX = Math.max(4, Math.min(14, rawPadX));

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

        if ((width < 220 && !hideText) || visStyle === 0 || forceHideVis) {
            this._visBin.hide();
            this._visBin.set_width(0);
            this._visBin.set_height(0);
            this._visBin.set_style('margin: 0px;');
            this._fadeLeft.set_width(10);
            this._fadeRight.set_width(10);
            
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
            this._fadeLeft.set_width(30);
            this._fadeRight.set_width(30);
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

        this._idleDimId = GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
            this._idleDimId = null;
            if (this._titleScroll) this._titleScroll._checkResize();
            if (this._artistScroll) this._artistScroll._checkResize();
            return GLib.SOURCE_REMOVE;
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
        if (this._titleScroll) this._titleScroll.setText(tempTitle || '', true, 0);
        if (this._artistScroll) this._artistScroll.setText(tempArtist || '', true);
        
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

        if (shouldKeepOpen) {
            this._origTitle = tempTitle;
            this._origArtist = tempArtist;
            
            if (this._hideGraceTimer) {
                GLib.Source.remove(this._hideGraceTimer);
                this._hideGraceTimer = null;
            }
            
            this._currentStatus = 'Stopped';
            this._updatePlayingStates();

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
          let borderOp = (this._currentStatus === 'Playing') ? 0.2 : 0.1;
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

      this._displayedColor = { r: safeDynR, g: safeDynG, b: safeDynB };

      if (this._controller && this._controller._expandedPlayer && this._controller._expandedPlayer.visible) {
          if (this._controller._expandedPlayer.updateStyle) {
              this._controller._expandedPlayer.updateStyle(safeDynR, safeDynG, safeDynB, alpha);
          }
      }
  }
});

export const PlayerSelectorMenu = GObject.registerClass(
class PlayerSelectorMenu extends St.Widget {
    _init(controller) {
        let [bgW, bgH] = global.display.get_size();
        super._init({ width: bgW, height: bgH, reactive: true, visible: false, x: 0, y: 0 });

        this._controller = controller;
        this._settings = controller._settings;

        this._backgroundBtn = new St.Button({ style: 'background-color: transparent;', reactive: true, x_expand: true, y_expand: true, width: bgW, height: bgH });
        this._backgroundBtn.connectObject('clicked', () => { this.hide(); }, this);
        this.add_child(this._backgroundBtn);

        this._box = new St.BoxLayout({ reactive: true });
        this._box.layout_manager.orientation = Clutter.Orientation.VERTICAL;
        this.add_child(this._box);
        
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

        this.connect('destroy', () => {
            if (this._leaveHideTimeoutId) {
                GLib.Source.remove(this._leaveHideTimeoutId);
                this._leaveHideTimeoutId = null;
            }
        });
    }

    populate() {
        this._box.destroy_all_children();

        let pill = this._controller._pill;
        let c = pill ? pill._displayedColor : { r: 40, g: 40, b: 40 };
        let r = c.r, g = c.g, b = c.b;

        if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-bg')) {
            let customBg = this._settings.get_string('custom-bg-color').split(',');
            r = parseInt(customBg[0]) || 40;
            g = parseInt(customBg[1]) || 40;
            b = parseInt(customBg[2]) || 40;
        }

        let textColorStyle = '';
        if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-text')) {
            let customTextStr = this._settings.get_string('custom-text-color');
            textColorStyle = `color: rgb(${customTextStr});`;
        } else {
            let brightness = (r * 299 + g * 587 + b * 114) / 1000;
            if (brightness > 160) {
                textColorStyle = `color: rgb(30, 30, 30);`;
            } else {
                textColorStyle = `color: rgb(255, 255, 255);`;
            }
        }

        let titleLabel = new St.Label({ 
            text: _('Select Media Player'),
            style: `font-weight: bold; margin-bottom: 15px; font-size: 12pt; ${textColorStyle}`, 
            x_align: Clutter.ActorAlign.CENTER 
        });
        this._box.add_child(titleLabel);

        let currentSelected = this._settings.get_string('selected-player-bus');

        // ==== Auto (Smart Selection) Button ====
        let autoContent = new St.BoxLayout({ vertical: false, style: 'spacing: 12px;' });
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
            style: `margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${currentSelected === '' ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`
        });
        
        
        autoBtn.connectObject('clicked', () => {
            this._settings.set_string('selected-player-bus', '');
            this._controller._updateUI();
            this.hide();
        }, this);

        autoBtn.connectObject('touch-event', (actor, event) => {
            let type = event.type();
            if (type === Clutter.EventType.TOUCH_END) {
                this._settings.set_string('selected-player-bus', '');
                this._controller._updateUI();
                this.hide();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        }, this);

        autoBtn.connect('notify::hover', () => {
            if (this._settings.get_string('selected-player-bus') === '') return;
            autoBtn.set_style(`margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${autoBtn.hover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`);
        });
        
        this._box.add_child(autoBtn);

        // ==== Aktive Players Button ====
        for (let [busName, proxy] of this._controller._proxies) {
            
            let rawAppName = busName.replace('org.mpris.MediaPlayer2.', '').split('.')[0];
            let iconName = proxy._desktopEntry || rawAppName.toLowerCase();
            let identity = (proxy._identity || (rawAppName.charAt(0).toUpperCase() + rawAppName.slice(1))).replace(/\b\w/g, c => c.toUpperCase());
            let btnContent = new St.BoxLayout({ vertical: false, style: 'spacing: 12px;' });
            
            let icon = new St.Icon({ 
                icon_name: iconName, 
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
                style: `margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${isSelected ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;` 
            });

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
                btn.set_style(`margin-bottom: 8px; border-radius: 12px; padding: 10px; background-color: ${btn.hover ? 'rgba(255,255,255,0.15)' : 'rgba(255,255,255,0.05)'}; transition-duration: 150ms;`);
            });

            this._box.add_child(btn);
        }
    }

    showMenu() {
        this.populate();
        this.visible = true;
        this.opacity = 0;
        this.ease({ opacity: 255, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        let pill = this._controller._pill;
        let [px, py] = pill.get_transformed_position();
        let [pw, ph] = pill.get_transformed_size();
        let monitor = Main.layoutManager.findMonitorForActor(pill);

        let c = pill._displayedColor;
        let bgAlpha = pill._currentBgAlpha || 0.95;
        
        let r = c.r, g = c.g, b = c.b;
        if (this._settings.get_boolean('use-custom-colors') && this._settings.get_boolean('popup-follow-custom-bg')) {
            let customBg = this._settings.get_string('custom-bg-color').split(',');
            r = parseInt(customBg[0]) || 40;
            g = parseInt(customBg[1]) || 40;
            b = parseInt(customBg[2]) || 40;
        }

        this._box.set_style(`background-color: rgba(${r}, ${g}, ${b}, ${bgAlpha}); padding: 15px; border-radius: 20px; box-shadow: 0px 8px 30px rgba(0,0,0,0.5);`);

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
    }
    hide() {
        if (this._isHiding) return;
        
        if (this._leaveHideTimeoutId) {
            GLib.Source.remove(this._leaveHideTimeoutId);
            this._leaveHideTimeoutId = null;
        }

        this._isHiding = true;
        this.ease({ opacity: 0, duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD, onStopped: () => {
            this.visible = false;
            this._isHiding = false; 
            if (this._controller) this._controller.closePlayerMenu();
        }});
    }
});
