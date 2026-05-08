import { describe, expect, it } from "vitest";
import { parseNaturalLanguageCallMe, parseSignalWalkieCallCommand } from "./signal-walkie-call-session.js";

describe("signal-walkie-call-session", () => {
  it("parseSignalWalkieCallCommand does not treat 'nova call me' as slash /call", () => {
    expect(parseSignalWalkieCallCommand("nova call me")).toBeNull();
  });

  it("parseNaturalLanguageCallMe handles immediate phrases", () => {
    expect(parseNaturalLanguageCallMe("call me")).toEqual({ kind: "immediate" });
    expect(parseNaturalLanguageCallMe("Hey Nova call me")).toEqual({ kind: "immediate" });
  });

  it("parseNaturalLanguageCallMe handles in N minutes", () => {
    const r = parseNaturalLanguageCallMe("call me in 20 minutes");
    expect(r?.kind).toBe("in_ms");
    if (r?.kind === "in_ms") {
      expect(r.delayMs).toBe(20 * 60_000);
      expect(r.label).toMatch(/minute/);
    }
  });

  it("parseNaturalLanguageCallMe handles tomorrow clock", () => {
    const r = parseNaturalLanguageCallMe("call me tomorrow at 3pm");
    expect(r?.kind).toBe("at");
    if (r?.kind === "at") {
      expect(r.whenMs).toBeGreaterThan(Date.now());
    }
  });
});
