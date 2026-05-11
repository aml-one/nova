import { describe, expect, it } from "vitest";
import { detectHostTimeIntent, formatNovaLocalTimeSentence, tryParseHostClockOutput } from "./host-time.js";

describe("tryParseHostClockOutput", () => {
  it("parses PowerShell-style line with +HH:MM offset", () => {
    const d = tryParseHostClockOutput("2026-05-02 21:25:37 +03:00");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCHours()).toBe(18);
  });

  it("parses +HHMM offset", () => {
    const d = tryParseHostClockOutput("2026-05-02 21:25:37 +0300");
    expect(d).toBeInstanceOf(Date);
    expect(d?.getUTCHours()).toBe(18);
  });
});

describe("detectHostTimeIntent", () => {
  it("treats what-year questions as host-time intent", () => {
    expect(detectHostTimeIntent("What year is it?")).toBe(true);
    expect(detectHostTimeIntent("which year are we in")).toBe(true);
  });
});

describe("formatNovaLocalTimeSentence", () => {
  it("formats a single friendly sentence without machine or code fences", () => {
    const s = formatNovaLocalTimeSentence("2026-05-02 21:25:37 +03:00");
    expect(s).toMatch(/\d{1,2}:\d{2}/);
    expect(s).toMatch(/on .+2026\./);
    expect(s).not.toMatch(/machine/i);
    expect(s).not.toMatch(/```/);
  });
});
