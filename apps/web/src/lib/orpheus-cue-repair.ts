/**
 * Keep in sync with `apps/agent-core/src/voice/tts-text.ts` `repairUnclosedOrpheusCueOpens`
 * (same cue list + regex behavior).
 */

const ORPHEUS_SPEECH_CUE_NAMES = "laugh|sigh|chuckles|chuckle|cough|sniffle|groan|gasp";

const ORPHEUS_CUE_NAME_LIST = ORPHEUS_SPEECH_CUE_NAMES.split("|").sort((a, b) => b.length - a.length);

function escapeRegexCueName(name: string): string {
  return name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function repairUnclosedOrpheusCueOpens(text: string): string {
  let t = text.replace(/\u00a0/g, " ").normalize("NFC");
  for (const name of ORPHEUS_CUE_NAME_LIST) {
    const esc = escapeRegexCueName(name);
    t = t.replace(new RegExp(`<\\s*${esc}\\b(\\s+)(?=[^>\\n])`, "gi"), `<${name}>$1`);
    // Do not use `i` here: `/iu` makes `(?=\p{Lu})` match after `<chuckles` (false positive).
    t = t.replace(new RegExp(`<\\s*${esc}(?=\\p{Lu})`, "gu"), `<${name}> `);
  }
  return t;
}
