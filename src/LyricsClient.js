import Soup from "gi://Soup";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const decode = (data) => new TextDecoder().decode(data);
const CJK_RE = /[\u3040-\u9FFF\uAC00-\uD7AF]/;

const USER_AGENT =
  "dynamic-music-pill (https://github.com/Andbal23/dynamic-music-pill)";

function cleanTitle(title, artist) {
  if (!title) return "";
  let t = title;

  // YouTube/browser titles often come as "Artist - Song Title". If the part
  // before the hyphen matches the known artist, the REAL title is the part
  // after the hyphen, not before. Without this, the old blind
  const hyphenMatch = t.match(/^(.*?)\s+-+\s+(.*)$/);
  if (hyphenMatch && artist) {
    const before = hyphenMatch[1].trim().toLowerCase();
    const artistLower = artist.trim().toLowerCase();
    if (
      before &&
      artistLower &&
      (before === artistLower ||
        before.includes(artistLower) ||
        artistLower.includes(before))
    ) {
      t = hyphenMatch[2];
    }
  }

  return t
    .replace(/\s*[\(\[\{].*?[\)\]\}]/gi, "")
    .replace(/\s+feat\..*/gi, "")
    .replace(/\s+ft\..*/gi, "")
    .replace(/\s+-+.*/gi, "")
    .trim();
}

