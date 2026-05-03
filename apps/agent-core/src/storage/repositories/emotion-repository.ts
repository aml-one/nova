import { randomUUID } from "node:crypto";
import { sqliteUtcDatetimeToIso } from "../../util/sqlite-timestamp.js";
import { getDatabase } from "../sqlite.js";

export type EmotionStateRecord = {
  userId: string;
  valence: number;
  arousal: number;
  label: string;
  updatedAt?: string;
};

export class EmotionRepository {
  get(userId: string): EmotionStateRecord | undefined {
    const row = getDatabase()
      .prepare("SELECT user_id, valence, arousal, label, updated_at FROM emotion_state WHERE user_id = ? LIMIT 1")
      .get(userId) as
      | {
          user_id?: string;
          valence?: number;
          arousal?: number;
          label?: string;
          updated_at?: string;
        }
      | undefined;
    if (!row?.user_id || typeof row.valence !== "number" || typeof row.arousal !== "number" || !row.label) {
      return undefined;
    }
    return {
      userId: row.user_id,
      valence: row.valence,
      arousal: row.arousal,
      label: row.label,
      updatedAt: row.updated_at
    };
  }

  upsert(state: EmotionStateRecord): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO emotion_state (user_id, valence, arousal, label, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(user_id) DO UPDATE SET
          valence = excluded.valence,
          arousal = excluded.arousal,
          label = excluded.label,
          updated_at = CURRENT_TIMESTAMP
        `
      )
      .run(state.userId, state.valence, state.arousal, state.label);
  }

  appendEvent(input: {
    userId: string;
    source: string;
    trigger: string;
    valence: number;
    arousal: number;
    label: string;
    metadata?: Record<string, unknown>;
  }): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO emotion_events (id, user_id, source, trigger, valence, arousal, label, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        randomUUID(),
        input.userId,
        input.source,
        input.trigger,
        input.valence,
        input.arousal,
        input.label,
        JSON.stringify(input.metadata ?? {})
      );
  }

  listEvents(userId?: string): Array<{
    id: string;
    userId: string;
    source: string;
    trigger: string;
    valence: number;
    arousal: number;
    label: string;
    metadata?: unknown;
    createdAt: string;
  }> {
    const rows = userId
      ? (getDatabase()
          .prepare(
            `
            SELECT id, user_id, source, trigger, valence, arousal, label, metadata, created_at
            FROM emotion_events
            WHERE user_id = ?
            ORDER BY datetime(created_at) DESC
            LIMIT 500
            `
          )
          .all(userId) as Array<Record<string, unknown>>)
      : (getDatabase()
          .prepare(
            `
            SELECT id, user_id, source, trigger, valence, arousal, label, metadata, created_at
            FROM emotion_events
            ORDER BY datetime(created_at) DESC
            LIMIT 500
            `
          )
          .all() as Array<Record<string, unknown>>);
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      userId: String(row.user_id ?? ""),
      source: String(row.source ?? ""),
      trigger: String(row.trigger ?? ""),
      valence: Number(row.valence ?? 0),
      arousal: Number(row.arousal ?? 0),
      label: String(row.label ?? "neutral"),
      metadata: parseJson(row.metadata),
      createdAt: sqliteUtcDatetimeToIso(String(row.created_at ?? ""))
    }));
  }
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
