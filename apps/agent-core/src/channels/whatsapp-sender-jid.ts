import type { WAMessage, WASocket } from "@whiskeysockets/baileys";

type AugmentedKey = NonNullable<WAMessage["key"]> & {
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
  senderPn?: string | null;
};

/**
 * WhatsApp Baileys v7+ often uses `@lid` (privacy / Local ID) instead of `@s.whatsapp.net` (phone / PN).
 * Feeding the raw LID digits into E.164 access checks produces bogus "numbers" that never match allow lists.
 * Prefer `remoteJidAlt` / `participantAlt` (PN JIDs), then LID→PN cache on the socket when available.
 */
export async function resolveWhatsAppInboundSenderJid(msg: WAMessage, sock: WASocket): Promise<string> {
  const key = msg.key as AugmentedKey | undefined;
  if (!key) return "";

  const remoteJid = key.remoteJid ?? "";
  const participant = key.participant ?? "";

  // Group: sender is `participant` (often `@lid` in large groups).
  if (remoteJid.endsWith("@g.us")) {
    let sender = participant;
    if (sender.endsWith("@lid")) {
      const alt = key.participantAlt;
      if (typeof alt === "string" && alt.includes("@")) {
        sender = alt;
      }
    }
    if (!sender) return remoteJid;
    if (sender.endsWith("@lid")) {
      const pn = await tryLidJidToPnJid(sock, sender);
      if (pn) return pn;
    }
    return sender;
  }

  // DM / status / other: peer is `remoteJid`.
  let peer = remoteJid;
  if (peer.endsWith("@lid")) {
    const alt = key.remoteJidAlt;
    if (typeof alt === "string" && alt.includes("@")) {
      peer = alt;
    } else if (typeof key.senderPn === "string" && key.senderPn.includes("@")) {
      peer = key.senderPn;
    }
  }

  if (peer.endsWith("@lid")) {
    const pn = await tryLidJidToPnJid(sock, peer);
    if (pn) return pn;
  }

  return peer;
}

async function tryLidJidToPnJid(sock: WASocket, lidJid: string): Promise<string | null> {
  const lidMapping = (sock as unknown as { signalRepository?: { lidMapping?: Record<string, unknown> } }).signalRepository
    ?.lidMapping;
  if (!lidMapping || typeof lidMapping !== "object") return null;

  for (const name of ["getPNForLID", "getPnForLID", "getPNForLid", "getPnForLid"] as const) {
    const fn = lidMapping[name];
    if (typeof fn !== "function") continue;
    try {
      const result = await (fn as (j: string) => Promise<unknown>).call(lidMapping, lidJid);
      if (typeof result === "string" && result.includes("@")) return result;
    } catch {
      // Ignore mapping miss / API drift.
    }
  }

  return null;
}
