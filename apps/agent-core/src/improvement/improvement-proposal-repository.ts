import { randomUUID } from "node:crypto";
import { sqliteUtcDatetimeToIso } from "../util/sqlite-timestamp.js";
import { getDatabase } from "../storage/sqlite.js";

/**
 * Lifecycle for an improvement proposal.
 * - `proposed`     — Nova suggested it from the idle learning cycle.
 * - `approved`     — user accepted it.
 * - `in_progress`  — the autonomous worker has picked it up.
 * - `implemented`  — the worker (or a human) finished and committed the change.
 * - `needs_human`  — the worker refused to act autonomously (path outside the safe whitelist,
 *                    proposal too vague, validation failed, daily cap hit, etc). Human action required;
 *                    the autonomous worker will not retry until the user re-approves.
 */
export type ImprovementProposalStatus = "proposed" | "approved" | "in_progress" | "implemented" | "needs_human";

export type ImprovementProposal = {
  id: string;
  title: string;
  summary: string;
  details?: string;
  source: string;
  status: ImprovementProposalStatus;
  createdAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
};

export type ImprovementProposalEvent = {
  id: string;
  proposalId: string;
  eventType: "created" | "status_changed" | "work_attempt";
  statusFrom?: ImprovementProposalStatus;
  statusTo?: ImprovementProposalStatus;
  note?: string;
  actor: string;
  createdAt: string;
};

export class ImprovementProposalRepository {
  create(input: { title: string; summary: string; details?: string; source?: string }): ImprovementProposal {
    const id = randomUUID();
    const source = (input.source ?? "idle-learning").trim() || "idle-learning";
    getDatabase()
      .prepare(
        `
        INSERT INTO improvement_proposals (id, title, summary, details, source, status)
        VALUES (?, ?, ?, ?, ?, 'proposed')
        `
      )
      .run(id, input.title.trim(), input.summary.trim(), input.details?.trim() ?? null, source);
    this.addEvent({
      proposalId: id,
      eventType: "created",
      statusTo: "proposed",
      note: "Proposal created from idle learning",
      actor: "nova"
    });
    return this.getById(id)!;
  }

  list(limit = 200): ImprovementProposal[] {
    const rows = getDatabase()
      .prepare(
        `
        SELECT id, title, summary, details, source, status, created_at, approved_at, started_at, completed_at
        FROM improvement_proposals
        ORDER BY datetime(created_at) DESC
        LIMIT ?
        `
      )
      .all(Math.max(1, Math.min(1000, Math.floor(limit)))) as Array<Row>;
    return rows.map(mapRow);
  }

  getById(id: string): ImprovementProposal | undefined {
    const row = getDatabase()
      .prepare(
        `
        SELECT id, title, summary, details, source, status, created_at, approved_at, started_at, completed_at
        FROM improvement_proposals
        WHERE id = ?
        LIMIT 1
        `
      )
      .get(id) as Row | undefined;
    return row ? mapRow(row) : undefined;
  }

  setStatus(id: string, status: ImprovementProposalStatus, note?: string, actor = "user"): ImprovementProposal | undefined {
    const before = this.getById(id);
    if (!before) return undefined;
    const updates =
      status === "approved"
        ? { approvedAt: "CURRENT_TIMESTAMP", startedAt: "NULL", completedAt: "NULL" }
        : status === "in_progress"
          ? { approvedAt: "COALESCE(approved_at, CURRENT_TIMESTAMP)", startedAt: "CURRENT_TIMESTAMP", completedAt: "NULL" }
          : status === "implemented"
            ? {
                approvedAt: "COALESCE(approved_at, CURRENT_TIMESTAMP)",
                startedAt: "COALESCE(started_at, CURRENT_TIMESTAMP)",
                completedAt: "CURRENT_TIMESTAMP"
              }
            : status === "needs_human"
              ? {
                  approvedAt: "COALESCE(approved_at, CURRENT_TIMESTAMP)",
                  startedAt: "COALESCE(started_at, CURRENT_TIMESTAMP)",
                  completedAt: "NULL"
                }
              : { approvedAt: "NULL", startedAt: "NULL", completedAt: "NULL" };
    getDatabase()
      .prepare(
        `
        UPDATE improvement_proposals
        SET
          status = ?,
          approved_at = ${updates.approvedAt},
          started_at = ${updates.startedAt},
          completed_at = ${updates.completedAt}
        WHERE id = ?
        `
      )
      .run(status, id);
    const updated = this.getById(id);
    if (updated && before.status !== updated.status) {
      this.addEvent({
        proposalId: id,
        eventType: "status_changed",
        statusFrom: before.status,
        statusTo: updated.status,
        note,
        actor
      });
    }
    return updated;
  }

