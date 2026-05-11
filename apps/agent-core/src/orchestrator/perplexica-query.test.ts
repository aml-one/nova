import { describe, expect, it } from "vitest";
import { resolvePerplexicaSearchQuery } from "./perplexica-query.js";

describe("resolvePerplexicaSearchQuery", () => {
  it("strips /web and insists", () => {
    const r = resolvePerplexicaSearchQuery("/web  dolphins migration", "web");
    expect(r.query).toBe("dolphins migration");
    expect(r.insistedWeb).toBe(true);
  });

  it("treats verification phrasing as insisted", () => {
    expect(resolvePerplexicaSearchQuery("check again — was that director right?", "web").insistedWeb).toBe(true);
    expect(resolvePerplexicaSearchQuery("you are wrong about the release year", "web").insistedWeb).toBe(true);
    expect(resolvePerplexicaSearchQuery("can you confirm the IMDb rating?", "signal").insistedWeb).toBe(true);
  });

  it("does not insist for soft current-events questions", () => {
    const r = resolvePerplexicaSearchQuery("What is the latest news on the volcano?", "web");
    expect(r.query).toBeDefined();
    expect(r.insistedWeb).toBe(false);
  });

  it("fires external-fact heuristic on web only", () => {
    const web = resolvePerplexicaSearchQuery("What is the rating for tt0133093 on IMDb?", "web");
    expect(web.query).toBeDefined();
    expect(web.insistedWeb).toBe(false);

    const signal = resolvePerplexicaSearchQuery("What is the rating for tt0133093 on IMDb?", "signal");
    expect(signal.query).toBeUndefined();
  });

  it("returns nothing for vague chit-chat", () => {
    expect(resolvePerplexicaSearchQuery("hey how are you", "web").query).toBeUndefined();
  });
});
