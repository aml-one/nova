import { describe, expect, it } from "vitest";
import { extractOpenAiStreamToken } from "./openai-compatible.js";

describe("extractOpenAiStreamToken", () => {
  it("parses token from valid stream delta", () => {
    const token = extractOpenAiStreamToken(
      JSON.stringify({
        choices: [{ delta: { content: "Hello" } }]
      })
    );
    expect(token).toBe("Hello");
  });

  it("returns undefined for done marker", () => {
    expect(extractOpenAiStreamToken("[DONE]")).toBeUndefined();
  });

  it("returns undefined for malformed payload", () => {
    expect(extractOpenAiStreamToken("{bad-json")).toBeUndefined();
  });

  it("returns undefined when chunk has no content delta", () => {
    expect(extractOpenAiStreamToken(JSON.stringify({ choices: [{ delta: {} }] }))).toBeUndefined();
  });
});
