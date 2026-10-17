import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';
import { smartUnpack, initDTDModule, getDockManager, getPlayerIcon } from './utils.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { MusicPill, ExpandedPlayer, PlayerSelectorMenu } from './ui.js';
import { LyricsClient } from './LyricsClient.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SharedVisualizerEngine } from './visualizerEngine.js';
import { getDockContainer, getSecondaryDockContainers } from './dockIntegration.js';
import { checkBlurRequirements } from './blurHelper.js';



const LYRIC_IFACE_NAME = "org.gnome.Shell.TrayLyric";
const LYRIC_OBJECT_PATH = "/org/gnome/Shell/TrayLyric";

const LYRIC_IFACE_XML = `
<node>
  <interface name="org.gnome.Shell.TrayLyric">
    <method name="LikeThisTrack">
      <arg type="b" name="liked"/>
    </method>
    <method name="UpdateLyric">
      <arg type="s" name="current_lyric"/>
    </method>
    <signal name="UpdateLikedStatus"></signal>
  </interface>
</node>`;

const MPRIS_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
    <property name="Rate" type="d" access="readwrite" />
    <property name="MinimumRate" type="d" access="read" />
    <property name="MaximumRate" type="d" access="read" />
    <property name="Metadata" type="a{sv}" access="read" />
    <property name="PlaybackStatus" type="s" access="read" />
    <property name="Position" type="x" access="read" />
    <property name="Volume" type="d" access="readwrite" />
    <property name="LoopStatus" type="s" access="readwrite" />
    <property name="Shuffle" type="b" access="readwrite" />
    <property name="CanSeek" type="b" access="read" />
    <property name="CanControl" type="b" access="read" />
    <property name="CanPause" type="b" access="read" />
    <property name="CanPlay" type="b" access="read" />
    <property name="CanGoNext" type="b" access="read" />
    <property name="CanGoPrevious" type="b" access="read" />
    <method name="PlayPause"/>
    <method name="Next"/>
    <method name="Previous"/>
    <method name="Seek">
        <arg direction="in" type="x" name="Offset"/>
    </method>
    <method name="SetPosition">
        <arg direction="in" type="o" name="TrackId"/>
        <arg direction="in" type="x" name="Position"/>
    </method>
    <signal name="Seeked">
      <arg type="x" name="Position"/>
    </signal>
    </interface>
  <interface name="org.mpris.MediaPlayer2">
    <property name="Identity" type="s" access="read"/>
    <property name="DesktopEntry" type="s" access="read"/>
    <method name="Raise"/>
    <method name="Quit"/>
  </interface>
