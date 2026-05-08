import { randomUUID } from "node:crypto";
import { pushChannelDebug, previewChannelText } from "../channels/channel-debug-log.js";
import { SignalChannelAdapter } from "../channels/signal.js";
import { WhatsAppChannelAdapter } from "../channels/whatsapp.js";
import { Logger } from "../observability/logger.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { VoiceService } from "../voice/voice-service.js";
import { OutboundQueueService } from "./outbound-queue.js";

export class OutboundDispatcher {
  private readonly queue = new OutboundQueueService();
  private readonly wa: WhatsAppChannelAdapter;
  private readonly signal: SignalChannelAdapter;
  private readonly voice: VoiceService;
  private readonly logger = new Logger();

  constructor(private readonly getSettings: () => AppSettings) {
    this.wa = new WhatsAppChannelAdapter(getSettings);
    this.signal = new SignalChannelAdapter(getSettings);
    this.voice = new VoiceService(getSettings);
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

  async signalTyping(recipient: string, typing: boolean): Promise<void> {
    try {
      await this.signal.sendTypingIndicator(recipient, typing);
      pushChannelDebug({
        channel: "signal",
        direction: "out",
        transport: "dispatcher",
        correlationId: randomUUID(),
        peer: recipient,
        textPreview: typing ? "(typing on)" : "(typing off)",
        trace: [typing ? "typing_indicator_on" : "typing_indicator_off"]
      });
    } catch (error) {
      pushChannelDebug({
        channel: "signal",
        direction: "out",
        transport: "dispatcher",
        correlationId: randomUUID(),
        peer: recipient,
        textPreview: typing ? "(typing on failed)" : "(typing off failed)",
        trace: [typing ? "typing_indicator_on_failed" : "typing_indicator_off_failed"],
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  private async tick(): Promise<void> {
    const jobs = this.queue.listReady(20);
    for (const job of jobs) {
      try {
        if (job.channel === "whatsapp") {
          await this.wa.sendMessage(job.recipient, job.payload);
        } else {
          await this.sendSignalWithOptionalVoice(job.recipient, job.payload);
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

  private async sendSignalWithOptionalVoice(recipient: string, text: string): Promise<void> {
    try {
      const settings = this.getSettings();
      const tts = settings?.orpheusTts;
      if (tts?.enabled && tts.baseUrl.trim()) {
        const audio = await this.voice.synthesizeOrpheusBuffer(text);
        const ext = (tts.responseFormat || "wav").replace(/[^a-z0-9]/gi, "") || "wav";
        const mimeType = this.voice.mimeTypeForCurrentFormat();
        await this.signal.sendMessage(recipient, text, {
          bytes: audio,
          mimeType,
          filename: `nova-reply.${ext}`
        });
        pushChannelDebug({
          channel: "signal",
          direction: "out",
          transport: "dispatcher",
          correlationId: randomUUID(),
          peer: recipient,
          textPreview: previewChannelText(`voice+transcript (${audio.byteLength} bytes)`),
          trace: ["signal_voice_attachment_sent"]
        });
        return;
      }
    } catch (error) {
      pushChannelDebug({
        channel: "signal",
        direction: "out",
        transport: "dispatcher",
        correlationId: randomUUID(),
        peer: recipient,
        textPreview: previewChannelText(text),
        trace: ["signal_voice_attachment_failed", "falling_back_to_text"],
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await this.signal.sendMessage(recipient, text);
  }
}
