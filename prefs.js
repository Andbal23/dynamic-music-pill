import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

export default class DynamicMusicPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
    this.initTranslations();

        const settings = this.getSettings('org.gnome.shell.extensions.dynamic-music-pill');

        const page = new Adw.PreferencesPage({
            title: 'Dynamic Music Pill',
            icon_name: 'emblem-music-symbolic'
        });

        // =========================================
        // 1. GENERAL CONTENT
        // =========================================
        const genGroup = new Adw.PreferencesGroup();
        genGroup.set_title(_('General Settings')); //
        genGroup.set_description(_('Basic display settings for track information'));

        // Album Art
        const artRow = new Adw.ActionRow({
            title: _('Show Album Art'),
            subtitle: _('Display the cover art of the currently playing song')
        });
        const artToggle = new Gtk.Switch({
            active: settings.get_boolean(_('show-album-art')),
            valign: Gtk.Align.CENTER
        });
        settings.bind(_('show-album-art'), artToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        artRow.add_suffix(artToggle);
        genGroup.add(artRow);
        /// SKIP
        const scrollCtrlRow = new Adw.ActionRow({
            title: _('Enable Scroll Controls'),
            subtitle: _('Switch tracks using scroll wheel or touchpad')
        });
        const scrollCtrlToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-scroll-controls'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-scroll-controls', scrollCtrlToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        scrollCtrlRow.add_suffix(scrollCtrlToggle);
        genGroup.add(scrollCtrlRow);

        const invertRow = new Adw.ActionRow({
            title: _('Invert Scroll Animation'),
            subtitle: _('Direction of the jump effect (Natural vs Traditional)')
        });
        const invertToggle = new Gtk.Switch({
            active: settings.get_boolean('invert-scroll-animation'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('invert-scroll-animation', invertToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        invertRow.add_suffix(invertToggle);
        genGroup.add(invertRow);

        // Scrolling Text
        const scrollRow = new Adw.ActionRow({
            title: _('Scrolling Text'),
            subtitle: _('Animate long track titles and artist names')
        });
        const scrollToggle = new Gtk.Switch({
            active: settings.get_boolean('scroll-text'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('scroll-text', scrollToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        scrollRow.add_suffix(scrollToggle);
        genGroup.add(scrollRow);

        page.add(genGroup);


        // =========================================
        // 2. BACKGROUND
        // =========================================
        const transGroup = new Adw.PreferencesGroup();
        transGroup.set_title(_('Background and Transparency'));
        transGroup.set_description(_('Customize the visibility and opacity'));

        // Enable Transparency
        const transRow = new Adw.ActionRow({
            title: _('Enable Transparency'),
            subtitle: _('Switch between a solid theme background and a custom transparent look')
        });
        const transToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-transparency'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-transparency', transToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        transRow.add_suffix(transToggle);
        transGroup.add(transRow);

        // Opacity Slider
        const opacityRow = new Adw.SpinRow({
            title: _('Background Opacity'),
            subtitle: _('Adjust transparency level (0% is invisible, 100% is solid)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5 })
        });
        settings.bind('transparency-strength', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', opacityRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transGroup.add(opacityRow);

        // Transparency Targets
        const transArtRow = new Adw.ActionRow({
            title: _('Apply to Album Art'),
            subtitle: _('Make the album cover follow the transparency setting')
        });
        const transArtToggle = new Gtk.Switch({ active: settings.get_boolean('transparency-art'), valign: Gtk.Align.CENTER });
        settings.bind('transparency-art', transArtToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', transArtRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transArtRow.add_suffix(transArtToggle);
        transGroup.add(transArtRow);

        const transTextRow = new Adw.ActionRow({
            title: _('Apply to Text'),
            subtitle: _('Make the song title and artist follow the transparency setting')
        });
        const transTextToggle = new Gtk.Switch({ active: settings.get_boolean('transparency-text'), valign: Gtk.Align.CENTER });
        settings.bind('transparency-text', transTextToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', transTextRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transTextRow.add_suffix(transTextToggle);
        transGroup.add(transTextRow);

        const transVisRow = new Adw.ActionRow({
            title: _('Apply to Visualizer'),
            subtitle: _('Make the audio visualizer bar follow the transparency setting')
        });
        const transVisToggle = new Gtk.Switch({ active: settings.get_boolean('transparency-vis'), valign: Gtk.Align.CENTER });
        settings.bind('transparency-vis', transVisToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', transVisRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transVisRow.add_suffix(transVisToggle);
        transGroup.add(transVisRow);

        page.add(transGroup);


        // =========================================
        // 3. VISUALIZER
        // =========================================
        const appearGroup = new Adw.PreferencesGroup();
        appearGroup.set_title(_('Visualizer and Shape'));
        appearGroup.set_description(_('Configure the audio visualizer animation'));

        // Visualizer Style
        const visModel = new Gtk.StringList();
        visModel.append(_("Off (Disabled)"));
        visModel.append(_("Wave (Smooth)"));
        visModel.append(_("Beat (Jumpy)"));

        const visRow = new Adw.ComboRow({
            title: _('Visualizer Animation'),
            subtitle: _('Select the style of the audio reaction bars'),
            model: visModel,
            selected: settings.get_int('visualizer-style')
        });
        visRow.connect('notify::selected', () => { settings.set_int('visualizer-style', visRow.selected); });
        appearGroup.add(visRow);

        // Corner Radius
        const radiusRow = new Adw.SpinRow({
            title: _('Corner Radius'),
            subtitle: _('Roundness of the widget edges (0 = Square, 25 = Pill)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 2 })
        });
        settings.bind('border-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        appearGroup.add(radiusRow);

        page.add(appearGroup);


        // =========================================
        // 4. DROP SHADOW
        // =========================================
        const shadowGroup = new Adw.PreferencesGroup();
        shadowGroup.set_title(_('Drop Shadow'));
        shadowGroup.set_description(_('Add depth to the widget with a configurable shadow'));

        const shadowRow = new Adw.ActionRow({
            title: _('Enable Shadow'),
            subtitle: _('Draw a shadow behind the main widget and album art')
        });
        const shadowToggle = new Gtk.Switch({ active: settings.get_boolean('enable-shadow'), valign: Gtk.Align.CENTER });
        settings.bind('enable-shadow', shadowToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        shadowRow.add_suffix(shadowToggle);
        shadowGroup.add(shadowRow);

        const shadowOpacityRow = new Adw.SpinRow({
            title: _('Shadow Intensity'),
            subtitle: _('Darkness of the shadow (higher is darker)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5 })
        });
        settings.bind('shadow-opacity', shadowOpacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(shadowOpacityRow);

        const shadowBlurRow = new Adw.SpinRow({
            title: _('Shadow Blur'),
            subtitle: _('Softness of the shadow edges (spread radius)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 1 })
        });
        settings.bind('shadow-blur', shadowBlurRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(shadowBlurRow);

        page.add(shadowGroup);


        // =========================================
        // 5. POSITIONING
        // =========================================
        const posGroup = new Adw.PreferencesGroup();
        posGroup.set_title(_('Positioning and Layout'));
        posGroup.set_description(_('Choose where the widget appears on your screen'));

        const targetModel = new Gtk.StringList();
        targetModel.append(_("Dock"));
        targetModel.append(_("Panel: Left Box"));
        targetModel.append(_("Panel: Center Box"));
        targetModel.append(_("Panel: Right Box"));

        const targetRow = new Adw.ComboRow({
            title: _('Container Target'),
            subtitle: _('Select which UI element should host the music pill'),
            model: targetModel,
            selected: settings.get_int('target-container')
        });
        posGroup.add(targetRow);

        const posModel = new Gtk.StringList();
        posModel.append(_("Manual Index"));
        posModel.append(_("First (Start)"));
        posModel.append(_("Center"));
        posModel.append(_("Last (End)"));

        const modeRow = new Adw.ComboRow({
            title: _('Alignment Preset'),
            subtitle: _('How the widget aligns relative to other items'),
            model: posModel,
            selected: settings.get_int('position-mode')
        });
        modeRow.connect('notify::selected', () => { settings.set_int('position-mode', modeRow.selected); });
        posGroup.add(modeRow);

        const indexRow = new Adw.SpinRow({
            title: _('Manual Index Position'),
            subtitle: _('Order in the list (0 is first). Only for Manual mode.'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 20, step_increment: 1 })
        });
        settings.bind('dock-position', indexRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(indexRow);

        const vOffsetRow = new Adw.SpinRow({
            title: _('Vertical Offset (Y)'),
            subtitle: _('Shift Up (-) or Down (+)'),
            adjustment: new Gtk.Adjustment({ lower: -30, upper: 30, step_increment: 1 })
        });
        settings.bind('vertical-offset', vOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(vOffsetRow);

        const hOffsetRow = new Adw.SpinRow({
            title: _('Horizontal Offset (X)'),
            subtitle: _('Shift Left (-) or Right (+)'),
            adjustment: new Gtk.Adjustment({ lower: -50, upper: 50, step_increment: 1 })
        });
        settings.bind('horizontal-offset', hOffsetRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        posGroup.add(hOffsetRow);

        page.add(posGroup);


        // =========================================
        // 6. SIZE CONFIGURATION
        // =========================================

        // 6a. DOCK SIZES
        const dockDimGroup = new Adw.PreferencesGroup();
        dockDimGroup.set_title(_('Dimensions (Dock Mode)'));

        const dockWidthRow = new Adw.SpinRow({
            title: _('Widget Width'),
            subtitle: _('Total horizontal size in pixels'),
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 10 })
        });
        settings.bind('pill-width', dockWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockWidthRow);

        const dockHeightRow = new Adw.SpinRow({
            title: _('Widget Height'),
            subtitle: _('Total vertical size in pixels'),
            adjustment: new Gtk.Adjustment({ lower: 32, upper: 100, step_increment: 4 })
        });
        settings.bind('pill-height', dockHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockHeightRow);

        page.add(dockDimGroup);

        // 6b. PANEL SIZES
        const panelDimGroup = new Adw.PreferencesGroup();
        panelDimGroup.set_title(_('Dimensions (Panel Mode)'));

        const panelWidthRow = new Adw.SpinRow({
            title: _('Widget Width'),
            subtitle: _('Total horizontal size in pixels'),
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 10 })
        });
        settings.bind('panel-pill-width', panelWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelWidthRow);

        const panelHeightRow = new Adw.SpinRow({
            title: _('Widget Height'),
            subtitle: _('Total vertical size in pixels'),
            adjustment: new Gtk.Adjustment({ lower: 20, upper: 60, step_increment: 2 })
        });
        settings.bind('panel-pill-height', panelHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelHeightRow);

        page.add(panelDimGroup);


        // =========================================
        // 7. SYSTEM & COMPATIBILITY
        // =========================================
        const compatGroup = new Adw.PreferencesGroup();
        compatGroup.set_title(_('System and Compatibility'));

        const fixRow = new Adw.ActionRow({
            title: _('Fix Dock Auto-hide'),
            subtitle: _('WARNING! Use it only if you have problem, keeps a 1px invisible spacer to prevent Dash-to-Dock from collapsing')
        });
        const fixToggle = new Gtk.Switch({
            active: settings.get_boolean('fix-dock-autohide'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('fix-dock-autohide', fixToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        fixRow.add_suffix(fixToggle);
        compatGroup.add(fixRow);

        const gameRow = new Adw.ActionRow({
            title: _('Game Mode'),
            subtitle: _('Disable animations when a fullscreen app is active')
        });
        const gameToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-gamemode'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-gamemode', gameToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        gameRow.add_suffix(gameToggle);
        compatGroup.add(gameRow);

        page.add(compatGroup);


        // =========================================
        // 8. RESET
        // =========================================
        const resetGroup = new Adw.PreferencesGroup();
        resetGroup.set_title(_('Danger Zone'));

        const resetRow = new Adw.ActionRow({
            title: _('Factory Reset'),
            subtitle: _('Reset all configuration options to defaults')
        });
        const resetBtn = new Gtk.Button({
            label: _('Reset All'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action']
        });

        resetBtn.connect('clicked', () => {
            const keys = [
                'scroll-text', 'show-album-art', 'fix-dock-autohide', 'enable-shadow',
                'shadow-blur', 'shadow-opacity', 'pill-width', 'panel-pill-width',
                'pill-height', 'art-size', 'panel-pill-height', 'panel-art-size',
                'vertical-offset', 'horizontal-offset', 'position-mode', 'dock-position',
                'target-container', 'enable-gamemode', 'visualizer-style', 'border-radius',
                'enable-transparency', 'transparency-strength', 'transparency-art',
                'transparency-text', 'transparency-vis'
            ];
            keys.forEach(k => settings.reset(k));

            // Manually refresh non-bound UI elements
            visRow.selected = settings.get_int('visualizer-style');
            modeRow.selected = settings.get_int('position-mode');
            targetRow.selected = settings.get_int('target-container');
            updateGroupVisibility(targetRow.selected);
        });

        resetRow.add_suffix(resetBtn);
        resetGroup.add(resetRow);
        page.add(resetGroup);

        window.add(page);

        // =========================================
        // 9. ABOUT & SUPPORT PAGE
        // =========================================
        const aboutPage = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic'
        });

        const supportGroup = new Adw.PreferencesGroup();
        supportGroup.set_title(_('Support the Project'));

        const kofiRow = new Adw.ActionRow({
            title: _('Support on Ko-fi'),
            subtitle: _('Buy me a coffee on Ko-fi')
        });
        const kofiBtn = new Gtk.Button({ label: 'Open', valign: Gtk.Align.CENTER, css_classes: ['suggested-action'] });
        kofiBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://ko-fi.com/andbal', null));
        kofiRow.add_suffix(kofiBtn);
        supportGroup.add(kofiRow);

        const bmacRow = new Adw.ActionRow({
            title: _('Buy Me a Coffee'),
            subtitle: _('Support via BuyMeACoffee')
        });
        const bmacBtn = new Gtk.Button({ label: 'Open', valign: Gtk.Align.CENTER, css_classes: ['suggested-action'] });
        bmacBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://buymeacoffee.com/andbal', null));
        bmacRow.add_suffix(bmacBtn);
        supportGroup.add(bmacRow);

        const githubRow = new Adw.ActionRow({
            title: _('Source Code'),
            subtitle: _('Report bugs or view source on GitHub')
        });
        const githubBtn = new Gtk.Button({ icon_name: 'external-link-symbolic', valign: Gtk.Align.CENTER });
        githubBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://github.com/Andbal23/dynamic-music-pill', null));
        githubRow.add_suffix(githubBtn);
        supportGroup.add(githubRow);

        aboutPage.add(supportGroup);
        window.add(aboutPage);

        // =========================================
        // LOGIC HANDLERS
        // =========================================
        targetRow.connect('notify::selected', () => {
            let val = targetRow.selected;
            settings.set_int('target-container', val);
            updateGroupVisibility(val);
        });

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
    }
}