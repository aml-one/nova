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
 * Removes Orpheus voice-cue tags (`<chuckle>`, `<sigh>`, `<laugh>`, …) from a string so it can be
 * shown as a transcript / chat body without the TTS hints leaking into the visible message. The
 * audio path keeps the original cues — only callers that surface the text to humans should strip.
 */
export function stripOrpheusSpeechCues(text: string): string {
  if (!text) return text;
  // First normalize so the tags are well-formed, then drop them. Handles `<chuckle>`, `<chuckle  >`,
  // and stray opens left after partial normalization.
  const normalized = normalizeOrpheusSpeechCues(text);
  const tag = new RegExp(`<\\s*(?:${ORPHEUS_SPEECH_CUE_NAMES})\\b[^>]*>`, "gi");
  return normalized
    .replace(tag, "")
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Normalize assistant/chat markdown for speech synthesis (same rules as web chat read-aloud).
 */
/**
 * Some models put chain-of-thought in the assistant `content` (e.g. "User says:", "* Context:", drafts).
 * Strip that for SMS-like channels so WhatsApp/Signal only get the bubble text.
 */
export function stripChannelAssistantScratchpad(raw: string): string {
  if (!raw?.trim()) return raw;
  let t = raw.replace(/\r\n/g, "\n").trim();
  for (const pattern of [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<reasoning>([\s\S]*?)<\/reasoning>/gi,
    /<think>([\s\S]*?)<\/redacted_thinking>/gi
  ]) {
    t = t.replace(pattern, "");
  }
  t = t.replace(/\r\n/g, "\n").trim();

  const inlinePlanMarkers = (t.match(/\*\s*(?:Context|Goal|Identity|Tone|Constraint|Response|Final)\s*:/gi) ?? []).length;
  const looksLikeDeliberation =
    /^[\s\S]{0,700}User\s+says\s*:/i.test(t) ||
    inlinePlanMarkers >= 3 ||
    ((t.match(/^\s*\*/gm) ?? []).length >= 5 && /\*\s*(Context|Goal)\s*:/i.test(t));

  if (t.length < 500 && !looksLikeDeliberation) {
    return t.replace(/\s+/g, " ").trim();
  }

  if (!looksLikeDeliberation) {
    return t.replace(/\s+/g, " ").trim();
  }

  // Prefer text after the last "Final …" style label (models often put the real reply there).
  const finalRe = /\*\s*Final(?:\s+Polish|\s+reply|\s+answer|\s+text)?\s*:\s*/gi;
  let cut = -1;
  for (const m of t.matchAll(finalRe)) {
    cut = (m.index ?? 0) + m[0].length;
  }
  if (cut >= 0 && cut < t.length - 8) {
    let tail = t.slice(cut).trim();
    tail = tail.replace(/^\*+\s*/gm, "");
    tail = tail.replace(/\n\s*(?:Wait,|Let's|Actually)\b[^\n]*/gi, "");
    const oneLine = tail.replace(/\s+/g, " ").trim();
    if (oneLine.length >= 6 && oneLine.length < t.length) {
      return oneLine;
    }
  }

  // Last few non-bullet lines (short reply tacked after a long plan).
  const lines = t.split("\n").map((l) => l.trim());
  const nonempty = lines.filter(Boolean);
  for (let n = Math.min(4, Math.floor(nonempty.length / 2)); n >= 1; n--) {
    const chunk = nonempty.slice(-n);
    const joined = chunk.join(" ").trim();
    const bulletLines = chunk.filter((line) => /^\*+|^->|^\*?\s*Wait,|^\*?\s*Let's|^\*?\s*Actually/i.test(line)).length;
    if (bulletLines === 0 && joined.length >= 10 && joined.length <= Math.min(900, t.length)) {
      return joined.replace(/\s+/g, " ").trim();
    }
  }

  return t.replace(/\s+/g, " ").trim();
}

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
