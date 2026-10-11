import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

export class SharedVisualizerEngine {
    static _instance = null;

    static get() {
        if (!this._instance) {
            this._instance = new SharedVisualizerEngine();
        }
        return this._instance;
    }

    static destroy() {
        if (this._instance) {
            this._instance.stopCava();
            this._instance = null;
        }
    }

    constructor() {
        this._subscribers = new Map(); // callback -> isPlaying
        this._cavaProcess = null;
        this._fixedBarCount = 64; 
        
        this._bins = new Array(this._fixedBarCount).fill(0);
        this._silentFrames = 0;
        this._rollingMax = 2000;
    }

    subscribe(callback) {
        if (!this._subscribers.has(callback)) {
            this._subscribers.set(callback, false);
        }
        this._evaluatePlayback();
    }

    unsubscribe(callback) {
        if (this._subscribers.delete(callback)) {
            this._evaluatePlayback();
        }
    }

    setPlaying(callback, playing) {
        if (this._subscribers.has(callback)) {
            this._subscribers.set(callback, playing);
            this._evaluatePlayback();
        }
    }

    _evaluatePlayback() {
        let anyPlaying = false;
        for (let isPlaying of this._subscribers.values()) {
            if (isPlaying) { anyPlaying = true; break; }
        }

        if (anyPlaying) {
            if (!this._cavaProcess) this.startCava();
        } else {
            this.stopCava();
            this._broadcast(new Array(this._fixedBarCount).fill(0), true);
        }
    }

    startCava() {
        if (this._cavaProcess) return;
        try {
            if (!GLib.find_program_in_path('cava')) return;

            let tmpConfig = `${GLib.get_tmp_dir()}/dynamic-pill-cava-${GLib.get_monotonic_time()}`;
            
            let cfg = `[general]\n` +
                      `bars = ${this._fixedBarCount}\n` +
                      `framerate = 60\n` +
                      `autosens = 1\n` +
                      `lower_cutoff_freq = 50\n` +
                      `higher_cutoff_freq = 8000\n` +  
                      `[smoothing]\n` +
                      `monstercat = 1.5\n` +        
                      `waves = 0\n` +
                      `noise_reduction = 60\n` +   
                      `gravity = 140\n` +             
                      `[input]\n` +
                      `method = pulse\n` +
                      `source = auto\n` +
                      `[output]\n` +
                      `method = raw\n` +
                      `bit_format = 16bit\n` +
                      `channels = mono\n` +
                      `raw_target = /dev/stdout\n`;

            GLib.file_set_contents(tmpConfig, new TextEncoder().encode(cfg));
            this._tmpConfigPath = tmpConfig;

            let launcher = new Gio.SubprocessLauncher({
                flags: Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_PIPE
            });
            
            launcher.setenv('PULSE_PROP', 'application.id=org.PulseAudio.pavucontrol', true);

            this._process = launcher.spawnv(['cava', '-p', tmpConfig]);

            this._stdout = this._process.get_stdout_pipe();
            this._cancellable = new Gio.Cancellable();
            this._bufferUsed = 0;
            this._rawBuffer = new Uint8Array(8192);
            this._cavaProcess = true;

            this._readStdoutBytes();
        } catch (e) {
            console.error("[Dynamic Music Pill] Shared Cava error: " + e.message);
        }
    }

    _readStdoutBytes() {
        if (!this._stdout || !this._cancellable || this._cancellable.is_cancelled()) return;

        let readSize = Math.max(4096, this._fixedBarCount * 2 * 4);
        this._stdout.read_bytes_async(readSize, GLib.PRIORITY_DEFAULT, this._cancellable, (stream, res) => {
            try {
                let gbytes = stream.read_bytes_finish(res);
                if (!gbytes) return;

                let chunk = gbytes.get_data();
                if (!chunk || chunk.length === 0) {
                    this._readStdoutBytes();
                    return;
                }

                let needed = this._bufferUsed + chunk.length;
                if (needed > this._rawBuffer.length) {
                    let newBuffer = new Uint8Array(Math.max(needed, this._rawBuffer.length * 2));
                    newBuffer.set(this._rawBuffer.subarray(0, this._bufferUsed));
                    this._rawBuffer = newBuffer;
                }
                this._rawBuffer.set(chunk, this._bufferUsed);
                this._bufferUsed += chunk.length;

                let frameSize = this._fixedBarCount * 2;
                let totalFrames = Math.floor(this._bufferUsed / frameSize);

                if (totalFrames > 0) {
                    let lastFrameOffset = (totalFrames - 1) * frameSize;
                    let dv = new DataView(this._rawBuffer.buffer, this._rawBuffer.byteOffset + lastFrameOffset, frameSize);

                    let currentFrameMax = 1;
                    for (let i = 0; i < this._fixedBarCount; i++) {
                        let v = dv.getUint16(i * 2, true);
                        this._bins[i] = v;
                        if (v > currentFrameMax) currentFrameMax = v;
                    }

                    if (currentFrameMax < 100) {
                        this._silentFrames++;
                    } else {
                        this._silentFrames = 0;
                    }

                    let normalizedArray = new Array(this._fixedBarCount).fill(0);

                    if (this._silentFrames >= 30) {
                        this._rollingMax = 2000;
                    } else {
                        if (currentFrameMax > this._rollingMax) {
                            this._rollingMax = currentFrameMax;
                        } else {
                            this._rollingMax = this._rollingMax * 0.98 + currentFrameMax * 0.02;
                        }
                        
                        let safeMax = Math.max(this._rollingMax, 5000); 
                        let invMaxVal = 1 / safeMax;

                        for (let i = 0; i < this._fixedBarCount; i++) {
                            normalizedArray[i] = Math.min(1.0, this._bins[i] * invMaxVal);
                        }
                    }

                    this._broadcast(normalizedArray, this._silentFrames >= 30);

                    this._rawBuffer.copyWithin(0, totalFrames * frameSize, this._bufferUsed);
                    this._bufferUsed -= totalFrames * frameSize;
                }
                this._readStdoutBytes();
            } catch (e) { }
        });
    }

    _broadcast(data, isSilent) {
        let deadCallbacks = null;
        for (let cb of this._subscribers.keys()) {
            try {
                cb(data, isSilent);
            } catch (_e) {
                if (!deadCallbacks) deadCallbacks = [];
                deadCallbacks.push(cb);
            }
        }
        if (deadCallbacks) {
            for (let cb of deadCallbacks) {
                this._subscribers.delete(cb);
            }
            this._evaluatePlayback();
        }
    }

    stopCava() {
        if (this._cancellable) {
            this._cancellable.cancel();
            this._cancellable = null;
        }
        if (this._process) {
            try { this._process.force_exit(); } catch (e) { }
            this._process = null;
        }
        if (this._stdout) {
            try { this._stdout.close(null); } catch (e) { }
            this._stdout = null;
        }
        if (this._tmpConfigPath) {
            try {
                let file = Gio.File.new_for_path(this._tmpConfigPath);
                if (file.query_exists(null)) file.delete(null);
            } catch (e) { }
            this._tmpConfigPath = null;
        }
        this._cavaProcess = false;
        this._silentFrames = 30;
    }
}
