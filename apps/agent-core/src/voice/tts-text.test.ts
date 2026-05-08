import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentOrpheusCueTags,
  ensureOrpheusCueTagsClosed,
  normalizeOrpheusSpeechCues,
  prepareChatTextForSpeech,
  stripOrpheusSpeechCues
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

describe("stripOrpheusSpeechCues", () => {
  it("removes well-formed cues and tightens punctuation spacing", () => {
    expect(
      stripOrpheusSpeechCues(
        "Third time's the charm? <chuckle> You're really testing my greeting counter."
      )
    ).toBe("Third time's the charm? You're really testing my greeting counter.");
  });

  it("removes malformed / glued cues that show up in the wild", () => {
    expect(stripOrpheusSpeechCues("Hi <chuckleOkay let me try.")).toBe("Hi Okay let me try.");
    expect(stripOrpheusSpeechCues("Hi <chuckle ")).toBe("Hi");
  });

  it("leaves regular angle-bracket text alone", () => {
    expect(stripOrpheusSpeechCues("Use <code>x</code> not <chucklebee>.")).toBe(
      "Use <code>x</code> not <chucklebee>."
    );
  });

  it("collapses double spaces left by removed cues", () => {
    expect(stripOrpheusSpeechCues("Hello <sigh> world")).toBe("Hello world");
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
