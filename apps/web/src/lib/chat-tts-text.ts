export const CHAT_TTS_CHUNK_TARGET_CHARS = 190;
export const CHAT_TTS_CHUNK_MIN_CHARS = 120;
/** Hard cap per Orpheus request — long unpunctuated paragraphs (common in HU chat) must not be sent as one huge `input`. */
export const CHAT_TTS_CHUNK_HARD_MAX = 340;

/** Keep in sync with `ORPHEUS_SPEECH_CUE_NAMES` in `apps/agent-core/src/voice/tts-text.ts`. */
const ORPHEUS_SPEECH_CUE_NAMES = "laugh|sigh|chuckles|chuckle|cough|sniffle|groan|gasp";
const ORPHEUS_WELLFORMED_TAG_RE = new RegExp(`<\\s*(?:${ORPHEUS_SPEECH_CUE_NAMES})\\b[^>]*>`, "gi");

/**
 * Removes `[nova:tone]…[/nova]` hints (inner wording kept).
 * Handles model mistakes: second `[nova:…]` instead of `[/nova]`, and stray opens.
 * Keep in sync with `stripNovaToneMarkup` in `apps/agent-core/src/voice/tts-text.ts`.
 */
export function stripNovaToneMarkup(text: string): string {
  if (!text) return text;
  let t = text.replace(/\[nova:[^\]]+\]([\s\S]*?)\[\/nova\]/gi, "$1");
  for (let i = 0; i < 24; i++) {
    const next = t.replace(/\[nova:[^\]]+\]([\s\S]*?)\[nova:[^\]]+\]/gi, "$1");
    if (next === t) break;
    t = next;
  }
  t = t.replace(/\[nova:[^\]]+\]/gi, "");
  t = t.replace(/\[\/nova\]/gi, " ");
  return t.replace(/\s{2,}/g, " ").trim();
}

export function stripMarkdownForTts(raw: string): string {
  let visible = raw;
  for (const pattern of [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<reasoning>([\s\S]*?)<\/reasoning>/gi,
    /<think>([\s\S]*?)<\/redacted_thinking>/gi
  ]) {
    visible = visible.replace(pattern, () => "");
  }
  visible = visible.trim();
  visible = visible.replace(/```[\s\S]*?```/g, " ");
  visible = stripNovaToneMarkup(visible);
  visible = visible.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  visible = visible.replace(/\r\n?/g, "\n");
  visible = visible.replace(/[\uFEFF\u200B-\u200D]/g, "");
  visible = visible.replace(/[\u2013\u2014]/g, ", ");
  const cueTokens: string[] = [];
  visible = visible.replace(ORPHEUS_WELLFORMED_TAG_RE, (m) => {
    cueTokens.push(m);
    return `\uE000${cueTokens.length - 1}\uE001`;
  });
  visible = visible.replace(/[#*_>`]+/g, " ");
  visible = visible.replace(/\uE000(\d+)\uE001/g, (_, idx) => {
    const i = Number.parseInt(idx, 10);
    return Number.isFinite(i) && cueTokens[i] !== undefined ? cueTokens[i]! : "";
  });

  const lines = visible
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  if (lines.length > 1) {
    visible = lines
      .map((line) => {
        const isBullet = /^[-*•]\s+/.test(line);
        const isOrdered = /^\d+[\.\)]\s+/.test(line);
        const isLettered = /^[A-Za-z][\)]\s+/.test(line);
        const isListLike = isBullet || isOrdered || isLettered;
        let cleanedLine = line;
        if (isBullet) {
          cleanedLine = line.replace(/^[-*•]\s+/, "");
        }
        if (isListLike && !/[.!?…:;]$/.test(cleanedLine)) {
          cleanedLine = `${cleanedLine}.`;
        }
        return cleanedLine;
      })
      .join(" ");
  }

  visible = visible.replace(/\s+/g, " ").trim();
  return visible.slice(0, 8000);
}

/** Break a single long string into ≤maxLen pieces, preferring spaces so words stay intact. */
export function splitLongTtsSegment(text: string, maxLen: number): string[] {
  const t = text.trim();
  if (!t || t.length <= maxLen) return t ? [t] : [];
  const out: string[] = [];
  let rest = t;
  while (rest.length > maxLen) {
    let cut = maxLen;
    const head = rest.slice(0, maxLen);
    const lastSpace = head.lastIndexOf(" ");
    if (lastSpace >= Math.floor(maxLen * 0.45)) {
      cut = lastSpace + 1;
    }
    let piece = rest.slice(0, cut).trim();
    if (!piece) {
      cut = maxLen;
      piece = rest.slice(0, cut);
    }
    out.push(piece);
    rest = rest.slice(cut).trim();
  }
  if (rest) out.push(rest);
  return out;
}

export function splitTextForTts(raw: string): string[] {
  const text = raw.trim();
  if (!text) return [];
  if (text.length <= CHAT_TTS_CHUNK_TARGET_CHARS + 24) {
    return splitLongTtsSegment(text, CHAT_TTS_CHUNK_HARD_MAX);
  }

  // `.` `!` `?` and ellipsis (U+2026); HU copy often uses `…` without ASCII `.`
  const sentenceLike = text.match(/[^.!?\u2026]+[.!?\u2026]+(?:["')\]]+)?|[^.!?\u2026]+$/g) ?? [text];
  const parts: string[] = [];
  let buffer = "";

  const pushBuffer = (): void => {
    const v = buffer.trim();
    if (v) parts.push(v);
    buffer = "";
  };

  for (const rawPiece of sentenceLike) {
    const piece = rawPiece.trim();
    if (!piece) continue;
    if (!buffer) {
      buffer = piece;
      continue;
    }
    const joined = `${buffer} ${piece}`;
    if (joined.length <= CHAT_TTS_CHUNK_TARGET_CHARS) {
      buffer = joined;
      continue;
    }
    if (buffer.length >= CHAT_TTS_CHUNK_MIN_CHARS) {
      pushBuffer();
      buffer = piece;
    } else {
      buffer = joined;
      if (buffer.length >= CHAT_TTS_CHUNK_TARGET_CHARS + 80) {
        pushBuffer();
      }
    }
  }
  pushBuffer();

  if (parts.length <= 1) {
    return splitLongTtsSegment(text, CHAT_TTS_CHUNK_HARD_MAX);
  }

  const merged: string[] = [];
  for (const part of parts) {
    if (!merged.length) {
      merged.push(part);
      continue;
    }
    const prev = merged[merged.length - 1]!;
    if (prev.length < CHAT_TTS_CHUNK_MIN_CHARS) {
      merged[merged.length - 1] = `${prev} ${part}`;
    } else {
      merged.push(part);
    }
  }
  return merged.flatMap((segment) => splitLongTtsSegment(segment, CHAT_TTS_CHUNK_HARD_MAX));
}
