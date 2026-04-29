import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import { resolve, extname, basename } from "node:path";
import { spawnSync } from "node:child_process";

const uploadsDir = resolve(process.cwd(), "data", "uploads");

export function saveUpload(base64Data: string, filename: string): {
  urlPath: string;
  contentType: string;
  kind: "image" | "video" | "other";
  posterUrlPath?: string;
} {
  mkdirSync(uploadsDir, { recursive: true });
  const safeName = sanitizeFilename(filename);
  const filePath = resolve(uploadsDir, safeName);
  const buffer = Buffer.from(base64Data, "base64");
  writeFileSync(filePath, buffer);
  const contentType = detectContentType(safeName);
  const kind = detectKind(contentType);
  const posterUrlPath = kind === "video" ? generateVideoPoster(safeName, filePath) : undefined;
  return {
    urlPath: `/v1/media/files/${encodeURIComponent(safeName)}`,
    contentType,
    kind,
    posterUrlPath
  };
}

export function getUploadFile(name: string): { content: Buffer; contentType: string } | undefined {
  const decoded = decodeURIComponent(name);
  const safeName = sanitizeFilename(decoded);
  const filePath = resolve(uploadsDir, safeName);
  if (!existsSync(filePath)) {
    return undefined;
  }
  return {
    content: readFileSync(filePath),
    contentType: detectContentType(safeName)
  };
}

function sanitizeFilename(name: string): string {
  const base = name.replace(/[^a-zA-Z0-9._-]/g, "_");
  return base.length > 0 ? base : `upload-${Date.now()}`;
}

function detectContentType(name: string): string {
  const ext = extname(name).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".mp4") return "video/mp4";
  if (ext === ".webm") return "video/webm";
  if (ext === ".mov") return "video/quicktime";
  return "application/octet-stream";
}

function detectKind(contentType: string): "image" | "video" | "other" {
  if (contentType.startsWith("image/")) return "image";
  if (contentType.startsWith("video/")) return "video";
  return "other";
}

function generateVideoPoster(safeName: string, filePath: string): string | undefined {
  const ffmpeg = process.env.FFMPEG_BIN ?? "ffmpeg";
  const posterName = `${basename(safeName, extname(safeName))}.poster.jpg`;
  const posterPath = resolve(uploadsDir, posterName);
  const result = spawnSync(
    ffmpeg,
    ["-y", "-i", filePath, "-ss", "00:00:01.000", "-vframes", "1", posterPath],
    { shell: true, encoding: "utf8" }
  );
  if (result.status !== 0 || !existsSync(posterPath)) {
    return undefined;
  }
  return `/v1/media/files/${encodeURIComponent(posterName)}`;
}
