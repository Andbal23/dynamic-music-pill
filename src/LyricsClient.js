import Soup from "gi://Soup";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const decode = (data) => new TextDecoder().decode(data);

const CJK_RE = /[\u3040-\u9FFF\uAC00-\uD7AF]/;

export class LyricsClient {
  constructor() {
    Gio._promisify(
      Soup.Session.prototype,
      "send_and_read_async",
      "send_and_read_finish",
    );
    this._session = new Soup.Session();
  }


  _detectScript(lines) {
    if (!lines || lines.length === 0) return 'unknown';
    const sample = lines.slice(0, Math.min(15, lines.length)).map(l => l.text).join(' ');
    const cjkCount = (sample.match(new RegExp(CJK_RE.source, 'g')) || []).length;
    const latinCount = (sample.match(/[a-zA-Z]/g) || []).length;
    const totalChars = sample.replace(/\s/g, '').length;

    if (totalChars === 0) return 'unknown';

    const cjkRatio = cjkCount / totalChars;
    const latinRatio = latinCount / totalChars;

    if (cjkRatio > 0.15) return 'original';
    if (latinRatio > 0.4) return 'latin';
    return 'unknown';
}

  _scoreItem(item, pref) {
    if (!item.syncedLyrics) return -1;
    if (pref === 0) return 0;
    const parsed = this._parseLRC(item.syncedLyrics);
    const script = this._detectScript(parsed);
    if (pref === 1) return script === 'original' ? 2 : (script === 'unknown' ? 0 : 1);
    if (pref === 2) return script === 'latin'    ? 2 : (script === 'unknown' ? 0 : 1);
    return 0;
  }

  async getLyrics(title, artist, album, duration, settings) {
    if (!this._session) return null;
    if (!title?.trim() && !artist?.trim()) return null;
    if (!duration || duration <= 0) return null;
    const pref = settings ? settings.get_int('lyrics-language-preference') : 0;

    try {
      const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title || '')}&artist_name=${encodeURIComponent(artist || '')}&album_name=${encodeURIComponent(album || '')}&duration=${duration}`;
      let msg;
      try { msg = Soup.Message.new("GET", url); } catch (_e) { throw new Error('Failed to create request'); }
      if (!msg) throw new Error('Failed to create request');
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);

      let exactItem = null;
      if (msg.status_code === Soup.Status.OK) {
        try { exactItem = JSON.parse(decode(bytes.get_data())); } catch (_) {}
      }

      const candidates = await this._fetchCandidates(title, artist, duration);

      if (exactItem && exactItem.syncedLyrics) {
        const alreadyIn = candidates.some(c => c.id === exactItem.id);
        if (!alreadyIn) candidates.unshift(exactItem);
      }

      if (candidates.length === 0) return null;

      let best = null;
      let bestScore = -Infinity;

      for (const item of candidates) {
        if (!item.syncedLyrics) continue;
        const durationScore = -Math.abs((item.duration || 0) - duration);
        const prefScore = this._scoreItem(item, pref) * 1000; // preference dominates
        const total = prefScore + durationScore;
        if (total > bestScore) {
          bestScore = total;
          best = item;
        }
      }

      return best ? this._parseLRC(best.syncedLyrics) : null;

    } catch (e) {
      console.debug(`[Dynamic Music Pill] Lyrics fetch error: ${e.message}`);
      throw e; // re-throw so caller can distinguish error from "no lyrics found"
    }
  }

  async _fetchCandidates(title, artist, duration) {
    if (!this._session) return [];
    if (!title?.trim()) return [];
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent((title || '') + " " + (artist || ''))}`;
      let msg;
      try { msg = Soup.Message.new("GET", url); } catch (_e) { throw new Error('Failed to create search request'); }
      if (!msg) throw new Error('Failed to create search request');
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      const data = JSON.parse(decode(bytes.get_data()));
      return Array.isArray(data)
        ? data.filter(item => Math.abs((item.duration || 0) - duration) < 5)
        : [];
    } catch (e) {
      console.debug(`[Dynamic Music Pill] Lyrics search error: ${e.message}`);
      throw e; // re-throw so caller can distinguish error from "no results"
    }
  }

  _parseLRC(lrcText) {
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;

    const all = [];
    for (const line of lrcText.split("\n")) {
      const match = line.match(regex);
      if (match) {
        const time =
          parseInt(match[1]) * 60 * 1000 +
          parseInt(match[2]) * 1000 +
          parseFloat("0." + match[3]) * 1000;
        all.push({ time, text: match[4].trim() });
      }
    }

    const lines = [];
    for (let i = 0; i < all.length; i++) {
      const entry = all[i];
      if (!entry.text) continue;
      const nextTime = i + 1 < all.length ? all[i + 1].time : entry.time + 5000;
      const raw = (nextTime - entry.time) / 1000;
      entry.duration = Math.min(raw, entry.text.length / 4);
      lines.push(entry);
    }
    return lines;
  }

  destroy() {
    if (this._session) {
      this._session.abort();
      this._session = null;
    }
  }
}
