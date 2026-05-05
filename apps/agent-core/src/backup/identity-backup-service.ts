import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { getDatabase } from "../storage/sqlite.js";
import { PersonaLoader } from "../persona/persona-loader.js";

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

export class IdentityBackupService {
  private readonly personas = new PersonaLoader();

  async createAndPushIdentityBackup(
    label?: string,
    mode: BackupMode = "manual"
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
      const branch = this.pushSnapshotToGitHub(snapshotPath);
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

    writeFileSync(
      resolve(snapshotDir, "README-SNAPSHOT.txt"),
      [
        "Nova identity snapshot",
        "----------------------",
        "",
        "- nova.db          : SQLite database (chat/run history, memory, emotion, Web UI settings in table app_settings,",
        "                     sessions, improvement proposals, etc.). This already includes Settings you changed in /settings.",
        "- learning-log.json, curiosity-store.json, install-meta.json : optional sidecar state (also partially reflected in DB).",
        "- config/          : checked-in YAML personas, cameras, improvement + gitops policy (and any other files you added).",
        "",
        "NOT included (back these up separately):",
        "- Repository root .env (secrets, provider defaults)",
        "- Ephemeral TLS keys under tmp/ unless you copy them manually",
        "- Media uploads under data/uploads/",
        "",
        "Git push: branches named identity-backup/* contain this folder. Treat the remote as sensitive if nova.db has API keys.",
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

  private pushSnapshotToGitHub(snapshotPath: string): string {
    ensureRepo();
    const relativePath = toPosixPath(snapshotPath.replace(`${process.cwd()}\\`, "").replace(`${process.cwd()}/`, ""));
    const branch = `identity-backup/${Date.now()}`;
    runGit(["checkout", "-B", branch]);
    runGit(["add", relativePath]);
    runGit(["commit", "-m", `chore(backup): add identity snapshot ${new Date().toISOString()}`]);
    runGit(["push", "-u", "origin", branch]);
    return branch;
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

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { cwd: process.cwd(), shell: true, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function ensureRepo(): void {
  const result = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd: process.cwd(),
    shell: true,
    encoding: "utf8"
  });
  if (result.status !== 0) {
    throw new Error("git repository not initialized");
  }
}

function toPosixPath(path: string): string {
  return path.replace(/\\/g, "/");
}
