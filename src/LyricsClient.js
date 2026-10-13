import Soup from "gi://Soup";
import GLib from "gi://GLib";
import Gio from "gi://Gio";

const decode = (data) => new TextDecoder().decode(data);
const CJK_RE = /[\u3040-\u9FFF\uAC00-\uD7AF]/;

const USER_AGENT = "dynamic-music-pill (https://github.com/Andbal23/dynamic-music-pill)";

function cleanArtist(artist) {
  if (!artist) return "";
  return artist
    .replace(/\s*[-–—]\s*Topic$/i, "")
    .replace(/VEVO$/i, "")
    .replace(/\s+Official$/i, "")
    .trim();
}

const TAG_SUFFIX_RE = /^(?:remaster(?:ed)?|live|official.*|audio|video|music\s*video|lyric.*|visualizer|version|edit|mix|radio\s*edit|acoustic|instrumental|explicit|clean|\d{4}\b.*)/i;

function cleanTitle(title, artist = "") {
  if (!title) return "";
  let t = title
    .replace(/\s*[\(\[\{].*?[\)\]\}]/gi, "")
    .replace(/\s+(?:feat|ft|prod)\.?\s+.*/gi, "")
    .replace(/\s*\|\s*.*/g, "")
    .trim();

  const dashParts = t.split(/\s+[-–—]\s+/);
  if (dashParts.length >= 2) {
    const left = dashParts[0].trim();
    const right = dashParts.slice(1).join(" - ").trim();
    const cArt = cleanArtist(artist).toLowerCase();

    if (TAG_SUFFIX_RE.test(right)) {
      t = left;
    } else if (cArt && (left.toLowerCase() === cArt || cArt.includes(left.toLowerCase()) || left.toLowerCase().includes(cArt))) {
      t = right;
    }
  }
  return t.trim() || title.trim();
}

function extractAltArtistTitle(title, artist = "") {
  if (!title) return null;
  let t = title
    .replace(/\s*[\(\[\{].*?[\)\]\}]/gi, "")
    .replace(/\s+(?:feat|ft|prod)\.?\s+.*/gi, "")
    .replace(/\s*\|\s*.*/g, "")
    .trim();
  const dashParts = t.split(/\s+[-–—]\s+/);
  if (dashParts.length === 2) {
    const left = dashParts[0].trim();
    const right = dashParts[1].trim();
    if (left && right && !TAG_SUFFIX_RE.test(right)) {
      const cArt = cleanArtist(artist).toLowerCase();
      if (!cArt || left.toLowerCase() !== cArt) {
        return { artist: left, title: right };
      }
    }
  }
  return null;
}

function ttmlTimeToMs(val) {
  if (!val) return 0;
  try {
    const parts = String(val).trim().split(":");
    if (parts.length === 1) return Math.round(parseFloat(parts[0]) * 1000);
    if (parts.length === 2) return Math.round((parseInt(parts[0]) * 60 + parseFloat(parts[1])) * 1000);
    if (parts.length === 3) return Math.round((parseInt(parts[0]) * 3600 + parseInt(parts[1]) * 60 + parseFloat(parts[2])) * 1000);
  } catch (_) {}
  return 0;
}

