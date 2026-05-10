import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";

export type UserReminderRow = {
  id: string;
  user_id: string;
  channel: string;
  recipient: string;
  body: string;
  fire_at_ms: number | null;
  created_at_ms: number;
  fired_at_ms: number | null;
  dismissed: number;
  requested_by_name: string | null;
  target_person_id: string | null;
};

export type UserTimerRow = {
  id: string;
  user_id: string;
  channel: string;
  recipient: string;
  label: string | null;
  ends_at_ms: number;
  fired_at_ms: number | null;
  created_at_ms: number;
};

/**
 * Timers are persisted only as `ends_at_ms` in SQLite — no in-memory countdown.
 * Survives agent-core restarts; the daemon compares wall clock to `ends_at_ms`.
 */
export function insertReminder(input: {
  userId: string;
  channel: "signal" | "whatsapp";
  recipient: string;
  body: string;
  fireAtMs: number | null;
  requestedByName?: string | null;
  targetPersonId?: string | null;
}): string {
  const id = randomUUID();
  const now = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO user_reminders (id, user_id, channel, recipient, body, fire_at_ms, created_at_ms, dismissed, requested_by_name, target_person_id)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
    )
    .run(
      id,
      input.userId,
      input.channel,
      input.recipient,
      input.body,
      input.fireAtMs,
      now,
      input.requestedByName ?? null,
      input.targetPersonId ?? null
    );
  return id;
}

export function insertTimer(input: {
  userId: string;
  channel: "signal" | "whatsapp";
  recipient: string;
  label: string;
  endsAtMs: number;
}): string {
  const id = randomUUID();
  const now = Date.now();
  getDatabase()
    .prepare(
      `INSERT INTO user_timers (id, user_id, channel, recipient, label, ends_at_ms, created_at_ms)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .run(id, input.userId, input.channel, input.recipient, input.label, input.endsAtMs, now);
  return id;
}

export function listActiveTimers(userId: string): UserTimerRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, user_id, channel, recipient, label, ends_at_ms, fired_at_ms, created_at_ms
       FROM user_timers WHERE user_id = ? AND fired_at_ms IS NULL ORDER BY ends_at_ms ASC`
    )
    .all(userId) as UserTimerRow[];
}

export function listOpenReminders(userId: string): UserReminderRow[] {
  return getDatabase()
    .prepare(
      `SELECT id, user_id, channel, recipient, body, fire_at_ms, created_at_ms, fired_at_ms, dismissed,
              requested_by_name, target_person_id
       FROM user_reminders WHERE user_id = ? AND dismissed = 0 AND fired_at_ms IS NULL
       ORDER BY CASE WHEN fire_at_ms IS NULL THEN 1 ELSE 0 END, fire_at_ms ASC, created_at_ms DESC`
    )
    .all(userId) as UserReminderRow[];
}

export function dismissReminder(userId: string, id: string): boolean {
  const r = getDatabase()
    .prepare(`UPDATE user_reminders SET dismissed = 1 WHERE id = ? AND user_id = ? AND dismissed = 0`)
    .run(id, userId);
  return r.changes > 0;
}

export function cancelTimers(userId: string): number {
  const now = Date.now();
  const r = getDatabase()
    .prepare(`UPDATE user_timers SET fired_at_ms = ? WHERE user_id = ? AND fired_at_ms IS NULL`)
    .run(now, userId);
  return Number(r.changes);
}

export function claimDueReminders(nowMs: number): UserReminderRow[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, user_id, channel, recipient, body, fire_at_ms, created_at_ms, fired_at_ms, dismissed,
              requested_by_name, target_person_id
       FROM user_reminders
       WHERE dismissed = 0 AND fired_at_ms IS NULL AND fire_at_ms IS NOT NULL AND fire_at_ms <= ?
       LIMIT 50`
    )
    .all(nowMs) as UserReminderRow[];
  for (const row of rows) {
    db.prepare(`UPDATE user_reminders SET fired_at_ms = ? WHERE id = ? AND fired_at_ms IS NULL`).run(nowMs, row.id);
  }
  return rows;
}

export function claimDueTimers(nowMs: number): UserTimerRow[] {
  const db = getDatabase();
  const rows = db
    .prepare(
      `SELECT id, user_id, channel, recipient, label, ends_at_ms, fired_at_ms, created_at_ms
       FROM user_timers WHERE fired_at_ms IS NULL AND ends_at_ms <= ? LIMIT 50`
    )
    .all(nowMs) as UserTimerRow[];
  for (const row of rows) {
    db.prepare(`UPDATE user_timers SET fired_at_ms = ? WHERE id = ? AND fired_at_ms IS NULL`).run(nowMs, row.id);
  }
  return rows;
}

export function formatReminderOutboundBody(row: UserReminderRow): string {
  const by = row.requested_by_name?.trim();
  if (by) {
    return `${by} asked me to remind you: ${row.body}`;
  }
  return `Reminder: ${row.body}`;
}
