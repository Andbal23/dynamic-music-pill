import Cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';
import PangoCairo from 'gi://PangoCairo';
import Pango from 'gi://Pango';
import St from 'gi://St';


export const LyricsWidget = GObject.registerClass(
    class LyricsWidget extends St.DrawingArea {

        _init(seekCallback = null) {
            super._init({
                reactive: true,
                can_focus: false,
                x_expand: true,
                y_expand: true,
                clip_to_allocation: true,
            });

            this._seekCallback = seekCallback;
            this._state        = 'loading';
            this._lyrics       = [];
            this._activeIndex  = -1;

            this._geoms     = [];
            this._totalH    = 0;
            this._geomBuilt = false;

            this._SZ    = 14;
            this._GAP   = 12;
            this._PAD_X = 16;

            this._lineAlpha   = [];
            this._lineScale   = [];
            this._alphaTickId = null;

            this._hoverIndex      = -1;
            this._hoverPillY      = -1;
            this._hoverPillAlpha  = 0;
            this._hoverExtras     = [];   
            this._hoverTickId     = null;

            this._scrollOffset       = 0;
            this._targetScrollOffset = 0;
            this._scrollTickId       = null;

            this._manualScroll = false;
            this._manualTimer  = null;
            this._MANUAL_MS    = 2500;

            this._pulseAlpha  = 0.4;
            this._pulseDir    = 1;
            this._pulseTickId = null;

            this._fgR = 1; this._fgG = 1; this._fgB = 1;

            this.connect('repaint',              this._onRepaint.bind(this));
            this.connect('button-release-event', this._onClick.bind(this));
            this.connect('motion-event',         this._onMotion.bind(this));
            this.connect('leave-event',          this._onLeave.bind(this));
            this.connect('scroll-event',         this._onScroll.bind(this));
            this.connect('destroy',              this._cleanup.bind(this));
        }


        setSeekCallback(cb) { this._seekCallback = cb; }

        setTextColor(r, g, b) {
            this._fgR = r / 255; this._fgG = g / 255; this._fgB = b / 255;
            this.queue_repaint();
        }

        showLoading() {
            this._fullReset('loading');
            this._startPulseAnim();
            this.queue_repaint();
        }

        showEmpty() {
            this._fullReset('empty');
            this.queue_repaint();
        }

        setLyrics(lyrics) {
            if (!lyrics || lyrics.length === 0) { this.showEmpty(); return; }
            this._fullReset('lyrics');
            this._lyrics      = lyrics;
            this._lineAlpha   = new Array(lyrics.length).fill(0.22);
            this._lineScale   = new Array(lyrics.length).fill(1.0);
            this._hoverExtras = new Array(lyrics.length).fill(0.0);
            this._geomBuilt   = false;
            this.queue_repaint();
        }

        updatePosition(timeMs) {
            if (this._state !== 'lyrics') return;
            let newIndex = -1;
            for (let i = 0; i < this._lyrics.length; i++) {
                if (this._lyrics[i].time <= timeMs) newIndex = i;
                else break;
            }
            if (newIndex === this._activeIndex) return;
            this._activeIndex = newIndex;
            this._startAlphaAnim();
            if (!this._manualScroll && this._geomBuilt) {
                this._updateScrollTarget();
                this._startScrollAnim();
            }
            this.queue_repaint();
        }

        _fullReset(state) {
            this._state              = state;
            this._lyrics             = [];
            this._activeIndex        = -1;
            this._hoverIndex         = -1;
            this._hoverExtras        = [];
            this._hoverPillY         = -1;
            this._hoverPillAlpha     = 0;
            this._lineAlpha          = [];
            this._lineScale          = [];
            this._geoms              = [];
            this._totalH             = 0;
            this._geomBuilt          = false;
            this._scrollOffset       = 0;
            this._targetScrollOffset = 0;
            this._manualScroll       = false;
            this._stopScrollAnim();
            this._stopAlphaAnim();
            this._stopHoverAnim();
            this._stopPulseAnim();
            this._cancelManualTimer();
        }


        _buildGeometry(cr, width) {
            if (this._geomBuilt || this._lyrics.length === 0) return;
            this._geomBuilt = true;

            const textW  = width - this._PAD_X * 2;
            const layout = PangoCairo.create_layout(cr);
            layout.set_width(textW * Pango.SCALE);
            layout.set_wrap(Pango.WrapMode.WORD_CHAR);
            layout.set_alignment(Pango.Alignment.CENTER);
            layout.set_font_description(
                Pango.FontDescription.from_string(`Sans Bold ${this._SZ}`)
            );

            this._geoms = [];
            let curY = 0;
            for (let i = 0; i < this._lyrics.length; i++) {
                layout.set_text(this._lyrics[i].text, -1);
                let [, log] = layout.get_extents();
                let slotH = log.height / Pango.SCALE;
                this._geoms.push({ y: curY, slotH, text: this._lyrics[i].text });
                curY += slotH + this._GAP;
            }
            this._totalH = Math.max(0, curY - this._GAP);

            for (let i = 0; i < this._lyrics.length; i++) {
                this._lineAlpha[i] = this._targetAlpha(i);
                this._lineScale[i] = 1.0;
            }

            if (this._activeIndex >= 0)
                this._startAlphaAnim();

            this._scrollOffset       = 0;
            this._targetScrollOffset = 0;
        }


        _targetAlpha(i) {
            if (this._activeIndex < 0) return 0.28;
            let d = Math.abs(i - this._activeIndex);
            if (d === 0) return 1.00;
            if (d === 1) return 0.62;
            if (d === 2) return 0.38;
            if (d === 3) return 0.24;
            return 0.18;
        }

        _targetScale(i) {
            if (this._activeIndex < 0) return 1.0;
            let d = Math.abs(i - this._activeIndex);
            if (d === 0) return 1.085;
            if (d === 1) return 1.02;
            return 1.0;
        }

        _startAlphaAnim() {
            if (this._alphaTickId) return;
            this._alphaTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                let done = true;
                for (let i = 0; i < this._lineAlpha.length; i++) {
                    let diff = this._targetAlpha(i) - this._lineAlpha[i];
                    if (Math.abs(diff) < 0.003) {
                        this._lineAlpha[i] += diff;
                    } else {
                        this._lineAlpha[i] += diff * 0.15;
                        done = false;
                    }
                }

                for (let i = 0; i < this._lineScale.length; i++) {
                    let diff = this._targetScale(i) - this._lineScale[i];
                    if (Math.abs(diff) < 0.0015) {
                        this._lineScale[i] += diff;
                    } else {
                        this._lineScale[i] += diff * 0.14;
                        done = false;
                    }
                }

                this.queue_repaint();
                if (done) { this._alphaTickId = null; return GLib.SOURCE_REMOVE; }
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopAlphaAnim() {
            if (this._alphaTickId) {
                GLib.Source.remove(this._alphaTickId);
                this._alphaTickId = null;
            }
        }


        _updateScrollTarget() {
            if (this._activeIndex < 0 || this._activeIndex >= this._geoms.length) return;
            let height = this.get_height();
            if (height <= 0) return;

            let geo        = this._geoms[this._activeIndex];
            let maxScroll  = Math.max(0, this._totalH - height);
            let rowTop     = geo.y - this._scrollOffset;
            let rowBottom  = rowTop + geo.slotH;

            const MARGIN = 30;
            if (rowTop >= MARGIN && rowBottom <= height - MARGIN) return;

            let ideal = geo.y - height * 0.35;
            this._targetScrollOffset = Math.min(Math.max(ideal, 0), maxScroll);
        }


        _startScrollAnim() {
            if (this._scrollTickId) return;
            this._scrollTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                let diff = this._targetScrollOffset - this._scrollOffset;
                if (Math.abs(diff) < 0.4) {
                    this._scrollOffset = this._targetScrollOffset;
                    this.queue_repaint();
                    this._scrollTickId = null;
                    return GLib.SOURCE_REMOVE;
                }
                this._scrollOffset += diff * 0.22;
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopScrollAnim() {
            if (this._scrollTickId) {
                GLib.Source.remove(this._scrollTickId);
                this._scrollTickId = null;
            }
        }


        _onScroll(actor, event) {
            if (this._state !== 'lyrics') return Clutter.EVENT_PROPAGATE;
            let dy = 0;
            let dir = event.get_scroll_direction();
            if      (dir === Clutter.ScrollDirection.UP)     dy = -48;
            else if (dir === Clutter.ScrollDirection.DOWN)   dy = 48;
            else if (dir === Clutter.ScrollDirection.SMOOTH) {
                let [, deltaY] = event.get_scroll_delta();
                dy = deltaY * 38;
            }
            if (dy === 0) return Clutter.EVENT_PROPAGATE;

            this._manualScroll = true;
            this._cancelManualTimer();

            let maxScroll = Math.max(0, this._totalH - this.get_height());
            this._targetScrollOffset = Math.min(Math.max(this._targetScrollOffset + dy, 0), maxScroll);
            this._startScrollAnim();

            this._manualTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, this._MANUAL_MS, () => {
                this._manualTimer  = null;
                this._manualScroll = false;
                this._updateScrollTarget();
                this._startScrollAnim();
                this._startAlphaAnim();
                return GLib.SOURCE_REMOVE;
            });
            return Clutter.EVENT_STOP;
        }

        _cancelManualTimer() {
            if (this._manualTimer) {
                GLib.Source.remove(this._manualTimer);
                this._manualTimer = null;
            }
        }


        _onMotion(actor, event) {
            if (this._state !== 'lyrics' || !this._seekCallback || !this._geomBuilt)
                return Clutter.EVENT_PROPAGATE;
            let [sx, sy] = event.get_coords();
            let [ok, , ly] = this.transform_stage_point(sx, sy);
            if (!ok) return Clutter.EVENT_PROPAGATE;
            let hitY     = ly + this._scrollOffset;
            let newHover = -1;
            for (let i = 0; i < this._geoms.length; i++) {
                let g = this._geoms[i];

                if (hitY >= g.y && hitY < g.y + g.slotH) {
                    newHover = i; break;
                }
            }
            if (newHover !== this._hoverIndex) {
                this._hoverIndex = newHover;
                this._startHoverAnim();
            }
            return Clutter.EVENT_PROPAGATE;
        }

        _onLeave() {
            if (this._hoverIndex === -1) return Clutter.EVENT_PROPAGATE;
            this._hoverIndex = -1;
            this._startHoverAnim();
            return Clutter.EVENT_PROPAGATE;
        }

        _startHoverAnim() {
            if (this._hoverTickId) return;
            this._hoverTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                let done = true;

                let pillTargetAlpha = 0.0;
                let pillTargetY     = -1;
                if (this._hoverIndex >= 0 && this._hoverIndex < this._geoms.length) {
                    let g = this._geoms[this._hoverIndex];
                    pillTargetY = g.y - this._scrollOffset;
                }

                let aDiff = pillTargetAlpha - this._hoverPillAlpha;
                if (Math.abs(aDiff) < 0.003) {
                    this._hoverPillAlpha = pillTargetAlpha;
                } else {
                    this._hoverPillAlpha += aDiff * 0.22;
                    done = false;
                }

                if (pillTargetY >= 0) {
                    if (this._hoverPillY < 0) {
                        this._hoverPillY = pillTargetY;
                    } else {
                        let yDiff = pillTargetY - this._hoverPillY;
                        if (Math.abs(yDiff) < 0.4) {
                            this._hoverPillY = pillTargetY;
                        } else {
                            this._hoverPillY += yDiff * 0.22;
                            done = false;
                        }
                    }
                }

                for (let i = 0; i < this._hoverExtras.length; i++) {
                    let target = (i === this._hoverIndex) ? 0.14 : 0.0;
                    let diff   = target - this._hoverExtras[i];
                    if (Math.abs(diff) < 0.003) {
                        this._hoverExtras[i] = target;
                    } else {
                        this._hoverExtras[i] += diff * 0.22;
                        done = false;
                    }
                }

                this.queue_repaint();
                if (done) { this._hoverTickId = null; return GLib.SOURCE_REMOVE; }
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopHoverAnim() {
            if (this._hoverTickId) {
                GLib.Source.remove(this._hoverTickId);
                this._hoverTickId = null;
            }
        }


        _onClick(actor, event) {
            if (this._state !== 'lyrics' || !this._seekCallback) return Clutter.EVENT_PROPAGATE;
            if (event.get_button() !== 1) return Clutter.EVENT_PROPAGATE;
            let [sx, sy] = event.get_coords();
            let [ok, , ly] = this.transform_stage_point(sx, sy);
            if (!ok) return Clutter.EVENT_PROPAGATE;
            let hitY = ly + this._scrollOffset;
            for (let i = 0; i < this._geoms.length; i++) {
                let g = this._geoms[i];
                if (hitY >= g.y && hitY < g.y + g.slotH + this._GAP) {
                    this._cancelManualTimer();
                    this._manualScroll = false;
                    this._seekCallback(this._lyrics[i].time);
                    return Clutter.EVENT_STOP;
                }
            }
            return Clutter.EVENT_PROPAGATE;
        }


        _startPulseAnim() {
            if (this._pulseTickId) return;
            this._pulseTickId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 32, () => {
                if (this._state !== 'loading') { this._pulseTickId = null; return GLib.SOURCE_REMOVE; }
                this._pulseAlpha += this._pulseDir * 0.018;
                if (this._pulseAlpha >= 0.70) { this._pulseAlpha = 0.70; this._pulseDir = -1; }
                if (this._pulseAlpha <= 0.18) { this._pulseAlpha = 0.18; this._pulseDir = +1; }
                this.queue_repaint();
                return GLib.SOURCE_CONTINUE;
            });
        }

        _stopPulseAnim() {
            if (this._pulseTickId) {
                GLib.Source.remove(this._pulseTickId);
                this._pulseTickId = null;
            }
        }


        _onRepaint() {
            let cr = this.get_context();
            let [width, height] = this.get_surface_size();

            cr.setOperator(Cairo.Operator.CLEAR);
            cr.paint();
            cr.setOperator(Cairo.Operator.OVER);

            if (width <= 0 || height <= 0) { cr.$dispose(); return; }

            const R = this._fgR, G = this._fgG, B = this._fgB;

            if (this._state !== 'lyrics') {
                let msg = this._state === 'loading' ? '♫  Fetching lyrics…' : 'No lyrics found';
                let layout = PangoCairo.create_layout(cr);
                layout.set_alignment(Pango.Alignment.CENTER);
                layout.set_font_description(
                    Pango.FontDescription.from_string(`Sans Bold ${this._SZ + 1}`)
                );
                layout.set_text(msg, -1);

                layout.set_width(width * Pango.SCALE);
                layout.set_wrap(Pango.WrapMode.WORD_CHAR);
                let [, log] = layout.get_extents();
                cr.setSourceRGBA(R, G, B, this._state === 'loading' ? this._pulseAlpha : 0.4);
                cr.moveTo(0, (height - log.height / Pango.SCALE) / 2);
                PangoCairo.show_layout(cr, layout);
                cr.$dispose();
                return;
            }

            if (!this._geomBuilt) {
                this._buildGeometry(cr, width);
            }
            if (this._geoms.length === 0) { cr.$dispose(); return; }

            const FADE_H = this._manualScroll ? height * 0.06 : height * 0.15;

            if (this._hoverPillAlpha > 0.005 && this._hoverPillY >= -20
                && this._hoverIndex >= 0 && this._hoverIndex < this._geoms.length) {
                let g      = this._geoms[this._hoverIndex];
                let pillH  = g.slotH + 8;
                let pillW  = width - 8;
                let pillX  = 4;
                let pillY  = this._hoverPillY;
                let r      = 10;

                cr.setSourceRGBA(R, G, B, this._hoverPillAlpha);
                cr.newSubPath();
                cr.arc(pillX + r,         pillY + r,          r, Math.PI,       1.5 * Math.PI);
                cr.arc(pillX + pillW - r, pillY + r,          r, 1.5 * Math.PI, 0);
                cr.arc(pillX + pillW - r, pillY + pillH - r,  r, 0,             0.5 * Math.PI);
                cr.arc(pillX + r,         pillY + pillH - r,  r, 0.5 * Math.PI, Math.PI);
                cr.closePath();
                cr.fill();
            }

            const layout = PangoCairo.create_layout(cr);
            layout.set_width((width - this._PAD_X * 2) * Pango.SCALE);
            layout.set_wrap(Pango.WrapMode.WORD_CHAR);
            layout.set_alignment(Pango.Alignment.CENTER);
            layout.set_font_description(
                Pango.FontDescription.from_string(`Sans Bold ${this._SZ}`)
            );

            for (let i = 0; i < this._geoms.length; i++) {
                let geo   = this._geoms[i];
                let slotY = geo.y - this._scrollOffset;

                if (slotY + geo.slotH < -4 || slotY > height + 4) continue;

                let alpha = this._lineAlpha[i] ?? this._targetAlpha(i);
                alpha += this._hoverExtras[i] ?? 0;
                if (this._manualScroll) alpha = Math.max(alpha, 0.65);

                let lineBottom = slotY + geo.slotH;
                let lineTop    = slotY;
                if (lineBottom < FADE_H) {
                    let t = Math.max(0, Math.min(1, lineBottom / FADE_H));
                    alpha *= t * t * (3 - 2 * t);
                } else if (lineTop > height - FADE_H) {
                    let t = Math.max(0, Math.min(1, (height - lineTop) / FADE_H));
                    alpha *= t * t * (3 - 2 * t);
                }

                alpha = Math.max(0, Math.min(1, alpha));
                if (alpha < 0.01) continue;

                layout.set_text(geo.text, -1);
                cr.setSourceRGBA(R, G, B, alpha);
                let scale = this._lineScale[i] ?? 1.0;
                if (scale !== 1.0) {
                    let cx = width / 2;
                    let cy = slotY + geo.slotH / 2;
                    cr.save();
                    cr.translate(cx, cy);
                    cr.scale(scale, scale);
                    cr.translate(-cx, -cy);
                    cr.moveTo(this._PAD_X, slotY);
                    PangoCairo.show_layout(cr, layout);
                    cr.restore();
                } else {
                    cr.moveTo(this._PAD_X, slotY);
                    PangoCairo.show_layout(cr, layout);
                }
            }

            cr.$dispose();
        }


        _cleanup() {
            this._stopScrollAnim();
            this._stopAlphaAnim();
            this._stopHoverAnim();
            this._stopPulseAnim();
            this._cancelManualTimer();
        }
    });
