import { randomUUID } from "node:crypto";
import type { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import type { OutboundDispatcher } from "../messaging/outbound-dispatcher.js";
import type { SettingsService } from "../settings/settings-service.js";
import type { ChannelMessage } from "./channel-router.js";
import { resolveChannelAccess } from "../security/phone-access.js";
import { previewChannelText, pushChannelDebug } from "./channel-debug-log.js";

export type SignalInboundTransport = "webhook" | "receive_ws";

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
    try {
      const accessProfile = resolveChannelAccess("signal", message.phoneNumber, deps.settings.get());
      trace.push(accessProfile.allowed ? "access_allowed" : `access_denied(role=${accessProfile.role})`);
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
      const reply = await deps.orchestrator.handleChannelMessage({
        channel: "signal",
        phoneNumber: message.phoneNumber,
        text: message.text,
        correlationId: msgCorr,
        accessProfile
      });
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
    }
  }
  return replies;
}
