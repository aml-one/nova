import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentOrpheusCueTags,
  normalizeMalformedOrpheusCueOpens,
  normalizeOrpheusSpeechCues,
  prepareChatTextForSpeech
} from "./tts-text.js";

describe("normalizeMalformedOrpheusCueOpens", () => {
  it("closes missing > after cue token before dialogue", () => {
    const raw =
      "Love the energy. <chuckle Cleopatra VII lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza.";
    expect(normalizeMalformedOrpheusCueOpens(raw)).toBe(
      "Love the energy. <chuckle> Cleopatra VII lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza."
    );
  });

  it("does not alter well-formed tags", () => {
    expect(normalizeMalformedOrpheusCueOpens("<chuckle> Okay")).toBe("<chuckle> Okay");
  });
});

describe("dedupeAdjacentOrpheusCueTags", () => {
  it("collapses repeated identical cue tags", () => {
    expect(dedupeAdjacentOrpheusCueTags("<chuckle> <chuckle> Hello")).toBe("<chuckle> Hello");
    expect(dedupeAdjacentOrpheusCueTags("<chuckle> <chuckle> <chuckle> Hi")).toBe("<chuckle> Hi");
  });
});

describe("prepareChatTextForSpeech", () => {
  it("fixes malformed cues and dedupes in the full pipeline", () => {
    const out = prepareChatTextForSpeech(
      "Hi. <chuckle Next sentence without closing bracket." +
        " Multiple    spaces.",
      400
    );
    expect(out).toContain("<chuckle> Next sentence");
    expect(out).not.toMatch(/<chuckle\s+N/);
  });
});