function ttmlTimeToMs(val) {
  if (!val) return 0;
  try {
    const parts = String(val).trim().split(":");
    if (parts.length === 1) return Math.round(parseFloat(parts[0]) * 1000);
    if (parts.length === 2)
      return Math.round(
        (parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000,
      );
    if (parts.length === 3)
      return Math.round(
        (parseInt(parts[0]) * 3600 +
          parseInt(parts[1]) * 60 +
          parseFloat(parts[2])) *
          1000,
      );
  } catch (_) {}
  return 0;
}

function parseTTML(ttmlText) {
  if (!ttmlText || typeof ttmlText !== "string")
    return { lines: [], hasWordLevel: false };

  const lines = [];
  let hasWordLevel = false;

  const pRegex = /<p\s+[^>]*begin="([^"]+)"[^>]*>([\s\S]*?)<\/p>/gi;
  const spanRegex =
    /<span\s+[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([^<]+)<\/span>/gi;

  let pMatch;
  while ((pMatch = pRegex.exec(ttmlText)) !== null) {
    const lineStart = ttmlTimeToMs(pMatch[1]);
    let pBody = pMatch[2];

    // Strip background vocal spans so they don't create overlapping active lines
    pBody = pBody.replace(
      /<span\s+[^>]*ttm:role="x-bg"[^>]*>[\s\S]*?<\/span>/gi,
      "",
    );

    const words = [];
    let spanMatch;
    spanRegex.lastIndex = 0;
    while ((spanMatch = spanRegex.exec(pBody)) !== null) {
      const wStart = ttmlTimeToMs(spanMatch[1]);
      const wEnd = ttmlTimeToMs(spanMatch[2]);
      const wText = spanMatch[3].trim();
      if (wText) {
        const wDur = Math.max(0.1, (wEnd - wStart) / 1000);
        words.push({ time: wStart, duration: wDur, text: wText });
      }
    }

    const lineText = pBody
      .replace(/<[^>]+>/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (lineText) {
      if (words.length > 0) {
        hasWordLevel = true;
        lines.push({
          time: lineStart,
          text: lineText,
          words,
          isWordLevel: true,
        });
      } else {
        lines.push({ time: lineStart, text: lineText, isWordLevel: false });
      }
    }
  }

  // Sort lines by timestamp
  lines.sort((a, b) => a.time - b.time);

  // Merge lines with identical or near-identical timestamps
  const uniqueLines = [];
  for (const line of lines) {
    if (
      uniqueLines.length > 0 &&
      Math.abs(uniqueLines[uniqueLines.length - 1].time - line.time) < 100
    ) {
      if (!uniqueLines[uniqueLines.length - 1].text.includes(line.text)) {
        uniqueLines[uniqueLines.length - 1].text += " " + line.text;
        if (line.words && line.words.length > 0) {
          uniqueLines[uniqueLines.length - 1].words = (
            uniqueLines[uniqueLines.length - 1].words || []
          ).concat(line.words);
        }
      }
    } else {
      uniqueLines.push(line);
    }
  }

  for (let i = 0; i < uniqueLines.length; i++) {
    const nextTime =
      i + 1 < uniqueLines.length
        ? uniqueLines[i + 1].time
        : uniqueLines[i].time + 5000;
    const raw = (nextTime - uniqueLines[i].time) / 1000;
    uniqueLines[i].duration = Math.min(
      raw,
      Math.max(3.0, uniqueLines[i].text.length / 4),
    );
  }

  return { lines: uniqueLines, hasWordLevel };
}

function parseLyricsInput(input) {
  if (!input) return { lines: [], hasWordLevel: false };

  if (
    typeof input === "string" &&
    (input.includes("<tt") || input.includes("<p begin="))
  ) {
    return parseTTML(input);
  }

  if (
    typeof input === "object" ||
    (typeof input === "string" && input.trim().startsWith("{"))
  ) {
    try {
      const obj = typeof input === "object" ? input : JSON.parse(input);

      if (obj && typeof obj.ttml === "string") {
        return parseTTML(obj.ttml);
      }

      const list = obj.lines || obj.lyrics || obj.data || obj.result;
      if (Array.isArray(list) && list.length > 0) {
        const lines = [];
        let hasWordLevel = false;
        for (const item of list) {
          const time = parseInt(
            item.startTimeMs || item.time || item.begin || 0,
          );
          const text = (
            typeof item.text === "string"
              ? item.text
              : item.words || item.line || ""
          ).trim();
          const subWords =
            item.syllables || item.wordsArray || item.lead || item.words_list;

          if (Array.isArray(subWords) && subWords.length > 0) {
            hasWordLevel = true;
            const words = subWords.map((w, idx) => {
              const wTime = parseInt(
                w.startTimeMs || w.time || w.begin || time,
              );
              const nextW =
                idx + 1 < subWords.length ? subWords[idx + 1] : null;
              const wNextTime = nextW
                ? parseInt(
                    nextW.startTimeMs ||
                      nextW.time ||
                      nextW.begin ||
                      wTime + 500,
                  )
                : wTime + 500;
              const wDur = Math.max(0.2, (wNextTime - wTime) / 1000);
              return {
                time: wTime,
                duration: wDur,
                text: w.text || w.word || "",
              };
            });
            lines.push({ time, text, words, isWordLevel: true });
          } else {
            lines.push({ time, text, isWordLevel: false });
          }
        }
        if (lines.length > 0) {
          lines.sort((a, b) => a.time - b.time);
          for (let i = 0; i < lines.length; i++) {
            const nextTime =
              i + 1 < lines.length ? lines[i + 1].time : lines[i].time + 5000;
            const raw = (nextTime - lines[i].time) / 1000;
            lines[i].duration = Math.min(
              raw,
              Math.max(3.0, lines[i].text.length / 4),
            );
          }
          return { lines, hasWordLevel };
        }
      }
    } catch (_) {}
  }

  if (typeof input !== "string") return { lines: [], hasWordLevel: false };

  const lineRegex = /\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)/;
  const wordTagRegex =
    /[<\(\[](\d{2}):(\d{2})[\.:](\d{2,3})[>\)\]]([^<\(\[\n]*)/g;

  const all = [];
  let hasWordLevel = false;

  for (const rawLine of input.split("\n")) {
    const match = rawLine.match(lineRegex);
    if (match) {
      const lineTime =
        parseInt(match[1]) * 60 * 1000 +
        parseInt(match[2]) * 1000 +
        parseFloat("0." + match[3]) * 1000;
      let lineBody = match[4].trim();

      const words = [];
      let wordMatch;
      while ((wordMatch = wordTagRegex.exec(lineBody)) !== null) {
        const wTime =
          parseInt(wordMatch[1]) * 60 * 1000 +
          parseInt(wordMatch[2]) * 1000 +
          parseFloat("0." + wordMatch[3]) * 1000;
        const wText = wordMatch[4];
        words.push({ time: wTime, text: wText });
      }

      if (words.length > 0) {
        hasWordLevel = true;
        const cleanText = lineBody.replace(/[<\(\[].*?[>\)\]]/g, "").trim();
        for (let w = 0; w < words.length; w++) {
          const nextWTime =
            w + 1 < words.length ? words[w + 1].time : words[w].time + 1500;
          words[w].duration = (nextWTime - words[w].time) / 1000;
        }
        all.push({ time: lineTime, text: cleanText, words, isWordLevel: true });
      } else {
        all.push({ time: lineTime, text: lineBody, isWordLevel: false });
      }
    }
  }

  const lines = [];
  for (let i = 0; i < all.length; i++) {
    const entry = all[i];
    if (!entry.text) continue;
    const nextTime = i + 1 < all.length ? all[i + 1].time : entry.time + 5000;
    const raw = (nextTime - entry.time) / 1000;
    const calculated = Math.max(3.0, entry.text.length / 4);
    entry.duration = Math.min(raw, calculated);
    lines.push(entry);
  }
  lines.sort((a, b) => a.time - b.time);
  return { lines, hasWordLevel };
}

class BetterLyricsProvider {
  constructor(session) {
    this.name = "BetterLyrics";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration) {
    if (!title?.trim()) return null;
    const cleaned = cleanTitle(title, artist);
    const queryTitle = cleaned || title;
    const queryArtist = artist || "";

    const url = `https://lyrics-api.boidu.dev/getLyrics?s=${encodeURIComponent(queryTitle)}&a=${encodeURIComponent(queryArtist)}&d=${Math.round(duration || 0)}`;
    try {
      let msg = Soup.Message.new("GET", url);
      if (!msg) return null;
      msg.request_headers.append("User-Agent", "BetterLyrics/1.0");
      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (msg.status_code !== Soup.Status.OK) return null;
      const text = decode(bytes.get_data());

      const parsed = parseLyricsInput(text);
      if (parsed.lines && parsed.lines.length > 0) {
        return {
          payload: text,
          parsed,
          provider: this.name,
          isSynced: true,
          hasWordLevel: parsed.hasWordLevel,
        };
      }
      return null;
    } catch (_) {
      return null;
    }
  }
}

class BiniLyricsProvider {
  constructor(session) {
    this.name = "BiniLyrics";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration) {
    if (!title?.trim()) return null;
    const cleaned = cleanTitle(title, artist);
    const query = `${cleaned || title} ${artist || ""}`.trim();
    const searchUrl = `https://lyrics-api.binimum.org/getLyrics?q=${encodeURIComponent(query)}`;

    try {
      let msg = Soup.Message.new("GET", searchUrl);
      if (!msg) return null;
      msg.request_headers.append("User-Agent", "BetterLyrics/1.0");
      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (msg.status_code !== Soup.Status.OK) return null;
      const json = JSON.parse(decode(bytes.get_data()));

      const results = json?.results;
      if (!Array.isArray(results) || results.length === 0) return null;

      let bestItem =
        results.find((r) => r.timing_type === "word") || results[0];
      if (!bestItem || !bestItem.lyricsUrl) return null;

      let ttmlMsg = Soup.Message.new("GET", bestItem.lyricsUrl);
      if (!ttmlMsg) return null;
      ttmlMsg.request_headers.append("User-Agent", "BetterLyrics/1.0");
      const ttmlBytes = await this._session.send_and_read_async(
        ttmlMsg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (ttmlMsg.status_code !== Soup.Status.OK) return null;
      const ttmlText = decode(ttmlBytes.get_data());

      const parsed = parseTTML(ttmlText);
      if (parsed.lines && parsed.lines.length > 0) {
        return {
          payload: ttmlText,
          parsed,
          provider: this.name,
          isSynced: true,
          hasWordLevel: parsed.hasWordLevel,
        };
      }
      return null;
    } catch (e) {
      console.debug(`[LyricsClient] BiniLyrics error: ${e.message}`);
      return null;
    }
  }
}

class LrclibProvider {
  constructor(session) {
    this.name = "LRCLib";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration, pref) {
    if (!title?.trim() && !artist?.trim()) return null;
    const cleaned = cleanTitle(title, artist);
    const queryTitle = cleaned || title;

    const exactUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(queryTitle)}&artist_name=${encodeURIComponent(artist || "")}&album_name=${encodeURIComponent(album || "")}&duration=${duration}`;

    const [exactItem, candidates] = await Promise.all([
      this._fetchExact(exactUrl),
      this._fetchCandidates(queryTitle, artist, duration),
    ]);

    let allItems = [];
    if (exactItem) allItems.push(exactItem);
    if (Array.isArray(candidates)) {
      for (const c of candidates) {
        if (!allItems.some((x) => x.id === c.id)) allItems.push(c);
      }
    }

    if (allItems.length === 0) return null;

    let bestSynced = null;
    let bestSyncedScore = -Infinity;

    for (const item of allItems) {
      if (!item.syncedLyrics) continue;
      const durationScore = -Math.abs((item.duration || 0) - duration);
      const prefScore = this._scoreItem(item, pref) * 1000;
      const total = prefScore + durationScore;
      if (total > bestSyncedScore) {
        bestSyncedScore = total;
        bestSynced = item;
      }
    }

    if (bestSynced) {
      const parsed = parseLyricsInput(bestSynced.syncedLyrics);
      return {
        payload: bestSynced.syncedLyrics,
        parsed,
        isSynced: true,
        provider: this.name,
      };
    }

    for (const item of allItems) {
      if (item.plainLyrics) {
        const parsed = parseLyricsInput(item.plainLyrics);
        return {
          payload: item.plainLyrics,
          parsed,
          isSynced: false,
          provider: this.name,
        };
      }
    }

    return null;
  }

  _detectScript(lines) {
    if (!lines || lines.length === 0) return "unknown";
    const sample = lines
      .slice(0, Math.min(15, lines.length))
      .map((l) => l.text)
      .join(" ");
    const cjkCount = (sample.match(new RegExp(CJK_RE.source, "g")) || [])
      .length;
    const latinCount = (sample.match(/[a-zA-Z]/g) || []).length;
    const totalChars = sample.replace(/\s/g, "").length;
    if (totalChars === 0) return "unknown";

    const cjkRatio = cjkCount / totalChars;
    const latinRatio = latinCount / totalChars;
    if (cjkRatio > 0.15) return "original";
    if (latinRatio > 0.4) return "latin";
    return "unknown";
  }

  _scoreItem(item, pref) {
    if (!item.syncedLyrics) return -1;
    if (pref === 0) return 0;
    const parsed = parseLyricsInput(item.syncedLyrics);
    const script = this._detectScript(parsed.lines);
    if (pref === 1)
      return script === "original" ? 2 : script === "unknown" ? 0 : 1;
    if (pref === 2)
      return script === "latin" ? 2 : script === "unknown" ? 0 : 1;
    return 0;
  }

  async _fetchExact(url) {
    try {
      let msg = Soup.Message.new("GET", url);
      if (!msg) return null;
      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (msg.status_code === Soup.Status.OK) {
        try {
          return JSON.parse(decode(bytes.get_data()));
        } catch (_) {}
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  async _fetchCandidates(title, artist, duration) {
    try {
      const query = `${artist || ""} ${title || ""}`.trim();
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      let msg = Soup.Message.new("GET", url);
      if (!msg) return [];
      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (msg.status_code !== Soup.Status.OK) return [];
      const data = JSON.parse(decode(bytes.get_data()));
      return Array.isArray(data)
        ? data.filter((item) => Math.abs((item.duration || 0) - duration) < 5)
        : [];
    } catch (_) {
      return [];
    }
  }
}

class NeteaseProvider {
  constructor(session) {
    this.name = "NetEase";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration) {
    if (!title?.trim()) return null;
    const cleaned = cleanTitle(title, artist);
    const query = `${artist || ""} ${cleaned || title}`.trim();

    try {
      const searchUrl = `https://music.163.com/api/search/get/web?s=${encodeURIComponent(query)}&type=1&offset=0&total=true&limit=5`;
      let msg = Soup.Message.new("GET", searchUrl);
      if (!msg) return null;
      msg.request_headers.append("User-Agent", USER_AGENT);
      msg.request_headers.append("Referer", "https://music.163.com");

      const bytes = await this._session.send_and_read_async(
        msg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (msg.status_code !== Soup.Status.OK) return null;
      const data = JSON.parse(decode(bytes.get_data()));

      const songs = data?.result?.songs;
      if (!Array.isArray(songs) || songs.length === 0) return null;

      let bestSong = songs[0];
      if (duration && duration > 0) {
        let bestDiff = Infinity;
        for (const song of songs) {
          const songDurSec = (song.duration || 0) / 1000;
          const diff = Math.abs(songDurSec - duration);
          if (diff < bestDiff) {
            bestDiff = diff;
            bestSong = song;
          }
        }
        if (bestDiff > 10) return null;
      }

      const lyricUrl = `https://music.163.com/api/song/lyric?os=pc&id=${bestSong.id}&lv=-1&kv=-1&tv=-1`;
      let lyricMsg = Soup.Message.new("GET", lyricUrl);
      if (!lyricMsg) return null;
      lyricMsg.request_headers.append("User-Agent", USER_AGENT);
      lyricMsg.request_headers.append("Referer", "https://music.163.com");

      const lyricBytes = await this._session.send_and_read_async(
        lyricMsg,
        GLib.PRIORITY_DEFAULT,
        null,
      );
      if (lyricMsg.status_code !== Soup.Status.OK) return null;
      const lyricData = JSON.parse(decode(lyricBytes.get_data()));

      const kLrcString = lyricData?.klyric?.lyric;
      const lrcString = lyricData?.lrc?.lyric;

      if (kLrcString && kLrcString.includes("[")) {
        const parsed = parseLyricsInput(kLrcString);
        return {
          payload: kLrcString,
          parsed,
          isSynced: true,
          provider: this.name,
        };
      } else if (lrcString && lrcString.includes("[")) {
        const parsed = parseLyricsInput(lrcString);
        return {
          payload: lrcString,
          parsed,
          isSynced: true,
          provider: this.name,
        };
      } else if (lrcString && lrcString.trim()) {
        const parsed = parseLyricsInput(lrcString);
        return {
          payload: lrcString,
          parsed,
          isSynced: false,
          provider: this.name,
        };
      }
      return null;
    } catch (e) {
      console.debug(`[LyricsClient] NetEase fetch error: ${e.message}`);
      return null;
    }
  }
}

export class LyricsClient {
  constructor() {
    Gio._promisify(
      Soup.Session.prototype,
      "send_and_read_async",
      "send_and_read_finish",
    );
    this._session = new Soup.Session({ user_agent: USER_AGENT });
    this._providers = [
      new BetterLyricsProvider(this._session),
      new BiniLyricsProvider(this._session),
      new LrclibProvider(this._session),
      new NeteaseProvider(this._session),
    ];
  }

  async getLyrics(title, artist, album, duration, settings) {
    if (!this._session) return null;
    if (!title?.trim() && !artist?.trim()) return null;
    if (!duration || duration <= 0) return null;
    const pref = settings ? settings.get_int("lyrics-language-preference") : 0;

    // Launch all providers concurrently in parallel
    const promises = this._providers.map((p) =>
      p.fetchLyrics(title, artist, album, duration, pref).catch((e) => {
        console.debug(`[LyricsClient] Provider ${p.name} failed: ${e.message}`);
        return null;
      }),
    );

    const results = await Promise.all(promises);

    const parsedResults = [];
    for (const res of results) {
      if (
        res &&
        res.parsed &&
        res.parsed.lines &&
        res.parsed.lines.length > 0
      ) {
        parsedResults.push({
          lines: res.parsed.lines,
          hasWordLevel: res.parsed.hasWordLevel,
          provider: res.provider,
          type: res.parsed.hasWordLevel
            ? "word-level"
            : res.isSynced
              ? "synced"
              : "plain",
        });
      }
    }

    // TIER 1 (TOP PRIORITY): word-level (karaoke word-by-word) lyrics
    for (const item of parsedResults) {
      if (item.type === "word-level") {
        return {
          lines: item.lines,
          provider: item.provider,
          type: "word-level",
          isSynced: true,
        };
      }
    }

    // TIER 2: synced (line-by-line LRC) lyrics
    for (const item of parsedResults) {
      if (item.type === "synced") {
        return {
          lines: item.lines,
          provider: item.provider,
          type: "synced",
          isSynced: true,
        };
      }
    }

    // TIER 3: plain text fallback
    for (const item of parsedResults) {
      if (item.type === "plain") {
        return {
          lines: item.lines,
          provider: item.provider,
          type: "plain",
          isSynced: false,
        };
      }
    }

    return null;
  }

  _parseLRC(lrcText) {
    return parseLyricsInput(lrcText).lines;
  }

  destroy() {
    if (this._session) {
      this._session.abort();
      this._session = null;
    }
  }
}
