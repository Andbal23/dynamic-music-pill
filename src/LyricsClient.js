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
  const parts = String(val).trim().split(":");
  let ms = 0;
  if (parts.length === 1) ms = Math.round(parseFloat(parts[0]) * 1000);
  else if (parts.length === 2) ms = Math.round((parseInt(parts[0], 10) * 60 + parseFloat(parts[1])) * 1000);
  else if (parts.length === 3) ms = Math.round((parseInt(parts[0], 10) * 3600 + parseInt(parts[1], 10) * 60 + parseFloat(parts[2])) * 1000);
  return isNaN(ms) ? 0 : ms;
}

function unescapeXml(str) {
  if (!str) return "";
  return String(str)
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
}

function normalizeCompare(str) {
  if (!str) return "";
  return String(str)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

const VERSION_QUALIFIER_PATTERNS = [
  ["remix", /\bremix\b/i],
  ["live", /\blive\b/i],
  ["acoustic", /\bacoustic\b/i],
  ["instrumental", /\binstrumental\b/i],
  ["spedup", /\bsped\s*up\b|\bnightcore\b/i],
  ["slowed", /\bslowed\b/i],
  ["demo", /\bdemo\b/i],
  ["karaoke", /\bkaraoke\b/i],
  ["vip", /\bvip\b/i],
];

function extractQualifiers(str) {
  if (!str) return new Set();
  const out = new Set();
  for (const [name, re] of VERSION_QUALIFIER_PATTERNS) {
    if (re.test(str)) out.add(name);
  }
  return out;
}

function scoreQualifierCompatibility(rawTitle, rawAlbum, candTitle, candAlbum) {
  const want = extractQualifiers(`${rawTitle || ""} ${rawAlbum || ""}`);
  const got = extractQualifiers(`${candTitle || ""} ${candAlbum || ""}`);
  let score = 0;
  for (const q of want) {
    score += got.has(q) ? 25 : -25;
  }
  for (const q of got) {
    if (!want.has(q)) score -= 25;
  }
  return score;
}

function ensureWordDurationFloor(lines) {
  if (!Array.isArray(lines)) return;
  for (const line of lines) {
    if (Array.isArray(line.words) && line.words.length > 0) {
      const lastW = line.words[line.words.length - 1];
      const spanSec = (lastW.time + (lastW.duration || 0.2) * 1000 - line.time) / 1000;
      if (spanSec > (line.duration || 0)) {
        line.duration = spanSec;
      }
    }
  }
}

function parsedMatchesDuration(parsed, durationSec) {
  if (!durationSec || durationSec <= 0) return true;
  if (!parsed || !Array.isArray(parsed.lines) || parsed.lines.length === 0) return false;
  const lastLine = parsed.lines[parsed.lines.length - 1];
  return (lastLine.time / 1000) <= durationSec + 15;
}

function finalizeWordSpacing(rawItems, fullLineText = "") {
  if (!Array.isArray(rawItems) || rawItems.length === 0) return [];

  const anyExplicitSpace = rawItems.some(w => typeof w.rawText === "string" && /\s/.test(w.rawText));
  const anyPartFlag = rawItems.some(w => typeof w.part === "boolean");

  const words = [];
  if (anyExplicitSpace) {
    for (const item of rawItems) {
      const raw = String(item.rawText ?? "");
      if (/^\s/.test(raw) && words.length > 0) {
        words[words.length - 1].hasSpace = true;
      }
      const trimmed = raw.trim();
      if (!trimmed) continue;
      words.push({
        time: item.time,
        duration: item.duration,
        text: trimmed,
        hasSpace: /\s$/.test(raw),
      });
    }
  } else if (anyPartFlag) {
    for (const item of rawItems) {
      const trimmed = String(item.rawText ?? "").trim();
      if (!trimmed) continue;
      words.push({
        time: item.time,
        duration: item.duration,
        text: trimmed,
        hasSpace: item.part === false,
      });
    }
  } else {
    for (const item of rawItems) {
      const trimmed = String(item.rawText ?? "").trim();
      if (!trimmed) continue;
      words.push({
        time: item.time,
        duration: item.duration,
        text: trimmed,
        hasSpace: false,
      });
    }
    if (fullLineText && words.length > 0) {
      let cursor = 0;
      let alignedAll = true;
      const inferred = new Array(words.length).fill(false);
      for (let i = 0; i < words.length; i++) {
        while (cursor < fullLineText.length && /\s/.test(fullLineText[cursor])) cursor++;
        const idx = fullLineText.indexOf(words[i].text, cursor);
        if (idx === -1) {
          alignedAll = false;
          break;
        }
        cursor = idx + words[i].text.length;
        if (i + 1 < words.length && cursor < fullLineText.length && /\s/.test(fullLineText[cursor])) {
          inferred[i] = true;
        }
      }
      if (alignedAll) {
        for (let i = 0; i < words.length; i++) words[i].hasSpace = inferred[i];
      } else {
        for (let i = 0; i < words.length - 1; i++) {
          words[i].hasSpace = !CJK_RE.test(words[i].text);
        }
      }
    } else {
      for (let i = 0; i < words.length - 1; i++) {
        words[i].hasSpace = !CJK_RE.test(words[i].text);
      }
    }
  }

  if (words.length > 0) {
    words[words.length - 1].hasSpace = false;
  }
  return words;
}

function parseWordsFromTTML(pBody, _isLineBg = false) {
  const tokens = [];
  const tokenRegex = /(<[^>]+>)|([^<]+)/g;
  let match;
  while ((match = tokenRegex.exec(pBody)) !== null) {
    if (match[1]) tokens.push({ type: "tag", val: match[1] });
    else if (match[2]) tokens.push({ type: "text", val: match[2] });
  }

  const words = [];
  const tagStack = [];
  let pendingPrefix = "";

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t.type === "tag") {
      if (t.val.startsWith("</")) {
        tagStack.pop();
      } else if (!t.val.endsWith("/>") && !t.val.startsWith("<?") && !t.val.startsWith("<!")) {
        const parent = tagStack.length > 0 ? tagStack[tagStack.length - 1] : null;
        const beginMatch = t.val.match(/begin="([^"]+)"/i);
        const endMatch = t.val.match(/end="([^"]+)"/i);
        const roleMatch = t.val.match(/ttm:role="([^"]+)"/i);

        tagStack.push({
          begin: beginMatch ? beginMatch[1] : (parent ? parent.begin : null),
          end: endMatch ? endMatch[1] : (parent ? parent.end : null),
          role: roleMatch ? roleMatch[1].toLowerCase() : (parent ? parent.role : null),
        });
      }
    } else if (t.type === "text") {
      const ignored = tagStack.some(s => s.role === "x-translation" || s.role === "x-roman");
      if (ignored) continue;

      const rawVal = unescapeXml(t.val);
      if (/^\s/.test(rawVal) && words.length > 0) {
        words[words.length - 1].hasSpace = true;
      }

      const trimmed = rawVal.trim();
      if (!trimmed) {
        if (rawVal.length > 0 && words.length > 0) {
          words[words.length - 1].hasSpace = true;
        }
        continue;
      }

      const currentTag = tagStack.length > 0 ? tagStack[tagStack.length - 1] : null;
      if (currentTag && currentTag.begin) {
        const wStart = ttmlTimeToMs(currentTag.begin);
        const wEnd = currentTag.end ? ttmlTimeToMs(currentTag.end) : (wStart + 300);
        const combinedText = pendingPrefix + trimmed;
        pendingPrefix = "";

        words.push({
          time: wStart,
          duration: Math.max(0.1, (wEnd - wStart) / 1000),
          text: combinedText,
          hasSpace: /\s$/.test(rawVal),
        });
      } else if (/^[)\]}\.,!?;:'"]+$/.test(trimmed) && words.length > 0 && !words[words.length - 1].hasSpace) {
        words[words.length - 1].text += trimmed;
        if (/\s$/.test(rawVal)) {
          words[words.length - 1].hasSpace = true;
        }
      } else {
        pendingPrefix += trimmed + (/\s$/.test(rawVal) ? " " : "");
      }
    }
  }

  if (pendingPrefix && words.length > 0) {
    words[words.length - 1].text += (words[words.length - 1].hasSpace ? " " : "") + pendingPrefix.trim();
  }
  if (words.length > 0) {
    words[words.length - 1].hasSpace = false;
  }

  return words;
}

