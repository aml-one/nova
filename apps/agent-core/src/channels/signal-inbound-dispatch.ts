import { randomUUID } from "node:crypto";
import type { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import type { OutboundDispatcher } from "../messaging/outbound-dispatcher.js";
import type { SettingsService } from "../settings/settings-service.js";
import type { ChannelMessage } from "./channel-router.js";
import type { SignalChannelAdapter } from "./signal.js";

/** Re-issue typing before signal-cli’s ~15 s expiry; >10 s avoids excessive debug noise. */
const SIGNAL_TYPING_HEARTBEAT_MS = 14_000;
import { resolveChannelAccess } from "../security/phone-access.js";
import { previewChannelText, pushChannelDebug } from "./channel-debug-log.js";
import { getDatabase } from "../storage/sqlite.js";
import { stripOrpheusSpeechCues } from "../voice/tts-text.js";

export type SignalInboundTransport = "webhook" | "receive_ws";

/**
 * Cross-transport dedupe — the same Signal DM is often delivered on BOTH the receive WebSocket and the
 * HTTP webhook. We must not reply twice, but we also must NOT "burn" the dedupe key on a failed attempt
 * (e.g. access_denied on one transport), or the other transport will see `deduped_other_transport` and
 * never deliver the message.
 *
 * Claim = INSERT a row; release = DELETE when this attempt will not produce a reply.
 */
const DEDUPE_TTL_MS = 5 * 60 * 1000;

function envelopeKey(message: ChannelMessage): string | undefined {
  if (typeof message.envelopeTimestamp !== "number") return undefined;
  const id = message.signalUuid ?? message.phoneNumber ?? message.from;
  if (!id) return undefined;
  return `${id}:${message.envelopeTimestamp}`;
}

function signalInboundTryClaimEnvelope(key: string | undefined): boolean {
  if (!key) return true;
  const now = Date.now();
  try {
    const db = getDatabase();
    db.prepare("DELETE FROM channel_message_dedupe WHERE expires_at_ms <= ?").run(now);
    const inserted = db
      .prepare("INSERT OR IGNORE INTO channel_message_dedupe (dedupe_key, expires_at_ms) VALUES (?, ?)")
      .run(key, now + DEDUPE_TTL_MS);
    return inserted.changes === 1;
  } catch {
    return true;
  }
}

function signalInboundReleaseEnvelope(key: string | undefined): void {
  if (!key) return;
  try {
    getDatabase().prepare("DELETE FROM channel_message_dedupe WHERE dedupe_key = ?").run(key);
  } catch {
    /* ignore */
  }
}

export async function dispatchSignalInboundMessages(
  messages: ChannelMessage[],
  deps: {
    orchestrator: TaskOrchestrator;
    settings: SettingsService;
    dispatcher: OutboundDispatcher;
    signal: SignalChannelAdapter;
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

    const dedupeKey = envelopeKey(message);
    if (!signalInboundTryClaimEnvelope(dedupeKey)) {
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
      if (message.signalUuid) {
        try {
          deps.settings.ensureSignalTierUuidFromProfileDisplayName(
            message.signalUuid,
            message.signalSourceProfileName
          );
        } catch {
          // Best-effort: match tier `name` to Signal profile display name for sealed sender.
        }
      }
      if (message.signalUuid) {
        try {
          deps.settings.ensureSignalSealedSenderUuidOnTier(message.signalUuid);
        } catch {
          // Best-effort: copy UUID onto channel tier when person_identities already links UUID→phone.
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
        signalInboundReleaseEnvelope(dedupeKey);
        continue;
      }
      if (typeof message.envelopeTimestamp === "number" && Number.isFinite(message.envelopeTimestamp)) {
        await deps.signal.sendReadReceipt(message.from, message.envelopeTimestamp).catch(() => {
          /* optional; older signal-cli-rest-api builds may not support receipts */
        });
      }
      // signal-cli-rest-api typing indicators auto-expire after ~15 s. Re-issue on a quiet interval
      // (no per-tick channel-debug rows) so slow chats still show continuous typing without log spam.
      await deps.dispatcher.signalTyping(message.from, true);
      const typingHeartbeat = setInterval(() => {
        void deps.dispatcher.signalTyping(message.from, true, { quiet: true }).catch(() => {
          /* never let typing kill the chat */
        });
      }, SIGNAL_TYPING_HEARTBEAT_MS);
      if (typeof typingHeartbeat.unref === "function") typingHeartbeat.unref();
      let reply: string;
      try {
        reply = await deps.orchestrator.handleChannelMessage({
          channel: "signal",
          phoneNumber: message.phoneNumber,
          signalUuid: message.signalUuid,
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
        // Trace shows the visible body (without `<chuckle>` / `<sigh>` cues). The dispatcher still
        // synthesizes audio from the original `reply` so the audio keeps the cues.
        textPreview: previewChannelText(stripOrpheusSpeechCues(reply)),
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
      signalInboundReleaseEnvelope(dedupeKey);
    } finally {
      await deps.dispatcher.signalTyping(message.from, false);
    }
  }
  return replies;
}
