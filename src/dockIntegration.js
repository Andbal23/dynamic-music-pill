import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import { getDockManager } from './utils.js';

export function getDockContainer() {
    const dockBox = Main.uiGroup.get_children().find(actor =>
        actor._simpleTaskbarPanelBox === 'dock' &&
        actor._simpleTaskbarMonitorIndex === Main.layoutManager.primaryIndex
    );
    if (dockBox) {
        const panel = dockBox.get_children().find(actor => actor.get_name?.() === 'panel');
        if (panel?.centerBox)
            return panel.centerBox;
    }

    const dock = Main.panel.statusArea['dash-to-dock'] || Main.panel.statusArea['ubuntu-dock'];
    return (dock && dock._box) ? dock._box : (Main.overview.dash?._box || null);
}

export function getSecondaryDockContainers() {
    const boxes = Main.uiGroup.get_children()
        .filter(actor =>
            actor._simpleTaskbarPanelBox === 'dock' &&
            actor._simpleTaskbarMonitorIndex !== Main.layoutManager.primaryIndex
        )
        .map(dockBox => dockBox.get_children().find(actor => actor.get_name?.() === 'panel')?.centerBox)
        .filter(Boolean);
    if (boxes.length > 0)
        return boxes;

    const manager = getDockManager();
    return manager ? manager._allDocks.filter(dock => dock !== manager.mainDock).map(dock => dock.dash._box) : [];
}
