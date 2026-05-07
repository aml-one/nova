import { existsSync, readdirSync } from "node:fs";
import { normalize, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { InMemorySkillRegistry } from "./skill-registry.js";

type RuntimeSkillModule = {
  cameraVisionSkill?: {
    manifest: {
      id: string;
      name: string;
      description: string;
      permissions: string[];
      settingsTab?: {
        id: string;
        label: string;
        tone?: "blue" | "purple" | "orange" | "green" | "pink" | "yellow";
        description?: string;
      };
    };
    run: (input: unknown) => Promise<unknown>;
  };
  default?: {
    manifest: {
      id: string;
      name: string;
      description: string;
      permissions: string[];
      settingsTab?: {
        id: string;
        label: string;
        tone?: "blue" | "purple" | "orange" | "green" | "pink" | "yellow";
        description?: string;
      };
    };
    run: (input: unknown) => Promise<unknown>;
  };
};

const skillsRootCandidates = () => [
  resolve(process.cwd(), "..", "..", "skills"),
  resolve(process.cwd(), "..", "skills"),
  resolve(process.cwd(), "skills")
];

export function resolveWorkspaceSkillsRoot(): string | undefined {
  return skillsRootCandidates().find((path) => existsSync(path));
}

function dirPrefix(root: string): string {
  const n = normalize(resolve(root));
  return n.endsWith(sep) ? n : n + sep;
}

function sourceUnderSkillsRoot(sourcePath: string | undefined, skillsRoot: string): boolean {
  if (!sourcePath) {
    return false;
  }
  const prefix = dirPrefix(skillsRoot);
  const p = normalize(resolve(sourcePath)) + sep;
  return p.startsWith(prefix);
}

export function unregisterWorkspaceSkills(registry: InMemorySkillRegistry, skillsRoot: string): void {
  for (const skill of registry.list()) {
    if (sourceUnderSkillsRoot(skill.sourcePath, skillsRoot)) {
      registry.unregister(skill.id);
    }
  }
}

export type SkillReloadResult = {
  loaded: string[];
  errors: Array<{ skill: string; message: string }>;
};

export async function registerSkillsFromDisk(
  registry: InMemorySkillRegistry,
  skillsRoot: string
): Promise<SkillReloadResult> {
  const loaded: string[] = [];
  const errors: Array<{ skill: string; message: string }> = [];
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
      const href = pathToFileURL(entryPath).href;
      const module = (await import(`${href}?t=${Date.now()}`)) as RuntimeSkillModule;
      const runtimeSkill = module.default ?? module.cameraVisionSkill;
      if (!runtimeSkill) {
        continue;
      }
      registry.register({
        id: runtimeSkill.manifest.id,
        name: runtimeSkill.manifest.name,
        description: runtimeSkill.manifest.description,
        permissions: runtimeSkill.manifest.permissions,
        settingsTab: runtimeSkill.manifest.settingsTab,
        run: runtimeSkill.run,
        sourcePath: entryPath
      });
      loaded.push(runtimeSkill.manifest.id);
    } catch (error) {
      const message = error instanceof Error ? error.message : "unknown error";
      console.warn(`failed loading skill ${entry.name}`, error);
      errors.push({ skill: entry.name, message });
    }
  }
  return { loaded, errors };
}

export async function loadWorkspaceSkills(registry: InMemorySkillRegistry): Promise<void> {
  const skillsRoot = resolveWorkspaceSkillsRoot();
  if (!skillsRoot) {
    console.warn("workspace skills directory not found", { candidates: skillsRootCandidates() });
    return;
  }
  await registerSkillsFromDisk(registry, skillsRoot);
}

export async function reloadWorkspaceSkills(registry: InMemorySkillRegistry): Promise<SkillReloadResult> {
  const skillsRoot = resolveWorkspaceSkillsRoot();
  if (!skillsRoot) {
    return { loaded: [], errors: [{ skill: "_", message: "skills root not found" }] };
  }
  unregisterWorkspaceSkills(registry, skillsRoot);
  return registerSkillsFromDisk(registry, skillsRoot);
}
