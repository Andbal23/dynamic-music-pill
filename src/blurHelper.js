import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';

const GEOMETRY_SIGNALS = [
    'notify::allocation',
    'notify::position',
    'notify::size',
    'notify::translation-x',
    'notify::translation-y',
    'notify::scale-x',
    'notify::scale-y',
    'notify::opacity',
    'notify::visible',
    'notify::mapped',
];

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
        this._bmsConnectedSettings = null;
        this._bmsSettingsChangedId = 0;
        this._updateSizeId = 0;
        this._mapId = 0;
        this._externalGroup = null;
        this._externalGroupDestroyId = 0;
        this._externalHostParent = null;
        this._externalHostSibling = null;
        this._externalSignalRecords = [];

        if (this._actor) {
            this._actor.connectObject(
                'notify::allocation', () => this._checkSizeAndApply(),
                'notify::mapped', () => this._checkSizeAndApply(),
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

        if (Main.overview) {
            Main.overview.connectObject(
                'showing', () => this.scheduleUpdateSize(),
                'hiding', () => this.scheduleUpdateSize(),
                this
            );
        }

        if (Main.sessionMode) {
            Main.sessionMode.connectObject(
                'updated', () => this.scheduleUpdateSize(),
                this
            );
        }

        if (Main.layoutManager) {
            Main.layoutManager.connectObject(
                'monitors-changed', () => this.scheduleUpdateSize(),
                this
            );
        }
    }

    _getReferenceActor() {
        if (!this._actor) return null;
        let parent = this._actor.get_parent ? this._actor.get_parent() : null;
        if (parent && parent._body) return parent._body;
        if (parent && parent._box) return parent._box;
        return this._actor;
    }

    _findExternalHost() {
        let refActor = this._getReferenceActor();
        if (!refActor || !refActor.get_stage()) return null;
        let cur = refActor.get_parent();
        let highestRedirected = null;
        while (cur && cur !== global.stage && cur !== Main.uiGroup) {
            let hasOffscreenRedirect = Boolean(
                cur.offscreen_redirect &&
                cur.offscreen_redirect !== Clutter.OffscreenRedirect.AUTOMATIC
            );
            let hasOffscreenEffect = false;
            if (typeof cur.get_effects === 'function') {
                let effs = cur.get_effects();
                if (effs && effs.some(e => e && e.enabled && (e instanceof Clutter.OffscreenEffect))) {
                    hasOffscreenEffect = true;
                }
            }
            if (hasOffscreenRedirect || hasOffscreenEffect) {
                highestRedirected = cur;
            }
            cur = cur.get_parent();
        }
        if (!highestRedirected) return null;
        let hostParent = highestRedirected.get_parent();
        if (!hostParent) return null;
        return { hostParent, hostSibling: highestRedirected };
    }

    _getRelativeGeometry(actor, ancestor, customW = null, customH = null) {
        if (!actor || !ancestor) return null;
        const width = (typeof customW === 'number') ? customW : actor.width;
        const height = (typeof customH === 'number') ? customH : actor.height;
        const corners = [
            [0, 0],
            [width, 0],
            [0, height],
            [width, height],
        ].map(([x, y]) => actor.apply_relative_transform_to_point(
            ancestor,
            new Graphene.Point3D({ x, y, z: 0 })
        ));
        const xs = corners.map(p => p.x);
        const ys = corners.map(p => p.y);
        if (!xs.every(Number.isFinite) || !ys.every(Number.isFinite)) return null;
        const x1 = Math.min(...xs);
        const y1 = Math.min(...ys);
        return {
            x: x1,
            y: y1,
            width: Math.max(...xs) - x1,
            height: Math.max(...ys) - y1,
        };
    }

    _hasRunningTransitions() {
        const checkActor = (a) => Boolean(
            a && a.get_transition && (
                a.get_transition('width') ||
                a.get_transition('height') ||
                a.get_transition('x') ||
                a.get_transition('y') ||
                a.get_transition('translation-x') ||
                a.get_transition('translation-y') ||
                a.get_transition('scale-x') ||
                a.get_transition('scale-y') ||
                a.get_transition('opacity')
            )
        );
        let refActor = this._getReferenceActor();
        let parent = this._actor?.get_parent?.();
        return checkActor(this._actor) || checkActor(refActor) || checkActor(parent);
    }

    _connectExternalSignals(hostParent) {
        this._disconnectExternalSignals();
        let refActor = this._getReferenceActor();
        if (!refActor || !hostParent) return;

        const onGeomChanged = () => this.scheduleUpdateSize();
        const watched = new Set();
        let cur = refActor;
        while (cur && cur !== global.stage) {
            watched.add(cur);
            if (cur === hostParent) break;
            cur = cur.get_parent();
        }
        watched.add(hostParent);
        let parentOfHost = hostParent.get_parent ? hostParent.get_parent() : null;
        if (parentOfHost) {
            watched.add(parentOfHost);
            if (parentOfHost._slider) watched.add(parentOfHost._slider);
        }

        for (const actor of watched) {
            const ids = [];
            for (const sig of GEOMETRY_SIGNALS) {
                try {
                    ids.push(actor.connect(sig, onGeomChanged));
                } catch (_) {}
            }
            if (actor._slider && 'slide-x' in actor._slider) {
                try {
                    ids.push(actor._slider.connect('notify::slide-x', onGeomChanged));
                } catch (_) {}
            }
            this._externalSignalRecords.push({ actor, ids });
        }
    }

    _disconnectExternalSignals() {
        for (const rec of this._externalSignalRecords) {
            for (const id of rec.ids) {
                if (id) {
                    try { rec.actor.disconnect(id); } catch (_) {}
                }
            }
        }
        this._externalSignalRecords = [];
    }

    _getActorSize() {
        if (!this._actor) return [0, 0];
        let refActor = this._getReferenceActor();
        let w = 0;
        let h = 0;
        if (refActor && refActor !== this._actor) {
            w = Math.round(refActor.width);
            h = Math.round(refActor.height);
            if (w <= 0 || h <= 0) {
                let rBox = refActor.get_allocation_box();
                w = Math.round(rBox.get_width());
                h = Math.round(rBox.get_height());
            }
        }
        if (w <= 0 || h <= 0) {
            let box = this._actor.get_allocation_box();
            w = Math.round(box.get_width());
            h = Math.round(box.get_height());
        }
        if (w <= 0 || h <= 0) {
            w = Math.round(this._actor.width);
            h = Math.round(this._actor.height);
        }
        return [Math.max(0, w), Math.max(0, h)];
    }

    scheduleUpdateSize() {
        if (!this._enabled) return;
        if (this._updateSizeId) return;
        this._updateSizeId = global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, () => {
            this._updateSizeId = 0;
            this._updateActualSize();
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateActualSize() {
        if (!this._enabled || !this._actor) return;
        if (!this._dynamicPipeline && !this._effect) {
            this._checkSizeAndApply();
            return;
        }

        if (this._isBmsDynamic && this._dynamicPipeline && this._externalGroup) {
            let host = this._findExternalHost();
            if (!host || host.hostParent !== this._externalHostParent || host.hostSibling !== this._externalHostSibling) {
                this._refreshEffect();
                return;
            }

            let { hostParent, hostSibling } = host;
            let refActor = this._getReferenceActor();
            if (!refActor || !refActor.get_stage()) {
                this._externalGroup.visible = false;
                return;
            }

            hostSibling.get_allocation_box();
            refActor.get_allocation_box();

            let opacity = 255;
            let visible = this._enabled && refActor.mapped && hostSibling.mapped;
            if (Main.sessionMode?.isLocked) {
                visible = false;
            }
            let role = (typeof this._role === 'function') ? this._role() : this._role;
            let bmsSettings = global.blur_my_shell?._settings;
            if (role === 'dock' && bmsSettings?.dash_to_dock?.UNBLUR_IN_OVERVIEW && Main.overview?.visible) {
                visible = false;
            }
            let anc = refActor;
            while (anc && anc !== hostParent) {
                opacity = Math.round(opacity * anc.opacity / 255);
                visible &&= anc.visible;
                anc = anc.get_parent();
            }

            let [w, h] = this._getActorSize();
            if (!visible || opacity <= 0 || w < 1 || h < 1) {
                this._externalGroup.visible = false;
                if (this._hasRunningTransitions()) {
                    this.scheduleUpdateSize();
                }
                return;
            }

            let targetGeom = this._getRelativeGeometry(refActor, hostParent, w, h);
            let groupGeom = this._getRelativeGeometry(this._externalGroup, hostParent, 0, 0);
            if (!targetGeom || !groupGeom) {
                this._externalGroup.visible = false;
                return;
            }

            let localX = Math.round(targetGeom.x - groupGeom.x);
            let localY = Math.round(targetGeom.y - groupGeom.y);
            let localW = Math.max(1, Math.round(targetGeom.width));
            let localH = Math.max(1, Math.round(targetGeom.height));

            if (this._externalGroup.get_parent() === hostParent &&
                this._externalGroup.get_next_sibling() !== hostSibling) {
                hostParent.set_child_below_sibling(this._externalGroup, hostSibling);
            }

            let bActor = this._dynamicPipeline.actor;
            if (bActor) {
                if (Math.round(bActor.x) !== localX || Math.round(bActor.y) !== localY) {
                    bActor.set_position(localX, localY);
                }
                if (Math.round(bActor.width) !== localW || Math.round(bActor.height) !== localH) {
                    bActor.set_size(localW, localH);
                }
                bActor.visible = true;
            }
            let cActor = this._dynamicPipeline.contentActor;
            if (cActor && (Math.round(cActor.width) !== localW || Math.round(cActor.height) !== localH)) {
                cActor.set_size(localW, localH);
            }

            this._externalGroup.opacity = opacity;
            this._externalGroup.visible = true;

            let effectiveFactor = Math.min(1.0, Math.max(0.0, (opacity / 255.0) * this._opacityFactor));
            if (effectiveFactor > 0.01) {
                this._dynamicPipeline.set_opacity_factor(effectiveFactor, true);
            }

            if (this._hasRunningTransitions()) {
                this.scheduleUpdateSize();
            }
            return;
        }

        let [w, h] = this._getActorSize();
        if (w < 1 || h < 1) return;

        if (Math.round(this._actor.width) !== w || Math.round(this._actor.height) !== h) {
            this._actor.set_size(w, h);
        }

        if (this._isBmsDynamic && this._dynamicPipeline) {
            let host = this._findExternalHost();
            if (host) {
                this._refreshEffect();
                return;
            }
            let bActor = this._dynamicPipeline.actor;
            if (bActor && (Math.round(bActor.width) !== w || Math.round(bActor.height) !== h)) {
                bActor.set_size(w, h);
            }
            let cActor = this._dynamicPipeline.contentActor;
            if (cActor && (Math.round(cActor.width) !== w || Math.round(cActor.height) !== h)) {
                cActor.set_size(w, h);
            }
        }

        if (this._hasRunningTransitions()) {
            this.scheduleUpdateSize();
        }
    }

    enable() {
        if (this._enabled) return;
        this._enabled = true;
        this._opacityFactor = 1.0;
        this._checkSizeAndApply();
        this.scheduleUpdateSize();
    }

    disable() {
        if (!this._enabled && !this._effect && !this._dynamicPipeline) return;
        this._enabled = false;
        if (this._updateSizeId) {
            global.compositor.get_laters().remove(this._updateSizeId);
            this._updateSizeId = 0;
        }
        this._removeEffect();
    }

    _checkSizeAndApply() {
        if (!this._enabled || !this._actor) return;
        if (!this._actor.get_stage()) return;
        if (this._effect || this._dynamicPipeline) {
            this.scheduleUpdateSize();
            return;
        }
        let [w, h] = this._getActorSize();
        if (w >= 1 && h >= 1) {
            this._applyEffect();
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
                    effect.queue_repaint();
                } else if (effect._bms_effect_type === 'refraction') {
                    let clamped = Math.min(rawSigma, 100);
                    if (effect._bms_effect_params) {
                        effect._bms_effect_params.blur_radius = clamped;
                    }
                    if (effect._bms_pixelize_role === 'refraction-blur') {
                        let r = this._dynamicPipeline.pipeline?.get_refraction_blur_radius
                            ? this._dynamicPipeline.pipeline.get_refraction_blur_radius(clamped)
                            : clamped;
                        effect.unscaled_radius = r * this._opacityFactor;
                    } else {
                        effect.blur_radius = clamped;
                    }
                    effect.queue_repaint();
                }
            });
            this._dynamicPipeline.repaint_effect();
        }
    }

    updateDimensions(w, h) {
        if (!this._enabled) return;
        if (!this._dynamicPipeline && !this._effect) {
            this._checkSizeAndApply();
        }
        let [targetW, targetH] = (typeof w === 'number' && typeof h === 'number') ? [Math.round(w), Math.round(h)] : this._getActorSize();
        if (targetW < 1 || targetH < 1) return;
        if (this._actor) {
            let curActorW = Math.round(this._actor.width);
            let curActorH = Math.round(this._actor.height);
            if (curActorW !== targetW || curActorH !== targetH) {
                this._actor.set_size(targetW, targetH);
            }
        }
        if (this._isBmsDynamic && this._dynamicPipeline) {
            let bActor = this._dynamicPipeline.actor;
            if (bActor && (Math.round(bActor.width) !== targetW || Math.round(bActor.height) !== targetH)) {
                bActor.set_size(targetW, targetH);
            }
            let cActor = this._dynamicPipeline.contentActor;
            if (cActor && (Math.round(cActor.width) !== targetW || Math.round(cActor.height) !== targetH)) {
                cActor.set_size(targetW, targetH);
            }
        }
        this.scheduleUpdateSize();
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
        if (!this._actor || !this._actor.get_stage() || this._effect || this._dynamicPipeline) return;
        let [w, h] = this._getActorSize();
        if (w < 1 || h < 1) return;

        let radius = (this._getRadius ? this._getRadius() : 24) || 0;
        let scale = this._getScaleFactor();
        let rawSigma = (this._getSigma ? this._getSigma() : 30);
        if (typeof rawSigma !== 'number' || isNaN(rawSigma)) rawSigma = 30;

        let DynPipelineClass = getBmsDynamicPipelineClass();
        let bms = global.blur_my_shell;
        if (DynPipelineClass && bms && bms._effects_manager && bms._pipelines_manager) {
            let bmsSettings = bms._settings;
            try {
                let shouldFollow = (this._shouldFollowPipeline ? this._shouldFollowPipeline() : true);
                let role = (typeof this._role === 'function') ? this._role() : this._role;
                if (!role) role = 'panel';

                let pipelineId = 'pipeline_default';
                if (shouldFollow && bmsSettings) {
                    if (role === 'dock' && bmsSettings.dash_to_dock && bmsSettings.dash_to_dock.PIPELINE) {
                        pipelineId = bmsSettings.dash_to_dock.PIPELINE;
                    } else if (role === 'panel' && bmsSettings.panel && bmsSettings.panel.PIPELINE) {
                        pipelineId = bmsSettings.panel.PIPELINE;
                    } else if (role === 'popup' && bmsSettings.popup && bmsSettings.popup.PIPELINE) {
                        pipelineId = bmsSettings.popup.PIPELINE;
                    }
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

                let externalHost = this._findExternalHost();
                let blurActor = null;
                if (externalHost) {
                    this._externalHostParent = externalHost.hostParent;
                    this._externalHostSibling = externalHost.hostSibling;
                    this._externalGroup = new Meta.BackgroundGroup({
                        name: 'dmp-pill-blur-group',
                        width: 0,
                        height: 0,
                    });
                    this._externalHostParent.insert_child_below(this._externalGroup, this._externalHostSibling);
                    this._externalGroupDestroyId = this._externalGroup.connect('destroy', () => {
                        this._externalGroup = null;
                        this._externalGroupDestroyId = 0;
                        this._externalHostParent = null;
                        this._externalHostSibling = null;
                        this._disconnectExternalSignals();
                        this._safeDestroyDynamicPipeline();
                    });
                    blurActor = this._dynamicPipeline.create_actor('dmp-blur-surface');
                    this._dynamicPipeline.ownsActor = true;
                    this._externalGroup.add_child(blurActor);
                    this._dynamicPipeline.attach_pipeline();
                    this._connectExternalSignals(this._externalHostParent);
                } else {
                    blurActor = this._dynamicPipeline.attach_to_container(this._actor, 'dmp-blur-surface');
                    if (this._dynamicPipeline.allocationId) {
                        this._actor.disconnect(this._dynamicPipeline.allocationId);
                        this._dynamicPipeline.allocationId = 0;
                    }
                }

                this._isBmsDynamic = true;
                if (blurActor) {
                    blurActor.set_size(w, h);
                }
                if (this._dynamicPipeline.contentActor) {
                    this._dynamicPipeline.contentActor.set_size(w, h);
                }

                let origSetOpacity = this._dynamicPipeline.set_opacity_factor.bind(this._dynamicPipeline);
                this._dynamicPipeline.set_opacity_factor = (factor, force = false) => {
                    origSetOpacity(factor, force);
                    this._syncSigma();
                };

                this._dynamicPipeline.set_opacity_factor(this._opacityFactor, true);
                this._syncSigma(rawSigma);

                if (blurActor) {
                    if (this._mapId) {
                        try { blurActor.disconnect(this._mapId); } catch (_) {}
                        this._mapId = 0;
                    }
                    this._mapId = blurActor.connect('notify::mapped', () => {
                        if (!blurActor.mapped) return;
                        this.scheduleUpdateSize();
                        if (this._dynamicPipeline) {
                            this._dynamicPipeline.set_opacity_factor(this._opacityFactor, true);
                            this._syncSigma();
                        }
                    });
                }
                this.scheduleUpdateSize();
            } catch (e) {
                console.error(`[Dynamic Music Pill] Failed to initialize BMS DynamicPipeline: ${e.message} \n ${e.stack}`);
                this._disconnectExternalSignals();
                this._safeDestroyDynamicPipeline();
                if (this._externalGroup) {
                    if (this._externalGroupDestroyId) {
                        try { this._externalGroup.disconnect(this._externalGroupDestroyId); } catch (_) {}
                        this._externalGroupDestroyId = 0;
                    }
                    try { this._externalGroup.destroy(); } catch (_) {}
                    this._externalGroup = null;
                }
                this._externalHostParent = null;
                this._externalHostSibling = null;
                this._isBmsDynamic = false;
            }

            if (this._isBmsDynamic && this._dynamicPipeline && bmsSettings) {
                let role = (typeof this._role === 'function') ? this._role() : this._role;
                if (!role) role = 'panel';
                let targetComp = (role === 'dock')
                    ? bmsSettings.dash_to_dock
                    : (role === 'panel' ? bmsSettings.panel : bmsSettings.popup);
                if (targetComp && targetComp.settings) {
                    this._bmsConnectedSettings = targetComp.settings;
                    this._bmsSettingsChangedId = targetComp.settings.connect('changed::pipeline', () => {
                        let shouldFollow = (this._shouldFollowPipeline ? this._shouldFollowPipeline() : true);
                        if (shouldFollow && this._dynamicPipeline) {
                            let newId = targetComp.PIPELINE || 'pipeline_default';
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
                    let isAnimating = this._opacityFactor < 1.0 || this._hasRunningTransitions();
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

    _safeClearPipelineSignals() {
        if (!this._dynamicPipeline) return;
        let activePm = global.blur_my_shell?._pipelines_manager;
        if (this._dynamicPipeline.pipelinesManager !== activePm) {
            this._dynamicPipeline.pipelineChangedIds = [];
            if (this._dynamicPipeline.roundedPipeline) {
                this._dynamicPipeline.roundedPipeline.pipelineSignalIds = [];
            }
            if (this._dynamicPipeline.pipeline) {
                this._dynamicPipeline.pipeline._pipeline_changed_id = null;
                this._dynamicPipeline.pipeline._pipeline_destroyed_id = null;
                this._dynamicPipeline.pipeline.effects = [];
            }
        }
    }

    _safeDestroyDynamicPipeline() {
        if (!this._dynamicPipeline) return;
        let dp = this._dynamicPipeline;
        this._dynamicPipeline = null;
        this._isBmsDynamic = false;
        if (dp.pipelinesManager !== global.blur_my_shell?._pipelines_manager) {
            dp.pipelineChangedIds = [];
            if (dp.roundedPipeline) dp.roundedPipeline.pipelineSignalIds = [];
            if (dp.pipeline) {
                dp.pipeline._pipeline_changed_id = null;
                dp.pipeline._pipeline_destroyed_id = null;
                dp.pipeline.effects = [];
            }
        }
        try {
            dp.destroy();
        } catch (_) {}
    }

    _removeEffect() {
        if (this._updateSizeId) {
            global.compositor.get_laters().remove(this._updateSizeId);
            this._updateSizeId = 0;
        }

        this._disconnectExternalSignals();

        if (this._mapId) {
            if (this._dynamicPipeline && this._dynamicPipeline.actor) {
                try { this._dynamicPipeline.actor.disconnect(this._mapId); } catch (_) {}
            }
            this._mapId = 0;
        }

        if (this._externalGroup) {
            if (this._externalGroupDestroyId) {
                try { this._externalGroup.disconnect(this._externalGroupDestroyId); } catch (_) {}
                this._externalGroupDestroyId = 0;
            }
        }

        if (this._dynamicPipeline) {
            this._safeDestroyDynamicPipeline();
        }

        if (this._externalGroup) {
            try { this._externalGroup.destroy(); } catch (_) {}
            this._externalGroup = null;
        }
        this._externalHostParent = null;
        this._externalHostSibling = null;

        if (this._bmsSettingsChangedId && this._bmsConnectedSettings) {
            try {
                this._bmsConnectedSettings.disconnect(this._bmsSettingsChangedId);
            } catch (_) {}
            this._bmsSettingsChangedId = 0;
            this._bmsConnectedSettings = null;
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
        if (Main.overview) {
            Main.overview.disconnectObject(this);
        }
        if (Main.sessionMode) {
            Main.sessionMode.disconnectObject(this);
        }
        if (Main.layoutManager) {
            Main.layoutManager.disconnectObject(this);
        }
        if (this._actor) {
            this._actor.disconnectObject(this);
            this._actor = null;
        }
    }
}
