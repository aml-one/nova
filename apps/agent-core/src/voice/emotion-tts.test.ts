import { describe, expect, it } from "vitest";
import { augmentOrpheusSpeechForMood } from "./emotion-tts.js";

describe("augmentOrpheusSpeechForMood", () => {
  it("prefixes Hmm for curious mood with thinking cue", () => {
    const out = augmentOrpheusSpeechForMood(
      "Good question — let me think about how we should wire this.",
      { label: "curious", valence: 0.1, arousal: 0.2 }
    );
    expect(out.toLowerCase().startsWith("hmm,")).toBe(true);
  });

  it("adds chuckle for joyful mood with upbeat cue", () => {
    const out = augmentOrpheusSpeechForMood(
      "Great, that sounds perfect. Here's what we do next.",
      { label: "joyful", valence: 0.4, arousal: 0.3 }
    );
    expect(out.toLowerCase()).toContain("<chuckle>");
  });

  it("returns trimmed input unchanged when empty", () => {
    expect(augmentOrpheusSpeechForMood("", { label: "neutral", valence: 0, arousal: 0 })).toBe("");
  });

  it("may add chuckle or laugh for joyful high valence without upbeat keywords", () => {
    const mood = { label: "joyful" as const, valence: 0.38, arousal: 0.25 };
    let found = false;
    for (let i = 0; i < 90; i++) {
      const text = `Here is the explanation you asked for regarding batch ${i}. We align ports and verify checksums before continuing.`;
      const out = augmentOrpheusSpeechForMood(text, mood);
      if (/<chuckle>|<laugh>/i.test(out)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("sometimes prefixes Hmm for curious mood from arousal when wording is neutral", () => {
    const mood = { label: "curious" as const, valence: 0.05, arousal: 0.45 };
    let found = false;
    for (let i = 0; i < 120; i++) {
      const text = `Walkthrough part ${i}: we configure the relay then drain the queue safely before cutover.`;
      const out = augmentOrpheusSpeechForMood(text, mood);
      if (out.toLowerCase().startsWith("hmm,")) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
