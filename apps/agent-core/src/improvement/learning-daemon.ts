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
  private readonly thoughtLog = new ThoughtRepository();

  constructor(
    private readonly improvement: SelfImprovementLoop,
    private readonly orchestrator: TaskOrchestrator,
    private readonly options: LearningDaemonOptions = {}
  ) {}

  start(): void {
    this.stop();
    const intervalMs =
      this.options.getLearningSettings?.().intervalMs ?? Number(process.env.NOVA_LEARNING_INTERVAL_MS ?? "120000");
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
    if (this.orchestrator.isBusy()) {
      this.recordIdleReason("Orchestrator busy");
      return;
    }
    if (now - this.orchestrator.getLastActivityAt() < idleMs) {
      this.recordIdleReason("Recent user activity");
      return;
    }
    if (now - this.lastCycleAt < idleMs) {
      this.recordIdleReason("Waiting cooldown");
      return;
    }
    this.lastIdleReason = "";
    this.lastCycleAt = now;
    this.thoughtLog.append({
      category: "learning",
      title: "Idle learning cycle started",
      content: `idleMinutes=${idleMinutes}`
    });
    try {
      const result = await this.improvement.runIdleLearningCycle({
        enabled: configured?.enabled,
        minFailuresForAutoImprove: configured?.minFailuresForAutoImprove
      });
      const details = buildLatestLearningDetails(this.improvement.getLearningHistory());
      this.thoughtLog.append({
        category: "learning",
        title: "Idle learning cycle completed",
        content: [result, details.summary].filter(Boolean).join("\n"),
        metadata: details.metadata
      });
    } catch {
      this.thoughtLog.append({
        category: "learning",
        title: "Idle learning cycle failed",
        content: "best-effort cycle encountered an error"
      });
    }
  }

  private recordIdleReason(reason: string): void {
    if (this.lastIdleReason === reason) {
      return;
    }
    this.lastIdleReason = reason;
    this.thoughtLog.append({
      category: "learning",
      title: "Idle monitor",
      content: reason
    });
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
  return {
    summary: summaryParts.join("\n"),
    metadata: {
      researchTopics: topics,
      researchSummary: researchResult,
      improvementSummary: improvementResult
    }
  };
}
