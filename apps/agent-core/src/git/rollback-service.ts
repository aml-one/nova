import { spawnSync } from "node:child_process";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";

export class RollbackService {
  async rollback(tag: string): Promise<void> {
    runGit(["reset", "--hard", tag]);
    runGit(["clean", "-fd"]);
  }
}

function runGit(args: string[]): void {
  const result = spawnSync("git", args, {
    cwd: resolveNovaRepoRoot(),
    shell: true,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}
