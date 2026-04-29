import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitOpsManager } from "../git/gitops-manager.js";
import { LearningLog } from "./learning-log.js";
import { generateSkillFromTemplate } from "./patch-generator.js";
import { generateImprovementPrompt, summarizeOutcomes } from "./proposal-generator.js";
import { isValidationPass, runValidationGate } from "./validation-gate.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { EmotionService } from "../emotion/emotion-service.js";

type Outcome = {
  runId: string;
  userId: string;
  task: string;
  success: boolean;
};

type ImprovementPolicy = {
  mode: "suggest-only" | "auto-apply-skills" | "auto-apply-code-sandbox";
  autoApplySkills: boolean;
  autoApplyCodeInSandbox: boolean;
  backgroundLearningEnabled: boolean;
  minFailureCountForAutoImprove: number;
};

export class SelfImprovementLoop {
  private readonly outcomes: Outcome[] = [];
  private readonly learningLog = new LearningLog();
  private readonly policy: ImprovementPolicy;

  constructor(
    private readonly gitOps: GitOpsManager,
    private readonly registry: InMemorySkillRegistry,
    private readonly emotionService?: EmotionService
  ) {
    this.policy = loadPolicy();
  }

  recordOutcome(outcome: Outcome): void {
    this.outcomes.push(outcome);
    this.learningLog.append(
      `Outcome recorded for task: ${outcome.task}`,
      outcome.success,
      outcome.success ? "success" : "failure",
      "outcome",
      { runId: outcome.runId, userId: outcome.userId }
    );
    const emotionSettings = {
      enabled: true,
      expressionStyle: "balanced" as const,
      mirrorUserValence: true
    };
    this.emotionService?.applySystemEvent(
      outcome.userId,
      outcome.success ? "task_success" : "task_failure",
      emotionSettings
    );
  }

  async generateProposal(): Promise<string> {
    const summary = summarizeOutcomes(
      this.outcomes.map((item) => item.task),
      this.outcomes.map((item) => item.success)
    );
    const proposal = generateImprovementPrompt(summary);
    this.learningLog.append(proposal, false, "generated", "proposal", {
      registeredSkills: this.registry.count(),
      gitMode: this.gitOps.mode
    });
    this.emotionService?.applySystemEvent("nova-system", "proposal_created", {
      enabled: true,
      expressionStyle: "balanced",
      mirrorUserValence: true
    });
    return `${proposal} Registered skills: ${this.registry.count()}. Git mode: ${this.gitOps.mode}.`;
  }

  async maybeApplySkillImprovement(taskHint: string): Promise<string> {
    const policy = this.policy;
    if (!(policy.autoApplySkills || policy.mode === "auto-apply-skills")) {
      return "policy mode prevents auto skill apply";
    }
    const skillId = `auto-${normalizeId(taskHint)}`;
    const path = generateSkillFromTemplate(skillId, `Auto-generated for repeated failures in: ${taskHint}`);
    const report = runValidationGate();
    const accepted = isValidationPass(report);
    this.learningLog.append(`Generated skill ${skillId}`, accepted, report.details.join("; "), "validation", {
      skillId,
      path
    });
    if (!accepted) {
      this.emotionService?.applySystemEvent("nova-system", "improvement_failure", {
        enabled: true,
        expressionStyle: "balanced",
        mirrorUserValence: true
      });
      if (policy.autoApplyCodeInSandbox || policy.mode === "auto-apply-code-sandbox") {
        await this.gitOps.rollbackToCheckpoint("latest");
      }
      return `generated ${skillId} but validation failed`;
    }
    await this.gitOps.commitAndPush(`chore(skills): add auto-generated skill ${skillId}`);
    this.learningLog.append(`Committed auto-skill ${skillId}`, true, "pushed to git", "improvement", {
      skillId,
      path
    });
    this.emotionService?.applySystemEvent("nova-system", "improvement_success", {
      enabled: true,
      expressionStyle: "balanced",
      mirrorUserValence: true
    });
    return `generated and validated skill at ${path}`;
  }

