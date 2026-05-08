import { randomUUID } from "node:crypto";
import { pushChannelDebug, previewChannelText } from "../channels/channel-debug-log.js";
import { SignalChannelAdapter } from "../channels/signal.js";
import { WhatsAppChannelAdapter } from "../channels/whatsapp.js";
import { Logger } from "../observability/logger.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { VoiceService } from "../voice/voice-service.js";
import { stripOrpheusSpeechCues } from "../voice/tts-text.js";
import { OutboundQueueService } from "./outbound-queue.js";

export class OutboundDispatcher {
  private readonly queue = new OutboundQueueService();
  private readonly wa: WhatsAppChannelAdapter;
  private readonly signal: SignalChannelAdapter;
  private readonly voice: VoiceService;
  private readonly logger = new Logger();
  private ticking = false;
  /**
   * Anti-spam guard: same channel + recipient + text body sent within `OUTBOUND_DEDUPE_WINDOW_MS`
   * is dropped. Different content (e.g. Nova breaking a long reply into multiple lines) flows
   * normally — we key on the text itself, not on the recipient alone.
   */
  private readonly recentOutboundSends = new Map<string, number>();

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
    if (this.ticking) {
      return;
    }
    this.ticking = true;
    try {
    const jobs = this.queue.listReady(20);
    for (const job of jobs) {
      // Visible body for Signal/WhatsApp + the trace. TTS still gets the original `job.payload`
      // (with `<chuckle>`/`<sigh>` etc.) so the audio keeps the cues.
      const visiblePayload = stripOrpheusSpeechCues(job.payload);
      try {
        // Anti-spam guard (same body to same number within ~2 s). Applies to BOTH transports so
        // a runaway whatsapp loop is also stopped, and so accidental duplicates from a retry are
        // dropped without penalising legit multi-line replies (different text passes immediately).
        if (this.wasRecentlySent(job.channel, job.recipient, visiblePayload)) {
          this.queue.markSuccess(job.id);
          pushChannelDebug({
            channel: job.channel,
            direction: "out",
            transport: "dispatcher",
            correlationId: job.correlationId ?? randomUUID(),
            peer: job.recipient,
            textPreview: previewChannelText(visiblePayload),
            trace: ["outbound_send_deduped_recent"],
            reachedNova: undefined,
            error: `Identical message already sent to ${job.recipient} within ${this.outboundDedupeWindowMs()}ms — dropped to prevent accidental spam.`
          });
          continue;
        }
        if (job.channel === "whatsapp") {
          await this.wa.sendMessage(job.recipient, visiblePayload);
        } else {
          await this.sendSignalWithOptionalVoice(
            job.recipient,
            job.payload,
            visiblePayload,
            job.correlationId ?? randomUUID()
          );
        }
        this.markRecentlySent(job.channel, job.recipient, visiblePayload);
        this.queue.markSuccess(job.id);
        pushChannelDebug({
          channel: job.channel,
          direction: "out",
          transport: "dispatcher",
          correlationId: job.correlationId ?? randomUUID(),
          peer: job.recipient,
          textPreview: previewChannelText(visiblePayload),
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
          textPreview: previewChannelText(visiblePayload),
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
    } finally {
      this.ticking = false;
    }
  }

  /**
   * Default 2 000 ms — short enough that Nova can naturally repeat a one-word reply later in a
   * conversation, long enough to swallow accidental retry storms / dispatcher loops. Tunable via
   * `NOVA_OUTBOUND_DEDUPE_MS` (e.g. set higher in CI to keep tests deterministic).
   */
  private outboundDedupeWindowMs(): number {
    const raw = process.env.NOVA_OUTBOUND_DEDUPE_MS?.trim();
    if (raw) {
      const parsed = Number(raw);
      if (Number.isFinite(parsed) && parsed >= 0) {
        return parsed;
      }
    }
    return 2000;
  }

  private outboundSendKey(channel: string, recipient: string, text: string): string {
    return `${channel}::${recipient.trim().toLowerCase()}::${text.trim().slice(0, 500)}`;
  }

  private wasRecentlySent(channel: string, recipient: string, text: string): boolean {
    const now = Date.now();
    for (const [key, expiresAt] of this.recentOutboundSends) {
      if (expiresAt <= now) this.recentOutboundSends.delete(key);
    }
    return this.recentOutboundSends.has(this.outboundSendKey(channel, recipient, text));
  }

  private markRecentlySent(channel: string, recipient: string, text: string): void {
    this.recentOutboundSends.set(
      this.outboundSendKey(channel, recipient, text),
      Date.now() + this.outboundDedupeWindowMs()
    );
  }

  /**
   * `ttsSource` keeps cue tags so Orpheus produces the chuckle/sigh; `visibleText` is the cleaned
   * body that is shown to the recipient (and in the trace) so the cues never leak into the chat.
   * `correlationId` matches the queue job so the conversation view can merge the audio + text rows.
   */
  private async sendSignalWithOptionalVoice(
    recipient: string,
    ttsSource: string,
    visibleText: string,
    correlationId: string
  ): Promise<void> {
    try {
      const settings = this.getSettings();
      const tts = settings?.orpheusTts;
      if (tts?.enabled && tts.baseUrl.trim()) {
        const audio = await this.voice.synthesizeOrpheusBuffer(ttsSource);
        const ext = (tts.responseFormat || "wav").replace(/[^a-z0-9]/gi, "") || "wav";
        const mimeType = this.voice.mimeTypeForCurrentFormat();
        await this.signal.sendMessage(recipient, visibleText, {
          bytes: audio,
          mimeType,
          filename: `nova-reply.${ext}`
        });
        pushChannelDebug({
          channel: "signal",
          direction: "out",
          transport: "dispatcher",
          correlationId,
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
        correlationId,
        peer: recipient,
        textPreview: previewChannelText(visibleText),
        trace: ["signal_voice_attachment_failed", "falling_back_to_text"],
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await this.signal.sendMessage(recipient, visibleText);
  }
}
