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

let BmsDynamicPipelineClass = null;

function getBmsDirectory() {
    let bms = Main.extensionManager?.lookup?.('blur-my-shell@aunetx');
    if (bms && bms.path) return bms.path;
    let userDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'blur-my-shell@aunetx']);
    if (GLib.file_test(userDir, GLib.FileTest.IS_DIR)) return userDir;
    let sysDir = '/usr/share/gnome-shell/extensions/blur-my-shell@aunetx';
    if (GLib.file_test(sysDir, GLib.FileTest.IS_DIR)) return sysDir;
    return null;
}

function findBmsDynamicPipelinePath(bmsDir) {
    if (!bmsDir) return null;
    let candidates = [
        GLib.build_filenamev([bmsDir, 'render', 'dynamic_surface.js']),
        GLib.build_filenamev([bmsDir, 'src', 'render', 'dynamic_surface.js']),
    ];
    for (let p of candidates) {
        if (GLib.file_test(p, GLib.FileTest.EXISTS)) return p;
    }
    return null;
}

export function isBmsUnifiedInstalled() {
    let bmsDir = getBmsDirectory();
    if (!bmsDir) return false;
    if (findBmsDynamicPipelinePath(bmsDir) !== null) return true;
    let metaPath = GLib.build_filenamev([bmsDir, 'metadata.json']);
    if (GLib.file_test(metaPath, GLib.FileTest.EXISTS)) {
        try {
            let [ok, contents] = GLib.file_get_contents(metaPath);
            if (ok) {
                let meta = JSON.parse(new TextDecoder().decode(contents));
                if (meta && typeof meta.version === 'number' && meta.version >= 76) return true;
            }
        } catch (_) {}
    }
    return false;
}

export async function initBlurBackend() {
    if (BmsDynamicPipelineClass) return BmsDynamicPipelineClass;
    let bmsDir = getBmsDirectory();
    let dynPath = findBmsDynamicPipelinePath(bmsDir);
    if (dynPath) {
        try {
            let mod = await import('file://' + dynPath);
            if (mod && mod.DynamicPipeline) {
                BmsDynamicPipelineClass = mod.DynamicPipeline;
                return BmsDynamicPipelineClass;
            }
        } catch (e) {
            console.debug(`[Dynamic Music Pill] Failed to import BMS DynamicPipeline: ${e.message}`);
        }
    }
    return null;
}

// Attempt eager backend resolution
try {
    await initBlurBackend();
} catch (_) {}

export function getBmsDynamicPipelineClass() {
    return BmsDynamicPipelineClass;
}

export function isBlurMyShellAvailable() {
    if (global.blur_my_shell) return true;
    let bms = Main.extensionManager?.lookup?.('blur-my-shell@aunetx');
    if (bms && bms.state === 1) return true;
    return getBmsDirectory() !== null;
}

