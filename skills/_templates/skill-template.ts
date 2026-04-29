import type { RuntimeSkill } from "@nova/skills";

export const templateSkill: RuntimeSkill = {
  manifest: {
    id: "template-skill",
    name: "Template Skill",
    description: "Use this as a starting point for new skills.",
    permissions: [],
    version: "0.1.0"
  },
  async run(input: unknown): Promise<unknown> {
    return { received: input };
  }
};
