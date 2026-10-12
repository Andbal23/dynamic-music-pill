import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

let BlurModule = null;
try {
    BlurModule = (await import('gi://Blur')).default ?? (await import('gi://Blur'));
} catch (e) {
    BlurModule = null;
}

function isUsableBlurModule(ns) {
    if (!ns || !ns.BlurEffect) return false;
    try {
        if (typeof ns.BlurEffect !== 'function' || !ns.BlurEffect.$gtype) return false;
        return true;
    } catch (_) {
        return false;
    }
}

const BlurOrShell = isUsableBlurModule(BlurModule) ? BlurModule : Shell;
const SUPPORTS_CORNER_RADIUS = Boolean(
    BlurOrShell?.BlurEffect?.list_properties()?.some(p => p.name === 'corner-radius' || p.name === 'corner_radius')
);

export function isBlurMyShellAvailable() {
    if (global.blur_my_shell) return true;
    let bms = Main.extensionManager?.lookup?.('blur-my-shell@aunetx');
    if (bms && bms.state === 1) return true;
    let userDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'blur-my-shell@aunetx']);
    let sysDir = '/usr/share/gnome-shell/extensions/blur-my-shell@aunetx';
    return GLib.file_test(userDir, GLib.FileTest.IS_DIR) || GLib.file_test(sysDir, GLib.FileTest.IS_DIR);
}

export function isRoundedBlurAvailable() {
    if (SUPPORTS_CORNER_RADIUS) return true;
    if (global.blur_my_shell?._settings?.ROUNDED_BLUR_FOUND) return true;
    let paths = [
        '/usr/lib/girepository-1.0/Blur-1.0.typelib',
        '/usr/lib64/girepository-1.0/Blur-1.0.typelib',
        '/usr/local/lib/girepository-1.0/Blur-1.0.typelib',
        '/usr/lib/girepository-2.0/Blur-1.0.typelib',
        '/usr/lib64/girepository-2.0/Blur-1.0.typelib',
        '/usr/local/lib/girepository-2.0/Blur-1.0.typelib',
        '/usr/lib/libblur-effect-1.0.so',
        '/usr/lib64/libblur-effect-1.0.so',
        '/usr/local/lib/libblur-effect-1.0.so'
    ];
    return paths.some(p => GLib.file_test(p, GLib.FileTest.EXISTS));
}

export function checkBlurRequirements() {
    let hasRounded = isRoundedBlurAvailable();

    if (!hasRounded) {
        Main.notify('Dynamic Music Pill', _('Please install "gnome-rounded-blur" for dynamic blur.'));
        return false;
    }
    return true;
}

export function showBlurRequirementsNotification() {
    return checkBlurRequirements();
}

const PaintCallbackEffect = GObject.registerClass(
    { GTypeName: 'DmpPaintCallbackEffect' },
    class PaintCallbackEffect extends Clutter.Effect {
        set_callback(callback) {
            this._callback = callback;
        }

        vfunc_paint(node, paint_context, paint_flags) {
            if (this._callback) {
                try { this._callback(); } catch (_) {}
            }
            super.vfunc_paint(node, paint_context, paint_flags);
        }
    }
);

export class ActorBlurController {
    constructor(actor, getRadius, getSigma = null) {
        this._actor = actor;
        this._getRadius = getRadius;
        this._getSigma = getSigma;
        this._opacityFactor = 1.0;
        this._effect = null;
        this._paintCallback = null;
        this._enabled = false;
        this._themeContext = null;

        if (this._actor) {
            this._actor.connectObject(
                'notify::allocation', () => this._checkSizeAndApply(),
                this
            );
        }
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;
        this._checkSizeAndApply();
    }

    disable() {
        if (!this._enabled && !this._effect) return;
        this._enabled = false;
        this._removeEffect();
    }

    _checkSizeAndApply() {
        if (!this._enabled || !this._actor) return;
        let w = this._actor.width;
        let h = this._actor.height;
        if (w >= 1 && h >= 1) {
            if (!this._effect) {
                this._applyEffect();
            }
        } else {
            if (this._effect) {
                this._removeEffect();
            }
        }
    }

    _computeScaledSigma(customSigma) {
        let raw = (typeof customSigma === 'number' && !isNaN(customSigma))
            ? customSigma
            : (this._getSigma ? this._getSigma() : 30);
        let sigma = (typeof raw === 'number' && !isNaN(raw)) ? Math.max(0, raw) : 30;
        let scale = this._getScaleFactor();
        if (sigma <= 0 || this._opacityFactor <= 0.01) return 0;
        return Math.max(1, Math.round(sigma * this._opacityFactor * scale));
    }

    updateRadius(newRadius) {
        if (!this._enabled || !this._effect) return;
        let r = (typeof newRadius === 'number') ? newRadius : (this._getRadius ? this._getRadius() : 0);
        let scale = this._getScaleFactor();
        if ('corner-radius' in this._effect || 'corner_radius' in this._effect) {
            try {
                this._effect.corner_radius = r * scale;
            } catch (_) {
                try { this._effect['corner-radius'] = r * scale; } catch (__) {}
            }
        }
    }

