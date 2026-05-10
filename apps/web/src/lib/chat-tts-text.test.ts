import { describe, expect, it } from "vitest";
import { CHAT_TTS_CHUNK_HARD_MAX, splitLongTtsSegment, splitTextForTts } from "./chat-tts-text";

describe("splitLongTtsSegment", () => {
  it("returns a single chunk when under the limit", () => {
    expect(splitLongTtsSegment("Rövid magyar szöveg.", 340)).toEqual(["Rövid magyar szöveg."]);
  });

  it("splits long unpunctuated text on spaces", () => {
    const word = "szó ";
    const body = word.repeat(120).trim();
    expect(body.length).toBeGreaterThan(CHAT_TTS_CHUNK_HARD_MAX);
    const parts = splitLongTtsSegment(body, CHAT_TTS_CHUNK_HARD_MAX);
    expect(parts.length).toBeGreaterThan(1);
    expect(parts.every((p) => p.length <= CHAT_TTS_CHUNK_HARD_MAX)).toBe(true);
    expect(parts.join(" ").replace(/\s+/g, " ").trim()).toBe(body);
  });
});

describe("splitTextForTts", () => {
  it("splits on unicode ellipsis", () => {
    const a = "Első mondat… ";
    const b = "Második rész itt van.";
    const chunks = splitTextForTts(`${a}${b}`);
    expect(chunks.length).toBeGreaterThanOrEqual(1);
    expect(chunks.join(" ")).toContain("Első");
    expect(chunks.join(" ")).toContain("Második");
  });
});
