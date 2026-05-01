import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { sqliteUtcDatetimeToIso } from "../util/sqlite-timestamp.js";
import { getDatabase } from "../storage/sqlite.js";

export class PersonaVersionService {
  list(personaId: string, options?: { rewritesOnly?: boolean }): Array<{ version: number; createdAt: string }> {
    const db = getDatabase();
    const rows = db
      .prepare(
        "SELECT version, created_at as createdAt, content FROM persona_versions WHERE persona_id = ? ORDER BY version DESC LIMIT 300"
      )
      .all(personaId) as Array<{ version: number; createdAt: string; content?: string }>;
    const selected = options?.rewritesOnly
      ? rows.filter((row, index, array) => {
          const prev = array[index + 1];
          return !prev || String(row.content ?? "") !== String(prev.content ?? "");
        })
      : rows;
    return selected.slice(0, 100).map((row) => ({
      version: row.version,
      createdAt: sqliteUtcDatetimeToIso(String(row.createdAt ?? ""))
    }));
  }

  rollback(personaId: string, version: number): void {
    const db = getDatabase();
    const row = db
      .prepare("SELECT content FROM persona_versions WHERE persona_id = ? AND version = ? LIMIT 1")
      .get(personaId, version) as { content?: string } | undefined;
    if (!row?.content) {
      throw new Error("persona version not found");
    }
    const roots = [resolve(process.cwd(), "config/personas"), resolve(process.cwd(), "../../config/personas")];
    const root = roots.find((item) => existsSync(item));
    if (!root) {
      throw new Error("persona path not found");
    }
    writeFileSync(resolve(root, `${personaId}.persona.yaml`), row.content, "utf8");
  }
}
