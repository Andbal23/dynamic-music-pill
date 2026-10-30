import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';


export function smartUnpack(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value;
    if (value instanceof GLib.Variant) {
        return smartUnpack(value.deep_unpack()); 
    }
    if (Array.isArray(value)) return value.map(smartUnpack);
    if (typeof value === 'object') return value;
    return value;
}

export function getAverageColor(pixbuf) {
    let w = pixbuf.get_width();
    let h = pixbuf.get_height();
    let pixels = pixbuf.get_pixels();
    let rowstride = pixbuf.get_rowstride();
    let n_channels = pixbuf.get_n_channels();
    let r = 0, g = 0, b = 0, count = 0;
    for (let y = 0; y < h; y += 20) {
      for (let x = 0; x < w; x += 20) {
        let idx = y * rowstride + x * n_channels;
        r += pixels[idx]; g += pixels[idx + 1]; b += pixels[idx + 2];
        count++;
      }
    }
    return { r: Math.floor(r / count), g: Math.floor(g / count), b: Math.floor(b / count) };
}

export function formatTime(microSeconds, forceHours = false) {
    if (!microSeconds || microSeconds < 0) return forceHours ? "0:00:00" : "0:00";
    let totalSeconds = Math.floor(microSeconds / 1000000);
    let hours = Math.floor(totalSeconds / 3600);
    let min = Math.floor((totalSeconds % 3600) / 60);
    let sec = totalSeconds % 60;
    if (forceHours || hours > 0) {
        return `${hours}:${min < 10 ? '0' + min : min}:${sec < 10 ? '0' + sec : sec}`;
    }
    return `${min}:${sec < 10 ? '0' + sec : sec}`;
}

export function getClosestGnomeAccent(r, g, b) {
    let rNorm = r / 255, gNorm = g / 255, bNorm = b / 255;
    let max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm);
    let h = 0, s = 0, l = (max + min) / 2;

    if (max !== min) {
        let d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break;
            case gNorm: h = (bNorm - rNorm) / d + 2; break;
            case bNorm: h = (rNorm - gNorm) / d + 4; break;
        }
        h *= 60;
    }
    s *= 100;
    l *= 100;

    if (s < 15 || l < 15 || l > 90) return 'slate';

    const presets = {
        'red': 0,
        'orange': 30,
        'yellow': 50,
        'green': 120,
        'teal': 170,
        'blue': 210,
        'purple': 280,
        'pink': 330
    };

    let closest = 'blue';
    let minDistance = Infinity;

    for (const [name, targetHue] of Object.entries(presets)) {
        let diff = Math.abs(h - targetHue);
        let distance = Math.min(diff, 360 - diff);

        if (distance < minDistance) {
            minDistance = distance;
            closest = name;
        }
    }
    
    let redDiff = Math.abs(h - 360);
    if (redDiff < minDistance) {
        closest = 'red';
    }

    return closest;
}

let dtdDisableRequests = 0;
let _dtdDockManager = null;
let _dtdModule = null;
let _dtdImportPromise = null;
let _dtdImportSettled = false;
let _dtdLoadedPath = null;

function _lookupDtdExtension() {
    let ext = Main.extensionManager.lookup('dash-to-dock@micxgx.gmail.com');
    if (!ext || ext.state !== 1) {
        ext = Main.extensionManager.lookup('ubuntu-dock@ubuntu.com');
    }
    return (ext && ext.state === 1) ? ext : null;
}

function _resolveDockManager(ext, mod) {
    return (
        mod?.dockManager ||
        (mod?.DockManager ? mod.DockManager.getDefault() : null) ||
        ext?.stateObj?._dockManager ||
        ext?.stateObj?.dockManager ||
        Main.overview.dash._dtdDockManager ||
        null
    );
}

export function resetDTDModule() {
    _dtdDockManager = null;
    _dtdModule = null;
    _dtdImportPromise = null;
    _dtdImportSettled = false;
    _dtdLoadedPath = null;
}

export function initDTDModule() {
    let ext = _lookupDtdExtension();
    if (!ext) {
        resetDTDModule();
        return null;
    }

    if (_dtdLoadedPath && _dtdLoadedPath !== ext.path) {
        resetDTDModule();
    }

    const syncMgr = _resolveDockManager(ext, _dtdModule);
    if (syncMgr) {
        _dtdDockManager = syncMgr;
        _dtdImportSettled = true;
        _dtdLoadedPath = ext.path;
        if (dtdDisableRequests > 0) {
            _applyDisable();
        }
        return null;
    }

    if (_dtdImportSettled) return null;
    if (_dtdImportPromise) return _dtdImportPromise;

    _dtdLoadedPath = ext.path;
    _dtdImportPromise = import(`file://${ext.path}/extension.js`).then(mod => {
        _dtdModule = mod;
        _dtdImportSettled = true;
        _dtdImportPromise = null;
        _refreshDockManager();
        if (dtdDisableRequests > 0 && _dtdDockManager) {
            _applyDisable();
        }
    }).catch((e) => {
        console.debug('[Dynamic Music Pill] DTD/Ubuntu Dock import error: ' + e.message);
        _dtdImportSettled = true;
        _dtdImportPromise = null;
    });

    return _dtdImportPromise;
}

