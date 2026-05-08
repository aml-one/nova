import { getDatabase } from "../sqlite.js";

export type PersonIdentityKind = "web_user_id" | "phone_e164" | "signal_uuid" | "whatsapp_phone_e164";

export type PersonIdentityRecord = {
  id: number;
  personId: string;
  kind: PersonIdentityKind;
  value: string;
  createdAt?: string;
};

export class PersonIdentitiesRepository {
  findPersonIdByIdentity(kind: PersonIdentityKind, value: string): string | undefined {
    const db = getDatabase();
    const row = db
      .prepare("SELECT person_id FROM person_identities WHERE kind = ? AND value = ? LIMIT 1")
      .get(kind, value) as { person_id?: string } | undefined;
    return row?.person_id;
  }

  listIdentitiesForPerson(personId: string): PersonIdentityRecord[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT id, person_id, kind, value, created_at
        FROM person_identities
        WHERE person_id = ?
        ORDER BY id ASC
        `
      )
      .all(personId) as Array<{
      id?: number;
      person_id?: string;
      kind?: string;
      value?: string;
      created_at?: string;
    }>;
    return rows
      .map((r): PersonIdentityRecord | undefined => {
        if (typeof r.id !== "number" || !r.person_id || !r.kind || !r.value) return undefined;
        if (!isKind(r.kind)) return undefined;
        const createdAt = typeof r.created_at === "string" ? r.created_at : undefined;
        return {
          id: r.id,
          personId: r.person_id,
          kind: r.kind,
          value: r.value,
          ...(createdAt ? { createdAt } : {})
        };
      })
      .filter(isDefined);
  }

  upsertIdentity(personId: string, kind: PersonIdentityKind, value: string): { ok: true } | { ok: false; reason: "conflict" } {
    const db = getDatabase();
    // Enforce global uniqueness by (kind,value). If it exists, it must already belong to the same person.
    const existing = db
      .prepare("SELECT person_id FROM person_identities WHERE kind = ? AND value = ? LIMIT 1")
      .get(kind, value) as { person_id?: string } | undefined;
    if (existing?.person_id && existing.person_id !== personId) {
      return { ok: false, reason: "conflict" };
    }
    db.prepare(
      `
      INSERT OR IGNORE INTO person_identities (person_id, kind, value)
      VALUES (?, ?, ?)
      `
    ).run(personId, kind, value);
    return { ok: true };
  }

  deleteIdentity(kind: PersonIdentityKind, value: string): void {
    const db = getDatabase();
    db.prepare("DELETE FROM person_identities WHERE kind = ? AND value = ?").run(kind, value);
  }
}

function isKind(value: string): value is PersonIdentityKind {
  return value === "web_user_id" || value === "phone_e164" || value === "signal_uuid" || value === "whatsapp_phone_e164";
}

function isDefined<T>(value: T | null | undefined): value is T {
  return value !== null && value !== undefined;
}

