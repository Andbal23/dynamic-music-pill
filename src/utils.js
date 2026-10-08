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

export function initDTDModule() {
    let ext = Main.extensionManager.lookup('dash-to-dock@micxgx.gmail.com');
    if (!ext || ext.state !== 1) {
        ext = Main.extensionManager.lookup('ubuntu-dock@ubuntu.com');
    }
    if (!ext || ext.state !== 1) return null;
    
    if (_dtdImportPromise) return _dtdImportPromise;
    
    _dtdImportPromise = import(`file://${ext.path}/extension.js`).then(mod => {
        _dtdModule = mod;
        _dtdDockManager = mod.dockManager;
        if (dtdDisableRequests > 0) {
            _applyDisable();
        }
    }).catch((e) => {
        console.debug('[Dynamic Music Pill] DTD/Ubuntu Dock import error: ' + e.message);
        _dtdImportPromise = null;
    });
    
    return _dtdImportPromise;
}

function _refreshDockManager() {
    if (_dtdModule && _dtdModule.dockManager) {
        _dtdDockManager = _dtdModule.dockManager;
    }
}

export function getDockManager() {
    _refreshDockManager();
    return _dtdDockManager;
}

function _applyDisable() {
    _refreshDockManager();
    if (!_dtdDockManager) return;
    try {
        for (const dock of _dtdDockManager._allDocks) {
            dock.dash.requiresVisibility = true;
            dock._show();
        }
    } catch (e) {
        console.debug('[Dynamic Music Pill] DTD _applyDisable error: ' + e.message);
    }
}

export function disableDashToDockAutohide() {
    try {
        dtdDisableRequests++;
        if (dtdDisableRequests === 1) {
            if (_dtdDockManager) {
                _applyDisable();
            } else {
                initDTDModule();
            }
        }
    } catch (e) {
        console.debug('[Dynamic Music Pill] DTD/Ubuntu Dock disable error: ' + e.message);
    }
}

function _applyRestore() {
    _refreshDockManager();
    if (!_dtdDockManager) return;
    try {
        for (const dock of _dtdDockManager._allDocks) {
            dock.dash.requiresVisibility = false;
            dock._updateDashVisibility();
        }
    } catch (e) {
        console.debug('[Dynamic Music Pill] DTD _applyRestore error: ' + e.message);
    }
}

export function restoreDashToDockAutohide() {
    try {
        if (dtdDisableRequests > 0) {
            dtdDisableRequests--;
            if (dtdDisableRequests === 0) {
                if (_dtdDockManager) {
                    _applyRestore();
                }
            }
        }
    } catch (e) {
        console.debug('[Dynamic Music Pill] DTD/Ubuntu Dock restore error: ' + e.message);
    }
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
