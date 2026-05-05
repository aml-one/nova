import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { CheckpointService } from "./checkpoint-service.js";
import { RollbackService } from "./rollback-service.js";

export type GitOpsMode = "suggest-only" | "auto-apply-skills" | "auto-apply-code-sandbox";

type GitPolicy = {
  branchPrefix: string;
  checkpointTagPrefix: string;
};

export type OpenPrResult = {
  branch: string;
  prUrl?: string;
};

export class GitOpsManager {
  readonly mode: GitOpsMode = "suggest-only";
  private readonly policy: GitPolicy;
  private readonly checkpoints = new CheckpointService();
  private readonly rollbackService = new RollbackService();

  constructor() {
    this.policy = loadGitPolicy();
  }

  async createCheckpointTag(tagName: string): Promise<void> {
    ensureRepo();
    this.checkpoints.createCheckpoint(tagName);
  }

  async commitAndPush(changeSummary: string): Promise<void> {
    ensureRepo();
    const branchName = `${this.policy.branchPrefix}${Date.now()}`;
    runGit(["checkout", "-B", branchName]);
    runGit(["add", "."]);
    runGit(["commit", "-m", changeSummary]);
    runGit(["push", "-u", "origin", branchName]);
    const checkpoint = this.checkpoints.createTagName(this.policy.checkpointTagPrefix);
    this.checkpoints.createCheckpoint(checkpoint);
    runGit(["push", "origin", checkpoint]);
  }

  /** Commit only selected files and try opening a PR (uses `gh` when available). */
  async commitFilesAndOpenPr(input: {
    files: string[];
    commitMessage: string;
    title: string;
    body: string;
    baseBranch?: string;
  }): Promise<OpenPrResult | null> {
    ensureRepo();
    const files = [...new Set(input.files.map((f) => f.trim()).filter(Boolean))];
    if (files.length === 0) {
      return null;
    }
    const branch = `${this.policy.branchPrefix}${Date.now()}`;
    runGit(["checkout", "-B", branch]);
    runGit(["add", "--", ...files]);
    const changed = runGit(["diff", "--cached", "--name-only"]).trim();
    if (!changed) {
      return null;
    }
    runGit(["commit", "-m", input.commitMessage]);
    runGit(["push", "-u", "origin", branch]);
    const prUrl = tryCreatePr({
      title: input.title,
      body: input.body,
      baseBranch: input.baseBranch ?? "main",
      headBranch: branch
    });
    return { branch, prUrl };
  }

  async rollbackToCheckpoint(tagName: string): Promise<void> {
    ensureRepo();
    const tag = tagName === "latest" ? this.checkpoints.latestCheckpoint(this.policy.checkpointTagPrefix) : tagName;
    if (!tag) {
      throw new Error("no checkpoint tag available for rollback");
    }
    await this.rollbackService.rollback(tag);
  }
}

function loadGitPolicy(): GitPolicy {
  const candidates = [
    resolve(process.cwd(), "config/gitops/policy.yaml"),
    resolve(process.cwd(), "../../config/gitops/policy.yaml")
  ];
  const filePath = candidates.find((item) => existsSync(item));
  if (!filePath) {
    return { branchPrefix: "agent/auto/", checkpointTagPrefix: "nova-checkpoint-" };
  }
  const raw = readFileSync(filePath, "utf8");
  return {
    branchPrefix: readScalar(raw, "autonomousBranchPrefix") ?? "agent/auto/",
    checkpointTagPrefix: readScalar(raw, "checkpointTagPrefix") ?? "nova-checkpoint-"
  };
}

function readScalar(raw: string, key: string): string | undefined {
  const line = raw
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith(`${key}:`));
  if (!line) {
    return undefined;
  }
  return line.replace(`${key}:`, "").trim().replace(/^"|"$/g, "");
}

function runGit(args: string[]): string {
  const result = spawnSync("git", args, { cwd: process.cwd(), shell: true, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || `git ${args.join(" ")} failed`);
  }
  return result.stdout ?? "";
}

function tryCreatePr(input: { title: string; body: string; baseBranch: string; headBranch: string }): string | undefined {
  const which = spawnSync("gh", ["--version"], { cwd: process.cwd(), shell: true, encoding: "utf8" });
  if (which.status !== 0) {
    return undefined;
  }
  const create = spawnSync(
    "gh",
    ["pr", "create", "--base", input.baseBranch, "--head", input.headBranch, "--title", input.title, "--body", input.body],
    { cwd: process.cwd(), shell: true, encoding: "utf8" }
  );
  if (create.status !== 0) {
    return undefined;
  }
  const line = (create.stdout ?? "")
    .split("\n")
    .map((x) => x.trim())
    .find((x) => /^https?:\/\//.test(x));
  return line;
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