  /**
   * Edit the user-facing fields of a proposal in place. Only `title`, `summary` and `details`
   * (the "done signal" line) are mutable; status/timestamps are managed by `setStatus` and the
   * lifecycle helpers. Returns the updated proposal, or `undefined` if the id was not found.
   */
  updateContent(
    id: string,
    edits: { title?: string; summary?: string; details?: string | null },
    actor: string = "user"
  ): ImprovementProposal | undefined {
    const before = this.getById(id);
    if (!before) return undefined;
    const nextTitle = edits.title !== undefined ? edits.title.trim() : before.title;
    const nextSummary = edits.summary !== undefined ? edits.summary.trim() : before.summary;
    const nextDetails =
      edits.details === null
        ? null
        : edits.details !== undefined
          ? edits.details.trim() || null
          : before.details ?? null;
    if (!nextTitle || !nextSummary) {
      return before;
    }
    if (nextTitle === before.title && nextSummary === before.summary && (nextDetails ?? null) === (before.details ?? null)) {
      return before;
    }
    getDatabase()
      .prepare(
        `
        UPDATE improvement_proposals
        SET title = ?, summary = ?, details = ?
        WHERE id = ?
        `
      )
      .run(nextTitle, nextSummary, nextDetails, id);
    const noteParts: string[] = [];
    if (nextTitle !== before.title) noteParts.push(`title updated`);
    if (nextSummary !== before.summary) noteParts.push(`summary updated`);
    if ((nextDetails ?? null) !== (before.details ?? null)) noteParts.push(`done signal updated`);
    this.addEvent({
      proposalId: id,
      eventType: "status_changed",
      statusFrom: before.status,
      statusTo: before.status,
      note: noteParts.length > 0 ? `Proposal edited: ${noteParts.join(", ")}` : "Proposal edited",
      actor
    });
    return this.getById(id);
  }

  /**
   * Updates only `details` (e.g. canonicalised or auto-repaired `Target file` lines).
   * Does not append proposal events, so batch repairs do not flood the activity log.
   */
  patchDetails(id: string, details: string | null): ImprovementProposal | undefined {
    const before = this.getById(id);
    if (!before) return undefined;
    const next = details === null || details.trim().length === 0 ? null : details.trim();
    const norm = (s: string | null | undefined) => (s ?? "").replace(/\r\n/g, "\n").trimEnd();
    if (norm(next) === norm(before.details ?? null)) {
      return before;
    }
    getDatabase()
      .prepare(
        `
        UPDATE improvement_proposals
        SET details = ?
        WHERE id = ?
        `
      )
      .run(next, id);
    return this.getById(id);
  }

  hasSimilarRecent(title: string, withinHours = 24): boolean {
    const row = getDatabase()
      .prepare(
        `
        SELECT 1 AS hit
        FROM improvement_proposals
        WHERE lower(title) = lower(?)
          AND datetime(created_at) >= datetime('now', ?)
        LIMIT 1
        `
      )
      .get(title.trim(), `-${Math.max(1, Math.floor(withinHours))} hours`) as { hit?: number } | undefined;
    return Number(row?.hit ?? 0) === 1;
  }

  listEvents(proposalId: string, limit = 100): ImprovementProposalEvent[] {
    const rows = getDatabase()
      .prepare(
        `
        SELECT id, proposal_id, event_type, status_from, status_to, note, actor, created_at
        FROM improvement_proposal_events
        WHERE proposal_id = ?
        ORDER BY datetime(created_at) DESC
        LIMIT ?
        `
      )
      .all(proposalId, Math.max(1, Math.min(500, Math.floor(limit)))) as Array<EventRow>;
    return rows.map(mapEventRow);
  }

  addEvent(input: {
    proposalId: string;
    eventType: "created" | "status_changed" | "work_attempt";
    statusFrom?: ImprovementProposalStatus;
    statusTo?: ImprovementProposalStatus;
    note?: string;
    actor?: string;
  }): void {
    getDatabase()
      .prepare(
        `
        INSERT INTO improvement_proposal_events (id, proposal_id, event_type, status_from, status_to, note, actor)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        randomUUID(),
        input.proposalId,
        input.eventType,
        input.statusFrom ?? null,
        input.statusTo ?? null,
        input.note?.trim() ?? null,
        (input.actor?.trim() || "nova").slice(0, 60)
      );
  }
}

type Row = {
  id: string;
  title: string;
  summary: string;
  details?: string;
  source: string;
  status: string;
  created_at: string;
  approved_at?: string;
  started_at?: string;
  completed_at?: string;
};

type EventRow = {
  id: string;
  proposal_id: string;
  event_type: string;
  status_from?: string;
  status_to?: string;
  note?: string;
  actor: string;
  created_at: string;
};

function mapRow(row: Row): ImprovementProposal {
  return {
    id: row.id,
    title: row.title,
    summary: row.summary,
    details: row.details ?? undefined,
    source: row.source,
    status: normalizeStatus(row.status),
    createdAt: sqliteUtcDatetimeToIso(row.created_at),
    approvedAt: row.approved_at ? sqliteUtcDatetimeToIso(row.approved_at) : undefined,
    startedAt: row.started_at ? sqliteUtcDatetimeToIso(row.started_at) : undefined,
    completedAt: row.completed_at ? sqliteUtcDatetimeToIso(row.completed_at) : undefined
  };
}

function normalizeStatus(raw: string): ImprovementProposalStatus {
  if (raw === "approved" || raw === "in_progress" || raw === "implemented" || raw === "needs_human") return raw;
  return "proposed";
}

function mapEventRow(row: EventRow): ImprovementProposalEvent {
  return {
    id: row.id,
    proposalId: row.proposal_id,
    eventType: normalizeEventType(row.event_type),
    statusFrom: row.status_from ? normalizeStatus(row.status_from) : undefined,
    statusTo: row.status_to ? normalizeStatus(row.status_to) : undefined,
    note: row.note ?? undefined,
    actor: row.actor || "nova",
    createdAt: sqliteUtcDatetimeToIso(row.created_at)
  };
}

function normalizeEventType(raw: string): ImprovementProposalEvent["eventType"] {
  if (raw === "status_changed" || raw === "work_attempt") return raw;
  return "created";
}
