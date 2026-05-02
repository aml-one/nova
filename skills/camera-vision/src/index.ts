import type { RuntimeSkill } from "@nova/skills";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { extname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import YAML from "yaml";
import { z } from "zod";
import { enrichDetections } from "./attribute-extractor.js";
import { identifyCat, type CatTrackState } from "./cat-reid.js";
import { captureFromRtsp } from "./rtsp-capture.js";
import { detectSceneObjects } from "./detector.js";

type CameraVisionInput = {
  cameraName: string;
  mode: "snapshot" | "clip5s";
  /** When set (e.g. by agent-core from Settings RTSP list), YAML/env config is not required. */
  rtspUrl?: string;
};

type CameraConfig = {
  id: string;
  aliases: string[];
  rtspUrlEnv: string;
  plateRecognitionEnabled: boolean;
};

const catState: CatTrackState = {};
const cameraConfigSchema = z.object({
  cameras: z.array(
    z.object({
      id: z.string().min(1),
      aliases: z.array(z.string()).default([]),
      rtspUrlEnv: z.string().min(1),
      plateRecognitionEnabled: z.boolean().default(false)
    })
  )
});

export const cameraVisionSkill: RuntimeSkill = {
  manifest: {
    id: "camera-vision",
    name: "Camera Vision",
    description: "Capture RTSP media and extract object insights.",
    settingsTab: {
      id: "camera-vision",
      label: "Camera Vision",
      tone: "purple",
      description: "Manage RTSP camera source URLs."
    },
    permissions: ["camera", "filesystem"],
    inputSchema: {
      type: "object",
      required: ["cameraName", "mode"],
      additionalProperties: true,
      properties: {
        cameraName: { type: "string" },
        mode: { type: "string", enum: ["snapshot", "clip5s"] },
        rtspUrl: { type: "string" }
      }
    },
    version: "0.1.0"
  },
  async run(input: unknown): Promise<unknown> {
    const parsed = input as CameraVisionInput;
    let cameraId: string;
    let rtspUrl: string;
    let plateRecognitionEnabled = false;

    if (parsed.rtspUrl?.trim()) {
      cameraId = parsed.cameraName.trim();
      rtspUrl = parsed.rtspUrl.trim();
    } else {
      const cameras = loadCameraConfig();
      const camera = resolveCamera(parsed.cameraName, cameras);
      if (!camera) {
        throw new Error(`unknown camera: ${parsed.cameraName}`);
      }
      const fromEnv = process.env[camera.rtspUrlEnv];
      if (!fromEnv) {
        throw new Error(`missing RTSP URL env var: ${camera.rtspUrlEnv}`);
      }
      cameraId = camera.id;
      rtspUrl = fromEnv;
      plateRecognitionEnabled = camera.plateRecognitionEnabled;
    }

    const capture = await captureFromRtsp({
      cameraName: cameraId,
      rtspUrl,
      mode: parsed.mode
    });
    const webPath = publishCaptureForWeb(capture.filePath, cameraId);
    const detections = await detectSceneObjects(capture.filePath);
    const enriched = enrichDetections(detections, {
      plateRecognitionEnabled
    }).map((detection) => {
      if (detection.label === "cat") {
        const identity = identifyCat(cameraId, detection.color, catState);
        return { ...detection, catIdentityHint: identity.displayName };
      }
      return detection;
    });
    persistCameraEvents(cameraId, webPath, enriched);
    return {
      camera: cameraId,
      capture: { ...capture, webPath },
      detections: enriched
    };
  }
};

function loadCameraConfig(): CameraConfig[] {
  const candidates = [
    resolve(process.cwd(), "config/cameras/cameras.yaml"),
    resolve(process.cwd(), "../../config/cameras/cameras.yaml")
  ];
  const path = candidates.find((item) => existsSync(item));
  if (!path) {
    return [];
  }
  const raw = readFileSync(path, "utf8");
  const parsed = cameraConfigSchema.parse(YAML.parse(raw));
  return parsed.cameras;
}

function resolveCamera(name: string, cameras: CameraConfig[]): CameraConfig | undefined {
  const lowered = name.trim().toLowerCase();
  return cameras.find(
    (camera) => camera.id.toLowerCase() === lowered || camera.aliases.some((alias) => alias.toLowerCase() === lowered)
  );
}

export default cameraVisionSkill;

function publishCaptureForWeb(sourcePath: string, cameraId: string): string {
  const uploads = resolve(process.cwd(), "data", "uploads");
  mkdirSync(uploads, { recursive: true });
  const ext = extname(sourcePath) || ".jpg";
  const safe = `camera-${cameraId.replace(/[^a-zA-Z0-9._-]/g, "_")}-${Date.now()}${ext}`;
  const dest = resolve(uploads, safe);
  copyFileSync(sourcePath, dest);
  return `/v1/media/files/${encodeURIComponent(safe)}`;
}

function persistCameraEvents(
  cameraId: string,
  capturePath: string,
  detections: Array<{ label: string; color?: string; licensePlate?: string }>
): void {
  const dbPath = resolve(process.cwd(), "data", "state", "nova.db");
  if (!existsSync(dbPath)) {
    return;
  }
  const db = new DatabaseSync(dbPath);
  for (const detection of detections) {
    db.prepare(
      "INSERT INTO camera_events (id, camera_id, label, color, plate, capture_path) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(
      randomUUID(),
      cameraId,
      detection.label,
      detection.color ?? null,
      detection.licensePlate ?? null,
      capturePath
    );
  }
}
