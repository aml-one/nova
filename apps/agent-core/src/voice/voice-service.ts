import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

export class VoiceService {
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

  async speak(text: string, outputPath?: string): Promise<string> {
    const target = outputPath ?? resolve(process.cwd(), "data", "voice", `tts-${Date.now()}.wav`);
    const command = process.env.NOVA_TTS_COMMAND;
    if (!command) {
      return target;
    }
    const result = spawnSync(command, [text, target], { shell: true, encoding: "utf8" });
    if (result.status !== 0) {
      throw new Error(result.stderr || "tts command failed");
    }
    return target;
  }
}
