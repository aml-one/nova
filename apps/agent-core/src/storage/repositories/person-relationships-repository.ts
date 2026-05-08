import { getDatabase } from "../sqlite.js";

export type PersonRelationshipStatus = "pending" | "confirmed" | "rejected";
export type PersonRelationship = {
  aPersonId: string;
  bPersonId: string;
  relation: string;
  status: PersonRelationshipStatus;
  notes?: string;
  createdAt?: string;
  updatedAt?: string;
};

export class PersonRelationshipsRepository {
  get(aPersonId: string, bPersonId: string, relation: string): PersonRelationship | undefined {
    const db = getDatabase();
    const row = db
      .prepare(
        `
        SELECT a_person_id, b_person_id, relation, status, notes, created_at, updated_at
        FROM person_relationships
        WHERE a_person_id = ? AND b_person_id = ? AND relation = ?
        LIMIT 1
        `
      )
      .get(aPersonId, bPersonId, relation) as
      | {
          a_person_id?: string;
          b_person_id?: string;
          relation?: string;
          status?: string;
          notes?: string | null;
          created_at?: string | null;
          updated_at?: string | null;
        }
      | undefined;
    if (!row?.a_person_id || !row.b_person_id || !row.relation || !isStatus(row.status)) return undefined;
    return {
      aPersonId: row.a_person_id,
      bPersonId: row.b_person_id,
      relation: row.relation,
      status: row.status,
      notes: row.notes ?? undefined,
      createdAt: row.created_at ?? undefined,
      updatedAt: row.updated_at ?? undefined
    };
  }

  upsert(rel: Omit<PersonRelationship, "createdAt" | "updatedAt">): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO person_relationships (a_person_id, b_person_id, relation, status, notes, updated_at)
      VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(a_person_id, b_person_id, relation) DO UPDATE SET
        status = excluded.status,
        notes = excluded.notes,
        updated_at = CURRENT_TIMESTAMP
      `
    ).run(rel.aPersonId, rel.bPersonId, rel.relation, rel.status, rel.notes ?? null);
  }

  setMutual(aPersonId: string, bPersonId: string, relation: string, status: PersonRelationshipStatus, notes?: string): void {
    this.upsert({ aPersonId, bPersonId, relation, status, notes });
    this.upsert({ aPersonId: bPersonId, bPersonId: aPersonId, relation, status, notes });
  }
}

function isStatus(value: unknown): value is PersonRelationshipStatus {
  return value === "pending" || value === "confirmed" || value === "rejected";
}

