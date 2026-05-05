import { existsSync } from "node:fs";
import { resolve } from "node:path";

function hasWorkspaceMarker(dir: string): boolean {
  return existsSync(resolve(dir, "pnpm-workspace.yaml"));
}

function hasGitDir(dir: string): boolean {
  return existsSync(resolve(dir, ".git"));
}

/**
 * Checkout root for running `git` / `gh` when the process cwd is deeper (e.g. `apps/agent-core` under launchd).
 * Set `NOVA_REPO_ROOT` to an absolute path if auto-detection cannot find the monorepo.
 */
export function resolveNovaRepoRoot(): string {
  const fromEnv = process.env.NOVA_REPO_ROOT?.trim();
  if (fromEnv) {
    const abs = resolve(fromEnv);
    if (existsSync(abs) && (hasWorkspaceMarker(abs) || hasGitDir(abs))) {
      return abs;
    }
  }
  const cwd = process.cwd();
  const candidates = [
    cwd,
    resolve(cwd, ".."),
    resolve(cwd, "..", ".."),
    resolve(cwd, "..", "..", ".."),
    resolve(cwd, "..", "..", "..", "..")
  ];
  for (const dir of candidates) {
    if (hasWorkspaceMarker(dir)) {
      return dir;
    }
  }
  for (const dir of candidates) {
    if (hasGitDir(dir)) {
      return dir;
    }
  }
  return cwd;
}
