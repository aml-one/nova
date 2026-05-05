import { randomUUID } from "node:crypto";
import { sqliteUtcDatetimeToIso } from "../../util/sqlite-timestamp.js";
import { getDatabase } from "../sqlite.js";

export type ThoughtCategory = "chat" | "learning" | "system";

export class ThoughtRepository {
  append(input: {
    category: ThoughtCategory;
    title: string;
    content: string;
    metadata?: Record<string, unknown>;
  }): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO thought_events (id, category, title, content, metadata)
        VALUES (?, ?, ?, ?, ?)
        `
      )
      .run(randomUUID(), input.category, input.title, input.content, JSON.stringify(input.metadata ?? {}));
  }

  countByCategory(): { chat: number; learning: number; system: number } {
    const rows = getDatabase()
      .prepare(
        `
        SELECT category, COUNT(*) AS c
        FROM thought_events
        GROUP BY category
        `
      )
      .all() as Array<{ category?: string; c?: number }>;
    const out = { chat: 0, learning: 0, system: 0 };
    for (const row of rows) {
      const cat = toCategory(row.category);
      const n = Number(row.c ?? 0);
      if (!Number.isFinite(n) || n < 0) continue;
      if (cat === "chat") out.chat += n;
      else if (cat === "learning") out.learning += n;
      else out.system += n;
    }
    return out;
  }

  list(limit = 300): Array<{
    id: string;
    category: ThoughtCategory;
    title: string;
    content: string;
    metadata?: unknown;
    createdAt: string;
  }> {
    const safeLimit = Math.max(1, Math.min(1000, Math.floor(limit)));
    const rows = getDatabase()
      .prepare(
        `
        SELECT id, category, title, content, metadata, created_at
        FROM thought_events
        ORDER BY datetime(created_at) DESC
        LIMIT ?
        `
      )
      .all(safeLimit) as Array<Record<string, unknown>>;
    return rows.map((row) => ({
      id: String(row.id ?? ""),
      category: toCategory(row.category),
      title: String(row.title ?? ""),
      content: String(row.content ?? ""),
      metadata: parseJson(row.metadata),
      createdAt: sqliteUtcDatetimeToIso(String(row.created_at ?? ""))
    }));
  }
}

function toCategory(value: unknown): ThoughtCategory {
  if (value === "learning" || value === "system") {
    return value;
  }
  return "chat";
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
