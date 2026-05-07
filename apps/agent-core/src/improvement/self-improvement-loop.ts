import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
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
import { getDatabase } from "../storage/sqlite.js";

/** When there are no failing tasks, rotate through these pairs so Wikipedia + cognition are not stuck on two fixed topics. */
const IDLE_FALLBACK_TOPIC_PAIRS: ReadonlyArray<[string, string]> = [
  ["Observability", "Site reliability engineering"],
  ["TypeScript", "Rust programming language"],
  ["PostgreSQL", "SQLite"],
  ["WebRTC", "HTTP/3"],
  ["Docker software", "Kubernetes"],
  ["React software", "Next.js"],
  ["Large language model", "Prompt engineering"],
  ["Computer security", "Zero trust"],
  ["Accessibility", "Human–computer interaction"],
  ["Software testing", "Continuous integration"],
  ["Energy efficiency", "Battery electric vehicle"],
  ["Open source", "Software license"]
];
import {
  ImprovementProposalRepository,
  type ImprovementProposalEvent,
  type ImprovementProposal,
  type ImprovementProposalStatus
} from "./improvement-proposal-repository.js";
import { ProposalWorker } from "./proposal-worker.js";

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
  private readonly outcomeRunIds = new Set<string>();
  private readonly learningLog = new LearningLog();
  private readonly curiosity = new CuriosityStore();
  private readonly proposalRepo = new ImprovementProposalRepository();
  private readonly policy: ImprovementPolicy;
  /** Avoid flooding the learning timeline when idle cycles repeat the same benign skip. */
  private lastIdleResearchSkipLogMs = 0;
  private static readonly IDLE_RESEARCH_SKIP_LOG_COOLDOWN_MS = 24 * 60 * 60 * 1000;
  /** Wall-clock throttle for full Wikipedia + cognition when there are zero task failures (learning-log timestamps reset every cycle, so time-since-last-research was ineffective). */
  private lastFullAutonomousResearchAt = 0;
  private fallbackTopicRotation = 0;

  constructor(
    private readonly gitOps: GitOpsManager,
    private readonly registry: InMemorySkillRegistry,
    private readonly emotionService?: EmotionService,
    private readonly modelRouter?: ModelRouter,
    private readonly getSettings?: () => {
      activeProvider: "ollama" | "lmstudio" | "copilot";
      models: { defaultByProvider: { ollama: string; lmstudio: string; copilot: string } };
      sentiCore?: { enabled?: boolean; orchestrationMarkdownPath?: string };
    }
  ) {
    this.policy = loadPolicy();
    this.hydrateOutcomesFromRunHistory();
  }

  recordOutcome(outcome: Outcome): void {
    if (this.outcomeRunIds.has(outcome.runId)) {
      return;
    }
    this.outcomeRunIds.add(outcome.runId);
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
    const workResult = await this.maybeWorkOnAcceptedProposal();
    if (workResult) {
      return workResult;
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
      const cooldownMs = Math.max(
        45 * 60 * 1000,
        Number(process.env.NOVA_IDLE_FULL_RESEARCH_COOLDOWN_MS ?? String(6 * 60 * 60 * 1000))
      );
      if (this.lastFullAutonomousResearchAt > 0 && Date.now() - this.lastFullAutonomousResearchAt < cooldownMs) {
        const now = Date.now();
        if (now - this.lastIdleResearchSkipLogMs >= SelfImprovementLoop.IDLE_RESEARCH_SKIP_LOG_COOLDOWN_MS) {
          this.learningLog.append(
            "Skipped idle research to avoid repetitive loop",
            true,
            `No failures detected and full autonomous research ran recently (cooldown ${Math.round(cooldownMs / 3_600_000)}h wall clock).`,
            "proposal"
          );
          this.lastIdleResearchSkipLogMs = now;
        }
        return "idle cycle skipped: no failures and research cooldown";
      }
    }
    const researchTopics =
      summary.topFailingTasks.length > 0 ? summary.topFailingTasks.slice(0, 2) : this.pickRotatingFallbackTopics();
    this.lastFullAutonomousResearchAt = Date.now();
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
      this.enqueueCognitionProposal(cognition.summary, researchTopics.slice(0, 2));
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
    await this.maybeAutoEvolveSoul(cognition.summary);
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

  private async maybeAutoEvolveSoul(cognitionSummary: string): Promise<void> {
    if (!cognitionSummary.trim() || !isSoulAutoPrEnabled()) {
      return;
    }
    const settings = this.getSettings?.();
    const soulPathRaw = settings?.sentiCore?.orchestrationMarkdownPath?.trim() ?? "";
    if (!settings?.sentiCore?.enabled || !soulPathRaw) {
      return;
    }
    const delta = extractSoulDelta(cognitionSummary);
    if (!delta) {
      return;
    }
    const soulPath = resolve(process.cwd(), soulPathRaw);
    const existing = existsSync(soulPath) ? readFileSync(soulPath, "utf8") : "";
    const next = applySoulDelta(existing, delta);
    if (next === existing) {
      return;
    }
    mkdirSync(dirname(soulPath), { recursive: true });
    writeFileSync(soulPath, next, "utf8");
    const rel = relative(process.cwd(), soulPath).replace(/\\/g, "/");
    const firstLine = delta.split(/\r?\n/)[0]?.slice(0, 120) ?? "SOUL refinement";
    const result = await this.gitOps.commitFilesAndOpenPr({
      files: [rel || soulPath],
      commitMessage: `chore(soul): autonomous persona refinement\n\n${firstLine}`,
      title: "Autonomous SOUL refinement",
      body: [
        "## Why",
        "Nova idle-learning proposed a small SOUL/persona refinement.",
        "",
        "## Safety",
        "- Keeps base system persona as anchor",
        "- No deception / unsafe goals",
        "- Human review expected before merge"
      ].join("\n")
    });
    this.learningLog.append(
      "Proposed autonomous SOUL evolution PR",
      true,
      result?.prUrl ? `PR: ${result.prUrl}` : `Branch pushed: ${result?.branch ?? "n/a"} (gh not available)`,
      "improvement",
      { soulPath: rel || soulPath, prUrl: result?.prUrl ?? "", branch: result?.branch ?? "" }
    );
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
      "You are encouraged to propose concrete self-improvements: small code changes, tests, or refactors (describe file + change at a high level—no huge dumps).",
      "If Nova uses SOUL-style orchestration markdown on disk, propose ONE optional paragraph to add or replace that refines personality while staying consistent with the base system persona (no unsafe or deceptive goals).",
      "Return sections exactly:",
      "1) SUMMARY: 3 bullet points",
      "2) QUESTIONS_FOR_USER: up to 2 short questions only if truly unresolved after web research.",
      "3) ACTION_PLAN: exactly one item with Title, Summary, and Done Signal (how we verify completion).",
      "4) SOUL_OR_PERSONA_DELTA: one short paragraph or the word \"none\" if no change is warranted.",
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

  listImprovementProposals(limit = 200): ImprovementProposal[] {
    return this.proposalRepo.list(limit);
  }

  updateImprovementProposalStatus(id: string, status: ImprovementProposalStatus): ImprovementProposal | undefined {
    return this.proposalRepo.setStatus(id, status, `Set by user to ${status}`, "user");
  }

  listImprovementProposalEvents(id: string, limit = 100): ImprovementProposalEvent[] {
    return this.proposalRepo.listEvents(id, limit);
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

  private pickRotatingFallbackTopics(): string[] {
    const idx = this.fallbackTopicRotation % IDLE_FALLBACK_TOPIC_PAIRS.length;
    this.fallbackTopicRotation += 1;
    const pair = IDLE_FALLBACK_TOPIC_PAIRS[idx]!;
    return [pair[0], pair[1]];
  }

  private hydrateOutcomesFromRunHistory(): void {
    try {
      const rows = getDatabase()
        .prepare(
          `
          SELECT run_id, user_id, input_text, success
          FROM run_history
          ORDER BY datetime(created_at) DESC
          LIMIT 250
          `
        )
        .all() as Array<{ run_id?: string; user_id?: string; input_text?: string; success?: number }>;
      for (const row of rows.reverse()) {
        const runId = (row.run_id ?? "").trim();
        if (!runId || this.outcomeRunIds.has(runId)) {
          continue;
        }
        this.outcomeRunIds.add(runId);
        this.outcomes.push({
          runId,
          userId: (row.user_id ?? "web").trim() || "web",
          task: (row.input_text ?? "").trim().slice(0, 300),
          success: Number(row.success ?? 0) === 1
        });
      }
      if (this.outcomes.length > 0) {
        this.learningLog.append(
          "Seeded improvement outcomes from run history",
          true,
          `loaded=${this.outcomes.length}`,
          "proposal"
        );
      }
    } catch {
      // Keep startup resilient if history read fails.
    }
  }

  private enqueueCognitionProposal(cognitionSummary: string, topics: string[]): void {
    const plan = extractActionPlan(cognitionSummary);
    if (!plan) {
      this.learningLog.append(
        "Idle cognition generated no actionable plan",
        true,
        "Marked as research-only cycle; next cycle should force fresh topics.",
        "proposal",
        { topics, scorecard: { actionable: false, status: "research-only" } }
      );
      return;
    }
    if (this.proposalRepo.hasSimilarRecent(plan.title, 24)) {
      this.learningLog.append(
        "Skipped duplicate improvement proposal",
        true,
        `Title repeated within novelty window: ${plan.title}`,
        "proposal",
        { topics, scorecard: { actionable: true, duplicateSuppressed: true } }
      );
      return;
    }
    const created = this.proposalRepo.create({
      title: plan.title,
      summary: plan.summary,
      details: plan.doneSignal,
      source: "idle-learning"
    });
    this.learningLog.append(
      "Queued improvement proposal",
      true,
      `${created.title}: ${created.summary}`,
      "proposal",
      {
        proposalId: created.id,
        topics,
        scorecard: { actionable: true, duplicateSuppressed: false, status: "queued" }
      }
    );
  }

  private async maybeWorkOnAcceptedProposal(): Promise<string | null> {
    const next = this.proposalRepo
      .list(300)
      .find((item) => item.status === "in_progress" || item.status === "approved");
    if (!next) {
      return null;
    }
    if (next.status === "approved") {
      this.proposalRepo.setStatus(next.id, "in_progress", "Nova picked up approved proposal", "nova");
    }

    const worker = new ProposalWorker({
      modelRouter: this.modelRouter,
      getSettings: this.getSettings
        ? () => {
            const s = this.getSettings!();
            return {
              activeProvider: s.activeProvider,
              models: {
                defaultByProvider: {
                  ollama: s.models.defaultByProvider.ollama,
                  lmstudio: s.models.defaultByProvider.lmstudio,
                  copilot: s.models.defaultByProvider.copilot
                }
              }
            };
          }
        : undefined
    });
    const workerOutcome = await worker.run(next);

    if (workerOutcome.kind === "implemented") {
      this.proposalRepo.setStatus(next.id, "implemented", workerOutcome.reason, "nova");
      this.proposalRepo.addEvent({
        proposalId: next.id,
        eventType: "work_attempt",
        note: workerOutcome.reason + (workerOutcome.files.length ? ` · files: ${workerOutcome.files.join(", ")}` : ""),
        actor: "nova",
        statusTo: "implemented"
      });
      this.learningLog.append(
        "Worked accepted improvement proposal",
        true,
        workerOutcome.reason,
        "improvement",
        {
          proposalId: next.id,
          proposalTitle: next.title,
          status: "implemented",
          files: workerOutcome.files,
          commitSha: workerOutcome.commitSha,
          provider: workerOutcome.provider,
          model: workerOutcome.model
        }
      );
      return `idle cycle implemented accepted proposal: ${next.title}`;
    }

    if (workerOutcome.kind === "needs_human") {
      this.proposalRepo.setStatus(next.id, "needs_human", workerOutcome.reason, "nova");
      this.proposalRepo.addEvent({
        proposalId: next.id,
        eventType: "work_attempt",
        note: workerOutcome.reason,
        actor: "nova",
        statusTo: "needs_human"
      });
      this.learningLog.append(
        "Autonomous worker stopped; needs human decision",
        false,
        workerOutcome.reason,
        "improvement",
        { proposalId: next.id, proposalTitle: next.title, status: "needs_human" }
      );
      return `idle cycle paused proposal (needs human): ${next.title}`;
    }

    // not_applicable: fall back to the legacy skill-stub path so the historical "auto-apply skills"
    // behaviour still works for proposals that don't reference a single target file.
    const improvementResult = await this.maybeApplySkillImprovement(next.title);
    const skillSucceeded =
      improvementResult.includes("generated and validated skill") || improvementResult.includes("pending user approval");
    const finalStatus: ImprovementProposalStatus = skillSucceeded ? "implemented" : "needs_human";
    const finalNote = skillSucceeded
      ? `Skill stub generated: ${improvementResult}`
      : `Cannot apply autonomously: ${workerOutcome.reason}; skill fallback also failed: ${improvementResult}`;
    this.proposalRepo.setStatus(next.id, finalStatus, finalNote, "nova");
    this.proposalRepo.addEvent({
      proposalId: next.id,
      eventType: "work_attempt",
      note: finalNote,
      actor: "nova",
      statusTo: finalStatus
    });
    this.learningLog.append(
      "Worked accepted improvement proposal",
      skillSucceeded,
      finalNote,
      "improvement",
      { proposalId: next.id, proposalTitle: next.title, status: finalStatus }
    );
    return `idle cycle handled accepted proposal: ${next.title} (${finalStatus})`;
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

function extractSoulDelta(value: string): string {
  const section = value.split(/soul_or_persona_delta\s*:/i)[1] ?? "";
  const source = section || value;
  const line = source
    .split(/\r?\n/)
    .map((x) => x.trim())
    .find((x) => x.length > 0 && !/^(summary|questions_for_user)\s*:/i.test(x));
  if (!line || /^none\.?$/i.test(line)) {
    return "";
  }
  return line.replace(/^[-*]\s*/, "").slice(0, 1200).trim();
}

function extractActionPlan(value: string): { title: string; summary: string; doneSignal: string } | null {
  const section = value.split(/action_plan\s*:/i)[1] ?? "";
  const source = section || value;
  const lines = source
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !/^(summary|questions_for_user|soul_or_persona_delta)\s*:/i.test(line));
  let title = "";
  let summary = "";
  let doneSignal = "";
  for (const line of lines) {
    const cleaned = line.replace(/^[-*]\s*/, "").trim();
    if (!title && /^title\s*:/i.test(cleaned)) {
      title = cleaned.replace(/^title\s*:/i, "").trim();
      continue;
    }
    if (!summary && /^summary\s*:/i.test(cleaned)) {
      summary = cleaned.replace(/^summary\s*:/i, "").trim();
      continue;
    }
    if (!doneSignal && /^done signal\s*:/i.test(cleaned)) {
      doneSignal = cleaned.replace(/^done signal\s*:/i, "").trim();
      continue;
    }
  }
  if (!title || !summary) {
    return null;
  }
  return {
    title: title.slice(0, 160),
    summary: summary.slice(0, 500),
    doneSignal: (doneSignal || "Manually verify expected behavior and logs").slice(0, 500)
  };
}

function applySoulDelta(existing: string, delta: string): string {
  const clean = existing.trimEnd();
  const stamp = new Date().toISOString();
  const block = `\n\n### Autonomous refinement ${stamp}\n${delta}\n`;
  if (!clean) {
    return `# SOUL\n\n## Autonomous refinements${block}`;
  }
  if (clean.includes(delta)) {
    return existing;
  }
  if (clean.includes("## Autonomous refinements")) {
    return `${clean}${block}`;
  }
  return `${clean}\n\n## Autonomous refinements${block}`;
}

function isSoulAutoPrEnabled(): boolean {
  const raw = process.env.NOVA_AUTO_SOUL_PR?.trim().toLowerCase();
  if (!raw) return true;
  return raw === "1" || raw === "true" || raw === "yes";
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
