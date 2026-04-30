"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";

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

  useEffect(() => {
    void (async () => {
      const [skillsResponse, healthResponse] = await Promise.all([fetch("/api/skills/manifests"), fetch("/api/system/health")]);
      const skillsData = (await skillsResponse.json()) as { items?: SkillManifest[] };
      const healthData = (await healthResponse.json()) as { health?: FullHealth };
      if (skillsResponse.ok) setItems(skillsData.items ?? []);
      if (healthResponse.ok) setHealth(healthData.health ?? null);
    })();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Skills</h1>
        <p className="text-sm text-muted">Loaded skill modules, their purpose, permissions, and settings integration.</p>
      </Card>
      <Card className="space-y-2">
        {items.length === 0 ? <p className="text-sm text-muted">No skills loaded yet.</p> : null}
        {items.map((item) => (
          <article key={item.id} className="rounded-ui border bg-surface p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <div className="text-sm font-semibold">{item.name || item.id}</div>
              <span className={badgeClassForSkillStatus(resolveSkillStatus(item, health?.checks ?? []))}>
                {resolveSkillStatus(item, health?.checks ?? [])}
              </span>
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
        ))}
      </Card>
    </div>
  );
}

function resolveSkillStatus(item: SkillManifest, checks: HealthCheck[]): "active" | "degraded" | "inactive" {
  const matched = checks.find((check) => {
    const raw = `${check.id} ${check.name} ${check.detail}`.toLowerCase();
    return raw.includes(item.id.toLowerCase()) || raw.includes(item.name.toLowerCase());
  });
  if (!matched) return "inactive";
  if (matched.level === "green") return "active";
  if (matched.level === "orange") return "degraded";
  return "inactive";
}

function badgeClassForSkillStatus(status: "active" | "degraded" | "inactive"): string {
  if (status === "active") return "rounded-ui border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300";
  if (status === "degraded") return "rounded-ui border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300";
  return "rounded-ui border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300";
}
