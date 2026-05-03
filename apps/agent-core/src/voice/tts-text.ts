/** Lex-au / Orpheus spoken cues (single source for normalization + emotion augment). */
export const ORPHEUS_SPEECH_CUE_NAMES = "laugh|sigh|chuckle|cough|sniffle|groan|gasp";

const ORPHEUS_CUE_NAMES = ORPHEUS_SPEECH_CUE_NAMES;

/**
 * Models sometimes emit `<chuckle Cleopatra…` without `>`. Orpheus then misparses input and may repeat phrases.
 * Normalize to `<chuckle> Cleopatra…`.
 */
export function normalizeMalformedOrpheusCueOpens(text: string): string {
  return text.replace(new RegExp(`<(${ORPHEUS_CUE_NAMES})\\b\\s+(?=[^\\s>])`, "gi"), "<$1> ");
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
  let t = normalizeMalformedOrpheusCueOpens(text);
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