    updateSigma(newSigma) {
        if (!this._enabled || !this._effect) return;
        let targetRadius = this._computeScaledSigma(newSigma);
        try {
            this._effect.radius = targetRadius;
        } catch (_) {}
    }

    setOpacityFactor(factor) {
        let clamped = Math.min(1.0, Math.max(0.0, (typeof factor === 'number' && !isNaN(factor)) ? factor : 1.0));
        if (Math.abs(this._opacityFactor - clamped) < 0.005 && clamped !== 0.0 && clamped !== 1.0) return;
        this._opacityFactor = clamped;
        if (!this._enabled || !this._effect) return;
        let targetRadius = this._computeScaledSigma();
        try {
            this._effect.radius = targetRadius;
        } catch (_) {}
    }

    invalidate() {
        if (this._enabled && this._effect && typeof this._effect.queue_repaint === 'function') {
            try { this._effect.queue_repaint(); } catch (_) {}
        }
    }

    _refreshEffect() {
        if (!this._enabled) return;
        this._removeEffect();
        this._checkSizeAndApply();
    }

    _applyEffect() {
        if (!this._actor || this._effect) return;
        if (this._actor.width < 1 || this._actor.height < 1) return;

        let radius = (this._getRadius ? this._getRadius() : 24) || 0;
        let scale = this._getScaleFactor();
        let blurRadius = this._computeScaledSigma();

        try {
            let EffectClass = BlurOrShell.BlurEffect;
            if (EffectClass) {
                let mode = BlurOrShell.BlurMode ? BlurOrShell.BlurMode.BACKGROUND : 1;
                this._effect = new EffectClass({ mode: mode, radius: blurRadius });
                if ('corner-radius' in this._effect || 'corner_radius' in this._effect) {
                    try {
                        this._effect.corner_radius = radius * scale;
                    } catch (_) {
                        try { this._effect['corner-radius'] = radius * scale; } catch (__) {}
                    }
                }
            }
        } catch (e) {
            console.debug(`[Dynamic Music Pill] Failed to create BlurEffect: ${e.message}`);
            this._effect = null;
        }

        if (this._effect) {
            try {
                this._actor.add_effect(this._effect);
            } catch (e) {
                console.debug(`[Dynamic Music Pill] Could not add blur effect: ${e.message}`);
                this._effect = null;
                return;
            }

            let skipping = 0;
            this._paintCallback = new PaintCallbackEffect();
            this._paintCallback.set_callback(() => {
                let isAnimating = this._opacityFactor < 1.0 || Boolean(
                    this._actor && (
                        this._actor.get_transition('translation-y') ||
                        this._actor.get_transition('translation-x') ||
                        this._actor.get_transition('scale-x') ||
                        this._actor.get_transition('width') ||
                        this._actor.get_transition('height')
                    )
                );
                if (!isAnimating) {
                    if (skipping > 0) {
                        skipping--;
                        return;
                    }
                    skipping = 2;
                } else {
                    skipping = 0;
                }
                if (this._effect && typeof this._effect.queue_repaint === 'function') {
                    this._effect.queue_repaint();
                }
            });
            try {
                this._actor.add_effect(this._paintCallback);
            } catch (_) {
                this._paintCallback = null;
            }

            try {
                this._themeContext = St.ThemeContext.get_for_stage(global.stage);
                if (this._themeContext) {
                    this._themeContext.connectObject('notify::scale-factor', () => {
                        if (this._effect) {
                            let s = this._getScaleFactor();
                            let curR = (this._getRadius ? this._getRadius() : 24) || 0;
                            this._effect.radius = this._computeScaledSigma();
                            if ('corner-radius' in this._effect || 'corner_radius' in this._effect) {
                                try { this._effect.corner_radius = curR * s; } catch (_) {}
                            }
                        }
                    }, this);
                }
            } catch (_) {}
        }
    }

    _removeEffect() {
        if (this._paintCallback) {
            if (this._actor) {
                try { this._actor.remove_effect(this._paintCallback); } catch (_) {}
            }
            this._paintCallback = null;
        }

        if (this._effect) {
            if (this._actor) {
                try { this._actor.remove_effect(this._effect); } catch (_) {}
            }
            this._effect = null;
        }

        if (this._themeContext) {
            this._themeContext.disconnectObject(this);
            this._themeContext = null;
        }
    }

    _getScaleFactor() {
        try {
            return St.ThemeContext.get_for_stage(global.stage)?.scale_factor ?? 1;
        } catch (_) {
            return 1;
        }
    }

    destroy() {
        this.disable();
        Main.extensionManager.disconnectObject(this);
        if (this._actor) {
            this._actor.disconnectObject(this);
            this._actor = null;
        }
    }
}
