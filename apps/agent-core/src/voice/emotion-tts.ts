import type { EmotionState } from "../emotion/emotion-service.js";

/** Lex-au Orpheus tags supported by typical builds — keep markup ASCII-only. */
const TAG_CHUCKLE = "<chuckle>";
const TAG_LAUGH = "<laugh>";
const TAG_SIGH = "<sigh>";

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
 * Adds short spoken fillers and Orpheus emotion tags so TTS reflects Nova’s unified mood.
 * Conservative: avoids stacking tags when input already contains several.
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
  const tagCount = (result.match(/<(?:laugh|chuckle|sigh|groan|yawn)\b[^>]*>/gi) ?? []).length;
  if (tagCount >= 5) {
    return result;
  }

  const thinkingCue =
    /\b(let me think|let's think|consider|therefore|perhaps|probably|might mean|not sure yet|good question)\b/i.test(
      result
    );
  const happyCue =
    /\b(great|awesome|perfect|wonderful|glad to hear|nice work|exactly|love(?:ly)? it)\b/i.test(result) ||
    /\b(yay|woo ?hoo)\b/i.test(result);

  const hmmThinking =
    (mood.label === "curious" || mood.label === "neutral") &&
    result.length > 35 &&
    !alreadyHmmPrefixed(result) &&
    (thinkingCue || (mood.arousal > 0.22 && stableRoll(trimmed, 41) < 0.22));

  const hmmJoyfulWarm =
    mood.label === "joyful" &&
    mood.valence >= 0.28 &&
    result.length > 48 &&
    !alreadyHmmPrefixed(result) &&
    stableRoll(trimmed, 53) < 0.14;

  if (hmmThinking || hmmJoyfulWarm) {
    result = `Hmm, ${result}`;
  }

  const joyfulBright = mood.label === "joyful" && mood.valence > 0.15;
  const minJoyLen = happyCue ? 20 : 42;
  if (joyfulBright && result.length >= minJoyLen) {
    const { chuckle: chuckleProb, laugh: laughProb } = joyfulPlayfulProb(mood.valence, happyCue);

    if (!/<chuckle>/i.test(result) && stableRoll(trimmed, 11) < chuckleProb) {
      const splitIdx = result.search(/[.!?]\s+/);
      if (splitIdx >= 12 && splitIdx < result.length - 20) {
        result = `${result.slice(0, splitIdx + 1)} ${TAG_CHUCKLE} ${result.slice(splitIdx + 1).trimStart()}`;
      } else {
        result = `${result} ${TAG_CHUCKLE}`;
      }
    }
    if (!/<laugh>/i.test(result) && stableRoll(trimmed, 17) < laughProb) {
      result = `${result} ${TAG_LAUGH}`;
    }
  }

  if (
    (mood.label === "empathetic" || mood.label === "anxious" || mood.label === "frustrated") &&
    mood.valence < -0.05 &&
    stableRoll(trimmed, 23) < 0.28 &&
    !/<sigh>/i.test(result)
  ) {
    result = `${TAG_SIGH} ${result}`;
  }

  return result.replace(/\s{2,}/g, " ").trim();
}
