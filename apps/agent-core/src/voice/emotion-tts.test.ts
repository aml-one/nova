import { describe, expect, it } from "vitest";
import { augmentOrpheusSpeechForMood, countOrpheusNonverbTags } from "./emotion-tts.js";

describe("countOrpheusNonverbTags", () => {
  it("detects standard Lex-au tags", () => {
    expect(countOrpheusNonverbTags("<laugh><sigh>")).toBe(2);
    expect(countOrpheusNonverbTags("<sniffle> ok <gasp>")).toBe(2);
    expect(countOrpheusNonverbTags("<groan><cough><chuckle>")).toBe(3);
  });
});

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

  it("may prefix groan for frustrated mood given deterministic text rolls", () => {
    const mood = { label: "frustrated" as const, valence: -0.35, arousal: 0.55 };
    let found = false;
    for (let i = 0; i < 120; i++) {
      const text = `Segment ${i}: this integration keeps failing after redeploy. We should isolate which layer drops events.`;
      const out = augmentOrpheusSpeechForMood(text, mood);
      if (/<groan>/i.test(out)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });

  it("does not prefix English Hmm for Hungarian-heavy text (Tara HU prosody)", () => {
    const text =
      "Persze, szívesen! Itt vagyok neked, hogy segítsek a feladataidban, válaszoljak a kérdéseidre, vagy csak egy kis kikapcsolódást nyújtsak.";
    const out = augmentOrpheusSpeechForMood(text, {
      label: "neutral",
      valence: 0.19,
      arousal: 0.25
    });
    expect(out.toLowerCase().startsWith("hmm,")).toBe(false);
    expect(out).toBe(text.trim());
  });

  it("may prefix gasp for anxious surprise wording", () => {
    const mood = { label: "anxious" as const, valence: -0.08, arousal: 0.52 };
    let found = false;
    for (let i = 0; i < 100; i++) {
      const text = `Wait — what? Batch ${i}: that endpoint should never return null during replay.`;
      const out = augmentOrpheusSpeechForMood(text, mood);
      if (/<gasp>/i.test(out)) {
        found = true;
        break;
      }
    }
    expect(found).toBe(true);
  });
});