  async runIdleLearningCycle(options?: { enabled?: boolean; minFailuresForAutoImprove?: number }): Promise<string> {
    const policy = this.policy;
    if ((options?.enabled ?? policy.backgroundLearningEnabled) !== true) {
      return "background learning is disabled by policy";
    }
    const summary = summarizeOutcomes(
      this.outcomes.map((item) => item.task),
      this.outcomes.map((item) => item.success)
    );
    const researchTopics = summary.topFailingTasks.length > 0 ? summary.topFailingTasks : ["ai agent reliability", "typescript agent design"];
    const researchNotes = await collectResearchNotes(researchTopics.slice(0, 2));
    this.learningLog.append("Idle research cycle completed", true, researchNotes, "research", {
      topics: researchTopics.slice(0, 2)
    });
    this.emotionService?.applySystemEvent("nova-system", "research_complete", {
      enabled: true,
      expressionStyle: "balanced",
      mirrorUserValence: true
    });

    const minFailures = options?.minFailuresForAutoImprove ?? policy.minFailureCountForAutoImprove;
    if (summary.failures < minFailures) {
      this.learningLog.append(
        "Skipped auto-improvement due to low failure volume",
        true,
        `failures=${summary.failures}`,
        "proposal"
      );
      return "idle cycle complete: researched only";
    }

    const proposal = await this.generateProposal();
    const target = summary.topFailingTasks[0] ?? "general-reliability";
    const improvementResult = await this.maybeApplySkillImprovement(target);
    this.learningLog.append("Idle improvement attempt", !improvementResult.includes("failed"), improvementResult, "improvement", {
      proposal
    });
    return `idle cycle complete: ${improvementResult}`;
  }

  getLearningHistoryGroupedByDate(): Record<string, Array<Record<string, unknown>>> {
    return this.learningLog.getGroupedByDate();
  }

  getLearningHistory(): Array<Record<string, unknown>> {
    return this.learningLog.getAll();
  }
}

function loadPolicy(): ImprovementPolicy {
  const candidates = [
    resolve(process.cwd(), "config/improvement/policy.yaml"),
    resolve(process.cwd(), "../../config/improvement/policy.yaml")
  ];
  const filePath = candidates.find((item) => existsSync(item));
  if (!filePath) {
    return {
      mode: "suggest-only",
      autoApplySkills: false,
      autoApplyCodeInSandbox: false,
      backgroundLearningEnabled: false,
      minFailureCountForAutoImprove: 3
    };
  }
  const raw = readFileSync(filePath, "utf8");
  const modeLine = readScalar(raw, "mode") as ImprovementPolicy["mode"] | undefined;
  const autoApplySkills = readScalar(raw, "autoApplySkills") === "true";
  const autoApplyCodeInSandbox = readScalar(raw, "autoApplyCodeInSandbox") === "true";
  const backgroundLearningEnabled = readScalar(raw, "backgroundLearningEnabled") === "true";
  const minFailureCountForAutoImprove = Number(readScalar(raw, "minFailureCountForAutoImprove") ?? "3");
  return {
    mode: modeLine ?? "suggest-only",
    autoApplySkills,
    autoApplyCodeInSandbox,
    backgroundLearningEnabled,
    minFailureCountForAutoImprove: Number.isFinite(minFailureCountForAutoImprove) ? Math.max(1, minFailureCountForAutoImprove) : 3
  };
}

function readScalar(raw: string, key: string): string | undefined {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(`${key}:`))
    ?.replace(`${key}:`, "")
    .trim();
}

function normalizeId(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40);
}

async function collectResearchNotes(topics: string[]): Promise<string> {
  const notes: string[] = [];
  for (const topic of topics) {
    try {
      const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
      const response = await fetch(url);
      if (!response.ok) {
        notes.push(`${topic}: no summary (${response.status})`);
        continue;
      }
      const payload = (await response.json()) as { extract?: string };
      const extract = payload.extract?.trim();
      if (!extract) {
        notes.push(`${topic}: empty summary`);
        continue;
      }
      notes.push(`${topic}: ${extract.slice(0, 220)}`);
    } catch (error) {
      notes.push(`${topic}: ${error instanceof Error ? error.message : "research failed"}`);
    }
  }
  return notes.join("\n");
}
