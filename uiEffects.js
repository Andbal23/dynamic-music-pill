import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

export const TextFadeEffect = GObject.registerClass(
    class TextFadeEffect extends Clutter.ShaderEffect {
        _init(fadePixels = 32) {
            super._init({ 'shader-type': 1 });
            this._fadePixels = fadePixels;
            this._enableLeft = 0.0;
            this._enableRight = 1.0;
            this._animId = null;

            this.set_shader_source(`
            uniform sampler2D tex;
            uniform float width;
            uniform float fade_pixels;
            uniform float enable_left;
            uniform float enable_right;

            void main(void) {
                vec2 uv = cogl_tex_coord_in[0].xy;
                vec4 color = texture2D(tex, uv);

                float pos_x = uv.x * width;

                float left_fade = smoothstep(0.0, fade_pixels, pos_x);
                float right_fade = smoothstep(0.0, fade_pixels, width - pos_x);

                float left_alpha = mix(1.0, left_fade, enable_left);
                float right_alpha = mix(1.0, right_fade, enable_right);

                float alpha = min(left_alpha, right_alpha);

                cogl_color_out = vec4(color.rgb * alpha, color.a * alpha) * cogl_color_in;
            }
        `);
        }

        setFadePixels(pixels) {
            this._fadePixels = pixels;
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

        vfunc_paint_target(paint_node, paint_context) {
            let actor = this.get_actor();
            if (actor) {
                let widthVal = new GObject.Value();
                widthVal.init(GObject.TYPE_FLOAT);
                widthVal.set_float(actor.get_width());
                this.set_uniform_value('width', widthVal);

                let fadeVal = new GObject.Value();
                fadeVal.init(GObject.TYPE_FLOAT);
                fadeVal.set_float(this._fadePixels);
                this.set_uniform_value('fade_pixels', fadeVal);

                let leftVal = new GObject.Value();
                leftVal.init(GObject.TYPE_FLOAT);
                leftVal.set_float(this._enableLeft);
                this.set_uniform_value('enable_left', leftVal);

                let rightVal = new GObject.Value();
                rightVal.init(GObject.TYPE_FLOAT);
                rightVal.set_float(this._enableRight);
                this.set_uniform_value('enable_right', rightVal);
            }
            super.vfunc_paint_target(paint_node, paint_context);
        }
    });
