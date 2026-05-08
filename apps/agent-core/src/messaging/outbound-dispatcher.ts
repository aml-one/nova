import { randomUUID } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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

  async signalTyping(recipient: string, typing: boolean, opts?: { quiet?: boolean }): Promise<void> {
    try {
      await this.signal.sendTypingIndicator(recipient, typing);
      if (opts?.quiet) {
        return;
      }
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
      if (!opts?.quiet) {
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
          await this.sendWhatsAppWithOptionalVoice(job.recipient, job.payload, visiblePayload, job.correlationId ?? randomUUID());
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
   * Orpheus (settings) when enabled; otherwise `NOVA_TTS_COMMAND` via {@link VoiceService.speak}
   * so Signal/WhatsApp can send voice notes without a separate Orpheus server.
   */
  private async synthesizeOutboundVoiceBuffer(
    ttsSource: string,
    visibleText: string
  ): Promise<{ bytes: Buffer; mimeType: string; filename: string } | null> {
    const settings = this.getSettings();
    const tts = settings?.orpheusTts;
    if (tts?.enabled && tts.baseUrl.trim()) {
      try {
        const bytes = await this.voice.synthesizeOrpheusBuffer(ttsSource);
        const fmt = (tts.responseFormat || "wav").replace(/[^a-z0-9]/gi, "") || "wav";
        return {
          bytes,
          mimeType: this.voice.mimeTypeForCurrentFormat(),
          filename: `nova-reply.${fmt}`
        };
      } catch {
        // Orpheus unreachable — fall through to NOVA_TTS_COMMAND if set.
      }
    }
    if (!process.env.NOVA_TTS_COMMAND?.trim()) return null;
    try {
      const plain = stripOrpheusSpeechCues(visibleText);
      const outPath = await this.voice.speak(plain);
      if (!existsSync(outPath)) return null;
      const bytes = readFileSync(outPath);
      if (!bytes.byteLength) return null;
      const lower = outPath.toLowerCase();
      if (lower.endsWith(".mp3")) {
        return { bytes, mimeType: "audio/mpeg", filename: "nova-reply.mp3" };
      }
      if (lower.endsWith(".opus")) {
        return { bytes, mimeType: "audio/opus", filename: "nova-reply.opus" };
      }
      return { bytes, mimeType: "audio/wav", filename: "nova-reply.wav" };
    } catch {
      return null;
    }
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
      const voice = await this.synthesizeOutboundVoiceBuffer(ttsSource, visibleText);
      if (voice) {
        await this.signal.sendMessage(recipient, visibleText, {
          bytes: voice.bytes,
          mimeType: voice.mimeType,
          filename: voice.filename
        });
        pushChannelDebug({
          channel: "signal",
          direction: "out",
          transport: "dispatcher",
          correlationId,
          peer: recipient,
          textPreview: previewChannelText(`voice+transcript (${voice.bytes.byteLength} bytes)`),
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

  private async sendWhatsAppWithOptionalVoice(
    recipient: string,
    ttsSource: string,
    visibleText: string,
    correlationId: string
  ): Promise<void> {
    try {
      const voice = await this.synthesizeOutboundVoiceBuffer(ttsSource, visibleText);
      if (voice) {
        await this.wa.sendVoiceMessage(recipient, voice.bytes, voice.mimeType);
        // Always send transcript as a separate message (matches Signal’s “voice+transcript” pattern).
        await this.wa.sendMessage(recipient, visibleText);
        pushChannelDebug({
          channel: "whatsapp",
          direction: "out",
          transport: "dispatcher",
          correlationId,
          peer: recipient,
          textPreview: previewChannelText(`voice+transcript (${voice.bytes.byteLength} bytes)`),
          trace: ["whatsapp_voice_attachment_sent"]
        });
        return;
      }
    } catch (error) {
      pushChannelDebug({
        channel: "whatsapp",
        direction: "out",
        transport: "dispatcher",
        correlationId,
        peer: recipient,
        textPreview: previewChannelText(visibleText),
        trace: ["whatsapp_voice_attachment_failed", "falling_back_to_text"],
        error: error instanceof Error ? error.message : String(error)
      });
    }
    await this.wa.sendMessage(recipient, visibleText);
  }
}
