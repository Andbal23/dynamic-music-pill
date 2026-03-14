import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';
import { smartUnpack, initDTDModule, getPlayerIcon } from './utils.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';
import { MusicPill, ExpandedPlayer, PlayerSelectorMenu } from './ui.js';
import { LyricsClient } from './LyricsClient.js';
import { Extension, gettext as _ } from 'resource:///org/gnome/shell/extensions/extension.js';
import { SharedVisualizerEngine } from './visualizerEngine.js';



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
        
        this._NodeInfo = Gio.DBusNodeInfo.new_for_xml(MPRIS_IFACE);
        this._PlayerInterfaceInfo = this._NodeInfo.interfaces.find(i => i.name === 'org.mpris.MediaPlayer2.Player');
        this._connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        
        this._expandedPlayer = null;
        this._lastWinnerName = null;
        this._lastActionTime = 0;
        this._currentDock = null;
        this._isMovingItem = false;

        this._trackHistory = [];
        try {
            let stored = this._settings.get_string('playback-history');
            this._trackHistory = JSON.parse(stored) || [];
        } catch(e) { this._trackHistory = []; }

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
    }

    _createPill() {
        if (this._pill || this._isShuttingDown || this._isCreatingPill) return;
        this._isCreatingPill = true;
        this._pill = new MusicPill(this);
        this._pill.connect('destroy', () => {
            this._pill = null;
            if (!this._isShuttingDown && !this._isCreatingPill) {
                this._queueInject();
            }
        });
        this._isCreatingPill = false;
    }

    enable() {
        this._isShuttingDown = false;
        this._createPill();
        initDTDModule();
        
        global.display.connectObject('notify::focus-window', () => this._monitorGameMode(), this);
        this._settings.connectObject('changed::hide-default-player', () => this._updateDefaultPlayerVisibility(), this);

        if (Main.layoutManager._startingUp) {
            this._startupCompleteId = Main.layoutManager.connect('startup-complete', () => {
                Main.layoutManager.disconnect(this._startupCompleteId);
                this._startupCompleteId = null;
                this._doEnable();
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
        this._settings.connectObject('changed::player-filter-mode', () => this._scan(), this);
    this._settings.connectObject('changed::player-filter-list', () => this._scan(), this);

        this._watchdog = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 5, () => {
            this._monitorGameMode();
            if (!this._pill || !this._pill.get_parent()) {
                this._inject();
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
                if (this._pill) this._pill.setLyric(null);
                this._stopLyricsTimer();
                this._fetchedLyricsData = null;
                this._fetchedTrackKey = null;
                this._dbusLyricActive = false;
            } else {
                this._triggerUpdate();
            }
        }, this);
    }

    disable() {
        this._isShuttingDown = true;
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
        if (this._pill) {
            this._pill.destroy();
            this._pill = null;
        }
        for (let name of this._proxies.keys()) {
            this._removeProxy(name);
        }
        this._proxies.clear();
        
        this._updateDefaultPlayerVisibility(true);
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
            try {
                let mapStr = this._settings.get_string('app-name-mapping') || '';
                let pairs = mapStr.split(',');
                for (let pair of pairs) {
                    let parts = pair.split(':');
                    if (parts.length === 2) {
                        mapping[parts[0].trim().toLowerCase()] = parts[1].trim().toLowerCase();
                    }
                }
            } catch (e) {}
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
                try { conn.call_finish(res); } catch (e) {} 
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
        if (!player) return;

        this._connection.call(
            player._busName, '/org/mpris/MediaPlayer2', 'org.mpris.MediaPlayer2', 'Raise',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => { try { conn.call_finish(res); } catch (e) {} }
        );

        let appSystem = Shell.AppSystem.get_default();
        let runningApps = appSystem.get_running();

        let busNameParts = player._busName.replace('org.mpris.MediaPlayer2.', '').split('.');
        let rawBus = busNameParts[0].toLowerCase();
        let fullBusId = busNameParts.join('.').toLowerCase();
        
        let desktopEntry = (player._desktopEntry || '').toLowerCase();
        let identity = (player._identity || '').toLowerCase();

        let customMapping = this._getCustomAppMapping();
        let customTarget = customMapping[fullBusId] || customMapping[rawBus] || customMapping[identity] || null;
        if (customTarget === 'enter_app_id_here') customTarget = null;

        for (let app of runningApps) {
            let appId = app.get_id().toLowerCase();
            let appName = app.get_name().toLowerCase();
            let isMatch = false;

            if (customTarget && (appId.includes(customTarget) || appName.includes(customTarget))) {
                isMatch = true; 
            } else if (!customTarget && desktopEntry && appId.includes(desktopEntry)) {
                isMatch = true; 
            } else if (!customTarget && identity && appName === identity) {
                isMatch = true;
            } else if (!customTarget && appId.includes(fullBusId)) {
                isMatch = true;
            }

            if (isMatch) {
                let windows = app.get_windows();
                if (windows && windows.length > 0) {
                    if (Main.activateWindow) Main.activateWindow(windows[0]);
                    else windows[0].activate(global.get_current_time());
                    return;
                }
                app.activate();
                return;
            }
        }

        for (let app of runningApps) {
            let appId = app.get_id().toLowerCase();
            let appName = app.get_name().toLowerCase();

            if (appId.includes(rawBus) || appName.includes(rawBus)) {
                let windows = app.get_windows();
                if (windows && windows.length > 0) {
                    if (Main.activateWindow) Main.activateWindow(windows[0]);
                    else windows[0].activate(global.get_current_time());
                    return;
                }
                app.activate();
                return;
            }
        }
    }
    
    togglePlayerMenu() {
        if (this._playerMenu) {
            this._playerMenu.hide();
            return;
        }
        
        this._playerMenu = new PlayerSelectorMenu(this);
        this._playerMenu.connect('destroy', () => { this._playerMenu = null; });
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
            this._expandedPlayer.hide();
            this._expandedPlayer.connect('destroy', () => { this._expandedPlayer = null; });
            return;
        }

        this._expandedPlayer = new ExpandedPlayer(this);
        this._expandedPlayer.connect('destroy', () => { this._expandedPlayer = null; });
        Main.layoutManager.addChrome(this._expandedPlayer);

        let player = this._getActivePlayer();
        if (!player) return;

        let [px, py] = this._pill.get_transformed_position();
        let [pw, ph] = this._pill.get_transformed_size();
        let monitor = Main.layoutManager.findMonitorForActor(this._pill);

        let c = this._pill._displayedColor;
        this._expandedPlayer.updateStyle(c.r, c.g, c.b, this._pill._currentBgAlpha);
        
        let artUrl = this._pill._lastArtUrl;
        this._expandedPlayer.showFor(player, artUrl);

        this._expandedPlayer._box.set_width(-1);
        let [minW, natW] = this._expandedPlayer._box.get_preferred_width(-1);
        let [minH, natH] = this._expandedPlayer._box.get_preferred_height(natW);

        let minWLimit = this._expandedPlayer._computeMinControlsWidth();
        let startW;
        if (this._settings.get_boolean('popup-use-custom-width')) {
            startW = Math.max(this._settings.get_int('popup-custom-width'), minWLimit);
        } else {
            startW = Math.min(Math.max(natW > 0 ? natW : minWLimit, minWLimit), 600);
        }
        
        let startH = natH > 0 ? natH : 260;

        let startX = px + (pw / 2) - (startW / 2);
        if (monitor) {
            if (startX < monitor.x + 10) startX = monitor.x + 10;
            else if (startX + startW > monitor.x + monitor.width - 10) startX = monitor.x + monitor.width - startW - 10;
        }
        
        let startY = (monitor && py > monitor.y + (monitor.height / 2)) ? py - startH - 15 : py + ph + 15;
        this._expandedPlayer.setPosition(startX, startY);

        this._expandedPlayer.animateResize();
    }

    closeMenu() {
        if (this._expandedPlayer) {
            Main.layoutManager.removeChrome(this._expandedPlayer);
            this._expandedPlayer.destroy();
            this._expandedPlayer = null;
        }
    }

    _isGameModeActive() {
        if (!this._settings.get_boolean('enable-gamemode')) return false;
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
        if (!this._pill) return;
        let isGame = this._isGameModeActive();
        this._pill.setGameMode(isGame);
    }

    _queueInject() {
        if (this._injectTimeout) GLib.Source.remove(this._injectTimeout);
        this._injectTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._inject();
            this._injectTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _ensurePosition(container) {
        if (!container || this._isMovingItem || this._isUserDragging) return false;

        let mode = this._settings ? this._settings.get_int('position-mode') : 1;
        let manualIndex = this._settings ? this._settings.get_int('dock-position') : 0;

        let children = container.get_children();
        let otherChildren = children.filter(c => c !== this._pill);
        let realItemCount = otherChildren.length;
        let targetIndex = 0;

        if (mode === 0) { targetIndex = manualIndex; }
        else if (mode === 1) { targetIndex = 0; }
        else if (mode === 2) { targetIndex = Math.floor(realItemCount / 2); }
        else if (mode === 3) { targetIndex = realItemCount; }

        if (targetIndex > realItemCount) targetIndex = realItemCount;
        if (targetIndex < 0) targetIndex = 0;

        let currentIndex = children.indexOf(this._pill);
        let pillParent = this._pill.get_parent();

        if (currentIndex === -1 && pillParent === container) {
            currentIndex = 0;
        }
        if (pillParent && pillParent !== container) {
            pillParent.remove_child(this._pill);
            currentIndex = -1;
        }

        if (currentIndex !== targetIndex) {
            this._isMovingItem = true;

            if (currentIndex !== -1) {
                container.set_child_at_index(this._pill, targetIndex);
            } else {
                container.insert_child_at_index(this._pill, targetIndex);
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

        if (target === 0) {
            let dtd = Main.panel.statusArea['dash-to-dock'];
            container = (dtd && dtd._box) ? dtd._box : (Main.overview.dash._box || null);
        } else if (target === 1) container = Main.panel._leftBox;
        else if (target === 2) container = Main.panel._centerBox;
        else if (target === 3) container = Main.panel._rightBox;

        if (!container) return;

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
    }

    _setupDragFix(container) {
        const dash = container._delegate;
        if (!dash || typeof dash.handleDragOver !== 'function') return;
        if (dash._musicPillOrigHandleDragOver) return;

        const _adjustX = (x) => {
            const pill = this._pill;
            if (!pill || pill.get_parent() !== container) return x;
            const pillWidth = pill.get_width();
            const pillX = pill.x;
            if (x > pillX + pillWidth) return x - pillWidth;
            if (x >= pillX) return pillX;
            return x;
        };

        const _adjustWidth = (fn) => {
            const pill = this._pill;
            const pillWidth = (pill && pill.get_parent() === container) ? pill.get_width() : 0;
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

        if (typeof dash.acceptDrop === 'function') {
            dash._musicPillOrigAcceptDrop = dash.acceptDrop;
            dash.acceptDrop = (source, actor, x, y, time) => {
                const pill = this._pill;
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
                        this._ensurePosition(container);
                        this._isMovingItem = false;
                    }
                }
                return result;
            };
        }

        this._dragFixDash = dash;
    }

    _teardownDragFix() {
        if (!this._dragFixDash) return;
        const dash = this._dragFixDash;

        if (dash._musicPillOrigHandleDragOver) {
            dash.handleDragOver = dash._musicPillOrigHandleDragOver;
            delete dash._musicPillOrigHandleDragOver;
        }
        if (dash._musicPillOrigAcceptDrop) {
            dash.acceptDrop = dash._musicPillOrigAcceptDrop;
            delete dash._musicPillOrigAcceptDrop;
        }

        this._dragFixDash = null;
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

                if (changed) {
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
                try {
                    let p = Gio.DBusProxy.new_finish(res);
                    p._busName = name;
                    p._lastSeen = Date.now();
                    p._lastStatusTime = Date.now();

                    let status = p.PlaybackStatus;
                    p._lastPlayingTime = (status === 'Playing') ? Date.now() : 0;
                    p._lastPosition = 0;
                    p._lastPositionTime = Date.now();
                    p._lastTrackId = null;

                    p._seekedId = p.connectSignal('Seeked', (proxy, senderName, [position]) => {
                        p._lastPosition = position;
                        p._lastPositionTime = Date.now();
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
                            p._lastPosition = keys.Position;
                            p._lastPositionTime = now;
                            this._triggerUpdate();
                            return;
                        }

                        if (keys.Metadata !== undefined || keys.PlaybackStatus !== undefined) {
                            let trackId = null;
                            let trackChanged = false;
                            if (keys.Metadata) {
                                let mObj = (keys.Metadata instanceof GLib.Variant) ? keys.Metadata.deep_unpack() : keys.Metadata;
                                trackId = smartUnpack(mObj['mpris:trackid']);
                                
                                if (trackId && trackId !== p._lastTrackId) {
                                    p._lastPosition = 0;
                                    p._lastTrackId = trackId;
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
                                        try {
                                            let result = conn.call_finish(asyncRes);
                                            if (result) {
                                                let posVariant = result.deep_unpack()[0];
                                                if (posVariant) {
                                                    p._lastPosition = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                                                    p._lastPositionTime = Date.now();
                                                    this._triggerUpdate();
                                                }
                                            }
                                        } catch (e) { console.debug(e.message); }
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
                        try {
                          let result = conn.call_finish(asyncRes);
                          if (result) {
                            let props = result.deep_unpack()[0];
                            if (props['Identity']){
                              let v = props['Identity'];
                              p._identity = v instanceof GLib.Variant ? v.unpack() : v;
                            }
                            if (props['DesktopEntry']){
                              let v = props['DesktopEntry'];
                              p._desktopEntry = v instanceof GLib.Variant ? v.unpack() : v;
                            }

                            p._gicon = this._resolvePlayerIcon(p);
                            this._triggerUpdate();
                          }
                        } catch (e) { console.debug(e.message); }
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
                            try {
                                let result = conn.call_finish(asyncRes);
                                if (result) {
                                    let posVariant = result.deep_unpack()[0];
                                    if (posVariant) {
                                        p._lastPosition = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                                        p._lastPositionTime = Date.now();
                                    }
                                }
                            } catch (e) { console.debug(e.message); }
                            this._triggerUpdate();
                        }
                    );

                } catch (e) {
                    console.error(`Proxy not available.`);
                }
            }
        );
    }
    
    _artCacheSet(key, value) {
        if (this._artCache.has(key)) this._artCache.delete(key);
        this._artCache.set(key, value);
        if (this._artCache.size > this._artCacheMax) {
            this._artCache.delete(this._artCache.keys().next().value);
        }
    }

    _resolvePlayerIcon(p) {
        try {
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
        } catch (e) { console.debug('[Dynamic Music Pill] _resolvePlayerIcon: ' + e.message); }


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
            try {
                // When the lyrics switch is off, ignore lyrics updates
                if (!this._settings || !this._settings.get_boolean('enable-lyrics')) {
                    invocation.return_value(null);
                    return;
                }

                let raw = parameters.unpack()[0];
                let lrc = JSON.parse(raw.get_string()[0]);

                let active = this._getActivePlayer();
                let activeBus = active ? (active._busName || "") : "";

                if (!active || lrc.content === "" || !activeBus.includes(lrc.sender)) {
                    if (this._pill) this._pill.setLyric(null);
                    this._dbusLyricActive = false;
                } else {
                    this._dbusLyricActive = true;
                    this._stopLyricsTimer();
                    if (this._pill) this._pill.setLyric(lrc);
                }
            } catch (e) {
                console.debug(`[DynamicMusicPill] Lyric error: ${e}`);
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
        if (!title) return;

        let trackKey = `${title}||${artist}`;

        if (this._fetchedTrackKey === trackKey && this._fetchedLyricsData !== undefined) {
            return;
        }

        this._fetchedTrackKey = trackKey;
        this._fetchedLyricsData = null; 
        this._lastLyricIndex = -1;

        let durationSec = length > 0 ? length / 1000000 : 0;

        try {
            let lyrics = await this._lyricsClient.getLyrics(title, artist, album, durationSec);
            if (this._fetchedTrackKey !== trackKey) return;

            this._fetchedLyricsData = lyrics; 

            if (lyrics && lyrics.length > 0) {
                this._startLyricsTimer();
            }
        } catch (e) {
            console.debug(`[DynamicMusicPill] Network lyrics fetch error: ${e}`);
            this._fetchedLyricsData = null;
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
                try {
                    let result = conn.call_finish(asyncRes);
                    if (result) {
                        let posVariant = result.deep_unpack()[0];
                        if (posVariant) {
                            player._lastPosition = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                            player._lastPositionTime = Date.now();
                        }
                    }
                } catch (e) {console.debug(`[Dynamic Music Pill] Position sync error: ${e.message}`);}
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

        let positionUs = active._lastPosition + (now - active._lastPositionTime) * 1000;
        let positionMs = positionUs / 1000;

        let currentIndex = -1;
        for (let i = this._fetchedLyricsData.length - 1; i >= 0; i--) {
            if (this._fetchedLyricsData[i].time <= positionMs) {
                currentIndex = i;
                break;
            }
        }

        if (currentIndex >= 0 && currentIndex !== this._lastLyricIndex) {
            this._lastLyricIndex = currentIndex;

            let currentLine = this._fetchedLyricsData[currentIndex];
            let durationSec = 5;
            if (currentIndex + 1 < this._fetchedLyricsData.length) {
                durationSec = (this._fetchedLyricsData[currentIndex + 1].time - currentLine.time) / 1000;
            }

            let lrc = {
                sender: "lrclib",
                content: currentLine.text,
                time: durationSec,
            };
            this._pill.setLyric(lrc);
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

    _updateUI() {
        if (this._recheckTimer) {
            GLib.Source.remove(this._recheckTimer);
            this._recheckTimer = null;
        }

        if (!this._pill) this._createPill();
        if (!this._pill) return;

        let target = this._settings ? this._settings.get_int('target-container') : 0;
        let container = null;
        if (target === 0) {
            let dtd = Main.panel.statusArea['dash-to-dock'];
            container = (dtd && dtd._box) ? dtd._box : (Main.overview.dash._box || null);
        } else if (target === 1) container = Main.panel._leftBox;
        else if (target === 2) container = Main.panel._centerBox;
        else if (target === 3) container = Main.panel._rightBox;

        if (container) {
            this._ensurePosition(container);
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
            if (!title && active._busName) {
                title = active._identity || _("Unknown Player");
		artist = _("No active media");
            }

            let rawName = active._busName || "";
            let cacheKey = rawName.includes('.instance') ? rawName.split('.instance')[0] : rawName;

            if (currentArt && typeof currentArt === 'string' && currentArt.trim() !== "") {
                let isFileUrl = currentArt.startsWith('file://');
                let fileExists = !isFileUrl || Gio.File.new_for_uri(currentArt).query_exists(null);
                if (fileExists) {
                    this._artCacheSet(cacheKey, currentArt);
                    artUrl = currentArt;
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
                                thumbFile.copy(ownFile, Gio.FileCopyFlags.OVERWRITE, null, null);
                                artUrl = ownFile.get_uri();
                                this._artCacheSet(cacheKey, artUrl);
                            }
                        }
                    }
                } catch (e) {}
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

            if (title && active.PlaybackStatus === 'Playing') {
                this._recordHistory(title, artist, artUrl);
            }

            if (!artUrl && active.PlaybackStatus === 'Playing' && !this._retryArtTimer) {
                this._retryArtTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
                    this._retryArtTimer = null;
                    if (this._proxies.has(active._busName)) {
                        this._updateUI();
                    }
                    return GLib.SOURCE_REMOVE;
                });
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

                let currentTrackKey = `${currentTitle}||${currentArtist}`;

                if (currentTitle && this._fetchedTrackKey !== currentTrackKey) {
                    this._pill.setLyric(null);
                    this._fetchNetworkLyrics(active);
                } else if (this._fetchedLyricsData && active.PlaybackStatus === 'Playing') {
                    this._startLyricsTimer();
                } else if (active.PlaybackStatus !== 'Playing') {
                    this._stopLyricsTimer();
                }
            }

            this._pill.updateDisplay(title, artist, artUrl, active.PlaybackStatus, active._busName, isSkipActive, active);
        } else {
            this._stopLyricsTimer();
            this._fetchedTrackKey = null;
            this._fetchedLyricsData = null;
            this._dbusLyricActive = false;
            this._lastLyricIndex = -1;
            this._lastPositionSync = 0;
            this._pill.updateDisplay(null, null, null, 'Stopped', null, false);
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
                let url = metaObj['xesam:url'] ? smartUnpack(metaObj['xesam:url']).toLowerCase() : "";
                
                let isWebContent = url.startsWith('http://') || url.startsWith('https://');

                if (isWebContent && filterMode === 2) {
                    let urlMatch = filterList.some(item => url.includes(item));
                    if (!urlMatch) return { player: p, score: -1 };
                }
            }

            let hasTitle = m && smartUnpack(m['xesam:title']);
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
            let anyPlaying = scoredPlayers.find(s => s.score > 0 && s.player.PlaybackStatus === 'Playing' && smartUnpack(s.player.Metadata['xesam:title']));
            if (anyPlaying) winner = anyPlaying.player;
        }
        return winner;
    }

    togglePlayback() { let p = this._getActivePlayer(); if (p) p.PlayPauseRemote(); }
    next() { this._lastActionTime = Date.now(); let p = this._getActivePlayer(); if (p) p.NextRemote(); }
    previous() { this._lastActionTime = Date.now(); let p = this._getActivePlayer(); if (p) p.PreviousRemote(); }
    
    _showPillFeedback(iconNameOrGicon, text, percent = null) {
        if (!this._pill || !this._pill._textWrapper) return;

        if (this._feedbackTimer) {
            GLib.Source.remove(this._feedbackTimer);
            this._feedbackTimer = null;
        }

        if (!this._pill._feedbackBox) {
            this._pill._feedbackBox = new St.BoxLayout({
                vertical: false,
                x_align: Clutter.ActorAlign.CENTER,
                y_align: Clutter.ActorAlign.CENTER,
                style: 'spacing: 8px;'
            });

            this._pill._feedbackIcon = new St.Icon({ icon_size: 16 });
            this._pill._feedbackLabel = new St.Label({ y_align: Clutter.ActorAlign.CENTER });
            
            this._pill._feedbackSliderBg = new St.Widget({
                y_align: Clutter.ActorAlign.CENTER,
                style: 'border-radius: 4px;',
                height: 6,
                width: 80 
            });
            this._pill._feedbackSliderFill = new St.Widget({
                style: 'border-radius: 4px;',
                height: 6,
                width: 0
            });
            this._pill._feedbackSliderBg.add_child(this._pill._feedbackSliderFill);

            this._pill._feedbackBox.add_child(this._pill._feedbackIcon);
            this._pill._feedbackBox.add_child(this._pill._feedbackSliderBg);
            this._pill._feedbackBox.add_child(this._pill._feedbackLabel);

            this._pill._textWrapper.add_child(this._pill._feedbackBox);
        }

        let c = this._pill._displayedColor || { r: 40, g: 40, b: 40 };
        let brightness = (c.r * 299 + c.g * 587 + c.b * 114) / 1000;
        let isLight = brightness > 160;
        let color = isLight ? 'rgb(30, 30, 30)' : 'rgb(255, 255, 255)';
        let bgTrack = isLight ? 'rgba(30, 30, 30, 0.2)' : 'rgba(255, 255, 255, 0.2)';

        if (typeof iconNameOrGicon === 'string') {
            this._pill._feedbackIcon.icon_name = iconNameOrGicon;
            this._pill._feedbackIcon.gicon = null;
            this._pill._feedbackIcon.fallback_icon_name = 'audio-x-generic-symbolic';
        } else {
            this._pill._feedbackIcon.icon_name = null;
            this._pill._feedbackIcon.fallback_icon_name = null;
            this._pill._feedbackIcon.gicon = iconNameOrGicon;
        }
        this._pill._feedbackIcon.set_style(`color: ${color};`);
        
        this._pill._feedbackLabel.text = text;
        this._pill._feedbackLabel.set_style(`font-size: 10.5pt; font-weight: bold; color: ${color};`);

        if (percent !== null) {
            this._pill._feedbackSliderBg.show();
            this._pill._feedbackSliderBg.set_style(`background-color: ${bgTrack}; border-radius: 4px;`);
            this._pill._feedbackSliderFill.set_style(`background-color: ${color}; border-radius: 4px;`);
            
            this._pill._feedbackSliderFill.ease({
                width: Math.max(0, percent * 80),
                duration: 100,
                mode: Clutter.AnimationMode.EASE_OUT_QUAD
            });
            
            this._pill._feedbackLabel.text = `${Math.round(percent * 100)}%`;
        } else {
            this._pill._feedbackSliderBg.hide();
        }

        this._pill._textBox.ease({ opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
        this._pill._feedbackBox.opacity = 0;
        this._pill._feedbackBox.show();
        this._pill._feedbackBox.ease({ opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });

        this._feedbackTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 1500, () => {
            this._feedbackTimer = null;
            if (this._pill && this._pill._feedbackBox) {
                this._pill._feedbackBox.ease({ 
                    opacity: 0, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD, 
                    onStopped: () => { this._pill._feedbackBox.hide(); } 
                });
                this._pill._textBox.ease({ opacity: 255, duration: 150, mode: Clutter.AnimationMode.EASE_OUT_QUAD });
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    changeVolume(up) {
        let mixer = getMixerControl();
        if (!mixer) return;

        let stream = mixer.get_default_sink();
        if (!stream) return;

        let maxVolume = mixer.get_vol_max_norm();
        let step = Math.round(maxVolume * 0.05);

        if (up && stream.is_muted) {
            stream.change_is_muted(false);
        }

        let newVolume = up ? stream.volume + step : stream.volume - step;
        newVolume = Math.max(0, Math.min(maxVolume, newVolume));

        if (stream.volume !== newVolume) {
            stream.volume = newVolume;
            stream.push_volume();

            let percent = newVolume / maxVolume;
            let iconName = 'audio-volume-high-symbolic';
            if (stream.is_muted || newVolume === 0) iconName = 'audio-volume-muted-symbolic';
            else if (percent < 0.33) iconName = 'audio-volume-low-symbolic';
            else if (percent < 0.66) iconName = 'audio-volume-medium-symbolic';

            this._showPillFeedback(iconName, '', percent);
        }
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
        (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
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
        (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
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
            (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
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
            (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
        );
        this._showPillFeedback('power-profile-performance-symbolic', `${rate}×`);
        return true;
    }

    getPlaybackRate() {
        let p = this._getActivePlayer();
        if (!p) return 1.0;
        try {
            let v = p.get_cached_property('Rate');
            if (v) return v.unpack();
        } catch(e) {}
        return 1.0;
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
            try {
                let v = p.get_cached_property(name);
                if (v) return v.unpack();
            } catch(e) {}
            return false;
        };
        const readDouble = (name) => {
            try {
                let v = p.get_cached_property(name);
                if (v) return v.unpack();
            } catch(e) {}
            return null;
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


    _recordHistory(title, artist, artUrl) {
        if (!title) return;
        if (this._trackHistory.length > 0) {
            let last = this._trackHistory[0];
            if (last.title === title && last.artist === artist) return;
        }

        let localArtUrl = artUrl || '';
        if (artUrl && artUrl.startsWith('file://')) {
            try {
                let hashKey = GLib.compute_checksum_for_string(
                    GLib.ChecksumType.MD5, title + '|' + (artist || ''), -1);
                let cacheDir = GLib.build_filenamev([GLib.get_user_cache_dir(), 'dynamic-music-pill', 'art']);
                GLib.mkdir_with_parents(cacheDir, 0o755);
                let destPath = GLib.build_filenamev([cacheDir, 'hist_' + hashKey + '.jpg']);
                let srcFile  = Gio.File.new_for_uri(artUrl);
                let destFile = Gio.File.new_for_path(destPath);
                if (!destFile.query_exists(null)) {
                    srcFile.copy(destFile, Gio.FileCopyFlags.NONE, null, null);
                }
                localArtUrl = destFile.get_uri();
            } catch(e) {  }
        }

        this._trackHistory.unshift({ title, artist: artist || '', artUrl: localArtUrl, time: Date.now(), avgColor: null });

        while (this._trackHistory.length > 30) {
            let evicted = this._trackHistory.pop();
            this._deleteHistoryArt(evicted.artUrl);
        }

        try {
            this._settings.set_string('playback-history', JSON.stringify(this._trackHistory));
        } catch(e) {}
    }

    _deleteHistoryArt(artUrl) {
        if (!artUrl || !artUrl.startsWith('file://')) return;
        try {
            let file = Gio.File.new_for_uri(artUrl);
            let path = file.get_path() || '';
            if (path.includes('/dynamic-music-pill/art/hist_')) {
                if (file.query_exists(null)) file.delete(null);
            }
        } catch(e) {  }
    }

    getTrackHistory() {
        return this._trackHistory;
    }

    clearTrackHistory() {
        for (let entry of this._trackHistory) {
            this._deleteHistoryArt(entry.artUrl);
        }
        this._trackHistory = [];
        try {
            this._settings.set_string('playback-history', '[]');
        } catch(e) {}
    }

    _updateDefaultPlayerVisibility(shouldReset = false) {
        if (!this._settings) return;
        const hide = this._settings.get_boolean('hide-default-player');

        const MprisSource = Mpris.MprisSource ?? Mpris.MediaSection;
        const mediaSection = Main.panel.statusArea.dateMenu?._messageList?._messageView?._mediaSource ?? 
                             Main.panel.statusArea.dateMenu?._messageList?._mediaSection;
        const qsMedia = Main.panel.statusArea.quickSettings?._media || 
                        Main.panel.statusArea.quickSettings?._mediaSection;

        if (this._origMediaAddPlayer && (shouldReset || hide === false)) {
            MprisSource.prototype._addPlayer = this._origMediaAddPlayer;
            this._origMediaAddPlayer = null;

            if (mediaSection && mediaSection._onProxyReady) mediaSection._onProxyReady();
            if (qsMedia && qsMedia._onProxyReady) qsMedia._onProxyReady();
        } else if (!this._origMediaAddPlayer && hide === true) {
            this._origMediaAddPlayer = MprisSource.prototype._addPlayer;
            MprisSource.prototype._addPlayer = function () {};

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
