import { describe, expect, it } from "vitest";
import { formatOrpheusAuthorizationHeader, normalizeOrpheusBaseUrl } from "./orpheus-http.js";

describe("normalizeOrpheusBaseUrl", () => {
  it("strips trailing slashes", () => {
    expect(normalizeOrpheusBaseUrl("http://127.0.0.1:5005/")).toBe("http://127.0.0.1:5005");
  });

  it("strips a single trailing /v1 (OpenWebUI-style paste)", () => {
    expect(normalizeOrpheusBaseUrl("http://127.0.0.1:5005/v1")).toBe("http://127.0.0.1:5005");
    expect(normalizeOrpheusBaseUrl("http://nova:5005/v1/")).toBe("http://nova:5005");
  });
});

describe("formatOrpheusAuthorizationHeader", () => {
  it("returns undefined for empty", () => {
    expect(formatOrpheusAuthorizationHeader("  ")).toBeUndefined();
  });

  it("prefixes Bearer when missing", () => {
    expect(formatOrpheusAuthorizationHeader("sk-test")).toBe("Bearer sk-test");
  });

  it("does not double Bearer and normalizes scheme casing", () => {
    expect(formatOrpheusAuthorizationHeader("Bearer secret")).toBe("Bearer secret");
    expect(formatOrpheusAuthorizationHeader("bearer secret")).toBe("Bearer secret");
  });
});
