import { randomUUID } from "node:crypto";
import { getDatabase } from "../sqlite.js";

export type PersonProfileEvent = {
  id: string;
  personId: string;
  eventType: string;
  payload: Record<string, unknown>;
  createdAt?: string;
};

export class PersonProfileEventsRepository {
  append(personId: string, eventType: string, payload: Record<string, unknown>): PersonProfileEvent {
    const id = randomUUID();
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO person_profile_events (id, person_id, event_type, payload_json)
      VALUES (?, ?, ?, ?)
      `
    ).run(id, personId, eventType.trim() || "event", JSON.stringify(payload ?? {}));
    return { id, personId, eventType: eventType.trim() || "event", payload };
  }

  list(personId: string, limit = 100): PersonProfileEvent[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT id, person_id, event_type, payload_json, created_at
        FROM person_profile_events
        WHERE person_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
        `
      )
      .all(personId, safeLimit) as Array<{
      id?: string;
      person_id?: string;
      event_type?: string;
      payload_json?: string;
      created_at?: string;
    }>;
    return rows
      .map((r) => {
        if (!r.id || !r.person_id || !r.event_type) return undefined;
        return {
          id: r.id,
          personId: r.person_id,
          eventType: r.event_type,
          payload: safeParseJson(r.payload_json) ?? {},
          createdAt: r.created_at
        } satisfies PersonProfileEvent;
      })
      .filter((v): v is PersonProfileEvent => Boolean(v));
  }
}

function safeParseJson(value: string | undefined): Record<string, unknown> | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

