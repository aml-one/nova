import type { EmotionState } from "../emotion/emotion-service.js";
import { ORPHEUS_SPEECH_CUE_NAMES } from "./tts-text.js";

/**
 * Lex-au / Orpheus non-speech markers — ASCII-only; forwarded to synthesis unchanged.
 * @see augmentOrpheusSpeechForMood
 */
const NONVERB_TAG_RE = new RegExp(`<(?:${ORPHEUS_SPEECH_CUE_NAMES})\\b[^>]*>`, "gi");

/** Count Orpheus-style non-speech tags (conservative stacking guard). */
export function countOrpheusNonverbTags(text: string): number {
  return (text.match(NONVERB_TAG_RE) ?? []).length;
}

/**
 * **Opt-in only** (stock Lex-au): some stacks return near-silent WAVs for Hungarian-heavy text with no
 * `<chuckle>` / `<laugh>` / … (HTTP 200, tiny body). When `NOVA_ORPHEUS_LEXAU_HU_SILENCE_CUE=1` on
 * agent-core, prefix one `<chuckle>` if there are no cues yet and HU-like heuristics match.
 *
 * Default is **no** automatic prefix — fine for custom bilingual Orpheus (e.g. Tara EN+HU). Orpheus fetch
 * may still retry once without leading cues if the first WAV response is suspiciously small.
 */
export function ensureLexAuHungarianCueFallback(text: string): string {
  const enabled =
    process.env.NOVA_ORPHEUS_LEXAU_HU_SILENCE_CUE === "1" ||
    process.env.NOVA_ORPHEUS_LEXAU_HU_SILENCE_CUE === "true";
  if (!enabled) {
    return text.trim();
  }
  const t = text.trim();
  if (!t || t.length < 8) {
    return t;
  }
  if (countOrpheusNonverbTags(t) > 0) {
    return t;
  }
  if (shouldSkipEnglishHmmFiller(t) || looksLikeLatinProseWithoutEnglishHints(t)) {
    return `<chuckle> ${t}`;
  }
  return t;
}

/** True when text looks Hungarian-heavy (for optional alternate Orpheus `voice` id only). */
export function isHungarianLikeForOrpheusVoice(text: string): boolean {
  const t = text.trim();
  if (t.length < 8) {
    return false;
  }
  return shouldSkipEnglishHmmFiller(t) || looksLikeLatinProseWithoutEnglishHints(t);
}

