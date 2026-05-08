import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getDatabase } from "../storage/sqlite.js";
import { PersonaLoader } from "../persona/persona-loader.js";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";
import { gitSafeDirectoryEnvForRepo } from "../util/git-safe-directory-env.js";
import { chownRepoGitIfConfigured } from "../util/chown-repo-git-if-configured.js";

type SanityReport = {
  ok: boolean;
  checks: Array<{ name: string; ok: boolean; detail: string }>;
};

type BackupMode = "manual" | "auto";

type BackupRunStatus = {
  id: string;
  mode: BackupMode;
  status: "success" | "failed";
  branch?: string;
  snapshotPath?: string;
  error?: string;
  createdAt: string;
};

/** Tables that back the People admin UI + channel identity resolution (also inside nova.db). */
const PEOPLE_IDENTITY_TABLES = [
  "people",
  "person_identities",
  "person_channel_state",
  "person_field_locks",
  "person_profile_events",
  "person_relationships",
  "identity_map"
] as const;

function writePeopleIdentityExport(snapshotDir: string): void {
  const db = getDatabase();
  const tables: Record<string, unknown[]> = {};
  for (const name of PEOPLE_IDENTITY_TABLES) {
    try {
      tables[name] = db.prepare(`SELECT * FROM ${name}`).all() as unknown[];
    } catch {
      tables[name] = [];
    }
  }
  const payload = {
    exportedAt: new Date().toISOString(),
    note: "Mirror of People-related SQLite tables at backup time; authoritative copy is nova.db.",
    tables
  };
  writeFileSync(join(snapshotDir, "people-identity.json"), JSON.stringify(payload, null, 2), "utf8");
}

export class IdentityBackupService {
  private readonly personas = new PersonaLoader();

  async createAndPushIdentityBackup(
    label?: string,
    mode: BackupMode = "manual",
    pushOptions?: { gitRemote?: string }
  ): Promise<{
    snapshotPath: string;
    branch: string;
    sanity: SanityReport;
  }> {
    try {
      const sanity = this.runSanityChecks();
      if (!sanity.ok) {
        throw new Error(`sanity check failed: ${sanity.checks.filter((item) => !item.ok).map((item) => item.name).join(", ")}`);
      }
      const snapshotPath = this.createSnapshot(label);
      const branch = this.pushSnapshotToGitHub(snapshotPath, normalizePushRemote(pushOptions?.gitRemote));
      this.recordRun(mode, "success", { branch, snapshotPath });
      return { snapshotPath, branch, sanity };
    } catch (error) {
      this.recordRun(mode, "failed", {
        error: error instanceof Error ? error.message : "identity backup failed"
      });
      throw error;
    }
  }

  runSanityChecks(): SanityReport {
    const root = process.cwd();
    const checks: SanityReport["checks"] = [];

    const dbPath = resolve(root, "data", "state", "nova.db");
    checks.push({
      name: "database_exists",
      ok: existsSync(dbPath),
      detail: existsSync(dbPath) ? dbPath : "nova.db not found"
    });
    if (existsSync(dbPath)) {
      try {
        const row = getDatabase().prepare("PRAGMA integrity_check;").get() as { integrity_check?: string } | undefined;
        checks.push({
          name: "database_integrity",
          ok: row?.integrity_check === "ok",
          detail: row?.integrity_check ?? "unknown"
        });
      } catch (error) {
        checks.push({
          name: "database_integrity",
          ok: false,
          detail: error instanceof Error ? error.message : "integrity check failed"
        });
      }
    }

    const personaPath = this.personas.ensureDefaultPersonaFile();
    checks.push({
      name: "persona_exists",
      ok: existsSync(personaPath),
      detail: existsSync(personaPath) ? personaPath : "default persona missing"
    });

    const sizeLimitBytes = 1024 * 1024 * 1024;
    const dbSize = existsSync(dbPath) ? statSync(dbPath).size : 0;
    checks.push({
      name: "database_size_limit",
      ok: dbSize < sizeLimitBytes,
      detail: `db_size=${dbSize}`
    });

    return {
      ok: checks.every((item) => item.ok),
      checks
    };
  }

  getLatestRun(): BackupRunStatus | undefined {
    const row = getDatabase()
      .prepare(
        `
        SELECT id, mode, status, branch, snapshot_path, error, created_at
        FROM identity_backup_runs
        ORDER BY datetime(created_at) DESC
        LIMIT 1
        `
      )
      .get() as
      | {
          id: string;
          mode: BackupMode;
          status: "success" | "failed";
          branch?: string;
          snapshot_path?: string;
          error?: string;
          created_at: string;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      mode: row.mode,
      status: row.status,
      branch: row.branch,
      snapshotPath: row.snapshot_path,
      error: row.error,
      createdAt: row.created_at
    };
  }