function _refreshDockManager() {
    const ext = _lookupDtdExtension();
    if (!ext) {
        _dtdDockManager = null;
        return;
    }
    const resolved = _resolveDockManager(ext, _dtdModule);
    if (resolved) {
        _dtdDockManager = resolved;
    }
}

export function getDockManager() {
    _refreshDockManager();
    return _dtdDockManager;
}

// Dash to Dock exposed `updateDashVisibility()` publicly in v110 (previously `_updateDashVisibility()`).
function _setDockRequiresVisibility(dock, value) {
    if (!dock || !dock.dash) return;
    dock.dash.requiresVisibility = value;
    if ('updateDashVisibility' in dock)
        dock.updateDashVisibility();
    else if ('_updateDashVisibility' in dock)
        dock._updateDashVisibility();
}

function _applyDisable() {
    _refreshDockManager();
    if (!_dtdDockManager || !_dtdDockManager._allDocks) return;
    for (const dock of _dtdDockManager._allDocks)
        _setDockRequiresVisibility(dock, true);
}

export function disableDashToDockAutohide() {
    dtdDisableRequests++;
    if (dtdDisableRequests === 1) {
        if (_dtdDockManager) {
            _applyDisable();
        } else {
            initDTDModule();
        }
    }
}

function _applyRestore() {
    _refreshDockManager();
    if (!_dtdDockManager || !_dtdDockManager._allDocks) return;
    for (const dock of _dtdDockManager._allDocks)
        _setDockRequiresVisibility(dock, false);
}

export function restoreDashToDockAutohide() {
    if (dtdDisableRequests > 0) {
        dtdDisableRequests--;
        if (dtdDisableRequests === 0 && _dtdDockManager) {
            _applyRestore();
        }
    }
}

let stbDisableRequests = 0;
let _stbAutohideDisabled = false;

function _patchSimpleTaskbarAutoHide(autoHideCtrl) {
    if (!autoHideCtrl) return;
    if (!autoHideCtrl._dmpOrigIsBlockedCallback && autoHideCtrl._isBlockedCallback) {
        const origCb = autoHideCtrl._isBlockedCallback.bind(autoHideCtrl);
        autoHideCtrl._dmpOrigIsBlockedCallback = origCb;
        autoHideCtrl._isBlockedCallback = function() {
            if (_stbAutohideDisabled) return true;
            return origCb();
        };
    }
    if (autoHideCtrl._clearHideTimeout)
        autoHideCtrl._clearHideTimeout();
    if (autoHideCtrl.show)
        autoHideCtrl.show(true);
}

function _patchSimpleTaskbarController(panelCtrl) {
    if (!panelCtrl) return;
    if (!panelCtrl._origInteractionIsBlocked && panelCtrl._interactionIsBlocked) {
        panelCtrl._origInteractionIsBlocked = panelCtrl._interactionIsBlocked.bind(panelCtrl);
        panelCtrl._interactionIsBlocked = function(includePreviews) {
            if (_stbAutohideDisabled) return true;
            return panelCtrl._origInteractionIsBlocked(includePreviews);
        };
    }
    _patchSimpleTaskbarAutoHide(panelCtrl._autoHideController);
}

function _getSimpleTaskbarInstance() {
    let ext = Main.extensionManager.lookup('simple-taskbar@sultech');
    if (!ext || ext.state !== 1) return null;
    return ext.stateObj || ext;
}

function _applySimpleTaskbarDisable() {
    let inst = _getSimpleTaskbarInstance();
    if (!inst) return;

    if (inst._panelInteractionIsBlocked && !inst._origPanelInteractionIsBlocked) {
        inst._origPanelInteractionIsBlocked = inst._panelInteractionIsBlocked.bind(inst);
        inst._panelInteractionIsBlocked = function(includePreviews) {
            if (_stbAutohideDisabled) return true;
            return inst._origPanelInteractionIsBlocked(includePreviews);
        };
    }
    let panelCtrl = inst._panelController;
    _patchSimpleTaskbarAutoHide(panelCtrl ? panelCtrl._autoHideController : null);

    let dockPanelMgr = inst._dockPanelManager;
    if (dockPanelMgr && dockPanelMgr._panels) {
        for (const p of dockPanelMgr._panels) {
            _patchSimpleTaskbarController(p);
        }
    }
    let secPanelMgr = inst._secondaryPanelManager;
    if (secPanelMgr && secPanelMgr._panels) {
        for (const p of secPanelMgr._panels) {
            _patchSimpleTaskbarController(p);
        }
    }
}

