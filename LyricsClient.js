import Soup from "gi://Soup";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const decode = (data) => new TextDecoder().decode(data);

export class LyricsClient {
  constructor() {
    Gio._promisify(
      Soup.Session.prototype,
      "send_and_read_async",
      "send_and_read_finish",
    );
    this._session = new Soup.Session();
  }

  async getLyrics(title, artist, album, duration) {
    if (!this._session) return null;
    try {
      const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(title)}&artist_name=${encodeURIComponent(artist)}&album_name=${encodeURIComponent(album)}&duration=${duration}`;
      const msg = Soup.Message.new("GET", url);
      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );

      if (msg.status_code !== Soup.Status.OK)
        return await this._searchLyrics(title, artist, duration);

      const data = JSON.parse(decode(bytes.get_data()));
      return data.syncedLyrics ? this._parseLRC(data.syncedLyrics) : null;
    } catch (e) {
      console.debug(`[Dynamic Music Pill] Lyrics fetch error: ${e.message}`);
      return null;
    }
  }

  async _searchLyrics(title, artist, duration) {
    if (!this._session) return null;
    try {
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(title + " " + artist)}`;
      const msg = Soup.Message.new("GET", url);
      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      const data = JSON.parse(decode(bytes.get_data()));
      const match = data.find((item) => Math.abs(item.duration - duration) < 3);
      return match?.syncedLyrics ? this._parseLRC(match.syncedLyrics) : null;
    } catch (e) {
      console.debug(`[Dynamic Music Pill] Lyrics search fallback error: ${e.message}`);
      return null;
    }
  }

  _parseLRC(lrcText) {
    const lines = [];
    const regex = /\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)/;
    lrcText.split("\n").forEach((line) => {
      const match = line.match(regex);
      if (match) {
        const time =
          parseInt(match[1]) * 60 * 1000 +
          parseInt(match[2]) * 1000 +
          parseFloat("0." + match[3]) * 1000;
        if (match[4].trim()) lines.push({ time, text: match[4].trim() });
      }
    });
    return lines;
  }

  destroy() {
    if (this._session) {
      this._session.abort();
      this._session = null;
    }
  }
}
