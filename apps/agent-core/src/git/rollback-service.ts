import { spawnSync } from "node:child_process";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";
import { gitSafeDirectoryEnvForRepo } from "../util/git-safe-directory-env.js";

export class RollbackService {
  async rollback(tag: string): Promise<void> {
    runGit(["reset", "--hard", tag]);
    runGit(["clean", "-fd"]);
  }
}

function runGit(args: string[]): void {
  const cwd = resolveNovaRepoRoot();
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env: gitSafeDirectoryEnvForRepo(cwd)
  });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
}
