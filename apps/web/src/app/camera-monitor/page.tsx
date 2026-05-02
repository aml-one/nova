"use client";

import { useEffect, useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { parseCameraConfig } from "../../lib/camera-config";
import {
  badgeClassForSkillBadgeState,
  labelForSkillBadgeState,
  resolveSkillBadgeState
} from "../../lib/skill-badge";

type CameraTimelineItem = {
  camera_id?: string;
  label?: string;
  color?: string;
  plate?: string;
  capture_path?: string;
  created_at?: string;
};

type SkillManifest = { id: string; name: string };
type HealthCheck = { id: string; name: string; level: "green" | "orange" | "red"; detail: string };
type FullHealth = { checks: HealthCheck[] };

type AppSettings = {
  skillSettings?: Record<string, Record<string, unknown>>;
};

type CameraEntry = {
  name: string;
  rtspUrl: string;
  enabled: boolean;
};

function webMediaPreviewUrl(capturePath: string): string {
  const p = capturePath.trim();
  if (p.startsWith("/api/media/files/")) return p;
  if (p.startsWith("/v1/media/files/")) return `/api/media/files/${p.slice("/v1/media/files/".length)}`;
  return p;
}

export default function CameraMonitorPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testingName, setTestingName] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("");
  const [settings, setSettings] = useState<AppSettings>({});
  const [timeline, setTimeline] = useState<CameraTimelineItem[]>([]);
  const [draftNames, setDraftNames] = useState<Record<string, string>>({});
  const [skillLoaded, setSkillLoaded] = useState(false);
  const [healthChecks, setHealthChecks] = useState<HealthCheck[]>([]);

  useEffect(() => {
    void refresh();
  }, []);

  async function refresh(): Promise<void> {
    setLoading(true);
    setStatus("");
    const [settingsRes, timelineRes, skillsRes, healthRes] = await Promise.all([
      fetch("/api/settings"),
      fetch("/api/camera/timeline"),
      fetch("/api/skills/manifests"),
      fetch("/api/system/health")
    ]);
    const settingsData = (await settingsRes.json()) as { settings?: AppSettings };
    const timelineData = (await timelineRes.json()) as { items?: CameraTimelineItem[] };
    const skillsData = (await skillsRes.json()) as { items?: SkillManifest[] };
    const healthData = (await healthRes.json()) as { health?: FullHealth };
    setSettings(settingsData.settings ?? {});
    setTimeline(Array.isArray(timelineData.items) ? timelineData.items : []);
    setHealthChecks(healthData.health?.checks ?? []);

    const manifests = skillsData.items ?? [];
    const cameraManifest = manifests.find((item) => item.id === "camera-vision" || item.id === "cameraVision");
    setSkillLoaded(Boolean(cameraManifest));
    setLoading(false);
  }

  const cameraEntries = useMemo(() => {
    const cameraConfig = (settings.skillSettings?.["camera-vision"] ?? settings.skillSettings?.["cameraVision"] ?? {}) as Record<string, unknown>;
    return parseCameraConfig(cameraConfig);
  }, [settings]);

  const cameraSkillBadge = useMemo(
    () =>
      resolveSkillBadgeState(
        { id: "camera-vision", name: "Camera Vision" },
        healthChecks,
        settings.skillSettings ?? {}
      ),
    [healthChecks, settings.skillSettings]
  );

  const latestByCamera = useMemo(() => {
    const map = new Map<string, CameraTimelineItem>();
    for (const item of timeline) {
      const key = String(item.camera_id ?? item.label ?? "");
      if (!key || map.has(key)) continue;
      map.set(key, item);
    }
    return map;
  }, [timeline]);

  async function saveCameraToggle(cameraName: string, enabled: boolean): Promise<void> {
    setSaving(true);
    setStatus("");
    const cameraConfig = (settings.skillSettings?.["camera-vision"] ?? settings.skillSettings?.["cameraVision"] ?? {}) as Record<string, unknown>;
    const disabled = new Set(
      Array.isArray(cameraConfig.disabledCameraNames)
        ? (cameraConfig.disabledCameraNames as unknown[]).map((item) => String(item))
        : []
    );
    if (enabled) disabled.delete(cameraName);
    else disabled.add(cameraName);
    const nextSkillSettings = {
      ...(settings.skillSettings ?? {}),
      ["camera-vision"]: {
        ...cameraConfig,
        disabledCameraNames: Array.from(disabled)
      },
      ["cameraVision"]: {
        ...((settings.skillSettings?.["cameraVision"] ?? {}) as Record<string, unknown>),
        disabledCameraNames: Array.from(disabled)
      }
    };
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillSettings: nextSkillSettings })
    });
    const data = (await response.json()) as { settings?: AppSettings; error?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Failed to save camera toggle");
    } else {
      setSettings(data.settings ?? settings);
      setStatus(`Saved ${cameraName} as ${enabled ? "enabled" : "disabled"}.`);
    }
    setSaving(false);
  }

  async function saveCameraNames(): Promise<void> {
    const cameraConfig = (settings.skillSettings?.["camera-vision"] ?? settings.skillSettings?.["cameraVision"] ?? {}) as Record<string, unknown>;
    const parsed = parseCameraConfig(cameraConfig);
    const rewritten = parsed
      .map((cam) => {
        const nextName = (draftNames[cam.name] ?? cam.name).trim() || cam.name;
        return `${nextName}|${cam.rtspUrl}`;
      })
      .join("\n");
    setSaving(true);
    const nextSkillSettings = {
      ...(settings.skillSettings ?? {}),
      ["camera-vision"]: {
        ...cameraConfig,
        rtspUrls: rewritten
      },
      ["cameraVision"]: {
        ...((settings.skillSettings?.["cameraVision"] ?? {}) as Record<string, unknown>),
        rtspUrls: rewritten
      }
    };
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ skillSettings: nextSkillSettings })
    });
    const data = (await response.json()) as { settings?: AppSettings; error?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Failed to save camera names");
    } else {
      setSettings(data.settings ?? settings);
      setStatus("Camera names saved.");
      setDraftNames({});
    }
    setSaving(false);
  }

  async function testCamera(cameraName: string): Promise<void> {
    setTestingName(cameraName);
    setStatus("");
    const response = await fetch("/api/camera/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ cameraName })
    });
    const data = (await response.json()) as { ok?: boolean; result?: { detections?: unknown[] }; error?: string; hint?: string };
    if (!response.ok) {
      setStatus(data.error ?? `Camera test failed for ${cameraName}`);
    } else {
      if (data.ok === false) {
        setStatus(`Camera test for ${cameraName} returned runtime error: ${data.error ?? "unknown error"}${data.hint ? ` (${data.hint})` : ""}`);
      } else {
        const count = Array.isArray(data.result?.detections) ? data.result!.detections!.length : 0;
        setStatus(`Camera test complete for ${cameraName}. Detections: ${count}.`);
      }
      await refresh();
    }
    setTestingName(null);
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-2xl font-semibold">Camera Monitor</h1>
            <p className="text-sm text-muted">Connection checks, test snapshots, detections, and per-camera controls.</p>
          </div>
          <Button type="button" tone="blue" onClick={() => void refresh()} disabled={loading}>
            {loading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
          <span>Skill runtime: {skillLoaded ? "loaded" : "not loaded"}</span>
          <span className={badgeClassForSkillBadgeState(cameraSkillBadge)}>{labelForSkillBadgeState(cameraSkillBadge)}</span>
        </div>
        {!skillLoaded ? (
          <div className="rounded-ui border border-rose-500/40 bg-rose-500/10 p-2 text-xs text-rose-200">
            Camera skill is not loaded, so tests/snapshots may not work until the runtime module is available.
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <h2 className="text-lg font-semibold">Per-Camera Controls</h2>
        <div className="flex items-center gap-2">
          <Button type="button" tone="green" onClick={() => void saveCameraNames()} disabled={saving || cameraEntries.length === 0}>
            Save camera names
          </Button>
          <span className="text-xs text-muted">Use custom names to map camera tests and timeline entries.</span>
        </div>
        {cameraEntries.length === 0 ? <p className="text-sm text-muted">No camera entries found. Add RTSP URLs in Settings → Camera Vision.</p> : null}
        <div className="space-y-2">
          {cameraEntries.map((camera) => {
            const latest = latestByCamera.get(camera.name);
            const isValidRtsp = /^rtsp:\/\//i.test(camera.rtspUrl);
            const preview = String(latest?.capture_path ?? "");
            const imgSrc = preview ? webMediaPreviewUrl(preview) : "";
            const showImage = /^https?:\/\//i.test(imgSrc) || imgSrc.startsWith("/api/media/files/");
            return (
              <article key={camera.name} className="rounded-ui border bg-surface p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <input
                      value={draftNames[camera.name] ?? camera.name}
                      onChange={(e) => setDraftNames((prev) => ({ ...prev, [camera.name]: e.target.value }))}
                      className="h-8 rounded-ui border bg-surface px-2 text-sm font-semibold"
                      placeholder="Camera name"
                    />
                    <div className="text-xs text-muted">{camera.rtspUrl}</div>
                    <div className="mt-1 text-[11px] text-muted">Connection check: {isValidRtsp ? "RTSP format looks valid" : "Invalid RTSP format"}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <label className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={camera.enabled}
                        onChange={(e) => void saveCameraToggle(camera.name, e.target.checked)}
                        disabled={saving}
                      />
                      Enabled
                    </label>
                    <Button type="button" tone="purple" onClick={() => void testCamera(camera.name)} disabled={testingName === camera.name || !camera.enabled}>
                      {testingName === camera.name ? "Testing..." : "Test"}
                    </Button>
                  </div>
                </div>
                <div className="mt-2 grid gap-2 md:grid-cols-[180px_1fr]">
                  <div className="h-28 overflow-hidden rounded-ui border bg-surface2">
                    {showImage ? (
                      <img src={imgSrc} alt={`${camera.name} snapshot`} className="h-full w-full object-cover" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-2 text-center text-[11px] text-muted">
                        {preview ? "No web preview for this capture path." : "No snapshot yet."}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-muted">
                    <div>Last event: {latest?.created_at ? new Date(latest.created_at).toLocaleString() : "-"}</div>
                    <div>Label: {latest?.label ?? "-"}</div>
                    <div>Color: {latest?.color ?? "-"}</div>
                    <div>Plate: {latest?.plate ?? "-"}</div>
                    <div className="truncate">Capture: {preview || "-"}</div>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Detection Timeline</h2>
        <div className="max-h-[52vh] space-y-2 overflow-auto pr-1">
          {timeline.length === 0 ? <p className="text-sm text-muted">No camera detections yet.</p> : null}
          {timeline.map((item, index) => (
            <article key={`${item.camera_id ?? "camera"}-${item.created_at ?? index}`} className="rounded-ui border bg-surface p-2 text-xs">
              <div className="font-semibold">{item.camera_id ?? "unknown camera"} · {item.label ?? "unknown"}</div>
              <div className="text-muted">{item.created_at ? new Date(item.created_at).toLocaleString() : "-"}</div>
              <div className="text-muted">color={item.color ?? "-"} · plate={item.plate ?? "-"}</div>
            </article>
          ))}
        </div>
      </Card>

      {status ? <Card className="text-sm">{status}</Card> : null}
    </div>
  );
}
