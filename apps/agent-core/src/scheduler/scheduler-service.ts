import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";

export class SchedulerService {
  private timer: NodeJS.Timeout | undefined;

  start(onTask: (payload: string) => Promise<void>): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(onTask), 15_000);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  restart(onTask: (payload: string) => Promise<void>): void {
    this.stop();
    this.start(onTask);
  }

  isRunning(): boolean {
    return Boolean(this.timer);
  }

  schedule(cronExpr: string, payload: string): string {
    const id = randomUUID();
    const nextRun = computeNextRun(cronExpr);
    const db = getDatabase();
    db.prepare("INSERT INTO scheduled_tasks (id, cron_expr, task_payload, next_run_at, enabled) VALUES (?, ?, ?, ?, 1)").run(
      id,
      cronExpr,
      payload,
      nextRun
    );
    return id;
  }

  private async tick(onTask: (payload: string) => Promise<void>): Promise<void> {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT id, cron_expr, task_payload
        FROM scheduled_tasks
        WHERE enabled = 1
          AND datetime(next_run_at) <= datetime('now')
        `
      )
      .all() as Array<{ id: string; cron_expr: string; task_payload: string }>;
    for (const row of rows) {
      await onTask(row.task_payload);
      const nextRun = computeNextRun(row.cron_expr);
      db.prepare("UPDATE scheduled_tasks SET next_run_at = ? WHERE id = ?").run(nextRun, row.id);
    }
  }
}

function computeNextRun(cronExpr: string): string {
  // Minimal parser: supports "*/N * * * *" and defaults to every minute.
  const minuteMatch = cronExpr.match(/^\*\/(\d+)\s+\*\s+\*\s+\*\s+\*$/);
  const minutes = minuteMatch?.[1] ? Math.max(1, Number(minuteMatch[1])) : 1;
  const next = new Date(Date.now() + minutes * 60_000);
  return next.toISOString();
}
