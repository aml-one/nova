import { spawn } from "node:child_process";
import { resolve } from "node:path";

export type RegisteredSkill = {
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
  run: (input: unknown) => Promise<unknown>;
  sourcePath?: string;
};

type SkillRuntimeSettings = {
  isolationEnabled: boolean;
  timeoutMs: number;
  maxMemoryMb: number;
};

export class InMemorySkillRegistry {
  private readonly skills = new Map<string, RegisteredSkill>();
  constructor(private readonly getRuntimeSettings?: () => SkillRuntimeSettings) {}

  register(skill: RegisteredSkill): void {
    this.skills.set(skill.id, skill);
  }

  get(skillId: string): RegisteredSkill | undefined {
    return this.skills.get(skillId);
  }

  list(): RegisteredSkill[] {
    return [...this.skills.values()];
  }

  count(): number {
    return this.skills.size;
  }

  async run(skillId: string, input: unknown): Promise<unknown> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`skill not found: ${skillId}`);
    }
    const runtimeSettings = this.getRuntimeSettings?.();
    const isolationEnabled = runtimeSettings?.isolationEnabled ?? process.env.NOVA_SKILL_ISOLATION === "true";
    if (isolationEnabled && skill.sourcePath) {
      return runInIsolatedProcess(
        skill.id,
        skill.sourcePath,
        input,
        runtimeSettings?.timeoutMs,
        runtimeSettings?.maxMemoryMb
      );
    }
    return skill.run(input);
  }
}

async function runInIsolatedProcess(
  skillId: string,
  sourcePath: string,
  input: unknown,
  timeoutMsOverride?: number,
  maxMemMbOverride?: number
): Promise<unknown> {
  const workerPath = resolve(process.cwd(), "apps", "agent-core", "src", "skills", "skill-worker.ts");
  const timeoutMs = Number(timeoutMsOverride ?? process.env.NOVA_SKILL_TIMEOUT_MS ?? "15000");
  const maxMemMb = Number(maxMemMbOverride ?? process.env.NOVA_SKILL_MAX_MB ?? "256");

  return new Promise((resolvePromise, reject) => {
    const child = spawn(
      "corepack",
      ["pnpm", "exec", "tsx", workerPath],
      {
        shell: true,
        env: {
          ...process.env,
          NOVA_SKILL_SOURCE: sourcePath,
          NOVA_SKILL_ID: skillId,
          NOVA_SKILL_MAX_MB: String(maxMemMb),
          NODE_OPTIONS: `--max-old-space-size=${maxMemMb}`
        },
        stdio: ["pipe", "pipe", "pipe"]
      }
    );
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("skill execution timeout"));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr || `skill worker failed (${code})`));
        return;
      }
      try {
        resolvePromise(JSON.parse(stdout));
      } catch (error) {
        reject(error);
      }
    });
    child.stdin.write(JSON.stringify(input));
    child.stdin.end();
  });
}
