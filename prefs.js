import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export default class DynamicMusicPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {

        const settings = this.getSettings('org.gnome.shell.extensions.dynamic-music-pill');
        
        const page = new Adw.PreferencesPage();

        // --- 1. APPEARANCE GROUP ---
        const appearGroup = new Adw.PreferencesGroup({
            title: 'Appearance',
            description: 'Visual style and behavior'
        });

        const visModel = new Gtk.StringList();
        visModel.append("Off");
        visModel.append("Wave (Smooth)");
        visModel.append("Beat (Jumpy)");
        const visRow = new Adw.ComboRow({
            title: 'Visualizer Style',
            subtitle: 'Choose the animation style of the bars', // Leírás hozzáadva
            model: visModel,
            selected: settings.get_int('visualizer-style')
        });
        visRow.connect('notify::selected', () => { settings.set_int('visualizer-style', visRow.selected); });
        appearGroup.add(visRow);

        const scrollRow = new Adw.ActionRow({ 
            title: 'Scrolling Text',
            subtitle: 'Automatically animate long track titles' // Leírás hozzáadva
        });
        const scrollToggle = new Gtk.Switch({ 
            active: settings.get_boolean('scroll-text'),
            valign: Gtk.Align.CENTER 
        });
        settings.bind('scroll-text', scrollToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        scrollRow.add_suffix(scrollToggle);
        appearGroup.add(scrollRow);

        page.add(appearGroup);


        // --- 2. PERFORMANCE & BEHAVIOR ---
        const perfGroup = new Adw.PreferencesGroup({ title: 'Performance' });
        
        const gameRow = new Adw.ActionRow({
            title: 'Game Mode',
            subtitle: 'Hide widget when a fullscreen app is active to save FPS' // Leírás hozzáadva
        });
        const gameToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-gamemode'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-gamemode', gameToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        gameRow.add_suffix(gameToggle);
        perfGroup.add(gameRow);
        
        page.add(perfGroup);


        // --- 3. SHADOW & DEPTH ---
        const shadowGroup = new Adw.PreferencesGroup({ title: 'Shadow & Depth' });
        
        const shadowRow = new Adw.ActionRow({
            title: 'Enable Shadow',
            subtitle: 'Show drop shadow around the widget and album art' // Leírás hozzáadva
        });
        const shadowToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-shadow'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-shadow', shadowToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        shadowRow.add_suffix(shadowToggle);
        shadowGroup.add(shadowRow);

        const opacityRow = new Adw.SpinRow({
            title: 'Shadow Strength',
            subtitle: 'Opacity of the shadow in percent (0-100)', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5 })
        });
        settings.bind('shadow-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(opacityRow);

        const blurRow = new Adw.SpinRow({
            title: 'Shadow Blur',
            subtitle: 'Blur radius of the shadow in pixels', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 1 })
        });
        settings.bind('shadow-blur', blurRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(blurRow);

        page.add(shadowGroup);


        // --- 4. DIMENSIONS ---
        const dimGroup = new Adw.PreferencesGroup({ title: 'Dimensions' });

        const widthRow = new Adw.SpinRow({
            title: 'Width',
            subtitle: 'Total width of the widget (100-400px)', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 400, step_increment: 10 })
        });
        settings.bind('pill-width', widthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dimGroup.add(widthRow);

        // --- 5. POSITIONING ---
        const posGroup = new Adw.PreferencesGroup({ title: 'Positioning' });

        // Target
        const targetModel = new Gtk.StringList();
        targetModel.append("Dash to Dock (Bottom)");
        targetModel.append("Top Panel: LEFT Box");
        targetModel.append("Top Panel: CENTER Box");
        targetModel.append("Top Panel: RIGHT Box");
        
        const targetRow = new Adw.ComboRow({
            title: 'Placement Target',
            subtitle: 'Choose which container to inject into', // Leírás hozzáadva
            model: targetModel,
            selected: settings.get_int('target-container')
        });
        targetRow.connect('notify::selected', () => { 
            let val = targetRow.selected;
            settings.set_int('target-container', val);
            updateGroupVisibility(val);
        });
        posGroup.add(targetRow);

        // Position Mode
        const posModel = new Gtk.StringList();
        posModel.append("Manual Index");
        posModel.append("First (Start)");
        posModel.append("Center");
        posModel.append("Last (End)");
        
        const modeRow = new Adw.ComboRow({
            title: 'Position Preset',
            subtitle: 'Alignment within the chosen container', // Leírás hozzáadva
            model: posModel,
            selected: settings.get_int('position-mode')
        });
        modeRow.connect('notify::selected', () => { settings.set_int('position-mode', modeRow.selected); });
        posGroup.add(modeRow);

        const indexRow = new Adw.SpinRow({
            title: 'Manual Index',
            subtitle: 'Order in container (0 = first item). Only used in Manual mode.', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 20, step_increment: 1 })
        });
        settings.bind('dock-position', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(indexRow);

        // Vertical Offset (ITT JAVÍTOTTUK A LEÍRÁST)
        const vOffsetRow = new Adw.SpinRow({
            title: 'Vertical Offset',
            subtitle: 'Move Up (-) or Down (+). In Dash mode, -2 is usually center.', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: -30, upper: 30, step_increment: 1 })
        });
        settings.bind('vertical-offset', vOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(vOffsetRow);

        const hOffsetRow = new Adw.SpinRow({
            title: 'Horizontal Offset',
            subtitle: 'Fine tune position Left (-) or Right (+) in pixels', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: -50, upper: 50, step_increment: 1 })
        });
        settings.bind('horizontal-offset', hOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(hOffsetRow);

        page.add(posGroup);


        // --- DYNAMIC GROUPS (DOCK vs PANEL) ---
        
        // DOCK Settings
        const dockDimGroup = new Adw.PreferencesGroup({ 
            title: 'Dimensions (Dock Mode)',
            description: 'Settings applied when placed in Dash to Dock'
        });

        const dockHeightRow = new Adw.SpinRow({
            title: 'Height',
            subtitle: 'Height of the widget in Dock mode', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 32, upper: 100, step_increment: 4 })
        });
        settings.bind('pill-height', dockHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockHeightRow);

        const dockArtRow = new Adw.SpinRow({
            title: 'Cover Art Size',
            subtitle: 'Size of album art in Dock mode', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 20, upper: 100, step_increment: 2 })
        });
        settings.bind('art-size', dockArtRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockArtRow);
        
        page.add(dockDimGroup);


        // PANEL Settings
        const panelDimGroup = new Adw.PreferencesGroup({ 
            title: 'Dimensions (Panel Mode)',
            description: 'Settings applied when placed in Top Panel'
        });

        const panelHeightRow = new Adw.SpinRow({
            title: 'Height',
            subtitle: 'Height of the widget in Panel mode (Rec: 28-32px)', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 20, upper: 60, step_increment: 2 })
        });
        settings.bind('panel-pill-height', panelHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelHeightRow);

        const panelArtRow = new Adw.SpinRow({
            title: 'Cover Art Size',
            subtitle: 'Size of album art in Panel mode (Rec: 20-24px)', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 50, step_increment: 2 })
        });
        settings.bind('panel-art-size', panelArtRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelArtRow);

        page.add(panelDimGroup);


        // Shared Radius
        const sharedDimGroup = new Adw.PreferencesGroup({ title: 'Shared Style' });
        const radiusRow = new Adw.SpinRow({
            title: 'Corner Radius',
            subtitle: 'Roundness of the corners (0 = square)', // Leírás hozzáadva
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 2 })
        });
        settings.bind('border-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        sharedDimGroup.add(radiusRow);
        
        // Reset Button
        const resetRow = new Adw.ActionRow({ 
            title: 'Reset Defaults',
            subtitle: 'Restore all settings to original values' // Leírás hozzáadva
        });
        const resetBtn = new Gtk.Button({
            label: 'Reset All',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });
        resetBtn.connect('clicked', () => {
            settings.reset('scroll-text');
            settings.reset('enable-shadow');
            settings.reset('shadow-blur');
            settings.reset('shadow-opacity');
            settings.reset('pill-width');
            settings.reset('pill-height');
            settings.reset('art-size');
            settings.reset('panel-pill-height');
            settings.reset('panel-art-size');
            settings.reset('vertical-offset');
            settings.reset('horizontal-offset');
            settings.reset('position-mode');
            settings.reset('dock-position');
            settings.reset('visualizer-style');
            settings.reset('border-radius');
            settings.reset('target-container');
            settings.reset('enable-gamemode');
            
            // UI frissítése
            visRow.selected = settings.get_int('visualizer-style');
            modeRow.selected = settings.get_int('position-mode');
            targetRow.selected = settings.get_int('target-container');
            updateGroupVisibility(targetRow.selected);
        });
        resetRow.add_suffix(resetBtn);
        sharedDimGroup.add(resetRow);
        page.add(sharedDimGroup);


        // Visibility Helper
        function updateGroupVisibility(targetVal) {
            if (targetVal === 0) { // Dock
                dockDimGroup.set_visible(true);
                panelDimGroup.set_visible(false);
            } else { // Panel
                dockDimGroup.set_visible(false);
                panelDimGroup.set_visible(true);
            }
        }

        // Init visibility
        updateGroupVisibility(settings.get_int('target-container'));

        window.add(page);
    }
}
