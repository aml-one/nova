import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentOrpheusCueTags,
  ensureOrpheusCueTagsClosed,
  normalizeOrpheusSpeechCues,
  prepareChatTextForSpeech
} from "./tts-text.js";

describe("ensureOrpheusCueTagsClosed", () => {
  it("closes missing > before dialogue after cue name", () => {
    const raw =
      "Love the energy. <chuckle Cleopatra VII lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza.";
    expect(ensureOrpheusCueTagsClosed(raw)).toBe(
      "Love the energy. <chuckle> Cleopatra VII lived closer in time to the Moon landing than to the building of the Great Pyramid of Giza."
    );
  });

  it("does not alter well-formed tags", () => {
    expect(ensureOrpheusCueTagsClosed("<chuckle> Okay")).toBe("<chuckle> Okay");
    expect(ensureOrpheusCueTagsClosed("<chuckle > Okay")).toBe("<chuckle > Okay");
  });

  it("closes glued cue + word and inserts a space before speech", () => {
    expect(ensureOrpheusCueTagsClosed("<chuckleOkay then")).toBe("<chuckle> Okay then");
  });

  it("closes cue at end of string", () => {
    expect(ensureOrpheusCueTagsClosed("Hi <chuckle")).toBe("Hi <chuckle>");
  });

  it("matches cue names case-insensitively and emits lowercase tags", () => {
    expect(ensureOrpheusCueTagsClosed("<Chuckle hi")).toBe("<chuckle> hi");
  });

  it("does not treat longer words as cues", () => {
    expect(ensureOrpheusCueTagsClosed("<chucklebee joke")).toBe("<chucklebee joke");
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
      "Hi. <chuckle Next sentence without closing bracket." + " Multiple    spaces.",
      400
    );
    expect(out).toContain("<chuckle> Next sentence");
    expect(out).not.toMatch(/<chuckle\s+N/);
  });
});
