import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

let BlurModule = null;
let SUPPORTS_CORNER_RADIUS = false;

try {
    const mod = (await import('gi://Blur')).default ?? (await import('gi://Blur'));
    if (mod && mod.BlurEffect && mod.BlurEffect.$gtype) {
        BlurModule = mod;
        const props = mod.BlurEffect.list_properties();
        if (props.some(p => p.name === 'corner-radius' || p.name === 'corner_radius'))
            SUPPORTS_CORNER_RADIUS = true;
    }
} catch {
    BlurModule = null;
}

const BlurOrShell = BlurModule ?? Shell;

if (!SUPPORTS_CORNER_RADIUS) {
    const props = Shell.BlurEffect.list_properties();
    if (props.some(p => p.name === 'corner-radius' || p.name === 'corner_radius'))
        SUPPORTS_CORNER_RADIUS = true;
}

let BmsDynamicPipelineClass = null;

function getBmsDirectory() {
    let bms = Main.extensionManager.lookup('blur-my-shell@aunetx');
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
        } catch {
            return false;
        }
    }
    return false;
}

export async function initBlurBackend(force = false) {
    if (!force && BmsDynamicPipelineClass) return BmsDynamicPipelineClass;
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
    BmsDynamicPipelineClass = null;
    return null;
}

// Attempt eager backend resolution
await initBlurBackend();

export function getBmsDynamicPipelineClass() {
    return BmsDynamicPipelineClass;
}

export function isBlurMyShellAvailable() {
    if (global.blur_my_shell) return true;
    let bms = Main.extensionManager.lookup('blur-my-shell@aunetx');
    if (bms && bms.state === 1) return true;
    return getBmsDirectory() !== null;
}