function parseTTML(ttmlText) {
  if (!ttmlText || typeof ttmlText !== "string") return { lines: [], hasWordLevel: false };

  const lines = [];
  let hasWordLevel = false;

  const pRegex = /<p(?:\s+([^>]*))?>(.*?)<\/p>/gis;

  let pMatch;
  while ((pMatch = pRegex.exec(ttmlText)) !== null) {
    const pAttrs = pMatch[1] || "";
    const pBody = pMatch[2];
    const beginMatch = pAttrs.match(/begin="([^"]+)"/i);
    const endMatch = pAttrs.match(/end="([^"]+)"/i);
    const isLineBg = /ttm:role="x-bg"/i.test(pAttrs);

    const words = parseWordsFromTTML(pBody, isLineBg);
    if (!beginMatch && words.length === 0) continue;

    const lineStart = beginMatch ? ttmlTimeToMs(beginMatch[1]) : words[0].time;
    let lineEnd = endMatch ? ttmlTimeToMs(endMatch[1]) : 0;
    if (!lineEnd && words.length > 0) {
      const lastW = words[words.length - 1];
      lineEnd = lastW.time + Math.round(lastW.duration * 1000);
    }

    let lineText = "";
    if (words.length > 0) {
      for (const w of words) {
        lineText += w.text + (w.hasSpace ? " " : "");
      }
      lineText = lineText.trim();
    } else {
      const stripped = pBody
        .replace(/<span\s+[^>]*ttm:role="x-(?:translation|roman)"[^>]*>.*?<\/span>/gis, "")
        .replace(/<[^>]+>/g, "");
      lineText = unescapeXml(stripped).replace(/\s+/g, " ").trim();
    }

    if (lineText) {
      const lineDuration = lineEnd > lineStart ? (lineEnd - lineStart) / 1000 : 0;
      if (words.length > 0) {
        hasWordLevel = true;
        lines.push({ time: lineStart, text: lineText, words, isWordLevel: true, duration: lineDuration });
      } else {
        lines.push({ time: lineStart, text: lineText, isWordLevel: false, duration: lineDuration });
      }
    }
  }

  // Sort lines by timestamp
  lines.sort((a, b) => a.time - b.time);

  // Deduplicate exact duplicate lines and merge near-simultaneous duet lines (<150ms)
  // so the first singer's line isn't skipped within a single 200ms tick.
  const uniqueLines = [];
  for (const line of lines) {
    if (uniqueLines.length > 0) {
      const prev = uniqueLines[uniqueLines.length - 1];
      if (prev.text === line.text && Math.abs(prev.time - line.time) < 500) {
        continue;
      }
      if (Math.abs(line.time - prev.time) < 150) {
        if (!prev.text.includes(line.text)) {
          prev.text = `${prev.text} / ${line.text}`;
          const prevEndMs = prev.time + (prev.duration || 0) * 1000;
          const lineEndMs = line.time + (line.duration || 0) * 1000;
          const maxEndMs = Math.max(prevEndMs, lineEndMs);
          if (maxEndMs > prev.time) {
            prev.duration = (maxEndMs - prev.time) / 1000;
          }
          if (prev.words && line.words && prev.words.length > 0 && line.words.length > 0) {
            prev.words[prev.words.length - 1].hasSpace = true;
            prev.words.push({ time: line.time, duration: 0.1, text: "/", hasSpace: true });
            prev.words = prev.words.concat(line.words);
            prev.words[prev.words.length - 1].hasSpace = false;
          } else {
            delete prev.words;
            prev.isWordLevel = false;
          }
        }
        continue;
      }
    }
    uniqueLines.push(line);
  }

  for (let i = 0; i < uniqueLines.length; i++) {
    if (!uniqueLines[i].duration || uniqueLines[i].duration <= 0) {
      const nextTime = i + 1 < uniqueLines.length ? uniqueLines[i + 1].time : uniqueLines[i].time + 5000;
      const raw = Math.max(0.5, (nextTime - uniqueLines[i].time) / 1000);
      uniqueLines[i].duration = Math.min(raw, Math.max(3.0, uniqueLines[i].text.length / 4));
    }
  }
  ensureWordDurationFloor(uniqueLines);

  return { lines: uniqueLines, hasWordLevel };
}

