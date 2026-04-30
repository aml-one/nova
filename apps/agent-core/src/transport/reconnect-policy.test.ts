import { describe, expect, it } from "vitest";
import { nextReconnectDelayMs, shouldResetBackoff } from "./reconnect-policy.js";

describe("reconnect policy", () => {
  it("grows exponentially and caps at max", () => {
    expect(nextReconnectDelayMs(0)).toBe(1000);
    expect(nextReconnectDelayMs(1)).toBe(2000);
    expect(nextReconnectDelayMs(2)).toBe(4000);
    expect(nextReconnectDelayMs(10)).toBe(20000);
  });

  it("normalizes negative attempts", () => {
    expect(nextReconnectDelayMs(-3)).toBe(1000);
  });

  it("resets backoff only after stable connection window", () => {
    expect(shouldResetBackoff(10000)).toBe(false);
    expect(shouldResetBackoff(30000)).toBe(true);
    expect(shouldResetBackoff(60000)).toBe(true);
  });
});
