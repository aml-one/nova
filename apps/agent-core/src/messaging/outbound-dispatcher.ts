import { randomUUID } from "node:crypto";
import { pushChannelDebug, previewChannelText } from "../channels/channel-debug-log.js";
import { SignalChannelAdapter } from "../channels/signal.js";
import { WhatsAppChannelAdapter } from "../channels/whatsapp.js";
import { Logger } from "../observability/logger.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { OutboundQueueService } from "./outbound-queue.js";

export class OutboundDispatcher {
  private readonly queue = new OutboundQueueService();
  private readonly wa: WhatsAppChannelAdapter;
  private readonly signal: SignalChannelAdapter;
  private readonly logger = new Logger();

  constructor(getSettings: () => AppSettings) {
    this.wa = new WhatsAppChannelAdapter(getSettings);
    this.signal = new SignalChannelAdapter(getSettings);
  }

  private timer: NodeJS.Timeout | undefined;

  start(intervalMs = 1000): void {
    this.stop();
    this.timer = setInterval(() => void this.tick(), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  restart(intervalMs = 1000): void {
    this.stop();
    this.start(intervalMs);
  }

  isRunning(): boolean {
    return Boolean(this.timer);
  }

  enqueue(channel: "whatsapp" | "signal", recipient: string, payload: string, correlationId?: string): void {
    this.queue.enqueue(channel, recipient, payload, correlationId);
  }

  private async tick(): Promise<void> {
    const jobs = this.queue.listReady(20);
    for (const job of jobs) {
      try {
        if (job.channel === "whatsapp") {
          await this.wa.sendMessage(job.recipient, job.payload);
        } else {
          await this.signal.sendMessage(job.recipient, job.payload);
        }
        this.queue.markSuccess(job.id);
        pushChannelDebug({
          channel: job.channel,
          direction: "out",
          transport: "dispatcher",
          correlationId: job.correlationId ?? randomUUID(),
          peer: job.recipient,
          textPreview: previewChannelText(job.payload),
          trace: ["outbound_send_ok"],
          reachedNova: undefined
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : "dispatch failure";
        pushChannelDebug({
          channel: job.channel,
          direction: "out",
          transport: "dispatcher",
          correlationId: job.correlationId ?? randomUUID(),
          peer: job.recipient,
          textPreview: previewChannelText(job.payload),
          trace: ["outbound_send_failed"],
          error: message
        });
        this.queue.markRetry(job, message);
        this.logger.error("outbound dispatch failed", {
          correlationId: job.correlationId,
          channel: job.channel,
          recipient: job.recipient,
          attempts: job.attempts,
          error: message
        });
      }
    }
  }
}
