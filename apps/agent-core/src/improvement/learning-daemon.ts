import { SelfImprovementLoop } from "./self-improvement-loop.js";
import { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";

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
      return;
    }
    if (now - this.orchestrator.getLastActivityAt() < idleMs) {
      return;
    }
    if (now - this.lastCycleAt < idleMs) {
      return;
    }
    this.lastCycleAt = now;
    try {
      await this.improvement.runIdleLearningCycle({
        enabled: configured?.enabled,
        minFailuresForAutoImprove: configured?.minFailuresForAutoImprove
      });
    } catch {
      // best-effort daemon cycle
    }
  }
}
