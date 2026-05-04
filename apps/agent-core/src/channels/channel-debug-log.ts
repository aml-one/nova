import { randomUUID } from "node:crypto";

export type ChannelDebugTransport = "webhook" | "baileys" | "dispatcher";

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

const MAX = 500;
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
