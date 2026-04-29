import { describe, expect, it } from "vitest";
import { evaluateCommandPolicy } from "./policy.js";

describe("evaluateCommandPolicy", () => {
  it("blocks destructive commands", () => {
    const decision = evaluateCommandPolicy("rm -rf /");
    expect(decision.allowed).toBe(false);
  });

  it("allows safe commands from allowlist", () => {
    const decision = evaluateCommandPolicy("echo hello");
    expect(decision.allowed).toBe(true);
  });
});
