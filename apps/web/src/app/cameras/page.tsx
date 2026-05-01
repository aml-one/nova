"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import Link from "next/link";
import { parseCameraConfig, type ParsedCameraConfig } from "../../lib/camera-config";

type CameraItem = {
  camera_id: string;
  label: string;
  color?: string;
  plate?: string;
  capture_path?: string;
  created_at: string;
};

export default function CamerasPage() {
  const [items, setItems] = useState<CameraItem[]>([]);
  const [configured, setConfigured] = useState<ParsedCameraConfig[]>([]);

  async function load(): Promise<void> {
    const [timelineRes, settingsRes] = await Promise.all([fetch("/api/camera/timeline"), fetch("/api/settings")]);
    const timelineData = (await timelineRes.json()) as { items?: CameraItem[] };
    const settingsData = (await settingsRes.json()) as { settings?: { skillSettings?: Record<string, Record<string, unknown>> } };
    if (timelineRes.ok) setItems(timelineData.items ?? []);
    const cfg =
      (settingsData.settings?.skillSettings?.["camera-vision"] ??
        settingsData.settings?.skillSettings?.["cameraVision"] ??
        {}) as Record<string, unknown>;
    setConfigured(parseCameraConfig(cfg));
  }

  useEffect(() => {
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Camera Mosaic</h1>
          <p className="text-sm text-muted">Live semantic alerts from camera timeline detections.</p>
          <p className="text-xs text-muted">
            This page shows recent detections across connected camera feeds, including guessed label, color, and license plate if available.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" tone="blue" onClick={() => void load()}>Refresh</Button>
          <Link href="/camera-monitor" className="text-sm text-sky-400 hover:text-sky-300">Open Camera Monitor</Link>
        </div>
      </Card>
      {configured.length > 0 ? (
        <Card className="space-y-2">
          <h2 className="text-lg font-semibold">Configured Cameras</h2>
          <div className="grid gap-2 md:grid-cols-3">
            {configured.map((camera) => (
              <article key={camera.name} className="rounded-ui border bg-surface p-2 text-xs">
                <div className="font-semibold">{camera.name}</div>
                <div className="truncate text-muted">{camera.rtspUrl}</div>
                <div className="text-muted">status: {camera.enabled ? "enabled" : "disabled"}</div>
              </article>
            ))}
          </div>
        </Card>
      ) : null}
      <div className="grid gap-3 md:grid-cols-3">
        {items.slice(0, 30).map((item, index) => (
          <Card key={`${item.camera_id}-${item.created_at}-${index}`} className="space-y-2">
            <div className="text-xs text-muted">{item.camera_id}</div>
            <strong>{item.label}</strong>
            <div className="text-sm">color: {item.color ?? "-"}</div>
            <div className="text-sm">plate: {item.plate ?? "-"}</div>
            <div className="text-xs text-muted">{new Date(item.created_at).toLocaleString()}</div>
          </Card>
        ))}
      </div>
      {items.length === 0 ? (
        <Card>
          <p className="text-sm text-muted">
            No detection events yet. Use <Link href="/camera-monitor" className="text-sky-400 hover:text-sky-300">Camera Monitor</Link> to run per-camera tests and trigger snapshots.
          </p>
        </Card>
      ) : null}
    </div>
  );
}