function parseTTML(ttmlText) {
  if (!ttmlText || typeof ttmlText !== "string") return { lines: [], hasWordLevel: false };

  const lines = [];
  let hasWordLevel = false;

  const pRegex = /<p\s+[^>]*begin="([^"]+)"[^>]*>(.*?)<\/p>/gi;
  const spanRegex = /<span\s+[^>]*begin="([^"]+)"[^>]*end="([^"]+)"[^>]*>([^<]+)<\/span>/gi;

  let pMatch;
  while ((pMatch = pRegex.exec(ttmlText)) !== null) {
    const lineStart = ttmlTimeToMs(pMatch[1]);
    let pBody = pMatch[2];

    // Strip background vocal spans so they don't create overlapping active lines
    pBody = pBody.replace(/<span\s+[^>]*ttm:role="x-bg"[^>]*>.*?<\/span>/gi, "");

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

    const lineText = pBody.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    if (lineText) {
      if (words.length > 0) {
        hasWordLevel = true;
        lines.push({ time: lineStart, text: lineText, words, isWordLevel: true });
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
    if (uniqueLines.length > 0 && Math.abs(uniqueLines[uniqueLines.length - 1].time - line.time) < 100) {
      if (!uniqueLines[uniqueLines.length - 1].text.includes(line.text)) {
        uniqueLines[uniqueLines.length - 1].text += " " + line.text;
        if (line.words && line.words.length > 0) {
          uniqueLines[uniqueLines.length - 1].words = (uniqueLines[uniqueLines.length - 1].words || []).concat(line.words);
        }
      }
    } else {
      uniqueLines.push(line);
    }
  }

  for (let i = 0; i < uniqueLines.length; i++) {
    const nextTime = i + 1 < uniqueLines.length ? uniqueLines[i + 1].time : uniqueLines[i].time + 5000;
    const raw = (nextTime - uniqueLines[i].time) / 1000;
    uniqueLines[i].duration = Math.min(raw, Math.max(3.0, uniqueLines[i].text.length / 4));
  }

  return { lines: uniqueLines, hasWordLevel };
}

function parseLyricsInput(input, allowPlain = false) {
  if (!input) return { lines: [], hasWordLevel: false };

  if (typeof input === "string" && (input.includes("<tt") || input.includes("<p begin="))) {
    return parseTTML(input);
  }

  if (typeof input === "object" || (typeof input === "string" && input.trim().startsWith("{"))) {
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
          const time = parseInt(item.startTimeMs || item.time || item.begin || 0);
          const text = (typeof item.text === "string" ? item.text : item.words || item.line || "").trim();
          const subWords = item.syllables || item.wordsArray || item.lead || item.words_list;

          if (Array.isArray(subWords) && subWords.length > 0) {
            hasWordLevel = true;
            const words = subWords.map((w, idx) => {
              const wTime = parseInt(w.startTimeMs || w.time || w.begin || time);
              const nextW = idx + 1 < subWords.length ? subWords[idx + 1] : null;
              const wNextTime = nextW ? parseInt(nextW.startTimeMs || nextW.time || nextW.begin || wTime + 500) : wTime + 500;
              const wDur = Math.max(0.2, (wNextTime - wTime) / 1000);
              return { time: wTime, duration: wDur, text: w.text || w.word || "" };
            });
            lines.push({ time, text, words, isWordLevel: true });
          } else {
            lines.push({ time, text, isWordLevel: false });
          }
        }
        if (lines.length > 0) {
          lines.sort((a, b) => a.time - b.time);
          for (let i = 0; i < lines.length; i++) {
            const nextTime = i + 1 < lines.length ? lines[i + 1].time : lines[i].time + 5000;
            const raw = (nextTime - lines[i].time) / 1000;
            lines[i].duration = Math.min(raw, Math.max(3.0, lines[i].text.length / 4));
          }
          return { lines, hasWordLevel };
        }
      }
    } catch (_) {}
  }

  if (typeof input !== "string") return { lines: [], hasWordLevel: false };

  const lineRegex = /\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)/;
  const wordTagRegex = /[<\(\[](\d{2}):(\d{2})[\.:](\d{2,3})[>\)\]]([^<\(\[\n]*)/g;

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
          const nextWTime = w + 1 < words.length ? words[w + 1].time : words[w].time + 1500;
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

  if (lines.length === 0 && allowPlain) {
    const plainLines = input
      .split("\n")
      .map(l => l.trim())
      .filter(l => l.length > 0 && !l.startsWith("<") && !l.startsWith("{"));
    if (plainLines.length > 0) {
      return {
        lines: plainLines.map((text, idx) => ({
          time: idx * 4000,
          duration: 4.0,
          text,
          isWordLevel: false,
        })),
        hasWordLevel: false,
      };
    }
  }

  return { lines, hasWordLevel };
}

class AppleMusicProvider {
  constructor(session) {
    this.name = "Apple Music";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration) {
    if (!title?.trim()) return null;
    const cArtist = cleanArtist(artist);
    const cleaned = cleanTitle(title, cArtist);
    const alt = extractAltArtistTitle(title, cArtist);
    const queryTitle = alt ? alt.title : (cleaned || title);
    const queryArtist = alt ? alt.artist : cArtist;
    const query = `${queryTitle} ${queryArtist}`.trim();

    // 1. Direct Apple Music TTML search via lrc.red
    try {
      const searchUrl = `https://lrc.red/api/v1?q=${encodeURIComponent(query)}`;
      let msg = Soup.Message.new("GET", searchUrl);
      if (msg) {
        msg.request_headers.append("User-Agent", "BetterLyrics/1.0");
        const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
        if (msg.status_code === Soup.Status.OK) {
          const rawText = decode(bytes.get_data());
          const directParsed = parseLyricsInput(rawText);
          if (directParsed.lines && directParsed.lines.length > 0) {
            return {
              payload: rawText,
              parsed: directParsed,
              provider: this.name,
              isSynced: true,
              hasWordLevel: directParsed.hasWordLevel,
            };
          }
          const json = JSON.parse(rawText);
          const results = json?.results;
          if (Array.isArray(results) && results.length > 0) {
            let bestItem = results.find(r => r.timing_type === "word") || results[0];
            if (bestItem && bestItem.lyricsUrl) {
              let ttmlMsg = Soup.Message.new("GET", bestItem.lyricsUrl);
              if (ttmlMsg) {
                ttmlMsg.request_headers.append("User-Agent", "BetterLyrics/1.0");
                const ttmlBytes = await this._session.send_and_read_async(ttmlMsg, GLib.PRIORITY_DEFAULT, null);
                if (ttmlMsg.status_code === Soup.Status.OK) {
                  const ttmlText = decode(ttmlBytes.get_data());
                  const parsed = parseLyricsInput(ttmlText);
                  if (parsed.lines && parsed.lines.length > 0) {
                    return {
                      payload: ttmlText,
                      parsed,
                      provider: this.name,
                      isSynced: true,
                      hasWordLevel: parsed.hasWordLevel,
                    };
                  }
                }
              }
            }
          }
        }
      }
    } catch (e) {
      console.debug(`[LyricsClient] Apple Music lrc.red error: ${e.message}`);
    }

    // 2. Secondary fallback via boidu
    try {
      let url = `https://lyrics-api.boidu.dev/getLyrics?s=${encodeURIComponent(queryTitle)}&a=${encodeURIComponent(queryArtist)}`;
      if (album) url += `&al=${encodeURIComponent(album)}`;
      if (duration && duration > 0) url += `&d=${Math.round(duration)}`;
      let bMsg = Soup.Message.new("GET", url);
      if (bMsg) {
        bMsg.request_headers.append("User-Agent", "BetterLyrics/1.0");
        const bytes = await this._session.send_and_read_async(bMsg, GLib.PRIORITY_DEFAULT, null);
        if (bMsg.status_code === Soup.Status.OK) {
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
        }
      }
    } catch (e) {
      console.debug(`[LyricsClient] Apple Music boidu error: ${e.message}`);
    }

    return null;
  }
}

class BiniLyricsProvider {
  constructor(session) {
    this.name = "BiniLyrics";
    this._session = session;
  }

  async _tryUrl(url) {
    let msg = Soup.Message.new("GET", url);
    if (!msg) return null;
    msg.request_headers.append("User-Agent", "BetterLyrics/1.0");
    const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
    if (msg.status_code !== Soup.Status.OK) return null;
    const rawText = decode(bytes.get_data());

    const directParsed = parseLyricsInput(rawText);
    if (directParsed.lines && directParsed.lines.length > 0) {
      return {
        payload: rawText,
        parsed: directParsed,
        provider: this.name,
        isSynced: true,
        hasWordLevel: directParsed.hasWordLevel,
      };
    }

    const json = JSON.parse(rawText);
    const results = json?.results;
    if (!Array.isArray(results) || results.length === 0) return null;

    let bestItem = results.find(r => r.timing_type === "word") || results[0];
    if (!bestItem || !bestItem.lyricsUrl) return null;

    let ttmlMsg = Soup.Message.new("GET", bestItem.lyricsUrl);
    if (!ttmlMsg) return null;
    ttmlMsg.request_headers.append("User-Agent", "BetterLyrics/1.0");
    const ttmlBytes = await this._session.send_and_read_async(ttmlMsg, GLib.PRIORITY_DEFAULT, null);
    if (ttmlMsg.status_code !== Soup.Status.OK) return null;
    const ttmlText = decode(ttmlBytes.get_data());

    const parsed = parseLyricsInput(ttmlText);
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
  }

  async fetchLyrics(title, artist, album, duration) {
    if (!title?.trim()) return null;
    const cArtist = cleanArtist(artist);
    const cleaned = cleanTitle(title, cArtist);
    const alt = extractAltArtistTitle(title, cArtist);
    const queryTitle = alt ? alt.title : (cleaned || title);
    const queryArtist = alt ? alt.artist : cArtist;

    try {
      let url1 = `https://lyrics-api.binimum.org/getLyrics?s=${encodeURIComponent(queryTitle)}&a=${encodeURIComponent(queryArtist)}`;
      if (album) url1 += `&al=${encodeURIComponent(album)}`;
      if (duration && duration > 0) url1 += `&d=${Math.round(duration)}`;
      let res1 = await this._tryUrl(url1);
      if (res1) return res1;

      const query = `${queryTitle} ${queryArtist}`.trim();
      let url2 = `https://lyrics-api.binimum.org/getLyrics?q=${encodeURIComponent(query)}`;
      return await this._tryUrl(url2);
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
    const cArtist = cleanArtist(artist);
    const cleaned = cleanTitle(title, cArtist);
    const alt = extractAltArtistTitle(title, cArtist);
    const queryTitle = cleaned || title;

    const tasks = [
      this._fetchCandidates(queryTitle, cArtist, duration),
    ];

    if (duration && duration > 0) {
      const exactUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(queryTitle)}&artist_name=${encodeURIComponent(cArtist)}&album_name=${encodeURIComponent(album || '')}&duration=${Math.round(duration)}`;
      tasks.unshift(this._fetchExact(exactUrl));
    }

    if (alt) {
      tasks.push(this._fetchCandidates(alt.title, alt.artist, duration));
    }

    const taskResults = await Promise.all(tasks);

    let allItems = [];
    for (const r of taskResults) {
      if (!r) continue;
      if (Array.isArray(r)) {
        for (const c of r) {
          if (c && !allItems.some(x => x.id === c.id)) allItems.push(c);
        }
      } else if (r.id && !allItems.some(x => x.id === r.id)) {
        allItems.push(r);
      }
    }

    // Fallback: if searching with artist returned nothing (e.g. YouTube channel name as artist), search by title only
    if (allItems.length === 0 && queryTitle) {
      const titleOnlyCandidates = await this._fetchCandidates(queryTitle, "", duration);
      for (const c of titleOnlyCandidates) {
        if (c && !allItems.some(x => x.id === c.id)) allItems.push(c);
      }
    }

    if (allItems.length === 0) return null;

    let bestSynced = null;
    let bestSyncedScore = -Infinity;

    for (const item of allItems) {
      if (!item.syncedLyrics) continue;
      const durationScore = (duration && duration > 0 && item.duration)
        ? -Math.abs(item.duration - duration)
        : 0;
      const prefScore = this._scoreItem(item, pref) * 1000;
      const total = prefScore + durationScore;
      if (total > bestSyncedScore) {
        bestSyncedScore = total;
        bestSynced = item;
      }
    }

    if (bestSynced) {
      const parsed = parseLyricsInput(bestSynced.syncedLyrics);
      if (parsed.lines && parsed.lines.length > 0) {
        return { payload: bestSynced.syncedLyrics, parsed, isSynced: true, provider: this.name };
      }
    }

    for (const item of allItems) {
      if (item.plainLyrics) {
        const parsed = parseLyricsInput(item.plainLyrics, true);
        if (parsed.lines && parsed.lines.length > 0) {
          return { payload: item.plainLyrics, parsed, isSynced: false, provider: this.name };
        }
      }
    }

    return null;
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
    const parsed = parseLyricsInput(item.syncedLyrics);
    const script = this._detectScript(parsed.lines);
    if (pref === 1) return script === 'original' ? 2 : (script === 'unknown' ? 0 : 1);
    if (pref === 2) return script === 'latin' ? 2 : (script === 'unknown' ? 0 : 1);
    return 0;
  }

  async _fetchExact(url) {
    try {
      let msg = Soup.Message.new("GET", url);
      if (!msg) return null;
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.status_code === Soup.Status.OK) {
        try { return JSON.parse(decode(bytes.get_data())); } catch (_) {}
      }
      return null;
    } catch (_) {
      return null;
    }
  }

  async _fetchCandidates(title, artist, duration) {
    try {
      const query = `${artist || ''} ${title || ''}`.trim();
      if (!query) return [];
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      let msg = Soup.Message.new("GET", url);
      if (!msg) return [];
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.status_code !== Soup.Status.OK) return [];
      const data = JSON.parse(decode(bytes.get_data()));
      if (!Array.isArray(data) || data.length === 0) return [];

      if (duration && duration > 0) {
        const closeMatches = data.filter(item => Math.abs((item.duration || 0) - duration) <= 15);
        if (closeMatches.length > 0) return closeMatches;
      }
      return data;
    } catch (_) {
      return [];
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
    this._session = new Soup.Session({ user_agent: USER_AGENT, timeout: 8 });
    this._providers = [
      new AppleMusicProvider(this._session),
      new BiniLyricsProvider(this._session),
      new LrclibProvider(this._session),
    ];
  }

  async getLyrics(title, artist, album, duration, settings) {
    if (!this._session) return null;
    if (!title?.trim() && !artist?.trim()) return null;
    const pref = settings ? settings.get_int("lyrics-language-preference") : 0;

    // Launch all providers concurrently in parallel
    const promises = this._providers.map(p =>
      p.fetchLyrics(title, artist, album, duration || 0, pref)
        .catch(e => {
          console.debug(`[LyricsClient] Provider ${p.name} failed: ${e.message}`);
          return null;
        })
    );

    const results = await Promise.all(promises);

    const parsedResults = [];
    for (const res of results) {
      if (res && res.parsed && res.parsed.lines && res.parsed.lines.length > 0) {
        parsedResults.push({
          lines: res.parsed.lines,
          hasWordLevel: res.parsed.hasWordLevel,
          provider: res.provider,
          type: res.parsed.hasWordLevel ? 'word-level' : (res.isSynced ? 'synced' : 'plain'),
        });
      }
    }

    // TIER 1 (TOP PRIORITY): word-level (karaoke word-by-word) lyrics
    // Apple Music is prioritized first
    const wordLevelItems = parsedResults.filter(item => item.type === 'word-level');
    if (wordLevelItems.length > 0) {
      const amItem = wordLevelItems.find(item => item.provider === 'Apple Music');
      const chosen = amItem || wordLevelItems[0];
      return {
        lines: chosen.lines,
        provider: chosen.provider,
        type: 'word-level',
        isSynced: true,
      };
    }

    // TIER 2: synced (line-by-line LRC) lyrics
    // Apple Music is prioritized first
    const syncedItems = parsedResults.filter(item => item.type === 'synced');
    if (syncedItems.length > 0) {
      const amItem = syncedItems.find(item => item.provider === 'Apple Music');
      const chosen = amItem || syncedItems[0];
      return {
        lines: chosen.lines,
        provider: chosen.provider,
        type: 'synced',
        isSynced: true,
      };
    }

    // TIER 3: plain text fallback
    for (const item of parsedResults) {
      if (item.type === 'plain') {
        return {
          lines: item.lines,
          provider: item.provider,
          type: 'plain',
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
