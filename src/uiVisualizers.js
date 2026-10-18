import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SharedVisualizerEngine } from './visualizerEngine.js';

const CavaVisualizer = GObject.registerClass(
    class CavaVisualizer extends St.DrawingArea {
        _init(settings, isPopup = false) {
            super._init({ y_expand: true, x_align: Clutter.ActorAlign.FILL, y_align: Clutter.ActorAlign.FILL });
            this._settings = settings;
            this._isPopup = isPopup;
            this._barCount = this._isPopup ? (this._settings.get_int('popup-visualizer-bars') || 10) : (this._settings.get_int('visualizer-bars') || 10);

            this._prevHeights = new Array(this._barCount).fill(1);
            this._peakValues = new Array(this._barCount).fill(0);
            this._isSilent = true;
            this._isPlaying = false;

            this._colorR = 1.0; this._colorG = 1.0; this._colorB = 1.0;
            this.set_width(this._barCount * 4);

            this.connect('repaint', this._onRepaint.bind(this));

            let engine = SharedVisualizerEngine.get();
            this._engine = engine;
            let callback = (normalizedBars, isSilent) => {
                if (!this._isPlaying || !this.mapped) return;
                this._onEngineUpdate(normalizedBars, isSilent);
            };
            this._engineCallback = callback;
            this._engine.subscribe(this._engineCallback);
        }

        setSidePanel(isSidePanel, maxWidth) {
            this._isSidePanel = isSidePanel;
            this._maxWidth = maxWidth;
            this._updateBarCount();
        }

        _updateBarCount() {
            let desiredBars = this._isPopup ? (this._settings.get_int('popup-visualizer-bars') || 10) : (this._settings.get_int('visualizer-bars') || 10);
            let desiredBw = this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2);
            let gap = 2;
            let barCount = desiredBars;
            let bw = desiredBw;

            if (this._isSidePanel && this._maxWidth && !this._isPopup) {
                let availW = Math.max(10, Math.floor(this._maxWidth));
                if (barCount * (bw + gap) - gap > availW) {
                    if (bw > 2 && barCount * (2 + gap) - gap <= availW) {
                        bw = 2;
                    } else if (barCount * (bw + 1) - 1 <= availW) {
                        gap = 1;
                    } else if (barCount * (2 + 1) - 1 <= availW) {
                        bw = 2;
                        gap = 1;
                    } else if (barCount * (1 + 1) - 1 <= availW) {
                        bw = 1;
                        gap = 1;
                    } else {
                        bw = 1;
                        gap = 1;
                        barCount = Math.max(3, Math.floor((availW + gap) / (bw + gap)));
                    }
                }
            }

            this._barCount = barCount;
            this._barWidth = bw;
            this._gap = gap;
            this._prevHeights = new Array(this._barCount).fill(1);
            this._peakValues = new Array(this._barCount).fill(0);

            let naturalWidth = this._barCount * (bw + gap) - gap;
            if (this._isSidePanel && this._maxWidth && !this._isPopup) {
                this.set_width(Math.max(naturalWidth, Math.floor(this._maxWidth)));
            } else {
                this.set_width(naturalWidth);
            }
        }

        setColor(c, isExact = false) {
            let exact = isExact || (c && c.exact);
            let r = 255, g = 255, b = 255;
            if (c && typeof c.r === 'number' && !isNaN(c.r)) r = exact ? c.r : Math.min(255, c.r + 100);
            if (c && typeof c.g === 'number' && !isNaN(c.g)) g = exact ? c.g : Math.min(255, c.g + 100);
            if (c && typeof c.b === 'number' && !isNaN(c.b)) b = exact ? c.b : Math.min(255, c.b + 100);

            this._colorR = r / 255.0; this._colorG = g / 255.0; this._colorB = b / 255.0;
            this.queue_repaint();
        }

        setPlaying(playing) {
            this._isPlaying = playing;
            this._engine.setPlaying(this._engineCallback, playing);
            if (!playing) {
                this._prevHeights.fill(1);
                this._peakValues.fill(0);
                this._isSilent = true;
                this.queue_repaint();
                this.queue_redraw();
            }
        }

        _resampleBars(rawData, targetCount) {
            if (rawData.length === targetCount) return rawData;
            let result = new Array(targetCount).fill(0);
            let totalRaw = rawData.length;

            for (let i = 0; i < targetCount; i++) {
                // Perceptual logarithmic frequency distribution matching musical octaves:
                // Lower bars focus on bass/kick transients, higher bars span broader treble.
                let tStart = i / targetCount;
                let tEnd = (i + 1) / targetCount;

                let start = Math.floor(Math.pow(tStart, 1.7) * totalRaw);
                let end = Math.min(totalRaw, Math.ceil(Math.pow(tEnd, 1.7) * totalRaw));
                if (end <= start) end = start + 1;

                let sum = 0, maxVal = 0, count = 0;
                for (let j = start; j < end && j < totalRaw; j++) {
                    let v = rawData[j];
                    sum += v;
                    if (v > maxVal) maxVal = v;
                    count++;
                }

                let avg = count > 0 ? (sum / count) : 0;
                // Peak-weighted blend (75% peak + 25% avg) so beats punch cleanly without being diluted
                let blended = maxVal * 0.75 + avg * 0.25;

                // Natural balanced curve: punchy bass, clear vocals, shimmering treble without dominating
                let freqT = i / Math.max(1, targetCount - 1);
                let eqCurve = 1.15 - (freqT * 0.30); // 1.15 (bass) -> 0.85 (treble)

                result[i] = Math.min(1.0, Math.max(0, blended * eqCurve));
            }
            return result;
        }

        _onEngineUpdate(normalizedBars, isSilent) {
            if (!this._isPlaying && !isSilent) {
                return;
            }

            if (!this.mapped) return;

            this._isSilent = isSilent;
            let myBars = this._resampleBars(normalizedBars, this._barCount);

            let totalHeight = this.get_height() || 24;
            let maxHalfHeight = Math.max(1, Math.floor((totalHeight - 4) / 2));

            for (let i = 0; i < this._barCount; i++) {
                let norm = myBars[i];
                let visualCurve = Math.pow(norm, 1.05);
                let target = Math.max(1, Math.round(visualCurve * maxHalfHeight));

                let prev = this._prevHeights[i];
                let alpha = target < prev ? 0.45 : 0.90;
                let height = Math.round(prev * (1 - alpha) + target * alpha);
                this._prevHeights[i] = height;

                if (height > this._peakValues[i]) {
                    this._peakValues[i] = height;
                } else {
                    this._peakValues[i] -= this._peakValues[i] * 0.05;
                }
            }
            this.queue_repaint();
        }

        _onRepaint() {
            let cr = this.get_context();
            let width = this.get_width();
            let height = this.get_height();
            if (width <= 0 || height <= 0) return;

            if (!this._isPlaying) {
                this._prevHeights.fill(1);
                this._peakValues.fill(0);
                this._isSilent = true;
            }

            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);
            let barWidth = this._barWidth || (this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2));
            let gap = this._gap !== undefined ? this._gap : 2;
            let totalBarsWidth = this._barCount * (barWidth + gap) - gap;
            let offsetX = Math.max(0, Math.floor((width - totalBarsWidth) / 2));
            let centerY = Math.floor(height / 2);
            let maxHalfHeight = Math.max(1, Math.floor((height - 4) / 2));

            for (let i = 0; i < this._barCount; i++) {
                let halfHeight = Math.min(maxHalfHeight, Math.max(1, this._prevHeights[i]));
                let x = offsetX + i * (barWidth + gap);
                let edgeFade = 1 - (Math.abs(i - (this._barCount - 1) / 2) / ((this._barCount - 1) / 2)) * 0.35;
                let barAlpha = this._isSilent ? 0.3 * edgeFade : 1.0 * edgeFade;

                cr.setSourceRGBA(this._colorR, this._colorG, this._colorB, barAlpha);
                cr.rectangle(x, centerY - halfHeight, barWidth, halfHeight * 2);
                cr.fill();

                if (!this._isSilent) {
                    let peak = Math.min(maxHalfHeight + 1, Math.max(1, this._peakValues[i]));
                    cr.setSourceRGBA(this._colorR, this._colorG, this._colorB, barAlpha * 0.55);
                    cr.rectangle(x, centerY - peak - 1, barWidth, 1);
                    cr.fill();
                    cr.rectangle(x, centerY + peak, barWidth, 1);
                    cr.fill();
                }
            }
            cr.$dispose();
        }

        destroy() {
            this._cleanup();
            super.destroy();
        }

        _cleanup() {
            if (this._engine && this._engineCallback) {
                this._engine.setPlaying(this._engineCallback, false);
                this._engine.unsubscribe(this._engineCallback);
                this._engineCallback = null;
            }
        }
    });

