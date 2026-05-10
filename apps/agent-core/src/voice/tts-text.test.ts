import { describe, expect, it } from "vitest";
import {
  dedupeAdjacentOrpheusCueTags,
  ensureOrpheusCueTagsClosed,
  normalizeOrpheusSpeechCues,
  prepareChatTextForSpeech,
  repairUnclosedOrpheusCueOpens,
  stripChannelAssistantScratchpad,
  stripNovaToneMarkup,
  stripOrpheusSpeechCues
} from "./tts-text.js";

describe("stripNovaToneMarkup", () => {
  it("unwraps tone segments and drops stray closers", () => {
    expect(stripNovaToneMarkup("Hello [nova:soft]aside[/nova] there.")).toBe("Hello aside there.");
    expect(stripNovaToneMarkup("[nova:strong]key[/nova]")).toBe("key");
  });

  it("unwraps when the model repeats [nova:…] instead of [/nova]", () => {
    const raw =
      "Round two! Let's see if we can find the perfect rhythm for this voice. [nova:strong]How is the pacing?[nova:strong]";
    expect(stripNovaToneMarkup(raw)).toBe(
      "Round two! Let's see if we can find the perfect rhythm for this voice. How is the pacing?"
    );
  });

  it("strips orphan [nova:…] opens", () => {
    expect(stripNovaToneMarkup("Hi [nova:strong]there")).toBe("Hi there");
  });
});

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

describe("repairUnclosedOrpheusCueOpens", () => {
  it("closes space-separated broken chuckle before glued prose", () => {
    const raw = "Szívesen! <chuckle Akkor egy másik kedvenc";
    expect(repairUnclosedOrpheusCueOpens(raw)).toContain("<chuckle>");
    expect(repairUnclosedOrpheusCueOpens(raw)).toContain("<chuckle> Akkor");
  });

  it("inserts space before glued dialogue after cue name", () => {
    expect(repairUnclosedOrpheusCueOpens("Hi <chuckleThere")).toContain("<chuckle> There");
  });
});

describe("chuckles synonym", () => {
  it("normalizes chuckles to chuckle for Orpheus", () => {
    expect(normalizeOrpheusSpeechCues("Hi <chuckles there")).toContain("<chuckle>");
  });

  it("strips plural chuckles tag from visible prose", () => {
    expect(stripOrpheusSpeechCues("Hi <chuckles> there")).toBe("Hi there");
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

  it("regression: cleans the exact phrase the user reported leaking into Signal", () => {
    expect(
      stripOrpheusSpeechCues(
        "You're really committed to this greeting marathon, aren't you? <chuckle> I'm still here, I promise. What's the actual plan?"
      )
    ).toBe(
      "You're really committed to this greeting marathon, aren't you? I'm still here, I promise. What's the actual plan?"
    );
  });
});

describe("stripChannelAssistantScratchpad", () => {
  it("keeps short replies unchanged", () => {
    expect(stripChannelAssistantScratchpad("Hey! What's up?")).toBe("Hey! What's up?");
  });

  it("takes text after * Final Polish: when deliberation leaked into content", () => {
    const raw = `User says: "one more hi xD" * Context: playful. * Goal: respond in character.
* Constraint: be concise.
* Final Polish: Triple hi! You're on a roll — what's the plan?`;
    expect(stripChannelAssistantScratchpad(raw)).toBe(
      "Triple hi! You're on a roll — what's the plan?"
    );
  });

  it("strips tagged thinking blocks on channels", () => {
    expect(stripChannelAssistantScratchpad("<thinking>plan</thinking>Hello there.")).toBe("Hello there.");
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

  it("drops quotes and markdown markers that can confuse TTS", () => {
    const out = prepareChatTextForSpeech('He said: "wow" *really* `code`.', 200);
    expect(out).not.toMatch(/["*`]/);
    expect(out).toContain("He said:");
    expect(out).toContain("wow");
  });

  it("preserves well-formed Orpheus tags through markdown stripping (closing > must survive)", () => {
    const out = prepareChatTextForSpeech("Szia! <chuckle> Újra itt vagy! Miben segíthetek?");
    expect(out).toMatch(/<chuckle>\s*Újra/);
    expect(out).not.toMatch(/<chuckle\s+Ú/);
  });

  it("strips nova tone markup including duplicate [nova:…] closers", () => {
    const raw =
      "Round two! Let's see if we can find the perfect rhythm for this voice. [nova:strong]How is the pacing?[nova:strong]";
    const out = prepareChatTextForSpeech(raw);
    expect(out).not.toMatch(/\[nova:/);
    expect(out).toContain("How is the pacing?");
  });
});
