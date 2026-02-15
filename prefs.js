import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export default class DynamicMusicPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {

        const settings = this.getSettings('org.gnome.shell.extensions.dynamic-music-pill');
        
        const page = new Adw.PreferencesPage({
            title: 'Settings',
            icon_name: 'emblem-system-symbolic'
        });

        // --- 1. GENERAL ---
        const genGroup = new Adw.PreferencesGroup({
            title: 'General',
            description: 'Main behavior settings'
        });

        // Album Art Toggle
        const artRow = new Adw.ActionRow({
            title: 'Show Album Art',
            subtitle: 'Show or hide the album cover art'
        });
        const artToggle = new Gtk.Switch({
            active: settings.get_boolean('show-album-art'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('show-album-art', artToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        artRow.add_suffix(artToggle);
        genGroup.add(artRow);

        // Text Scroll
        const scrollRow = new Adw.ActionRow({
            title: 'Scrolling Text',
            subtitle: 'Automatically animate long track titles'
        });
        const scrollToggle = new Gtk.Switch({
            active: settings.get_boolean('scroll-text'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('scroll-text', scrollToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        scrollRow.add_suffix(scrollToggle);
        genGroup.add(scrollRow);

        page.add(genGroup);


        // --- 2. APPEARANCE (Visualizer & Style) ---
        const appearGroup = new Adw.PreferencesGroup({
            title: 'Visualizer & Style',
        });

        const visModel = new Gtk.StringList();
        visModel.append("Off");
        visModel.append("Wave (Smooth)");
        visModel.append("Beat (Jumpy)");
        const visRow = new Adw.ComboRow({
            title: 'Visualizer Style',
            subtitle: 'Choose the animation style of the bars',
            model: visModel,
            selected: settings.get_int('visualizer-style')
        });
        visRow.connect('notify::selected', () => { settings.set_int('visualizer-style', visRow.selected); });
        appearGroup.add(visRow);

        const radiusRow = new Adw.SpinRow({
            title: 'Corner Radius',
            subtitle: 'Roundness of the corners (0 = square)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 2 })
        });
        settings.bind('border-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearGroup.add(radiusRow);

        page.add(appearGroup);


        // --- 3. DYNAMIC DIMENSIONS (Dock vs Panel) ---

        // DOCK Settings
        const dockDimGroup = new Adw.PreferencesGroup({
            title: 'Dock Mode Settings',
            description: 'Applied when placed in Dash to Dock'
        });

        // Width (Dock)
        const dockWidthRow = new Adw.SpinRow({
            title: 'Width',
            subtitle: 'Widget width in Dock mode',
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 10 })
        });
        settings.bind('pill-width', dockWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockWidthRow);

        // Height (Dock)
        const dockHeightRow = new Adw.SpinRow({
            title: 'Height',
            subtitle: 'Widget height in Dock mode',
            adjustment: new Gtk.Adjustment({ lower: 32, upper: 100, step_increment: 4 })
        });
        settings.bind('pill-height', dockHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockHeightRow);

        // Art Size (Dock)
        const dockArtRow = new Adw.SpinRow({
            title: 'Art Size',
            subtitle: 'Size of square album art in Dock mode',
            adjustment: new Gtk.Adjustment({ lower: 20, upper: 100, step_increment: 2 })
        });
        settings.bind('art-size', dockArtRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockArtRow);

        page.add(dockDimGroup);


        // PANEL Settings
        const panelDimGroup = new Adw.PreferencesGroup({
            title: 'Panel Mode Settings',
            description: 'Applied when placed in Top Panel'
        });

        // Width (Panel)
        const panelWidthRow = new Adw.SpinRow({
            title: 'Width',
            subtitle: 'Widget width in Panel mode',
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 10 })
        });
        settings.bind('panel-pill-width', panelWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelWidthRow);

        // Height (Panel)
        const panelHeightRow = new Adw.SpinRow({
            title: 'Height',
            subtitle: 'Widget height in Panel mode',
            adjustment: new Gtk.Adjustment({ lower: 20, upper: 60, step_increment: 2 })
        });
        settings.bind('panel-pill-height', panelHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelHeightRow);

        // Art Size (Panel)
        const panelArtRow = new Adw.SpinRow({
            title: 'Art Size',
            subtitle: 'Size of square album art in Panel mode',
            adjustment: new Gtk.Adjustment({ lower: 10, upper: 50, step_increment: 2 })
        });
        settings.bind('panel-art-size', panelArtRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelArtRow);

        page.add(panelDimGroup);


        // --- 4. POSITIONING ---
        const posGroup = new Adw.PreferencesGroup({ title: 'Positioning' });

        const targetModel = new Gtk.StringList();
        targetModel.append("Dash to Dock (Bottom)");
        targetModel.append("Top Panel: LEFT Box");
        targetModel.append("Top Panel: CENTER Box");
        targetModel.append("Top Panel: RIGHT Box");

        const targetRow = new Adw.ComboRow({
            title: 'Placement Target',
            subtitle: 'Choose which container to inject into',
            model: targetModel,
            selected: settings.get_int('target-container')
        });
        targetRow.connect('notify::selected', () => {
            let val = targetRow.selected;
            settings.set_int('target-container', val);
            updateGroupVisibility(val);
        });
        posGroup.add(targetRow);

        const posModel = new Gtk.StringList();
        posModel.append("Manual Index");
        posModel.append("First (Start)");
        posModel.append("Center");
        posModel.append("Last (End)");

        const modeRow = new Adw.ComboRow({
            title: 'Position Preset',
            subtitle: 'Alignment within the chosen container',
            model: posModel,
            selected: settings.get_int('position-mode')
        });
        modeRow.connect('notify::selected', () => { settings.set_int('position-mode', modeRow.selected); });
        posGroup.add(modeRow);

        const indexRow = new Adw.SpinRow({
            title: 'Manual Index',
            subtitle: 'Used only when mode is Manual (0 = first)',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 20, step_increment: 1 })
        });
        settings.bind('dock-position', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(indexRow);

        const vOffsetRow = new Adw.SpinRow({
            title: 'Vertical Offset',
            subtitle: 'Move Up (-) or Down (+)',
            adjustment: new Gtk.Adjustment({ lower: -30, upper: 30, step_increment: 1 })
        });
        settings.bind('vertical-offset', vOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(vOffsetRow);

        const hOffsetRow = new Adw.SpinRow({
            title: 'Horizontal Offset',
            subtitle: 'Move Left (-) or Right (+)',
            adjustment: new Gtk.Adjustment({ lower: -50, upper: 50, step_increment: 1 })
        });
        settings.bind('horizontal-offset', hOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(hOffsetRow);

        page.add(posGroup);


        // --- 5. COMPATIBILITY & PERFORMANCE ---
        const compatGroup = new Adw.PreferencesGroup({ title: 'Compatibility & Performance' });

        const fixRow = new Adw.ActionRow({
            title: 'Fix Dock Auto-hide Issues',
            subtitle: 'Enable this if Dash-to-Dock gets stuck. Keeps a 1px spacer visible when stopped.'
        });
        const fixToggle = new Gtk.Switch({
            active: settings.get_boolean('fix-dock-autohide'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('fix-dock-autohide', fixToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        fixRow.add_suffix(fixToggle);
        compatGroup.add(fixRow);

        const gameRow = new Adw.ActionRow({
            title: 'Game Mode',
            subtitle: 'Stop animations when a fullscreen app is active'
        });
        const gameToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-gamemode'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-gamemode', gameToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        gameRow.add_suffix(gameToggle);
        compatGroup.add(gameRow);

        page.add(compatGroup);


        // --- 6. SHADOW ---
        const shadowGroup = new Adw.PreferencesGroup({ title: 'Shadow' });
        const shadowToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-shadow'),
            valign: Gtk.Align.CENTER
        });
        const shadowRow = new Adw.ActionRow({ title: 'Enable Shadow' });
        settings.bind('enable-shadow', shadowToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        shadowRow.add_suffix(shadowToggle);
        shadowGroup.add(shadowRow);

        const opacityRow = new Adw.SpinRow({
            title: 'Opacity %',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5 })
        });
        settings.bind('shadow-opacity', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(opacityRow);

        const blurRow = new Adw.SpinRow({
            title: 'Blur Radius',
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 1 })
        });
        settings.bind('shadow-blur', blurRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(blurRow);
        page.add(shadowGroup);


        function updateGroupVisibility(targetVal) {
            if (targetVal === 0) {
                dockDimGroup.set_visible(true);
                panelDimGroup.set_visible(false);
            } else {
                dockDimGroup.set_visible(false);
                panelDimGroup.set_visible(true);
            }
        }
        updateGroupVisibility(settings.get_int('target-container'));

        // --- 7. ABOUT & SUPPORT ---
        const aboutPage = new Adw.PreferencesPage({
            title: 'About & Support',
            icon_name: 'help-about-symbolic'
        });

        const supportGroup = new Adw.PreferencesGroup({
            title: 'Support the Project',
            description: 'If you like this extension, consider supporting the development.'
        });

        const kofiRow = new Adw.ActionRow({ title: 'Support on Ko-fi' });
        const kofiBtn = new Gtk.Button({
            label: 'Support',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        kofiBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://ko-fi.com/andbal', null));
        kofiRow.add_suffix(kofiBtn);
        supportGroup.add(kofiRow);

        const bmacRow = new Adw.ActionRow({ title: 'Buy Me a Coffee' });
        const bmacBtn = new Gtk.Button({
            label: 'Support',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action']
        });
        bmacBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://buymeacoffee.com/andbal', null));
        bmacRow.add_suffix(bmacBtn);
        supportGroup.add(bmacRow);

        const githubRow = new Adw.ActionRow({ title: 'Source Code', subtitle: 'Report bugs or contribute on GitHub' });
        const githubBtn = new Gtk.Button({
            icon_name: 'external-link-symbolic',
            valign: Gtk.Align.CENTER
        });
        githubBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://github.com/andbal/dynamic-music-pill', null));
        githubRow.add_suffix(githubBtn);
        supportGroup.add(githubRow);

        aboutPage.add(supportGroup);

        // --- 8. RESET  ---
        const resetGroup = new Adw.PreferencesGroup({ title: 'Reset' });
        const resetRow = new Adw.ActionRow({
            title: 'Reset Defaults',
            subtitle: 'Restore all settings to original values'
        });
        const resetBtn = new Gtk.Button({
            label: 'Reset All',
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'] // PIROS
        });
        resetBtn.connect('clicked', () => {
            settings.reset('scroll-text');
            settings.reset('show-album-art');
            settings.reset('fix-dock-autohide');
            settings.reset('enable-shadow');
            settings.reset('shadow-blur');
            settings.reset('shadow-opacity');
            settings.reset('pill-width');
            settings.reset('panel-pill-width'); // Reset panel width
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

            // UI refresh
            visRow.selected = settings.get_int('visualizer-style');
            modeRow.selected = settings.get_int('position-mode');
            targetRow.selected = settings.get_int('target-container');
            updateGroupVisibility(targetRow.selected);
        });
        resetRow.add_suffix(resetBtn);
        resetGroup.add(resetRow);


        page.add(resetGroup);

        window.add(page);
        window.add(aboutPage);
    }
}