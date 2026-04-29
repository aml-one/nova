import { IdentityBackupService } from "./identity-backup-service.js";

type IdentityBackupSettings = {
  enabled: boolean;
  intervalDays: number;
  labelPrefix: string;
};

export class IdentityBackupDaemon {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly backupService: IdentityBackupService,
    private readonly options: {
      getSettings: () => IdentityBackupSettings;
    }
  ) {}

  start(): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), 5 * 60 * 1000);
    this.timer.unref();
    void this.tick();
  }

  stop(): void {
    if (!this.timer) {
      return;
    }
    clearInterval(this.timer);
    this.timer = undefined;
  }

  private async tick(): Promise<void> {
    if (this.running) {
      return;
    }
    const settings = this.options.getSettings();
    if (!settings.enabled) {
      return;
    }
    const now = Date.now();
    const lastSuccess = this.backupService.getLatestSuccess();
    const lastRun = this.backupService.getLatestRun();
    const intervalMs = Math.max(1, settings.intervalDays) * 24 * 60 * 60 * 1000;
    if (lastSuccess?.createdAt) {
      const elapsed = now - new Date(lastSuccess.createdAt).getTime();
      if (elapsed < intervalMs) {
        return;
      }
    }
    if (lastRun?.status === "failed" && lastRun.createdAt) {
      const elapsedSinceFail = now - new Date(lastRun.createdAt).getTime();
      if (elapsedSinceFail < 6 * 60 * 60 * 1000) {
        return;
      }
    }
    this.running = true;
    try {
      const label = `${settings.labelPrefix}-${new Date().toISOString().slice(0, 10)}`;
      await this.backupService.createAndPushIdentityBackup(label, "auto");
    } catch {
      // Failure details are already recorded by IdentityBackupService.
    } finally {
      this.running = false;
    }
  }
}
