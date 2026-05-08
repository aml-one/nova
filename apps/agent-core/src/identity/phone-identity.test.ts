import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { PhoneIdentityResolver } from "./phone-identity.js";

describe("PhoneIdentityResolver", () => {
  it("separates users by normalized phone number", () => {
    const resolver = new PhoneIdentityResolver();
    const first = resolver.resolve({ channel: "whatsapp", phoneNumber: " +1 (555) 123-4567 " });
    const second = resolver.resolve({ channel: "whatsapp", phoneNumber: "+15551234567" });
    expect(first).toBe(second);
  });

  it("keeps the same user across channels for same number", () => {
    const resolver = new PhoneIdentityResolver();
    const waUser = resolver.resolve({ channel: "whatsapp", phoneNumber: "+15557654321" });
    const signalUser = resolver.resolve({ channel: "signal", phoneNumber: "1 (555) 765-4321" });
    expect(waUser).toBe(signalUser);
  });

  it("maps a stable person id for the same web user id", () => {
    const resolver = new PhoneIdentityResolver();
    const first = resolver.resolve({ channel: "web", webUserId: "web-user-1" });
    const second = resolver.resolve({ channel: "web", webUserId: "web-user-1" });
    expect(first).toBe(second);
  });

  it("creates and reuses a person for Signal when only sealed-sender UUID is present (no E.164)", () => {
    const resolver = new PhoneIdentityResolver();
    const uuid = randomUUID();
    const first = resolver.resolve({ channel: "signal", signalUuid: uuid });
    const second = resolver.resolve({ channel: "signal", signalUuid: uuid });
    expect(first).toBe(second);
    expect(first.startsWith("person-")).toBe(true);
  });
});
