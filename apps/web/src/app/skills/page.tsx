"use client";

import { useCallback, useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Checkbox } from "../../components/ui/checkbox";
import { isSkillRuntimeEnabled } from "../../lib/skill-enabled";
import {
  badgeClassForSkillBadgeState,
  labelForSkillBadgeState,
  resolveSkillBadgeState
} from "../../lib/skill-badge";
import { apiFetch } from "../../lib/api-fetch";

type SkillManifest = {
  id: string;
  name: string;
  description?: string;
  settingsTab?: { id: string; label: string; description?: string };
  permissions?: string[];
};
type HealthCheck = { id: string; name: string; level: "green" | "orange" | "red"; detail: string };
type FullHealth = { level: "green" | "orange" | "red"; checks: HealthCheck[] };

export default function SkillsPage() {
  const [items, setItems] = useState<SkillManifest[]>([]);
  const [health, setHealth] = useState<FullHealth | null>(null);
  const [skillSettings, setSkillSettings] = useState<Record<string, Record<string, unknown>>>({});
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      const [skillsResponse, healthResponse, settingsResponse] = await Promise.all([
        apiFetch("/api/skills/manifests"),
        apiFetch("/api/system/health"),
        apiFetch("/api/settings")
      ]);
      const skillsData = (await skillsResponse.json()) as { items?: SkillManifest[] };
      const healthData = (await healthResponse.json()) as { health?: FullHealth };
      const settingsData = (await settingsResponse.json()) as { settings?: { skillSettings?: Record<string, Record<string, unknown>> } };
      if (skillsResponse.ok) setItems(skillsData.items ?? []);
      if (healthResponse.ok) setHealth(healthData.health ?? null);
      if (settingsResponse.ok) {
        setSkillSettings(settingsData.settings?.skillSettings ?? {});
      }
    })();
  }, []);

  const persistSkillEnabled = useCallback(async (skillId: string, enabled: boolean) => {
    setToggleError(null);
    setTogglingId(skillId);
    try {
      const skillSettingsPayload =
        skillId === "camera-vision" || skillId === "cameraVision"
          ? { "camera-vision": { enabled }, cameraVision: { enabled } }
          : { [skillId]: { enabled } };
      const response = await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ skillSettings: skillSettingsPayload })
      });
      const data = (await response.json()) as { settings?: { skillSettings?: Record<string, Record<string, unknown>> }; error?: string };
      if (!response.ok) {
        setToggleError(data.error ?? "Save failed");
        return;
      }
      setSkillSettings(data.settings?.skillSettings ?? {});
    } catch {
      setToggleError("Network error while saving");
    } finally {
      setTogglingId(null);
    }
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Skills</h1>
        <p className="text-sm text-muted">
          Loaded skill modules and permissions. Use the switch to enable or disable each skill (saved immediately). Fine-tune options under{" "}
          <strong>Settings</strong> when a skill has a settings tab.
        </p>
        {toggleError ? <p className="mt-2 text-xs text-rose-600">{toggleError}</p> : null}
      </Card>
      <Card className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-muted">No skills loaded yet.</p> : null}
        {items.map((item) => {
          const badge = resolveSkillBadgeState(item, health?.checks ?? [], skillSettings);
          return (
          <article key={item.id} className="rounded-ui border bg-surface p-3">
            <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
              <div className="text-sm font-semibold">{item.name || item.id}</div>
              <div className="flex items-center gap-2">
                <span className={badgeClassForSkillBadgeState(badge)}>{labelForSkillBadgeState(badge)}</span>
                <label className="flex items-center gap-2 text-xs text-muted">
                  <Checkbox
                    checked={isSkillRuntimeEnabled(skillSettings, item.id)}
                    disabled={togglingId === item.id}
                    onChange={(e) => void persistSkillEnabled(item.id, e.target.checked)}
                  />
                  {togglingId === item.id ? "Saving…" : "Enabled"}
                </label>
              </div>
            </div>
            <div className="text-xs text-muted">{item.description || "No description provided."}</div>
            <div className="mt-1 text-xs text-muted">ID: {item.id}</div>
            {item.settingsTab ? (
              <div className="text-xs text-muted">Settings tab: {item.settingsTab.label}</div>
            ) : (
              <div className="text-xs text-muted">Settings tab: none</div>
            )}
            <div className="text-xs text-muted">
              Permissions: {item.permissions && item.permissions.length > 0 ? item.permissions.join(", ") : "none declared"}
            </div>
          </article>
          );
        })}
      </Card>
    </div>
  );
}
