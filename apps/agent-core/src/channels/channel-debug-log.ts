import { randomUUID } from "node:crypto";
import { getDatabase } from "../storage/sqlite.js";

export type ChannelDebugTransport = "webhook" | "baileys" | "dispatcher" | "next_proxy" | "receive_ws";

export type ChannelDebugEntry = {
  id: string;
  at: string;
  channel: "signal" | "whatsapp";
  direction: "in" | "out";
  transport?: ChannelDebugTransport;
  correlationId: string;
  peer: string;
  textPreview: string;
  trace: string[];
  /** Inbound: orchestrator returned a reply (Nova handled the message). */
  reachedNova?: boolean;
  error?: string;
};

/**
 * In-memory ring buffer for the Settings → Channels trace view.
 *
 * 5,000 entries is large enough to survive thousands of inbound webhook hits without losing context,
 * yet small enough that worst-case memory stays bounded (each row is < 1 KB → < 5 MB total). The buffer
 * is wiped on agent-core restart by design — durable trace logs belong in the structured logger, not here.
 */
const MAX = 5000;
const buffer: ChannelDebugEntry[] = [];

export function previewChannelText(text: string, max = 180): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "(empty)";
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

export function pushChannelDebug(entry: Omit<ChannelDebugEntry, "id" | "at"> & Partial<Pick<ChannelDebugEntry, "id" | "at">>): ChannelDebugEntry {
  const row: ChannelDebugEntry = {
    id: entry.id ?? randomUUID(),
    at: entry.at ?? new Date().toISOString(),
    channel: entry.channel,
    direction: entry.direction,
    transport: entry.transport,
    correlationId: entry.correlationId,
    peer: entry.peer ?? "",
    textPreview: entry.textPreview,
    trace: [...entry.trace],
    reachedNova: entry.reachedNova,
    error: entry.error
  };
  buffer.unshift(row);
  while (buffer.length > MAX) {
    buffer.pop();
  }
  persistChannelDebug(row);
  return row;
}

export function listChannelDebugEntries(limit = 150): ChannelDebugEntry[] {
  const n = Math.min(Math.max(1, limit), MAX);
  const persisted = listPersistedChannelDebugEntries(n);
  if (persisted.length > 0) {
    return persisted;
  }
  return buffer.slice(0, n);
}

function persistChannelDebug(row: ChannelDebugEntry): void {
  try {
    const db = getDatabase();
    db.prepare(
      `
      INSERT OR REPLACE INTO channel_debug_entries
        (id, at, channel, direction, transport, correlation_id, peer, text_preview, trace_json, reached_nova, error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    ).run(
      row.id,
      row.at,
      row.channel,
      row.direction,
      row.transport ?? null,
      row.correlationId,
      row.peer,
      row.textPreview,
      JSON.stringify(row.trace),
      row.reachedNova === undefined ? null : row.reachedNova ? 1 : 0,
      row.error ?? null
    );
    db.prepare(
      `
      DELETE FROM channel_debug_entries
      WHERE id NOT IN (
        SELECT id FROM channel_debug_entries ORDER BY at DESC LIMIT ?
      )
      `
    ).run(MAX);
  } catch {
    // Debug logging must never break message handling.
  }
}

function listPersistedChannelDebugEntries(limit: number): ChannelDebugEntry[] {
  try {
    const db = getDatabase();
    const rows = db
      .prepare(
        `
        SELECT id, at, channel, direction, transport, correlation_id, peer, text_preview, trace_json, reached_nova, error
        FROM channel_debug_entries
        ORDER BY at DESC
        LIMIT ?
        `
      )
      .all(limit) as Array<{
      id: string;
      at: string;
      channel: "signal" | "whatsapp";
      direction: "in" | "out";
      transport?: ChannelDebugTransport | null;
      correlation_id: string;
      peer: string;
      text_preview: string;
      trace_json: string;
      reached_nova?: number | null;
      error?: string | null;
    }>;
    return rows.map((row) => ({
      id: row.id,
      at: row.at,
      channel: row.channel,
      direction: row.direction,
      transport: row.transport ?? undefined,
      correlationId: row.correlation_id,
      peer: row.peer,
      textPreview: row.text_preview,
      trace: parseTrace(row.trace_json),
      reachedNova: row.reached_nova === null || row.reached_nova === undefined ? undefined : row.reached_nova === 1,
      error: row.error ?? undefined
    }));
  } catch {
    return [];
  }
}

function parseTrace(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}
