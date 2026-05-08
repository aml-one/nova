import { describe, expect, it } from "vitest";
import { normalizeWhatsAppRecipientJid } from "./whatsapp-voice-utils.js";

describe("normalizeWhatsAppRecipientJid", () => {
  it("strips whatsapp: prefix and adds @s.whatsapp.net", () => {
    expect(normalizeWhatsAppRecipientJid("whatsapp:+16316378861")).toBe("16316378861@s.whatsapp.net");
  });

  it("passes through full @s.whatsapp.net jid", () => {
    expect(normalizeWhatsAppRecipientJid("16316378861@s.whatsapp.net")).toBe("16316378861@s.whatsapp.net");
  });

  it("handles digits only", () => {
    expect(normalizeWhatsAppRecipientJid("+1 631 637 8861")).toBe("16316378861@s.whatsapp.net");
  });
});
