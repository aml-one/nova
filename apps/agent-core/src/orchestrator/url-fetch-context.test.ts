import { describe, expect, it } from "vitest";
import {
  extractUrlFromSlashFetchCommand,
  pickUrlToAutoFetch,
  shouldAutoFetchUrlFromMessage
} from "./url-fetch-context.js";

describe("url-fetch-context", () => {
  it("parses /fetch and /url commands", () => {
    expect(pickUrlToAutoFetch("/fetch https://example.com/a")).toBe("https://example.com/a");
    expect(pickUrlToAutoFetch("/url https://imdb.com/title/tt1")).toBe("https://imdb.com/title/tt1");
  });

  it("detects IMDb paste with explanation", () => {
    const msg =
      "Then something is not working with web search. Here is the page for that move, check it out:\nhttps://www.imdb.com/title/tt33612209";
    expect(shouldAutoFetchUrlFromMessage(msg)).toBe(true);
    expect(pickUrlToAutoFetch(msg)).toBe("https://www.imdb.com/title/tt33612209");
  });

  it("does not fetch random docs URLs in long rants without cues", () => {
    const long =
      "We should refactor the module see https://example.com/docs and also think about tests and deployment and monitoring and more text " +
      "so the heuristic does not treat this as a short link-only paste because the non-url part is definitely longer than ninety chars total.";
    expect(shouldAutoFetchUrlFromMessage(long)).toBe(false);
  });
});
