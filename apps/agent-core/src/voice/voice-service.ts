import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { EmotionState } from "../emotion/emotion-service.js";
import { augmentOrpheusSpeechForMood } from "./emotion-tts.js";
import { normalizeOrpheusSpeechCues, prepareChatTextForSpeech } from "./tts-text.js";
import { prependSilenceToWavPcm } from "./wav-prepend-silence.js";

const MIME_BY_FORMAT: Record<AppSettings["orpheusTts"]["responseFormat"], string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/opus",
  pcm: "audio/pcm",
  flac: "audio/flac"
};

export type TtsPipelineTrace = {
  requestText: string;
  preparedForSpeech: string;
  sentToOrpheus: string;
  mood: Pick<EmotionState, "label" | "valence" | "arousal"> | null;
};

export class VoiceService {
  constructor(
    private readonly getSettings?: () => AppSettings,
    private readonly getUnifiedMood?: () => Pick<EmotionState, "label" | "valence" | "arousal">
  ) {}

  async transcribe(audioPath: string): Promise<string> {
    const command = process.env.NOVA_STT_COMMAND;
    if (!command) {
      return `STT placeholder transcript for: ${audioPath}`;
    }
    const result = spawnSync(command, [audioPath], { shell: true, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "stt command failed");
    }
    return result.stdout.trim();
  }

  /**
   * Writes synthesized audio to disk. Uses Orpheus / OpenAI-compatible HTTP when enabled in settings;
   * otherwise `NOVA_TTS_COMMAND` if set.
   */
  async speak(text: string, outputPath?: string): Promise<string> {
    const tts = this.getSettings?.().orpheusTts;
    if (tts?.enabled && tts.baseUrl.trim()) {
      const fmt = tts.responseFormat ?? "wav";
      const dir = resolve(process.cwd(), "data", "voice");
      mkdirSync(dir, { recursive: true });
      const target = outputPath ?? resolve(dir, `tts-${Date.now()}.${fmt}`);
      const buf = await this.synthesizeOrpheusBufferInternal(text);
      writeFileSync(target, buf);
      return target;
    }
    const target = outputPath ?? resolve(process.cwd(), "data", "voice", `tts-${Date.now()}.wav`);
    const command = process.env.NOVA_TTS_COMMAND;
    if (!command) {
      return target;
    }
    mkdirSync(resolve(process.cwd(), "data", "voice"), { recursive: true });
    const result = spawnSync(command, [text, target], { shell: true, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "tts command failed");
    }
    return target;
  }

  /** Raw audio for streaming endpoints (no shell TTS). Expects **prepared** chat text when matching web read-aloud. */
  async synthesizeOrpheusBuffer(text: string): Promise<Buffer> {
    return this.synthesizeOrpheusBufferInternal(text);
  }

  /**
   * Synthesize from the **final** Orpheus `input` string (skips mood / cue prep — caller must use the same string as traces).
   * Used by HTTP speak-audio to avoid computing `sentToOrpheus` twice per request.
   */
  async synthesizeOrpheusBufferFromSentInput(sentToOrpheus: string): Promise<Buffer> {
    return this.fetchOrpheusAudio(sentToOrpheus.trim());
  }

  /**
   * Exact pipeline used by `POST /v1/voice/speak-audio`: normalize markdown → mood tags/fillers → Orpheus `input`.
   * Does not call Orpheus — for debugging mismatches between displayed reply and spoken audio.
   */
  getTtsPipelineTrace(rawRequestText: string): TtsPipelineTrace {
    const preparedForSpeech = prepareChatTextForSpeech(rawRequestText);
    let mood: Pick<EmotionState, "label" | "valence" | "arousal"> | null = null;
    try {
      mood = this.getUnifiedMood?.() ?? null;
    } catch {
      mood = null;
    }
    const sentToOrpheus = this.getSentToOrpheusInput(preparedForSpeech);
    return {
      requestText: rawRequestText,
      preparedForSpeech,
      sentToOrpheus,
      mood
    };
  }

  private getSentToOrpheusInput(preparedText: string): string {
    try {
      const mood = this.getUnifiedMood?.();
      if (mood) {
        return normalizeOrpheusSpeechCues(augmentOrpheusSpeechForMood(preparedText, mood));
      }
    } catch {
      /* keep prepared */
    }
    return normalizeOrpheusSpeechCues(preparedText);
  }

  private async synthesizeOrpheusBufferInternal(preparedOrRawText: string): Promise<Buffer> {
    const sent = this.getSentToOrpheusInput(preparedOrRawText);
    return this.fetchOrpheusAudio(sent);
  }

  private async fetchOrpheusAudio(inputText: string): Promise<Buffer> {
    const tts = this.getSettings?.().orpheusTts;
    if (!tts?.enabled || !tts.baseUrl.trim()) {
      throw new Error("Orpheus TTS is not enabled or base URL is empty");
    }
    const base = tts.baseUrl.replace(/\/+$/, "");
    const url = `${base}/v1/audio/speech`;
    const body: Record<string, unknown> = {
      input: inputText,
      response_format: tts.responseFormat ?? "wav"
    };
    const voice = tts.voice.trim();
    if (voice) {
      body.voice = voice;
    }
    if (tts.model.trim()) {
      body.model = tts.model.trim();
    }
    const headers: Record<string, string> = { "content-type": "application/json" };
    if (tts.apiKey.trim()) {
      headers.authorization = `Bearer ${tts.apiKey.trim()}`;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), 120_000);
    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
        signal: ac.signal
      });
    } finally {
      clearTimeout(timer);
    }
    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`TTS HTTP ${response.status}: ${errText.slice(0, 400)}`);
    }
    const arrayBuf = await response.arrayBuffer();
    let buf: Buffer = Buffer.from(arrayBuf);
    const rf = tts.responseFormat ?? "wav";
    if (rf === "wav") {
      const raw = process.env.NOVA_TTS_LEADING_SILENCE_MS?.trim();
      const parsed = raw ? Number(raw) : NaN;
      /** Lower default = faster audible start; raise if first syllables clip (try 185). `NOVA_TTS_LEADING_SILENCE_MS`. */
      const silenceMs =
        Number.isFinite(parsed) && parsed >= 0 ? Math.min(500, parsed) : 100;
      buf = prependSilenceToWavPcm(buf, silenceMs) as Buffer;
    }
    return buf;
  }

  mimeTypeForCurrentFormat(): string {
    const fmt = this.getSettings?.().orpheusTts?.responseFormat ?? "wav";
    return MIME_BY_FORMAT[fmt] ?? "audio/wav";
  }
}
