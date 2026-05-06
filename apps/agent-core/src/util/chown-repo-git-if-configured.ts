import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

/**
 * When agent-core runs as root (typical macOS LaunchDaemon binding :443), `git` may create
 * root-owned files under `.git`. The installer sets `NOVA_REPO_GIT_CHOWN=you:staff`; we re-chown
 * `.git` after successful mutating flows (e.g. `git pull` from Apply update).
 */
export function chownRepoGitIfConfigured(repoRoot: string): void {
  const spec = process.env.NOVA_REPO_GIT_CHOWN?.trim();
  if (!spec) {
    return;
  }
  if (typeof process.getuid === "function" && process.getuid() !== 0) {
    return;
  }
  const colon = spec.indexOf(":");
  const user = colon === -1 ? spec : spec.slice(0, colon).trim();
  const group = colon === -1 ? "staff" : (spec.slice(colon + 1).trim() || "staff");
  if (!user) {
    return;
  }
  const gitDir = resolve(repoRoot, ".git");
  const result = spawnSync("chown", ["-R", `${user}:${group}`, gitDir], { encoding: "utf8" });
  if (result.status !== 0) {
    const detail = (result.stderr ?? result.stdout ?? "").trim();
    console.warn(`[nova] NOVA_REPO_GIT_CHOWN chown failed for ${gitDir}: ${detail || "unknown error"}`);
  }
}
