import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export type PatchProposal = {
  title: string;
  rationale: string;
  diffPreview: string;
};

export function buildPatchProposal(title: string, rationale: string): PatchProposal {
  return {
    title,
    rationale,
    diffPreview: "Patch preview generation not implemented yet."
  };
}

export function generateSkillFromTemplate(skillId: string, purpose: string): string {
  const targetDir = resolve(process.cwd(), "skills", skillId);
  mkdirSync(targetDir, { recursive: true });
  const targetFile = resolve(targetDir, "index.ts");
  const source = `export default {
  manifest: {
    id: "${skillId}",
    name: "${titleCase(skillId)}",
    description: "${purpose.replace(/"/g, '\\"')}",
    permissions: [],
    version: "0.1.0"
  },
  async run(input) {
    return { message: "TODO: implement skill", input };
  }
};
`;
  writeFileSync(targetFile, source, "utf8");
  return targetFile;
}

function titleCase(value: string): string {
  return value
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(" ");
}
