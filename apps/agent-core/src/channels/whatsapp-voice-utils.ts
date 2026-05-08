import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

export function hasFfmpeg(): boolean {
  try {
    const r = spawnSync("ffmpeg", ["-version"], { encoding: "utf8", shell: false });
    return r.status === 0;
  } catch {
    return false;
  }
}

function extForMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  if (m.includes("ogg") || m.includes("opus")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "m4a";
  if (m.includes("wav")) return "wav";
  if (m.includes("flac")) return "flac";
  if (m.includes("webm")) return "webm";
  return "bin";
}

/**
 * Baileys/WhatsApp PTT expects Opus-in-OGG for reliable delivery; WAV/MP3 from TTS often fails silently.
 * Converts with ffmpeg when available.
 */
export function tryEncodeVoicePttOggOpus(audio: Buffer, inputMime: string): Buffer | null {
  if (!hasFfmpeg() || !audio.byteLength) return null;
  const mime = (inputMime || "").toLowerCase();
  if (mime.includes("ogg") && mime.includes("opus")) return audio;

  const dir = mkdtempSync(join(tmpdir(), "nova-wa-ptt-"));
  try {
    const ext = extForMime(mime);
    const inPath = join(dir, `in.${ext}`);
    const outPath = join(dir, "out.ogg");
    writeFileSync(inPath, audio);
    const ff = spawnSync(
      "ffmpeg",
      ["-y", "-i", inPath, "-c:a", "libopus", "-b:a", "64k", "-ar", "48000", "-ac", "1", "-application", "voip", outPath],
      { encoding: "utf8", shell: false }
    );
    if (ff.status !== 0 || !existsSync(outPath)) return null;
    return readFileSync(outPath);
  } catch {
    return null;
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
}

/** Build a JID Baileys can send to from `whatsapp:+E164`, bare digits, or full `@s.whatsapp.net`. */
export function normalizeWhatsAppRecipientJid(to: string): string {
  const t = to.trim();
  if (!t) throw new Error("empty WhatsApp recipient");
  if (t.includes("@s.whatsapp.net") || t.endsWith("@g.us") || t.endsWith("@lid")) {
    return t;
  }
  const noChannel = t.toLowerCase().startsWith("whatsapp:") ? t.slice("whatsapp:".length).trim() : t;
  const digits = noChannel.replace(/\D/g, "");
  if (!digits) throw new Error("WhatsApp recipient has no digits");
  return `${digits}@s.whatsapp.net`;
}
