/** Lex-au / Orpheus spoken cues (single source for normalization + emotion augment). */
export const ORPHEUS_SPEECH_CUE_NAMES = "laugh|sigh|chuckle|cough|sniffle|groan|gasp";

const ORPHEUS_CUE_NAMES = ORPHEUS_SPEECH_CUE_NAMES;

const ORPHEUS_CUE_NAME_LIST = ORPHEUS_SPEECH_CUE_NAMES.split("|");

/**
 * Ensures known cue opens are always closed with `>` before speech continues.
 * Handles `<chuckle Cleo`, `<chuckleOkay`, trailing `<chuckle`, optional spaces before `>`, any casing.
 */
export function ensureOrpheusCueTagsClosed(text: string): string {
  let out = "";
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) {
      out += text.slice(i);
      break;
    }
    out += text.slice(i, lt);
    const afterLt = lt + 1;
    let matched: string | null = null;
    for (const name of ORPHEUS_CUE_NAME_LIST) {
      const nl = name.length;
      if (afterLt + nl > n) continue;
      const seg = text.slice(afterLt, afterLt + nl);
      if (seg.toLowerCase() !== name) continue;
      const boundary = text[afterLt + nl];
      /** Lowercase/digit/`_` continues a bogus compound (`chucklebee`). Uppercase often starts glued dialogue (`chuckleOkay`). */
      if (boundary !== undefined && /[a-z0-9_]/.test(boundary)) continue;
      matched = name;
      break;
    }
    if (!matched) {
      out += text[lt];
      i = lt + 1;
      continue;
    }
    const name = matched;
    const nl = name.length;
    const p = afterLt + nl;
    let q = p;
    while (q < n && /\s/.test(text[q])) q += 1;
    if (q < n && text[q] === ">") {
      out += text.slice(lt, q + 1);
      i = q + 1;
    } else {
      out += `<${name}>`;
      if (p < n && !/\s/.test(text[p])) {
        out += " ";
      }
      i = p;
    }
  }
  return out;
}

/** Collapse `<chuckle> <chuckle>` / `<chuckle> <chuckle> …` duplicates left after normalization or mood augment. */
export function dedupeAdjacentOrpheusCueTags(text: string): string {
  const tag = `<(?:${ORPHEUS_CUE_NAMES})\\b[^>]*>`;
  const re = new RegExp(`(${tag})\\s+\\1`, "gi");
  let out = text;
  for (let i = 0; i < 24; i++) {
    const next = out.replace(re, "$1");
    if (next === out) break;
    out = next;
  }
  return out;
}

export function normalizeOrpheusSpeechCues(text: string): string {
  let t = ensureOrpheusCueTagsClosed(text);
  t = dedupeAdjacentOrpheusCueTags(t);
  return t.replace(/\s{2,}/g, " ").trim();
}

/**
 * Normalize assistant/chat markdown for speech synthesis (same rules as web chat read-aloud).
 */
export function prepareChatTextForSpeech(raw: string, maxChars = 8000): string {
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
  visible = visible.replace(/\[nova:[^\]]+\]([\s\S]*?)\[\/nova\]/gi, "$1");
  visible = visible.replace(/\[\/nova\]/gi, " ");
  visible = visible.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  visible = visible.replace(/[\uFEFF\u200B-\u200D]/g, "");
  visible = visible.replace(/[\u2013\u2014]/g, ", ");
  visible = visible.replace(/[#*_>`]+/g, " ");
  visible = visible.replace(/\s+/g, " ").trim();
  visible = normalizeOrpheusSpeechCues(visible);
  return visible.slice(0, maxChars);
}
