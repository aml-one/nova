import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
import type { UserProfile } from "../identity/user-profile-store.js";
import { readYamlWithSchema } from "../config/yaml.js";
import { getDatabase } from "../storage/sqlite.js";

export type Persona = {
  id: string;
  voice: string;
  style: string[];
  systemPrompt: string;
};

const fallbackPersona: Persona = {
  id: "default",
  voice: "helpful",
  style: ["direct", "clear"],
  systemPrompt: "You are Nova, a practical and concise autonomous assistant."
};

const personaSchema = z.object({
  id: z.string().min(1),
  voice: z.string().min(1),
  style: z.array(z.string()).default([]),
  systemPrompt: z.string().min(1)
});

export class PersonaLoader {
  getPersonaForUser(userId: string, channel: string, profile?: UserProfile): Persona {
    const roots = [resolve(process.cwd(), "config/personas"), resolve(process.cwd(), "../../config/personas")];
    const root = roots.find((item) => existsSync(item));
    if (!root) {
      return fallbackPersona;
    }
    const candidates = [
      profile?.preferredPersonaId ? resolve(root, `${profile.preferredPersonaId}.persona.yaml`) : "",
      resolve(root, `${channel}.persona.yaml`),
      resolve(root, `${userId}.persona.yaml`),
      resolve(root, "default.persona.yaml")
    ].filter(Boolean);

    for (const filePath of candidates) {
      if (!existsSync(filePath)) {
        continue;
      }
      const loaded = this.loadFromFile(filePath);
      if (loaded) {
        return profile?.preferredStyle ? { ...loaded, style: [profile.preferredStyle] } : loaded;
      }
    }
    return fallbackPersona;
  }

  private loadFromFile(filePath: string): Persona | undefined {
    try {
      const parsed = readYamlWithSchema(filePath, personaSchema);
      this.persistPersonaVersion(parsed.id, readFileSync(filePath, "utf8"));
      return {
        id: parsed.id || fallbackPersona.id,
        voice: parsed.voice || fallbackPersona.voice,
        style: (parsed.style ?? []).length > 0 ? (parsed.style ?? []) : fallbackPersona.style,
        systemPrompt: parsed.systemPrompt || fallbackPersona.systemPrompt
      };
    } catch {
      return undefined;
    }
  }

  rollbackPersona(personaId: string, toVersion: number): void {
    const db = getDatabase();
    const row = db
      .prepare("SELECT content FROM persona_versions WHERE persona_id = ? AND version = ? LIMIT 1")
      .get(personaId, toVersion) as { content?: string } | undefined;
    if (!row?.content) {
      throw new Error("persona version not found");
    }
    const roots = [resolve(process.cwd(), "config/personas"), resolve(process.cwd(), "../../config/personas")];
    const root = roots.find((item) => existsSync(item));
    if (!root) {
      throw new Error("persona config root not found");
    }
    const filePath = resolve(root, `${personaId}.persona.yaml`);
    writeFileSync(filePath, row.content, "utf8");
  }

  private persistPersonaVersion(personaId: string, raw: string): void {
    const db = getDatabase();
    const row = db
      .prepare("SELECT COALESCE(MAX(version), 0) AS max_version FROM persona_versions WHERE persona_id = ?")
      .get(personaId) as { max_version?: number } | undefined;
    const nextVersion = (row?.max_version ?? 0) + 1;
    db.prepare("INSERT INTO persona_versions (persona_id, version, content) VALUES (?, ?, ?)").run(
      personaId,
      nextVersion,
      raw
    );
  }
}
