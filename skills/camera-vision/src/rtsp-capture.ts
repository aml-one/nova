import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { spawn } from "node:child_process";

export type CaptureRequest = {
  cameraName: string;
  rtspUrl: string;
  mode: "snapshot" | "clip5s";
};

export type CaptureResult = {
  cameraName: string;
  filePath: string;
};

export async function captureFromRtsp(request: CaptureRequest): Promise<CaptureResult> {
  const ffmpegBin = process.env.FFMPEG_BIN ?? "ffmpeg";
  const outputDir = resolve(process.cwd(), "data", "captures");
  mkdirSync(outputDir, { recursive: true });
  const extension = request.mode === "snapshot" ? "jpg" : "mp4";
  const filePath = resolve(outputDir, `${request.cameraName}-${Date.now()}.${extension}`);
  const args =
    request.mode === "snapshot"
      ? ["-y", "-rtsp_transport", "tcp", "-i", request.rtspUrl, "-frames:v", "1", filePath]
      : ["-y", "-rtsp_transport", "tcp", "-i", request.rtspUrl, "-t", "5", "-an", filePath];
  await runCommand(ffmpegBin, args, 15000);
  return {
    cameraName: request.cameraName,
    filePath
  };
}

async function runCommand(command: string, args: string[], timeoutMs: number): Promise<void> {
  await new Promise<void>((resolvePromise, reject) => {
    const child = spawn(command, args, { stdio: "pipe" });
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("ffmpeg capture timed out"));
    }, timeoutMs);

    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += String(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) {
        resolvePromise();
      } else {
        reject(new Error(`ffmpeg exited with code ${code}: ${stderr}`));
      }
    });
  });
}
