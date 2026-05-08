import { describe, expect, it } from "vitest";
import { formatAdminRelayPayload } from "./format-admin-relay-payload.js";

describe("formatAdminRelayPayload", () => {
  it("formats social-practice nudge like the Anita relay example", () => {
    const out = formatAdminRelayPayload({
      recipientDisplayName: "Anita",
      senderDisplayName: "Ambrus",
      rawMessage: "keep talking to you, so you can practice social skills.. :)",
      relationshipConfirmed: false
    });
    expect(out).toBe(
      "Anita, Ambrus asked me to tell you to please keep the conversation going! I definitely need all the practice I can get."
    );
  });

  it("uses remind phrasing when relationship is confirmed", () => {
    const out = formatAdminRelayPayload({
      recipientDisplayName: "Anita",
      senderDisplayName: "Ambrus",
      rawMessage: "keep talking to you, so you can practice social skills",
      relationshipConfirmed: true
    });
    expect(out).toContain("Anita, Ambrus asked me to remind you:");
    expect(out).toContain("please keep the conversation going!");
  });

  it("rewrites talking-to-you for generic bodies", () => {
    const out = formatAdminRelayPayload({
      recipientDisplayName: "Bob",
      senderDisplayName: "Sam Jones",
      rawMessage: "call me after talking to you tomorrow",
      relationshipConfirmed: false
    });
    expect(out.startsWith("Bob, Sam Jones asked me to tell you to")).toBe(true);
    expect(out).toContain("talking with Nova");
  });
});
