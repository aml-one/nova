import { createHash } from "node:crypto";
import { SelfImprovementLoop } from "./self-improvement-loop.js";
import { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import { ThoughtRepository } from "../storage/repositories/thought-repository.js";

type LearningDaemonOptions = {
  getLearningSettings?: () => {
    enabled: boolean;
    idleMinutes: number;
    intervalMs: number;
    minFailuresForAutoImprove: number;
  };
};

export class LearningDaemon {
  private timer: NodeJS.Timeout | undefined;
  private lastCycleAt = 0;
  private lastIdleReason = "";
  private lastIdleReasonLoggedAt = 0;
  private cycleInProgress = false;
  private lastCycleStartedAt = 0;
  private lastCycleCompletedAt = 0;
  private lastCycleResult = "not started";
  private lastCycleError = "";
  private readonly thoughtLog = new ThoughtRepository();
  /** Suppress identical "cycle completed" thoughts when the learning synopsis has not changed (hash of result + summary). */
  private lastCompletedThoughtFingerprint = "";
  private lastCompletedThoughtAt = 0;

  constructor(
    private readonly improvement: SelfImprovementLoop,
    private readonly orchestrator: TaskOrchestrator,
    private readonly options: LearningDaemonOptions = {}
  ) {}

  start(): void {
    this.stop();
    const intervalMs =
      this.options.getLearningSettings?.().intervalMs ?? Number(process.env.NOVA_LEARNING_INTERVAL_MS ?? "120000");
    this.lastCycleResult = "daemon started";
    this.timer = setInterval(() => void this.tick(), Math.max(15000, intervalMs));
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private async tick(): Promise<void> {
    const now = Date.now();
    const configured = this.options.getLearningSettings?.();
    const idleMinutes = configured?.idleMinutes ?? Number(process.env.NOVA_LEARNING_IDLE_MINUTES ?? "3");
    const idleMs = Math.max(60_000, idleMinutes * 60_000);
    const cycleTimeoutMs = Math.max(30_000, Number(process.env.NOVA_LEARNING_CYCLE_TIMEOUT_MS ?? "180000"));
    if (this.cycleInProgress) {
      this.recordIdleReason("Learning cycle already running");
      return;
    }
    if (this.orchestrator.isBusy()) {
      this.recordIdleReason("Orchestrator busy");
      return;
    }
    if (now - this.orchestrator.getLastActivityAt() < idleMs) {
      this.recordIdleReason("Recent user activity");
      return;
    }
    const minGapBetweenCyclesMs = Math.min(120_000, Math.max(45_000, Math.floor(idleMs / 4)));
    if (now - this.lastCycleAt < minGapBetweenCyclesMs) {
      this.recordIdleReason("Waiting cooldown");
      return;
    }
    this.lastIdleReason = "";
    this.lastIdleReasonLoggedAt = 0;
    this.lastCycleAt = now;
    this.lastCycleStartedAt = now;
    this.cycleInProgress = true;
    if (shouldLogCycleStartThought()) {
      this.thoughtLog.append({
        category: "learning",
        title: "Idle learning cycle started",
        content: `idleMinutes=${idleMinutes}`
      });
    }
    try {
      const result = await withTimeout(
        this.improvement.runIdleLearningCycle({
          enabled: configured?.enabled,
          minFailuresForAutoImprove: configured?.minFailuresForAutoImprove
        }),
        cycleTimeoutMs
      );
      const details = buildLatestLearningDetails(this.improvement.getLearningHistory());
      const proposalQueue = buildProposalQueueSnapshot(this.improvement);
      this.lastCycleResult = result;
      this.lastCycleError = "";
      const fingerprint = fingerprintLearningCompleted(result, details.summary);
      const suppressMs = Math.max(
        120_000,
        Number(process.env.NOVA_LEARNING_DUP_COMPLETED_THOUGHT_MS ?? String(3 * 60 * 60 * 1000))
      );
      const nowDone = Date.now();
      const isDup =
        fingerprint === this.lastCompletedThoughtFingerprint &&
        this.lastCompletedThoughtFingerprint.length > 0 &&
        nowDone - this.lastCompletedThoughtAt < suppressMs;
      if (!isDup) {
        this.lastCompletedThoughtFingerprint = fingerprint;
        this.lastCompletedThoughtAt = nowDone;
        this.thoughtLog.append({
          category: "learning",
          title: "Idle learning cycle completed",
          content: [result, details.summary, "Open /learning to accept or track improvement proposals."].filter(Boolean).join("\n"),
          metadata: { ...details.metadata, proposalQueue }
        });
      }
    } catch (error) {
      this.lastCycleError = error instanceof Error ? error.message : "unknown cycle error";
      this.lastCycleResult = "failed";
      this.thoughtLog.append({
        category: "learning",
        title: "Idle learning cycle failed",
        content: this.lastCycleError
      });
    } finally {
      this.cycleInProgress = false;
      this.lastCycleCompletedAt = Date.now();
    }
  }

  private recordIdleReason(reason: string): void {
    const now = Date.now();
    const shouldThrottle =
      this.lastIdleReason === reason && now - this.lastIdleReasonLoggedAt < Math.max(60_000, Number(process.env.NOVA_LEARNING_IDLE_LOG_EVERY_MS ?? "600000"));
    if (shouldThrottle) {
      return;
    }
    this.lastIdleReason = reason;
    this.lastIdleReasonLoggedAt = now;
    this.thoughtLog.append({
      category: "learning",
      title: "Idle monitor",
      content: reason
    });
  }

  getStatus(): {
    running: boolean;
    cycleInProgress: boolean;
    lastCycleAt: number;
    lastCycleStartedAt: number;
    lastCycleCompletedAt: number;
    lastCycleResult: string;
    lastCycleError?: string;
    lastIdleReason?: string;
    orchestratorBusy: boolean;
    lastUserActivityAt: number;
  } {
    return {
      running: Boolean(this.timer),
      cycleInProgress: this.cycleInProgress,
      lastCycleAt: this.lastCycleAt,
      lastCycleStartedAt: this.lastCycleStartedAt,
      lastCycleCompletedAt: this.lastCycleCompletedAt,
      lastCycleResult: this.lastCycleResult,
      lastCycleError: this.lastCycleError || undefined,
      lastIdleReason: this.lastIdleReason || undefined,
      orchestratorBusy: this.orchestrator.isBusy(),
      lastUserActivityAt: this.orchestrator.getLastActivityAt()
    };
  }
}

function buildLatestLearningDetails(history: Array<Record<string, unknown>>): {
  summary: string;
  metadata: Record<string, unknown>;
} {
  const recent = history.slice(-10).reverse();
  const latestResearch = recent.find((item) => item.category === "research");
  const latestImprovement = recent.find((item) => item.category === "improvement");
  const researchResult = typeof latestResearch?.result === "string" ? latestResearch.result : "";
  const improvementResult = typeof latestImprovement?.result === "string" ? latestImprovement.result : "";
  const researchDetails =
    latestResearch && typeof latestResearch.details === "object" && latestResearch.details !== null
      ? (latestResearch.details as Record<string, unknown>)
      : undefined;
  const topics = Array.isArray(researchDetails?.topics)
    ? (researchDetails.topics as unknown[]).map((item) => String(item))
    : [];
  const summaryParts: string[] = [];
  if (topics.length > 0) {
    summaryParts.push(`Researched: ${topics.join(", ")}`);
  }
  if (researchResult) {
    summaryParts.push(`Notes: ${researchResult.split("\n").slice(0, 2).join(" | ")}`);
  }
  if (improvementResult) {
    summaryParts.push(`Improvement: ${improvementResult}`);
  }
  const latestProposal = recent.find((item) => item.category === "proposal");
  let latestProposalId: string | undefined;
  if (latestProposal && typeof latestProposal.proposal === "string") {
    const detailsObj =
      latestProposal.details && typeof latestProposal.details === "object" && latestProposal.details !== null
        ? (latestProposal.details as Record<string, unknown>)
        : undefined;
    const pid = typeof detailsObj?.proposalId === "string" ? detailsObj.proposalId : undefined;
    if (pid) latestProposalId = pid;
    const line = pid
      ? `Latest proposal: ${latestProposal.proposal.slice(0, 140)} (id ${pid.slice(0, 8)}…)`
      : `Latest proposal: ${latestProposal.proposal.slice(0, 160)}`;
    summaryParts.push(line);
  }
  return {
    summary: summaryParts.join("\n"),
    metadata: {
      researchTopics: topics,
      researchSummary: researchResult,
      improvementSummary: improvementResult,
      latestProposalId
    }
  };
}

function buildProposalQueueSnapshot(improvement: SelfImprovementLoop): Record<string, unknown> {
  try {
    const items = improvement.listImprovementProposals(250);
    const count = (s: "proposed" | "approved" | "in_progress" | "implemented") => items.filter((i) => i.status === s).length;
    const top = items.slice(0, 4).map((i) => ({ title: i.title, status: i.status }));
    return {
      proposed: count("proposed"),
      approved: count("approved"),
      in_progress: count("in_progress"),
      implemented: count("implemented"),
      recent: top
    };
  } catch {
    return { error: "queue_unavailable" };
  }
}

async function withTimeout<T>(task: Promise<T>, timeoutMs: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`idle learning timed out after ${timeoutMs}ms`)), timeoutMs);
      })
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
