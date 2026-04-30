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

export default function SkillsPage() {
  const [items, setItems] = useState<SkillManifest[]>([]);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/skills/manifests");
      const data = (await response.json()) as { items?: SkillManifest[] };
      if (response.ok) setItems(data.items ?? []);
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
            <div className="text-sm font-semibold">{item.name || item.id}</div>
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
