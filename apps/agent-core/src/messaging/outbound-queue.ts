import { getDatabase } from "../storage/sqlite.js";

export type OutboundJob = {
  id: number;
  channel: "whatsapp" | "signal";
  recipient: string;
  payload: string;
  attempts: number;
  correlationId?: string;
};

export class OutboundQueueService {
  enqueue(channel: "whatsapp" | "signal", recipient: string, payload: string, correlationId?: string): void {
    const db = getDatabase();
    db.prepare(
      "INSERT INTO outbound_queue (channel, recipient, payload, correlation_id) VALUES (?, ?, ?, ?)"
    ).run(channel, recipient, payload, correlationId ?? null);
  }

  listReady(limit = 20): OutboundJob[] {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT id, channel, recipient, payload, attempts, correlation_id
        FROM outbound_queue
        WHERE status = 'pending'
          AND datetime(next_attempt_at) <= datetime('now')
        ORDER BY id ASC
        LIMIT ?
        `
      )
      .all(limit) as Array<{
      id: number;
      channel: "whatsapp" | "signal";
      recipient: string;
      payload: string;
      attempts: number;
      correlation_id?: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      channel: row.channel,
      recipient: row.recipient,
      payload: row.payload,
      attempts: row.attempts,
      correlationId: row.correlation_id ?? undefined
    }));
  }

  markSuccess(jobId: number): void {
    const db = getDatabase();
    db.prepare("DELETE FROM outbound_queue WHERE id = ?").run(jobId);
  }

  markRetry(job: OutboundJob, error: string): void {
    const attempts = job.attempts + 1;
    if (attempts >= 5) {
      this.moveToDeadLetter(job, error, attempts);
      return;
    }
    const backoffSeconds = Math.min(60, 2 ** attempts);
    const db = getDatabase();
    db.prepare(
      `
      UPDATE outbound_queue
      SET attempts = ?, last_error = ?, next_attempt_at = datetime('now', ?)
      WHERE id = ?
      `
    ).run(attempts, error.slice(0, 500), `+${backoffSeconds} seconds`, job.id);
  }

  private moveToDeadLetter(job: OutboundJob, error: string, attempts: number): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO dead_letter_queue (channel, recipient, payload, attempts, error, correlation_id)
      VALUES (?, ?, ?, ?, ?, ?)
      `
    ).run(job.channel, job.recipient, job.payload, attempts, error.slice(0, 500), job.correlationId ?? null);
    db.prepare("DELETE FROM outbound_queue WHERE id = ?").run(job.id);
  }
}
