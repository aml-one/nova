import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { EmotionState } from "../emotion/emotion-service.js";
import { augmentOrpheusSpeechForMood } from "./emotion-tts.js";

const MIME_BY_FORMAT: Record<AppSettings["orpheusTts"]["responseFormat"], string> = {
  mp3: "audio/mpeg",
  wav: "audio/wav",
  opus: "audio/opus",
  pcm: "audio/pcm",
  flac: "audio/flac"
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
      const fmt = tts.responseFormat ?? "mp3";
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

  /** Raw audio for streaming endpoints (no shell TTS). */
  async synthesizeOrpheusBuffer(text: string): Promise<Buffer> {
    return this.synthesizeOrpheusBufferInternal(text);
  }

  private async synthesizeOrpheusBufferInternal(rawText: string): Promise<Buffer> {
    let text = rawText;
    try {
      const mood = this.getUnifiedMood?.();
      if (mood) {
        text = augmentOrpheusSpeechForMood(rawText, mood);
      }
    } catch {
      text = rawText;
    }

    const tts = this.getSettings?.().orpheusTts;
    if (!tts?.enabled || !tts.baseUrl.trim()) {
      throw new Error("Orpheus TTS is not enabled or base URL is empty");
    }
    const base = tts.baseUrl.replace(/\/+$/, "");
    const url = `${base}/v1/audio/speech`;
    const body: Record<string, unknown> = {
      input: text,
      response_format: tts.responseFormat ?? "mp3"
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
    return Buffer.from(arrayBuf);
  }

  mimeTypeForCurrentFormat(): string {
    const fmt = this.getSettings?.().orpheusTts?.responseFormat ?? "mp3";
    return MIME_BY_FORMAT[fmt] ?? "audio/mpeg";
  }
}