  getLatestSuccess(): BackupRunStatus | undefined {
    const row = getDatabase()
      .prepare(
        `
        SELECT id, mode, status, branch, snapshot_path, error, created_at
        FROM identity_backup_runs
        WHERE status = 'success'
        ORDER BY datetime(created_at) DESC
        LIMIT 1
        `
      )
      .get() as
      | {
          id: string;
          mode: BackupMode;
          status: "success" | "failed";
          branch?: string;
          snapshot_path?: string;
          error?: string;
          created_at: string;
        }
      | undefined;
    if (!row) {
      return undefined;
    }
    return {
      id: row.id,
      mode: row.mode,
      status: row.status,
      branch: row.branch,
      snapshotPath: row.snapshot_path,
      error: row.error,
      createdAt: row.created_at
    };
  }

  private createSnapshot(label?: string): string {
    const root = process.cwd();
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const safeLabel = (label ?? "identity").replace(/[^a-zA-Z0-9-_]/g, "-").slice(0, 40);
    const snapshotDir = resolve(root, "data", "identity-archive", `${stamp}-${safeLabel}`);
    mkdirSync(snapshotDir, { recursive: true });

    type CopyTarget = { from: string; to: string; recursive?: boolean };
    const copyTargets: CopyTarget[] = [
      { from: resolve(root, "data", "state", "nova.db"), to: resolve(snapshotDir, "nova.db") },
      { from: resolve(root, "data", "state", "learning-log.json"), to: resolve(snapshotDir, "learning-log.json") },
      { from: resolve(root, "data", "state", "curiosity-store.json"), to: resolve(snapshotDir, "curiosity-store.json") },
      { from: resolve(root, "data", "state", "install-meta.json"), to: resolve(snapshotDir, "install-meta.json") },
      { from: resolve(root, "config"), to: resolve(snapshotDir, "config"), recursive: true }
    ];
    for (const target of copyTargets) {
      if (!existsSync(target.from)) continue;
      mkdirSync(dirname(target.to), { recursive: true });
      cpSync(target.from, target.to, { recursive: target.recursive === true });
    }

    writePeopleIdentityExport(snapshotDir);

    writeFileSync(
      resolve(snapshotDir, "README-SNAPSHOT.txt"),
      [
        "Nova identity snapshot",
        "----------------------",
        "",
        "- nova.db          : SQLite database (chat/run history, memory, emotion, Web UI settings in table app_settings,",
        "                     sessions, improvement proposals, etc.). This already includes Settings you changed in /settings.",
        "                     People admin profiles are stored here too (people, person_identities, relationships, channel state, …).",
        "- people-identity.json : Redundant JSON export of People-related tables (same data as in nova.db) for review/diff in Git;",
        "                       restoring a host still uses nova.db as the source of truth.",
        "- learning-log.json, curiosity-store.json, install-meta.json : optional sidecar state (also partially reflected in DB).",
        "- config/          : checked-in YAML personas, cameras, improvement + gitops policy (and any other files you added).",
        "",
        "NOT included (back these up separately):",
        "- Repository root .env (secrets, provider defaults)",
        "- Ephemeral TLS keys under tmp/ unless you copy them manually",
        "- Media uploads under data/uploads/",
        "",
        "Git push: branches identity-backup/* go to the configured remote (Settings → Backup). Each branch is an orphan commit containing ONLY this snapshot directory (no Nova source code). Prefer a private repo + SSH deploy key or PAT; treat any remote that receives nova.db as sensitive.",
        ""
      ].join("\n"),
      "utf8"
    );

    const manifest = {
      id: randomUUID(),
      createdAt: new Date().toISOString(),
      sourceRoot: root,
      files: listFilesWithHashes(snapshotDir)
    };
    writeFileSync(resolve(snapshotDir, "manifest.json"), JSON.stringify(manifest, null, 2), "utf8");
    return snapshotDir;
  }

  private pushSnapshotToGitHub(snapshotPath: string, gitRemote: string): string {
    ensureRepo();
    const repoRoot = resolveNovaRepoRoot();
    assertGitRemoteConfigured(gitRemote, repoRoot);
    const relativePath = toPosixPath(relative(repoRoot, snapshotPath));
    if (relativePath.startsWith("..") || relativePath === "") {
      throw new Error("identity snapshot path is outside the Git checkout; check NOVA_REPO_ROOT and working directory");
    }
    const branch = `identity-backup/${Date.now()}`;
    // Parentless commit built via a temporary index — the pushed branch contains ONLY the snapshot
    // files, never the Nova source tree. The current branch / working tree are untouched.
    const tempIndex = resolve(repoRoot, ".git", `index.identity-backup-${Date.now()}-${randomUUID()}`);
    const env = { ...gitEnv(repoRoot), GIT_INDEX_FILE: tempIndex };
    try {
      runGitInEnv(["read-tree", "--empty"], env);
      runGitInEnv(["add", "--force", "--", relativePath], env);
      const treeSha = runGitInEnv(["write-tree"], env).trim();
      if (!treeSha) {
        throw new Error("git write-tree produced no output for identity snapshot");
      }
      const commitMsg = `chore(backup): add identity snapshot ${new Date().toISOString()}`;
      const commitResult = spawnSync("git", ["commit-tree", treeSha, "-m", commitMsg], {
        cwd: repoRoot,
        shell: false,
        encoding: "utf8",
        env
      });
      if (commitResult.status !== 0) {
        throw new Error(identityBackupGitFailureMessage(["commit-tree"], (commitResult.stderr ?? "").trim()));
      }
      const commitSha = (commitResult.stdout ?? "").trim();
      if (!commitSha) {
        throw new Error("git commit-tree produced no output for identity snapshot");
      }
      runGit(["push", gitRemote, `${commitSha}:refs/heads/${branch}`]);
      return branch;
    } finally {
      try {
        unlinkSync(tempIndex);
      } catch {
        // best-effort: temp index is harmless if it lingers
      }
      chownRepoGitIfConfigured(repoRoot);
    }
  }

