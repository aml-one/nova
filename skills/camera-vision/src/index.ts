import type { RuntimeSkill } from "@nova/skills";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
    permissions: ["camera", "filesystem"],
    inputSchema: {
      type: "object",
      required: ["cameraName", "mode"],
      additionalProperties: false
    },
    version: "0.1.0"
  },
  async run(input: unknown): Promise<unknown> {
    const parsed = input as CameraVisionInput;
    const cameras = loadCameraConfig();
    const camera = resolveCamera(parsed.cameraName, cameras);
    if (!camera) {
      throw new Error(`unknown camera: ${parsed.cameraName}`);
    }
    const rtspUrl = process.env[camera.rtspUrlEnv];
    if (!rtspUrl) {
      throw new Error(`missing RTSP URL env var: ${camera.rtspUrlEnv}`);
    }
    const capture = await captureFromRtsp({
      cameraName: camera.id,
      rtspUrl,
      mode: parsed.mode
    });
    const detections = await detectSceneObjects(capture.filePath);
    const enriched = enrichDetections(detections, {
      plateRecognitionEnabled: camera.plateRecognitionEnabled
    }).map((detection) => {
      if (detection.label === "cat") {
        const identity = identifyCat(camera.id, detection.color, catState);
        return { ...detection, catIdentityHint: identity.displayName };
      }
      return detection;
    });
    persistCameraEvents(camera.id, capture.filePath, enriched);
    return {
      camera: camera.id,
      capture,
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
