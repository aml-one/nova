import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";
import { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";

const identities = new PersonIdentitiesRepository();

/** Same routing as TaskOrchestrator.pickBestOutboundIdentity — where to DM this person. */
export function pickOutboundForPerson(personId: string): { channel: "signal" | "whatsapp"; recipient: string } | undefined {
  const ids = identities.listIdentitiesForPerson(personId);
  const wa = ids.find((i) => i.kind === "whatsapp_phone_e164")?.value;
  const sig = ids.find((i) => i.kind === "phone_e164")?.value;
  const sigUuid = ids.find((i) => i.kind === "signal_uuid")?.value;
  if (sig) return { channel: "signal", recipient: sig };
  if (sigUuid) return { channel: "signal", recipient: sigUuid };
  if (wa) return { channel: "whatsapp", recipient: wa };
  return undefined;
}

export function enqueueOutboundMessage(channel: "signal" | "whatsapp", recipient: string, payload: string): void {
  const r = recipient.trim();
  if (!r) return;
  getDatabase()
    .prepare(
      `INSERT INTO outbound_queue (channel, recipient, payload, attempts, next_attempt_at, status, correlation_id)
       VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, 'pending', ?)`
    )
    .run(channel, r, payload.slice(0, 4096), randomUUID());
}
