import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { getDockManager } from './utils.js';

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

    const hasDtd = Boolean(
        (Main.extensionManager.lookup && (
            Main.extensionManager.lookup('dash-to-dock@micxgx.gmail.com') ||
            Main.extensionManager.lookup('ubuntu-dock@ubuntu.com')
        ))
    );
    if (hasDtd) {
        return null;
    }

    return (Main.overview && Main.overview.dash && Main.overview.dash._box) ? Main.overview.dash._box : null;
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

    const manager = getDockManager();
    if (!manager || !Array.isArray(manager._allDocks)) return [];
    return manager._allDocks
        .filter(dock => dock && dock !== manager.mainDock)
        .map(dock => (dock && dock.dash) ? dock.dash._box : null)
        .filter(Boolean);
}
