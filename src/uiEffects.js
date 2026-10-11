import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import GLib from 'gi://GLib';

export const TextFadeEffect = GObject.registerClass(
    class TextFadeEffect extends Clutter.Effect {
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
