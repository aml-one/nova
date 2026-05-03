import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { GitOpsManager } from "../git/gitops-manager.js";
import { LearningLog } from "./learning-log.js";
import { generateSkillFromTemplate } from "./patch-generator.js";
import { generateImprovementPrompt, summarizeOutcomes } from "./proposal-generator.js";
import { isValidationPass, runValidationGate } from "./validation-gate.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { EmotionService, formatEmotionSnapshot } from "../emotion/emotion-service.js";
import { NOVA_PRIMARY_EMOTION_USER_ID } from "../identity/nova-emotion-user.js";
import { ModelRouter } from "../providers/router.js";
import type { ChatMessage } from "@nova/sdk/provider";
import { CuriosityStore } from "./curiosity-store.js";

type Outcome = {
  runId: string;
  userId: string;
  task: string;
  success: boolean;
};

type LearningRecordLike = {
  at?: string;
  category?: string;
  accepted?: boolean;
  result?: string;
  details?: Record<string, unknown>;
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
  private readonly curiosity = new CuriosityStore();
  private readonly policy: ImprovementPolicy;

  constructor(
    private readonly gitOps: GitOpsManager,
    private readonly registry: InMemorySkillRegistry,
    private readonly emotionService?: EmotionService,
    private readonly modelRouter?: ModelRouter,
    private readonly getSettings?: () => {
      activeProvider: "ollama" | "lmstudio" | "copilot";
      models: { defaultByProvider: { ollama: string; lmstudio: string; copilot: string } };
    }
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
      NOVA_PRIMARY_EMOTION_USER_ID,
      outcome.success ? "task_success" : "task_failure",
      emotionSettings
    );
  }

  async generateProposal(): Promise<string> {
    const summary = summarizeOutcomes(
      this.outcomes.map((item) => item.task),
      this.outcomes.map((item) => item.success)
    );
    const moodLine = this.emotionService
      ? formatEmotionSnapshot(this.emotionService.getState(NOVA_PRIMARY_EMOTION_USER_ID))
      : undefined;
    const proposal = generateImprovementPrompt(summary, moodLine);
    this.learningLog.append(proposal, false, "generated", "proposal", {
      registeredSkills: this.registry.count(),
      gitMode: this.gitOps.mode
    });
    this.emotionService?.applySystemEvent(NOVA_PRIMARY_EMOTION_USER_ID, "proposal_created", {
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
    const todayKey = new Date().toISOString().slice(0, 10);
    const generatedToday = this.curiosity.getGeneratedSkillCountForDate(todayKey);
    if (generatedToday >= 5) {
      this.learningLog.append(
        "Skipped auto-skill generation due to daily safety cap",
        true,
        `generatedToday=${generatedToday}; dailyLimit=5`,
        "improvement",
        { taskHint, dailyLimit: 5 }
      );
      return "daily auto-skill cap reached (5/day)";
    }
    const path = generateSkillFromTemplate(skillId, `Auto-generated for repeated failures in: ${taskHint}`);
    const report = runValidationGate();
    const accepted = isValidationPass(report);
    this.learningLog.append(`Generated skill ${skillId}`, accepted, report.details.join("; "), "validation", {
      skillId,
      path
    });
    if (!accepted) {
      this.emotionService?.applySystemEvent(NOVA_PRIMARY_EMOTION_USER_ID, "improvement_failure", {
        enabled: true,
        expressionStyle: "balanced",
        mirrorUserValence: true
      });
      if (policy.autoApplyCodeInSandbox || policy.mode === "auto-apply-code-sandbox") {
        await this.gitOps.rollbackToCheckpoint("latest");
      }
      return `generated ${skillId} but validation failed`;
    }
    const afterIncrement = this.curiosity.markSkillGenerated(todayKey);
    this.learningLog.append(`Generated auto-skill ${skillId} pending user approval`, true, "awaiting approval", "improvement", {
      skillId,
      path,
      approvalRequired: true,
      generatedToday: afterIncrement,
      dailyLimit: 5
    });
    this.curiosity.enqueueQuestions("global", [
      { question: `I drafted a new skill '${skillId}'. Can you review and approve it before I activate it?`, topic: taskHint }
    ]);
    this.emotionService?.applySystemEvent(NOVA_PRIMARY_EMOTION_USER_ID, "improvement_success", {
      enabled: true,
      expressionStyle: "balanced",
      mirrorUserValence: true
    });
    return `generated and validated skill at ${path} (pending user approval before use)`;
  }

  async runIdleLearningCycle(options?: { enabled?: boolean; minFailuresForAutoImprove?: number }): Promise<string> {
    const policy = this.policy;
    if ((options?.enabled ?? policy.backgroundLearningEnabled) !== true) {
      return "background learning is disabled by policy";
    }
    if (this.outcomes.length === 0) {
      this.learningLog.append(
        "Skipped idle learning: waiting for real interaction",
        true,
        "No task outcomes yet. Nova will start autonomous research after real user/task activity.",
        "proposal"
      );
      return "idle cycle skipped: no outcomes yet";
    }
    const summary = summarizeOutcomes(
      this.outcomes.map((item) => item.task),
      this.outcomes.map((item) => item.success)
    );
    if (summary.failures === 0) {
      const hoursSinceResearch = this.hoursSinceLastAcceptedResearch();
      if (hoursSinceResearch !== null && hoursSinceResearch < 6) {
        this.learningLog.append(
          "Skipped idle research to avoid repetitive loop",
          true,
          `No failures detected and last accepted research was ${hoursSinceResearch.toFixed(1)}h ago.`,
          "proposal"
        );
        return "idle cycle skipped: no failures and research still fresh";
      }
    }
    const researchTopics = summary.topFailingTasks.length > 0 ? summary.topFailingTasks : ["Intelligent agent", "TypeScript"];
    const researchNotes = await collectResearchNotes(researchTopics.slice(0, 2));
    const cognition = await this.runAutonomousCognition(researchTopics.slice(0, 2), researchNotes);
    this.learningLog.append("Idle research cycle completed", true, researchNotes, "research", {
      topics: researchTopics.slice(0, 2)
    });
    if (cognition.summary) {
      this.learningLog.append("Model-assisted cognition summary", true, cognition.summary, "research", {
        topics: researchTopics.slice(0, 2),
        provider: cognition.provider
      });
    }
    if (cognition.questions.length > 0) {
      this.curiosity.enqueueQuestions(
        "global",
        cognition.questions.map((question) => ({ question, topic: researchTopics[0] }))
      );
      this.learningLog.append("Queued follow-up user questions", true, cognition.questions.join(" | "), "proposal", {
        queuedQuestions: cognition.questions.length
      });
    }
    this.emotionService?.applySystemEvent(NOVA_PRIMARY_EMOTION_USER_ID, "research_complete", {
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

  consumePendingQuestions(userId: string, limit = 2): string[] {
    return this.curiosity
      .consumeQuestions(userId, limit)
      .map((item) => item.question.trim())
      .filter((item) => item.length > 0);
  }

  private async runAutonomousCognition(topics: string[], researchNotes: string): Promise<AutonomousCognitionResult> {
    if (!this.modelRouter) {
      return { summary: "", questions: [] };
    }
    const settings = this.getSettings?.();
    const localModel = settings?.models?.defaultByProvider?.ollama?.trim() || undefined;
    const moodLine = this.emotionService
      ? formatEmotionSnapshot(this.emotionService.getState(NOVA_PRIMARY_EMOTION_USER_ID))
      : null;
    const prompt = [
      "You are Nova's autonomous learning engine.",
      "Think about improvements to Nova's architecture, skills, reliability, and product quality.",
      "Use these internet notes as facts. Keep output concise and actionable.",
      "Nova has a unified emotional core: let curiosity, stress, or warmth nudge emphasis (never override safety or facts).",
      "Return two sections exactly:",
      "1) SUMMARY: 3 bullet points",
      "2) QUESTIONS_FOR_USER: up to 2 short questions only if truly unresolved after web research.",
      "",
      moodLine ? `Nova unified mood now: ${moodLine}` : "",
      `Topics: ${topics.join(", ") || "general reliability"}`,
      `Internet notes:\n${researchNotes || "No external notes available."}`
    ]
      .filter((line) => line.length > 0)
      .join("\n");
    const messages: ChatMessage[] = [
      { role: "system", content: "Be practical, safety-aware, and avoid hallucinations." },
      { role: "user", content: prompt }
    ];
    const result = await runModelReasoning(this.modelRouter, messages, localModel);
    const raw = result.summary;
    if (!raw) {
      return { summary: "", provider: result.provider, questions: [] };
    }
    const questions = extractQuestions(raw);
    return {
      summary: raw,
      provider: result.provider,
      questions
    };
  }

  getLearningHistoryGroupedByDate(): Record<string, Array<Record<string, unknown>>> {
    return this.learningLog.getGroupedByDate();
  }

  getLearningHistory(): Array<Record<string, unknown>> {
    return this.learningLog.getAll();
  }

  getDiagnostics(): {
    policy: ImprovementPolicy;
    outcomes: { total: number; failures: number; recent: Outcome[] };
    learning: { totalRecords: number; categoryCounts: Record<string, number>; recent: LearningRecordLike[] };
    curiosity: { pendingQuestions: number; skillGenerationByDate: Record<string, number> };
  } {
    const summary = summarizeOutcomes(
      this.outcomes.map((item) => item.task),
      this.outcomes.map((item) => item.success)
    );
    const learning = this.learningLog.getAll() as LearningRecordLike[];
    const categoryCounts = learning.reduce<Record<string, number>>((acc, item) => {
      const key = item.category || "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {});
    return {
      policy: this.policy,
      outcomes: {
        total: this.outcomes.length,
        failures: summary.failures,
        recent: this.outcomes.slice(-50)
      },
      learning: {
        totalRecords: learning.length,
        categoryCounts,
        recent: learning.slice(-120)
      },
      curiosity: this.curiosity.getStats()
    };
  }

  private hoursSinceLastAcceptedResearch(): number | null {
    const recent = this.learningLog.getAll() as LearningRecordLike[];
    const last = [...recent]
      .reverse()
      .find((item) => item.category === "research" && item.accepted === true && typeof item.at === "string");
    if (!last?.at) return null;
    const at = Date.parse(last.at);
    if (!Number.isFinite(at)) return null;
    return Math.max(0, (Date.now() - at) / 3_600_000);
  }
}

async function runModelReasoning(
  router: ModelRouter | undefined,
  messages: ChatMessage[],
  model?: string
): Promise<{ summary: string; provider?: string }> {
  if (!router) return { summary: "" };
  try {
    const response = await router.chatLocalFirst(messages, model);
    return { summary: response.content.trim(), provider: response.provider };
  } catch {
    return { summary: "" };
  }
}

type AutonomousCognitionResult = {
  summary: string;
  provider?: string;
  questions: string[];
};

function extractQuestions(value: string): string[] {
  const section = value.split(/questions_for_user\s*:/i)[1] ?? "";
  const source = section || value;
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.replace(/^[-*\d.)\s]+/, "").trim())
    .filter((line) => line.endsWith("?"));
  return Array.from(new Set(lines)).slice(0, 2);
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
      const payload = await fetchWikipediaSummary(topic);
      const extract = payload.extract?.trim();
      const webSnippet = await fetchDuckDuckGoSnippet(topic);
      if (!extract) {
        notes.push(`${topic}: no reference summary found${webSnippet ? `; web note: ${webSnippet}` : ""}`);
        continue;
      }
      notes.push(`${topic}: ${extract.slice(0, 220)}${webSnippet ? ` | web: ${webSnippet}` : ""}`);
    } catch (error) {
      notes.push(`${topic}: reference lookup failed (${error instanceof Error ? error.message : "unknown error"})`);
    }
  }
  return notes.join("\n");
}

async function fetchWikipediaSummary(topic: string): Promise<{ extract?: string }> {
  const directUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`;
  const direct = await fetch(directUrl);
  if (direct.ok) {
    return (await direct.json()) as { extract?: string };
  }
  const searchUrl = `https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch=${encodeURIComponent(topic)}&utf8=1&format=json&srlimit=1`;
  const search = await fetch(searchUrl);
  if (!search.ok) {
    return {};
  }
  const searchPayload = (await search.json()) as { query?: { search?: Array<{ title?: string }> } };
  const fallbackTitle = searchPayload.query?.search?.[0]?.title?.trim();
  if (!fallbackTitle) {
    return {};
  }
  const fallbackUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(fallbackTitle)}`;
  const fallback = await fetch(fallbackUrl);
  if (!fallback.ok) {
    return {};
  }
  return (await fallback.json()) as { extract?: string };
}

async function fetchDuckDuckGoSnippet(topic: string): Promise<string> {
  const url = `https://api.duckduckgo.com/?q=${encodeURIComponent(topic)}&format=json&no_redirect=1&no_html=1`;
  const response = await fetch(url);
  if (!response.ok) return "";
  const payload = (await response.json()) as {
    AbstractText?: string;
    Answer?: string;
    RelatedTopics?: Array<{ Text?: string }>;
  };
  const answer = payload.AbstractText?.trim() || payload.Answer?.trim();
  if (answer) {
    return answer.slice(0, 220);
  }
  const related = payload.RelatedTopics?.find((item) => typeof item.Text === "string" && item.Text.trim().length > 0)?.Text?.trim();
  return related ? related.slice(0, 220) : "";
}
