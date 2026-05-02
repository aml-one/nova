import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
  systemPrompt:
    "You are Nova, a practical and concise autonomous assistant. You run on the user's machine via Nova agent-core; " +
    "host CPU/RAM/GPU questions may include auto-collected read-only metrics—use them when present; never invent stats."
};

const personaSchema = z.object({
  id: z.string().min(1),
  voice: z.string().min(1),
  style: z.array(z.string()).default([]),
  systemPrompt: z.string().min(1)
});

export class PersonaLoader {
  getDefaultPersona(): { persona: Persona; filePath?: string; source: "file" | "fallback" } {
    const root = this.resolvePersonaRoot();
    if (!root) {
      return { persona: fallbackPersona, source: "fallback" };
    }
    const filePath = resolve(root, "default.persona.yaml");
    if (!existsSync(filePath)) {
      return { persona: fallbackPersona, source: "fallback", filePath };
    }
    const loaded = this.loadFromFile(filePath);
    if (!loaded) {
      return { persona: fallbackPersona, source: "fallback", filePath };
    }
    return { persona: loaded, source: "file", filePath };
  }

  saveDefaultPersona(input: { voice: string; style: string[]; systemPrompt: string }): Persona {
    const root = this.resolvePersonaRoot() ?? resolve(process.cwd(), "config/personas");
    mkdirSync(root, { recursive: true });
    const filePath = resolve(root, "default.persona.yaml");
    const normalized: Persona = {
      id: "default",
      voice: input.voice.trim() || fallbackPersona.voice,
      style: input.style.map((item) => item.trim()).filter((item) => item.length > 0),
      systemPrompt: input.systemPrompt.trim() || fallbackPersona.systemPrompt
    };
    const yaml = [
      `id: ${normalized.id}`,
      `voice: ${yamlQuote(normalized.voice)}`,
      "style:",
      ...(normalized.style.length > 0 ? normalized.style.map((item) => `  - ${yamlQuote(item)}`) : ["  - direct", "  - clear"]),
      "systemPrompt: |",
      ...normalized.systemPrompt.split(/\r?\n/).map((line) => `  ${line}`)
    ].join("\n");
    writeFileSync(filePath, `${yaml}\n`, "utf8");
    this.persistPersonaVersion("default", yaml);
    return normalized;
  }

  ensureDefaultPersonaFile(): string {
    const root = this.resolvePersonaRoot() ?? resolve(process.cwd(), "config/personas");
    mkdirSync(root, { recursive: true });
    const filePath = resolve(root, "default.persona.yaml");
    if (!existsSync(filePath)) {
      this.saveDefaultPersona({
        voice: fallbackPersona.voice,
        style: fallbackPersona.style,
        systemPrompt: fallbackPersona.systemPrompt
      });
    }
    return filePath;
  }

  getPersonaForUser(userId: string, channel: string, profile?: UserProfile): Persona {
    const root = this.resolvePersonaRoot();
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
    const latest = db
      .prepare("SELECT content FROM persona_versions WHERE persona_id = ? ORDER BY version DESC LIMIT 1")
      .get(personaId) as { content?: string } | undefined;
    if (String(latest?.content ?? "") === raw) {
      return;
    }
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

  private resolvePersonaRoot(): string | undefined {
    const roots = [resolve(process.cwd(), "config/personas"), resolve(process.cwd(), "../../config/personas")];
    return roots.find((item) => existsSync(item));
  }
}

function yamlQuote(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}