const SimulatedVisualizer = GObject.registerClass(
    class SimulatedVisualizer extends St.BoxLayout {
        _init(settings, isPopup = false) {
            super._init({ style: `spacing: 2px;`, y_align: Clutter.ActorAlign.FILL, x_align: Clutter.ActorAlign.END });
            this.layout_manager.orientation = Clutter.Orientation.HORIZONTAL;
            this._settings = settings;
            this._isPopup = isPopup;
            this._bars = [];
            this._color = '255,255,255';
            this._mode = 1;
            this._isPlaying = false;
            this._timerId = null;

            this._updateBarCount();
        }

        setSidePanel(isSidePanel, maxWidth) {
            this._isSidePanel = isSidePanel;
            this._maxWidth = maxWidth;
            this.x_align = isSidePanel ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
            this._updateBarCount();
        }

        _updateBarCount() {
            this.destroy_all_children();
            this._bars = [];
            let count = this._isPopup ? (this._settings.get_int('popup-visualizer-bars') || 10) : (this._settings.get_int('visualizer-bars') || 4);
            let barWidth = this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2);
            let gap = 2;

            if (this._isSidePanel && this._maxWidth && !this._isPopup) {
                let availW = Math.max(10, Math.floor(this._maxWidth));
                if (count * (barWidth + gap) - gap > availW) {
                    if (barWidth > 2 && count * (2 + gap) - gap <= availW) {
                        barWidth = 2;
                    } else if (count * (barWidth + 1) - 1 <= availW) {
                        gap = 1;
                    } else if (count * (2 + 1) - 1 <= availW) {
                        barWidth = 2;
                        gap = 1;
                    } else if (count * (1 + 1) - 1 <= availW) {
                        barWidth = 1;
                        gap = 1;
                    } else {
                        barWidth = 1;
                        gap = 1;
                        count = Math.max(3, Math.floor((availW + gap) / (barWidth + gap)));
                    }
                }
            }

            this.set_style(`spacing: ${gap}px;`);
            this._barWidth = barWidth;

            for (let i = 0; i < count; i++) {
                let bar = new St.Widget({ name: 'simulated-visualizer-bar', style_class: 'visualizer-bar', y_expand: true, y_align: Clutter.ActorAlign.FILL });
                bar.set_width(barWidth);
                bar.set_pivot_point(0.5, this._mode === 2 ? 0.5 : 1.0);
                this.add_child(bar);
                this._bars.push(bar);
            }
            this._updateBarsCss();
        }

        destroy() {
            this._cleanup();
            super.destroy();
        }

        _cleanup() {
            if (this._timerId) {
                GLib.Source.remove(this._timerId);
                this._timerId = null;
            }
            if (this._settings) {
                this._settings.disconnectObject(this);
            }
            this.disconnectObject(this);
        }

        setMode(m) {
            this._mode = m;
            let pivotY = (m === 2) ? 0.5 : 1.0;
            this._bars.forEach(bar => { bar.set_pivot_point(0.5, pivotY); });
        }

        setColor(c, isExact = false) {
            let exact = isExact || (c && c.exact);
            let r = 255, g = 255, b = 255;
            if (c && typeof c.r === 'number' && !isNaN(c.r)) r = exact ? c.r : Math.min(255, c.r + 100);
            if (c && typeof c.g === 'number' && !isNaN(c.g)) g = exact ? c.g : Math.min(255, c.g + 100);
            if (c && typeof c.b === 'number' && !isNaN(c.b)) b = exact ? c.b : Math.min(255, c.b + 100);
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
                    if (!this.get_parent()) return GLib.SOURCE_REMOVE;
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
            let barWidth = this._barWidth || (this._isPopup ? (this._settings.get_int('popup-visualizer-bar-width') || 2) : (this._settings.get_int('visualizer-bar-width') || 2));
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

        setSidePanel(isSidePanel, maxWidth) {
            this._isSidePanel = isSidePanel;
            this._maxWidth = maxWidth;
            this.x_align = isSidePanel ? Clutter.ActorAlign.CENTER : Clutter.ActorAlign.END;
            if (this._simulated) {
                this._simulated.setSidePanel(isSidePanel, maxWidth);
            }
            if (this._cava) {
                this._cava.setSidePanel(isSidePanel, maxWidth);
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
                    if (this._lastColor) this._cava.setColor(this._lastColor, this._lastExact);
                    if (this._isSidePanel !== undefined) {
                        this._cava.setSidePanel(this._isSidePanel, this._maxWidth);
                    }
                }
                if (this.get_child() !== this._cava) this.set_child(this._cava);
                this._cava.setPlaying(this._isPlaying);
                this._simulated.setPlaying(false);
            } else {
                if (this._cava) this._cava.setPlaying(false);
                if (this.get_child() !== this._simulated) {
                    this.set_child(this._simulated);
                }
                this._simulated.setMode(m);
                this._simulated.setPlaying(this._isPlaying);
            }
        }

        setColor(c, isExact = false) {
            this._lastColor = c;
            this._lastExact = isExact || (c && c.exact);
            this._simulated.setColor(c, this._lastExact);
            if (this._cava) this._cava.setColor(c, this._lastExact);
        }

        setPlaying(playing) {
            this._isPlaying = playing;
            if (this._mode === 3 && this._cava) {
                this._cava.setPlaying(playing);
                this._simulated.setPlaying(false);
            } else {
                if (this._cava) this._cava.setPlaying(false);
                this._simulated.setPlaying(playing);
            }
        }

        destroy() {
            this._cleanup();
            super.destroy();
        }

        _cleanup() {
            if (this._settings) {
                this._settings.disconnectObject(this);
            }
            this.disconnectObject(this);
            if (this._simulated) {
                this._simulated.destroy();
                this._simulated = null;
            }
            if (this._cava) {
                this._cava.destroy();
                this._cava = null;
            }
        }
    });
