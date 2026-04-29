import type { ChatMessage } from "@nova/sdk/provider";
import { getDatabase } from "../sqlite.js";
import type { MemoryFact } from "../../memory/long-term-store.js";

export class MemoryRepository {
  appendTurn(userId: string, role: ChatMessage["role"], content: string): void {
    const db = getDatabase();
    db.prepare("INSERT INTO short_term_turns (user_id, role, content) VALUES (?, ?, ?)").run(userId, role, content);
  }

  trimShortTerm(userId: string, keep = 12): void {
    const db = getDatabase();
    db.prepare(
      `
      DELETE FROM short_term_turns
      WHERE id IN (
        SELECT id
        FROM short_term_turns
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT -1 OFFSET ?
      )
      `
    ).run(userId, keep);
  }

  getRecent(userId: string, limit = 12): ChatMessage[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT role, content
        FROM short_term_turns
        WHERE user_id = ?
        ORDER BY id DESC
        LIMIT ?
        `
      )
      .all(userId, limit) as Array<{ role: ChatMessage["role"]; content: string }>;
    return [...rows].reverse();
  }

  addLongTerm(userId: string, fact: MemoryFact): void {
    const db = getDatabase();
    db.prepare("INSERT INTO long_term_memory (user_id, kind, content) VALUES (?, ?, ?)").run(
      userId,
      fact.type,
      fact.content
    );
  }

  getLongTerm(userId: string): MemoryFact[] {
    const db = getDatabase();
    const rows = db
      .prepare("SELECT kind, content FROM long_term_memory WHERE user_id = ? ORDER BY id DESC")
      .all(userId) as Array<{ kind: MemoryFact["type"]; content: string }>;
    return rows.map((row) => ({ type: row.kind, content: row.content }));
  }
}
