import { describe, expect, it } from "vitest";
import type { WAMessage, WASocket } from "@whiskeysockets/baileys";
import { resolveWhatsAppInboundSenderJid } from "./whatsapp-sender-jid.js";

function mockSockWithMapping(map: Record<string, string>): WASocket {
  return {
    signalRepository: {
      lidMapping: {
        getPNForLID: async (jid: string) => map[jid] ?? null
      }
    }
  } as unknown as WASocket;
}

function emptySock(): WASocket {
  return {} as unknown as WASocket;
}

describe("resolveWhatsAppInboundSenderJid", () => {
  it("keeps @s.whatsapp.net DM peer as-is", async () => {
    const msg = {
      key: { remoteJid: "16316378861@s.whatsapp.net" }
    } as WAMessage;
    await expect(resolveWhatsAppInboundSenderJid(msg, emptySock())).resolves.toBe("16316378861@s.whatsapp.net");
  });

  it("uses remoteJidAlt when remoteJid is @lid (DM)", async () => {
    const msg = {
      key: {
        remoteJid: "130068890255560@lid",
        remoteJidAlt: "16316378861@s.whatsapp.net"
      }
    } as WAMessage;
    await expect(resolveWhatsAppInboundSenderJid(msg, emptySock())).resolves.toBe("16316378861@s.whatsapp.net");
  });

  it("uses senderPn when present for @lid DM", async () => {
    const msg = {
      key: {
        remoteJid: "130068890255560@lid",
        senderPn: "16316378861@s.whatsapp.net"
      }
    } as WAMessage;
    await expect(resolveWhatsAppInboundSenderJid(msg, emptySock())).resolves.toBe("16316378861@s.whatsapp.net");
  });

  it("uses participantAlt for @lid group senders when available", async () => {
    const msg = {
      key: {
        remoteJid: "120363001234567890@g.us",
        participant: "999999999999999@lid",
        participantAlt: "16316378861@s.whatsapp.net"
      }
    } as WAMessage;
    await expect(resolveWhatsAppInboundSenderJid(msg, emptySock())).resolves.toBe("16316378861@s.whatsapp.net");
  });

  it("falls back to lidMapping getPNForLID when Alt is missing", async () => {
    const lid = "130068890255560@lid";
    const pn = "16316378861@s.whatsapp.net";
    const msg = { key: { remoteJid: lid } } as WAMessage;
    await expect(resolveWhatsAppInboundSenderJid(msg, mockSockWithMapping({ [lid]: pn }))).resolves.toBe(pn);
  });
});