export function isRoundedBlurAvailable() {
    if (getBmsDynamicPipelineClass() !== null) return true;
    let bms = global.blur_my_shell;
    if (bms && bms._effects_manager) return true;
    if (isBmsUnifiedInstalled()) return true;
    if (SUPPORTS_CORNER_RADIUS) return true;
    if (BlurModule !== null) return true;
    if (bms && bms._settings && bms._settings.ROUNDED_BLUR_FOUND) return true;

    let typelibEnv = GLib.getenv('GI_TYPELIB_PATH');
    if (typelibEnv) {
        for (let dir of typelibEnv.split(':')) {
            if (dir && GLib.file_test(GLib.build_filenamev([dir, 'Blur-1.0.typelib']), GLib.FileTest.EXISTS)) {
                return true;
            }
        }
    }

    let paths = [
        '/usr/lib/girepository-1.0/Blur-1.0.typelib',
        '/usr/lib64/girepository-1.0/Blur-1.0.typelib',
        '/usr/local/lib/girepository-1.0/Blur-1.0.typelib',
        '/usr/lib/girepository-2.0/Blur-1.0.typelib',
        '/usr/lib64/girepository-2.0/Blur-1.0.typelib',
        '/usr/local/lib/girepository-2.0/Blur-1.0.typelib',
        '/usr/lib/libblur-effect-1.0.so',
        '/usr/lib64/libblur-effect-1.0.so',
        '/usr/local/lib/libblur-effect-1.0.so',
        '/run/current-system/sw/lib/girepository-1.0/Blur-1.0.typelib',
        '/run/current-system/sw/lib/libblur-effect-1.0.so',
        GLib.build_filenamev([GLib.get_home_dir(), '.nix-profile', 'lib', 'girepository-1.0', 'Blur-1.0.typelib']),
        GLib.build_filenamev([GLib.get_home_dir(), '.nix-profile', 'lib', 'libblur-effect-1.0.so']),
        '/nix/var/nix/profiles/default/lib/girepository-1.0/Blur-1.0.typelib',
        '/nix/var/nix/profiles/default/lib/libblur-effect-1.0.so',
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
            if (this._callback)
                this._callback();
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
                            initBlurBackend(true).then(() => {
                                if (this._enabled) this._refreshEffect();
                            });
                        } else {
                            BmsDynamicPipelineClass = null;
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
            this._dynamicPipeline.set_corner_radius(r);
            return;
        }
        if (!this._effect) return;
        let scale = this._getScaleFactor();
        if ('corner-radius' in this._effect) {
            this._effect['corner-radius'] = r * scale;
        } else if ('corner_radius' in this._effect) {
            this._effect.corner_radius = r * scale;
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
        this._effect.radius = this._computeScaledSigma(newSigma);
    }

    setOpacityFactor(factor) {
        let clamped = Math.min(1.0, Math.max(0.0, (typeof factor === 'number' && !isNaN(factor)) ? factor : 1.0));
        if (Math.abs(this._opacityFactor - clamped) < 0.005 && clamped !== 0.0 && clamped !== 1.0) return;
        this._opacityFactor = clamped;
        if (!this._enabled) return;

        if (this._isBmsDynamic && this._dynamicPipeline) {
            this._dynamicPipeline.set_opacity_factor(clamped, true);
            this._syncSigma();
            return;
        }

        if (!this._effect) return;
        this._effect.radius = this._computeScaledSigma();
    }

    invalidate() {
        if (!this._enabled) return;
        if (this._isBmsDynamic && this._dynamicPipeline) {
            this._dynamicPipeline.repaint_effect();
            return;
        }
        if (this._effect) {
            this._effect.queue_repaint();
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
        if (DynPipelineClass && bms && bms._effects_manager && bms._pipelines_manager) {
            let bmsSettings = bms._settings;
            try {
                let pipelineId = 'pipeline_default';
                if (this._role === 'panel' && bmsSettings && bmsSettings.panel && bmsSettings.panel.PIPELINE) {
                    pipelineId = bmsSettings.panel.PIPELINE;
                } else if (bmsSettings && bmsSettings.popup && bmsSettings.popup.PIPELINE) {
                    pipelineId = bmsSettings.popup.PIPELINE;
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
            } catch (e) {
                console.warn(`[Dynamic Music Pill] Failed to initialize BMS DynamicPipeline: ${e.message}`, e.stack);
                if (this._dynamicPipeline) {
                    this._dynamicPipeline.destroy();
                    this._dynamicPipeline = null;
                }
                this._isBmsDynamic = false;
            }

            if (this._isBmsDynamic && this._dynamicPipeline) {
                let targetComp = (this._role === 'panel')
                    ? (bmsSettings ? bmsSettings.panel : null)
                    : (bmsSettings ? bmsSettings.popup : null);
                if (targetComp && targetComp.settings) {
                    this._bmsSettingsChangedId = targetComp.settings.connect('changed::pipeline', () => {
                        let shouldFollow = (this._shouldFollowPipeline ? this._shouldFollowPipeline() : true);
                        if (shouldFollow && this._dynamicPipeline) {
                            let newId = (this._role === 'panel')
                                ? (bmsSettings && bmsSettings.panel ? bmsSettings.panel.PIPELINE : null)
                                : (bmsSettings && bmsSettings.popup ? bmsSettings.popup.PIPELINE : null);
                            if (newId) {
                                this._dynamicPipeline.change_pipeline_to(newId);
                                this._syncSigma();
                            }
                        }
                    });
                }
            }
        }

        if (!this._dynamicPipeline) {
            this._isBmsDynamic = false;
            let blurRadius = this._computeScaledSigma();
            let EffectClass = BlurOrShell.BlurEffect;
            if (EffectClass) {
                let mode = BlurOrShell.BlurMode ? BlurOrShell.BlurMode.BACKGROUND : 1;
                this._effect = new EffectClass({ mode: mode, radius: blurRadius });
                if ('corner-radius' in this._effect) {
                    this._effect['corner-radius'] = radius * scale;
                } else if ('corner_radius' in this._effect) {
                    this._effect.corner_radius = radius * scale;
                }
            }

            if (this._effect) {
                this._actor.add_effect(this._effect);

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
                    if (this._effect) {
                        this._effect.queue_repaint();
                    }
                });
                this._actor.add_effect(this._paintCallback);

                this._themeContext = St.ThemeContext.get_for_stage(global.stage);
                if (this._themeContext) {
                    this._themeContext.connectObject('notify::scale-factor', () => {
                        if (this._effect) {
                            let s = this._getScaleFactor();
                            let curR = (this._getRadius ? this._getRadius() : 24) || 0;
                            this._effect.radius = this._computeScaledSigma();
                            if ('corner-radius' in this._effect) {
                                this._effect['corner-radius'] = curR * s;
                            } else if ('corner_radius' in this._effect) {
                                this._effect.corner_radius = curR * s;
                            }
                        }
                    }, this);
                }
            }
        }
    }

    _removeEffect() {
        if (this._dynamicPipeline) {
            this._dynamicPipeline.destroy();
            this._dynamicPipeline = null;
            this._isBmsDynamic = false;
        }

        if (this._bmsSettingsChangedId) {
            let bms = global.blur_my_shell;
            let bmsSettings = bms ? bms._settings : null;
            let targetComp = (this._role === 'panel')
                ? (bmsSettings ? bmsSettings.panel : null)
                : (bmsSettings ? bmsSettings.popup : null);
            if (targetComp && targetComp.settings) {
                targetComp.settings.disconnect(this._bmsSettingsChangedId);
            }
            this._bmsSettingsChangedId = 0;
        }

        if (this._paintCallback) {
            if (this._actor) {
                this._actor.remove_effect(this._paintCallback);
            }
            this._paintCallback = null;
        }

        if (this._effect) {
            if (this._actor) {
                this._actor.remove_effect(this._effect);
            }
            if (this._effect.releaseTargets) {
                this._effect.releaseTargets();
            }
            this._effect = null;
        }

        if (this._themeContext) {
            this._themeContext.disconnectObject(this);
            this._themeContext = null;
        }
    }

    _getScaleFactor() {
        return St.ThemeContext.get_for_stage(global.stage).scale_factor;
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