</node>`;

export class MusicController {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension._settings;
        this._proxies = new Map();

        this._artCache = new Map();
        this._artCacheMax = 50;
        this._ownArtCacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-music-pill', 'art']);
        GLib.mkdir_with_parents(this._ownArtCacheDir, 0o755);
        this._soupSession = new Soup.Session();
        this._downloadingArts = new Set();

        this._NodeInfo = Gio.DBusNodeInfo.new_for_xml(MPRIS_IFACE);
        this._PlayerInterfaceInfo = this._NodeInfo.interfaces.find(i => i.name === 'org.mpris.MediaPlayer2.Player');
        this._connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);

        this._expandedPlayer = null;
        this._lastWinnerName = null;
        this._lastActionTime = 0;
        this._currentDock = null;
        this._mirrorPills = new Map();
        this._activePill = null;
        this._dragFixDashes = new Set();
        this._isMovingItem = false;

        this._trackHistory = [];
        let stored = this._settings.get_string('playback-history');
        if (stored) {
            try {
                this._trackHistory = JSON.parse(stored) || [];
            } catch {
                this._trackHistory = [];
            }
        }

        this._sleepTimerId = null;
        this._sleepTimerActive = false;
        this._sleepTimerEndTime = null;

        // Network lyrics acquisition related
        this._lyricsClient = new LyricsClient();
        this._fetchedLyricsData = null;
        this._fetchedTrackKey = null;
        this._lyricsTimerId = null;
        this._dbusLyricActive = false;
        this._lastLyricIndex = -1;

        this._lyricOwnerId = null;
        this._lyricIfaceInfo = null;

        this._createPill();

        GLib.idle_add(GLib.PRIORITY_LOW, () => {
            this._cleanupDiskCache();
            return GLib.SOURCE_REMOVE;
        });
    }

    _createPill() {
        if (this._isShuttingDown) return;
        if (this._isCreatingPill) return;
        if (this._pill && this._pill.get_parent()) return;
        this._isCreatingPill = true;
        try {
            this._pill = new MusicPill(this);
            this._pill.connect('destroy', () => {
                this._pill = null;
                if (!this._isShuttingDown && !this._isCreatingPill) {
                    this._queueInject();
                }
            });
        } finally {
            this._isCreatingPill = false;
        }
    }

    _pills() {
        return [this._pill, ...this._mirrorPills.values()].filter(Boolean);
    }

    _getAnchorPill() {
        return (this._activePill && this._pills().includes(this._activePill))
            ? this._activePill
            : (this._pill || this._pills()[0] || null);
    }

    enable() {
        this._isShuttingDown = false;
        this._createPill();
        initDTDModule();

        global.display.connectObject('notify::focus-window', () => this._monitorGameMode(), this);
        this._settings.connectObject('changed::hide-default-player', () => this._updateDefaultPlayerVisibility(), this);
        Main.uiGroup.connectObject(
            'child-added', (_group, actor) => {
                if (actor._simpleTaskbarPanelBox === 'dock' && this._settings.get_int('target-container') === 0)
                    this._queueInject();
            },
            'child-removed', (_group, actor) => {
                if (actor._simpleTaskbarPanelBox === 'dock' && this._settings.get_int('target-container') === 0)
                    this._queueInject();
            },
            this
        );
        Main.layoutManager.connectObject('monitors-changed', () => this._queueInject(), this);

        if (Main.extensionManager) {
            Main.extensionManager.connectObject('extension-state-changed', (_mgr, ext) => {
                if (ext && (ext.uuid === 'dash-to-dock@micxgx.gmail.com' || ext.uuid === 'ubuntu-dock@ubuntu.com')) {
                    if (ext.state === 1) {
                        let p = initDTDModule();
                        if (p) {
                            p.then(() => {
                                if (!this._isShuttingDown) {
                                    this._queueInject();
                                }
                            });
                        } else {
                            this._queueInject();
                        }
                    }
                }
            }, this);
        }

        if (Main.layoutManager._startingUp) {
            this._startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupCompleteId);
                this._startupCompleteId = null;
                GLib.timeout_add(GLib.PRIORITY_DEFAULT, 250, () => {
                    if (!this._isShuttingDown) this._doEnable();
                    return GLib.SOURCE_REMOVE;
                });
            });
        } else {
            this._doEnable();
        }
    }

    _doEnable() {
        this._inject();
        this._ownerId = this._connection.signal_subscribe(
            'org.freedesktop.DBus', 'org.freedesktop.DBus', 'NameOwnerChanged',
            '/org/freedesktop/DBus', null, Gio.DBusSignalFlags.NONE, () => this._scan()
        );
        this._scan();
        this._updateUI();
        this._settings.connectObject('changed::player-filter-mode', () => this._scan(), this);
        this._settings.connectObject('changed::player-filter-list', () => this._scan(), this);

        this._watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 2, () => {
            this._monitorGameMode();
            let target = this._settings ? this._settings.get_int('target-container') : 0;
            let expectedContainer = null;
            if (target === 0) {
                let docks = this._dockContainers();
                expectedContainer = docks[0] || null;
            } else if (target === 1) expectedContainer = Main.panel._leftBox;
            else if (target === 2) expectedContainer = Main.panel._centerBox;
            else if (target === 3) expectedContainer = Main.panel._rightBox;

            let parent = this._pill ? this._pill.get_parent() : null;
            if (!this._pill || !parent || (expectedContainer && parent !== expectedContainer)) {
                this._inject();
            } else if (this._settings.get_boolean('always-show-pill') && (!this._pill._isActiveState || this._pill.opacity === 0)) {
                this._updateUI();
            }
            return GLib.SOURCE_CONTINUE;
        });
        this._itemDragBeginId = Main.overview.connect('item-drag-begin', () => {
            this._isUserDragging = true;
        });
        this._itemDragEndId = Main.overview.connect('item-drag-end', () => {
            this._isUserDragging = false;
            this._queueInject();
        });
        this._updateDefaultPlayerVisibility();
        this._createLyricProxy();
        this._settings.connectObject('changed::enable-lyrics', () => {
            if (!this._settings.get_boolean('enable-lyrics')) {
                this._pills().forEach(p => p.setLyric(null));
                this._stopLyricsTimer();
                this._fetchedLyricsData = null;
                this._fetchedTrackKey = null;
                this._dbusLyricActive = false;
            } else {
                this._triggerUpdate();
            }
        }, this);
        this._settings.connectObject('changed::lyrics-language-preference', () => {
            this._fetchedTrackKey = null;
            this._fetchedLyricsData = null;
            this._lastLyricIndex = -1;

            if (this._settings.get_boolean('enable-lyrics') && !this._dbusLyricActive) {
                let player = this._getActivePlayer();
                if (player) this._fetchNetworkLyrics(player);
            }
        }, this);
        this._settings.connectObject(
            'changed::enable-blur-pill', () => {
                if (this._settings.get_boolean('enable-blur-pill')) {
                    if (!checkBlurRequirements()) {
                        this._settings.set_boolean('enable-blur-pill', false);
                        return;
                    }
                    if (this._settings.get_boolean('enable-transparency')) {
                        this._settings.set_boolean('enable-transparency', false);
                    }
                }
            },
            'changed::enable-blur-popup', () => {
                if (this._settings.get_boolean('enable-blur-popup')) {
                    if (!checkBlurRequirements()) {
                        this._settings.set_boolean('enable-blur-popup', false);
                        return;
                    }
                    if (this._settings.get_boolean('enable-transparency')) {
                        this._settings.set_boolean('enable-transparency', false);
                    }
                    if (this._settings.get_boolean('popup-follow-transparency')) {
                        this._settings.set_boolean('popup-follow-transparency', false);
                    }
                }
            },
            'changed::enable-transparency', () => {
                if (this._settings.get_boolean('enable-transparency')) {
                    if (this._settings.get_boolean('enable-blur-pill')) {
                        this._settings.set_boolean('enable-blur-pill', false);
                    }
                    if (this._settings.get_boolean('enable-blur-popup')) {
                        this._settings.set_boolean('enable-blur-popup', false);
                    }
                }
            },
            'changed::popup-follow-transparency', () => {
                if (this._settings.get_boolean('popup-follow-transparency')) {
                    if (this._settings.get_boolean('enable-blur-popup')) {
                        this._settings.set_boolean('enable-blur-popup', false);
                    }
                }
            },
            this
        );
    }

    disable() {
        this._isShuttingDown = true;
        if (this._artMonitor) {
            this._artMonitor.cancel();
            this._artMonitor = null;
        }
        if (this._artMonitorDebounce) {
            GLib.Source.remove(this._artMonitorDebounce);
            this._artMonitorDebounce = null;
        }
        if (this._retryArtTimer) {
            GLib.Source.remove(this._retryArtTimer);
            this._retryArtTimer = null;
        }
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = null;
        }

        if (this._itemDragBeginId) {
            Main.overview.disconnect(this._itemDragBeginId);
            this._itemDragBeginId = null;
        }
        if (this._itemDragEndId) {
            Main.overview.disconnect(this._itemDragEndId);
            this._itemDragEndId = null;
        }

        if (this._currentDock) {
            this._currentDock.disconnectObject(this);
            this._currentDock = null;
        }

        this._teardownDragFix();

        global.display.disconnectObject(this);
        this._settings.disconnectObject(this);
        Main.uiGroup.disconnectObject(this);
        Main.layoutManager.disconnectObject(this);
        if (Main.extensionManager) Main.extensionManager.disconnectObject(this);

        if (this._feedbackTimer) {
            GLib.Source.remove(this._feedbackTimer);
            this._feedbackTimer = null;
        }

        if (this._injectTimeout) { GLib.Source.remove(this._injectTimeout); this._injectTimeout = null; }
        if (this._watchdog) { GLib.Source.remove(this._watchdog); this._watchdog = null; }
        if (this._recheckTimer) { GLib.Source.remove(this._recheckTimer); this._recheckTimer = null; }
        if (this._updateTimeoutId) { GLib.Source.remove(this._updateTimeoutId); this._updateTimeoutId = null; }
        if (this._retryArtTimer) { GLib.Source.remove(this._retryArtTimer); this._retryArtTimer = null; }
        this.cancelSleepTimer();

        if (this._ownerId) {
            this._connection.signal_unsubscribe(this._ownerId);
            this._ownerId = null;
        }

        if (this._lyricObjectId && this._connection) {
            this._connection.unregister_object(this._lyricObjectId);
            this._lyricObjectId = null;
        }

        if (this._lyricOwnerId) {
            Gio.bus_unown_name(this._lyricOwnerId);
            this._lyricOwnerId = null;
        }

        // Clear the web lyrics
        this._stopLyricsTimer();
        if (this._lyricsClient) {
            this._lyricsClient.destroy();
            this._lyricsClient = null;
        }
        this._fetchedLyricsData = null;
        this._fetchedTrackKey = null;

        if (this._expandedPlayer) {
            this._expandedPlayer.destroy();
            this._expandedPlayer = null;
        }
        for (const pill of this._mirrorPills.values()) {
            pill.destroy();
        }
        this._mirrorPills.clear();
        this._activePill = null;
        if (this._pill) {
            this._pill.destroy();
            this._pill = null;
        }
        for (let name of this._proxies.keys()) {
            this._removeProxy(name);
        }
        this._proxies.clear();

        this._updateDefaultPlayerVisibility(true);
        if (this._soupSession) {
            try { this._soupSession.abort(); } catch {}
            this._soupSession = null;
        }
        if (this._downloadingArts) {
            this._downloadingArts.clear();
        }
        SharedVisualizerEngine.destroy();
    }

    performAction(action) {
        if (action === 'play_pause') this.togglePlayback();
        else if (action === 'next') this.next();
        else if (action === 'previous') this.previous();
        else if (action === 'open_app') this.openApp();
        else if (action === 'toggle_menu') this.toggleMenu();
        else if (action === 'open_player_menu') this.togglePlayerMenu();
        else if (action === 'open_settings') this.openSettings();
        else if (action === 'close_app') this.closeApp();
    }

    openSettings() {
        if (this._extension) {
            this._extension.openPreferences();
        }
    }

    _getCustomAppMapping() {
        let mapping = {};
        if (this._settings) {
            let mapStr = this._settings.get_string('app-name-mapping') || '';
            let pairs = mapStr.split(',');
            for (let pair of pairs) {
                let parts = pair.split(':');
                if (parts.length === 2) {
                    mapping[parts[0].trim().toLowerCase()] = parts[1].trim().toLowerCase();
                }
            }
        }
        return mapping;
    }

    closeApp() {
        let player = this._getActivePlayer();
        if (!player) return;

        let busName = player._busName;

        this._connection.call(
            busName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2',
            'Quit',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Quit call failed: ${e.message}`);
                }
            }
        );

        let parts = busName.replace('org.mpris.MediaPlayer2.', '').split('.');

        let rawBus = parts[0].toLowerCase();
        let fullBusId = parts.join('.').toLowerCase();
        let identity = (player._identity || '').toLowerCase();

        let customMapping = this._getCustomAppMapping();
        let killTarget = customMapping[fullBusId] || customMapping[rawBus] || customMapping[identity] || player._desktopEntry;
        if (killTarget === 'enter_app_id_here') killTarget = player._desktopEntry;

        if (!killTarget) {
            if (['org', 'com', 'net', 'io'].includes(parts[0]) && parts.length >= 3) {
                killTarget = parts.slice(0, 3).join('.');
            } else {
                killTarget = parts[0];
            }
        }

        if (killTarget) {
            killTarget = killTarget.toLowerCase();

            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 800, () => {
                if (!this._proxies.has(busName)) return GLib.SOURCE_REMOVE;

                try {
                    if (killTarget.includes('.')) {
                        Gio.Subprocess.new(['flatpak', 'kill', killTarget], Gio.SubprocessFlags.NONE);
                    }
                    Gio.Subprocess.new(['pkill', '-f', killTarget], Gio.SubprocessFlags.NONE);
                } catch (e) {
                    console.debug("[Dynamic Music Pill] Failed to hard kill: " + killTarget);
                }
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    openApp() {
        let player = this._getActivePlayer();
        let last = (!player) ? this.getLastPlayedTrack() : null;
        if (!player && !last) return;

        let busName = player ? (player._busName || '') : (last.busName || '');
        let desktopEntry = player ? (player._desktopEntry || '') : (last.desktopEntry || '');
        let identity = player ? (player._identity || '') : (last.identity || '');
        let trackUrl = null;
        if (player && player.Metadata) {
            let metaObj = (player.Metadata instanceof GLib.Variant) ? player.Metadata.deep_unpack() : player.Metadata;
            if (metaObj && metaObj['xesam:url']) trackUrl = smartUnpack(metaObj['xesam:url']);
        } else if (last && last.url) {
            trackUrl = last.url;
        }

        let appSystem = Shell.AppSystem.get_default();
        let runningApps = appSystem.get_running();

        let busNameParts = busName.replace('org.mpris.MediaPlayer2.', '').split('.');
        let rawBus = busNameParts[0].toLowerCase();
        let fullBusId = busNameParts.join('.').toLowerCase();

        let desktop = desktopEntry.toLowerCase();
        let id = identity.toLowerCase();

        let customMapping = this._getCustomAppMapping();
        let customTarget = customMapping[fullBusId] || customMapping[rawBus] || customMapping[id] || null;
        if (customTarget === 'enter_app_id_here') customTarget = null;

        let matchedApp = null;

        for (let app of runningApps) {
            let appId = app.get_id().toLowerCase();
            let appName = app.get_name().toLowerCase();

            if (customTarget && (appId.includes(customTarget) || appName.includes(customTarget))) {
                matchedApp = app;
                break;
            } else if (!customTarget && desktop && appId.includes(desktop)) {
                matchedApp = app;
                break;
            } else if (!customTarget && id && appName === id) {
                matchedApp = app;
                break;
            } else if (!customTarget && appId.includes(fullBusId)) {
                matchedApp = app;
                break;
            }
        }

        if (!matchedApp) {
            for (let app of runningApps) {
                let appId = app.get_id().toLowerCase();
                let appName = app.get_name().toLowerCase();

                if (appId.includes(rawBus) || appName.includes(rawBus)) {
                    matchedApp = app;
                    break;
                }
            }
        }

        let windows = matchedApp ? matchedApp.get_windows() : [];
        if (!windows || windows.length === 0) {
            let searchTerms = [customTarget, desktop, fullBusId, id, rawBus].filter(Boolean);
            windows = global.get_window_actors()
                .map(a => a.meta_window)
                .filter(w => {
                    if (!w || w.is_override_redirect()) return false;
                    let wmClass = (w.get_wm_class() || '').toLowerCase();
                    let wmInstance = (w.get_wm_class_instance() || '').toLowerCase();
                    let gtkId = (w.get_gtk_application_id() || '').toLowerCase();
                    let sandboxId = (w.get_sandboxed_app_id() || '').toLowerCase();
                    return searchTerms.some(t =>
                        wmClass.includes(t) || wmInstance.includes(t) ||
                        gtkId.includes(t) || sandboxId.includes(t)
                    );
                });
        }

        if (windows && windows.length > 0) {
            let activeWs = global.workspace_manager.get_active_workspace();
            let focusWin = global.display.get_focus_window();
            let winToMinimize = windows.find(w =>
                !w.minimized &&
                (!activeWs || w.get_workspace() === activeWs || w.is_on_all_workspaces()) &&
                (w.has_focus() || focusWin === w || (focusWin === null && this._lastRaisedWindow === w))
            );

            if (winToMinimize && player) {
                this._lastRaisedWindow = null;
                winToMinimize.minimize();
                return;
            }

            if (player && player._busName) {
                this._connection.call(
                    player._busName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2', 'Raise',
                    null, null, Gio.DBusCallFlags.NONE, -1, null,
                    (conn, res) => {
                        try {
                            conn.call_finish(res);
                        } catch (e) {
                            console.debug(`[Dynamic Music Pill] Raise call failed: ${e.message}`);
                        }
                    }
                );
            }

            this._lastRaisedWindow = windows[0];
            if (Main.activateWindow) Main.activateWindow(windows[0]);
            else windows[0].activate(global.get_current_time());
            return;
        }

        if (trackUrl && (trackUrl.startsWith('http://') || trackUrl.startsWith('https://'))) {
            let browserApp = null;
            let candidates = [
                customTarget ? customTarget + '.desktop' : null,
                customTarget,
                desktop ? desktop + '.desktop' : null,
                desktop,
                rawBus ? rawBus + '.desktop' : null,
                rawBus
            ].filter(Boolean);

            for (let c of candidates) {
                browserApp = appSystem.lookup_app(c);
                if (browserApp) break;
            }

            let launchCtx = global.create_app_launch_context(0, -1);
            if (browserApp) {
                try {
                    if (typeof browserApp.launch_uris === 'function') {
                        browserApp.launch_uris([trackUrl], launchCtx);
                        return;
                    }
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Failed to launch browser with URI: ${e.message}`);
                }
            }
            try {
                Gio.AppInfo.launch_default_for_uri(trackUrl, launchCtx);
                return;
            } catch (e) {
                console.debug(`[Dynamic Music Pill] Failed to launch default browser for URI: ${e.message}`);
            }
        }

        if (!matchedApp) {
            let appCandidates = [
                customTarget ? customTarget + '.desktop' : null,
                customTarget,
                desktop ? desktop + '.desktop' : null,
                desktop,
                rawBus ? rawBus + '.desktop' : null,
                rawBus
            ].filter(Boolean);

            for (let candidate of appCandidates) {
                matchedApp = appSystem.lookup_app(candidate);
                if (matchedApp) break;
            }
        }

        if (!matchedApp) {
            let searchTerms = [customTarget, desktop, rawBus, id].filter(Boolean);
            let installed = appSystem.get_installed();
            for (let app of installed) {
                let appId = (app.get_id() || '').toLowerCase();
                let appName = (app.get_name() || '').toLowerCase();
                if (searchTerms.some(t => appId.includes(t) || appName.includes(t))) {
                    let shellApp = appSystem.lookup_app(app.get_id());
                    matchedApp = shellApp || app;
                    break;
                }
            }
        }

        if (matchedApp) {
            let launchCtx = global.create_app_launch_context(0, -1);
            if (trackUrl && (trackUrl.startsWith('spotify:') || trackUrl.startsWith('file://'))) {
                try {
                    if (typeof matchedApp.launch_uris === 'function') {
                        matchedApp.launch_uris([trackUrl], launchCtx);
                        return;
                    }
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Failed to launch app with URI: ${e.message}`);
                }
            }
            try {
                if (typeof matchedApp.activate === 'function') {
                    matchedApp.activate();
                    return;
                } else if (typeof matchedApp.launch === 'function') {
                    matchedApp.launch([], launchCtx);
                    return;
                }
            } catch (e) {
                console.debug(`[Dynamic Music Pill] Failed to activate/launch app: ${e.message}`);
            }
        }

        let cmdTarget = customTarget || desktop || rawBus;
        if (cmdTarget) {
            try {
                let appInfo = Gio.DesktopAppInfo.new(cmdTarget + '.desktop') || Gio.DesktopAppInfo.new(cmdTarget);
                if (appInfo) {
                    appInfo.launch([], global.create_app_launch_context(0, -1));
                } else {
                    Gio.AppInfo.create_from_commandline(cmdTarget, null, Gio.AppInfoCreateFlags.NONE).launch([], null);
                }
            } catch (e) {
                console.debug(`[Dynamic Music Pill] Failed final launch attempt: ${e.message}`);
            }
        }
    }

    togglePlayerMenu() {
        if (this._playerMenu) {
            this._playerMenu.hide();
            return;
        }

        this._playerMenu = new PlayerSelectorMenu(this);
        Main.layoutManager.addChrome(this._playerMenu);
        this._playerMenu.showMenu();
    }

    closePlayerMenu() {
        if (this._playerMenu) {
            Main.layoutManager.removeChrome(this._playerMenu);
            this._playerMenu.destroy();
            this._playerMenu = null;
        }
    }

    toggleMenu() {
        if (this._expandedPlayer) {
            if (this._expandedPlayer._isHiding) {
                this.closeMenu();
            } else {
                this._expandedPlayer.hide();
                return;
            }
        }

        let pill = this._getAnchorPill();
        if (!pill) return;

        let player = this._getActivePlayer();
        if (!player) {
            this.openApp();
            return;
        }

        this._expandedPlayer = new ExpandedPlayer(this, pill);
        Main.layoutManager.addChrome(this._expandedPlayer);

        let c = pill._displayedColor;
        this._expandedPlayer.updateStyle(c.r, c.g, c.b, pill._currentBgAlpha);

        let artUrl = pill._lastArtUrl;
        this._expandedPlayer.showFor(player, artUrl);
    }

    closeMenu() {
        if (this._expandedPlayer) {
            let ep = this._expandedPlayer;
            this._expandedPlayer = null;
            try { Main.layoutManager.removeChrome(ep); } catch (_) {}
            try { ep.destroy(); } catch (_) {}
        }
    }

    _isGameModeActive() {
        if (!this._settings || !this._settings.get_boolean('enable-gamemode')) return false;
        if (Main.overview.visible) return false;

        let win = global.display.get_focus_window();
        if (win && win.get_monitor() === Main.layoutManager.primaryIndex) {
            if (win.is_fullscreen()) {
                return true;
            }
        }
        return false;
    }

    _monitorGameMode() {
        let isGame = this._isGameModeActive();
        for (const pill of this._pills()) pill.setGameMode(isGame);
    }

    _queueInject() {
        if (this._injectTimeout) GLib.Source.remove(this._injectTimeout);
        this._injectTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._inject();
            this._injectTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _ensurePosition(container, pill = this._pill) {
        if (!container || !pill || this._isMovingItem || this._isUserDragging) return false;

        let mode = this._settings ? this._settings.get_int('position-mode') : 1;
        let manualIndex = this._settings ? this._settings.get_int('dock-position') : 0;

        let children = container.get_children();
        let otherChildren = children.filter(c => c !== pill);
        let realItemCount = otherChildren.length;
        let targetIndex = 0;

        if (mode === 0) { targetIndex = manualIndex; }
        else if (mode === 1) { targetIndex = 0; }
        else if (mode === 2) { targetIndex = Math.floor(realItemCount / 2); }
        else if (mode === 3) { targetIndex = realItemCount; }

        if (targetIndex > realItemCount) targetIndex = realItemCount;
        if (targetIndex < 0) targetIndex = 0;

        let currentIndex = children.indexOf(pill);
        let pillParent = pill.get_parent();

        if (currentIndex === -1 && pillParent === container) {
            currentIndex = 0;
        }
        if (pillParent && pillParent !== container) {
            pillParent.remove_child(pill);
            currentIndex = -1;
        }

        if (currentIndex !== targetIndex) {
            this._isMovingItem = true;

            if (currentIndex !== -1) {
                container.set_child_at_index(pill, targetIndex);
            } else {
                container.insert_child_at_index(pill, targetIndex);
            }

            this._isMovingItem = false;
            return true;
        }
        return false;
    }

    _inject() {
        if (this._isMovingItem) return;
        if (this._injectTimeout) {
            GLib.Source.remove(this._injectTimeout);
            this._injectTimeout = null;
        }
        if (!this._pill) this._createPill();
        if (!this._pill) return;

        let target = this._settings ? this._settings.get_int('target-container') : 0;
        let container = null;
        let docks = target === 0 ? this._dockContainers() : [];

        if (target === 0) {
            container = docks[0];
        } else if (target === 1) container = Main.panel._leftBox;
        else if (target === 2) container = Main.panel._centerBox;
        else if (target === 3) container = Main.panel._rightBox;

        if (!container) {
            if (target === 0 && !this._isShuttingDown) {
                if (!this._dockRetryCount) this._dockRetryCount = 0;
                if (this._dockRetryCount < 10) {
                    this._dockRetryCount++;
                    GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        if (!this._isShuttingDown) this._inject();
                        return GLib.SOURCE_REMOVE;
                    });
                }
            }
            return;
        }
        this._dockRetryCount = 0;

        let oldParent = this._pill.get_parent();
        let parentChanged = (oldParent && oldParent !== container);

        if (parentChanged) {
            oldParent.remove_child(this._pill);
            if (this._currentDock) {
                this._currentDock.disconnectObject(this);
                this._currentDock = null;
            }
            this._teardownDragFix();
        }

        if (target === 0 && this._currentDock !== container) {
            if (this._currentDock) {
                this._currentDock.disconnectObject(this);
            }
            this._currentDock = container;
            container.connectObject('child-added', (c, actor) => {
                if (actor !== this._pill && !this._isMovingItem) this._queueInject();
            }, this);
            container.connectObject('child-removed', (c, actor) => {
                if (!this._isMovingItem) this._queueInject();
            }, this);
        }

        let moved = this._ensurePosition(container);

        let pills = container.get_children().filter(
            c => c !== this._pill && c instanceof MusicPill
        );
        for (let p of pills) {
            console.debug('[Dynamic Music Pill] Removing duplicate pill from container');
            container.remove_child(p);
            p.destroy();
        }

        if (parentChanged || moved || !oldParent) {
            this._pill._updateDimensions();
        }

        if (target === 0) {
            this._setupDragFix(container);
        }

        this._syncMirrorPills(docks.slice(1));
        this._updateUI();
    }

    _dockContainers() {
        if (!getDockManager()) {
            let p = initDTDModule();
            if (p) {
                p.then(() => {
                    if (!this._isShuttingDown) {
                        this._queueInject();
                    }
                });
            }
        }

        let mode = this._settings ? this._settings.get_int('dock-monitors') : 0;
        if (mode === 0) return [getDockContainer()].filter(Boolean);

        let secondary = getSecondaryDockContainers();
        let mainDock = getDockContainer();
        if (mode === 2 && secondary.length > 0) return secondary;
        return [mainDock, ...secondary].filter(Boolean);
    }

    _syncMirrorPills(docks) {
        for (const [container, pill] of this._mirrorPills) {
            if (!docks.includes(container)) {
                pill.destroy();
                this._mirrorPills.delete(container);
            }
        }

        let created = false;
        for (const container of docks) {
            if (!container) continue;
            let pill = this._mirrorPills.get(container);
            if (!pill) {
                pill = new MusicPill(this, true);
                this._mirrorPills.set(container, pill);
                pill.connect('destroy', () => {
                    this._mirrorPills.delete(container);
                });
                container.connectObject(
                    'child-added', (c, actor) => {
                        if (actor !== pill && !this._isMovingItem) this._queueInject();
                    },
                    'child-removed', () => {
                        if (!this._isMovingItem) this._queueInject();
                    }, pill
                );
                created = true;
            }
            if (this._ensurePosition(container, pill)) pill._updateDimensions();
            this._setupDragFix(container);
        }

        if (created) this._triggerUpdate();
    }

    _setupDragFix(container) {
        const dash = container._delegate;
        if (!dash || !dash.handleDragOver) return;
        if (dash._musicPillOrigHandleDragOver) return;

        const pillIn = () => this._pills().find(p => p.get_parent() === container);

        const _adjustX = (x) => {
            const pill = pillIn();
            if (!pill) return x;
            const pillWidth = pill.get_width();
            const pillX = pill.x;
            if (x > pillX + pillWidth) return x - pillWidth;
            if (x >= pillX) return pillX;
            return x;
        };

        const _adjustWidth = (fn) => {
            const pill = pillIn();
            const pillWidth = pill ? pill.get_width() : 0;
            if (pillWidth > 0) {
                Object.defineProperty(container, 'width', {
                    get() { return container.get_width() - pillWidth; },
                    configurable: true,
                    enumerable: false,
                });
            }
            try { return fn(); }
            finally { if (pillWidth > 0) delete container.width; }
        };

        dash._musicPillOrigHandleDragOver = dash.handleDragOver;
        dash.handleDragOver = (source, actor, x, y, time) =>
            _adjustWidth(() =>
                dash._musicPillOrigHandleDragOver.call(dash, source, actor, _adjustX(x), y, time));

        if (dash.acceptDrop) {
            dash._musicPillOrigAcceptDrop = dash.acceptDrop;
            dash.acceptDrop = (source, actor, x, y, time) => {
                const pill = pillIn();
                const parent = pill ? pill.get_parent() : null;

                if (parent) {
                    this._isMovingItem = true;
                    parent.remove_child(pill);
                    this._isMovingItem = false;
                }

                let result;
                try {
                    result = _adjustWidth(() =>
                        dash._musicPillOrigAcceptDrop.call(dash, source, actor, _adjustX(x), y, time));
                } finally {
                    if (pill && parent) {
                        this._isMovingItem = true;
                        this._ensurePosition(container, pill);
                        this._isMovingItem = false;
                    }
                }
                return result;
            };
        }

        this._dragFixDashes.add(dash);
        dash.connectObject('destroy', () => this._dragFixDashes.delete(dash), this);
    }

    _teardownDragFix() {
        for (const dash of this._dragFixDashes) {
            dash.disconnectObject(this);
            if (dash._musicPillOrigHandleDragOver) {
                dash.handleDragOver = dash._musicPillOrigHandleDragOver;
                delete dash._musicPillOrigHandleDragOver;
            }
            if (dash._musicPillOrigAcceptDrop) {
                dash.acceptDrop = dash._musicPillOrigAcceptDrop;
                delete dash._musicPillOrigAcceptDrop;
            }
        }
        this._dragFixDashes.clear();
    }

    _scan() {
        this._connection.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (c, res) => {
                let r = smartUnpack(c.call_finish(res));
                let names = Array.isArray(r[0]) ? r[0] : (Array.isArray(r) ? r : []);
                let mprisNames = names.filter(n => n.startsWith('org.mpris.MediaPlayer2.') && this._isPlayerAllowed(n));

                let changed = false;

                mprisNames.forEach(n => {
                    if (!this._proxies.has(n)) {
                        this._add(n);
                        changed = true;
                    }
                });

                for (let name of this._proxies.keys()) {
                    if (!mprisNames.includes(name)) {
                        this._removeProxy(name);
                        this._artCache.delete(name);
                        changed = true;
                    }
                }

                if (changed || !this._initialScanDone) {
                    this._initialScanDone = true;
                    this._updateUI();
                }
            }
        );
    }

    _add(name) {
        if (this._proxies.has(name)) return;

        Gio.DBusProxy.new(
            this._connection,
            Gio.DBusProxyFlags.NONE,
            this._PlayerInterfaceInfo,
            name,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            null,
            (source, res) => {
                let p;
                try {
                    p = Gio.DBusProxy.new_finish(res);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Proxy not available for ${name}: ${e.message}`);
                    return;
                }

                p._busName = name;
                p._lastSeen = Date.now();
                p._lastStatusTime = Date.now();

                let status = p.PlaybackStatus;
                p._lastPlayingTime = (status === 'Playing') ? Date.now() : 0;
                p._lastPosition = 0;
                p._lastPositionTime = Date.now();
                p._lastTrackId = null;

                p._seekedId = p.connectSignal('Seeked', (proxy, senderName, [position]) => {
                    if (typeof position === 'number' && position >= 0) {
                        p._lastPosition = position;
                        p._lastPositionTime = Date.now();
                    }
                    this._triggerUpdate();
                    if (this._expandedPlayer && this._expandedPlayer.visible && this._lastWinnerName === p._busName) {
                        this._expandedPlayer._tick();
                    }
                });

                p._propId = p.connect('g-properties-changed', (proxy, changed, invalidated) => {
                    if (!this._proxies.has(p._busName)) return;

                    let keys = changed.deep_unpack();
                    let now = Date.now();

                    p._lastSeen = now;
                    p._lastStatusTime = now;

                    if (keys.PlaybackStatus) {
                        let s = keys.PlaybackStatus;
                        if (s !== 'Playing') {
                            p._lastPosition += (now - p._lastPositionTime) * 1000;
                        }
                        p._lastPositionTime = now;
                        if (s === 'Playing') p._lastPlayingTime = now;
                    }

                    if (keys.Position !== undefined) {
                        let posVal = keys.Position instanceof GLib.Variant ? keys.Position.unpack() : keys.Position;
                        if (typeof posVal === 'number' && posVal >= 0) {
                            p._lastPosition = posVal;
                            p._lastPositionTime = now;
                        }
                        this._triggerUpdate();
                    }

                    if (keys.Metadata !== undefined || keys.PlaybackStatus !== undefined) {
                        let trackId = null;
                        let trackChanged = false;
                        if (keys.Metadata) {
                            let mObj = (keys.Metadata instanceof GLib.Variant) ? keys.Metadata.deep_unpack() : keys.Metadata;
                            trackId = smartUnpack(mObj['mpris:trackid']);

                            if (trackId && trackId !== p._lastTrackId) {
                                p._lastPosition = 0;
                                p._lastPositionTime = Date.now();
                                p._lastTrackId = trackId;
                                trackChanged = true;
                            }
                        }

                        if (trackChanged || keys.PlaybackStatus !== undefined) {
                            this._connection.call(
                                p._busName,
                                '/org/mpris/MediaPlayer2',
                                'org.freedesktop.DBus.Properties',
                                'Get',
                                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                                null, Gio.DBusCallFlags.NONE, -1, null,
                                (conn, asyncRes) => {
                                    let result;
                                    try {
                                        result = conn.call_finish(asyncRes);
                                    } catch (e) {
                                        console.debug(`[Dynamic Music Pill] DBus Get Position failed: ${e.message}`);
                                        return;
                                    }
                                    if (result) {
                                        let posVariant = result.deep_unpack()[0];
                                        if (posVariant) {
                                            let val = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                                            if (typeof val === 'number' && val >= 0) {
                                                p._lastPosition = val;
                                                p._lastPositionTime = Date.now();
                                            }
                                            this._triggerUpdate();
                                        }
                                    }
                                }
                            );
                        }
                    }

                    this._triggerUpdate();
                });

                p._nameOwnerId = p.connect('notify::g-name-owner', () => { this._scan(); });

                p._identity = null;

                this._connection.call(
                    p._busName,
                    '/org/mpris/MediaPlayer2',
                    'org.freedesktop.DBus.Properties',
                    'GetAll',
                    new GLib.Variant('(s)', ['org.mpris.MediaPlayer2']),
                    null, Gio.DBusCallFlags.NONE, -1, null,
                    (conn, asyncRes) => {
                        let result;
                        try {
                            result = conn.call_finish(asyncRes);
                        } catch (e) {
                            console.debug(`[Dynamic Music Pill] DBus GetAll failed: ${e.message}`);
                            return;
                        }
                        if (result) {
                            let props = result.deep_unpack()[0];
                            if (props['Identity']) {
                                let v = props['Identity'];
                                p._identity = v instanceof GLib.Variant ? v.unpack() : v;
                            }
                            if (props['DesktopEntry']) {
                                let v = props['DesktopEntry'];
                                p._desktopEntry = v instanceof GLib.Variant ? v.unpack() : v;
                            }

                            p._gicon = this._resolvePlayerIcon(p);
                            this._triggerUpdate();
                        }
                    }
                );

                this._proxies.set(name, p);

                this._connection.call(
                    p._busName,
                    '/org/mpris/MediaPlayer2',
                    'org.freedesktop.DBus.Properties',
                    'Get',
                    new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                    null, Gio.DBusCallFlags.NONE, -1, null,
                    (conn, asyncRes) => {
                        let result;
                        try {
                            result = conn.call_finish(asyncRes);
                        } catch (e) {
                            console.debug(`[Dynamic Music Pill] DBus Get Position failed: ${e.message}`);
                            return;
                        }
                        if (result) {
                            let posVariant = result.deep_unpack()[0];
                            if (posVariant) {
                                let val = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                                if (typeof val === 'number' && val >= 0) {
                                    p._lastPosition = val;
                                    p._lastPositionTime = Date.now();
                                }
                            }
                        }
                        this._triggerUpdate();
                    }
                );
            }
        );
    }

    _artCacheSet(key, value) {
        if (this._artCache.has(key)) this._artCache.delete(key);
        this._artCache.set(key, value);
        if (this._artCache.size > this._artCacheMax) {
            let evictedKey = this._artCache.keys().next().value;
            this._artCache.delete(evictedKey);
        }

        if (this._cleaningTimeout) {
            GLib.Source.remove(this._cleaningTimeout);
        }
        this._cleaningTimeout = GLib.timeout_add(GLib.PRIORITY_LOW, 5000, () => {
            this._cleaningTimeout = null;
            if (!this._isShuttingDown) {
                this._cleanupDiskCache();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _cleanupDiskCache() {
        let dir = Gio.File.new_for_path(this._ownArtCacheDir);
        if (!dir.query_exists(null)) return;

        let en;
        try {
            en = dir.enumerate_children('standard::name,time::modified', Gio.FileQueryInfoFlags.NONE, null);
        } catch (e) {
            console.debug(`[Dynamic Music Pill] Failed to enumerate art cache: ${e.message}`);
            return;
        }
        let fi;
        let cacheFiles = [];
        let histFiles = [];

        while ((fi = en.next_file(null)) !== null) {
            let name = fi.get_name();
            let time = fi.get_attribute_uint64('time::modified') || 0;
            if (name.startsWith('hist_')) {
                histFiles.push({ name: name, time: time });
            } else if (name.endsWith('.jpg') || name.endsWith('.png')) {
                cacheFiles.push({ name: name, time: time });
            }
        }
        en.close(null);

        cacheFiles.sort((a, b) => b.time - a.time);
        histFiles.sort((a, b) => b.time - a.time);

        if (cacheFiles.length > this._artCacheMax) {
            for (let i = this._artCacheMax; i < cacheFiles.length; i++) {
                let f = dir.get_child(cacheFiles[i].name);
                f.delete_async(GLib.PRIORITY_LOW, null, (obj, res) => {
                    try {
                        obj.delete_finish(res);
                    } catch (e) {
                        console.debug(`[Dynamic Music Pill] Cache cleanup error: ${e.message}`);
                    }
                });
            }
        }

        if (histFiles.length > 30) {
            for (let i = 30; i < histFiles.length; i++) {
                let f = dir.get_child(histFiles[i].name);
                f.delete_async(GLib.PRIORITY_LOW, null, (obj, res) => {
                    try {
                        obj.delete_finish(res);
                    } catch (e) {
                        console.debug(`[Dynamic Music Pill] History cleanup error: ${e.message}`);
                    }
                });
            }
        }
    }


    _resolvePlayerIcon(p) {
        let appSystem = Shell.AppSystem.get_default();
        let busName = p._busName || '';
        let rawParts = busName.replace('org.mpris.MediaPlayer2.', '').split('.');
        let rawBus = rawParts[0].toLowerCase();
        let fullBusId = rawParts.join('.').toLowerCase();

        let identity = (p._identity || '').toLowerCase().replace(/ /g, '-');

        const tryLookup = (id) => {
            if (!id) return null;
            return appSystem.lookup_app(id + '.desktop') ||
                appSystem.lookup_app(id);
        };

        let runningApps = appSystem.get_running();
        let candidates = [rawBus, fullBusId, identity].filter(Boolean);
        for (let app of runningApps) {
            let appId = app.get_id().replace('.desktop', '').toLowerCase();
            let appName = app.get_name().toLowerCase().replace(/ /g, '-');
            for (let c of candidates) {
                if (appId === c || appId.includes(c) || appName === c) {
                    let icon = app.get_icon();
                    if (icon) return icon;
                }
            }
        }

        let app = tryLookup(rawBus) || tryLookup(fullBusId);
        if (app) { let icon = app.get_icon(); if (icon) return icon; }

        if (p._desktopEntry) {
            let deApp = tryLookup(p._desktopEntry);
            if (deApp) { let icon = deApp.get_icon(); if (icon) return icon; }
        }

        return getPlayerIcon(p, p._busName);
    }

    _removeProxy(name) {
        let p = this._proxies.get(name);
        if (p) {
            if (p._seekedId) p.disconnectSignal(p._seekedId);
            if (p._propId) p.disconnect(p._propId);
            if (p._nameOwnerId) p.disconnect(p._nameOwnerId);
            this._proxies.delete(name);
        }
    }

    _createLyricProxy() {
        let lyricNodeInfo = Gio.DBusNodeInfo.new_for_xml(LYRIC_IFACE_XML);
        this._lyricIfaceInfo = lyricNodeInfo.lookup_interface(LYRIC_IFACE_NAME);

        this._lyricOwnerId = Gio.bus_own_name(
            Gio.BusType.SESSION,
            LYRIC_IFACE_NAME,
            Gio.BusNameOwnerFlags.NONE,
            (connection) => {
                this._lyricObjectId = connection.register_object(
                    LYRIC_OBJECT_PATH,
                    this._lyricIfaceInfo,
                    this._onLyricMethodCall.bind(this),
                    null,
                    null,
                );
            },
            null,
            null,
        );
    }

    _onLyricMethodCall(connection, sender, objectPath, interfaceName, methodName, parameters, invocation) {
        if (methodName === "UpdateLyric") {
            // When the lyrics switch is off, ignore lyrics updates
            if (!this._settings || !this._settings.get_boolean('enable-lyrics')) {
                invocation.return_value(null);
                return;
            }

            let raw = parameters.unpack()[0];
            let lrc;
            try {
                lrc = JSON.parse(raw.get_string()[0]);
            } catch (e) {
                console.debug(`[DynamicMusicPill] Lyric parse error: ${e.message}`);
                invocation.return_value(null);
                return;
            }

            let active = this._getActivePlayer();
            let activeBus = active ? (active._busName || "") : "";

            if (!active || lrc.content === "" || !activeBus.includes(lrc.sender)) {
                this._pills().forEach(p => p.setLyric(null));
                this._dbusLyricActive = false;
            } else {
                this._dbusLyricActive = true;
                this._stopLyricsTimer();
                this._pills().forEach(p => p.setLyric(lrc));
            }
            invocation.return_value(null);
        }
    }

    // Network lyrics retrieval
    async _fetchNetworkLyrics(player) {
        if (!player || !this._lyricsClient) return;
        if (!this._settings || !this._settings.get_boolean('enable-lyrics')) return;

        let m = player.Metadata;
        if (!m) return;

        let metaObj = m instanceof GLib.Variant ? m.deep_unpack() : m;
        let title = smartUnpack(metaObj['xesam:title']);
        let artist = smartUnpack(metaObj['xesam:artist']);
        let album = smartUnpack(metaObj['xesam:album']) || '';
        let length = smartUnpack(metaObj['mpris:length']) || 0;

        if (Array.isArray(artist)) artist = artist.join(', ');
        if (!title || !title.trim()) return;
        artist = artist ? artist.trim() : '';
        if (!artist && !/\s+[-–—]\s+/.test(title)) return;

        let durationSec = length > 0 ? Math.round(length / 1000000) : 0;
        let trackKey = `${title}||${artist}`;

        this._fetchedTrackKey = trackKey;
        this._fetchedTrackDuration = durationSec;
        this._fetchedLyricsData = null;
        this._fetchingLyrics = true;
        this._lastLyricIndex = -1;

        try {
            let res = await this._lyricsClient.getLyrics(title, artist, album, durationSec, this._settings);
            if (this._fetchedTrackKey !== trackKey) return;

            if (res && res.lines) {
                this._fetchedLyricsData = res.lines;
                this._fetchedLyricsProvider = res.provider || 'LRCLib';
            } else if (Array.isArray(res)) {
                this._fetchedLyricsData = res;
                this._fetchedLyricsProvider = 'LRCLib';
            } else {
                this._fetchedLyricsData = null;
                this._fetchedLyricsProvider = null;
            }

            this._lastLyricIndex = -1;

            if (this._fetchedLyricsData && this._fetchedLyricsData.length > 0) {
                this._startLyricsTimer();
                this._onLyricsTick();
            }
        } catch (e) {
            console.debug(`[DynamicMusicPill] Network lyrics fetch error: ${e}`);
            this._fetchedLyricsData = null;
            this._fetchedLyricsProvider = null;
        } finally {
            if (this._fetchedTrackKey === trackKey) {
                this._fetchingLyrics = false;
            }
        }
    }

    _startLyricsTimer() {
        if (this._lyricsTimerId) return;
        this._lyricsTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
            this._onLyricsTick();
            return GLib.SOURCE_CONTINUE;
        });
    }

    _stopLyricsTimer() {
        if (this._lyricsTimerId) {
            GLib.Source.remove(this._lyricsTimerId);
            this._lyricsTimerId = null;
        }
    }

    _syncPosition(player) {
        if (!player || !this._connection) return;
        this._connection.call(
            player._busName,
            '/org/mpris/MediaPlayer2',
            'org.freedesktop.DBus.Properties',
            'Get',
            new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, asyncRes) => {
                let result;
                try {
                    result = conn.call_finish(asyncRes);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Position sync error: ${e.message}`);
                    return;
                }
                if (result) {
                    let posVariant = result.deep_unpack()[0];
                    if (posVariant) {
                        let val = posVariant instanceof GLib.Variant
                            ? posVariant.unpack()
                            : posVariant;
                        if (typeof val === 'number' && val >= 0) {
                            player._lastPosition = val;
                            player._lastPositionTime = Date.now();
                        }
                    }
                }
            }
        );
    }

    _onLyricsTick() {

        if (!this._settings || !this._settings.get_boolean('enable-lyrics')) {
            this._stopLyricsTimer();
            return;
        }
        if (!this._fetchedLyricsData || !this._pill) return;
        if (this._dbusLyricActive) return;

        let active = this._getActivePlayer();
        if (!active || active.PlaybackStatus !== 'Playing') return;

        let now = Date.now();
        if (!this._lastPositionSync || now - this._lastPositionSync > 1000) {
            this._lastPositionSync = now;
            this._syncPosition(active);
        }

        // Stale position detection for KDE Connect / GS Connect
        let cachedPos = active._lastPosition || 0;
        if (cachedPos === (this._lastLyricPosition || 0)) {
            this._stalePositionCount = (this._stalePositionCount || 0) + 1;
        } else {
            this._stalePositionCount = 0;
            this._lastLyricPosition = cachedPos;
        }

        // If position hasn't changed for ~3 seconds (15 ticks × 200ms), hide lyrics
        if (this._stalePositionCount > 15) {
            this._pills().forEach(p => p.setLyric(null));
            return;
        }

        let positionUs = active._lastPosition + (now - active._lastPositionTime) * 1000;
        let positionMs = positionUs / 1000;

        let currentIndex = -1;
        for (let i = this._fetchedLyricsData.length - 1; i >= 0; i--) {
            if (this._fetchedLyricsData[i].time <= positionMs) {
                currentIndex = i;
                break;
            }
        }

        if (currentIndex >= 0) {
            this._lastLyricIndex = currentIndex;

            let currentLine = this._fetchedLyricsData[currentIndex];
            let durationSec = 5;
            if (currentIndex + 1 < this._fetchedLyricsData.length) {
                durationSec = (this._fetchedLyricsData[currentIndex + 1].time - currentLine.time) / 1000;
            }

            let enablePillWordLevel = this._settings ? this._settings.get_boolean('pill-enable-word-level') : true;

            let lrc = {
                sender: this._fetchedLyricsProvider || "lrclib",
                content: currentLine.text,
                time: durationSec,
                words: enablePillWordLevel ? (currentLine.words || null) : null,
                positionMs: positionMs,
            };
            this._pills().forEach(p => p.setLyric(lrc));
        }
    }

    _triggerUpdate() {
        if (this._updateTimeoutId) {
            return;
        }

        let useDelay = this._settings ? this._settings.get_boolean('compatibility-delay') : false;
        let delay = useDelay ? 800 : 150;

        this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateTimeoutId = null;
            this._updateUI();
            return GLib.SOURCE_REMOVE;
        });
    }

    _monitorArtFile(artUri) {
        if (!artUri || !artUri.startsWith('file://')) {
            if (this._artMonitor) {
                this._artMonitor.cancel();
                this._artMonitor = null;
            }
            this._monitoredArtUri = null;
            return;
        }

        if (this._monitoredArtUri === artUri) return;

        if (this._artMonitor) {
            this._artMonitor.cancel();
            this._artMonitor = null;
        }

        this._monitoredArtUri = artUri;
        let file = Gio.File.new_for_uri(artUri);
        try {
            this._artMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        } catch (e) {
            console.debug('[Dynamic Music Pill] Failed to setup art monitor: ' + e);
            return;
        }

        if (!this._artMonitor) return;

        this._artMonitor.connect('changed', (monitor, f, otherFile, eventType) => {
            if (eventType === Gio.FileMonitorEvent.CHANGES_DONE_HINT || eventType === Gio.FileMonitorEvent.CREATED) {
                if (this._artMonitorDebounce) {
                    GLib.Source.remove(this._artMonitorDebounce);
                }
                this._artMonitorDebounce = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 200, () => {
                    this._artMonitorDebounce = null;
                    this._updateUI();
                    return GLib.SOURCE_REMOVE;
                });
            }
        });
    }

    _updateUI() {
        if (this._recheckTimer) {
            GLib.Source.remove(this._recheckTimer);
            this._recheckTimer = null;
        }

            if (!this._pill) this._createPill();
            if (!this._pill) return;

            if (this._pill.get_parent()) {
                let container = this._pill.get_parent();
                let duplicates = container.get_children().filter(
                    c => c !== this._pill && c instanceof MusicPill
                );
                for (let p of duplicates) {
                    console.debug('[Dynamic Music Pill] Removing duplicate pill from _updateUI');
                    container.remove_child(p);
                    p.destroy();
                }
            }

            let target = this._settings ? this._settings.get_int('target-container') : 0;
            let container = null;
            if (target === 0) {
                container = this._dockContainers()[0];
            } else if (target === 1) container = Main.panel._leftBox;
            else if (target === 2) container = Main.panel._centerBox;
            else if (target === 3) container = Main.panel._rightBox;

            if (container) {
                let moved = this._ensurePosition(container);
                if (moved) {
                    this._pill._updateDimensions();
                    this._queueInject();
                }
            }

            let active = this._getActivePlayer();
            if (active) {
                if (this._lastWinnerName !== active._busName) {
                    this._dbusLyricActive = false;
                    this._fetchedTrackKey = null;
                    this._fetchedLyricsData = null;
                    this._lastLyricIndex = -1;
                    this._stopLyricsTimer();
                }
                this._lastWinnerName = active._busName;

                let m = active.Metadata;
                let title = null, artist = null, artUrl = null;
                let currentArt = null;
                let trackFileUrl = null;

                if (m) {
                    let metaObj = (m instanceof GLib.Variant) ? m.deep_unpack() : m;
                    title = smartUnpack(metaObj['xesam:title']);
                    artist = smartUnpack(metaObj['xesam:artist']);
                    if (Array.isArray(artist)) artist = artist.map(a => smartUnpack(a)).join(', ');
                    currentArt = smartUnpack(metaObj['mpris:artUrl']);
                    trackFileUrl = smartUnpack(metaObj['xesam:url']);
                }
                if (!title) {
                    let alwaysShow = this._settings && this._settings.get_boolean('always-show-pill');
                    let last = alwaysShow ? this.getLastPlayedTrack() : null;
                    if (last && last.title) {
                        title = last.title;
                        artist = last.artist || '';
                        if (!currentArt && last.artUrl) currentArt = last.artUrl;
                    } else if (active._busName) {
                        title = active._identity || _("Unknown Player");
                        artist = _("No active media");
                    }
                }

                let rawName = active._busName || "";
                let cacheKey = (rawName.includes('.instance') ? rawName.split('.instance')[0] : rawName) + '|' + (title || '');

                this._monitorArtFile(currentArt);

                if (currentArt && typeof currentArt === 'string' && currentArt.trim() !== "") {
                    let isFileUrl = currentArt.startsWith('file://');
                    if (isFileUrl) {
                        let srcFile = Gio.File.new_for_uri(currentArt);
                        if (srcFile.query_exists(null)) {
                            let srcTimeStr = '';
                            try {
                                let srcInfo = srcFile.query_info(Gio.FILE_ATTRIBUTE_TIME_MODIFIED, Gio.FileQueryInfoFlags.NONE, null);
                                if (srcInfo) {
                                    srcTimeStr = srcInfo.get_attribute_uint64(Gio.FILE_ATTRIBUTE_TIME_MODIFIED).toString();
                                }
                            } catch (e) {
                                console.debug(`[Dynamic Music Pill] srcFile query_info error: ${e.message}`);
                            }
                            let hashSource = currentArt + '|' + (title || '') + '|' + (artist || '') + '|' + srcTimeStr;
                            let hash = GLib.compute_checksum_for_string(
                                GLib.ChecksumType.MD5, hashSource, -1);
                            let cachedPath = GLib.build_filenamev([
                                this._ownArtCacheDir, hash + '.png']);
                            let cachedFile = Gio.File.new_for_path(cachedPath);

                            let info = null;
                            if (cachedFile.query_exists(null)) {
                                try {
                                    info = cachedFile.query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE, Gio.FileQueryInfoFlags.NONE, null);
                                } catch (e) {
                                    console.debug(`[Dynamic Music Pill] cachedFile query_info error: ${e.message}`);
                                }
                            }
                            if (info && info.get_size() > 0) {
                                artUrl = cachedFile.get_uri();
                                this._artCacheSet(cacheKey, artUrl);
                            } else {
                                if (cachedFile.query_exists(null)) cachedFile.delete(null);

                                artUrl = (this._pill && this._pill._lastArtUrl) ? this._pill._lastArtUrl : null;
                                srcFile.copy_async(cachedFile,
                                    Gio.FileCopyFlags.OVERWRITE, GLib.PRIORITY_DEFAULT, null, null,
                                    (src, res) => {
                                        let success = false;
                                        try {
                                            src.copy_finish(res);
                                            let cInfo = cachedFile.query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE, Gio.FileQueryInfoFlags.NONE, null);
                                            if (cInfo && cInfo.get_size() > 0) success = true;
                                        } catch (e) {
                                            console.debug(`[Dynamic Music Pill] Art copy error: ${e.message}`);
                                        }

                                        if (success) {
                                            let newUri = cachedFile.get_uri();
                                            this._artCacheSet(cacheKey, newUri);
                                            if (this._pill && this._pill._lastArtUrl !== newUri && this._getActivePlayer()) {
                                                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                                    this._updateUI();
                                                    return GLib.SOURCE_REMOVE;
                                                });
                                            }
                                        } else {
                                            this._artCacheSet(cacheKey, currentArt);
                                            if (this._pill && this._pill._lastArtUrl !== currentArt && this._getActivePlayer()) {
                                                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                                    this._updateUI();
                                                    return GLib.SOURCE_REMOVE;
                                                });
                                            }

                                            if (this._getActivePlayer()) {
                                                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                                    if (!this._retryArtTimer) {
                                                        this._retryArtTimerCount = 0;
                                                        this._retryArtTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                                                            this._retryArtTimerCount++;
                                                            if (this._retryArtTimerCount > 10 || !this._pill || !this._pill.get_parent()) {
                                                                this._retryArtTimer = null;
                                                                return GLib.SOURCE_REMOVE;
                                                            }
                                                            this._updateUI();
                                                            return GLib.SOURCE_CONTINUE;
                                                        });
                                                    }
                                                    return GLib.SOURCE_REMOVE;
                                                });
                                            }
                                        }
                                    });
                            }
                        }
                    } else {
                        let httpHash = GLib.compute_checksum_for_string(
                            GLib.ChecksumType.MD5, currentArt + '|' + (title || '') + '|' + (artist || ''), -1);
                        let httpCachedPath = GLib.build_filenamev([
                            this._ownArtCacheDir, httpHash + '.png']);
                        let httpCachedFile = Gio.File.new_for_path(httpCachedPath);

                        if (httpCachedFile.query_exists(null)) {
                            artUrl = httpCachedFile.get_uri();
                            this._artCacheSet(cacheKey, artUrl);
                        } else if (currentArt.startsWith('http://') || currentArt.startsWith('https://')) {
                            artUrl = (this._pill && this._pill._lastArtUrl) ? this._pill._lastArtUrl : null;

                            if (!this._downloadingArts.has(currentArt)) {
                                this._downloadingArts.add(currentArt);
                                try {
                                    let session = this._soupSession || new Soup.Session();
                                    let message = Soup.Message.new('GET', currentArt);
                                    if (!message) throw new Error('Invalid URI for Soup');
                                    session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (s, res) => {
                                        this._downloadingArts.delete(currentArt);
                                        try {
                                            let bytes = s.send_and_read_finish(res);
                                            if (bytes && bytes.get_size() > 0) {
                                                let outStream = httpCachedFile.replace(null, false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
                                                outStream.write_bytes(bytes, null);
                                                outStream.close(null);

                                                let newUri = httpCachedFile.get_uri();
                                                this._artCacheSet(cacheKey, newUri);
                                                if (this._pill && this._pill._lastArtUrl !== newUri && this._getActivePlayer()) {
                                                    GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                                        this._updateUI();
                                                        return GLib.SOURCE_REMOVE;
                                                    });
                                                }
                                            }
                                        } catch (e) {
                                            console.debug('[Dynamic Music Pill] Soup art download failed: ' + e.message);
                                            this._artCacheSet(cacheKey, currentArt);
                                            if (this._pill && this._pill._lastArtUrl !== currentArt && this._getActivePlayer()) {
                                                GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                                                    this._updateUI();
                                                    return GLib.SOURCE_REMOVE;
                                                });
                                            }
                                        }
                                    });
                                } catch (e) {
                                    this._downloadingArts.delete(currentArt);
                                    console.debug('[Dynamic Music Pill] Soup session error: ' + e.message);
                                    this._artCacheSet(cacheKey, currentArt);
                                    artUrl = currentArt;
                                }
                            }
                        } else {
                            // Do not attempt to download unknown schemes like data:
                            this._artCacheSet(cacheKey, currentArt);
                            artUrl = currentArt;
                        }
                    }
                }

                if (!artUrl && this._artCache.has(cacheKey)) {
                    let cached = this._artCache.get(cacheKey);
                    let cachedIsFile = cached.startsWith('file://');
                    let cachedExists = !cachedIsFile || Gio.File.new_for_uri(cached).query_exists(null);
                    if (cachedExists) artUrl = cached;
                    else this._artCache.delete(cacheKey);
                }

                if (!artUrl && trackFileUrl && trackFileUrl.startsWith('file://')) {
                    try {
                        let hash = GLib.compute_checksum_for_string(GLib.ChecksumType.MD5, trackFileUrl.replace('file://', ''), -1);
                        let ownFile = Gio.File.new_for_path(GLib.build_filenamev([this._ownArtCacheDir, hash + '.jpg']));
                        if (ownFile.query_exists(null)) {
                            artUrl = ownFile.get_uri();
                            this._artCacheSet(cacheKey, artUrl);
                        } else {
                            let info = Gio.File.new_for_uri(trackFileUrl).query_info(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH, Gio.FileQueryInfoFlags.NONE, null);
                            let thumbPath = info.get_attribute_byte_string(Gio.FILE_ATTRIBUTE_THUMBNAIL_PATH);
                            if (thumbPath) {
                                let thumbFile = Gio.File.new_for_path(thumbPath);
                                if (thumbFile.query_exists(null)) {
                                    artUrl = thumbFile.get_uri();
                                    thumbFile.copy_async(ownFile, Gio.FileCopyFlags.OVERWRITE,
                                        GLib.PRIORITY_DEFAULT, null, null, (src, res) => {
                                            try {
                                                src.copy_finish(res);
                                                this._artCacheSet(cacheKey, ownFile.get_uri());
                                            } catch (e) {
                                                console.debug(`[Dynamic Music Pill] Thumbnail copy error: ${e.message}`);
                                            }
                                        });
                                }
                            }
                        }
                    } catch (e) {
                        console.debug(`[Dynamic Music Pill] Track thumbnail error: ${e.message}`);
                    }
                }

                if (!artUrl) {
                    let fallbackPath = this._settings ? this._settings.get_string('fallback-art-path') : '';
                    if (fallbackPath && fallbackPath.trim() !== '') {
                        let file = Gio.File.new_for_path(fallbackPath);
                        if (file.query_exists(null)) {
                            artUrl = file.get_uri();
                        }
                    }
                }

                if (title && (active.PlaybackStatus === 'Playing' || !this._trackHistory.length || (this._trackHistory[0] && this._trackHistory[0].title !== title))) {
                    this._recordHistory(title, artist, artUrl, active, trackFileUrl);
                }

                let needsRetry = false;
                if (currentArt && currentArt.startsWith('file://')) {
                    let srcFile = Gio.File.new_for_uri(currentArt);
                    if (!srcFile.query_exists(null)) {
                        needsRetry = true;
                    } else {
                        let info = null;
                        try {
                            info = srcFile.query_info(Gio.FILE_ATTRIBUTE_STANDARD_SIZE, Gio.FileQueryInfoFlags.NONE, null);
                        } catch (e) {
                            console.debug(`[Dynamic Music Pill] query_info error: ${e.message}`);
                        }
                        if (info && info.get_size() === 0) needsRetry = true;
                    }
                }

                if (needsRetry && active.PlaybackStatus === 'Playing' && !this._retryArtTimer) {
                    this._retryArtTimerCount = 0;
                    this._retryArtTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                        this._retryArtTimerCount++;
                        if (this._retryArtTimerCount > 10 || !this._pill || !this._pill.get_parent()) {
                            this._retryArtTimer = null;
                            return GLib.SOURCE_REMOVE;
                        }
                        if (this._proxies.has(active._busName)) {
                            this._updateUI();
                        }
                        return GLib.SOURCE_CONTINUE;
                    });
                } else if (!needsRetry && this._retryArtTimer) {
                    GLib.Source.remove(this._retryArtTimer);
                    this._retryArtTimer = null;
                }

                let now = Date.now();
                let isSkipActive = (now - this._lastActionTime < 3000);

                if (this._settings && this._settings.get_boolean('enable-lyrics') && !this._dbusLyricActive) {
                    let metaObj2 = null;
                    if (active.Metadata) {
                        metaObj2 = active.Metadata instanceof GLib.Variant ? active.Metadata.deep_unpack() : active.Metadata;
                    }
                    let currentTitle = metaObj2 ? smartUnpack(metaObj2['xesam:title']) : null;
                    let currentArtist = metaObj2 ? smartUnpack(metaObj2['xesam:artist']) : null;
                    if (Array.isArray(currentArtist)) currentArtist = currentArtist.join(', ');
                    currentArtist = currentArtist ? currentArtist.trim() : '';
                    let currentLength = metaObj2 ? (smartUnpack(metaObj2['mpris:length']) || 0) : 0;
                    let currentDurationSec = currentLength > 0 ? Math.round(currentLength / 1000000) : 0;

                    let currentTrackKey = `${currentTitle}||${currentArtist}`;
                    let durationJustArrived = (
                        this._fetchedTrackKey === currentTrackKey &&
                        !this._fetchedLyricsData &&
                        !this._fetchingLyrics &&
                        currentDurationSec > 0 &&
                        (!this._fetchedTrackDuration || this._fetchedTrackDuration <= 0)
                    );

                    if (currentTitle && (this._fetchedTrackKey !== currentTrackKey || durationJustArrived)) {
                        this._pills().forEach(p => p.setLyric(null));
                        this._fetchNetworkLyrics(active);
                    } else if (this._fetchedLyricsData && active.PlaybackStatus === 'Playing') {
                        this._startLyricsTimer();
                    } else if (active.PlaybackStatus !== 'Playing') {
                        this._stopLyricsTimer();
                    }
                }

                let finalDisplayArt = artUrl;
                if (this._pill && !finalDisplayArt && active.PlaybackStatus === 'Playing' && (needsRetry || this._retryArtTimer)) {
                    if (this._pill._lastArtUrl) {
                        finalDisplayArt = this._pill._lastArtUrl;
                    }
                }

                this._pills().forEach(p => p.updateDisplay(title, artist, finalDisplayArt, active.PlaybackStatus, active._busName, isSkipActive, active));
            } else {
                this._stopLyricsTimer();
                this._fetchedTrackKey = null;
                this._fetchedLyricsData = null;
                this._dbusLyricActive = false;
                this._lastLyricIndex = -1;
                this._lastPositionSync = 0;

                let alwaysShow = this._settings && this._settings.get_boolean('always-show-pill');
                let last = alwaysShow ? this.getLastPlayedTrack() : null;
                if (last && last.title) {
                    this._pills().forEach(p => p.updateDisplay(
                        last.title,
                        last.artist || '',
                        last.artUrl || null,
                        'Stopped',
                        last.busName || '',
                        false,
                        null
                    ));
                } else {
                    this._pills().forEach(p => p.updateDisplay(null, null, null, 'Stopped', null, false));
                }
            }
    }

    _isPlayerAllowed(busName) {
        let mode = this._settings.get_int('player-filter-mode');
        if (mode === 0) return true;

        let listStr = this._settings.get_string('player-filter-list').toLowerCase();
        let list = listStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

        if (list.length === 0) return mode === 1;

        let lowerName = busName.toLowerCase();
        let match = list.some(item => lowerName.includes(item));

        if (mode === 1) return !match;
        if (mode === 2) return match;
        return true;
    }

    _getActivePlayer() {
        let proxiesArr = Array.from(this._proxies.values());
        if (proxiesArr.length === 0) return null;
        let manualBus = this._settings.get_string('selected-player-bus');
        if (manualBus && manualBus !== '' && this._proxies.has(manualBus)) {
            return this._proxies.get(manualBus);
        }
        let now = Date.now();

        let filterMode = this._settings.get_int('player-filter-mode');
        let filterListStr = this._settings.get_string('player-filter-list').toLowerCase();
        let filterList = filterListStr.split(',').map(s => s.trim()).filter(s => s.length > 0);

        if (now - this._lastActionTime < 3000 && this._lastWinnerName) {
            let lockedPlayer = proxiesArr.find(p => p._busName === this._lastWinnerName);
            if (lockedPlayer) return lockedPlayer;
        }

        let scoredPlayers = proxiesArr.map(p => {
            let score = 0;
            let status = p.PlaybackStatus;
            let m = p.Metadata;

            if (m) {
                let metaObj = (m instanceof GLib.Variant) ? m.deep_unpack() : m;
                let rawUrl = metaObj['xesam:url'] ? smartUnpack(metaObj['xesam:url']) : "";
                let url = typeof rawUrl === 'string' ? rawUrl.toLowerCase() : "";

                let isWebContent = url.startsWith('http://') || url.startsWith('https://');

                if (isWebContent && filterMode === 2) {
                    let urlMatch = filterList.some(item => url.includes(item));
                    if (!urlMatch) return { player: p, score: -1 };
                }
            }

            let hasTitle = false;
            if (m) {
                let mu = (m instanceof GLib.Variant) ? m.deep_unpack() : m;
                hasTitle = Boolean(smartUnpack(mu['xesam:title']));
            }
            if (status === 'Playing' && hasTitle) score = 500;
            else if (status === 'Paused' && hasTitle) score = 100;
            return { player: p, score: score };
        });

        scoredPlayers.sort((a, b) => {
            if (b.score !== a.score) return b.score - a.score;
            return b.player._lastPlayingTime - a.player._lastPlayingTime;
        });

        if (scoredPlayers[0].score < 0) return null;

        let winner = scoredPlayers[0].player;
        if (winner.PlaybackStatus !== 'Playing') {
            let anyPlaying = scoredPlayers.find(s => {
                if (s.score <= 0 || s.player.PlaybackStatus !== 'Playing') return false;
                let md = s.player.Metadata;
                if (!md) return false;
                let mdu = (md instanceof GLib.Variant) ? md.deep_unpack() : md;
                return Boolean(smartUnpack(mdu['xesam:title']));
            });
            if (anyPlaying) winner = anyPlaying.player;
        }
        return winner;
    }

    togglePlayback() {
        let p = this._getActivePlayer();
        if (p) p.PlayPauseRemote();
        else this.openApp();
    }
    next() {
        let p = this._getActivePlayer();
        if (p) {
            this._lastActionTime = Date.now();
            p.NextRemote();
        } else {
            this.openApp();
        }
    }
    previous() {
        let p = this._getActivePlayer();
        if (p) {
            this._lastActionTime = Date.now();
            p.PreviousRemote();
        } else {
            this.openApp();
        }
    }

    _getPillFeedbackAvailWidth(pill) {
        let allocW = 0;
        if (pill._textWrapper && pill._textWrapper.has_allocation()) {
            let box = pill._textWrapper.get_allocation_box();
            allocW = Math.floor(box.x2 - box.x1);
        }
        if (pill._textBox && pill._textBox.has_allocation()) {
            let tBox = pill._textBox.get_allocation_box();
            let tW = Math.floor(tBox.x2 - tBox.x1);
            if (tW > 0) allocW = (allocW > 0) ? Math.min(allocW, tW) : tW;
        }

        let calcW = 0;
        if (pill._body) {
            let bodyW = pill._targetWidth || 0;
            if (bodyW <= 0 && pill._body.has_allocation()) {
                let bBox = pill._body.get_allocation_box();
                bodyW = Math.floor(bBox.x2 - bBox.x1);
            }
            if (bodyW > 0) {
                let usedW = (pill._padX || 14) * 2 + 6; // body padding + textWrapper margins (2+4)
                if (this._settings.get_boolean('show-pill-border')) usedW += 2;
                let visPad = this._settings.get_int('visualizer-padding');
                if (pill._artBin && pill._artBin.visible) {
                    let aBox = pill._artBin.has_allocation() ? pill._artBin.get_allocation_box() : null;
                    let aW = aBox ? Math.floor(aBox.x2 - aBox.x1) : (pill._artBin.width || 0);
                    let aMargin = (pill._visBin && pill._visBin.visible) ? visPad : ((bodyW < 180) ? 4 : 8);
                    usedW += aW + aMargin;
                }
                if (pill._tabletControls && pill._tabletControls.visible && pill._tabletControls.has_allocation()) {
                    let tBox = pill._tabletControls.get_allocation_box();
                    usedW += Math.floor(tBox.x2 - tBox.x1) + 6;
                }
                if (pill._visBin && pill._visBin.visible && pill._visBin.has_allocation()) {
                    let vBox = pill._visBin.get_allocation_box();
                    usedW += Math.floor(vBox.x2 - vBox.x1) + visPad;
                }
                if (pill._statusPlayBtn && pill._statusPlayBtn.visible && pill._statusPlayBtn.has_allocation()) {
                    let sBox = pill._statusPlayBtn.get_allocation_box();
                    usedW += Math.floor(sBox.x2 - sBox.x1) + visPad;
                }
                calcW = Math.max(24, Math.floor(bodyW - usedW));
            }
        }

        if (allocW > 0 && calcW > 0) return Math.min(allocW, calcW);
        return allocW > 0 ? allocW : (calcW > 0 ? calcW : 80);
    }

    _showPillFeedback(iconNameOrGicon, text, percent = null) {
        let pill = this._getAnchorPill();
        if (!pill || !pill._textWrapper) return;

        if (this._feedbackTimer) {
            GLib.Source.remove(this._feedbackTimer);
            this._feedbackTimer = null;
        }

        let wasFeedbackActive = !!(pill._feedbackBox && pill._feedbackBox.visible && pill._feedbackBox.opacity >= 200);
        let freshAvailW = this._getPillFeedbackAvailWidth(pill);
        if (!wasFeedbackActive || !pill._cachedFeedbackAvailW) {
            pill._cachedFeedbackAvailW = freshAvailW;
        } else if (freshAvailW > 0) {
            pill._cachedFeedbackAvailW = Math.min(pill._cachedFeedbackAvailW, freshAvailW);
        }
        let availW = pill._cachedFeedbackAvailW || freshAvailW;

        if (!pill._feedbackBox) {
            pill._feedbackBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 8px;'
            });

            pill._feedbackIcon = new St.Icon({ icon_size: 16, y_align: Clutter.ActorAlign.CENTER });
            pill._feedbackLabel = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
            pill._feedbackLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            pill._feedbackLabel.clutter_text.line_wrap = false;

            pill._feedbackSliderBg = new St.Widget({
                name: 'pill-feedback-slider-bg',
                y_align: Clutter.ActorAlign.CENTER,
                clip_to_allocation: true,
                style: 'border-radius: 4px;',
                height: 6,
                width: 80
            });
            pill._feedbackSliderFill = new St.Widget({
                name: 'pill-feedback-slider-fill',
                style: 'border-radius: 4px;',
                height: 6,
                width: 0
            });
            pill._feedbackSliderBg.add_child(pill._feedbackSliderFill);

            pill._feedbackBox.add_child(pill._feedbackIcon);
            pill._feedbackBox.add_child(pill._feedbackSliderBg);
            pill._feedbackBox.add_child(pill._feedbackLabel);

            pill._textWrapper.add_child(pill._feedbackBox);
        }

        if (!pill._feedbackBox.visible) {
            pill._feedbackBox.opacity = 0;
            pill._feedbackBox.show();
        }

        let isLightMode = this._settings.get_boolean('light-mode');
        let defChan = isLightMode ? 242 : 40;
        let c = pill._displayedColor || { r: defChan, g: defChan, b: isLightMode ? 245 : 40 };
        let brightness = (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
        let isLight = brightness > 160;
        let color = isLight ? 'rgb(28, 28, 30)' : 'rgb(255, 255, 255)';
        let bgTrack = isLight ? 'rgba(28, 28, 30, 0.22)' : 'rgba(255, 255, 255, 0.22)';
        if (this._settings.get_boolean('use-custom-colors')) {
            let customText = this._settings.get_string('custom-text-color');
            color = `rgb(${customText})`;
            bgTrack = `rgba(${customText}, 0.25)`;
        }

        if (typeof iconNameOrGicon === 'string') {
            pill._feedbackIcon.gicon = null;
            pill._feedbackIcon.fallback_icon_name = 'audio-x-generic-symbolic';
            pill._feedbackIcon.icon_name = iconNameOrGicon;
        } else {
            pill._feedbackIcon.icon_name = null;
            pill._feedbackIcon.fallback_icon_name = null;
            pill._feedbackIcon.gicon = iconNameOrGicon;
        }
        pill._feedbackIcon.set_style(`color: ${color};`);

        if (percent !== null) {
            let pctClamped = Math.max(0, Math.min(1, percent));

            let spacing = 8;
            let iconSize = 16;
            let fontSize = '10pt';
            let showIcon = true;
            let showSlider = true;

            if (availW > 0 && availW < 135) {
                if (availW >= 92) {
                    spacing = 5;
                    iconSize = 14;
                    fontSize = '8.5pt';
                } else if (availW >= 72) {
                    spacing = 4;
                    iconSize = 12;
                    fontSize = '8pt';
                } else if (availW >= 48) {
                    spacing = 4;
                    showIcon = false;
                    fontSize = '8pt';
                } else {
                    spacing = 2;
                    showIcon = false;
                    showSlider = false;
                    fontSize = '8pt';
                }
            }

            pill._feedbackLabel.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;
            pill._feedbackLabel.clutter_text.line_wrap = false;
            pill._feedbackLabel.set_style(`font-size: ${fontSize}; font-weight: bold; color: ${color};`);
            pill._feedbackLabel.set_width(-1);
            pill._feedbackLabel.text = '100%';
            let [, maxLabelNatW] = pill._feedbackLabel.get_preferred_width(-1);
            let minLabelW = (fontSize === '10pt') ? 34 : (fontSize === '8.5pt' ? 28 : 25);
            let labelW = Math.max(minLabelW, Math.ceil(maxLabelNatW) + 2);
            pill._feedbackLabel.text = `${Math.round(pctClamped * 100)}%`;
            pill._feedbackLabel.set_width(labelW);

            let iconReserve = showIcon ? (iconSize + spacing) : 0;
            let maxSliderW = (availW > 0)
                ? (availW - iconReserve - labelW - (showSlider ? spacing : 0) - 2)
                : 80;

            if (showSlider && maxSliderW < 16 && showIcon) {
                showIcon = false;
                iconReserve = 0;
                maxSliderW = availW - labelW - spacing - 2;
            }
            if (showSlider && maxSliderW < 12) {
                showSlider = false;
            }

            pill._feedbackBox.set_style(`spacing: ${spacing}px;`);
            pill._feedbackIcon.visible = showIcon;
            if (showIcon) {
                pill._feedbackIcon.icon_size = iconSize;
                pill._feedbackIcon.set_width(iconSize);
            }

            if (showSlider) {
                let sliderW = Math.min(80, Math.max(12, maxSliderW));
                let targetFillW = Math.max(0, Math.round(pctClamped * sliderW));

                pill._feedbackSliderBg.set_width(sliderW);
                pill._feedbackSliderBg.show();
                pill._feedbackSliderBg.set_style(`background-color: ${bgTrack}; border-radius: 4px;`);
                pill._feedbackSliderFill.set_style(`background-color: ${color}; border-radius: 4px;`);

                pill._feedbackSliderFill.remove_all_transitions();
                if (pill._feedbackSliderFill.width > sliderW) {
                    pill._feedbackSliderFill.set_width(targetFillW);
                } else {
                    pill._feedbackSliderFill.ease({
                        width: targetFillW,
                        duration: 80,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD
                    });
                }
            } else {
                pill._feedbackSliderBg.hide();
            }
        } else {
            pill._feedbackSliderBg.hide();
            let compactText = (availW > 0 && availW < 95);
            let spacing = compactText ? 5 : 8;
            let showIcon = !(availW > 0 && availW < 55);
            let iconSize = compactText ? 14 : 16;
            pill._feedbackBox.set_style(`spacing: ${spacing}px;`);
            pill._feedbackIcon.visible = showIcon;
            if (showIcon) {
                pill._feedbackIcon.icon_size = iconSize;
                pill._feedbackIcon.set_width(iconSize);
            }
            pill._feedbackLabel.set_width(-1);
            pill._feedbackLabel.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            let maxTextW = (availW > 0) ? Math.max(24, availW - (showIcon ? (iconSize + spacing) : 0) - 2) : 200;
            pill._feedbackLabel.text = text;
            pill._feedbackLabel.set_style(`font-size: ${compactText ? '8.5pt' : '10pt'}; font-weight: bold; color: ${color}; max-width: ${maxTextW}px;`);
        }

        pill._textBox.ease({ opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        if (!wasFeedbackActive) {
            pill._feedbackBox.remove_all_transitions();
            pill._feedbackBox.opacity = 0;
            pill._feedbackBox.show();
            pill._feedbackBox.ease({ opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        } else {
            pill._feedbackBox.remove_all_transitions();
            pill._feedbackBox.opacity = 255;
            pill._feedbackBox.show();
        }

        this._feedbackTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._feedbackTimer = null;
            for (const p of this._pills()) {
                p._cachedFeedbackAvailW = 0;
                if (!p._feedbackBox) continue;
                p._feedbackBox.ease({
                    opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    onStopped: () => { p._feedbackBox.hide(); }
                });
                p._textBox.ease({ opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    _getAppStream(player = null) {
        let mixer = getMixerControl();
        if (!mixer) return { stream: null, mixer: null };

        player = player || this._getActivePlayer();
        if (player) {
            let sinkInputs = mixer.get_streams ? mixer.get_streams() : [];
            let busName = (player._busName || '').replace('org.mpris.MediaPlayer2.', '').split('.')[0].toLowerCase();
            let identity = (player._identity || '').toLowerCase();
            let desktopEntry = (player._desktopEntry || '').toLowerCase();

            for (let input of sinkInputs) {
                let streamName = (input.name || input.get_name() || '').toLowerCase();
                let streamDesc = (input.description || input.get_description() || '').toLowerCase();
                let streamAppName = (input.application_id || input.get_application_id() || '').toLowerCase();

                console.debug(`[Dynamic Music Pill] Found Stream: name="${streamName}", desc="${streamDesc}", app="${streamAppName}", looking for bus="${busName}", id="${identity}", desktop="${desktopEntry}"`);

                if ((busName && (streamName.includes(busName) || streamDesc.includes(busName) || streamAppName.includes(busName))) ||
                    (identity && (streamName.includes(identity) || streamDesc.includes(identity))) ||
                    (desktopEntry && (streamName.includes(desktopEntry) || streamDesc.includes(desktopEntry)))) {
                    console.debug('[Dynamic Music Pill] -> Matched app stream!');
                    return { stream: input, mixer };
                }
            }
        }

        let fallback = mixer.get_default_sink();
        return { stream: fallback, mixer };
    }

    changeVolume(up) {
        let volTarget = this._settings ? this._settings.get_string('volume-scroll-target') : 'system';
        let stream = null;
        let mixer = getMixerControl();
        if (!mixer) return;

        if (volTarget === 'app') {
            let appData = this._getAppStream();
            stream = appData ? appData.stream : null;
        } else {
            stream = mixer.get_default_sink();
        }

        if (!stream) {
            stream = mixer.get_default_sink();
        }
        if (!stream) return;

        let maxVolume = mixer.get_vol_max_norm();
        let step = Math.round(maxVolume * 0.05);

        if (up && stream.is_muted) {
            stream.change_is_muted(false);
        }

        let currentVol = stream.volume || 0;
        let newVolume = up ? currentVol + step : currentVol - step;
        newVolume = Math.max(0, Math.min(maxVolume, newVolume));

        stream.change_volume(newVolume);
        stream.volume = newVolume;
        stream.push_volume();

        let percent = newVolume / maxVolume;
        let iconName = 'audio-volume-high-symbolic';
        if (stream.is_muted || newVolume === 0) iconName = 'audio-volume-muted-symbolic';
        else if (percent < 0.33) iconName = 'audio-volume-low-symbolic';
        else if (percent < 0.66) iconName = 'audio-volume-medium-symbolic';

        this._showPillFeedback(iconName, '', percent);
    }

    switchPlayer(isNext) {
        let proxiesArr = Array.from(this._proxies.keys());
        let options = ['', ...proxiesArr];

        if (options.length <= 1) return;

        let currentBus = this._settings.get_string('selected-player-bus');
        let currentIndex = options.indexOf(currentBus);
        if (currentIndex === -1) currentIndex = 0;

        if (isNext) {
            currentIndex = (currentIndex + 1) % options.length;
        } else {
            currentIndex = (currentIndex - 1 + options.length) % options.length;
        }

        let nextBus = options[currentIndex];
        this._settings.set_string('selected-player-bus', nextBus);
        this._updateUI();

        if (this._playerMenu && this._playerMenu.visible) {
            this._playerMenu.populate();
        }

        let labelText = _('Auto (Smart)');
        let iconNameOrGicon = 'emblem-system-symbolic';

        if (nextBus !== '') {
            let proxy = this._proxies.get(nextBus);
            if (proxy) {
                let rawAppName = nextBus.replace('org.mpris.MediaPlayer2.', '').split('.')[0];
                labelText = proxy._identity || (rawAppName.charAt(0).toUpperCase() + rawAppName.slice(1));
                iconNameOrGicon = proxy._gicon || getPlayerIcon(proxy, nextBus);
            }
        }

        this._showPillFeedback(iconNameOrGicon, labelText, null);
    }

    toggleShuffle() {
        let p = this._getActivePlayer();
        if (!p) return false;
        let shuffleVal = p.get_cached_property('Shuffle');
        if (shuffleVal === null || shuffleVal === undefined) {
            this._showPillFeedback('dialog-warning-symbolic', _('Not supported'));
            return false;
        }

        this._connection.call(
            p._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'Shuffle', new GLib.Variant('b', !p.Shuffle)]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Shuffle set failed: ${e.message}`);
                }
            }
        );
        return true;
    }

    toggleLoop() {
        let p = this._getActivePlayer();
        if (!p) return false;
        let loopVal = p.get_cached_property('LoopStatus');
        if (loopVal === null || loopVal === undefined) {
            this._showPillFeedback('dialog-warning-symbolic', _('Not supported'));
            return false;
        }

        let current = p.LoopStatus || 'None';
        let next = current === 'None' ? 'Playlist' : (current === 'Playlist' ? 'Track' : 'None');

        this._connection.call(
            p._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'LoopStatus', new GLib.Variant('s', next)]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] LoopStatus set failed: ${e.message}`);
                }
            }
        );
        return true;
    }


    seekStep(forward) {
        let p = this._getActivePlayer();
        if (!p) return false;

        let caps = this.getPlayerCapabilities();
        if (!caps.canSeek) {
            this._showPillFeedback('dialog-warning-symbolic', _('Not supported'));
            return false;
        }

        let offsetUs = (forward ? 10 : -10) * 1000000;

        this._connection.call(
            p._busName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2.Player', 'Seek',
            new GLib.Variant('(x)', [offsetUs]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Seek call failed: ${e.message}`);
                }
            }
        );

        this._showPillFeedback(
            forward ? 'media-seek-forward-symbolic' : 'media-seek-backward-symbolic',
            forward ? '+10s' : '−10s'
        );
        return true;
    }

    setPlaybackRate(rate) {
        let p = this._getActivePlayer();
        if (!p) return false;

        let caps = this.getPlayerCapabilities();
        if (!caps.canChangeRate) {
            this._showPillFeedback('dialog-warning-symbolic', _('Not supported'));
            return false;
        }

        this._connection.call(
            p._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'Rate', new GLib.Variant('d', rate)]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => {
                try {
                    conn.call_finish(res);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Rate set failed: ${e.message}`);
                }
            }
        );
        this._showPillFeedback('power-profile-performance-symbolic', `${rate}×`);
        return true;
    }

    getPlaybackRate() {
        let p = this._getActivePlayer();
        if (!p) return 1.0;
        let v = p.get_cached_property('Rate');
        return v ? v.unpack() : 1.0;
    }


    getPlayerCapabilities() {
        let p = this._getActivePlayer();
        let caps = {
            canControl: false,
            canPlay: false,
            canPause: false,
            canGoNext: false,
            canGoPrevious: false,
            canSeek: false,
            canShuffle: false,
            canLoop: false,
            canChangeRate: false,
        };
        if (!p) return caps;

        const readBool = (name) => {
            let v = p.get_cached_property(name);
            return v ? Boolean(v.unpack()) : false;
        };
        const readDouble = (name) => {
            let v = p.get_cached_property(name);
            return v ? v.unpack() : null;
        };

        caps.canControl = readBool('CanControl');
        caps.canPlay = readBool('CanPlay');
        caps.canPause = readBool('CanPause');
        caps.canGoNext = readBool('CanGoNext');
        caps.canGoPrevious = readBool('CanGoPrevious');
        caps.canSeek = readBool('CanSeek');

        let shuffleVal = p.get_cached_property('Shuffle');
        caps.canShuffle = (shuffleVal !== null && shuffleVal !== undefined);

        let loopVal = p.get_cached_property('LoopStatus');
        caps.canLoop = (loopVal !== null && loopVal !== undefined);

        let minRate = readDouble('MinimumRate');
        let maxRate = readDouble('MaximumRate');
        if (minRate !== null && maxRate !== null) {
            caps.canChangeRate = (maxRate > minRate + 0.01);
        } else {
            let rateVal = p.get_cached_property('Rate');
            caps.canChangeRate = (rateVal !== null && rateVal !== undefined);
        }

        return caps;
    }

    startSleepTimer(minutes) {
        this.cancelSleepTimer();
        let totalSeconds = minutes * 60;
        this._sleepTimerEndTime = Date.now() + totalSeconds * 1000;
        this._sleepTimerActive = true;

        this._sleepTimerId = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, totalSeconds, () => {
            this._sleepTimerId = null;
            this._sleepTimerActive = false;
            this._sleepTimerEndTime = null;
            let p = this._getActivePlayer();
            if (p && p.PlaybackStatus === 'Playing') {
                p.PlayPauseRemote();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    cancelSleepTimer() {
        if (this._sleepTimerId) {
            GLib.Source.remove(this._sleepTimerId);
            this._sleepTimerId = null;
        }
        this._sleepTimerActive = false;
        this._sleepTimerEndTime = null;
    }

    getSleepTimerRemaining() {
        if (!this._sleepTimerActive || !this._sleepTimerEndTime) return 0;
        return Math.max(0, Math.ceil((this._sleepTimerEndTime - Date.now()) / 1000));
    }


    getLastPlayedTrack() {
        if (this._trackHistory && this._trackHistory.length > 0) {
            return this._trackHistory[0];
        }
        return null;
    }

    _recordHistory(title, artist, artUrl, active = null, trackUrl = null) {
        if (!title) return;
        let now = Date.now();
        let foundIdx = -1;
        let safeArtist = artist || '';
        for (let i = 0; i < this._trackHistory.length && i < 10; i++) {
            if (this._trackHistory[i].title === title && this._trackHistory[i].artist === safeArtist) {
                foundIdx = i;
                break;
            }
        }

        let bus = active ? (active._busName || '') : '';
        let ident = active ? (active._identity || '') : '';
        let desktop = active ? (active._desktopEntry || '') : '';
        let url = trackUrl || (active && active.Metadata ? smartUnpack(active.Metadata['xesam:url']) : '') || '';

        if (foundIdx !== -1) {
            let existing = this._trackHistory[foundIdx];
            if (foundIdx === 0 || (now - existing.time < 30000)) {
                existing.time = now;
                if (bus) existing.busName = bus;
                if (ident) existing.identity = ident;
                if (desktop) existing.desktopEntry = desktop;
                if (url) existing.url = url;
                if (foundIdx > 0) {
                    this._trackHistory.splice(foundIdx, 1);
                    this._trackHistory.unshift(existing);
                }
                if (artUrl && existing.artUrl !== artUrl) {
                    let localArtUrl = artUrl;
                    if (artUrl.startsWith('file://')) {
                        try {
                            let hashKey = GLib.compute_checksum_for_string(
                                GLib.ChecksumType.MD5, title + '|' + (artist || '') + '|' + artUrl, -1);
                            let cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-music-pill', 'art']);
                            GLib.mkdir_with_parents(cacheDir, 0o755);
                            let destPath = GLib.build_filenamev([cacheDir, 'hist_' + hashKey + '.jpg']);
                            let srcFile = Gio.File.new_for_uri(artUrl);
                            let destFile = Gio.File.new_for_path(destPath);
                            srcFile.copy_async(destFile, Gio.FileCopyFlags.OVERWRITE,
                                GLib.PRIORITY_DEFAULT, null, null, (src, res) => {
                                    try {
                                        src.copy_finish(res);
                                    } catch (e) {
                                        console.debug(`[Dynamic Music Pill] History copy error: ${e.message}`);
                                    }
                                });
                            localArtUrl = destFile.get_uri();
                        } catch (e) {
                            console.debug(`[Dynamic Music Pill] History art prep error: ${e.message}`);
                        }
                    }

                    if (existing.artUrl !== localArtUrl) {
                        this._deleteHistoryArt(existing.artUrl);
                        existing.artUrl = localArtUrl;
                        existing.avgColor = null;
                        this._settings.set_string('playback-history', JSON.stringify(this._trackHistory));
                    }
                }
                return;
            }
        }

        let localArtUrl = artUrl || '';
        if (artUrl && artUrl.startsWith('file://')) {
            try {
                let hashKey = GLib.compute_checksum_for_string(
                    GLib.ChecksumType.MD5, title + '|' + (artist || '') + '|' + artUrl, -1);
                let cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-music-pill', 'art']);
                GLib.mkdir_with_parents(cacheDir, 0o755);
                let destPath = GLib.build_filenamev([cacheDir, 'hist_' + hashKey + '.jpg']);
                let srcFile = Gio.File.new_for_uri(artUrl);
                let destFile = Gio.File.new_for_path(destPath);
                srcFile.copy_async(destFile, Gio.FileCopyFlags.OVERWRITE,
                    GLib.PRIORITY_DEFAULT, null, null, (src, res) => {
                        try {
                            src.copy_finish(res);
                        } catch (e) {
                            console.debug(`[Dynamic Music Pill] History copy error: ${e.message}`);
                        }
                    });
                localArtUrl = destFile.get_uri();
            } catch (e) {
                console.debug(`[Dynamic Music Pill] History art prep error: ${e.message}`);
            }
        }

        this._trackHistory.unshift({
            title,
            artist: artist || '',
            artUrl: localArtUrl,
            time: now,
            avgColor: null,
            busName: bus,
            identity: ident,
            desktopEntry: desktop,
            url: url
        });

        while (this._trackHistory.length > 30) {
            let evicted = this._trackHistory.pop();
            this._deleteHistoryArt(evicted.artUrl);
        }

        this._settings.set_string('playback-history', JSON.stringify(this._trackHistory));
    }

    _deleteHistoryArt(artUrl) {
        if (!artUrl || !artUrl.startsWith('file://')) return;
        let file = Gio.File.new_for_uri(artUrl);
        let path = file.get_path() || '';
        if (path.includes('/dynamic-music-pill/art/hist_')) {
            if (file.query_exists(null)) {
                try {
                    file.delete(null);
                } catch (e) {
                    console.debug(`[Dynamic Music Pill] Failed to delete history art: ${e.message}`);
                }
            }
        }
    }

    getTrackHistory() {
        return this._trackHistory;
    }

    clearTrackHistory() {
        for (let entry of this._trackHistory) {
            this._deleteHistoryArt(entry.artUrl);
        }
        this._trackHistory = [];
        this._settings.set_string('playback-history', '[]');
    }

    _updateDefaultPlayerVisibility(shouldReset = false) {
        if (!this._settings) return;
        const hide = this._settings.get_boolean('hide-default-player');

        const MprisSource = Mpris.MprisSource ?? Mpris.MediaSection;
        const dateMenu = Main.panel.statusArea.dateMenu;
        const messageList = dateMenu ? dateMenu._messageList : null;
        const mediaSection = messageList
            ? (messageList._messageView ? messageList._messageView._mediaSource : messageList._mediaSection)
            : null;
        const qs = Main.panel.statusArea.quickSettings;
        const qsMedia = qs ? (qs._media || qs._mediaSection) : null;

        if (this._origMediaAddPlayer && (shouldReset || hide === false)) {
            MprisSource.prototype._addPlayer = this._origMediaAddPlayer;
            this._origMediaAddPlayer = null;

            if (mediaSection && mediaSection._onProxyReady) mediaSection._onProxyReady();
            if (qsMedia && qsMedia._onProxyReady) qsMedia._onProxyReady();
        } else if (!this._origMediaAddPlayer && hide === true) {
            this._origMediaAddPlayer = MprisSource.prototype._addPlayer;
            MprisSource.prototype._addPlayer = function () { };

            [mediaSection, qsMedia].forEach(section => {
                if (section && section._players) {
                    for (const player of section._players.values()) {
                        const busName = player._busName || player.busName;
                        if (section._onNameOwnerChanged) {
                            section._onNameOwnerChanged(null, null, [busName, busName, ""]);
                        }
                    }
                }
            });
        }
    }
}
