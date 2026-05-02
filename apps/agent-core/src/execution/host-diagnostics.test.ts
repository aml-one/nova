import { describe, expect, it } from "vitest";
import { detectHostDiagnosticsIntent } from "./host-diagnostics.js";

describe("detectHostDiagnosticsIntent", () => {
  it("detects cpu check phrasing", () => {
    expect(detectHostDiagnosticsIntent("can you check your computer's CPU usage?")).toBe("cpu");
    expect(detectHostDiagnosticsIntent("what is my CPU?")).toBe("cpu");
  });

  it("detects memory questions", () => {
    expect(detectHostDiagnosticsIntent("how much RAM am I using")).toBe("memory");
  });

  it("detects gpu questions", () => {
    expect(detectHostDiagnosticsIntent("check GPU load")).toBe("gpu");
  });

  it("returns full when several hardware topics appear", () => {
    expect(detectHostDiagnosticsIntent("check CPU and RAM on this machine")).toBe("full");
  });

  it("matches hardware usage phrasing", () => {
    expect(detectHostDiagnosticsIntent("hardware usage")).toBe("full");
  });

  it("skips conceptual definitions", () => {
    expect(detectHostDiagnosticsIntent("what is a CPU")).toBeNull();
    expect(detectHostDiagnosticsIntent("explain RAM")).toBeNull();
  });

  it("returns null for unrelated chat", () => {
    expect(detectHostDiagnosticsIntent("write a haiku about spring")).toBeNull();
  });
});
