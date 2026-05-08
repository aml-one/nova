import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";

/** One-shot Signal walkie “ring” (greeting voice note) at `fire_at_ms`. */
export function insertSignalDeferredRing(input: { recipient: string; fireAtMs: number; note?: string }): string {
  const id = randomUUID();
  const db = getDatabase();
  db.prepare(
    `
    INSERT INTO signal_deferred_rings (id, recipient, fire_at_ms, note)
    VALUES (?, ?, ?, ?)
    `
  ).run(id, input.recipient.trim(), Math.floor(input.fireAtMs), input.note?.trim() ?? null);
  return id;
}

export function claimDueSignalDeferredRings(nowMs: number): Array<{ id: string; recipient: string }> {
  const db = getDatabase();
  const out: Array<{ id: string; recipient: string }> = [];
  db.exec("BEGIN IMMEDIATE");
  try {
    const rows = db
      .prepare(
        `
        SELECT id, recipient
        FROM signal_deferred_rings
        WHERE fire_at_ms <= ?
        ORDER BY fire_at_ms ASC
        LIMIT 25
        `
      )
      .all(Math.floor(nowMs)) as Array<{ id: string; recipient: string }>;
    const del = db.prepare(`DELETE FROM signal_deferred_rings WHERE id = ?`);
    for (const row of rows) {
      del.run(row.id);
      out.push({ id: row.id, recipient: row.recipient });
    }
    db.exec("COMMIT");
  } catch {
    try {
      db.exec("ROLLBACK");
    } catch {
      /* ignore */
    }
  }
  return out;
}
