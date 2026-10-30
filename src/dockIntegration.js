import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { getDockManager, getDhruvaDocks } from './utils.js';

function _getPrimaryDhruvaDock(dhruvaDocks) {
    if (!dhruvaDocks || dhruvaDocks.length === 0) return null;
    return (
        dhruvaDocks.find(d => d.isPanelHost) ||
        dhruvaDocks.find(d => d.monitorIndex === Main.layoutManager.primaryIndex) ||
        dhruvaDocks[0]
    );
}

export function getDockContainer() {
    const dockBox = Main.uiGroup.get_children().find(actor =>
        actor._simpleTaskbarPanelBox === 'dock' &&
        actor._simpleTaskbarMonitorIndex === Main.layoutManager.primaryIndex
    );
    if (dockBox) {
        const panel = dockBox.get_children().find(actor => actor.get_name() === 'panel');
        if (panel && panel.centerBox)
            return panel.centerBox;
    }

    const dhruvaDocks = getDhruvaDocks();
    const primaryDhruva = _getPrimaryDhruvaDock(dhruvaDocks);
    if (primaryDhruva && primaryDhruva.boxActor) {
        primaryDhruva.boxActor._dhruvaDockUI = primaryDhruva;
        return primaryDhruva.boxActor;
    }

    const manager = getDockManager();
    if (manager) {
        if (manager.mainDock && manager.mainDock.dash && manager.mainDock.dash._box) {
            return manager.mainDock.dash._box;
        }
        if (Array.isArray(manager._allDocks) && manager._allDocks.length > 0) {
            for (let d of manager._allDocks) {
                if (d && d.dash && d.dash._box) return d.dash._box;
            }
        }
    }

    const dock = Main.panel.statusArea['dash-to-dock'] || Main.panel.statusArea['ubuntu-dock'];
    if (dock && dock._box) return dock._box;

    const isExtActive = (uuid) => {
        const ext = Main.extensionManager.lookup(uuid);
        return Boolean(ext && ext.state === 1);
    };
    if (
        isExtActive('dash-to-dock@micxgx.gmail.com') ||
        isExtActive('ubuntu-dock@ubuntu.com') ||
        isExtActive('dhruva@narkagni') ||
        isExtActive('simple-taskbar@sultech')
    ) {
        return null;
    }

    return Main.overview.dash._box || null;
}

export function getSecondaryDockContainers() {
    const boxes = Main.uiGroup.get_children()
        .filter(actor =>
            actor._simpleTaskbarPanelBox === 'dock' &&
            actor._simpleTaskbarMonitorIndex !== Main.layoutManager.primaryIndex
        )
        .map(dockBox => {
            const panel = dockBox.get_children().find(actor => actor.get_name() === 'panel');
            return panel ? panel.centerBox : null;
        })
        .filter(Boolean);
    if (boxes.length > 0)
        return boxes;

    const dhruvaDocks = getDhruvaDocks();
    if (dhruvaDocks.length > 0) {
        const primaryDhruva = _getPrimaryDhruvaDock(dhruvaDocks);
        return dhruvaDocks
            .filter(d => d && d !== primaryDhruva && d.boxActor)
            .map(d => {
                d.boxActor._dhruvaDockUI = d;
                return d.boxActor;
            });
    }

    const manager = getDockManager();
    if (!manager || !Array.isArray(manager._allDocks)) return [];
    return manager._allDocks
        .filter(dock => dock && dock !== manager.mainDock)
        .map(dock => (dock && dock.dash) ? dock.dash._box : null)
        .filter(Boolean);
}
