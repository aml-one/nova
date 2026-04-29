import { describe, expect, it } from "vitest";
import {
  verifyInternalAuthHeader,
  verifySignalSignature,
  verifyWhatsAppSignature
} from "./webhook-verifier.js";

describe("webhook verification", () => {
  it("allows internal auth when token is absent", () => {
    expect(verifyInternalAuthHeader(undefined)).toBe(true);
  });

  it("accepts missing signatures when secrets are not configured", () => {
    expect(verifyWhatsAppSignature("{}", undefined)).toBe(true);
    expect(verifySignalSignature("{}", undefined)).toBe(true);
  });
});