export function disableSimpleTaskbarAutohide() {
    stbDisableRequests++;
    _stbAutohideDisabled = true;
    _applySimpleTaskbarDisable();
}

export function restoreSimpleTaskbarAutohide() {
    if (stbDisableRequests > 0) {
        stbDisableRequests--;
        if (stbDisableRequests === 0) {
            _stbAutohideDisabled = false;
            let inst = _getSimpleTaskbarInstance();
            if (inst) {
                const restoreCtrl = (ah) => {
                    if (!ah) return;
                    if (ah.setMenuOpen)
                        ah.setMenuOpen(false);
                    if (ah._scheduleHide)
                        ah._scheduleHide();
                };
                let panelCtrl = inst._panelController;
                restoreCtrl(panelCtrl ? panelCtrl._autoHideController : null);
                let dockPanelMgr = inst._dockPanelManager;
                if (dockPanelMgr && dockPanelMgr._panels) {
                    for (const p of dockPanelMgr._panels) {
                        restoreCtrl(p ? p._autoHideController : null);
                    }
                }
                let secPanelMgr = inst._secondaryPanelManager;
                if (secPanelMgr && secPanelMgr._panels) {
                    for (const p of secPanelMgr._panels) {
                        restoreCtrl(p ? p._autoHideController : null);
                    }
                }
            }
        }
    }
}

let dhruvaDisableRequests = 0;
const DHRUVA_MENU_HOLD = { isOpen: true };

export function getDhruvaDocks() {
    const out = [];
    const seen = new Set();
    const ext = Main.extensionManager.lookup('dhruva@narkagni');
    if (ext && ext.state === 1) {
        const rawDocks = ext.stateObj?._monitorController?.docks ?? ext.stateObj?.monitorController?.docks;
        if (rawDocks) {
            const iter = rawDocks instanceof Map ? rawDocks.values() : (Array.isArray(rawDocks) ? rawDocks : []);
            for (const d of iter) {
                if (d && d.boxActor && !seen.has(d)) {
                    seen.add(d);
                    out.push(d);
                }
            }
        }
    }
    if (out.length === 0) {
        for (const actor of Main.uiGroup.get_children()) {
            if (actor.get_name() === 'DhruvaContainer' && actor._dockUI?.boxActor && !seen.has(actor._dockUI)) {
                seen.add(actor._dockUI);
                out.push(actor._dockUI);
            }
        }
    }
    return out;
}

export function disableDhruvaAutohide() {
    dhruvaDisableRequests++;
    for (const dockUI of getDhruvaDocks()) {
        if (!dockUI._activeContextMenu) {
            dockUI._activeContextMenu = DHRUVA_MENU_HOLD;
        }
        if (dockUI.autoHideManager) {
            dockUI.autoHideManager.show();
        }
    }
}

export function restoreDhruvaAutohide() {
    if (dhruvaDisableRequests > 0) {
        dhruvaDisableRequests--;
        if (dhruvaDisableRequests === 0) {
            for (const dockUI of getDhruvaDocks()) {
                if (dockUI._activeContextMenu === DHRUVA_MENU_HOLD) {
                    dockUI._activeContextMenu = null;
                }
                if (dockUI.autoHideManager) {
                    dockUI.autoHideManager.scheduleCheck();
                }
            }
        }
    }
}

export function disableDockAutohide() {
    disableDashToDockAutohide();
    disableSimpleTaskbarAutohide();
    disableDhruvaAutohide();
}

export function restoreDockAutohide() {
    restoreDashToDockAutohide();
    restoreSimpleTaskbarAutohide();
    restoreDhruvaAutohide();
}

export function getPlayerIcon(proxy, busName) {
    let names = [];
    if (proxy && proxy._desktopEntry) {
        let de = proxy._desktopEntry.replace('.desktop', '');
        names.push(de);
        names.push(de.toLowerCase());
    }
    
    if (busName) {
        let rawAppName = busName.replace('org.mpris.MediaPlayer2.', '').split('.')[0];
        names.push(rawAppName.toLowerCase());
        names.push(rawAppName);
    }
    
    if (proxy && proxy._identity) {
        let id = proxy._identity.replace(/ /g, '-');
        names.push(id.toLowerCase());
        names.push(id);
    }
    
    names.push('audio-x-generic-symbolic');
    names.push('audio-x-generic');
    
    return new Gio.ThemedIcon({ names: names });
}
