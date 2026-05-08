import { getDatabase } from "../sqlite.js";

export type PersonRecord = {
  id: string;
  displayName?: string;
  aboutNotes?: string;
  rating: number;
  interestScore: number;
  rudenessScore: number;
  preferredChannel?: "web" | "signal" | "whatsapp";
  topics: string[];
  optedOut: boolean;
  blocked: boolean;
  createdAt?: string;
  updatedAt?: string;
};

function parseTopics(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (Array.isArray(parsed)) {
      return parsed.map((v) => (typeof v === "string" ? v : "")).filter((v) => v.trim().length > 0);
    }
    return [];
  } catch {
    return [];
  }
}

function normalizePreferredChannel(value: unknown): PersonRecord["preferredChannel"] {
  if (value === "web" || value === "signal" || value === "whatsapp") return value;
  return undefined;
}

export class PeopleRepository {
  getById(personId: string): PersonRecord | undefined {
    const db = getDatabase();
    const row = db
      .prepare(
        `
        SELECT
          id,
          display_name,
          about_notes,
          rating,
          interest_score,
          rudeness_score,
          preferred_channel,
          topics_json,
          opted_out,
          blocked,
          created_at,
          updated_at
        FROM people
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(personId) as
      | {
          id?: string;
          display_name?: string | null;
          about_notes?: string | null;
          rating?: number | null;
          interest_score?: number | null;
          rudeness_score?: number | null;
          preferred_channel?: string | null;
          topics_json?: string | null;
          opted_out?: number | null;
          blocked?: number | null;
          created_at?: string | null;
          updated_at?: string | null;
        }
      | undefined;

    if (!row?.id) return undefined;
    return {
      id: row.id,
      displayName: row.display_name ?? undefined,
      aboutNotes: row.about_notes ?? undefined,
      rating: clampInt(row.rating ?? 50, 0, 100),
      interestScore: clampNumber(row.interest_score ?? 0.5, 0, 1),
      rudenessScore: clampNumber(row.rudeness_score ?? 0, 0, 1),
      preferredChannel: normalizePreferredChannel(row.preferred_channel) ?? undefined,
      topics: parseTopics(row.topics_json),
      optedOut: Boolean(row.opted_out),
      blocked: Boolean(row.blocked),
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }

  list(limit = 200, offset = 0): PersonRecord[] {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const safeOffset = Math.max(0, Math.floor(offset));
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT
          id,
          display_name,
          about_notes,
          rating,
          interest_score,
          rudeness_score,
          preferred_channel,
          topics_json,
          opted_out,
          blocked,
          created_at,
          updated_at
        FROM people
        ORDER BY datetime(updated_at) DESC
        LIMIT ? OFFSET ?
        `
      )
      .all(safeLimit, safeOffset) as Array<Record<string, unknown>>;

    return rows
      .map((row): PersonRecord | undefined => {
        const id = typeof row.id === "string" ? row.id : "";
        if (!id) return undefined;

        const displayName = typeof row.display_name === "string" ? row.display_name : undefined;
        const aboutNotes = typeof row.about_notes === "string" ? row.about_notes : undefined;
        const createdAt = typeof row.created_at === "string" ? row.created_at : undefined;
        const updatedAt = typeof row.updated_at === "string" ? row.updated_at : undefined;

        return {
          id,
          ...(displayName ? { displayName } : {}),
          ...(aboutNotes ? { aboutNotes } : {}),
          rating: clampInt((row.rating as number | null | undefined) ?? 50, 0, 100),
          interestScore: clampNumber((row.interest_score as number | null | undefined) ?? 0.5, 0, 1),
          rudenessScore: clampNumber((row.rudeness_score as number | null | undefined) ?? 0, 0, 1),
          preferredChannel: normalizePreferredChannel(row.preferred_channel) ?? undefined,
          topics: parseTopics((row.topics_json as string | null | undefined) ?? null),
          optedOut: Boolean(row.opted_out),
          blocked: Boolean(row.blocked),
          ...(createdAt ? { createdAt } : {}),
          ...(updatedAt ? { updatedAt } : {})
        };
      })
      .filter(isDefined);
  }

  upsert(person: PersonRecord): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO people (
        id,
        display_name,
        about_notes,
        rating,
        interest_score,
        rudeness_score,
        preferred_channel,
        topics_json,
        opted_out,
        blocked,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(id) DO UPDATE SET
        display_name = excluded.display_name,
        about_notes = excluded.about_notes,
        rating = excluded.rating,
        interest_score = excluded.interest_score,
        rudeness_score = excluded.rudeness_score,
        preferred_channel = excluded.preferred_channel,
        topics_json = excluded.topics_json,
        opted_out = excluded.opted_out,
        blocked = excluded.blocked,
        updated_at = CURRENT_TIMESTAMP
      `
    ).run(
      person.id,
      person.displayName ?? null,
      person.aboutNotes ?? null,
      clampInt(person.rating ?? 50, 0, 100),
      clampNumber(person.interestScore ?? 0.5, 0, 1),
      clampNumber(person.rudenessScore ?? 0, 0, 1),
      person.preferredChannel ?? null,
      JSON.stringify(Array.isArray(person.topics) ? person.topics : []),
      person.optedOut ? 1 : 0,
      person.blocked ? 1 : 0
    );
  }

  setFlag(personId: string, flags: { optedOut?: boolean; blocked?: boolean }): void {
    const db = getDatabase();
    const current = this.getById(personId);
    if (!current) return;
    const next: PersonRecord = {
      ...current,
      optedOut: flags.optedOut ?? current.optedOut,
      blocked: flags.blocked ?? current.blocked
    };
    this.upsert(next);
  }
}

function clampInt(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? Math.floor(value) : min;
  return Math.max(min, Math.min(max, v));
}

function clampNumber(value: number, min: number, max: number): number {
  const v = Number.isFinite(value) ? value : min;
  return Math.max(min, Math.min(max, v));
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

