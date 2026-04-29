import type { SkillManifest } from "./skill-manifest.js";
import type { SkillPermission } from "./skill-manifest.js";

export type RuntimeSkill = {
  manifest: SkillManifest;
  onLoad?: () => Promise<void>;
  run(input: unknown, context: SkillExecutionContext): Promise<unknown>;
};

export type SkillExecutionContext = {
  callerId: string;
  requestId: string;
  permissionCheck: (permission: SkillPermission) => void;
};

type SkillRuntimeOptions = {
  permissionEvaluator?: (callerId: string, permission: SkillPermission) => boolean;
};

export class SkillRuntime {
  private readonly skills = new Map<string, RuntimeSkill>();
  private readonly permissionEvaluator: NonNullable<SkillRuntimeOptions["permissionEvaluator"]>;

  constructor(options: SkillRuntimeOptions = {}) {
    this.permissionEvaluator = options.permissionEvaluator ?? (() => true);
  }

  register(skill: RuntimeSkill): void {
    this.skills.set(skill.manifest.id, skill);
    if (skill.onLoad) {
      void skill.onLoad();
    }
  }

  list(): SkillManifest[] {
    return [...this.skills.values()].map((skill) => skill.manifest);
  }

  async execute(skillId: string, input: unknown, callerId = "system"): Promise<unknown> {
    const skill = this.skills.get(skillId);
    if (!skill) {
      throw new Error(`skill not found: ${skillId}`);
    }
    const context: SkillExecutionContext = {
      callerId,
      requestId: `${skillId}-${Date.now()}`,
      permissionCheck: (permission) => {
        const allowed = this.permissionEvaluator(callerId, permission);
        if (!allowed) {
          throw new Error(`permission denied: ${permission}`);
        }
      }
    };
    for (const permission of skill.manifest.permissions) {
      context.permissionCheck(permission);
    }
    return skill.run(input, context);
  }
}
