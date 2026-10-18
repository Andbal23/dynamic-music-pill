import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

let TextFadeEffectClass = null;

try {
    TextFadeEffectClass = GObject.registerClass(
        { GTypeName: 'DmpTextFadeEffect' },
        class TextFadeEffect extends Clutter.ShaderEffect {
            static isSupported() {
                return Boolean(Cogl.Snippet && Clutter.ShaderEffect);
            }

            vfunc_get_static_snippet() {
                const declarations = `
                    uniform float width;
                    uniform float fade_pixels;
                    uniform float enable_left;
                    uniform float enable_right;
                `;

                const post = `
                    vec2 uv = cogl_tex_coord_in[0].xy;
                    float pos_x = uv.x * width;
                    float left_fade = smoothstep(0.0, fade_pixels, pos_x);
                    float right_fade = smoothstep(0.0, fade_pixels, width - pos_x);
                    float left_alpha = mix(1.0, left_fade, enable_left);
                    float right_alpha = mix(1.0, right_fade, enable_right);
                    float alpha = min(left_alpha, right_alpha);
                    cogl_color_out = cogl_color_out * alpha;
                `;

                return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, declarations, post);
            }

            _init(fadePixels = 32) {
                super._init();
                this._fadePixels = fadePixels;
                this._enableLeft = 0.0;
                this._enableRight = 1.0;
                this._animId = null;
            }

            setFadePixels(pixels) {
                this._fadePixels = pixels;
                let actor = this.get_actor();
                if (actor) actor.queue_redraw();
            }

            setEdges(left, right, animate = false) {
                let targetLeft = left ? 1.0 : 0.0;
                let targetRight = right ? 1.0 : 0.0;

                if (this._animId) {
                    GLib.Source.remove(this._animId);
                    this._animId = null;
                }

                if (!animate) {
                    this._enableLeft = targetLeft;
                    this._enableRight = targetRight;
                    let actor = this.get_actor();
                    if (actor) actor.queue_redraw();
                    return;
                }

                let startLeft = this._enableLeft;
                let startRight = this._enableRight;
                let startTime = Date.now();
                let duration = 300;

                this._animId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16, () => {
                    let actor = this.get_actor();
                    if (!actor) {
                        this._animId = null;
                        return GLib.SOURCE_REMOVE;
                    }

                    let now = Date.now();
                    let p = Math.min(1.0, (now - startTime) / duration);
                    let t = p * (2 - p);

                    this._enableLeft = startLeft + (targetLeft - startLeft) * t;
                    this._enableRight = startRight + (targetRight - startRight) * t;

                    actor.queue_redraw();

                    if (p >= 1.0) {
                        this._animId = null;
                        return GLib.SOURCE_REMOVE;
                    }
                    return GLib.SOURCE_CONTINUE;
                });
            }

            vfunc_paint_target(node, paint_context) {
                let actor = this.get_actor();
                if (actor) {
                    let w = actor.get_width();
                    this.set_uniform_float('width', 1, [Math.max(1.0, w)]);
                    this.set_uniform_float('fade_pixels', 1, [Math.max(1.0, this._fadePixels)]);
                    this.set_uniform_float('enable_left', 1, [this._enableLeft]);
                    this.set_uniform_float('enable_right', 1, [this._enableRight]);
                }
                super.vfunc_paint_target(node, paint_context);
            }
        }
    );
} catch (e) {
    // Fallback for GNOME 50 and earlier where vfunc_get_static_snippet does not exist in Clutter.ShaderEffect
    TextFadeEffectClass = GObject.registerClass(
        { GTypeName: 'DmpTextFadeEffectFallback' },
        class TextFadeEffectFallback extends Clutter.Effect {
            static isSupported() {
                return false;
            }

            _init(fadePixels = 32) {
                super._init();
                this._fadePixels = fadePixels;
            }

            setFadePixels(pixels) {
                this._fadePixels = pixels;
            }

            setEdges(left, right, animate = false) {}
        }
    );
}

export const TextFadeEffect = TextFadeEffectClass;
