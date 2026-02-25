import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Mpris from 'resource:///org/gnome/shell/ui/mpris.js';
import { smartUnpack } from './utils.js';
import { MusicPill, ExpandedPlayer } from './ui.js';
import { getMixerControl } from 'resource:///org/gnome/shell/ui/status/volume.js';

const MPRIS_IFACE = `
<node>
  <interface name="org.mpris.MediaPlayer2.Player">
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
  </interface>
</node>`;

export class MusicController {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension._settings;
        this._proxies = new Map();
        this._artCache = new Map();
        
        this._NodeInfo = Gio.DBusNodeInfo.new_for_xml(MPRIS_IFACE);
        this._PlayerInterfaceInfo = this._NodeInfo.interfaces.find(i => i.name === 'org.mpris.MediaPlayer2.Player');
        this._connection = Gio.bus_get_sync(Gio.BusType.SESSION, null);
        
        this._pill = new MusicPill(this);
        this._expandedPlayer = null;
        
        this._lastWinnerName = null;
        this._lastActionTime = 0;
        this._currentDock = null;
        this._isMovingItem = false;
    }

    enable() {
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
            if (this._pill && !this._pill.get_parent()) {
                 this._inject();
            }
            return GLib.SOURCE_CONTINUE;
        });
        
        this._updateDefaultPlayerVisibility();
    }

    disable() {
        if (this._startupCompleteId) {
            Main.layoutManager.disconnect(this._startupCompleteId);
            this._startupCompleteId = null;
        }

        if (this._currentDock) {
            this._currentDock.disconnectObject(this);
            this._currentDock = null;
        }
        global.display.disconnectObject(this);
        this._settings.disconnectObject(this);
        
        if (this._injectTimeout) { GLib.source_remove(this._injectTimeout); this._injectTimeout = null; }
        if (this._watchdog) { GLib.source_remove(this._watchdog); this._watchdog = null; }
        if (this._recheckTimer) { GLib.source_remove(this._recheckTimer); this._recheckTimer = null; }
        if (this._updateTimeoutId) { GLib.source_remove(this._updateTimeoutId); this._updateTimeoutId = null; }
        if (this._retryArtTimer) { GLib.source_remove(this._retryArtTimer); this._retryArtTimer = null; }
        
        if (this._ownerId) {
            this._connection.signal_unsubscribe(this._ownerId);
            this._ownerId = null;
        }
        
        if (this._expandedPlayer) {
            this._expandedPlayer.destroy();
            this._expandedPlayer = null;
        }
        if (this._pill) {
            this._pill.destroy();
            this._pill = null;
        }
        this._proxies.clear();
        
        this._updateDefaultPlayerVisibility(true);
    }
    performAction(action) {
        if (action === 'play_pause') this.togglePlayback();
        else if (action === 'next') this.next();
        else if (action === 'previous') this.previous();
        else if (action === 'open_app') this.openApp();
        else if (action === 'toggle_menu') this.toggleMenu();
    }

    openApp() {
        let player = this._getActivePlayer();
        if (!player) return;

        this._connection.call(
            player._busName,
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2', 
            'Raise',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => { try { conn.call_finish(res); } catch (e) {} }
        );

        let rawBus = player._busName.replace('org.mpris.MediaPlayer2.', '').split('.')[0].toLowerCase();
        let appSystem = Shell.AppSystem.get_default();
        let runningApps = appSystem.get_running();

        for (let app of runningApps) {
            let appName = app.get_name().toLowerCase();
            let appId = app.get_id().toLowerCase();

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

    toggleMenu() {
        if (this._expandedPlayer) {
            this._expandedPlayer.hide();
            return;
        }

        this._expandedPlayer = new ExpandedPlayer(this);
        Main.layoutManager.addChrome(this._expandedPlayer);

        let player = this._getActivePlayer();
        if (!player) return;

        let [px, py] = this._pill.get_transformed_position();
        let [pw, ph] = this._pill.get_transformed_size();
        let monitor = Main.layoutManager.findMonitorForActor(this._pill);

        let c = this._pill._displayedColor;
        this._expandedPlayer.updateStyle(c.r, c.g, c.b, this._pill._currentBgAlpha);
        
        let startW = 320;
        let startH = 260;
        let startX = px + (pw / 2) - (startW / 2);
        if (startX < monitor.x + 10) startX = monitor.x + 10;
        else if (startX + startW > monitor.x + monitor.width - 10) startX = monitor.x + monitor.width - startW - 10;
        let startY = py > monitor.y + (monitor.height / 2) ? py - startH - 15 : py + ph + 15;
        this._expandedPlayer.setPosition(startX, startY);

        let artUrl = this._pill._lastArtUrl;
        this._expandedPlayer.showFor(player, artUrl);

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
        if (this._injectTimeout) GLib.source_remove(this._injectTimeout);
        this._injectTimeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 100, () => {
            this._inject();
            this._injectTimeout = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _ensurePosition(container) {
        if (!container || this._isMovingItem) return false;

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

        if (currentIndex !== targetIndex) {
            this._isMovingItem = true;
            if (currentIndex !== -1) { container.remove_child(this._pill); }
            container.insert_child_at_index(this._pill, targetIndex);
            this._isMovingItem = false;
            return true;
        }
        return false;
    }

    _inject() {
        if (this._isMovingItem || !this._pill) return;

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
        }

        if (target === 0 && this._currentDock !== container) {
            this._currentDock = container;
            container.connectObject('child-added', (c, actor) => {
                if (actor !== this._pill && !this._isMovingItem) this._queueInject();
            }, this);
            container.connectObject('child-removed', (c, actor) => {
                if (actor !== this._pill && !this._isMovingItem) this._queueInject();
            }, this);
        }

        let moved = this._ensurePosition(container);

        if (parentChanged || moved || !oldParent) {
            this._pill._updateDimensions();
        }
    }

    _scan() {
        this._connection.call(
            'org.freedesktop.DBus', '/org/freedesktop/DBus', 'org.freedesktop.DBus', 'ListNames',
            null, null, Gio.DBusCallFlags.NONE, -1, null,
            (c, res) => {
                try {
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

                    for (let [name, proxy] of this._proxies) {
                        if (!mprisNames.includes(name)) {
                            this._proxies.delete(name);
                            this._artCache.delete(name);
                            changed = true;
                        }
                    }

                    if (changed) {
                        this._updateUI();
                    }
                } catch (e) { console.debug(e.message); }
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

                    p.connectSignal('Seeked', (proxy, senderName, [position]) => {
                        p._lastPosition = position;
                        p._lastPositionTime = Date.now();
                        this._triggerUpdate();
                        if (this._expandedPlayer && this._expandedPlayer.visible && this._lastWinnerName === p._busName) {
                            this._expandedPlayer._tick();
                        }
                    });

                    p.connect('g-properties-changed', (proxy, changed, invalidated) => {
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
                            if (keys.Metadata) {
                                let mObj = (keys.Metadata instanceof GLib.Variant) ? keys.Metadata.deep_unpack() : keys.Metadata;
                                trackId = smartUnpack(mObj['mpris:trackid']);
                                
                                if (trackId && trackId !== p._lastTrackId) {
                                    p._lastPosition = 0;
                                    p._lastTrackId = trackId;
                                }
                            }

                            this._connection.call(
                                p._busName,
                                '/org/mpris/MediaPlayer2',
                                'org.freedesktop.DBus.Properties',
                                'Get',
                                new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                                null, Gio.DBusCallFlags.NONE, -1, null,
                                (conn, res) => {
                                    try {
                                        let result = conn.call_finish(res);
                                        if (result) {
                                            let posVariant = result.deep_unpack()[0];
                                            if (posVariant) {
                                                p._lastPosition = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                                                p._lastPositionTime = Date.now();
                                                this._triggerUpdate();
                                            }
                                        }
                                    } catch (e) {}
                                }
                            );
                        }

                        this._triggerUpdate();
                    });

                    p.connect('notify::g-name-owner', () => { this._scan(); });

                    this._proxies.set(name, p);
                    
                    this._connection.call(
                        p._busName,
                        '/org/mpris/MediaPlayer2',
                        'org.freedesktop.DBus.Properties',
                        'Get',
                        new GLib.Variant('(ss)', ['org.mpris.MediaPlayer2.Player', 'Position']),
                        null, Gio.DBusCallFlags.NONE, -1, null,
                        (conn, res) => {
                            try {
                                let result = conn.call_finish(res);
                                if (result) {
                                    let posVariant = result.deep_unpack()[0];
                                    if (posVariant) {
                                        p._lastPosition = posVariant instanceof GLib.Variant ? posVariant.unpack() : posVariant;
                                        p._lastPositionTime = Date.now();
                                    }
                                }
                            } catch (e) {}
                            this._triggerUpdate();
                        }
                    );

                } catch (e) {
                    console.error(`Proxy not available.`);
                }
            }
        );
    }

    _triggerUpdate() {
        if (this._updateTimeoutId) {
            GLib.source_remove(this._updateTimeoutId);
        }

        let useDelay = this._settings ? this._settings.get_boolean('compatibility-delay') : false;
        let delay = useDelay ? 800 : 100;

        this._updateTimeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._updateUI();
            this._updateTimeoutId = null;
            return GLib.SOURCE_REMOVE;
        });
    }

    _updateUI() {
        if (this._recheckTimer) {
            GLib.source_remove(this._recheckTimer);
            this._recheckTimer = null;
        }

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
            this._lastWinnerName = active._busName;

            let m = active.Metadata;
            let title = null, artist = null, artUrl = null;
            let currentArt = null;

            if (m) {
                let metaObj = (m instanceof GLib.Variant) ? m.deep_unpack() : m;
                title = smartUnpack(metaObj['xesam:title']);
                artist = smartUnpack(metaObj['xesam:artist']);
                if (Array.isArray(artist)) artist = artist.map(a => smartUnpack(a)).join(', ');
                currentArt = smartUnpack(metaObj['mpris:artUrl']);
            }

            let rawName = active._busName || "";
            let cacheKey = rawName.includes('.instance') ? rawName.split('.instance')[0] : rawName;

            if (currentArt && typeof currentArt === 'string' && currentArt.trim() !== "") {
                this._artCache.set(cacheKey, currentArt);
                artUrl = currentArt;
            } else if (this._artCache.has(cacheKey)) {
                artUrl = this._artCache.get(cacheKey);
            } else {
                artUrl = null;
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

            this._pill.updateDisplay(title, artist, artUrl, active.PlaybackStatus, active._busName, isSkipActive, active);
        } else {
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

                let iconName = 'audio-volume-high-symbolic';
                if (stream.is_muted || newVolume === 0) iconName = 'audio-volume-muted-symbolic';
                else if (newVolume < maxVolume / 3) iconName = 'audio-volume-low-symbolic';
                else if (newVolume < maxVolume * 2 / 3) iconName = 'audio-volume-medium-symbolic';

                let icon = Gio.Icon.new_for_string(iconName);

                Main.osdWindowManager.show(-1, icon, null, newVolume / maxVolume, 1);
            }
        }
    
    toggleShuffle() {
        let p = this._getActivePlayer();
        if (!p || p.Shuffle === undefined) return; 
        
        this._connection.call(
            p._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'Shuffle', new GLib.Variant('b', !p.Shuffle)]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
        );
    }

    toggleLoop() {
        let p = this._getActivePlayer();
        if (!p || p.LoopStatus === undefined) return;
        
        let current = p.LoopStatus || 'None';
        let next = current === 'None' ? 'Playlist' : (current === 'Playlist' ? 'Track' : 'None');
        
        this._connection.call(
            p._busName, '/org/mpris/MediaPlayer2', 'org.freedesktop.DBus.Properties', 'Set',
            new GLib.Variant('(ssv)', ['org.mpris.MediaPlayer2.Player', 'LoopStatus', new GLib.Variant('s', next)]),
            null, Gio.DBusCallFlags.NONE, -1, null,
            (conn, res) => { try { conn.call_finish(res); } catch(e) {} }
        );
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
