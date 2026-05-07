import { randomUUID } from "node:crypto";

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
  return row;
}

export function listChannelDebugEntries(limit = 150): ChannelDebugEntry[] {
  const n = Math.min(Math.max(1, limit), MAX);
  return buffer.slice(0, n);
}
