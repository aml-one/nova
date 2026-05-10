import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";
import { claimDueReminders, claimDueTimers, formatReminderOutboundBody } from "./reminder-repository.js";

/**
 * Polls due reminders/timers and enqueues outbound Signal/WhatsApp rows.
 * Uses the same `outbound_queue` contract as {@link OutboundDispatcher}.
 */
export class ReminderTimerDaemon {
  private timer: NodeJS.Timeout | undefined;

  start(intervalMs = 5000): void {
    this.stop();
    this.timer = setInterval(() => this.tick(), intervalMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  private tick(): void {
    const now = Date.now();
    try {
      for (const row of claimDueTimers(now)) {
        const label = (row.label ?? "Timer").trim() || "Timer";
        const payload = `⏱ ${label} — time’s up.`;
        this.enqueue(row.channel as "signal" | "whatsapp", row.recipient, payload);
      }
      for (const row of claimDueReminders(now)) {
        this.enqueue(row.channel as "signal" | "whatsapp", row.recipient, formatReminderOutboundBody(row));
      }
    } catch {
      /* never crash agent-core */
    }
  }

  private enqueue(channel: "signal" | "whatsapp", recipient: string, payload: string): void {
    const r = recipient.trim();
    if (!r) return;
    getDatabase()
      .prepare(
        `INSERT INTO outbound_queue (channel, recipient, payload, attempts, next_attempt_at, status, correlation_id)
         VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, 'pending', ?)`
      )
      .run(channel, r, payload.slice(0, 4096), randomUUID());
  }
}