function stableRoll(text: string, salt: number): number {
  let h = 2166136261 >>> 0;
  const payload = `${text}\0${salt}`;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Probabilities scale with valence when there is no explicit upbeat wording in the text. */
function joyfulPlayfulProb(valence: number, happyCue: boolean): { chuckle: number; laugh: number } {
  if (happyCue) {
    return { chuckle: 0.55, laugh: 0.18 };
  }
  if (valence >= 0.35) {
    return { chuckle: 0.4, laugh: 0.12 };
  }
  if (valence >= 0.25) {
    return { chuckle: 0.3, laugh: 0.075 };
  }
  return { chuckle: 0.2, laugh: 0.045 };
}

function alreadyHmmPrefixed(text: string): boolean {
  return /^hm+m?[,.!\s]/i.test(text);
}

/**
 * Hungarian-heavy Latin (áéíóöőúüű): English mood fillers like "Hmm," often make Tara HU sound
 * like it is reading the whole paragraph with English prosody.
 */
function shouldSkipEnglishHmmFiller(text: string): boolean {
  const diacCount = (text.match(/[áéíóöőúüűÁÉÍÓÖŐÚÜŰ]/g) ?? []).length;
  return diacCount >= (text.length < 96 ? 2 : 4);
}

/** Short Latin prose with no common English function/content words — Lex-au often needs a cue like HU diacritics. */
function looksLikeLatinProseWithoutEnglishHints(text: string): boolean {
  const t = text.trim();
  if (t.length < 10 || t.length > 480) {
    return false;
  }
  const englishHits = (
    t.match(
      /\b(the|and|what|with|your|this|that|have|from|here|hello|about|please|thanks|thank you|good|nice|great|will|can|not|just|only|very|really)\b/gi
    ) ?? []
  ).length;
  return englishHits === 0;
}

/** True when synthesis already starts with a non-speech tag (avoid stacking prefixes). */
function hasLeadingNonverbPrefix(text: string): boolean {
  return /^\s*<(?:groan|sigh|sniffle|gasp|cough)\b[^>]*>/i.test(text);
}

/**
 * Adds short spoken fillers and Orpheus emotion tags so TTS reflects Nova’s unified mood.
 * Conservative: avoids stacking tags when input already contains several.
 *
 * Tags understood end-to-end when sent as Orpheus `input`: &lt;laugh&gt;, &lt;sigh&gt;, &lt;chuckle&gt;,
 * &lt;cough&gt;, &lt;sniffle&gt;, &lt;groan&gt;, &lt;gasp&gt; (plus model-authored copies in chat text).
 */
export function augmentOrpheusSpeechForMood(
  text: string,
  mood: Pick<EmotionState, "label" | "valence" | "arousal">
): string {
  const trimmed = text.trim();
  if (!trimmed.length) {
    return trimmed;
  }

  let result = trimmed;
  if (countOrpheusNonverbTags(result) >= 5) {
    return result;
  }

  result = ensureLexAuHungarianCueFallback(result);

  const thinkingCue =
    /\b(let me think|let's think|consider|therefore|perhaps|probably|might mean|not sure yet|good question)\b/i.test(
      result
    );
  const happyCue =
    /\b(great|awesome|perfect|wonderful|glad to hear|nice work|exactly|love(?:ly)? it)\b/i.test(result) ||
    /\b(yay|woo ?hoo)\b/i.test(result);
  const surpriseCue =
    /\b(wow|oh no|what\?|wait[,!]?|unexpected|can't believe|cannot believe|seriously\??)\b/i.test(result);

  const hmmThinking =
    (mood.label === "curious" || mood.label === "neutral" || mood.label === "sad") &&
    result.length > 35 &&
    !alreadyHmmPrefixed(result) &&
    (thinkingCue || (mood.arousal > 0.22 && stableRoll(trimmed, 41) < 0.22));

  const hmmJoyfulWarm =
    mood.label === "joyful" &&
    mood.valence >= 0.28 &&
    result.length > 48 &&
    !alreadyHmmPrefixed(result) &&
    stableRoll(trimmed, 53) < 0.14;

  if ((hmmThinking || hmmJoyfulWarm) && !shouldSkipEnglishHmmFiller(result)) {
    result = `Hmm, ${result}`;
  }

  // Anxious surprise — gasp before other negative prefix sounds
  if (
    mood.label === "anxious" &&
    mood.arousal > 0.28 &&
    surpriseCue &&
    result.length > 22 &&
    stableRoll(trimmed, 83) < 0.38 &&
    !/<gasp>/i.test(result) &&
    !hasLeadingNonverbPrefix(result)
  ) {
    result = `<gasp> ${result}`;
  }

  const joyfulBright = mood.label === "joyful" && mood.valence > 0.15;
  const minJoyLen = happyCue ? 20 : 42;
  if (joyfulBright && result.length >= minJoyLen) {
    const { chuckle: chuckleProb, laugh: laughProb } = joyfulPlayfulProb(mood.valence, happyCue);

    if (!/<chuckle>/i.test(result) && stableRoll(trimmed, 11) < chuckleProb) {
      const splitIdx = result.search(/[.!?]\s+/);
      if (splitIdx >= 12 && splitIdx < result.length - 20) {
        result = `${result.slice(0, splitIdx + 1)} <chuckle> ${result.slice(splitIdx + 1).trimStart()}`;
      } else {
        result = `${result} <chuckle>`;
      }
    }
    if (!/<laugh>/i.test(result) && stableRoll(trimmed, 17) < laughProb) {
      result = `${result} <laugh>`;
    }
  }

  const negRoll = stableRoll(trimmed, 23);

  // Frustration — groan (exclusive with sigh/sniffle cluster)
  if (
    mood.label === "frustrated" &&
    mood.valence < -0.02 &&
    negRoll < 0.24 &&
    result.length > 28 &&
    !/<groan>/i.test(result) &&
    !/<(?:sigh|sniffle)\b[^>]*>/i.test(result) &&
    !hasLeadingNonverbPrefix(result)
  ) {
    result = `<groan> ${result}`;
  } else if (
    mood.label === "angry" &&
    mood.valence < -0.1 &&
    negRoll < 0.32 &&
    result.length > 18 &&
    !/<groan>/i.test(result) &&
    !hasLeadingNonverbPrefix(result)
  ) {
    result = `<groan> ${result}`;
  } else if (
    (mood.label === "empathetic" || mood.label === "anxious" || mood.label === "guilty" || mood.label === "sad") &&
    mood.valence < -0.05 &&
    negRoll < 0.28 &&
    result.length > 28 &&
    !/<(?:groan|sigh|sniffle)\b[^>]*>/i.test(result) &&
    !hasLeadingNonverbPrefix(result)
  ) {
    const texture = stableRoll(trimmed, 71);
    if (texture < 0.075 && mood.label === "empathetic") {
      result = `<sniffle> ${result}`;
    } else {
      result = `<sigh> ${result}`;
    }
  }

  // Inline cough — avoids stacking another leading prefix after groan/sigh/gasp
  if (
    (mood.label === "guilty" || mood.label === "frustrated") &&
    result.length > 52 &&
    stableRoll(trimmed, 97) < 0.055 &&
    !/<cough>/i.test(result) &&
    countOrpheusNonverbTags(result) < 4
  ) {
    const splitIdx = result.search(/[.!?]\s+/);
    if (splitIdx >= 14 && splitIdx < result.length - 18) {
      result = `${result.slice(0, splitIdx + 1)} <cough> ${result.slice(splitIdx + 1).trimStart()}`;
    }
  }

  return result.replace(/\s{2,}/g, " ").trim();
}