  private recordRun(
    mode: BackupMode,
    status: "success" | "failed",
    details: { branch?: string; snapshotPath?: string; error?: string }
  ): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO identity_backup_runs (id, mode, status, branch, snapshot_path, error)
        VALUES (?, ?, ?, ?, ?, ?)
        `
      )
      .run(randomUUID(), mode, status, details.branch ?? null, details.snapshotPath ?? null, details.error ?? null);
  }
}

function listFilesWithHashes(root: string): Array<{ path: string; size: number; sha256: string }> {
  const files: Array<{ path: string; size: number; sha256: string }> = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      const data = readFileSync(full);
      files.push({
        path: toPosixPath(full.replace(`${root}\\`, "").replace(`${root}/`, "")),
        size: data.byteLength,
        sha256: createHash("sha256").update(data).digest("hex")
      });
    }
  };
  walk(root);
  return files;
}

function normalizePushRemote(name: string | undefined): string {
  const t = String(name ?? "origin").trim();
  if (!t || t.length > 128 || !/^[A-Za-z0-9._-]+$/.test(t)) {
    return "origin";
  }
  return t;
}

function assertGitRemoteConfigured(remote: string, cwd: string): void {
  const result = spawnSync("git", ["remote", "get-url", remote], {
    cwd,
    shell: false,
    encoding: "utf8",
    env: gitEnv(cwd)
  });
  if (result.status !== 0) {
    throw new Error(
      `Git remote "${remote}" is not configured in this checkout. On the agent host run: git remote add ${remote} <url> (use a private empty repo for identity-only backups when the Nova repo is public), then set the same remote name in Settings → Backup.`
    );
  }
}

function gitWorkTree(): string {
  return resolveNovaRepoRoot();
}

function gitEnv(cwd: string): NodeJS.ProcessEnv {
  return {
    ...gitSafeDirectoryEnvForRepo(cwd),
    // LaunchDaemon has no TTY; without this Git may hang or emit "Device not configured" on HTTPS prompts.
    GIT_TERMINAL_PROMPT: "0"
  };
}

function runGit(args: string[]): string {
  const cwd = gitWorkTree();
  return runGitInEnv(args, gitEnv(cwd));
}

function runGitInEnv(args: string[], env: NodeJS.ProcessEnv): string {
  const cwd = gitWorkTree();
  const result = spawnSync("git", args, {
    cwd,
    shell: false,
    encoding: "utf8",
    env
  });
  if (result.status !== 0) {
    const stderr = (result.stderr ?? "").trim();
    throw new Error(identityBackupGitFailureMessage(args, stderr));
  }
  return result.stdout ?? "";
}

/** Headless-friendly error text when Git wanted interactive HTTPS credentials. */
function identityBackupGitFailureMessage(args: readonly string[], stderr: string): string {
  const err = stderr || `git ${args.join(" ")} failed`;
  const lower = err.toLowerCase();
  const looksLikeHeadlessHttpsAuth =
    lower.includes("could not read username") ||
    lower.includes("device not configured") ||
    lower.includes("terminal prompts disabled") ||
    (lower.includes("authentication failed") && lower.includes("http"));

  if (!looksLikeHeadlessHttpsAuth) {
    return err;
  }

  return [
    err,
    "",
    "Identity backup runs without a terminal (e.g. macOS LaunchDaemon), so Git cannot prompt for HTTPS username/password.",
    "Fix (pick one):",
    "- Prefer SSH — in your Nova clone: git remote set-url <REMOTE_NAME> git@github.com:ORG/PRIVATE-REPO.git",
    "  The service plist sets HOME to your macOS login user, so SSH keys are typically read from that user's ~/.ssh (ensure that key can push to the backup repo).",
    "- Or store HTTPS credentials non-interactively (fine-grained PAT with repo scope): e.g. credential.helper store and ~/.git-credentials, or embed the token in the remote URL (treat it as a secret)."
  ].join("\n");
}

function ensureRepo(): void {
  const cwd = gitWorkTree();
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    shell: false,
    encoding: "utf8",
    env: gitEnv(cwd)
  });
  if (result.status !== 0) {
    const hint = (result.stderr ?? "").trim();
    throw new Error(
      `git repository not initialized (git cwd=${cwd}).${hint ? ` Git said: ${hint}` : ""} If Nova runs as a different user than the checkout owner (e.g. launchd as root), this is often fixed automatically in newer Nova builds; otherwise run Git from a shell as your user, or set NOVA_REPO_ROOT.`
    );
  }
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}
