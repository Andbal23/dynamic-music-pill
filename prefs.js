import { ExtensionPreferences, gettext as _ } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';

const PREFS_KEYS = [
    'scroll-text', 'scroll-on-hover-only', 'freeze-scroll-on-pause', 'show-album-art', 'enable-shadow', 'hide-default-player',
    'shadow-blur', 'shadow-opacity', 'pill-width', 'panel-pill-width',
    'pill-height', 'panel-pill-height', 'vertical-offset', 'horizontal-offset',
    'position-mode', 'dock-position', 'target-container', 'dock-monitors', 'enable-gamemode',
    'visualizer-style', 'border-radius', 'enable-transparency', 'transparency-strength',
    'transparency-art', 'transparency-text', 'transparency-vis', 'enable-scroll-animation', 'invert-scroll-animation',
    'enable-scroll-controls', 'action-left-click', 'action-middle-click',
    'action-right-click', 'action-double-click', 'dock-art-size', 'panel-art-size',
    'popup-enable-shadow', 'popup-follow-transparency', 'popup-follow-radius',
    'popup-vinyl-rotate', 'visualizer-padding', 'scroll-action', 'volume-scroll-target', 'popup-vinyl-square', 'popup-vinyl-shadow',
    'popup-show-vinyl', 'show-shuffle-loop', 'use-custom-colors', 'custom-bg-color',
    'custom-text-color', 'custom-vis-color', 'tablet-mode', 'pill-controls-position', 'inline-artist', 'show-artist', 'pill-dynamic-width',
    'popup-use-custom-width', 'popup-custom-width', 'player-filter-mode', 'player-filter-list', 'hide-text',
    'fallback-art-path', 'popup-show-visualizer', 'popup-hide-pill-visualizer', 'compatibility-delay',
    'popup-follow-custom-bg', 'popup-follow-custom-text', 'action-hover', 'hover-delay', 'selected-player-bus',
    'popup-show-player-selector', 'hide-auto-smart-selection', 'popup-player-selector-position', 'show-pill-border', 'invert-scroll-direction', 'always-show-pill', 'popup-hide-on-leave',
    'visualizer-bars', 'enable-lyrics', 'pill-enable-word-level', 'lyrics-language-preference', 'app-name-mapping', 'lyric-fade-enable', 'lyric-fade-duration', 'visualizer-bar-width', 'visualizer-height',
    'popup-visualizer-bars', 'popup-visualizer-bar-width', 'popup-visualizer-height', 'edge-margin', 'popup-vinyl-speed', 'sync-accent-color',
    'enable-custom-buttons', 'custom-button-1', 'custom-button-2', 'playback-history', 'has-seen-first-hint',
    'show-hours-format', 'popup-show-album-title',
    'enable-blur-pill', 'enable-blur-popup', 'blur-blend-color', 'blur-sigma', 'light-mode',
    'bms-follow-pipeline',
];

const CHANGELOG_ENTRIES = [
    {
        version: '1.5.1',
        subtitle: 'Blur my Shell v76+ Pipeline Integration, Allocation Fix & Smooth Text Fade',
        expanded: true,
        notes: 'Improvements & Fixes:\n' +
            '• Blur my Shell v76+ Native Pipeline Integration: Full native support for Blur my Shell\'s modern Dual Kawase DynamicPipeline backend — no gnome-rounded-blur dependency required on modern BMS versions.\n' +
            '• Multi-Tier Blur Fallbacks: Automatic seamless 3-tier fallback architecture (BMS Dynamic Pipeline -> BMS + gnome-rounded-blur -> graceful fallback).\n' +
            '• Pipeline Following Option: New toggle to inherit Blur my Shell\'s exact configured blur pipelines, effects, and brightness for the panel pill and pop-up.\n' +
            '• Fixed Stage View Allocation Log Warnings: Eliminated \'needs an allocation\' log warnings during track transitions and pop-up open/close animations.\n' +
            '• Smoother Text Fade on Track Skip: Restored and tuned the song title & artist fade transition on track changes with a refined 600ms animation.\n' +
            '• Pop-up Stability & Skip Positioning Fix: Eliminated jitter, tremble, and unwanted horizontal repositioning when skipping tracks directly from the expanded pop-up player.',
    },
    {
        version: '1.5.0',
        subtitle: 'Dynamic Blur, Light Mode, Multi-Monitor & Simple Taskbar Support, Lyrics & UI Fixes',
        expanded: false,
        notes: 'New Features:\n' +
            '• Dynamic Gaussian Blur: Native Wayland blur behind the pill and pop-up via Blur my Shell & gnome-rounded-blur, with adjustable Blur Radius (Sigma) and Album Art Color tinting.\n' +
            '• Light Mode (#173): Bright pastel dynamic palette and frosted light glass with dark text and icons.\n' +
            '• Multi-Monitor Docks (#171) & Simple Taskbar Support (#172): Choose whether the pill appears on Main, All, or Secondary docks, plus full support for Simple Taskbar (simple-taskbar@sultech) dock placement.\n' +
            '• Custom Visualizer Color (#159): Independent custom color picker for the audio visualizer bars.\n' +
            '• Apple Music Lyrics Provider (#174): Replaced NetEase with Apple Music word-level karaoke provider and improved Firefox / YouTube / YouTube Music lyrics search & fallbacks.\n' +
            '• Scroll Animation Toggle & Player Minimize Toggle: Option to toggle the scroll jump animation, and clicking \'Open Player App\' now toggles minimize/restore when the player is already focused.\n\n' +
            'Bug Fixes:\n' +
            '• Eliminated pop-up open/close flicker and added smooth directional pivot animations.\n' +
            '• Fixed volume scroll feedback bar overflowing or jittering between 99% and 100% on short pills.\n' +
            '• Fixed dock/taskbar autohide while the expanded player pop-up or player selector is open, and hardened dock integration with safe fallback orientation.\n\n' +
            'Translations:\n' +
            '• Updated and compiled translations across all 18 supported languages (#170, #175).',
    },
    {
        version: '1.4.0',
        subtitle: 'GNOME 51 support',
        expanded: false,
        notes: 'New Features:\n' +
            '• GNOME 51 support\n' +
            '• Updated translations for all supported languages via Weblate.',
    },
    {
        version: '1.3.0',
        subtitle: 'Multi-Provider Word-Level Karaoke, Volume Scroll Fix & Shadow Customization',
        expanded: false,
        notes: 'New Features:\n' +
            '• Multi-Provider Word-Level Karaoke Lyrics: Integrated BetterLyrics and BiniLyrics API providers with TTML XML parsing.\n' +
            '• Spotify-Style Pop-up Karaoke: Real-time word-by-word karaoke highlighting with crisp 100% white bold sung words and active line scaling.\n' +
            '• Pill Word-Level Karaoke: Real-time stationary word-level karaoke highlighting in the main Pill, with a dedicated \'Word-level Karaoke in Pill\' toggle in Preferences.\n' +
            '• Volume Scroll Target Selector (#148): Added a setting to choose between controlling System Master Volume or Active Media App Volume when scrolling on the pill.\n' +
            '• Album Art Shadow Customization (#149): Added setting to show/hide the drop shadow behind the album art in the pop-up menu.\n' +
            '• LRCLib Cloudflare Fix: Custom User-Agent on lyrics requests to bypass HTTP 403 blocks.\n\n' +
            'Bug Fixes:\n' +
            '• Fixed Volume Scrolling (#148): Fixed stream.change_volume() Gvc method invocation for PulseAudio/Pipewire volume scrolling.\n' +
            '• Fixed Missing Album Art Shadow Blob: Immediately hide vinyl container and drop shadow when album art is unavailable (e.g. YouTube videos without thumbnails) to prevent layout shifts and dark shadow artifacts.\n' +
            '• Fixed pop-up play/pause button icon and player controls state when album art is disabled.\n' +
            '• Fixed empty shadow box and pop-up layout shift when turning off album art.\n' +
            '• Fixed seeker progress bar jumping to 0:00 when seeking with album art disabled.\n\n' +
            'Translations:\n' +
            '• Recompiled and updated all translation locales (.po / .mo) via Weblate.',
    },
    {
        version: '1.2.1',
        subtitle: 'Translation Updates',
        expanded: false,
        notes: 'Translations:\n' +
            '• Updated translations for all supported languages via Weblate.',
    },
    {
        version: '1.2.0',
        subtitle: 'New features & Bug Fixes',
        expanded: false,
        notes: 'New Features:\n' +
            '• Added a new toggle \'Show artist\'.\n' +
            '• Tablet mode buttons, new positions.\n' +
            '• Option to move the "media source" buttons to other placement.\n' +
            '• Add toggle to hide Auto (Smart Selection).\n' +
            '• Parallelize lyric fetching requests.\n' +
            '• Translations update.\n' +
            '• Add option to pause text scrolling when player is paused.\n\n' +
            'Bug Fixes:\n' +
            '• Artist name is cropped away in panel mode.\n' +
            '• The artist name and song title do not display correctly in the widget every time it starts up.',
    },
    {
        version: '1.1.0',
        subtitle: 'Custom Buttons & Bug Fixes',
        expanded: false,
        notes: 'New Features:\n' +
            '• Add a \'Scroll Action\' mode to fast-forward.\n' +
            '• Per-App Volume Control.\n' +
            '• Resotre original GNOME accent color after player is closed.\n\n' +
            'Bug Fixes:\n' +
            '• Lyrics view crash fix.\n' +
            '• Telegram crash fix.',
    },
    {
        version: '1.0.0',
        subtitle: 'Custom Buttons & Bug Fixes',
        expanded: false,
        notes: 'New Features:\n' +
            '• Custom Control Buttons: Add up to two extra buttons to the pop-up controls row. Each can be assigned to Volume, Seek Step, Audio Output, Sleep Timer, Playback Speed, or Recently Played history.\n' +
            '• First-Time Hint: A one-time tip in the pop-up suggests checking settings for more options (custom buttons, scroll actions, etc.). Dismissible with a click or via the settings button.\n' +
            '• Scroll on Hover Only: A new setting to scroll long text only when hovering over the pill.\n\n' +
            'Bug Fixes:\n' +
            '• Fixed GNOME Shell freezes (metadata crash) when player state unexpectedly becomes undefined.\n' +
            '• Fixed History showing incorrect album art for slow players (Zen Browser/Web apps) and prevents rapid-skip duplicates.\n' +
            '• Fixed Dash to Dock autohide breaking after locking and unlocking the screen.\n' +
            '• Fixed two pills appearing in the dock (could occur unreliably after Lock and Unlock).\n' +
            '• Fixed duplicate title and artist display.\n' +
            '• Fixed visualizer failing to update when transitioning between pill and pop-up with Dash to Dock.\n' +
            '• Fixed history scroll area being covered and unclickable (switched to non-overlay scrollbars).\n' +
            '• Fixed first-time hint buttons (Settings, X) not responding to clicks.',
    },
    {
        version: 'V29',
        subtitle: 'Real-Time Visualizer, App Mapping & Major Fixes',
        expanded: false,
        notes: 'New Features:\n' +
            '• Real-Time Visualizer: Added CAVA-powered real-time audio visualizer!\n' +
            '• Accent Color Sync: Dynamically change the GNOME accent color to match the current album art.\n' +
            '• Manual App Mapping: Added a new settings page to manually map unrecognized App IDs (fixes Open/Close app actions).\n' +
            '• Translations: Implemented multi-language support! Contributions to complete missing languages are welcome on GitHub.\n' +
            '• Shared Engine: Implemented a shared visualizer engine for better performance (paving the way for simultaneous Dash & Top Panel placement).\n' +
            '• Implemented cache system for better performance.\n\n' +
            'Customization & Enhancements:\n' +
            '• Advanced Visualizer:Deep customization options added (bar count, width, height, margin, and border radius).\n' +
            '• Smooth Fading: Added adjustable fade-in/out transitions for Lyrics and edge-fading for scrolling text.\n' +
            '• Touch & Tablet: Added a dedicated Play/Pause button in Tablet Mode and implemented proper touchscreen target controls.\n' +
            '• Pop-up Tweaks: Adjustable Vinyl rotation speed and a new option to auto-hide the pop-up on mouse leave/hover.\n' +
            '• Added dynamic width with crossfade and a new \'Outer Edge Margin\' setting.\n\n' +
            'Bug Fixes:\n' +
            '• Fixed blurry album art, text, and numbers inside the pop-up menu.\n' +
            '• Fixed background color not updating properly to reflect the album artwork.\n' +
            '• Fixed an issue where selecting a non-playing player caused the pill to hide and break the player selector.\n' +
            '• Fixed Spotify window failing to close properly.\n' +
            '• Fixed a bug where the microphone would activate when the CAVA visualizer was enabled.\n' +
            '• Fixed floating menu alignment issues when using Dash to Dock.\n' +
            '• Fixed Dash to Dock aligment when tried to change an icon position.\n' +
            '• Fixed and issue with Strawberry player where the art image didn\'t loaded.',
    },
    {
        version: 'V27',
        subtitle: 'Small Features and Fixes',
        expanded: false,
        notes: '• Added Double Click Mouse Actin\n' +
            '• Added Always ON mode\n' +
            '• Fixed an issue where the seek bar become glitchy\n' +
            '• Fixed a huge CPU drain with dash to dock autohide mode',
    },
    {
        version: 'V26',
        subtitle: 'Dynamic Contrast & Readability Improvements',
        expanded: false,
        notes: '• Added dynamic contrast: Popup text and buttons now automatically turn dark on light album arts for perfect readability\n' +
            '• The Player Selector menu now correctly follows your Custom Color settings\n' +
            '• Dynamic contrast is also applied to the Player Selector menu\n' +
            '• Improved Player Selector: Added smart DBus logic to accurately detect and display media player names and icons\n' +
            '• Fixed an issue where the popup menu would jump or resize incorrectly when Custom Width was enabled',
    },
    {
        version: 'V25',
        subtitle: 'Ubuntu Dock Support, UI Fixes & Stability',
        expanded: false,
        notes: '• Added automatic vertical mode for side panels (e.g., Ubuntu Dock)\n' +
            '• Fixed an issue where the pill disappeared when moving the dock\n' +
            '• Improved seeker sync when changing tracks\n' +
            '• New toggle for Outline Border for the Main Pill, now you can disable it\n' +
            '• Fixed the pill hitbox',
    },
    {
        version: 'V21-V23',
        subtitle: 'Custom Colors & Player Selector',
        expanded: false,
        notes: '• Added custom text and background color options\n' +
            '• New Player Selector\n' +
            '• New Invert Scrolling Toggle\n' +
            '• New Mouse Action (Hover)\n' +
            '• Bugfixes and performance improvements',
    },
];