export function isRoundedBlurAvailable() {
    if (getBmsDynamicPipelineClass() !== null) return true;
    if (global.blur_my_shell?._effects_manager) return true;
    if (isBmsUnifiedInstalled()) return true;
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
    let bmsUnified = isBmsUnifiedInstalled() || getBmsDynamicPipelineClass() !== null;
    let hasRounded = isRoundedBlurAvailable();
    let bmsAvailable = isBlurMyShellAvailable();

    if (bmsUnified) {
        return true;
    }

    if (!hasRounded) {
        if (!bmsAvailable) {
            Main.notify('Dynamic Music Pill', _('Please install "Blur my Shell" for dynamic blur.'));
        } else {
            Main.notify('Dynamic Music Pill', _('Please update "Blur my Shell" or install "gnome-rounded-blur" for dynamic blur.'));
        }
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
    constructor(actor, getRadius, getSigma = null, role = 'popup', shouldFollowPipeline = null) {
        this._actor = actor;
        this._getRadius = getRadius;
        this._getSigma = getSigma;
        this._role = role;
        this._shouldFollowPipeline = shouldFollowPipeline;
        this._opacityFactor = 1.0;
        this._effect = null;
        this._dynamicPipeline = null;
        this._paintCallback = null;
        this._enabled = false;
        this._themeContext = null;
        this._isBmsDynamic = false;
        this._bmsSettingsChangedId = 0;

        if (this._actor) {
            this._actor.connectObject(
                'notify::allocation', () => this._checkSizeAndApply(),
                this
            );
        }

        if (Main.extensionManager) {
            Main.extensionManager.connectObject(
                'extension-state-changed', (_mgr, ext) => {
                    if (ext && ext.uuid === 'blur-my-shell@aunetx') {
                        if (ext.state === 1) {
                            initBlurBackend().then(() => {
                                if (this._enabled) this._refreshEffect();
                            }).catch(() => {});
                        } else {
                            if (this._enabled) this._refreshEffect();
                        }
                    }
                },
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
        if (!this._enabled && !this._effect && !this._dynamicPipeline) return;
        this._enabled = false;
        this._removeEffect();
    }

    _checkSizeAndApply() {
        if (!this._enabled || !this._actor) return;
        let w = this._actor.width;
        let h = this._actor.height;
        if (w >= 1 && h >= 1) {
            if (!this._effect && !this._dynamicPipeline) {
                this._applyEffect();
            }
        } else {
            if (this._effect || this._dynamicPipeline) {
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

    _syncSigma(customSigma) {
        if (!this._dynamicPipeline) return;
        let shouldFollow = (this._shouldFollowPipeline ? this._shouldFollowPipeline() : true);
        if (shouldFollow) {
            // When following BMS pipeline, let Blur my Shell's configured pipeline effects & sigma govern the blur
            return;
        }

        let rawSigma = (typeof customSigma === 'number' && !isNaN(customSigma))
            ? customSigma
            : (this._getSigma ? this._getSigma() : 30);
        if (typeof rawSigma !== 'number' || isNaN(rawSigma) || rawSigma < 0) rawSigma = 30;

        let effects = this._dynamicPipeline.effects;
        if (effects && effects.length > 0) {
            effects.forEach(effect => {
                if (effect._bms_effect_type === 'dual_kawase_blur') {
                    if (effect._bms_effect_params) {
                        effect._bms_effect_params.unscaled_radius = rawSigma;
                    }
                    effect.unscaled_radius = rawSigma * this._opacityFactor;
                }
            });
        }
    }

    updateRadius(newRadius) {
        if (!this._enabled) return;
        let r = (typeof newRadius === 'number') ? newRadius : (this._getRadius ? this._getRadius() : 0);
        if (this._isBmsDynamic && this._dynamicPipeline) {
            try {
                this._dynamicPipeline.set_corner_radius(r);
            } catch (_) {}
            return;
        }
        if (!this._effect) return;
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
        if (!this._enabled) return;
        let shouldFollow = (this._shouldFollowPipeline ? this._shouldFollowPipeline() : true);
        if (shouldFollow) return;

        if (this._isBmsDynamic && this._dynamicPipeline) {
            this._syncSigma(newSigma);
            return;
        }
        if (!this._effect) return;
        let targetRadius = this._computeScaledSigma(newSigma);
        try {
            this._effect.radius = targetRadius;
        } catch (_) {}
    }

    setOpacityFactor(factor) {
        let clamped = Math.min(1.0, Math.max(0.0, (typeof factor === 'number' && !isNaN(factor)) ? factor : 1.0));
        if (Math.abs(this._opacityFactor - clamped) < 0.005 && clamped !== 0.0 && clamped !== 1.0) return;
        this._opacityFactor = clamped;
        if (!this._enabled) return;

        if (this._isBmsDynamic && this._dynamicPipeline) {
            try {
                this._dynamicPipeline.set_opacity_factor(clamped, true);
                this._syncSigma();
            } catch (_) {}
            return;
        }

        if (!this._effect) return;
        let targetRadius = this._computeScaledSigma();
        try {
            this._effect.radius = targetRadius;
        } catch (_) {}
    }

    invalidate() {
        if (!this._enabled) return;
        if (this._isBmsDynamic && this._dynamicPipeline) {
            try {
                this._dynamicPipeline.repaint_effect();
            } catch (_) {}
            return;
        }
        if (this._effect && typeof this._effect.queue_repaint === 'function') {
            try { this._effect.queue_repaint(); } catch (_) {}
        }
    }

    _refreshEffect() {
        if (!this._enabled) return;
        this._removeEffect();
        this._checkSizeAndApply();
    }

    _applyEffect() {
        if (!this._actor || this._effect || this._dynamicPipeline) return;
        if (this._actor.width < 1 || this._actor.height < 1) return;

        let radius = (this._getRadius ? this._getRadius() : 24) || 0;
        let scale = this._getScaleFactor();
        let rawSigma = (this._getSigma ? this._getSigma() : 30);
        if (typeof rawSigma !== 'number' || isNaN(rawSigma)) rawSigma = 30;

        let DynPipelineClass = getBmsDynamicPipelineClass();
        let bms = global.blur_my_shell;
        if (DynPipelineClass && bms?._effects_manager && bms?._pipelines_manager) {
            try {
                let pipelineId = 'pipeline_default';
                if (this._role === 'panel' && bms._settings?.panel?.PIPELINE) {
                    pipelineId = bms._settings.panel.PIPELINE;
                } else if (bms._settings?.popup?.PIPELINE) {
                    pipelineId = bms._settings.popup.PIPELINE;
                }

                this._dynamicPipeline = new DynPipelineClass(
                    bms._effects_manager,
                    bms._pipelines_manager,
                    pipelineId,
                    {
                        corner_radius: radius,
                        get_corners: () => 0
                    }
                );
                let dynActor = this._dynamicPipeline.create_actor('dmp-blur-surface');
                dynActor.set_position(0, 0);
                this._actor.insert_child_at_index(dynActor, 0);
                dynActor.add_constraint(new Clutter.BindConstraint({
                    source: this._actor,
                    coordinate: Clutter.BindCoordinate.SIZE,
                }));
                this._dynamicPipeline.container = this._actor;
                this._dynamicPipeline.ownsActor = true;
                this._dynamicPipeline.attach_pipeline();
                this._isBmsDynamic = true;

                let origSetOpacity = this._dynamicPipeline.set_opacity_factor.bind(this._dynamicPipeline);
                this._dynamicPipeline.set_opacity_factor = (factor, force = false) => {
                    origSetOpacity(factor, force);
                    this._syncSigma();
                };

                this._dynamicPipeline.set_opacity_factor(this._opacityFactor, true);
                this._syncSigma(rawSigma);

                let targetComp = (this._role === 'panel') ? bms._settings?.panel : bms._settings?.popup;
                if (targetComp?.settings && typeof targetComp.settings.connect === 'function') {
                    this._bmsSettingsChangedId = targetComp.settings.connect('changed::pipeline', () => {
                        let shouldFollow = (this._shouldFollowPipeline ? this._shouldFollowPipeline() : true);
                        if (shouldFollow && this._dynamicPipeline) {
                            let newId = (this._role === 'panel') ? bms._settings?.panel?.PIPELINE : bms._settings?.popup?.PIPELINE;
                            if (newId) {
                                this._dynamicPipeline.change_pipeline_to(newId);
                                this._syncSigma();
                            }
                        }
                    });
                }
            } catch (e) {
                console.warn(`[Dynamic Music Pill] Failed to initialize BMS DynamicPipeline: ${e.message}`, e.stack);
                if (this._dynamicPipeline) {
                    try { this._dynamicPipeline.destroy(); } catch (_) {}
                    this._dynamicPipeline = null;
                }
                this._isBmsDynamic = false;
            }
        }

        if (!this._dynamicPipeline) {
            this._isBmsDynamic = false;
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
    }

    _removeEffect() {
        if (this._dynamicPipeline) {
            try {
                this._dynamicPipeline.destroy();
            } catch (e) {
                console.debug(`[Dynamic Music Pill] Error destroying DynamicPipeline: ${e.message}`);
            }
            this._dynamicPipeline = null;
            this._isBmsDynamic = false;
        }

        if (this._bmsSettingsChangedId) {
            let bms = global.blur_my_shell;
            let targetComp = (this._role === 'panel') ? bms?._settings?.panel : bms?._settings?.popup;
            if (targetComp?.settings && typeof targetComp.settings.disconnect === 'function') {
                try { targetComp.settings.disconnect(this._bmsSettingsChangedId); } catch (_) {}
            }
            this._bmsSettingsChangedId = 0;
        }

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
            if (typeof this._effect.releaseTargets === 'function') {
                try { this._effect.releaseTargets(); } catch (_) {}
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
        if (Main.extensionManager) {
            Main.extensionManager.disconnectObject(this);
        }
        if (this._actor) {
            this._actor.disconnectObject(this);
            this._actor = null;
        }
    }
}
