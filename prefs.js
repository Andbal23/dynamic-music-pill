import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';

export default class DynamicMusicPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        const PREFS_KEYS = [
            'scroll-text', 'show-album-art', 'enable-shadow', 'hide-default-player',
            'shadow-blur', 'shadow-opacity', 'pill-width', 'panel-pill-width',
            'pill-height', 'panel-pill-height', 'vertical-offset', 'horizontal-offset', 
            'position-mode', 'dock-position', 'target-container', 'enable-gamemode', 
            'visualizer-style', 'border-radius', 'enable-transparency', 'transparency-strength', 
            'transparency-art', 'transparency-text', 'transparency-vis', 'invert-scroll-animation', 
            'enable-scroll-controls', 'action-left-click', 'action-middle-click', 
            'action-right-click', 'action-double-click', 'dock-art-size', 'panel-art-size',          
            'popup-enable-shadow', 'popup-follow-transparency', 'popup-follow-radius', 
            'popup-vinyl-rotate', 'visualizer-padding', 'scroll-action', 'popup-vinyl-square', 
            'popup-show-vinyl', 'show-shuffle-loop', 'use-custom-colors', 'custom-bg-color', 
            'custom-text-color', 'tablet-mode', 'inline-artist', 'pill-dynamic-width', 
            'popup-use-custom-width', 'popup-custom-width', 'player-filter-mode', 'player-filter-list','hide-text',
            'fallback-art-path','popup-show-visualizer', 'popup-hide-pill-visualizer','compatibility-delay',
            'popup-follow-custom-bg', 'popup-follow-custom-text'
        ];

        // =========================================
        // 1. MAIN PILL PAGE (General & Controls)
        // =========================================
        const mainPage = new Adw.PreferencesPage({
            title: _('Main Pill'),
            icon_name: 'preferences-system-symbolic'
        });

        const genGroup = new Adw.PreferencesGroup({ title: _('General Settings') });
        
        // Album Art
        const artRow = new Adw.ActionRow({
            title: _('Show Album Art'),
            subtitle: _('Display the cover art of the currently playing song')
        });
        const artToggle = new Gtk.Switch({
            active: settings.get_boolean('show-album-art'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('show-album-art', artToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        artRow.add_suffix(artToggle);
        genGroup.add(artRow);
        
        const fallbackRow = new Adw.ActionRow({
            title: _('Fallback Album Art'),
            subtitle: settings.get_string('fallback-art-path') || _('No image selected')
        });

        const fallbackBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat']
        });

        fallbackBtn.connect('clicked', () => {
            let dialog = new Gtk.FileDialog({ title: _('Select Fallback Image') });
            
            let filter = new Gtk.FileFilter();
            filter.set_name("Images");
            filter.add_mime_type("image/png");
            filter.add_mime_type("image/jpeg");
            let filterList = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filterList.append(filter);
            dialog.set_filters(filterList);

            dialog.open(null, null, (dlg, res) => {
                try {
                    let file = dlg.open_finish(res);
                    if (file) {
                        let path = file.get_path();
                        settings.set_string('fallback-art-path', path);
                        fallbackRow.subtitle = path;
                    }
                } catch (e) { console.error(e); }
            });
        });

        const clearFallbackBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'error']
        });
        
        clearFallbackBtn.connect('clicked', () => {
            settings.set_string('fallback-art-path', '');
            fallbackRow.subtitle = _('No image selected');
        });

        let btnBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        btnBox.append(fallbackBtn);
        btnBox.append(clearFallbackBtn);
        fallbackRow.add_suffix(btnBox);
        
        settings.bind('show-album-art', fallbackRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);

        genGroup.add(fallbackRow);

        // Scroll Controls
        const scrollCtrlRow = new Adw.ActionRow({
            title: _('Enable Scroll Controls'),
            subtitle: _('Change Tracks or Volume using scroll wheel or touchpad')
        });
        const scrollCtrlToggle = new Gtk.Switch({
            active: settings.get_boolean('enable-scroll-controls'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('enable-scroll-controls', scrollCtrlToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        scrollCtrlRow.add_suffix(scrollCtrlToggle);
        genGroup.add(scrollCtrlRow);

        const scrollActionModel = new Gtk.StringList();
        scrollActionModel.append(_("Change Track"));
        scrollActionModel.append(_("Change Volume"));

        let currentAction = settings.get_string('scroll-action');

        const scrollActionRow = new Adw.ComboRow({
            title: _('Scroll Action'),
            subtitle: _('Choose what scrolling on the pill should do'),
            model: scrollActionModel,
            selected: currentAction === 'volume' ? 1 : 0
        });

        settings.connect('changed::scroll-action', () => {
            const action = settings.get_string('scroll-action');
            scrollActionRow.selected = (action === 'volume') ? 1 : 0;
        });

        scrollActionRow.connect('notify::selected', () => {
            settings.set_string('scroll-action', scrollActionRow.selected === 1 ? 'volume' : 'track');
        });

        settings.bind('enable-scroll-controls', scrollActionRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        genGroup.add(scrollActionRow);

        // Invert Scroll
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

        // Text Scrolling
        const scrollTextRow = new Adw.ActionRow({
            title: _('Scrolling Text'),
            subtitle: _('Animate long track titles and artist names')
        });
        const scrollTextToggle = new Gtk.Switch({
            active: settings.get_boolean('scroll-text'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('scroll-text', scrollTextToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        scrollTextRow.add_suffix(scrollTextToggle);
        genGroup.add(scrollTextRow);
        
        const tabletModeRow = new Adw.ActionRow({ title: _('Tablet Mode'), subtitle: _('Show skip buttons directly on the pill') });
	const tabletModeToggle = new Gtk.Switch({ active: settings.get_boolean('tablet-mode'), valign: Gtk.Align.CENTER });
	settings.bind('tablet-mode', tabletModeToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
	tabletModeRow.add_suffix(tabletModeToggle);
	genGroup.add(tabletModeRow);

	const inlineArtistRow = new Adw.ActionRow({ title: _('Inline Artist'), subtitle: _('Show "Title • Artist" when the widget is squeezed') });
	const inlineArtistToggle = new Gtk.Switch({ active: settings.get_boolean('inline-artist'), valign: Gtk.Align.CENTER });
	settings.bind('inline-artist', inlineArtistToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
	inlineArtistRow.add_suffix(inlineArtistToggle);
	genGroup.add(inlineArtistRow);
	
	const hideTextRow = new Adw.ActionRow({ 
            title: _('Compact Mode (Hide Text)'), 
            subtitle: _('Hide title and artist') 
        });
        const hideTextToggle = new Gtk.Switch({ 
            active: settings.get_boolean('hide-text'), 
            valign: Gtk.Align.CENTER 
        });
        settings.bind('hide-text', hideTextToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        hideTextRow.add_suffix(hideTextToggle);
        genGroup.add(hideTextRow);

        mainPage.add(genGroup);

        // Mouse Actions Group
        const actionGroup = new Adw.PreferencesGroup({ title: _('Mouse Actions') });
        const actionModel = new Gtk.StringList();
        const actionNames = ["Play / Pause", "Next Track", "Previous Track", "Open Player App", "Open Menu"];
        const actionValues = ['play_pause', 'next', 'previous', 'open_app', 'toggle_menu'];
        
        actionNames.forEach(name => actionModel.append(_(name)));

        const leftRow = new Adw.ComboRow({
            title: _('Left Click'),
            model: actionModel,
            selected: actionValues.indexOf(settings.get_string('action-left-click'))
        });
        leftRow.connect('notify::selected', () => { settings.set_string('action-left-click', actionValues[leftRow.selected]); });
        actionGroup.add(leftRow);

        const midRow = new Adw.ComboRow({
            title: _('Middle Click'),
            model: actionModel,
            selected: actionValues.indexOf(settings.get_string('action-middle-click'))
        });
        midRow.connect('notify::selected', () => { settings.set_string('action-middle-click', actionValues[midRow.selected]); });
        actionGroup.add(midRow);

        const rightRow = new Adw.ComboRow({
            title: _('Right Click'),
            model: actionModel,
            selected: actionValues.indexOf(settings.get_string('action-right-click'))
        });
        rightRow.connect('notify::selected', () => { settings.set_string('action-right-click', actionValues[rightRow.selected]); });
        actionGroup.add(rightRow);

        mainPage.add(actionGroup);
        window.add(mainPage);


        // =========================================
        // 2. POP-UP MENU PAGE
        // =========================================
        const popupPage = new Adw.PreferencesPage({
            title: _('Pop-up Menu'),
            icon_name: 'view-more-symbolic'
        });

        const popupGroup = new Adw.PreferencesGroup({ title: _('Pop-up Appearance') });
        const popRotateRow = new Adw.ActionRow({
            title: _('Rotate Vinyl'),
            subtitle: _('Spin the album art when playing')
        });
        const popRotateToggle = new Gtk.Switch({
            active: settings.get_boolean('popup-vinyl-rotate'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('popup-vinyl-rotate', popRotateToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        popRotateRow.add_suffix(popRotateToggle);
        popupGroup.add(popRotateRow);

        const popShadowRow = new Adw.ActionRow({
            title: _('Enable Shadow'),
            subtitle: _('Show drop shadow behind the pop-up menu')
        });
        const popShadowToggle = new Gtk.Switch({
            active: settings.get_boolean('popup-enable-shadow'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('popup-enable-shadow', popShadowToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        popShadowRow.add_suffix(popShadowToggle);
        popupGroup.add(popShadowRow);
        
        const popCustomBgRow = new Adw.ActionRow({
            title: _('Follow Custom Background Color'),
            subtitle: _('Use the custom background color for the pop-up (if active)')
        });
        const popCustomBgToggle = new Gtk.Switch({ active: settings.get_boolean('popup-follow-custom-bg'), valign: Gtk.Align.CENTER });
        settings.bind('popup-follow-custom-bg', popCustomBgToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('use-custom-colors', popCustomBgRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        popCustomBgRow.add_suffix(popCustomBgToggle);
        popupGroup.add(popCustomBgRow);

        const popCustomTextRow = new Adw.ActionRow({
            title: _('Follow Custom Text Color'),
            subtitle: _('Use the custom text color for the pop-up (if active)')
        });
        const popCustomTextToggle = new Gtk.Switch({ active: settings.get_boolean('popup-follow-custom-text'), valign: Gtk.Align.CENTER });
        settings.bind('popup-follow-custom-text', popCustomTextToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('use-custom-colors', popCustomTextRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        popCustomTextRow.add_suffix(popCustomTextToggle);
        popupGroup.add(popCustomTextRow);

        const popTransRow = new Adw.ActionRow({
            title: _('Follow Transparency'),
            subtitle: _('Inherit opacity settings from the main pill')
        });
        const popTransToggle = new Gtk.Switch({
            active: settings.get_boolean('popup-follow-transparency'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('popup-follow-transparency', popTransToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        popTransRow.add_suffix(popTransToggle);
        popupGroup.add(popTransRow);

        const popRadRow = new Adw.ActionRow({
            title: _('Follow Border Radius'),
            subtitle: _('Inherit corner roundness from the main pill')
        });
        const popRadToggle = new Gtk.Switch({
            active: settings.get_boolean('popup-follow-radius'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('popup-follow-radius', popRadToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        popRadRow.add_suffix(popRadToggle);
        popupGroup.add(popRadRow);
        const popShowRow = new Adw.ActionRow({ title: _('Show Vinyl'), subtitle: _('Display the album art in the pop-up') });
	const popShowToggle = new Gtk.Switch({ active: settings.get_boolean('popup-show-vinyl'), valign: Gtk.Align.CENTER });
	settings.bind('popup-show-vinyl', popShowToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
	popShowRow.add_suffix(popShowToggle);
	popupGroup.add(popShowRow);

	const popSquareRow = new Adw.ActionRow({ title: _('Square Vinyl Image'), subtitle: _('Use a square album art (disables rotation)') });
	const popSquareToggle = new Gtk.Switch({ active: settings.get_boolean('popup-vinyl-square'), valign: Gtk.Align.CENTER });
	settings.bind('popup-vinyl-square', popSquareToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
	popSquareRow.add_suffix(popSquareToggle);
	popupGroup.add(popSquareRow);

	const showShuffleRow = new Adw.ActionRow({ title: _('Show Shuffle and Loop'), subtitle: _('Display extra controls in the pop-up') });
	const showShuffleToggle = new Gtk.Switch({ active: settings.get_boolean('show-shuffle-loop'), valign: Gtk.Align.CENTER });
	settings.bind('show-shuffle-loop', showShuffleToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
	showShuffleRow.add_suffix(showShuffleToggle);
	popupGroup.add(showShuffleRow);
	
	const popUseCustomRow = new Adw.ActionRow({ title: _('Use Custom Width'), subtitle: _('Disable dynamic sizing for the pop-up') });
        const popUseCustomToggle = new Gtk.Switch({ active: settings.get_boolean('popup-use-custom-width'), valign: Gtk.Align.CENTER });
        settings.bind('popup-use-custom-width', popUseCustomToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        popUseCustomRow.add_suffix(popUseCustomToggle);
        popupGroup.add(popUseCustomRow);
        
        const popCustomWidthRow = new Adw.SpinRow({
            title: _('Custom Width Value'),
            adjustment: new Gtk.Adjustment({ lower: 260, upper: 800, step_increment: 10 })
        });

        const updateWidthBound = () => {
            let limit = settings.get_boolean('show-shuffle-loop') ? 360 : 260;
            popCustomWidthRow.adjustment.lower = limit;
            
            if (settings.get_int('popup-custom-width') < limit) {
                settings.set_int('popup-custom-width', limit);
            }
        };
        settings.connect('changed::show-shuffle-loop', updateWidthBound);
        updateWidthBound();

        settings.bind('popup-custom-width', popCustomWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('popup-use-custom-width', popCustomWidthRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        popupGroup.add(popCustomWidthRow);
        
        const popVisRow = new Adw.ActionRow({ title: _('Show Visualizer in Pop-up') });
        const popVisToggle = new Gtk.Switch({ active: settings.get_boolean('popup-show-visualizer'), valign: Gtk.Align.CENTER });
        settings.bind('popup-show-visualizer', popVisToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        popVisRow.add_suffix(popVisToggle);
        popupGroup.add(popVisRow);

        const hidePillVisRow = new Adw.ActionRow({ 
            title: _('Hide Pill Visualizer'), 
            subtitle: _('Creates a "moving" effect by hiding the main pill visualizer') 
        });
        const hidePillVisToggle = new Gtk.Switch({ active: settings.get_boolean('popup-hide-pill-visualizer'), valign: Gtk.Align.CENTER });
        settings.bind('popup-hide-pill-visualizer', hidePillVisToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        hidePillVisRow.add_suffix(hidePillVisToggle);
        settings.bind('popup-show-visualizer', hidePillVisRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        popupGroup.add(hidePillVisRow);

        
        popupPage.add(popupGroup);
        window.add(popupPage);


        // =========================================
        // 3. STYLE & LAYOUT PAGE
        // =========================================
        const stylePage = new Adw.PreferencesPage({
            title: _('Style & Layout'),
            icon_name: 'applications-graphics-symbolic'
        });

        const lookGroup = new Adw.PreferencesGroup({ title: _('Visualizer and Shape') });
        
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
        lookGroup.add(visRow);
        const visPaddingRow = new Adw.SpinRow({
            title: _('Visualizer Margin'),
            subtitle: _('Distance between the text and the wave animation'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 1 })
        });
        settings.bind('visualizer-padding', visPaddingRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        lookGroup.add(visPaddingRow);

        const radiusRow = new Adw.SpinRow({
            title: _('Corner Radius'),
            subtitle: _('Roundness of the widget edges (0 = Square, 25 = Pill)'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 1 })
        });
        settings.bind('border-radius', radiusRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        lookGroup.add(radiusRow);
        stylePage.add(lookGroup);

        const transGroup = new Adw.PreferencesGroup({ title: _('Background and Transparency') });
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

        const opacityRow = new Adw.SpinRow({
            title: _('Background Opacity'),
            subtitle: _('Adjust transparency level'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5 })
        });
        settings.bind('transparency-strength', opacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', opacityRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transGroup.add(opacityRow);

        const transArtRow = new Adw.ActionRow({ title: _('Apply to Album Art') });
        const transArtToggle = new Gtk.Switch({ active: settings.get_boolean('transparency-art'), valign: Gtk.Align.CENTER });
        settings.bind('transparency-art', transArtToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', transArtRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transArtRow.add_suffix(transArtToggle);
        transGroup.add(transArtRow);

        const transTextRow = new Adw.ActionRow({ title: _('Apply to Text') });
        const transTextToggle = new Gtk.Switch({ active: settings.get_boolean('transparency-text'), valign: Gtk.Align.CENTER });
        settings.bind('transparency-text', transTextToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', transTextRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transTextRow.add_suffix(transTextToggle);
        transGroup.add(transTextRow);

        const transVisRow = new Adw.ActionRow({ title: _('Apply to Visualizer') });
        const transVisToggle = new Gtk.Switch({ active: settings.get_boolean('transparency-vis'), valign: Gtk.Align.CENTER });
        settings.bind('transparency-vis', transVisToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        settings.bind('enable-transparency', transVisRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        transVisRow.add_suffix(transVisToggle);
        transGroup.add(transVisRow);
        stylePage.add(transGroup);

        const shadowGroup = new Adw.PreferencesGroup({ title: _('Main Pill Shadow') });
        const shadowRow = new Adw.ActionRow({ title: _('Enable Shadow') });
        const shadowToggle = new Gtk.Switch({ active: settings.get_boolean('enable-shadow'), valign: Gtk.Align.CENTER });
        settings.bind('enable-shadow', shadowToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        shadowRow.add_suffix(shadowToggle);
        shadowGroup.add(shadowRow);

        const shadowOpacityRow = new Adw.SpinRow({
            title: _('Shadow Intensity'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 100, step_increment: 5 })
        });
        settings.bind('shadow-opacity', shadowOpacityRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(shadowOpacityRow);

        const shadowBlurRow = new Adw.SpinRow({
            title: _('Shadow Blur'),
            adjustment: new Gtk.Adjustment({ lower: 0, upper: 50, step_increment: 1 })
        });
        settings.bind('shadow-blur', shadowBlurRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        shadowGroup.add(shadowBlurRow);
        stylePage.add(shadowGroup);

        const posGroup = new Adw.PreferencesGroup({ title: _('Positioning') });
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
        targetRow.connect('notify::selected', () => {
            let val = targetRow.selected;
            settings.set_int('target-container', val);
            updateGroupVisibility(val);
        });
        posGroup.add(targetRow);
        
        const dynWidthRow = new Adw.ActionRow({ title: _('Dynamic Width'), subtitle: _('Auto-adjust pill width (slider acts as max width)') });
        const dynWidthToggle = new Gtk.Switch({ active: settings.get_boolean('pill-dynamic-width'), valign: Gtk.Align.CENTER });
        settings.bind('pill-dynamic-width', dynWidthToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        dynWidthRow.add_suffix(dynWidthToggle);
        posGroup.add(dynWidthRow);
        
        settings.connect('changed::target-container', () => {
            let val = settings.get_int('target-container');
            if (targetRow.selected !== val) {
                targetRow.selected = val;
            }
            updateGroupVisibility(val);
        });

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

        const dockDimGroup = new Adw.PreferencesGroup({ title: _('Dimensions (Dock Mode)') });
        const dockArtSizeRow = new Adw.SpinRow({
            title: _('Album Art Size'),
            adjustment: new Gtk.Adjustment({ lower: 16, upper: 48, step_increment: 1 })
        });
        settings.bind('dock-art-size', dockArtSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockArtSizeRow);
        const dockWidthRow = new Adw.SpinRow({
            title: _('Widget Width'),
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 10 })
        });
        settings.bind('pill-width', dockWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockWidthRow);

        const dockHeightRow = new Adw.SpinRow({
            title: _('Widget Height'),
            adjustment: new Gtk.Adjustment({ lower: 32, upper: 100, step_increment: 4 })
        });
        settings.bind('pill-height', dockHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        dockDimGroup.add(dockHeightRow);
        posGroup.add(dockDimGroup);

        const panelDimGroup = new Adw.PreferencesGroup({ title: _('Dimensions (Panel Mode)') });
        const panelArtSizeRow = new Adw.SpinRow({
            title: _('Album Art Size'),
            adjustment: new Gtk.Adjustment({ lower: 14, upper: 32, step_increment: 1 })
        });
        settings.bind('panel-art-size', panelArtSizeRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelArtSizeRow);
        const panelWidthRow = new Adw.SpinRow({
            title: _('Widget Width'),
            adjustment: new Gtk.Adjustment({ lower: 100, upper: 600, step_increment: 10 })
        });
        settings.bind('panel-pill-width', panelWidthRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelWidthRow);

        const panelHeightRow = new Adw.SpinRow({
            title: _('Widget Height'),
            adjustment: new Gtk.Adjustment({ lower: 20, upper: 60, step_increment: 2 })
        });
        settings.bind('panel-pill-height', panelHeightRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        panelDimGroup.add(panelHeightRow);
        posGroup.add(panelDimGroup);
        const colorGroup = new Adw.PreferencesGroup({ title: _('Custom Colors') });
        const customColorRow = new Adw.ActionRow({ title: _('Use Custom Colors'), subtitle: _('Override dynamic colors') });
        const customColorToggle = new Gtk.Switch({ active: settings.get_boolean('use-custom-colors'), valign: Gtk.Align.CENTER });
        settings.bind('use-custom-colors', customColorToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        customColorRow.add_suffix(customColorToggle);
        colorGroup.add(customColorRow);

        function createColorButtonRow(title, settingKey) {
            const row = new Adw.ActionRow({ title: title });
            let cStr = settings.get_string(settingKey).split(',');
            let c = new Gdk.RGBA();
            c.parse(`rgb(${cStr[0] || 40},${cStr[1] || 40},${cStr[2] || 40})`);
            
            const btn = new Gtk.ColorButton({ rgba: c, use_alpha: false, valign: Gtk.Align.CENTER });
            btn.connect('color-set', () => {
                let rgba = btn.get_rgba();
                settings.set_string(settingKey, `${Math.round(rgba.red * 255)},${Math.round(rgba.green * 255)},${Math.round(rgba.blue * 255)}`);
            });
            settings.connect(`changed::${settingKey}`, () => {
                let parts = settings.get_string(settingKey).split(',');
                let newC = new Gdk.RGBA();
                newC.parse(`rgb(${parts[0]},${parts[1]},${parts[2]})`);
                btn.set_rgba(newC);
            });
            
            settings.bind('use-custom-colors', btn, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
            row.add_suffix(btn);
            return row;
        }

        colorGroup.add(createColorButtonRow(_('Background Color'), 'custom-bg-color'));
        colorGroup.add(createColorButtonRow(_('Text Color'), 'custom-text-color'));

        stylePage.add(colorGroup);

        stylePage.add(posGroup);
        window.add(stylePage);

        // =========================================
        // 4. SYSTEM & RESET PAGE
        // =========================================
        const otherPage = new Adw.PreferencesPage({
            title: _('System & Reset'),
            icon_name: 'utilities-terminal-symbolic'
        });
        
        const compatGroup = new Adw.PreferencesGroup({ title: _('System') });
        
        const hidePlayerRow = new Adw.ActionRow({
            title: _('Hide Default GNOME Player'),
            subtitle: _('Remove the duplicate built-in media controls')
        });
        const hidePlayerToggle = new Gtk.Switch({
            active: settings.get_boolean('hide-default-player'),
            valign: Gtk.Align.CENTER
        });
        settings.bind('hide-default-player', hidePlayerToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        hidePlayerRow.add_suffix(hidePlayerToggle);
        compatGroup.add(hidePlayerRow);

        const gameRow = new Adw.ActionRow({ title: _('Game Mode'), subtitle: _('Disable animations when a fullscreen app is active') });
        const gameToggle = new Gtk.Switch({ active: settings.get_boolean('enable-gamemode'), valign: Gtk.Align.CENTER });
        settings.bind('enable-gamemode', gameToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        gameRow.add_suffix(gameToggle);
        compatGroup.add(gameRow);
        
        const compatDelayRow = new Adw.ActionRow({ 
            title: _('Slow Player Workaround'), 
            subtitle: _('Adds a slight delay to track changes (fixes sync issues)') 
        });
        const compatDelayToggle = new Gtk.Switch({ active: settings.get_boolean('compatibility-delay'), valign: Gtk.Align.CENTER });
        settings.bind('compatibility-delay', compatDelayToggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        compatDelayRow.add_suffix(compatDelayToggle);
        compatGroup.add(compatDelayRow);
        
        const filterModel = new Gtk.StringList();
        filterModel.append(_("Off (Allow All)"));
        filterModel.append(_("Blacklist (Exclude listed)"));
        filterModel.append(_("Whitelist (Only allow listed)"));

        const filterModeRow = new Adw.ComboRow({
            title: _('Player Filter Mode'),
            subtitle: _('Choose how to filter media players (e.g. browsers)'),
            model: filterModel,
            selected: settings.get_int('player-filter-mode')
        });
        
        filterModeRow.connect('notify::selected', () => {
            settings.set_int('player-filter-mode', filterModeRow.selected);
        });
        compatGroup.add(filterModeRow);

        const filterListRow = new Adw.EntryRow({
            title: _('Filtered Players (comma separated)'),
            text: settings.get_string('player-filter-list')
        });
        
        settings.bind('player-filter-list', filterListRow, 'text', Gio.SettingsBindFlags.DEFAULT);

        const updateFilterState = () => {
            filterListRow.set_sensitive(settings.get_int('player-filter-mode') !== 0);
        };
        settings.connect('changed::player-filter-mode', updateFilterState);
        updateFilterState();

        compatGroup.add(filterListRow);
        const detectedPlayersRow = new Adw.ActionRow({
            title: _('Detected Players'),
            subtitle: _('Click an active player to add it to the filter list')
        });

        const refreshBtn = new Gtk.Button({ 
            icon_name: 'view-refresh-symbolic', 
            valign: Gtk.Align.CENTER, 
            margin_end: 10,
            css_classes: ['flat']
        });
        detectedPlayersRow.add_prefix(refreshBtn);

        const playerBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        detectedPlayersRow.add_suffix(playerBox);

        const updateDetected = () => {
            let child = playerBox.get_first_child();
            while (child) {
                let next = child.get_next_sibling();
                playerBox.remove(child);
                child = next;
            }

            let connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
            connection.call(
                'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
                null, null, Gio.DBusCallFlags.NONE, -1, null,
                (c, res) => {
                    try {
                        let r = c.call_finish(res);
                        let names = r.deep_unpack()[0];
                        let mpris = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
                        
                        let apps = [...new Set(mpris.map(n => n.replace('org.mpris.MediaPlayer2.', '').split('.')[0]))];
                        
                        if (apps.length === 0) {
                            playerBox.append(new Gtk.Label({ label: _('No players found') }));
                        } else {
                            apps.forEach(app => {
                                let btn = new Gtk.Button({ label: app, css_classes: ['suggested-action'] });
                                btn.connect('clicked', () => {
                                    let current = settings.get_string('player-filter-list');
                                    let list = current.split(',').map(s => s.trim()).filter(s => s.length > 0);
                                    if (!list.includes(app)) {
                                        list.push(app);
                                        settings.set_string('player-filter-list', list.join(', '));
                                    }
                                });
                                playerBox.append(btn);
                            });
                        }
                    } catch(e) {}
                }
            );
        };

        refreshBtn.connect('clicked', updateDetected);
        updateDetected();

        const updateDetectedState = () => {
            detectedPlayersRow.set_sensitive(settings.get_int('player-filter-mode') !== 0);
        };
        settings.connect('changed::player-filter-mode', updateDetectedState);
        updateDetectedState();

        compatGroup.add(detectedPlayersRow);
        otherPage.add(compatGroup);

        const backupGroup = new Adw.PreferencesGroup({ title: _('Backup & Restore') });
        
        // EXPORT
        const exportRow = new Adw.ActionRow({ title: _('Export Settings') });
        const exportBtn = new Gtk.Button({ label: _('Export'), valign: Gtk.Align.CENTER });
        exportBtn.connect('clicked', () => {
            let data = {};
            PREFS_KEYS.forEach(k => { data[k] = settings.get_value(k).deep_unpack(); });
            let dialog = new Gtk.FileDialog({ title: _('Save Settings'), initial_name: 'music-pill-backup.json' });
            dialog.save(null, null, (dlg, res) => {
                try {
                    let file = dlg.save_finish(res);
                    if (file) {
                        let bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(data, null, 2)));
                        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, null);
                    }
                } catch (e) { console.error(e); }
            });
        });
        exportRow.add_suffix(exportBtn);
        backupGroup.add(exportRow);

        // IMPORT
        const importRow = new Adw.ActionRow({ title: _('Import Settings') });
        const importBtn = new Gtk.Button({ label: _('Import'), valign: Gtk.Align.CENTER });
        importBtn.connect('clicked', () => {
            let dialog = new Gtk.FileDialog({ title: _('Open Settings Backup') });
            dialog.open(null, null, (dlg, res) => {
                try {
                    let file = dlg.open_finish(res);
                    if (file) {
                        file.load_contents_async(null, (f, r) => {
                            try {
                                let [ok, contents] = f.load_contents_finish(r);
                                if (ok) {
                                    let data = JSON.parse(new TextDecoder().decode(contents));
                                    PREFS_KEYS.forEach(k => {
                                        if (data[k] !== undefined) {
                                            let type = settings.get_default_value(k).get_type_string();
                                            settings.set_value(k, new GLib.Variant(type, data[k]));
                                        }
                                    });
                                }
                            } catch (e) { console.error(e); }
                        });
                    }
                } catch (e) { console.error(e); }
            });
        });
        importRow.add_suffix(importBtn);
        backupGroup.add(importRow);
        otherPage.add(backupGroup);

        const resetGroup = new Adw.PreferencesGroup({ title: _('Danger Zone') });
        const resetBtn = new Gtk.Button({ label: _('Reset All'), valign: Gtk.Align.CENTER, css_classes: ['destructive-action'] });
        resetBtn.connect('clicked', () => { PREFS_KEYS.forEach(k => settings.reset(k)); });
        const resetRow = new Adw.ActionRow({ title: _('Factory Reset') });
        resetRow.add_suffix(resetBtn);
        resetGroup.add(resetRow);
        otherPage.add(resetGroup);

        window.add(otherPage);

        // =========================================
        // 5. ABOUT PAGE
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