function parseYamlScalar(raw) {
  if (raw === undefined || raw === null) return "";
  const s = String(raw).trim();
  if (!s || s === "null" || s === "~") return "";
  if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
    const inner = s.slice(1, -1);
    return inner.replace(/\\(u[0-9a-fA-F]{4}|["\\/bfnrt])/g, (_, esc) => {
      if (esc.startsWith("u")) return String.fromCodePoint(parseInt(esc.slice(1), 16));
      switch (esc) {
        case '"': return '"';
        case "\\": return "\\";
        case "/": return "/";
        case "b": return "\b";
        case "f": return "\f";
        case "n": return "\n";
        case "r": return "\r";
        case "t": return "\t";
        default: return esc;
      }
    });
  }
  if (s.length >= 2 && s.startsWith("'") && s.endsWith("'")) {
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s.replace(/\s+#.*$/, "");
}

function parseLyricsfile(yamlStr) {
  if (!yamlStr || typeof yamlStr !== "string") return { lines: [], hasWordLevel: false };

  let section = "root";
  let offsetMs = 0;
  const rawLines = [];
  let currentLine = null;
  let lineItemIndent = -1;
  let inWords = false;
  let wordsKeyIndent = -1;
  let currentWord = null;

  const assignProp = (target, key, valStr) => {
    if (key === "text") {
      target.text = parseYamlScalar(valStr);
    } else if (key === "start_ms") {
      const n = parseInt(parseYamlScalar(valStr), 10);
      if (!isNaN(n)) target.start_ms = n;
    } else if (key === "end_ms") {
      const n = parseInt(parseYamlScalar(valStr), 10);
      if (!isNaN(n)) target.end_ms = n;
    }
  };

  for (const rawRow of yamlStr.split(/\r?\n/)) {
    const trimmed = rawRow.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const indent = rawRow.match(/^(\s*)/)[1].length;

    if (indent === 0 && !trimmed.startsWith("-")) {
      const topMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s*:(.*)$/);
      if (topMatch) {
        section = topMatch[1];
        inWords = false;
        currentWord = null;
        continue;
      }
    }

    if (section === "metadata") {
      const m = trimmed.match(/^offset_ms\s*:\s*(.+)$/);
      if (m) {
        const n = parseInt(parseYamlScalar(m[1]), 10);
        if (!isNaN(n)) offsetMs = n;
      }
      continue;
    }

    if (section !== "lines") continue;

    if (trimmed.startsWith("-")) {
      const afterDash = trimmed.slice(1).trim();
      const kv = afterDash.match(/^([a-zA-Z0-9_]+)\s*:(.*)$/);
      if (!inWords || (lineItemIndent >= 0 && indent <= lineItemIndent) || (wordsKeyIndent >= 0 && indent <= wordsKeyIndent)) {
        if (lineItemIndent < 0) lineItemIndent = indent;
        currentLine = { text: "", start_ms: null, end_ms: null, words: [] };
        rawLines.push(currentLine);
        inWords = false;
        wordsKeyIndent = -1;
        currentWord = null;
        if (kv) {
          if (kv[1] === "words") {
            const v = kv[2].trim();
            inWords = v !== "[]" && v !== "null";
            wordsKeyIndent = indent + 2;
          } else {
            assignProp(currentLine, kv[1], kv[2]);
          }
        }
      } else if (currentLine) {
        currentWord = { text: "", start_ms: null, end_ms: null };
        currentLine.words.push(currentWord);
        if (kv) assignProp(currentWord, kv[1], kv[2]);
      }
      continue;
    }

    const kv = trimmed.match(/^([a-zA-Z0-9_]+)\s*:(.*)$/);
    if (!kv || !currentLine) continue;

    if (inWords && indent > wordsKeyIndent && currentWord) {
      assignProp(currentWord, kv[1], kv[2]);
    } else {
      if (inWords && indent <= wordsKeyIndent) {
        inWords = false;
        currentWord = null;
      }
      if (kv[1] === "words") {
        const v = kv[2].trim();
        if (v === "[]" || v === "null") {
          inWords = false;
          currentWord = null;
        } else {
          inWords = true;
          wordsKeyIndent = indent;
          currentWord = null;
        }
      } else {
        assignProp(currentLine, kv[1], kv[2]);
      }
    }
  }

  const lines = [];
  let hasWordLevel = false;

  for (const rl of rawLines) {
    if (rl.start_ms === null && rl.words.length === 0) continue;
    const baseStart = rl.start_ms !== null ? rl.start_ms : (rl.words[0]?.start_ms ?? 0);
    const lineStart = Math.max(0, baseStart + offsetMs);
    const lineEnd = rl.end_ms !== null ? Math.max(0, rl.end_ms + offsetMs) : 0;

    let words = [];
    if (rl.words.length > 0) {
      const rawWordItems = rl.words.map((w, idx) => {
        const wStart = Math.max(0, (w.start_ms !== null ? w.start_ms : baseStart) + offsetMs);
        const nextStart = idx + 1 < rl.words.length && rl.words[idx + 1].start_ms !== null
          ? Math.max(0, rl.words[idx + 1].start_ms + offsetMs)
          : (lineEnd > wStart ? lineEnd : wStart + 400);
        const wEnd = w.end_ms !== null ? Math.max(0, w.end_ms + offsetMs) : nextStart;
        return {
          time: wStart,
          duration: Math.max(0.1, (wEnd - wStart) / 1000),
          rawText: w.text,
        };
      });
      words = finalizeWordSpacing(rawWordItems, (rl.text || "").trim());
    }

    let lineText = (rl.text || "").trim();
    if (!lineText && words.length > 0) {
      lineText = words.map(w => w.text + (w.hasSpace ? " " : "")).join("").trim();
    }
    if (!lineText) continue;

    const lineDuration = lineEnd > lineStart ? (lineEnd - lineStart) / 1000 : 0;
    if (words.length > 0) {
      hasWordLevel = true;
      lines.push({ time: lineStart, text: lineText, words, isWordLevel: true, duration: lineDuration });
    } else {
      lines.push({ time: lineStart, text: lineText, isWordLevel: false, duration: lineDuration });
    }
  }

  lines.sort((a, b) => a.time - b.time);

  const mergedLines = [];
  for (const line of lines) {
    if (mergedLines.length > 0) {
      const prev = mergedLines[mergedLines.length - 1];
      if (prev.text === line.text && Math.abs(prev.time - line.time) < 500) {
        continue;
      }
      if (Math.abs(line.time - prev.time) < 150) {
        if (!prev.text.includes(line.text)) {
          prev.text = `${prev.text} / ${line.text}`;
          const prevEndMs = prev.time + (prev.duration || 0) * 1000;
          const lineEndMs = line.time + (line.duration || 0) * 1000;
          const maxEndMs = Math.max(prevEndMs, lineEndMs);
          if (maxEndMs > prev.time) {
            prev.duration = (maxEndMs - prev.time) / 1000;
          }
          if (prev.words && line.words && prev.words.length > 0 && line.words.length > 0) {
            prev.words[prev.words.length - 1].hasSpace = true;
            prev.words.push({ time: line.time, duration: 0.1, text: "/", hasSpace: true });
            prev.words = prev.words.concat(line.words);
            prev.words[prev.words.length - 1].hasSpace = false;
          } else {
            delete prev.words;
            prev.isWordLevel = false;
          }
        }
        continue;
      }
    }
    mergedLines.push(line);
  }

  for (let i = 0; i < mergedLines.length; i++) {
    if (!mergedLines[i].duration || mergedLines[i].duration <= 0) {
      const nextTime = i + 1 < mergedLines.length ? mergedLines[i + 1].time : mergedLines[i].time + 5000;
      const raw = Math.max(0.5, (nextTime - mergedLines[i].time) / 1000);
      mergedLines[i].duration = Math.min(raw, Math.max(3.0, mergedLines[i].text.length / 4));
    }
  }
  ensureWordDurationFloor(mergedLines);

  return { lines: mergedLines, hasWordLevel };
}

function parseLyricsInput(input, allowPlain = false) {
  if (!input) return { lines: [], hasWordLevel: false };

  if (typeof input === "string" && (input.includes("<tt") || input.includes("<p begin=") || input.includes("</tt>"))) {
    return parseTTML(input);
  }

  if (typeof input === "string" && /^version:\s*["']?1\./m.test(input) && /^lines:/m.test(input)) {
    const lfParsed = parseLyricsfile(input);
    if (lfParsed.lines.length > 0) return lfParsed;
  }

  if (typeof input === "object" || (typeof input === "string" && input.trim().startsWith("{"))) {
    let obj = null;
    if (typeof input === "object") {
      obj = input;
    } else {
      try {
        obj = JSON.parse(input);
      } catch {
        obj = null;
      }
    }

    if (obj) {
      if (typeof obj.ttml === "string") {
        return parseTTML(obj.ttml);
      }

      const list = obj.lines || obj.lyrics || obj.data || obj.result;
      if (Array.isArray(list) && list.length > 0) {
        const lines = [];
        let hasWordLevel = false;
        for (const item of list) {
          const time = parseInt(item.startTimeMs || item.time || item.begin || 0);
          const endMs = parseInt(item.endTimeMs || item.endtime || item.end || 0);
          let text = (typeof item.text === "string" ? item.text : item.words || item.line || "").trim();
          const subWords = item.syllables || item.wordsArray || item.lead || item.words_list;

          if (Array.isArray(subWords) && subWords.length > 0) {
            const rawWordItems = subWords.map((w, idx) => {
              const wTime = parseInt(w.startTimeMs || w.time || w.begin || time);
              const wExplicitEnd = parseInt(w.endTimeMs || w.endtime || w.end || 0);
              const nextW = idx + 1 < subWords.length ? subWords[idx + 1] : null;
              const wNextTime = wExplicitEnd > wTime
                ? wExplicitEnd
                : (nextW ? parseInt(nextW.startTimeMs || nextW.time || nextW.begin || wTime + 500) : wTime + 500);
              const wDur = Math.max(0.1, (wNextTime - wTime) / 1000);
              return {
                time: wTime,
                duration: wDur,
                rawText: w.text ?? w.word ?? "",
                part: typeof w.part === "boolean" ? w.part : undefined,
              };
            });
            const words = finalizeWordSpacing(rawWordItems, text);
            if (!text && words.length > 0) {
              text = words.map(w => w.text + (w.hasSpace ? " " : "")).join("").trim();
            }
            if (words.length > 0 && text) {
              hasWordLevel = true;
              const lineDur = endMs > time ? (endMs - time) / 1000 : 0;
              lines.push({ time, text, words, isWordLevel: true, duration: lineDur });
            } else if (text) {
              lines.push({ time, text, isWordLevel: false, duration: endMs > time ? (endMs - time) / 1000 : 0 });
            }
          } else if (text) {
            lines.push({ time, text, isWordLevel: false, duration: endMs > time ? (endMs - time) / 1000 : 0 });
          }
        }
        if (lines.length > 0) {
          lines.sort((a, b) => a.time - b.time);
          for (let i = 0; i < lines.length; i++) {
            if (!lines[i].duration || lines[i].duration <= 0) {
              const nextTime = i + 1 < lines.length ? lines[i + 1].time : lines[i].time + 5000;
              const raw = Math.max(0.5, (nextTime - lines[i].time) / 1000);
              lines[i].duration = Math.min(raw, Math.max(3.0, lines[i].text.length / 4));
            }
          }
          ensureWordDurationFloor(lines);
          return { lines, hasWordLevel };
        }
      }
    }
  }

  if (typeof input !== "string") return { lines: [], hasWordLevel: false };

  const lineRegex = /\[(\d{2}):(\d{2})[\.:](\d{2,3})\](.*)/;
  const wordTagRegex = /[<\(\[](\d{2}):(\d{2})[\.:](\d{2,3})[>\)\]]([^\n]*?)(?=[<\(\[]\d{2}:\d{2}[\.:]\d{2,3}[>\)\]]|$)/g;

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

      const rawTags = [];
      let wordMatch;
      wordTagRegex.lastIndex = 0;
      while ((wordMatch = wordTagRegex.exec(lineBody)) !== null) {
        const wTime =
          parseInt(wordMatch[1]) * 60 * 1000 +
          parseInt(wordMatch[2]) * 1000 +
          parseFloat("0." + wordMatch[3]) * 1000;
        rawTags.push({ time: wTime, rawText: wordMatch[4] });
      }

      if (rawTags.length > 0) {
        const words = [];
        for (let idx = 0; idx < rawTags.length; idx++) {
          const tag = rawTags[idx];
          const nextTime = idx + 1 < rawTags.length ? rawTags[idx + 1].time : tag.time + 1500;
          if (/^\s/.test(tag.rawText) && words.length > 0) {
            words[words.length - 1].hasSpace = true;
          }
          const trimmed = tag.rawText.trim();
          if (!trimmed) continue;
          words.push({
            time: tag.time,
            duration: Math.max(0.1, (nextTime - tag.time) / 1000),
            text: trimmed,
            hasSpace: /\s$/.test(tag.rawText),
          });
        }
        if (words.length > 0) {
          words[words.length - 1].hasSpace = false;
          hasWordLevel = true;
          const cleanText = lineBody
            .replace(/[<\(\[]\d{2}:\d{2}[\.:]\d{2,3}[>\)\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
          all.push({ time: lineTime, text: cleanText, words, isWordLevel: true });
        } else {
          const cleanText = lineBody
            .replace(/[<\(\[]\d{2}:\d{2}[\.:]\d{2,3}[>\)\]]/g, "")
            .replace(/\s+/g, " ")
            .trim();
          all.push({ time: lineTime, text: cleanText, isWordLevel: false });
        }
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
  ensureWordDurationFloor(lines);

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

function getResultDurationSec(item) {
  if (!item || typeof item !== "object") return 0;
  const raw = item.duration ?? item.durationSec ?? item.durationInMillis ?? item.trackTimeMillis ?? item.attributes?.durationInMillis ?? 0;
  const num = Number(raw);
  if (!Number.isFinite(num) || num <= 0) return 0;
  return num > 10000 ? num / 1000 : num;
}

class AppleMusicProvider {
  constructor(session) {
    this.name = "Apple Music";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration) {
    if (!title || !title.trim()) return null;
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
          if (directParsed.lines && directParsed.lines.length > 0 && parsedMatchesDuration(directParsed, duration)) {
            return {
              payload: rawText,
              parsed: directParsed,
              provider: this.name,
              isSynced: true,
              hasWordLevel: directParsed.hasWordLevel,
              isAiWordSync: false,
            };
          }
          const json = JSON.parse(rawText);
          const results = json && json.results ? json.results : null;
          if (Array.isArray(results) && results.length > 0) {
            let candidates = results.filter(r => r && r.lyricsUrl);
            if (duration && duration > 0) {
              candidates = candidates.filter(r => {
                const rDur = getResultDurationSec(r);
                return rDur <= 0 || Math.abs(rDur - duration) <= 15;
              });
            }

            const normArtist = normalizeCompare(queryArtist);
            candidates.sort((a, b) => {
              const scoreCand = (r) => {
                let s = 0;
                const rTitle = r.track_name || r.title || r.trackName || r.name || r.attributes?.name || "";
                const rAlbum = r.album_name || r.album || r.albumName || r.attributes?.albumName || "";
                const rArtist = r.artist_name || r.artist || r.artistName || r.attributes?.artistName || "";
                s += scoreQualifierCompatibility(title, album, rTitle, rAlbum);
                if (normArtist && rArtist) {
                  const nCandArt = normalizeCompare(rArtist);
                  if (nCandArt === normArtist || nCandArt.includes(normArtist) || normArtist.includes(nCandArt)) {
                    s += 20;
                  }
                }
                if (r.timing_type === "word") s += 15;
                const rDur = getResultDurationSec(r);
                if (duration && duration > 0 && rDur > 0) {
                  s -= Math.abs(rDur - duration) * 2;
                }
                return s;
              };
              return scoreCand(b) - scoreCand(a);
            });

            for (const candidate of candidates.slice(0, 3)) {
              let ttmlMsg = Soup.Message.new("GET", candidate.lyricsUrl);
              if (!ttmlMsg) continue;
              ttmlMsg.request_headers.append("User-Agent", "BetterLyrics/1.0");
              const ttmlBytes = await this._session.send_and_read_async(ttmlMsg, GLib.PRIORITY_DEFAULT, null);
              if (ttmlMsg.status_code === Soup.Status.OK) {
                const ttmlText = decode(ttmlBytes.get_data());
                const parsed = parseLyricsInput(ttmlText);
                if (parsed.lines && parsed.lines.length > 0 && parsedMatchesDuration(parsed, duration)) {
                  const isAiWordSync = Boolean(
                    candidate.byModel ||
                    (candidate.timing_type && candidate.timing_type !== "word" && parsed.hasWordLevel)
                  );
                  return {
                    payload: ttmlText,
                    parsed,
                    provider: this.name,
                    isSynced: true,
                    hasWordLevel: parsed.hasWordLevel,
                    isAiWordSync,
                  };
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
          if (parsed.lines && parsed.lines.length > 0 && parsedMatchesDuration(parsed, duration)) {
            return {
              payload: text,
              parsed,
              provider: this.name,
              isSynced: true,
              hasWordLevel: parsed.hasWordLevel,
              isAiWordSync: false,
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

class LrclibProvider {
  constructor(session) {
    this.name = "LRCLib";
    this._session = session;
  }

  async fetchLyrics(title, artist, album, duration, pref) {
    if ((!title || !title.trim()) && (!artist || !artist.trim())) return null;
    const cArtist = cleanArtist(artist);
    const cleaned = cleanTitle(title, cArtist);
    const alt = extractAltArtistTitle(title, cArtist);
    const queryTitle = cleaned || title;

    const tasks = [
      this._fetchCandidates(queryTitle, cArtist, duration, 15),
    ];

    if (duration && duration > 0) {
      const exactUrl =
        `https://lrclib.net/api/get?track_name=${encodeURIComponent(queryTitle)}` +
        `&artist_name=${encodeURIComponent(cArtist)}` +
        `&album_name=${encodeURIComponent(album || '')}&duration=${Math.round(duration)}`;
      tasks.unshift(this._fetchExact(exactUrl));
    }

    if (alt) {
      tasks.push(this._fetchCandidates(alt.title, alt.artist, duration, 15));
    }

    const taskResults = await Promise.all(tasks);

    let allItems = [];
    let anyFailed = false;
    for (const r of taskResults) {
      if (!r) continue;
      if (r.failed) anyFailed = true;
      if (Array.isArray(r.items)) {
        for (const c of r.items) {
          if (c && !allItems.some(x => x.id === c.id)) allItems.push(c);
        }
      } else if (r.item && r.item.id && !allItems.some(x => x.id === r.item.id)) {
        allItems.push(r.item);
      }
    }

    // Fallback: only if artist searches succeeded with 0 results (e.g. YouTube channel name as artist),
    // search by title alone with strict title equality and tight (±3s) duration tolerance.
    if (allItems.length === 0 && !anyFailed && queryTitle && duration && duration > 0) {
      const titleRes = await this._fetchCandidates(queryTitle, "", duration, 3);
      const normWantedTitle = normalizeCompare(queryTitle);
      const normRawTitle = normalizeCompare(title);
      for (const c of titleRes.items) {
        if (!c || allItems.some(x => x.id === c.id)) continue;
        const candTitle = c.trackName || c.name || "";
        const normCandTitle = normalizeCompare(candTitle);
        const normCandClean = normalizeCompare(cleanTitle(candTitle, c.artistName || ""));
        const titleMatches = normWantedTitle && (
          normCandTitle === normWantedTitle ||
          normCandTitle === normRawTitle ||
          normCandClean === normWantedTitle
        );
        const qualScore = scoreQualifierCompatibility(title, album, candTitle, c.albumName || "");
        if (titleMatches && qualScore >= 0) {
          allItems.push(c);
        }
      }
    }

    if (allItems.length === 0) return null;

    const sortedByDuration = [...allItems].sort((a, b) => {
      if (!duration || duration <= 0) return 0;
      return Math.abs((a.duration || 0) - duration) - Math.abs((b.duration || 0) - duration);
    });

    // Respect explicit instrumental entries when artist + title + duration closely match
    const normArt = normalizeCompare(cArtist);
    const normTitle = normalizeCompare(queryTitle);
    const exactInstrumental = sortedByDuration.find(item => {
      if (!item.instrumental || item.syncedLyrics || item.lyricsfile) return false;
      const durOk = !duration || duration <= 0 || Math.abs((item.duration || 0) - duration) <= 5;
      const itemArt = normalizeCompare(item.artistName || "");
      const itemTitle = normalizeCompare(cleanTitle(item.trackName || item.name || "", item.artistName || ""));
      return durOk && normArt && itemArt === normArt && itemTitle === normTitle;
    });
    if (exactInstrumental) return null;

    let bestSynced = null;
    let bestSyncedScore = -Infinity;

    for (const item of allItems) {
      const hasWordYaml = Boolean(item.hasWordSync && item.lyricsfile);
      if (!item.syncedLyrics && !hasWordYaml) continue;
      const durationScore = (duration && duration > 0 && item.duration)
        ? -Math.abs(item.duration - duration) * 2
        : 0;
      const qualScore = scoreQualifierCompatibility(title, album, item.trackName || item.name || "", item.albumName || "");
      const wordBonus = hasWordYaml ? 500 : 0;
      const prefScore = this._scoreItem(item, pref) * 1000;
      const total = prefScore + wordBonus + qualScore + durationScore;
      if (total > bestSyncedScore) {
        bestSyncedScore = total;
        bestSynced = item;
      }
    }

    if (bestSynced) {
      if (bestSynced.hasWordSync && bestSynced.lyricsfile) {
        const wordParsed = parseLyricsfile(bestSynced.lyricsfile);
        if (wordParsed.lines && wordParsed.lines.length > 0) {
          return {
            payload: bestSynced.lyricsfile,
            parsed: wordParsed,
            isSynced: true,
            hasWordLevel: wordParsed.hasWordLevel,
            provider: this.name,
          };
        }
      }
      if (bestSynced.syncedLyrics) {
        const parsed = parseLyricsInput(bestSynced.syncedLyrics);
        if (parsed.lines && parsed.lines.length > 0) {
          return {
            payload: bestSynced.syncedLyrics,
            parsed,
            isSynced: true,
            hasWordLevel: parsed.hasWordLevel,
            provider: this.name,
          };
        }
      }
    }

    for (const item of sortedByDuration) {
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
    if (!item.syncedLyrics && !item.lyricsfile) return -1;
    if (pref === 0) return 0;
    const parsed = item.syncedLyrics
      ? parseLyricsInput(item.syncedLyrics)
      : parseLyricsfile(item.lyricsfile);
    const script = this._detectScript(parsed.lines);
    if (pref === 1) return script === 'original' ? 2 : (script === 'unknown' ? 0 : 1);
    if (pref === 2) return script === 'latin' ? 2 : (script === 'unknown' ? 0 : 1);
    return 0;
  }

  async _fetchExact(url) {
    try {
      let msg = Soup.Message.new("GET", url);
      if (!msg) return { item: null, failed: false };
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.status_code === Soup.Status.OK) {
        return { item: JSON.parse(decode(bytes.get_data())), failed: false };
      }
      if (msg.status_code === Soup.Status.NOT_FOUND) {
        return { item: null, failed: false };
      }
      return { item: null, failed: true };
    } catch (e) {
      console.debug(`[LyricsClient] Lrclib exact fetch error: ${e.message}`);
      return { item: null, failed: true };
    }
  }

  async _fetchCandidates(title, artist, duration, maxDiff = 15) {
    try {
      const query = `${artist || ''} ${title || ''}`.trim();
      if (!query) return { items: [], failed: false };
      const url = `https://lrclib.net/api/search?q=${encodeURIComponent(query)}`;
      let msg = Soup.Message.new("GET", url);
      if (!msg) return { items: [], failed: false };
      const bytes = await this._session.send_and_read_async(msg, GLib.PRIORITY_DEFAULT, null);
      if (msg.status_code === Soup.Status.NOT_FOUND) {
        return { items: [], failed: false };
      }
      if (msg.status_code !== Soup.Status.OK) {
        return { items: [], failed: true };
      }
      const data = JSON.parse(decode(bytes.get_data()));
      if (!Array.isArray(data) || data.length === 0) return { items: [], failed: false };

      if (duration && duration > 0) {
        const closeMatches = data.filter(item => item && item.duration > 0 && Math.abs(item.duration - duration) <= maxDiff);
        return { items: closeMatches, failed: false };
      }
      return { items: data, failed: false };
    } catch (e) {
      console.debug(`[LyricsClient] Lrclib search error: ${e.message}`);
      return { items: [], failed: true };
    }
  }
}

function readFileTextAsync(file) {
  return new Promise((resolve) => {
    file.load_contents_async(null, (f, res) => {
      try {
        const [ok, bytes] = f.load_contents_finish(res);
        resolve(ok && bytes ? decode(bytes) : null);
      } catch {
        resolve(null);
      }
    });
  });
}

function parseLocalLyricsText(text, provider = "Local") {
  if (!text || !text.trim()) return null;
  const synced = parseLyricsInput(text, false);
  if (synced.lines && synced.lines.length > 0) {
    return {
      lines: synced.lines,
      provider,
      type: synced.hasWordLevel ? "word-level" : "synced",
      isSynced: true,
    };
  }
  const plain = parseLyricsInput(text, true);
  if (plain.lines && plain.lines.length > 0) {
    return {
      lines: plain.lines,
      provider,
      type: "plain",
      isSynced: false,
    };
  }
  return null;
}

export { parseTTML, parseLyricsfile, parseLyricsInput };

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
      new LrclibProvider(this._session),
    ];
  }

  async _getLocalLyrics(title, artist, trackUrl = null, settings = null) {
    const cacheDir = GLib.build_filenamev([
      GLib.get_user_cache_dir(),
      "dynamic-music-pill",
      "lyrics",
    ]);
    const indexFile = Gio.File.new_for_path(
      GLib.build_filenamev([cacheDir, "index.json"]),
    );
    const indexText = await readFileTextAsync(indexFile);
    if (indexText) {
      let entries = null;
      try {
        entries = JSON.parse(indexText);
      } catch {
        entries = null;
      }
      if (Array.isArray(entries)) {
        const normTitle = normalizeCompare(title);
        const normArtist = normalizeCompare(artist);
        const normCleanTitle = normalizeCompare(cleanTitle(title, artist));
        const normCleanArtist = normalizeCompare(cleanArtist(artist));

        const matched = entries.find((entry) => {
          if (!entry || !entry.fileName) return false;
          if (trackUrl && entry.trackUrl && entry.trackUrl === trackUrl) {
            return true;
          }
          const eTitle = normalizeCompare(entry.title);
          const eArtist = normalizeCompare(entry.artist);
          if (normTitle && eTitle === normTitle) {
            if (!eArtist || !normArtist || eArtist === normArtist) return true;
          }
          const eCleanTitle = normalizeCompare(cleanTitle(entry.title, entry.artist));
          const eCleanArtist = normalizeCompare(cleanArtist(entry.artist));
          if (normCleanTitle && eCleanTitle === normCleanTitle) {
            if (!eCleanArtist || !normCleanArtist || eCleanArtist === normCleanArtist) {
              return true;
            }
          }
          return false;
        });

        if (matched) {
          const lrcFile = Gio.File.new_for_path(
            GLib.build_filenamev([cacheDir, matched.fileName]),
          );
          const lrcText = await readFileTextAsync(lrcFile);
          const parsed = parseLocalLyricsText(lrcText, "Local");
          if (parsed) return parsed;
        }
      }
    }

    const exts = [".lrc", ".LRC", ".ttml", ".TTML", ".txt", ".TXT"];
    let audioBaseName = "";

    if (trackUrl && typeof trackUrl === "string" && trackUrl.startsWith("file://")) {
      const audioFile = Gio.File.new_for_uri(trackUrl);
      const audioPath = audioFile.get_path();
      if (audioPath) {
        const basePath = audioPath.replace(/\.[^/.]+$/, "");
        const baseNameWithExt = GLib.path_get_basename(audioPath);
        audioBaseName = baseNameWithExt.replace(/\.[^/.]+$/, "");
        for (const ext of exts) {
          const text = await readFileTextAsync(Gio.File.new_for_path(basePath + ext));
          const parsed = parseLocalLyricsText(text, "Local");
          if (parsed) return parsed;
        }
      }
    }

    const folderPath = settings ? settings.get_string("local-lyrics-folder").trim() : "";
    if (folderPath) {
      const baseNames = [];
      if (audioBaseName) baseNames.push(audioBaseName);
      const safeTitle = (title || "").replace(/[/\\]/g, "_").trim();
      const safeArtist = (artist || "").replace(/[/\\]/g, "_").trim();
      if (safeArtist && safeTitle) {
        baseNames.push(`${safeArtist} - ${safeTitle}`);
        baseNames.push(`${safeTitle} - ${safeArtist}`);
      }
      if (safeTitle) baseNames.push(safeTitle);

      for (const base of baseNames) {
        for (const ext of [".lrc", ".ttml", ".txt"]) {
          const candidatePath = GLib.build_filenamev([folderPath, base + ext]);
          const text = await readFileTextAsync(Gio.File.new_for_path(candidatePath));
          const parsed = parseLocalLyricsText(text, "Local");
          if (parsed) return parsed;
        }
      }
    }

    return null;
  }

  async getLyrics(title, artist, album, duration, settings, mprisLyrics = null, trackUrl = null) {
    const localResult = await this._getLocalLyrics(title, artist, trackUrl, settings);
    if (localResult) return localResult;

    let mprisText = "";
    if (Array.isArray(mprisLyrics)) {
      mprisText = mprisLyrics.filter(x => typeof x === "string").join("\n").trim();
    } else if (typeof mprisLyrics === "string") {
      mprisText = mprisLyrics.trim();
    }

    let mprisPlainFallback = null;
    if (mprisText) {
      const mprisSynced = parseLyricsInput(mprisText, false);
      if (mprisSynced.lines && mprisSynced.lines.length > 0) {
        return {
          lines: mprisSynced.lines,
          provider: 'MPRIS',
          type: mprisSynced.hasWordLevel ? 'word-level' : 'synced',
          isSynced: true,
        };
      }
      const mprisPlain = parseLyricsInput(mprisText, true);
      if (mprisPlain.lines && mprisPlain.lines.length > 0) {
        mprisPlainFallback = {
          lines: mprisPlain.lines,
          provider: 'MPRIS',
          type: 'plain',
          isSynced: false,
        };
      }
    }

    if (!this._session) return mprisPlainFallback;
    if (!title || !title.trim()) return mprisPlainFallback;
    if ((!artist || !artist.trim()) && !/\s+[-–—]\s+/.test(title)) return mprisPlainFallback;
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
          isAiWordSync: Boolean(res.isAiWordSync),
          type: res.parsed.hasWordLevel ? 'word-level' : (res.isSynced ? 'synced' : 'plain'),
        });
      }
    }

    // TIER 1 (TOP PRIORITY): word-level (karaoke word-by-word) lyrics
    // Genuine Apple Music > human LRCLib word-sync > AI-generated word-sync
    const wordLevelItems = parsedResults.filter(item => item.type === 'word-level');
    if (wordLevelItems.length > 0) {
      const genuineAm = wordLevelItems.find(item => item.provider === 'Apple Music' && !item.isAiWordSync);
      const lrclibWord = wordLevelItems.find(item => item.provider === 'LRCLib');
      const aiAm = wordLevelItems.find(item => item.provider === 'Apple Music' && item.isAiWordSync);
      const chosen = genuineAm || lrclibWord || aiAm || wordLevelItems[0];
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

    // TIER 3: plain text fallback (embedded MPRIS plain text preferred over network plain text)
    if (mprisPlainFallback) return mprisPlainFallback;

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
