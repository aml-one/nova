import { getDatabase } from "../sqlite.js";

export class PersonFieldLocksRepository {
  isLocked(personId: string, field: string): boolean {
    const db = getDatabase();
    const row = db
      .prepare("SELECT locked FROM person_field_locks WHERE person_id = ? AND field = ? LIMIT 1")
      .get(personId, field) as { locked?: number } | undefined;
    return Boolean(row?.locked);
  }

  listLockedFields(personId: string): string[] {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT field FROM person_field_locks WHERE person_id = ? AND locked = 1")
      .all(personId) as Array<{ field?: string }>;
    return rows.map((r) => (typeof r.field === "string" ? r.field : "")).filter((v) => v.trim().length > 0);
  }

  setLocked(personId: string, field: string, locked: boolean): void {
    const f = field.trim();
    if (!f) return;
    const db = getDatabase();
    if (!locked) {
      db.prepare("DELETE FROM person_field_locks WHERE person_id = ? AND field = ?").run(personId, f);
      return;
    }
    db.prepare(
      `
      INSERT INTO person_field_locks (person_id, field, locked, updated_at)
      VALUES (?, ?, 1, CURRENT_TIMESTAMP)
      ON CONFLICT(person_id, field) DO UPDATE SET
        locked = 1,
        updated_at = CURRENT_TIMESTAMP
      `
    ).run(personId, f);
  }
}

