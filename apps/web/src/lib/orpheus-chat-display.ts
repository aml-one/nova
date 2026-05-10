/**
 * Strip Orpheus non-speech cue tags for **display** in chat bubbles only.
 * Assistant `turn.text` is kept verbatim for TTS / read-aloud (cues stay in state).
 */

const ORPHEUS_CUE_TAG = /<\s*(?:laugh|sigh|chuckles|chuckle|cough|sniffle|groan|gasp)\b[^>]*>/gi;

/** Model-authored `<chuckles word` / `<chuckle word` (no `>`) — remove cue open + following space. */
const ORPHEUS_CUE_MALFORMED_OPEN = /<\s*chuckles?\b\s+/gi;

export function stripOrpheusCuesForChatDisplay(text: string): string {
  if (!text) return text;
  let t = text.replace(ORPHEUS_CUE_TAG, "");
  t = t.replace(ORPHEUS_CUE_MALFORMED_OPEN, " ");
  return t
    .replace(/\s+([,.!?;:])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}
