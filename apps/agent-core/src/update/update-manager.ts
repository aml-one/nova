import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getDatabase } from "../storage/sqlite.js";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";
import { gitSafeDirectoryEnvForRepo } from "../util/git-safe-directory-env.js";
import { chownRepoGitIfConfigured } from "../util/chown-repo-git-if-configured.js";

export type UpdateSettings = {
  enabled: boolean;
  checkIntervalMs: number;
  repoOwner: string;
  repoName: string;
  channel: "stable" | "beta";
  autoApply: boolean;
};

type UpdateStatus = {
  installedAt: string;
  latestPushedAt?: string;
  latestCommitSha?: string;
  latestCommitUrl?: string;
  updateAvailable: boolean;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
};

export class UpdateManager {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly getSettings: () => UpdateSettings,
    private readonly getInstalledAt: () => string,
    private readonly setInstalledAt: (isoTime: string) => void,
    private readonly onAppliedRestart: () => void
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 60_000);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (!this.timer) return;
    clearInterval(this.timer);
    this.timer = undefined;
  }

  async checkNow(): Promise<UpdateStatus> {
    const settings = this.getSettings();
    const installedAt = this.getInstalledAt();
    if (!settings.repoOwner || !settings.repoName) {
      const status: UpdateStatus = {
        installedAt,
        updateAvailable: false,
        lastError: "Updates repo owner/name not configured"
      };
      this.record("check", "failed", installedAt, undefined, status.lastError);
      return status;
    }
    const latestCommit = await this.fetchLatestCommit(settings.repoOwner, settings.repoName);
    if (!latestCommit.pushedAt) {
      const status: UpdateStatus = {
        installedAt,
        updateAvailable: false,
        lastError: latestCommit.error ?? "No commit timestamp found",
        lastCheckedAt: new Date().toISOString()
      };
      this.record("check", "failed", installedAt, undefined, status.lastError);
      return status;
    }
    const updateAvailable = new Date(latestCommit.pushedAt).getTime() > new Date(installedAt).getTime();
    this.record("check", "success", installedAt, latestCommit.pushedAt, latestCommit.url);
    return {
      installedAt,
      latestPushedAt: latestCommit.pushedAt,
      latestCommitSha: latestCommit.sha,
      latestCommitUrl: latestCommit.url,
      updateAvailable,
      lastCheckedAt: new Date().toISOString()
    };
  }

  async applyLatest(): Promise<{ ok: boolean; message: string }> {
    const status = await this.checkNow();
    if (!status.updateAvailable || !status.latestPushedAt) {
      return { ok: true, message: "No new version available" };
    }
    const result = this.runShellUpdate();
    this.record("apply", result.ok ? "success" : "failed", status.installedAt, status.latestPushedAt, result.message);
    if (result.ok) {
      this.setInstalledAt(new Date().toISOString());
      // Defer restart so HTTP response can be sent cleanly.
      setTimeout(() => this.onAppliedRestart(), 1500);
      return { ok: true, message: "Update applied. Restarting services..." };
    }
    return result;
  }

  getStatus(): UpdateStatus {
    const installedAt = this.getInstalledAt();
    const row = getDatabase()
      .prepare(
        `
        SELECT event_type, status, current_version, target_version, details, created_at
        FROM update_events
        ORDER BY datetime(created_at) DESC
        LIMIT 50
        `
      )
      .all() as Array<{
      event_type: string;
      status: string;
      current_version?: string;
      target_version?: string;
      details?: string;
      created_at: string;
    }>;
    const lastCheck = row.find((item) => item.event_type === "check");
    const lastApply = row.find((item) => item.event_type === "apply");
    return {
      installedAt,
      latestPushedAt: lastCheck?.target_version,
      updateAvailable:
        Boolean(lastCheck?.target_version) &&
        new Date(lastCheck?.target_version ?? "1970-01-01T00:00:00.000Z").getTime() > new Date(installedAt).getTime(),
      lastCheckedAt: lastCheck?.created_at,
      lastAppliedAt: lastApply?.status === "success" ? lastApply.created_at : undefined,
      lastError: lastApply?.status === "failed" ? lastApply.details : undefined
    };
  }

  getHistory(): Array<{ eventType: string; status: string; currentVersion?: string; targetVersion?: string; details?: string; at: string }> {
    const rows = getDatabase()
      .prepare(
        `
        SELECT event_type, status, current_version, target_version, details, created_at
        FROM update_events
        ORDER BY datetime(created_at) DESC
        LIMIT 200
        `
      )
      .all() as Array<{
      event_type: string;
      status: string;
      current_version?: string;
      target_version?: string;
      details?: string;
      created_at: string;
    }>;
    return rows.map((row) => ({
      eventType: row.event_type,
      status: row.status,
      currentVersion: row.current_version,
      targetVersion: row.target_version,
      details: row.details,
      at: row.created_at
    }));
  }

  private async tick(): Promise<void> {
    if (this.running) return;
    const settings = this.getSettings();
    if (!settings.enabled) return;
    const last = this.getStatus().lastCheckedAt;
    const shouldCheck = !last || Date.now() - new Date(last).getTime() >= settings.checkIntervalMs;
    if (!shouldCheck) return;
    this.running = true;
    try {
      const status = await this.checkNow();
      if (settings.autoApply && status.updateAvailable) {
        await this.applyLatest();
      }
    } finally {
      this.running = false;
    }
  }

  private async fetchLatestCommit(
    owner: string,
    repo: string
  ): Promise<{ pushedAt?: string; sha?: string; url?: string; error?: string }> {
    const url = `https://api.github.com/repos/${owner}/${repo}/commits?per_page=1`;
    try {
      const githubToken = process.env.GITHUB_TOKEN?.trim();
      const response = await fetch(url, {
        headers: {
          "user-agent": "nova-agent-core",
          accept: "application/vnd.github+json",
          "x-github-api-version": "2022-11-28",
          ...(githubToken ? { authorization: `Bearer ${githubToken}` } : {})
        }
      });
      if (!response.ok) {
        const rateLimitRemaining = response.headers.get("x-ratelimit-remaining");
        const rateLimitReset = response.headers.get("x-ratelimit-reset");
        if (response.status === 403) {
          const resetAt =
            rateLimitReset && Number.isFinite(Number(rateLimitReset))
              ? new Date(Number(rateLimitReset) * 1000).toISOString()
              : undefined;
          if (rateLimitRemaining === "0") {
            return {
              error: `GitHub rate limit reached (403).${resetAt ? ` Resets at ${resetAt}.` : ""}`
            };
          }
          return {
            error: "GitHub returned 403 (forbidden). Check GITHUB_TOKEN validity/permissions and repo visibility."
          };
        }
        if (response.status === 401) {
          return { error: "GitHub returned 401 (unauthorized). Check GITHUB_TOKEN." };
        }
        return { error: `GitHub returned ${response.status}` };
      }
      const payload = (await response.json()) as Array<{
        sha?: string;
        html_url?: string;
        commit?: { committer?: { date?: string } };
      }>;
      const latest = payload[0];
      return {
        pushedAt: latest?.commit?.committer?.date,
        sha: latest?.sha,
        url: latest?.html_url
      };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "commit check failed" };
    }
  }

  private runShellUpdate(): { ok: boolean; message: string } {
    const repoRoot = resolveNovaRepoRoot();
    /**
     * Do not run `pnpm -r build` by default while `next dev` may still be running: `next build`
     * writes the same `apps/web/.next` tree and races the dev server (torn manifests / missing chunks).
     * Set NOVA_UPDATE_INCLUDE_BUILD=true for installs that need a full compile (e.g. prod without dev).
     */
    const includeBuild = process.env.NOVA_UPDATE_INCLUDE_BUILD === "true";
    const pnpmInstallCmd = "(corepack pnpm install || pnpm install || npx --yes pnpm install)";
    const pnpmBuildCmd = "(corepack pnpm -r build || pnpm -r build || npx --yes pnpm -r build)";
    const cmd = includeBuild ? `git pull && ${pnpmInstallCmd} && ${pnpmBuildCmd}` : `git pull && ${pnpmInstallCmd}`;
    const result = spawnSync(cmd, {
      cwd: repoRoot,
      shell: true,
      encoding: "utf8",
      env: gitSafeDirectoryEnvForRepo(repoRoot)
    });
    if (result.status !== 0) {
      return { ok: false, message: (result.stderr || result.stdout || "update command failed").slice(0, 2000) };
    }
    chownRepoGitIfConfigured(repoRoot);
    this.touchWebNextCleanFlag(repoRoot);
    return { ok: true, message: (result.stdout || "update applied").slice(0, 2000) };
  }

  private touchWebNextCleanFlag(repoRoot: string): void {
    try {
      const dir = resolve(repoRoot, "tmp");
      mkdirSync(dir, { recursive: true });
      writeFileSync(resolve(dir, ".nova-clean-web-next"), `${new Date().toISOString()}\n`, "utf8");
    } catch {
      // non-fatal; start-local.sh will still restart web without wiping .next
    }
  }

  private record(
    eventType: "check" | "apply",
    status: "success" | "failed",
    currentVersion: string,
    targetVersion?: string,
    details?: string
  ): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO update_events (id, event_type, status, current_version, target_version, details)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(randomUUID(), eventType, status, currentVersion, targetVersion ?? null, details ?? null);
  }
}
