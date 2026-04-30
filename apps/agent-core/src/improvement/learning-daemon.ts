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
      this.thoughtLog.append({
        category: "learning",
        title: "Idle learning cycle completed",
        content: result
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