export default class DynamicMusicPrefs extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        window.search_enabled = true;
        window.set_default_size(720, 780);
        const settings = this.getSettings();

        this._buildPillPage(window, settings);
        this._buildPopupPage(window, settings);
        this._buildControlsPage(window, settings);
        this._buildLyricsPage(window, settings);
        this._buildStylePage(window, settings);
        this._buildSystemPage(window, settings);
        this._buildAboutPage(window);
    }

    // =========================================================================
    // UI HELPER METHODS
    // =========================================================================

    _escapeMarkup(text) {
        if (!text) return '';
        return GLib.markup_escape_text(text, -1);
    }

    _addRowIcon(row, iconName) {
        if (!iconName) return;
        row.add_prefix(new Gtk.Image({
            icon_name: iconName,
            valign: Gtk.Align.CENTER,
        }));
    }

    _createSwitchRow(settings, { key, title, subtitle = null, icon = null, sensitiveKey = null }) {
        const props = { title: this._escapeMarkup(title) };
        if (subtitle) props.subtitle = this._escapeMarkup(subtitle);
        const row = new Adw.ActionRow(props);
        this._addRowIcon(row, icon);

        const toggle = new Gtk.Switch({
            active: settings.get_boolean(key),
            valign: Gtk.Align.CENTER,
        });
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        row.add_suffix(toggle);
        row.activatable_widget = toggle;

        if (sensitiveKey) {
            settings.bind(sensitiveKey, row, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        }

        return { row, toggle };
    }

    _createExpanderSwitchRow(settings, { key, title, subtitle = null, icon = null }) {
        const isActive = settings.get_boolean(key);
        const props = { title: this._escapeMarkup(title), expanded: isActive };
        if (subtitle) props.subtitle = this._escapeMarkup(subtitle);

        const expander = new Adw.ExpanderRow(props);
        this._addRowIcon(expander, icon);

        const toggle = new Gtk.Switch({
            active: isActive,
            valign: Gtk.Align.CENTER,
        });
        settings.bind(key, toggle, 'active', Gio.SettingsBindFlags.DEFAULT);
        expander.add_suffix(toggle);

        settings.connect(`changed::${key}`, () => {
            if (settings.get_boolean(key)) {
                expander.expanded = true;
            }
        });

        return { expander, toggle };
    }

    _createSpinRow(settings, { key, title, subtitle = null, icon = null, lower, upper, step = 1, sensitiveKey = null }) {
        const props = {
            title: this._escapeMarkup(title),
            adjustment: new Gtk.Adjustment({
                lower,
                upper,
                step_increment: step,
            }),
        };
        if (subtitle) props.subtitle = this._escapeMarkup(subtitle);

        const row = new Adw.SpinRow(props);
        this._addRowIcon(row, icon);
        settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);

        if (sensitiveKey) {
            settings.bind(sensitiveKey, row, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        }

        return row;
    }

    _createIntComboRow(settings, { key, title, subtitle = null, icon = null, labels, sensitiveKey = null }) {
        const model = new Gtk.StringList({ strings: labels });
        const props = {
            title: this._escapeMarkup(title),
            model,
            selected: settings.get_int(key),
        };
        if (subtitle) props.subtitle = this._escapeMarkup(subtitle);

        const row = new Adw.ComboRow(props);
        this._addRowIcon(row, icon);

        row.connect('notify::selected', () => {
            if (settings.get_int(key) !== row.selected) {
                settings.set_int(key, row.selected);
            }
        });
        settings.connect(`changed::${key}`, () => {
            const val = settings.get_int(key);
            if (row.selected !== val) {
                row.selected = val;
            }
        });

        if (sensitiveKey) {
            settings.bind(sensitiveKey, row, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        }

        return row;
    }

    _createStringComboRow(settings, { key, title, subtitle = null, icon = null, labels, values, sensitiveKey = null }) {
        const model = new Gtk.StringList({ strings: labels });
        const currentVal = settings.get_string(key);
        const currentIdx = Math.max(0, values.indexOf(currentVal));

        const props = {
            title: this._escapeMarkup(title),
            model,
            selected: currentIdx,
        };
        if (subtitle) props.subtitle = this._escapeMarkup(subtitle);

        const row = new Adw.ComboRow(props);
        this._addRowIcon(row, icon);

        row.connect('notify::selected', () => {
            const nextVal = values[row.selected] ?? values[0];
            if (settings.get_string(key) !== nextVal) {
                settings.set_string(key, nextVal);
            }
        });
        settings.connect(`changed::${key}`, () => {
            const idx = Math.max(0, values.indexOf(settings.get_string(key)));
            if (row.selected !== idx) {
                row.selected = idx;
            }
        });

        if (sensitiveKey) {
            settings.bind(sensitiveKey, row, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        }

        return row;
    }

    _createColorRow(settings, { key, title, icon = null, sensitiveKey = null }) {
        const row = new Adw.ActionRow({ title: this._escapeMarkup(title) });
        this._addRowIcon(row, icon);

        const parseColor = (str) => {
            const parts = (str || '40,40,40').split(',');
            const rgba = new Gdk.RGBA();
            rgba.parse(`rgb(${parts[0] || 40},${parts[1] || 40},${parts[2] || 40})`);
            return rgba;
        };

        const btn = new Gtk.ColorButton({
            rgba: parseColor(settings.get_string(key)),
            use_alpha: false,
            valign: Gtk.Align.CENTER,
        });

        btn.connect('color-set', () => {
            const rgba = btn.get_rgba();
            const rgbStr = `${Math.round(rgba.red * 255)},${Math.round(rgba.green * 255)},${Math.round(rgba.blue * 255)}`;
            if (settings.get_string(key) !== rgbStr) {
                settings.set_string(key, rgbStr);
            }
        });

        settings.connect(`changed::${key}`, () => {
            btn.set_rgba(parseColor(settings.get_string(key)));
        });

        if (sensitiveKey) {
            settings.bind(sensitiveKey, btn, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
            settings.bind(sensitiveKey, row, 'sensitive', Gio.SettingsBindFlags.DEFAULT);
        }

        row.add_suffix(btn);
        row.activatable_widget = btn;
        return row;
    }

    // =========================================================================
    // 1. MAIN PILL PAGE (Layout, Dimensions, Placement & Display)
    // =========================================================================

    _buildPillPage(window, settings) {
        const mainPage = new Adw.PreferencesPage({
            title: _('Main Pill'),
            icon_name: 'preferences-system-symbolic',
        });

        // --- Group 1: General Pill Display & Text ---
        const genGroup = new Adw.PreferencesGroup({
            title: _('General Settings'),
        });

        const { row: alwaysShowRow } = this._createSwitchRow(settings, {
            key: 'always-show-pill',
            title: _('Always ON'),
            subtitle: _('Retain last known track and keep pill visible after closing the player'),
            icon: 'view-pin-symbolic',
        });
        genGroup.add(alwaysShowRow);

        // Album Art & Fallback ExpanderRow
        const { expander: artExpander } = this._createExpanderSwitchRow(settings, {
            key: 'show-album-art',
            title: _('Show Album Art'),
            subtitle: _('Display the cover art of the currently playing song'),
            icon: 'image-x-generic-symbolic',
        });

        const fallbackRow = new Adw.ActionRow({
            title: this._escapeMarkup(_('Fallback Album Art')),
            subtitle: this._escapeMarkup(settings.get_string('fallback-art-path') || _('No image selected')),
        });
        this._addRowIcon(fallbackRow, 'folder-pictures-symbolic');

        const fallbackBtn = new Gtk.Button({
            icon_name: 'document-open-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        fallbackBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: _('Select Fallback Image') });
            const filter = new Gtk.FileFilter();
            filter.set_name('Images');
            filter.add_mime_type('image/png');
            filter.add_mime_type('image/jpeg');
            const filterList = new Gio.ListStore({ item_type: Gtk.FileFilter });
            filterList.append(filter);
            dialog.set_filters(filterList);

            dialog.open(null, null, (dlg, res) => {
                try {
                    const file = dlg.open_finish(res);
                    if (file) {
                        const path = file.get_path();
                        settings.set_string('fallback-art-path', path);
                        fallbackRow.subtitle = this._escapeMarkup(path);
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        });

        const clearFallbackBtn = new Gtk.Button({
            icon_name: 'edit-clear-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat', 'error'],
        });
        clearFallbackBtn.connect('clicked', () => {
            settings.set_string('fallback-art-path', '');
            fallbackRow.subtitle = this._escapeMarkup(_('No image selected'));
        });

        settings.connect('changed::fallback-art-path', () => {
            fallbackRow.subtitle = this._escapeMarkup(settings.get_string('fallback-art-path') || _('No image selected'));
        });

        const fallbackBtnBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        fallbackBtnBox.append(fallbackBtn);
        fallbackBtnBox.append(clearFallbackBtn);
        fallbackRow.add_suffix(fallbackBtnBox);
        settings.bind('show-album-art', fallbackRow, 'sensitive', Gio.SettingsBindFlags.DEFAULT);

        artExpander.add_row(fallbackRow);
        genGroup.add(artExpander);

        // Artist & Text Display
        const { expander: artistExpander } = this._createExpanderSwitchRow(settings, {
            key: 'show-artist',
            title: _('Show Artist'),
            subtitle: _('Show the artist name in the main music pill'),
            icon: 'avatar-default-symbolic',
        });

        const { row: inlineArtistRow } = this._createSwitchRow(settings, {
            key: 'inline-artist',
            title: _('Inline Artist'),
            subtitle: _('Show "Title • Artist" when the widget is squeezed'),
            sensitiveKey: 'show-artist',
        });
        artistExpander.add_row(inlineArtistRow);
        genGroup.add(artistExpander);

        const { row: hideTextRow } = this._createSwitchRow(settings, {
            key: 'hide-text',
            title: _('Compact Mode (Hide Text)'),
            subtitle: _('Hide title and artist'),
            icon: 'view-conceal-symbolic',
        });
        genGroup.add(hideTextRow);

        // Scrolling Text ExpanderRow
        const { expander: scrollTextExpander } = this._createExpanderSwitchRow(settings, {
            key: 'scroll-text',
            title: _('Scrolling Text'),
            subtitle: _('Animate long track titles and artist names'),
            icon: 'format-text-direction-ltr-symbolic',
        });

        const { row: scrollHoverRow } = this._createSwitchRow(settings, {
            key: 'scroll-on-hover-only',
            title: _('Scroll Only on Hover'),
            subtitle: _('Text stays still until you hover the pill'),
            sensitiveKey: 'scroll-text',
        });
        scrollTextExpander.add_row(scrollHoverRow);

        const { row: scrollPauseRow } = this._createSwitchRow(settings, {
            key: 'freeze-scroll-on-pause',
            title: _('Freeze Scroll on Pause'),
            subtitle: _('Stop the text scrolling animation when the media player is paused'),
            sensitiveKey: 'scroll-text',
        });
        scrollTextExpander.add_row(scrollPauseRow);
        genGroup.add(scrollTextExpander);

        mainPage.add(genGroup);

        // --- Group 2: Positioning & Multi-Monitor ---
        const posGroup = new Adw.PreferencesGroup({
            title: _('Positioning'),
        });

        const targetRow = this._createIntComboRow(settings, {
            key: 'target-container',
            title: _('Container Target'),
            subtitle: _('Select which UI element should host the music pill'),
            icon: 'view-grid-symbolic',
            labels: [_('Dock'), _('Panel: Left Box'), _('Panel: Center Box'), _('Panel: Right Box')],
        });
        posGroup.add(targetRow);

        const monitorsRow = this._createIntComboRow(settings, {
            key: 'dock-monitors',
            title: _('Multi-Monitor Docks'),
            subtitle: _('Which docks show the pill when the dock is on all monitors'),
            icon: 'video-display-symbolic',
            labels: [_('Main Dock Only'), _('All Docks'), _('Secondary Docks Only')],
        });
        posGroup.add(monitorsRow);

        const { row: dynWidthRow } = this._createSwitchRow(settings, {
            key: 'pill-dynamic-width',
            title: _('Dynamic Width'),
            subtitle: _('Auto-adjust pill width (slider acts as max width)'),
            icon: 'zoom-fit-best-symbolic',
        });
        posGroup.add(dynWidthRow);

        const modeRow = this._createIntComboRow(settings, {
            key: 'position-mode',
            title: _('Alignment Preset'),
            subtitle: _('How the widget aligns relative to other items'),
            icon: 'format-justify-center-symbolic',
            labels: [_('Manual Index'), _('First (Start)'), _('Center'), _('Last (End)')],
        });
        posGroup.add(modeRow);

        const indexRow = this._createSpinRow(settings, {
            key: 'dock-position',
            title: _('Manual Index Position'),
            subtitle: _('Order in the list (0 is first). Only for Manual mode.'),
            lower: 0,
            upper: 20,
            step: 1,
        });
        const updateIndexSensitivity = () => {
            indexRow.sensitive = settings.get_int('position-mode') === 0;
        };
        settings.connect('changed::position-mode', updateIndexSensitivity);
        updateIndexSensitivity();
        posGroup.add(indexRow);

        const vOffsetRow = this._createSpinRow(settings, {
            key: 'vertical-offset',
            title: _('Vertical Offset (Y)'),
            subtitle: _('Shift Up (-) or Down (+)'),
            lower: -30,
            upper: 30,
            step: 1,
        });
        posGroup.add(vOffsetRow);

        const hOffsetRow = this._createSpinRow(settings, {
            key: 'horizontal-offset',
            title: _('Horizontal Offset (X)'),
            subtitle: _('Shift Left (-) or Right (+)'),
            lower: -50,
            upper: 50,
            step: 1,
        });
        posGroup.add(hOffsetRow);

        mainPage.add(posGroup);

        // --- Group 3: Dimensions (Dock Mode) ---
        const dockDimGroup = new Adw.PreferencesGroup({
            title: _('Dimensions (Dock Mode)'),
        });
        dockDimGroup.add(this._createSpinRow(settings, {
            key: 'dock-art-size',
            title: _('Album Art Size'),
            lower: 16,
            upper: 48,
            step: 1,
        }));
        dockDimGroup.add(this._createSpinRow(settings, {
            key: 'pill-width',
            title: _('Widget Width'),
            lower: 100,
            upper: 600,
            step: 10,
        }));
        dockDimGroup.add(this._createSpinRow(settings, {
            key: 'pill-height',
            title: _('Widget Height'),
            lower: 32,
            upper: 100,
            step: 4,
        }));
        mainPage.add(dockDimGroup);

        // --- Group 4: Dimensions (Panel Mode) ---
        const panelDimGroup = new Adw.PreferencesGroup({
            title: _('Dimensions (Panel Mode)'),
        });
        panelDimGroup.add(this._createSpinRow(settings, {
            key: 'panel-art-size',
            title: _('Album Art Size'),
            lower: 14,
            upper: 32,
            step: 1,
        }));
        panelDimGroup.add(this._createSpinRow(settings, {
            key: 'panel-pill-width',
            title: _('Widget Width'),
            lower: 100,
            upper: 600,
            step: 10,
        }));
        panelDimGroup.add(this._createSpinRow(settings, {
            key: 'panel-pill-height',
            title: _('Widget Height'),
            lower: 20,
            upper: 60,
            step: 2,
        }));
        mainPage.add(panelDimGroup);

        const updateGroupVisibility = () => {
            const isDock = settings.get_int('target-container') === 0;
            monitorsRow.set_visible(isDock);
            dockDimGroup.set_visible(isDock);
            panelDimGroup.set_visible(!isDock);
        };
        settings.connect('changed::target-container', updateGroupVisibility);
        updateGroupVisibility();

        window.add(mainPage);
    }

    // =========================================================================
    // 2. POP-UP MENU PAGE (Sizing, Vinyl, Selector, Visualizer & Custom Buttons)
    // =========================================================================

    _buildPopupPage(window, settings) {
        const popupPage = new Adw.PreferencesPage({
            title: _('Pop-up Menu'),
            icon_name: 'view-more-symbolic',
        });

        // --- Group 1: Pop-up Appearance, Sizing & Inheritance ---
        const popupGroup = new Adw.PreferencesGroup({
            title: _('Pop-up Appearance'),
        });

        const { row: hideOnLeaveRow } = this._createSwitchRow(settings, {
            key: 'popup-hide-on-leave',
            title: _('Close on Mouse Leave'),
            subtitle: _('Automatically hide the pop-up when you move the cursor away'),
            icon: 'window-close-symbolic',
        });
        popupGroup.add(hideOnLeaveRow);

        const { row: popAlbumRow } = this._createSwitchRow(settings, {
            key: 'popup-show-album-title',
            title: _('Show Album Title'),
            subtitle: _('Display album name next to the artist (Artist \u2022 Album)'),
            icon: 'media-optical-cd-audio-symbolic',
        });
        popupGroup.add(popAlbumRow);

        const { row: hoursRow } = this._createSwitchRow(settings, {
            key: 'show-hours-format',
            title: _('Show HH:MM:SS'),
            subtitle: _('Display hours in the time labels when media is longer than 60 minutes'),
            icon: 'preferences-system-time-symbolic',
        });
        popupGroup.add(hoursRow);

        const { row: popShadowRow } = this._createSwitchRow(settings, {
            key: 'popup-enable-shadow',
            title: _('Enable Shadow'),
            subtitle: _('Show drop shadow behind the pop-up menu'),
            icon: 'weather-overcast-symbolic',
        });
        popupGroup.add(popShadowRow);

        const { row: popTransRow } = this._createSwitchRow(settings, {
            key: 'popup-follow-transparency',
            title: _('Follow Transparency'),
            subtitle: _('Inherit opacity settings from the main pill'),
            icon: 'preferences-desktop-wallpaper-symbolic',
        });
        popupGroup.add(popTransRow);

        const { row: popRadRow } = this._createSwitchRow(settings, {
            key: 'popup-follow-radius',
            title: _('Follow Border Radius'),
            subtitle: _('Inherit corner roundness from the main pill'),
            icon: 'preferences-desktop-appearance-symbolic',
        });
        popupGroup.add(popRadRow);

        const { row: popCustomBgRow } = this._createSwitchRow(settings, {
            key: 'popup-follow-custom-bg',
            title: _('Follow Custom Background Color'),
            subtitle: _('Use the custom background color for the pop-up (if active)'),
            sensitiveKey: 'use-custom-colors',
        });
        popupGroup.add(popCustomBgRow);

        const { row: popCustomTextRow } = this._createSwitchRow(settings, {
            key: 'popup-follow-custom-text',
            title: _('Follow Custom Text Color'),
            subtitle: _('Use the custom text color for the pop-up (if active)'),
            sensitiveKey: 'use-custom-colors',
        });
        popupGroup.add(popCustomTextRow);

        // Custom Width ExpanderRow (places Custom Width Value directly inside)
        const { expander: popCustomWidthExpander } = this._createExpanderSwitchRow(settings, {
            key: 'popup-use-custom-width',
            title: _('Use Custom Width'),
            subtitle: _('Disable dynamic sizing for the pop-up'),
            icon: 'zoom-fit-best-symbolic',
        });

        const popCustomWidthRow = this._createSpinRow(settings, {
            key: 'popup-custom-width',
            title: _('Custom Width Value'),
            lower: 260,
            upper: 800,
            step: 10,
            sensitiveKey: 'popup-use-custom-width',
        });

        const updateWidthBound = () => {
            const limit = settings.get_boolean('show-shuffle-loop') ? 360 : 260;
            popCustomWidthRow.adjustment.lower = limit;
            if (settings.get_int('popup-custom-width') < limit) {
                settings.set_int('popup-custom-width', limit);
            }
        };
        settings.connect('changed::show-shuffle-loop', updateWidthBound);
        updateWidthBound();

        popCustomWidthExpander.add_row(popCustomWidthRow);
        popupGroup.add(popCustomWidthExpander);

        // --- Vinyl / Album Art ExpanderRow (all vinyl options grouped together) ---
        const { expander: vinylExpander } = this._createExpanderSwitchRow(settings, {
            key: 'popup-show-vinyl',
            title: _('Show Vinyl'),
            subtitle: _('Display the album art in the pop-up'),
            icon: 'media-optical-symbolic',
        });

        const { row: popSquareRow } = this._createSwitchRow(settings, {
            key: 'popup-vinyl-square',
            title: _('Square Vinyl Image'),
            subtitle: _('Use a square album art (disables rotation)'),
            sensitiveKey: 'popup-show-vinyl',
        });
        vinylExpander.add_row(popSquareRow);

        const { row: popVinylShadowRow } = this._createSwitchRow(settings, {
            key: 'popup-vinyl-shadow',
            title: _('Album Art Shadow'),
            subtitle: _('Show drop shadow behind the album art in the pop-up'),
            sensitiveKey: 'popup-show-vinyl',
        });
        vinylExpander.add_row(popVinylShadowRow);

        const { row: popRotateRow } = this._createSwitchRow(settings, {
            key: 'popup-vinyl-rotate',
            title: _('Rotate Vinyl'),
            subtitle: _('Spin the album art when playing'),
        });
        vinylExpander.add_row(popRotateRow);

        const popRotateSpeedRow = this._createSpinRow(settings, {
            key: 'popup-vinyl-speed',
            title: _('Rotation Speed'),
            subtitle: _('Adjust the vinyl spin speed (Lower is slower, Default: 10)'),
            lower: 1,
            upper: 50,
            step: 1,
        });
        vinylExpander.add_row(popRotateSpeedRow);

        const updateVinylRotationSensitivity = () => {
            const showVinyl = settings.get_boolean('popup-show-vinyl');
            const isSquare = settings.get_boolean('popup-vinyl-square');
            const isRotating = settings.get_boolean('popup-vinyl-rotate');
            popRotateRow.sensitive = showVinyl && !isSquare;
            popRotateSpeedRow.sensitive = showVinyl && !isSquare && isRotating;
        };
        settings.connect('changed::popup-show-vinyl', updateVinylRotationSensitivity);
        settings.connect('changed::popup-vinyl-square', updateVinylRotationSensitivity);
        settings.connect('changed::popup-vinyl-rotate', updateVinylRotationSensitivity);
        updateVinylRotationSensitivity();

        popupGroup.add(vinylExpander);

        // --- Player Selector ExpanderRow ---
        const { expander: selectorExpander } = this._createExpanderSwitchRow(settings, {
            key: 'popup-show-player-selector',
            title: _('Show Player Selector'),
            subtitle: _('Display active player icons in the pop-up'),
            icon: 'multimedia-player-symbolic',
        });

        const selectorPosRow = this._createIntComboRow(settings, {
            key: 'popup-player-selector-position',
            title: _('Player Selector Position'),
            subtitle: _('Where to place the player icons inside the pop-up'),
            labels: [_('Top'), _('Bottom'), _('Left'), _('Right')],
            sensitiveKey: 'popup-show-player-selector',
        });
        selectorExpander.add_row(selectorPosRow);

        const { row: hideAutoRow } = this._createSwitchRow(settings, {
            key: 'hide-auto-smart-selection',
            title: _('Hide Auto (Smart Selection)'),
            subtitle: _('Remove the automatic player selection entry from the player selector menu'),
            sensitiveKey: 'popup-show-player-selector',
        });
        selectorExpander.add_row(hideAutoRow);

        popupGroup.add(selectorExpander);
        popupPage.add(popupGroup);

        // --- Group 2: Playback & Custom Control Buttons ---
        const customBtnGroup = new Adw.PreferencesGroup({
            title: _('Custom Control Buttons'),
            description: _("Add up to two extra buttons in the expanded player's controls row.") + ' ' + _('If both buttons are set to Seek, they act directly (Button 1 = −10s, Button 2 = +10s). Otherwise Seek opens a sub-page.'),
        });

        const { row: showShuffleRow } = this._createSwitchRow(settings, {
            key: 'show-shuffle-loop',
            title: _('Show Shuffle and Loop'),
            subtitle: _('Display extra controls in the pop-up'),
            icon: 'media-playlist-shuffle-symbolic',
        });
        customBtnGroup.add(showShuffleRow);

        const { expander: customBtnsExpander } = this._createExpanderSwitchRow(settings, {
            key: 'enable-custom-buttons',
            title: _('Enable Custom Buttons'),
            subtitle: _('Show additional action buttons next to Shuffle and Loop'),
            icon: 'list-add-symbolic',
        });

        const actionLabels = [
            _('None'),
            _('Volume Control'),
            _('Seek ±10 Seconds'),
            _('Audio Output Switcher'),
            _('Sleep Timer'),
            _('Playback Speed'),
            _('Track History'),
        ];
        const actionValues = ['none', 'volume', 'seek_step', 'output_switch', 'sleep_timer', 'playback_speed', 'history'];

        customBtnsExpander.add_row(this._createStringComboRow(settings, {
            key: 'custom-button-1',
            title: _('Custom Button 1'),
            subtitle: _('Placed left of Shuffle.'),
            labels: actionLabels,
            values: actionValues,
            sensitiveKey: 'enable-custom-buttons',
        }));

        customBtnsExpander.add_row(this._createStringComboRow(settings, {
            key: 'custom-button-2',
            title: _('Custom Button 2'),
            subtitle: _('Placed right of Loop.'),
            labels: actionLabels,
            values: actionValues,
            sensitiveKey: 'enable-custom-buttons',
        }));

        customBtnGroup.add(customBtnsExpander);
        popupPage.add(customBtnGroup);
        window.add(popupPage);
    }

    // =========================================================================
    // 3. CONTROLS PAGE (Mouse Actions, Scroll Controls & Tablet Buttons)
    // =========================================================================

    _buildControlsPage(window, settings) {
        const controlsPage = new Adw.PreferencesPage({
            title: _('Controls'),
            icon_name: 'input-mouse-symbolic',
        });

        // --- Group 1: Mouse Click & Hover Actions ---
        const actionGroup = new Adw.PreferencesGroup({
            title: _('Mouse Actions'),
        });

        const mouseActionLabels = [
            _('None'),
            _('Play / Pause'),
            _('Next Track'),
            _('Previous Track'),
            _('Open Player App'),
            _('Open Menu'),
            _('Select Player'),
            _('Open Settings'),
            _('Close Player App'),
        ];
        const mouseActionValues = [
            'none',
            'play_pause',
            'next',
            'previous',
            'open_app',
            'toggle_menu',
            'open_player_menu',
            'open_settings',
            'close_app',
        ];

        actionGroup.add(this._createStringComboRow(settings, {
            key: 'action-left-click',
            title: _('Left Click'),
            labels: mouseActionLabels,
            values: mouseActionValues,
        }));
        actionGroup.add(this._createStringComboRow(settings, {
            key: 'action-double-click',
            title: _('Double Click'),
            labels: mouseActionLabels,
            values: mouseActionValues,
        }));
        actionGroup.add(this._createStringComboRow(settings, {
            key: 'action-middle-click',
            title: _('Middle Click'),
            labels: mouseActionLabels,
            values: mouseActionValues,
        }));
        actionGroup.add(this._createStringComboRow(settings, {
            key: 'action-right-click',
            title: _('Right Click'),
            labels: mouseActionLabels,
            values: mouseActionValues,
        }));

        const hoverRow = this._createStringComboRow(settings, {
            key: 'action-hover',
            title: _('Hover Action'),
            labels: mouseActionLabels,
            values: mouseActionValues,
        });
        actionGroup.add(hoverRow);

        const hoverDelayRow = this._createSpinRow(settings, {
            key: 'hover-delay',
            title: _('Hover Delay (ms)'),
            lower: 0,
            upper: 3000,
            step: 100,
        });
        const updateHoverDelaySensitivity = () => {
            hoverDelayRow.sensitive = settings.get_string('action-hover') !== 'none';
        };
        settings.connect('changed::action-hover', updateHoverDelaySensitivity);
        updateHoverDelaySensitivity();
        actionGroup.add(hoverDelayRow);

        controlsPage.add(actionGroup);

        // --- Group 2: Scroll Controls ---
        const scrollGroup = new Adw.PreferencesGroup({
            title: _('Scroll Controls'),
        });

        const { expander: scrollExpander } = this._createExpanderSwitchRow(settings, {
            key: 'enable-scroll-controls',
            title: _('Enable Scroll Controls'),
            subtitle: _('Change Tracks, Volume or Media Player using scroll wheel or touchpad'),
            icon: 'input-mouse-symbolic',
        });

        const scrollActionRow = this._createStringComboRow(settings, {
            key: 'scroll-action',
            title: _('Scroll Action'),
            subtitle: _('Choose what scrolling on the pill should do'),
            labels: [_('Change Track'), _('Change Volume'), _('Switch Player'), _('Seek ±10s')],
            values: ['track', 'volume', 'player', 'seek'],
            sensitiveKey: 'enable-scroll-controls',
        });
        scrollExpander.add_row(scrollActionRow);

        const volTargetRow = this._createStringComboRow(settings, {
            key: 'volume-scroll-target',
            title: _('Volume Scroll Target'),
            subtitle: _('Choose which sound source to control when scrolling volume'),
            labels: [_('System Master Volume'), _('Active Media App Volume')],
            values: ['system', 'app'],
        });
        const updateVolTargetSensitivity = () => {
            const scrollEnabled = settings.get_boolean('enable-scroll-controls');
            const isVolAction = settings.get_string('scroll-action') === 'volume';
            volTargetRow.sensitive = scrollEnabled && isVolAction;
        };
        settings.connect('changed::enable-scroll-controls', updateVolTargetSensitivity);
        settings.connect('changed::scroll-action', updateVolTargetSensitivity);
        updateVolTargetSensitivity();
        scrollExpander.add_row(volTargetRow);

        const { row: invertDirRow } = this._createSwitchRow(settings, {
            key: 'invert-scroll-direction',
            title: _('Invert Scroll Direction'),
            subtitle: _('Swap up/down scrolling for track and volume actions'),
            sensitiveKey: 'enable-scroll-controls',
        });
        scrollExpander.add_row(invertDirRow);

        const { row: scrollAnimRow } = this._createSwitchRow(settings, {
            key: 'enable-scroll-animation',
            title: _('Scroll Animation'),
            subtitle: _('Animate the pill with a jump effect when scrolling'),
        });
        scrollExpander.add_row(scrollAnimRow);

        const { row: invertAnimRow } = this._createSwitchRow(settings, {
            key: 'invert-scroll-animation',
            title: _('Invert Scroll Animation'),
            subtitle: _('Direction of the jump effect (Natural vs Traditional)'),
        });
        scrollExpander.add_row(invertAnimRow);

        const updateScrollAnimSensitivity = () => {
            const scrollEnabled = settings.get_boolean('enable-scroll-controls');
            const animEnabled = settings.get_boolean('enable-scroll-animation');
            scrollAnimRow.sensitive = scrollEnabled;
            invertAnimRow.sensitive = scrollEnabled && animEnabled;
        };
        settings.connect('changed::enable-scroll-controls', updateScrollAnimSensitivity);
        settings.connect('changed::enable-scroll-animation', updateScrollAnimSensitivity);
        updateScrollAnimSensitivity();

        scrollGroup.add(scrollExpander);
        controlsPage.add(scrollGroup);

        // --- Group 3: On-Pill Buttons (Tablet Mode) ---
        const tabletGroup = new Adw.PreferencesGroup({
            title: _('On-Pill Buttons (Tablet Mode)'),
        });

        const tabletModeRow = this._createIntComboRow(settings, {
            key: 'tablet-mode',
            title: _('Tablet Mode Controls'),
            subtitle: _('Show media buttons directly on the pill'),
            icon: 'input-tablet-symbolic',
            labels: [_('Off'), _('Skip Only'), _('Play/Pause Only'), _('All Controls')],
        });
        tabletGroup.add(tabletModeRow);

        const controlsPosRow = this._createIntComboRow(settings, {
            key: 'pill-controls-position',
            title: _('Controls Position'),
            subtitle: _('Where to place the tablet controls on the pill'),
            labels: [_('Before Text'), _('After Text'), _('After Visualizer')],
        });
        const updateControlsPosSensitivity = () => {
            controlsPosRow.sensitive = settings.get_int('tablet-mode') > 0;
        };
        settings.connect('changed::tablet-mode', updateControlsPosSensitivity);
        updateControlsPosSensitivity();
        tabletGroup.add(controlsPosRow);

        controlsPage.add(tabletGroup);
        window.add(controlsPage);
    }

    // =========================================================================
    // 4. LYRICS PAGE (Karaoke, Synced Lyrics, Translations & Timing)
    // =========================================================================

    _buildLyricsPage(window, settings) {
        const lyricsPage = new Adw.PreferencesPage({
            title: _('Lyrics'),
            icon_name: 'audio-x-generic-symbolic',
        });

        // --- Group 1: Interactive Hint Banner ---
        const hintGroup = new Adw.PreferencesGroup();
        const hintRow = new Adw.ActionRow({
            title: this._escapeMarkup(_('Interactive Pop-up Lyrics')),
            subtitle: this._escapeMarkup(_('💡 Tip: Clicking the album art or vinyl in the expanded player pop-up instantly opens the synchronized lyrics view!')),
        });
        this._addRowIcon(hintRow, 'emblem-music-symbolic');
        hintGroup.add(hintRow);
        lyricsPage.add(hintGroup);

        // --- Group 2: Synchronized Lyrics & Karaoke Options ---
        const lyricsGroup = new Adw.PreferencesGroup({
            title: this._escapeMarkup(_('Lyrics & Karaoke')),
            description: this._escapeMarkup(_('Real-time synchronized lyrics with multi-provider karaoke support.')),
        });

        const { expander: lyricsExpander } = this._createExpanderSwitchRow(settings, {
            key: 'enable-lyrics',
            title: _('Lyrics Display'),
            subtitle: _('Show real-time synchronized lyrics for current track.'),
            icon: 'audio-x-generic-symbolic',
        });

        lyricsExpander.add_row(this._createSwitchRow(settings, {
            key: 'pill-enable-word-level',
            title: _('Word-level Karaoke in Pill'),
            subtitle: _('Highlight individual words on the main pill when available (pop-up always uses word-level).'),
            sensitiveKey: 'enable-lyrics',
        }).row);

        lyricsExpander.add_row(this._createIntComboRow(settings, {
            key: 'lyrics-language-preference',
            title: _('Lyrics language preference'),
            subtitle: _('When multiple versions exist'),
            labels: [_('Auto'), _('Prefer original script'), _('Prefer Latin')],
            sensitiveKey: 'enable-lyrics',
        }));

        const { row: lyricFadeRow } = this._createSwitchRow(settings, {
            key: 'lyric-fade-enable',
            title: _('Lyrics Fade-in Effect'),
            subtitle: _('Smoothly fade in new lyric lines'),
            sensitiveKey: 'enable-lyrics',
        });
        lyricsExpander.add_row(lyricFadeRow);

        const lyricFadeDurationRow = this._createSpinRow(settings, {
            key: 'lyric-fade-duration',
            title: _('Fade Duration (ms)'),
            lower: 50,
            upper: 2000,
            step: 50,
        });
        const updateLyricFadeDurationSensitivity = () => {
            lyricFadeDurationRow.sensitive = settings.get_boolean('enable-lyrics') && settings.get_boolean('lyric-fade-enable');
        };
        settings.connect('changed::enable-lyrics', updateLyricFadeDurationSensitivity);
        settings.connect('changed::lyric-fade-enable', updateLyricFadeDurationSensitivity);
        updateLyricFadeDurationSensitivity();
        lyricsExpander.add_row(lyricFadeDurationRow);

        lyricsGroup.add(lyricsExpander);
        lyricsPage.add(lyricsGroup);

        window.add(lyricsPage);
    }

    // =========================================================================
    // 5. STYLE & LAYOUT PAGE (Colors, Dynamic Blur, Transparency, Shadow & Vis)
    // =========================================================================

    _getBmsDir() {
        const userDir = GLib.build_filenamev([GLib.get_user_data_dir(), 'gnome-shell', 'extensions', 'blur-my-shell@aunetx']);
        if (GLib.file_test(userDir, GLib.FileTest.IS_DIR)) return userDir;
        const sysDir = '/usr/share/gnome-shell/extensions/blur-my-shell@aunetx';
        if (GLib.file_test(sysDir, GLib.FileTest.IS_DIR)) return sysDir;
        return null;
    }

    _isBmsInstalled() {
        return this._getBmsDir() !== null;
    }

    _isBmsUnified() {
        const dir = this._getBmsDir();
        if (!dir) return false;
        const candidates = [
            GLib.build_filenamev([dir, 'render', 'dynamic_surface.js']),
            GLib.build_filenamev([dir, 'src', 'render', 'dynamic_surface.js']),
            GLib.build_filenamev([dir, 'effects', 'blur', 'dual_kawase_blur.js']),
            GLib.build_filenamev([dir, 'src', 'effects', 'blur', 'dual_kawase_blur.js']),
        ];
        if (candidates.some(p => GLib.file_test(p, GLib.FileTest.EXISTS))) return true;

        const metaFile = GLib.build_filenamev([dir, 'metadata.json']);
        if (GLib.file_test(metaFile, GLib.FileTest.EXISTS)) {
            try {
                const [ok, contents] = GLib.file_get_contents(metaFile);
                if (ok) {
                    const meta = JSON.parse(new TextDecoder().decode(contents));
                    if (meta && typeof meta.version === 'number' && meta.version >= 76) return true;
                }
            } catch (_) {}
        }
        return false;
    }

    _isRoundedBlurInstalled() {
        const paths = [
            '/usr/lib/girepository-1.0/Blur-1.0.typelib',
            '/usr/lib64/girepository-1.0/Blur-1.0.typelib',
            '/usr/local/lib/girepository-1.0/Blur-1.0.typelib',
            '/usr/lib/girepository-2.0/Blur-1.0.typelib',
            '/usr/lib64/girepository-2.0/Blur-1.0.typelib',
            '/usr/local/lib/girepository-2.0/Blur-1.0.typelib',
            '/usr/lib/libblur-effect-1.0.so',
            '/usr/lib64/libblur-effect-1.0.so',
            '/usr/local/lib/libblur-effect-1.0.so',
        ];
        return paths.some(p => GLib.file_test(p, GLib.FileTest.EXISTS));
    }

    _buildStylePage(window, settings) {
        const stylePage = new Adw.PreferencesPage({
            title: _('Style & Layout'),
            icon_name: 'applications-graphics-symbolic',
        });

        // --- Group 1: Theme & Custom Colors ---
        const colorGroup = new Adw.PreferencesGroup({
            title: _('Custom Colors'),
        });

        const { row: lightModeRow } = this._createSwitchRow(settings, {
            key: 'light-mode',
            title: _('Light Mode'),
            subtitle: _('Use a bright pastel palette for dynamic backgrounds and dark text/icons'),
            icon: 'weather-clear-symbolic',
        });
        colorGroup.add(lightModeRow);

        const { row: syncAccentRow } = this._createSwitchRow(settings, {
            key: 'sync-accent-color',
            title: _('Sync GNOME Accent Color'),
            subtitle: _('Dynamically change the GNOME Shell accent color to match the album art'),
            icon: 'preferences-color-symbolic',
        });
        colorGroup.add(syncAccentRow);

        const { expander: customColorExpander } = this._createExpanderSwitchRow(settings, {
            key: 'use-custom-colors',
            title: _('Use Custom Colors'),
            subtitle: _('Override dynamic colors'),
            icon: 'applications-graphics-symbolic',
        });

        customColorExpander.add_row(this._createColorRow(settings, {
            key: 'custom-bg-color',
            title: _('Background Color'),
            sensitiveKey: 'use-custom-colors',
        }));
        customColorExpander.add_row(this._createColorRow(settings, {
            key: 'custom-text-color',
            title: _('Text Color'),
            sensitiveKey: 'use-custom-colors',
        }));
        customColorExpander.add_row(this._createColorRow(settings, {
            key: 'custom-vis-color',
            title: _('Visualizer Color'),
            sensitiveKey: 'use-custom-colors',
        }));

        colorGroup.add(customColorExpander);
        stylePage.add(colorGroup);

        // --- Group 2: Dynamic Blur (Blur my Shell) ---
        const bmsInstalled = this._isBmsInstalled();
        const bmsUnified = this._isBmsUnified();
        const roundedInstalled = this._isRoundedBlurInstalled();
        const hasBlurDeps = bmsUnified || (bmsInstalled && roundedInstalled);

        const checkPrefsBlurDeps = () => {
            if (this._isBmsUnified()) return true;
            const bms = this._isBmsInstalled();
            const round = this._isRoundedBlurInstalled();
            if (!bms || !round) {
                const missing = [];
                if (!bms) missing.push('"Blur my Shell"');
                if (!round) missing.push('"gnome-rounded-blur"');
                const msg = _('Please install %s for dynamic blur.').replace('%s', missing.join(' ' + _('and') + ' '));
                window.add_toast(new Adw.Toast({ title: msg }));
                return false;
            }
            return true;
        };

        const blurGroup = new Adw.PreferencesGroup({
            title: _('Dynamic Blur (Blur my Shell)'),
            description: bmsUnified
                ? _('Apply native Dual Kawase Gaussian blur behind the pill and pop-up.')
                : _('Apply Gaussian blur behind the pill and pop-up using Blur my Shell or gnome-rounded-blur.'),
        });

        if (!hasBlurDeps) {
            const missing = [];
            if (!bmsInstalled) missing.push('"Blur my Shell"');
            if (!roundedInstalled && !bmsUnified) missing.push('"gnome-rounded-blur"');
            const blurNote = new Gtk.Label({
                label: _('Note: Dynamic blur requires %s to be installed.').replace('%s', missing.join(' ' + _('and') + ' ')),
                wrap: true,
                xalign: 0,
                css_classes: ['dim-label'],
                margin_top: 6,
                margin_bottom: 6,
                margin_start: 12,
                margin_end: 12,
            });
            blurGroup.add(blurNote);
        }

        const { row: blurPillRow, toggle: blurPillToggle } = this._createSwitchRow(settings, {
            key: 'enable-blur-pill',
            title: _('Enable Blur for Pill'),
            subtitle: _('Blur the background behind the music pill'),
            icon: 'weather-fog-symbolic',
        });
        blurPillToggle.connect('state-set', (_sw, state) => {
            if (state && !checkPrefsBlurDeps()) return true;
            return false;
        });
        blurGroup.add(blurPillRow);

        const { row: blurPopupRow, toggle: blurPopupToggle } = this._createSwitchRow(settings, {
            key: 'enable-blur-popup',
            title: _('Enable Blur for Pop-up'),
            subtitle: _('Blur the background behind the expanded player pop-up'),
            icon: 'weather-fog-symbolic',
        });
        blurPopupToggle.connect('state-set', (_sw, state) => {
            if (state && !checkPrefsBlurDeps()) return true;
            return false;
        });
        blurGroup.add(blurPopupRow);

        const { row: blurBlendRow } = this._createSwitchRow(settings, {
            key: 'blur-blend-color',
            title: _('Tint Blur with Album Art Color'),
            subtitle: _('Blend dynamic album colors over the blurred background instead of neutral frosted glass'),
        });
        blurGroup.add(blurBlendRow);

        const blurSigmaRow = this._createSpinRow(settings, {
            key: 'blur-sigma',
            title: _('Blur Radius (Sigma)'),
            subtitle: _('Strength of the Gaussian blur effect'),
            lower: 0,
            upper: 100,
            step: 2,
        });

        if (bmsUnified) {
            const { row: bmsFollowRow } = this._createSwitchRow(settings, {
                key: 'bms-follow-pipeline',
                title: _('Follow Blur my Shell Pipelines'),
                subtitle: _('Use the blur pipelines and effects configured in Blur my Shell'),
            });
            blurGroup.add(bmsFollowRow);

            const updateSigmaRowState = () => {
                const follow = settings.get_boolean('bms-follow-pipeline');
                blurSigmaRow.sensitive = !follow;
                blurSigmaRow.subtitle = this._escapeMarkup(follow
                    ? _('Controlled by Blur my Shell pipeline')
                    : _('Strength of the Gaussian blur effect'));
            };
            updateSigmaRowState();
            settings.connect('changed::bms-follow-pipeline', updateSigmaRowState);
        }

        blurGroup.add(blurSigmaRow);

        const bmsLinkRow = new Adw.ActionRow({
            title: this._escapeMarkup(_('Blur my Shell Extension')),
            subtitle: this._escapeMarkup(bmsUnified
                ? _('Native Dual Kawase blur backend active (v76+)')
                : _('Recommended for native Wayland dynamic blur')),
        });
        const bmsBtn = new Gtk.Button({
            label: _('GitHub'),
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        bmsBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://github.com/aunetx/blur-my-shell', null));
        bmsLinkRow.add_suffix(bmsBtn);
        blurGroup.add(bmsLinkRow);

        if (!bmsUnified) {
            const bmsGuideRow = new Adw.ActionRow({
                title: this._escapeMarkup(_('gnome-rounded-blur Library')),
                subtitle: this._escapeMarkup(_('Installation guide for native rounded corners blur')),
            });
            const bmsGuideBtn = new Gtk.Button({
                label: _('Guide'),
                valign: Gtk.Align.CENTER,
                css_classes: ['flat'],
            });
            bmsGuideBtn.connect('clicked', () => Gio.AppInfo.launch_default_for_uri('https://github.com/aunetx/blur-my-shell/blob/master/scripts/GUIDE.md', null));
            bmsGuideRow.add_suffix(bmsGuideBtn);
            blurGroup.add(bmsGuideRow);
        }

        stylePage.add(blurGroup);

        // Mutual exclusion between Blur and Transparency
        settings.connect('changed::enable-blur-pill', () => {
            if (settings.get_boolean('enable-blur-pill')) {
                if (!checkPrefsBlurDeps()) {
                    settings.set_boolean('enable-blur-pill', false);
                    return;
                }
                if (settings.get_boolean('enable-transparency')) {
                    settings.set_boolean('enable-transparency', false);
                }
            }
        });
        settings.connect('changed::enable-blur-popup', () => {
            if (settings.get_boolean('enable-blur-popup')) {
                if (!checkPrefsBlurDeps()) {
                    settings.set_boolean('enable-blur-popup', false);
                    return;
                }
                if (settings.get_boolean('popup-follow-transparency')) {
                    settings.set_boolean('popup-follow-transparency', false);
                }
            }
        });
        settings.connect('changed::enable-transparency', () => {
            if (settings.get_boolean('enable-transparency') && settings.get_boolean('enable-blur-pill')) {
                settings.set_boolean('enable-blur-pill', false);
            }
        });
        settings.connect('changed::popup-follow-transparency', () => {
            if (settings.get_boolean('popup-follow-transparency') && settings.get_boolean('enable-blur-popup')) {
                settings.set_boolean('enable-blur-popup', false);
            }
        });

        // --- Group 3: Background & Transparency ExpanderRow ---
        const transGroup = new Adw.PreferencesGroup({
            title: _('Background and Transparency'),
        });

        const { expander: transExpander } = this._createExpanderSwitchRow(settings, {
            key: 'enable-transparency',
            title: _('Enable Transparency'),
            subtitle: _('Switch between a solid theme background and a custom transparent look'),
            icon: 'preferences-desktop-wallpaper-symbolic',
        });

        transExpander.add_row(this._createSpinRow(settings, {
            key: 'transparency-strength',
            title: _('Background Opacity'),
            subtitle: _('Adjust transparency level'),
            lower: 0,
            upper: 100,
            step: 5,
            sensitiveKey: 'enable-transparency',
        }));

        transExpander.add_row(this._createSwitchRow(settings, {
            key: 'transparency-art',
            title: _('Apply to Album Art'),
            sensitiveKey: 'enable-transparency',
        }).row);

        transExpander.add_row(this._createSwitchRow(settings, {
            key: 'transparency-text',
            title: _('Apply to Text'),
            sensitiveKey: 'enable-transparency',
        }).row);

        transExpander.add_row(this._createSwitchRow(settings, {
            key: 'transparency-vis',
            title: _('Apply to Visualizer'),
            sensitiveKey: 'enable-transparency',
        }).row);

        transGroup.add(transExpander);
        stylePage.add(transGroup);

        // --- Group 4: Shape, Borders & Main Pill Shadow ---
        const shadowGroup = new Adw.PreferencesGroup({
            title: _('Main Pill Shadow'),
        });

        shadowGroup.add(this._createSpinRow(settings, {
            key: 'border-radius',
            title: _('Corner Radius'),
            subtitle: _('Roundness of the widget edges (0 = Square, 25 = Pill)'),
            icon: 'preferences-desktop-appearance-symbolic',
            lower: 0,
            upper: 50,
            step: 1,
        }));

        shadowGroup.add(this._createSpinRow(settings, {
            key: 'edge-margin',
            title: _('Outer Edge Margin'),
            subtitle: _('Spacing before the album art and after the visualizer'),
            lower: 0,
            upper: 50,
            step: 1,
        }));

        shadowGroup.add(this._createSwitchRow(settings, {
            key: 'show-pill-border',
            title: _('Show Pill Outline'),
            subtitle: _('Display a subtle border around the main pill'),
        }).row);

        const { expander: shadowExpander } = this._createExpanderSwitchRow(settings, {
            key: 'enable-shadow',
            title: _('Enable Shadow'),
            icon: 'weather-overcast-symbolic',
        });

        shadowExpander.add_row(this._createSpinRow(settings, {
            key: 'shadow-opacity',
            title: _('Shadow Intensity'),
            lower: 0,
            upper: 100,
            step: 5,
            sensitiveKey: 'enable-shadow',
        }));

        shadowExpander.add_row(this._createSpinRow(settings, {
            key: 'shadow-blur',
            title: _('Shadow Blur'),
            lower: 0,
            upper: 50,
            step: 1,
            sensitiveKey: 'enable-shadow',
        }));

        shadowGroup.add(shadowExpander);
        stylePage.add(shadowGroup);

        // --- Group 5: Audio Visualizer ---
        const lookGroup = new Adw.PreferencesGroup({
            title: _('Audio Visualizers'),
        });

        const visRow = this._createIntComboRow(settings, {
            key: 'visualizer-style',
            title: _('Visualizer Animation'),
            subtitle: _('Select the style of the audio reaction bars'),
            icon: 'audio-volume-high-symbolic',
            labels: [
                _('Off (Disabled)'),
                _('Wave (Smooth)'),
                _('Beat (Jumpy)'),
                _('Real-Time (Cava needed)'),
            ],
        });
        lookGroup.add(visRow);

        const cavaNote = new Gtk.Label({
            label: _("Note: 'Real-Time' mode requires the 'cava' package to be installed on your Linux system."),
            wrap: true,
            xalign: 0,
            css_classes: ['dim-label'],
            margin_top: 6,
            margin_bottom: 6,
            margin_start: 12,
            margin_end: 12,
        });
        lookGroup.add(cavaNote);

        const visBarsRow = this._createSpinRow(settings, {
            key: 'visualizer-bars',
            title: _('Visualizer Bar Count'),
            subtitle: _('Number of bars displayed in the animation'),
            lower: 2,
            upper: 32,
            step: 1,
        });
        lookGroup.add(visBarsRow);

        const visWidthRow = this._createSpinRow(settings, {
            key: 'visualizer-bar-width',
            title: _('Visualizer Bar Width'),
            subtitle: _('Thickness of individual bars (pixels)'),
            lower: 1,
            upper: 10,
            step: 1,
        });
        lookGroup.add(visWidthRow);

        const visHeightRow = this._createSpinRow(settings, {
            key: 'visualizer-height',
            title: _('Visualizer Height'),
            subtitle: _('Maximum height of the visualizer (auto-clamped to pill height)'),
            lower: 10,
            upper: 100,
            step: 2,
        });
        lookGroup.add(visHeightRow);

        const visPaddingRow = this._createSpinRow(settings, {
            key: 'visualizer-padding',
            title: _('Visualizer Margin'),
            subtitle: _('Distance between the text and the wave animation'),
            lower: 0,
            upper: 50,
            step: 1,
        });
        lookGroup.add(visPaddingRow);

        const updateVisSensitivity = () => {
            const enabled = settings.get_int('visualizer-style') !== 0;
            visBarsRow.sensitive = enabled;
            visWidthRow.sensitive = enabled;
            visHeightRow.sensitive = enabled;
            visPaddingRow.sensitive = enabled;
        };
        settings.connect('changed::visualizer-style', updateVisSensitivity);
        updateVisSensitivity();

        // --- Pop-up Visualizer ExpanderRow (Under Main Pill Visualizer) ---
        const { expander: popVisExpander } = this._createExpanderSwitchRow(settings, {
            key: 'popup-show-visualizer',
            title: _('Show Visualizer in Pop-up'),
            subtitle: _('Enable audio visualizer bars inside the expanded player'),
            icon: 'audio-volume-high-symbolic',
        });

        const { row: hidePillVisRow } = this._createSwitchRow(settings, {
            key: 'popup-hide-pill-visualizer',
            title: _('Hide Pill Visualizer'),
            subtitle: _('Creates a "moving" effect by hiding the main pill visualizer'),
            sensitiveKey: 'popup-show-visualizer',
        });
        popVisExpander.add_row(hidePillVisRow);

        popVisExpander.add_row(this._createSpinRow(settings, {
            key: 'popup-visualizer-bars',
            title: _('Popup Visualizer Bar Count'),
            lower: 2,
            upper: 64,
            step: 1,
            sensitiveKey: 'popup-show-visualizer',
        }));

        popVisExpander.add_row(this._createSpinRow(settings, {
            key: 'popup-visualizer-bar-width',
            title: _('Popup Visualizer Bar Width'),
            lower: 1,
            upper: 20,
            step: 1,
            sensitiveKey: 'popup-show-visualizer',
        }));

        popVisExpander.add_row(this._createSpinRow(settings, {
            key: 'popup-visualizer-height',
            title: _('Popup Visualizer Height'),
            lower: 20,
            upper: 200,
            step: 5,
            sensitiveKey: 'popup-show-visualizer',
        }));

        lookGroup.add(popVisExpander);

        stylePage.add(lookGroup);
        window.add(stylePage);
    }

    // =========================================================================
    // 6. SYSTEM & RESET PAGE (Compatibility, App Mappings, Cache, Backup & Reset)
    // =========================================================================

    _buildSystemPage(window, settings) {
        const systemPage = new Adw.PreferencesPage({
            title: _('System & Reset'),
            icon_name: 'utilities-terminal-symbolic',
        });

        // --- Group 2: System, Compatibility & Player Filtering ---
        const compatGroup = new Adw.PreferencesGroup({
            title: _('System'),
        });

        compatGroup.add(this._createSwitchRow(settings, {
            key: 'hide-default-player',
            title: _('Hide Default GNOME Player'),
            subtitle: _('Remove the duplicate built-in media controls'),
            icon: 'audio-speakers-symbolic',
        }).row);

        compatGroup.add(this._createSwitchRow(settings, {
            key: 'enable-gamemode',
            title: _('Game Mode'),
            subtitle: _('Disable animations when a fullscreen app is active'),
            icon: 'input-gaming-symbolic',
        }).row);

        compatGroup.add(this._createSwitchRow(settings, {
            key: 'compatibility-delay',
            title: _('Slow Player Workaround'),
            subtitle: _('Adds a slight delay to track changes (fixes sync issues)'),
            icon: 'preferences-system-time-symbolic',
        }).row);

        const filterModeRow = this._createIntComboRow(settings, {
            key: 'player-filter-mode',
            title: _('Player Filter Mode'),
            subtitle: _('Choose how to filter media players (e.g. browsers)'),
            icon: 'view-list-symbolic',
            labels: [
                _('Off (Allow All)'),
                _('Blacklist (Exclude listed)'),
                _('Whitelist (Only allow listed)'),
            ],
        });
        compatGroup.add(filterModeRow);

        const filterListRow = new Adw.EntryRow({
            title: _('Filtered Players (comma separated)'),
            text: settings.get_string('player-filter-list'),
        });
        settings.bind('player-filter-list', filterListRow, 'text', Gio.SettingsBindFlags.DEFAULT);
        compatGroup.add(filterListRow);

        const detectedPlayersRow = new Adw.ActionRow({
            title: _('Detected Players'),
            subtitle: _('Click an active player to add it to the filter list'),
        });

        const refreshBtn = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            margin_end: 10,
            css_classes: ['flat'],
        });
        detectedPlayersRow.add_prefix(refreshBtn);

        const playerBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });
        detectedPlayersRow.add_suffix(playerBox);

        const updateDetected = () => {
            let child = playerBox.get_first_child();
            while (child) {
                const next = child.get_next_sibling();
                playerBox.remove(child);
                child = next;
            }

            try {
                const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
                connection.call(
                    'org.freedesktop.DBus',
                    '/org/freedesktop/DBus',
                    'org.freedesktop.DBus',
                    'ListNames',
                    null,
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (c, res) => {
                        try {
                            const r = c.call_finish(res);
                            const names = r.deep_unpack()[0];
                            const mpris = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));
                            const apps = [...new Set(mpris.map(n => n.replace('org.mpris.MediaPlayer2.', '').split('.')[0]))];

                            if (apps.length === 0) {
                                playerBox.append(new Gtk.Label({ label: _('No players found') }));
                            } else {
                                apps.forEach(app => {
                                    const btn = new Gtk.Button({ label: app, css_classes: ['suggested-action'] });
                                    btn.connect('clicked', () => {
                                        const current = settings.get_string('player-filter-list');
                                        const list = current.split(',').map(s => s.trim()).filter(s => s.length > 0);
                                        if (!list.includes(app)) {
                                            list.push(app);
                                            settings.set_string('player-filter-list', list.join(', '));
                                        }
                                    });
                                    playerBox.append(btn);
                                });
                            }
                        } catch (_) {}
                    }
                );
            } catch (_) {}
        };

        refreshBtn.connect('clicked', updateDetected);
        updateDetected();

        const updateFilterSensitivity = () => {
            const active = settings.get_int('player-filter-mode') !== 0;
            filterListRow.set_sensitive(active);
            detectedPlayersRow.set_sensitive(active);
        };
        settings.connect('changed::player-filter-mode', updateFilterSensitivity);
        updateFilterSensitivity();

        compatGroup.add(detectedPlayersRow);
        systemPage.add(compatGroup);

        // --- Group 3: App ID Mapping Guide & Saved Mappings ---
        const mappingHelpGroup = new Adw.PreferencesGroup();
        const helpExpander = new Adw.ExpanderRow({
            title: _('💡 How to find the correct App ID?'),
            subtitle: _('Click here for a quick guide and examples'),
        });

        const helpLabel = new Gtk.Label({
            label: _('To allow the extension to open/close your player, you need to provide its exact window name (App ID).\n\n' +
                '<b>Common Examples:</b>\n' +
                '• Spotify (Flatpak): <b>com.spotify.Client</b>\n' +
                '• VLC: <b>vlc</b>\n' +
                '• YouTube Music (Web App): <b>youtube-music</b>\n' +
                '• High Tide: <b>io.github.nokse22.high-tide</b>\n' +
                '• Browsers: <b>chromium</b>, <b>firefox</b>, <b>brave-browser</b>\n\n' +
                '<b>How to find it manually:</b>\n' +
                '1. Press <b>Alt + F2</b>, type <b>lg</b>, and press Enter.\n' +
                '2. Click on the <b>Windows</b> tab in the top right corner.\n' +
                '3. Find your music player in the list.\n' +
                '4. Look at the <b>wmclass:</b> or <b>app:</b> field. That is your App ID! <i>(Remove the .desktop part)</i>\n' +
                '5. Press Esc to close the debugger.'),
            use_markup: true,
            justify: Gtk.Justification.LEFT,
            xalign: 0,
            wrap: true,
            margin_top: 15,
            margin_bottom: 15,
            margin_start: 15,
            margin_end: 15,
        });

        helpExpander.add_row(helpLabel);
        mappingHelpGroup.add(helpExpander);
        systemPage.add(mappingHelpGroup);

        const appMappingGroup = new Adw.PreferencesGroup({
            title: _('Saved App Mappings'),
            description: _('Edit the target App ID for manually mapped players, or remove them.'),
        });
        systemPage.add(appMappingGroup);

        const activePlayersGroup = new Adw.PreferencesGroup({
            title: _('Running Players Detection'),
            description: _('Click on a detected player to automatically fill the mapping.'),
        });
        systemPage.add(activePlayersGroup);

        let savedMappingRows = [];
        let detectedPlayerRows = [];
        let isRefreshingMappings = false;

        const refreshMappingRow = new Adw.ActionRow({
            title: _('Refresh List'),
            subtitle: _('Click to scan for active players again'),
        });
        const refreshMappingBtn = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        refreshMappingRow.add_suffix(refreshMappingBtn);
        activePlayersGroup.add(refreshMappingRow);

        const updateDetectedPlayers = () => {
            for (const r of detectedPlayerRows) {
                activePlayersGroup.remove(r);
            }
            detectedPlayerRows = [];

            try {
                const connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
                connection.call(
                    'org.freedesktop.DBus',
                    '/org/freedesktop/DBus',
                    'org.freedesktop.DBus',
                    'ListNames',
                    null,
                    null,
                    Gio.DBusCallFlags.NONE,
                    -1,
                    null,
                    (c, res) => {
                        try {
                            const r = c.call_finish(res);
                            const names = r.deep_unpack()[0];
                            const mprisNames = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.'));

                            if (mprisNames.length === 0) {
                                activePlayersGroup.set_description(_('No active players detected. Open a music app first!'));
                            } else {
                                activePlayersGroup.set_description(_('Select a player to help the extension identify it:'));

                                mprisNames.forEach(fullBusName => {
                                    let shortName = fullBusName.replace('org.mpris.MediaPlayer2.', '');
                                    if (shortName.includes('.instance')) {
                                        shortName = shortName.split('.instance')[0];
                                    }

                                    const currentMapStr = settings.get_string('app-name-mapping') || '';
                                    if (currentMapStr.includes(shortName + ':')) {
                                        return;
                                    }

                                    const row = new Adw.ActionRow({
                                        title: this._escapeMarkup(shortName),
                                        subtitle: this._escapeMarkup(`Bus: ${fullBusName}`),
                                    });

                                    const btn = new Gtk.Button({
                                        label: _('Use This'),
                                        css_classes: ['suggested-action'],
                                        valign: Gtk.Align.CENTER,
                                    });

                                    btn.connect('clicked', () => {
                                        const currentVal = settings.get_string('app-name-mapping');
                                        if (currentVal.includes(shortName + ':')) return;

                                        const newVal = currentVal
                                            ? `${currentVal},${shortName}:ENTER_APP_ID_HERE`
                                            : `${shortName}:ENTER_APP_ID_HERE`;
                                        settings.set_string('app-name-mapping', newVal);

                                        GLib.idle_add_once(() => {
                                            refreshAppMappings();
                                            updateDetectedPlayers();
                                        });
                                    });

                                    row.add_suffix(btn);
                                    activePlayersGroup.add(row);
                                    detectedPlayerRows.push(row);
                                });
                            }
                        } catch (e) {
                            console.error('Error fetching DBus names:', e);
                        }
                    }
                );
            } catch (_) {}
        };

        const refreshAppMappings = () => {
            if (isRefreshingMappings) return;
            isRefreshingMappings = true;

            for (const r of savedMappingRows) {
                appMappingGroup.remove(r);
            }
            savedMappingRows = [];

            const mapStr = settings.get_string('app-name-mapping') || '';
            const pairs = mapStr.split(',').filter(p => p.trim() !== '');

            if (pairs.length === 0) {
                appMappingGroup.set_description(_('No manual mappings saved.'));
                isRefreshingMappings = false;
                return;
            }

            appMappingGroup.set_description(_('Type the correct App ID, then hit Enter or click the Save icon!'));

            pairs.forEach(pair => {
                const parts = pair.split(':');
                if (parts.length >= 2) {
                    const mprisName = parts[0].trim();
                    const targetId = parts.slice(1).join(':').trim();

                    const row = new Adw.EntryRow({
                        title: this._escapeMarkup(mprisName),
                        text: targetId,
                    });

                    const btnBox = new Gtk.Box({ spacing: 6, valign: Gtk.Align.CENTER });

                    const saveBtn = new Gtk.Button({
                        icon_name: 'document-save-symbolic',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['flat', 'suggested-action'],
                        tooltip_text: _('Save App ID'),
                    });

                    const saveAction = () => {
                        const newId = row.text.trim();
                        if (newId === '') return;

                        const currentStr = settings.get_string('app-name-mapping') || '';
                        const currentPairs = currentStr.split(',').filter(p => p.trim() !== '');

                        const newPairs = currentPairs.map(p => {
                            if (p.startsWith(mprisName + ':')) {
                                return `${mprisName}:${newId}`;
                            }
                            return p;
                        });

                        settings.set_string('app-name-mapping', newPairs.join(','));

                        saveBtn.set_icon_name('object-select-symbolic');
                        GLib.timeout_add_once(1500, () => {
                            if (saveBtn) saveBtn.set_icon_name('document-save-symbolic');
                        });
                    };

                    saveBtn.connect('clicked', saveAction);
                    row.connect('apply', saveAction);

                    const deleteBtn = new Gtk.Button({
                        icon_name: 'user-trash-symbolic',
                        valign: Gtk.Align.CENTER,
                        css_classes: ['flat', 'destructive-action'],
                        tooltip_text: _('Delete Mapping'),
                    });

                    deleteBtn.connect('clicked', () => {
                        const currentStr = settings.get_string('app-name-mapping') || '';
                        const currentPairs = currentStr.split(',').filter(p => p.trim() !== '');
                        const newPairs = currentPairs.filter(p => !p.startsWith(mprisName + ':'));
                        settings.set_string('app-name-mapping', newPairs.join(','));

                        GLib.idle_add_once(() => {
                            refreshAppMappings();
                            updateDetectedPlayers();
                        });
                    });

                    btnBox.append(saveBtn);
                    btnBox.append(deleteBtn);
                    row.add_suffix(btnBox);

                    appMappingGroup.add(row);
                    savedMappingRows.push(row);
                }
            });

            isRefreshingMappings = false;
        };

        refreshMappingBtn.connect('clicked', updateDetectedPlayers);
        refreshAppMappings();
        updateDetectedPlayers();

        // --- Group 4: Backup & Restore ---
        const backupGroup = new Adw.PreferencesGroup({
            title: this._escapeMarkup(_('Backup & Restore')),
        });

        const exportRow = new Adw.ActionRow({ title: _('Export Settings') });
        this._addRowIcon(exportRow, 'document-save-symbolic');
        const exportBtn = new Gtk.Button({ label: _('Export'), valign: Gtk.Align.CENTER });
        exportBtn.connect('clicked', () => {
            const data = {};
            PREFS_KEYS.forEach(k => {
                data[k] = settings.get_value(k).deep_unpack();
            });
            const dialog = new Gtk.FileDialog({
                title: _('Save Settings'),
                initial_name: 'music-pill-backup.json',
            });
            dialog.save(null, null, (dlg, res) => {
                try {
                    const file = dlg.save_finish(res);
                    if (file) {
                        const bytes = new GLib.Bytes(new TextEncoder().encode(JSON.stringify(data, null, 2)));
                        file.replace_contents_bytes_async(bytes, null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null, null);
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        });
        exportRow.add_suffix(exportBtn);
        backupGroup.add(exportRow);

        const importRow = new Adw.ActionRow({ title: _('Import Settings') });
        this._addRowIcon(importRow, 'document-open-symbolic');
        const importBtn = new Gtk.Button({ label: _('Import'), valign: Gtk.Align.CENTER });
        importBtn.connect('clicked', () => {
            const dialog = new Gtk.FileDialog({ title: _('Open Settings Backup') });
            dialog.open(null, null, (dlg, res) => {
                try {
                    const file = dlg.open_finish(res);
                    if (file) {
                        file.load_contents_async(null, (f, r) => {
                            try {
                                const [ok, contents] = f.load_contents_finish(r);
                                if (ok) {
                                    const data = JSON.parse(new TextDecoder().decode(contents));
                                    PREFS_KEYS.forEach(k => {
                                        if (data[k] !== undefined) {
                                            const type = settings.get_default_value(k).get_type_string();
                                            settings.set_value(k, new GLib.Variant(type, data[k]));
                                        }
                                    });
                                    refreshAppMappings();
                                    updateDetectedPlayers();
                                }
                            } catch (e) {
                                console.error(e);
                            }
                        });
                    }
                } catch (e) {
                    console.error(e);
                }
            });
        });
        importRow.add_suffix(importBtn);
        backupGroup.add(importRow);
        systemPage.add(backupGroup);

        // --- Group 5: Art Cache ---
        const cacheGroup = new Adw.PreferencesGroup({
            title: _('Art Cache'),
        });

        const ownCacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-music-pill', 'art']);

        const getCacheInfo = () => {
            try {
                const dir = Gio.File.new_for_path(ownCacheDir);
                if (!dir.query_exists(null)) return { count: 0, size: 0 };
                const en = dir.enumerate_children('standard::size', Gio.FileQueryInfoFlags.NONE, null);
                let count = 0;
                let size = 0;
                let fi;
                while ((fi = en.next_file(null)) !== null) {
                    count++;
                    size += fi.get_size();
                }
                en.close(null);
                return { count, size };
            } catch (_) {
                return { count: 0, size: 0 };
            }
        };

        const formatSize = (bytes) => {
            if (bytes < 1024) return `${bytes} B`;
            if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
            return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
        };

        const buildCacheSubtitle = (info) => `${info.count} ${_('covers cached')}  —  ${formatSize(info.size)}`;

        const cacheRow = new Adw.ActionRow({
            title: _('Album Art Cache'),
            subtitle: buildCacheSubtitle(getCacheInfo()),
        });
        this._addRowIcon(cacheRow, 'folder-pictures-symbolic');

        const clearCacheBtn = new Gtk.Button({
            label: _('Clear'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        clearCacheBtn.connect('clicked', () => {
            try {
                const dir = Gio.File.new_for_path(ownCacheDir);
                if (dir.query_exists(null)) {
                    const en = dir.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
                    let fi;
                    while ((fi = en.next_file(null)) !== null) {
                        dir.get_child(fi.get_name()).delete(null);
                    }
                    en.close(null);
                }
            } catch (_) {}
            cacheRow.subtitle = buildCacheSubtitle(getCacheInfo());
        });

        cacheRow.add_suffix(clearCacheBtn);
        cacheGroup.add(cacheRow);
        systemPage.add(cacheGroup);

        // --- Group 6: Danger Zone ---
        const resetGroup = new Adw.PreferencesGroup({
            title: _('Danger Zone'),
        });
        const resetRow = new Adw.ActionRow({
            title: _('Factory Reset'),
        });
        this._addRowIcon(resetRow, 'edit-clear-all-symbolic');
        const resetBtn = new Gtk.Button({
            label: _('Reset All'),
            valign: Gtk.Align.CENTER,
            css_classes: ['destructive-action'],
        });
        resetBtn.connect('clicked', () => {
            PREFS_KEYS.forEach(k => settings.reset(k));
            refreshAppMappings();
            updateDetectedPlayers();
        });
        resetRow.add_suffix(resetBtn);
        resetGroup.add(resetRow);
        systemPage.add(resetGroup);

        window.add(systemPage);
    }

    // =========================================================================
    // 7. ABOUT & CHANGELOG PAGE (Project Info, Links & What's New)
    // =========================================================================

    _buildAboutPage(window) {
        const aboutPage = new Adw.PreferencesPage({
            title: _('About'),
            icon_name: 'help-about-symbolic',
        });

        // --- Group 1: Project Overview & Support Links ---
        const supportGroup = new Adw.PreferencesGroup({
            title: _('Support the Project'),
        });

        const versionName = this.metadata?.['version-name'] || '1.5.1';
        const infoRow = new Adw.ActionRow({
            title: this.metadata?.name || 'Dynamic Music Pill',
            subtitle: `v${versionName} • GNOME Shell Extension`,
        });
        this._addRowIcon(infoRow, 'audio-x-generic-symbolic');

        const weblateBtn = new Gtk.Button({
            label: 'Weblate',
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        weblateBtn.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri('https://hosted.weblate.org/engage/dynamic-music-pill/', null);
        });
        infoRow.add_suffix(weblateBtn);
        supportGroup.add(infoRow);

        const githubRow = new Adw.ActionRow({
            title: _('Source Code'),
            subtitle: _('Report bugs or view source on GitHub'),
        });
        this._addRowIcon(githubRow, 'system-software-install-symbolic');
        const githubBtn = new Gtk.Button({
            icon_name: 'external-link-symbolic',
            valign: Gtk.Align.CENTER,
        });
        githubBtn.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri('https://github.com/Andbal23/dynamic-music-pill', null);
        });
        githubRow.add_suffix(githubBtn);
        supportGroup.add(githubRow);

        const kofiRow = new Adw.ActionRow({
            title: _('Support on Ko-fi'),
            subtitle: _('Buy me a coffee on Ko-fi'),
        });
        this._addRowIcon(kofiRow, 'emblem-favorite-symbolic');
        const kofiBtn = new Gtk.Button({
            label: _('Open'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        kofiBtn.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri('https://ko-fi.com/andbal', null);
        });
        kofiRow.add_suffix(kofiBtn);
        supportGroup.add(kofiRow);

        const bmacRow = new Adw.ActionRow({
            title: _('Buy Me a Coffee'),
            subtitle: _('Support via BuyMeACoffee'),
        });
        this._addRowIcon(bmacRow, 'emblem-favorite-symbolic');
        const bmacBtn = new Gtk.Button({
            label: _('Open'),
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
        });
        bmacBtn.connect('clicked', () => {
            Gio.AppInfo.launch_default_for_uri('https://buymeacoffee.com/andbal', null);
        });
        bmacRow.add_suffix(bmacBtn);
        supportGroup.add(bmacRow);

        aboutPage.add(supportGroup);

        // --- Group 2: What's New Interactive Changelog Cards ---
        const whatsNewGroup = new Adw.PreferencesGroup({
            title: _("What's New"),
        });

        CHANGELOG_ENTRIES.forEach(release => {
            const row = new Adw.ExpanderRow({
                title: this._escapeMarkup(release.version),
                subtitle: this._escapeMarkup(release.subtitle),
                expanded: release.expanded,
            });
            this._addRowIcon(row, 'software-update-available-symbolic');

            const label = new Gtk.Label({
                label: release.notes,
                justify: Gtk.Justification.LEFT,
                xalign: 0,
                wrap: true,
                margin_top: 10,
                margin_bottom: 10,
                margin_start: 15,
                margin_end: 15,
            });

            row.add_row(label);
            whatsNewGroup.add(row);
        });

        aboutPage.add(whatsNewGroup);
        window.add(aboutPage);
    }
}
