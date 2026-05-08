import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseNaturalLanguageCallMe, parseSignalWalkieCallCommand } from "./signal-walkie-call-session.js";

describe("signal-walkie-call-session", () => {
  it("parseSignalWalkieCallCommand does not treat 'nova call me' as slash /call", () => {
    expect(parseSignalWalkieCallCommand("nova call me")).toBeNull();
  });

  it("parseSignalWalkieCallCommand treats /phone like /call", () => {
    expect(parseSignalWalkieCallCommand("/phone")).toEqual({ remainder: "" });
    expect(parseSignalWalkieCallCommand("/phone hey there")).toEqual({ remainder: "hey there" });
  });

  it("parseNaturalLanguageCallMe handles immediate phrases", () => {
    expect(parseNaturalLanguageCallMe("call me")).toEqual({ kind: "immediate" });
    expect(parseNaturalLanguageCallMe("Hey Nova call me")).toEqual({ kind: "immediate" });
    expect(parseNaturalLanguageCallMe("phone me")).toEqual({ kind: "immediate" });
    expect(parseNaturalLanguageCallMe("give me a call")).toEqual({ kind: "immediate" });
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

  it("parseNaturalLanguageCallMe handles in an hour / half hour", () => {
    expect(parseNaturalLanguageCallMe("call me in an hour")).toEqual({
      kind: "in_ms",
      delayMs: 3600_000,
      label: "in 1 hour"
    });
    expect(parseNaturalLanguageCallMe("call me in half an hour")?.kind).toBe("in_ms");
    const half = parseNaturalLanguageCallMe("call me in half an hour");
    if (half?.kind === "in_ms") expect(half.delayMs).toBe(30 * 60_000);
  });

  describe("weekday scheduling (local time)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date(2026, 4, 4, 10, 0, 0));
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it("same weekday later today", () => {
      const r = parseNaturalLanguageCallMe("call me monday at 3pm");
      expect(r?.kind).toBe("at");
      if (r?.kind === "at") {
        const d = new Date(r.whenMs);
        expect(d.getDay()).toBe(1);
        expect(d.getHours()).toBe(15);
      }
    });

    it("next monday skips today", () => {
      const r = parseNaturalLanguageCallMe("call me next monday at 9am");
      expect(r?.kind).toBe("at");
      if (r?.kind === "at") {
        const d = new Date(r.whenMs);
        expect(d.getDay()).toBe(1);
        expect(d.getDate()).toBe(11);
        expect(d.getHours()).toBe(9);
      }
    });
  });
});
