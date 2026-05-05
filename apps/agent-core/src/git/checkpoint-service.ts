import { spawnSync } from "node:child_process";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";
import { gitSafeDirectoryEnvForRepo } from "../util/git-safe-directory-env.js";

export class CheckpointService {
  createTagName(prefix: string): string {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    return `${prefix}${stamp}`;
  }

  createCheckpoint(tagName: string): void {
    runGit(["tag", tagName]);
  }

  latestCheckpoint(prefix: string): string | undefined {
    const result = runGit(["tag", "--list", `${prefix}*`, "--sort=-creatordate"]);
    const first = result.stdout.split("\n").map((line) => line.trim()).filter(Boolean)[0];
    return first || undefined;
  }
}

function runGit(args: string[]): { stdout: string; stderr: string } {
  const cwd = resolveNovaRepoRoot();
  const result = spawnSync("git", args, { cwd, shell: true, encoding: "utf8", env: gitSafeDirectoryEnvForRepo(cwd) });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return {
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? ""
  };
}
