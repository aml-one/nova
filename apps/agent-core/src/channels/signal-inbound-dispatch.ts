import { randomUUID } from "node:crypto";
import type { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import type { OutboundDispatcher } from "../messaging/outbound-dispatcher.js";
import type { SettingsService } from "../settings/settings-service.js";
import type { ChannelMessage } from "./channel-router.js";
import { resolveChannelAccess } from "../security/phone-access.js";
import { previewChannelText, pushChannelDebug } from "./channel-debug-log.js";
import { getDatabase } from "../storage/sqlite.js";

export type SignalInboundTransport = "webhook" | "receive_ws";

/**
 * Cross-transport dedupe — keeps the last N envelope identifiers we've already processed so a Signal
 * message that arrives via BOTH the receive_ws stream AND the HTTP webhook isn't replied to twice.
 * Each entry expires after `DEDUPE_TTL_MS` to avoid unbounded growth.
 */
const DEDUPE_TTL_MS = 5 * 60 * 1000;
const DEDUPE_MAX = 1000;
const recentEnvelopes = new Map<string, number>();

function envelopeKey(message: ChannelMessage): string | undefined {
  if (typeof message.envelopeTimestamp !== "number") return undefined;
  const id = message.signalUuid ?? message.phoneNumber ?? message.from;
  if (!id) return undefined;
  return `${id}:${message.envelopeTimestamp}`;
}

function dedupeShouldSkip(key: string | undefined): boolean {
  if (!key) return false;
  const now = Date.now();
  // Sweep stale entries opportunistically before checking, to keep memory bounded.
  for (const [k, expiresAt] of recentEnvelopes) {
    if (expiresAt <= now) recentEnvelopes.delete(k);
  }
  if (recentEnvelopes.has(key)) return true;
  recentEnvelopes.set(key, now + DEDUPE_TTL_MS);
  if (recentEnvelopes.size > DEDUPE_MAX) {
    const firstKey = recentEnvelopes.keys().next().value;
    if (firstKey !== undefined) recentEnvelopes.delete(firstKey);
  }
  return persistentDedupeShouldSkip(key, now);
}

function persistentDedupeShouldSkip(key: string, now: number): boolean {
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM channel_message_dedupe WHERE expires_at_ms <= ?").run(now);
    const inserted = db
      .prepare("INSERT OR IGNORE INTO channel_message_dedupe (dedupe_key, expires_at_ms) VALUES (?, ?)")
      .run(key, now + DEDUPE_TTL_MS);
    return inserted.changes === 0;
  } catch {
    return false;
  }
}

export async function dispatchSignalInboundMessages(
  messages: ChannelMessage[],
  deps: {
    orchestrator: TaskOrchestrator;
    settings: SettingsService;
    dispatcher: OutboundDispatcher;
    transport: SignalInboundTransport;
  }
): Promise<Array<{ to: string; reply: string; delivered: boolean; error?: string }>> {
  const replies: Array<{ to: string; reply: string; delivered: boolean; error?: string }> = [];
  const baseTrace = deps.transport === "webhook" ? "webhook_received" : "receive_ws_message";

  for (const message of messages) {
    if (message.channel !== "signal") {
      continue;
    }
    const msgCorr = randomUUID();
    const trace: string[] = [baseTrace, "parsed_inbound"];

    // Skip if we already replied to this envelope on the other transport.
    const dedupeKey = envelopeKey(message);
    if (dedupeShouldSkip(dedupeKey)) {
      trace.push("deduped_other_transport");
      pushChannelDebug({
        channel: "signal",
        direction: "in",
        transport: deps.transport,
        correlationId: msgCorr,
        peer: message.from,
        textPreview: previewChannelText(message.text),
        trace,
        reachedNova: false
      });
      continue;
    }

    try {
      // Auto-link sealed-sender UUID to an existing phone-keyed tier row (best-effort, before access check).
      if (message.phoneNumber && message.signalUuid) {
        try {
          if (deps.settings.linkSignalUuidToPhone(message.phoneNumber, message.signalUuid)) {
            trace.push("auto_linked_signal_uuid");
          }
        } catch {
          // Settings link is best-effort; never let it block message dispatch.
        }
      }
      const accessProfile = resolveChannelAccess(
        "signal",
        message.phoneNumber,
        deps.settings.get(),
        { signalUuid: message.signalUuid }
      );
      trace.push(
        accessProfile.allowed
          ? accessProfile.matchedBySignalUuid
            ? `access_allowed_by_uuid(role=${accessProfile.role})`
            : "access_allowed"
          : `access_denied(role=${accessProfile.role})`
      );
      if (!accessProfile.allowed) {
        pushChannelDebug({
          channel: "signal",
          direction: "in",
          transport: deps.transport,
          correlationId: msgCorr,
          peer: message.from,
          textPreview: previewChannelText(message.text),
          trace,
          error: "Blocked by channel access policy"
        });
        continue;
      }
      // signal-cli-rest-api typing indicators auto-expire after ~15 s. Re-issue them every 10 s while the
      // orchestrator is working so the recipient sees continuous "Nova is typing…" instead of a flicker
      // when a slow chat (e.g. cold-loading a 18 GB Ollama model) takes ≥15 s.
      await deps.dispatcher.signalTyping(message.from, true);
      const typingHeartbeat = setInterval(() => {
        void deps.dispatcher.signalTyping(message.from, true).catch(() => {
          /* tracing already handled inside signalTyping; never let it kill the chat */
        });
      }, 10_000);
      if (typeof typingHeartbeat.unref === "function") typingHeartbeat.unref();
      let reply: string;
      try {
        reply = await deps.orchestrator.handleChannelMessage({
          channel: "signal",
          phoneNumber: message.phoneNumber,
          text: message.text,
          correlationId: msgCorr,
          accessProfile
        });
      } finally {
        clearInterval(typingHeartbeat);
      }
      trace.push("orchestrator_ok", "queued_outbound_reply");
      pushChannelDebug({
        channel: "signal",
        direction: "in",
        transport: deps.transport,
        correlationId: msgCorr,
        peer: message.from,
        textPreview: previewChannelText(message.text),
        trace,
        reachedNova: true
      });
      deps.dispatcher.enqueue("signal", message.from, reply, msgCorr);
      pushChannelDebug({
        channel: "signal",
        direction: "out",
        transport: deps.transport,
        correlationId: msgCorr,
        peer: message.from,
        textPreview: previewChannelText(reply),
        trace: ["reply_enqueued"]
      });
      replies.push({ to: message.from, reply, delivered: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      trace.push("orchestrator_error");
      pushChannelDebug({
        channel: "signal",
        direction: "in",
        transport: deps.transport,
        correlationId: msgCorr,
        peer: message.from,
        textPreview: previewChannelText(message.text),
        trace,
        reachedNova: false,
        error: msg
      });
    } finally {
      await deps.dispatcher.signalTyping(message.from, false);
    }
  }
  return replies;
}
