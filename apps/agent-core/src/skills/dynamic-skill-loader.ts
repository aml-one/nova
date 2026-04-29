import { existsSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemorySkillRegistry } from "./skill-registry.js";

type RuntimeSkillModule = {
  cameraVisionSkill?: {
    manifest: {
      id: string;
      name: string;
      description: string;
      permissions: string[];
    };
    run: (input: unknown) => Promise<unknown>;
  };
  default?: {
    manifest: {
      id: string;
      name: string;
      description: string;
      permissions: string[];
    };
    run: (input: unknown) => Promise<unknown>;
  };
};

export async function loadWorkspaceSkills(registry: InMemorySkillRegistry): Promise<void> {
  const skillsRoot = resolve(process.cwd(), "skills");
  if (!existsSync(skillsRoot)) {
    return;
  }
  const entries = readdirSync(skillsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
  for (const entry of entries) {
    const candidatePaths = [
      resolve(skillsRoot, entry.name, "src", "index.ts"),
      resolve(skillsRoot, entry.name, "index.ts")
    ];
    const entryPath = candidatePaths.find((path) => existsSync(path));
    if (!entryPath) {
      continue;
    }
    try {
      const module = (await import(pathToFileURL(entryPath).href)) as RuntimeSkillModule;
      const runtimeSkill = module.default ?? module.cameraVisionSkill;
      if (!runtimeSkill) {
        continue;
      }
      registry.register({
        id: runtimeSkill.manifest.id,
        name: runtimeSkill.manifest.name,
        description: runtimeSkill.manifest.description,
        permissions: runtimeSkill.manifest.permissions,
        run: runtimeSkill.run,
        sourcePath: entryPath
      });
    } catch (error) {
      console.warn(`failed loading skill ${entry.name}`, error);
    }
  }
}
