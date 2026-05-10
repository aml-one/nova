import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { EmotionState } from "../emotion/emotion-service.js";
import {
  augmentOrpheusSpeechForMood,
  ensureLexAuHungarianCueFallback,
  isHungarianLikeForOrpheusVoice
} from "./emotion-tts.js";
import { normalizeOrpheusSpeechCues, prepareChatTextForSpeech } from "./tts-text.js";
import { prependSilenceToWavPcm } from "./wav-prepend-silence.js";

/** True when agent-core can run mic upload transcription (Whisper API or NOVA_STT_COMMAND). */
export function isVoiceSttConfigured(): boolean {
  return Boolean(process.env.NOVA_STT_COMMAND?.trim() || process.env.OPENAI_API_KEY?.trim() || process.env.NOVA_STT_OPENAI_BASE_URL?.trim());
}

/** Run `NOVA_STT_COMMAND` without requiring the executable bit on `.sh` wrappers (POSIX). */
function runSttShellCommand(command: string, audioPath: string) {
  const trimmed = command.trim();
  const isPosixShScript =
    platform() !== "win32" &&
    trimmed.endsWith(".sh") &&
    !/[\s;&|<>$`\\]/.test(trimmed) &&
    trimmed.length > 3;
  if (isPosixShScript) {
    return spawnSync("/bin/sh", [trimmed, audioPath], { encoding: "utf8", shell: false });
  }
  return spawnSync(trimmed, [audioPath], { shell: true, encoding: "utf8" });
}

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
    if (!isVoiceSttConfigured()) {
      throw new Error(
        "Speech-to-text is not configured. Set OPENAI_API_KEY for Whisper API transcription, or set NOVA_STT_COMMAND to a shell command that receives the audio file path as argv[1] and prints the transcript to stdout. Optional: OPENAI_BASE_URL, NOVA_WHISPER_MODEL."
      );
    }
    const command = process.env.NOVA_STT_COMMAND?.trim();
    if (command) {
      const result = runSttShellCommand(command, audioPath);
      if (result.status !== 0) {
        throw new Error(result.stderr || "stt command failed");
      }
      return result.stdout.trim();
    }
    const apiKey = process.env.OPENAI_API_KEY?.trim();
    const baseUrl = process.env.NOVA_STT_OPENAI_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || "";
    if (!apiKey && !baseUrl) {
      throw new Error(
        "Speech-to-text is not configured. Set NOVA_STT_COMMAND, or set OPENAI_API_KEY / NOVA_STT_OPENAI_BASE_URL for OpenAI-compatible Whisper transcription."
      );
    }
    return await transcribeOpenAIWhisper(audioPath, apiKey || "not-needed");
  }

  /** Decode uploaded browser audio bytes into text (normalizes to 16k mono WAV via ffmpeg when available). */
  async transcribeAudioBytes(input: { bytes: Buffer; mimeType?: string }): Promise<string> {
    const ext = extensionFromMime(input.mimeType);
    const baseDir = resolve(process.cwd(), "data", "voice", "stt-temp");
    mkdirSync(baseDir, { recursive: true });
    const workDir = mkdtempSync(join(baseDir, "job-"));
    const sourcePath = join(workDir, `input.${ext}`);
    writeFileSync(sourcePath, input.bytes);
    let sttPath = sourcePath;
    let convertedPath = "";
    try {
      const shouldTryNormalize = !isWavMime(input.mimeType) || process.env.NOVA_STT_FORCE_NORMALIZE === "true";
      if (shouldTryNormalize && hasFfmpeg()) {
        convertedPath = join(workDir, "input-16k-mono.wav");
        const ff = spawnSync(
          "ffmpeg",
          ["-y", "-i", sourcePath, "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le", convertedPath],
          { shell: false, encoding: "utf8" }
        );
        if (ff.status === 0 && existsSync(convertedPath)) {
          sttPath = convertedPath;
        }
      }
      return await this.transcribe(sttPath);
    } finally {
      try {
        rmSync(workDir, { recursive: true, force: true });
      } catch {
        // Ignore temp cleanup failures.
      }
    }
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
    return normalizeOrpheusSpeechCues(ensureLexAuHungarianCueFallback(preparedText));
  }

  private async synthesizeOrpheusBufferInternal(preparedOrRawText: string): Promise<Buffer> {
    const prepared = prepareChatTextForSpeech(preparedOrRawText);
    const sent = this.getSentToOrpheusInput(prepared);
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
    const voicePrimary = (tts.voice ?? "").trim() || "tara";
    const voiceHu = (tts.voiceHungarian ?? "").trim();
    const voice =
      voiceHu && isHungarianLikeForOrpheusVoice(inputText) ? voiceHu.slice(0, 128) : voicePrimary.slice(0, 128);
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
    const contentType = (response.headers.get("content-type") ?? "").toLowerCase();
    if (contentType.includes("application/json")) {
      const errText = await response.text().catch(() => "");
      throw new Error(
        `TTS upstream returned JSON (${contentType || "no content-type"}) instead of audio: ${errText.slice(0, 500)}`
      );
    }
    const arrayBuf = await response.arrayBuffer();
    let buf: Buffer = Buffer.from(arrayBuf);
    if (buf.length === 0) {
      throw new Error("TTS upstream returned an empty body (0 bytes) while HTTP status was OK");
    }
    const rf = tts.responseFormat ?? "wav";
    if (rf === "wav") {
      const raw = process.env.NOVA_TTS_LEADING_SILENCE_MS?.trim();
      const parsed = raw ? Number(raw) : NaN;
      /** Default favors clean starts over speed. Tune with `NOVA_TTS_LEADING_SILENCE_MS` if needed. */
      const silenceMs =
        Number.isFinite(parsed) && parsed >= 0 ? Math.min(500, parsed) : 185;
      buf = prependSilenceToWavPcm(buf, silenceMs) as Buffer;
    }
    return buf;
  }

  mimeTypeForCurrentFormat(): string {
    const fmt = this.getSettings?.().orpheusTts?.responseFormat ?? "wav";
    return MIME_BY_FORMAT[fmt] ?? "audio/wav";
  }
}

function isWavMime(mimeType: string | undefined): boolean {
  const mime = (mimeType ?? "").toLowerCase();
  return mime.includes("audio/wav") || mime.includes("audio/x-wav") || mime.includes("audio/wave");
}

async function transcribeOpenAIWhisper(audioPath: string, apiKey: string): Promise<string> {
  const baseUrl = (process.env.NOVA_STT_OPENAI_BASE_URL?.trim() || process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com").replace(
    /\/+$/,
    ""
  );
  const model = process.env.NOVA_STT_MODEL?.trim() || process.env.NOVA_WHISPER_MODEL?.trim() || "whisper-1";
  const language = process.env.NOVA_STT_LANGUAGE?.trim() || "";
  const prompt = process.env.NOVA_STT_PROMPT?.trim() || "";
  const rawTemp = process.env.NOVA_STT_TEMPERATURE?.trim() || "";
  const buf = readFileSync(audioPath);
  const name = basename(audioPath);
  const blob = new Blob([buf], { type: mimeForSttFilename(name) });
  const form = new FormData();
  form.append("file", blob, name);
  form.append("model", model);
  if (language) form.append("language", language);
  if (prompt) form.append("prompt", prompt);
  if (rawTemp) {
    const temp = Number(rawTemp);
    if (Number.isFinite(temp) && temp >= 0 && temp <= 1) {
      form.append("temperature", String(temp));
    }
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 120_000);
  try {
    const res = await fetch(`${baseUrl}/v1/audio/transcriptions`, {
      method: "POST",
      headers: { authorization: `Bearer ${apiKey}` },
      body: form,
      signal: ac.signal
    });
    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Whisper HTTP ${res.status}: ${errText.slice(0, 400)}`);
    }
    const json = (await res.json()) as { text?: string };
    return (json.text ?? "").trim();
  } finally {
    clearTimeout(timer);
  }
}

function mimeForSttFilename(name: string): string {
  const lower = name.toLowerCase();
  if (lower.endsWith(".wav")) return "audio/wav";
  if (lower.endsWith(".webm")) return "audio/webm";
  if (lower.endsWith(".mp3")) return "audio/mpeg";
  if (lower.endsWith(".m4a") || lower.endsWith(".mp4")) return "audio/mp4";
  if (lower.endsWith(".ogg") || lower.endsWith(".oga")) return "audio/ogg";
  if (lower.endsWith(".flac")) return "audio/flac";
  return "application/octet-stream";
}

function extensionFromMime(mimeType: string | undefined): string {
  const m = (mimeType ?? "").toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("mp4") || m.includes("m4a")) return "m4a";
  if (isWavMime(mimeType)) return "wav";
  return "bin";
}

let ffmpegAvailableCache: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegAvailableCache !== null) return ffmpegAvailableCache;
  const p = spawnSync("ffmpeg", ["-version"], { shell: false, encoding: "utf8" });
  ffmpegAvailableCache = p.status === 0;
  return ffmpegAvailableCache;
}
