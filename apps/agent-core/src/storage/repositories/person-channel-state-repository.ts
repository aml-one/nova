import { getDatabase } from "../sqlite.js";

export type PersonChannel = "web" | "signal" | "whatsapp";

export type PersonChannelState = {
  personId: string;
  channel: PersonChannel;
  lastInboundAtMs?: number;
  lastOutboundAtMs?: number;
  unrepliedOutboundCount: number;
  cooldownUntilMs?: number;
  updatedAt?: string;
};

export class PersonChannelStateRepository {
  get(personId: string, channel: PersonChannel): PersonChannelState | undefined {
    const db = getDatabase();
    const row = db
      .prepare(
        `
        SELECT
          person_id,
          channel,
          last_inbound_at_ms,
          last_outbound_at_ms,
          unreplied_outbound_count,
          cooldown_until_ms,
          updated_at
        FROM person_channel_state
        WHERE person_id = ? AND channel = ?
        LIMIT 1
        `
      )
      .get(personId, channel) as
      | {
          person_id?: string;
          channel?: string;
          last_inbound_at_ms?: number | null;
          last_outbound_at_ms?: number | null;
          unreplied_outbound_count?: number | null;
          cooldown_until_ms?: number | null;
          updated_at?: string | null;
        }
      | undefined;
    if (!row?.person_id || !row.channel || !isChannel(row.channel)) return undefined;
    return {
      personId: row.person_id,
      channel: row.channel,
      lastInboundAtMs: typeof row.last_inbound_at_ms === "number" ? row.last_inbound_at_ms : undefined,
      lastOutboundAtMs: typeof row.last_outbound_at_ms === "number" ? row.last_outbound_at_ms : undefined,
      unrepliedOutboundCount: clampInt(row.unreplied_outbound_count ?? 0, 0, 1000000),
      cooldownUntilMs: typeof row.cooldown_until_ms === "number" ? row.cooldown_until_ms : undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }

  upsert(state: PersonChannelState): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO person_channel_state (
        person_id,
        channel,
        last_inbound_at_ms,
        last_outbound_at_ms,
        unreplied_outbound_count,
        cooldown_until_ms,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(person_id, channel) DO UPDATE SET
        last_inbound_at_ms = excluded.last_inbound_at_ms,
        last_outbound_at_ms = excluded.last_outbound_at_ms,
        unreplied_outbound_count = excluded.unreplied_outbound_count,
        cooldown_until_ms = excluded.cooldown_until_ms,
        updated_at = CURRENT_TIMESTAMP
      `
    ).run(
      state.personId,
      state.channel,
      state.lastInboundAtMs ?? null,
      state.lastOutboundAtMs ?? null,
      clampInt(state.unrepliedOutboundCount ?? 0, 0, 1000000),
      state.cooldownUntilMs ?? null
    );
  }

  recordInbound(personId: string, channel: PersonChannel, atMs = Date.now()): PersonChannelState {
    const current =
      this.get(personId, channel) ??
      ({
        personId,
        channel,
        unrepliedOutboundCount: 0
      } satisfies PersonChannelState);
    const next: PersonChannelState = {
      ...current,
      lastInboundAtMs: atMs,
      unrepliedOutboundCount: 0
    };
    this.upsert(next);
    return next;
  }

  recordOutbound(personId: string, channel: PersonChannel, atMs = Date.now()): PersonChannelState {
    const current =
      this.get(personId, channel) ??
      ({
        personId,
        channel,
        unrepliedOutboundCount: 0
      } satisfies PersonChannelState);
    const next: PersonChannelState = {
      ...current,
      lastOutboundAtMs: atMs,
      unrepliedOutboundCount: clampInt((current.unrepliedOutboundCount ?? 0) + 1, 0, 1000000)
    };
    this.upsert(next);
    return next;
  }

  setCooldown(personId: string, channel: PersonChannel, cooldownUntilMs: number | undefined): void {
    const current =
      this.get(personId, channel) ??
      ({
        personId,
        channel,
        unrepliedOutboundCount: 0
      } satisfies PersonChannelState);
    const next: PersonChannelState = {
      ...current,
      cooldownUntilMs
    };
    this.upsert(next);
  }
}

function isChannel(value: string): value is PersonChannel {
  return value === "web" || value === "signal" || value === "whatsapp";
}

function clampInt(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, v));
}

