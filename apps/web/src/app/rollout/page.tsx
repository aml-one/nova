"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

type Checkpoint = { id: string; kind: string; label: string; status: string; created_at: string };

export default function RolloutPage() {
  const [items, setItems] = useState<Checkpoint[]>([]);
  const [label, setLabel] = useState("settings-canary");
  const [percent, setPercent] = useState(10);
  const [candidateSettingsJson, setCandidateSettingsJson] = useState('{"activeProvider":"lmstudio"}');

  async function load(): Promise<void> {
    const response = await fetch("/api/rollout/checkpoint/list");
    const data = (await response.json()) as { items?: Checkpoint[] };
    if (response.ok) setItems(data.items ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Rollout & Checkpoints</h1>
        <p className="text-sm text-muted">Create checkpoints, stage rollout percentage, rollback safely.</p>
      </Card>
      <Card className="space-y-2">
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Checkpoint label" />
        <div className="flex gap-2">
          <Button
            type="button"
            tone="green"
            onClick={async () => {
              await fetch("/api/rollout/checkpoint/create", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ kind: "settings", label })
              });
              await load();
            }}
          >
            Create checkpoint
          </Button>
          <Button type="button" tone="blue" onClick={() => void load()}>Refresh</Button>
        </div>
      </Card>
      <Card className="space-y-2">
        <p className="text-xs text-muted">Cohort staged settings JSON (applies only to staged percentage).</p>
        <textarea
          value={candidateSettingsJson}
          onChange={(e) => setCandidateSettingsJson(e.target.value)}
          className="min-h-[90px] w-full rounded-ui border bg-surface px-2 py-1 text-sm"
        />
        {items.map((item) => (
          <article key={item.id} className="rounded-ui border bg-surface p-2">
            <div><strong>{item.label}</strong> · {item.status}</div>
            <div className="text-xs text-muted">{item.id}</div>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <Input type="number" value={percent} onChange={(e) => setPercent(Number(e.target.value || 0))} className="max-w-[120px]" />
              <Button
                type="button"
                tone="yellow"
                onClick={async () => {
                  let candidateSettings: Record<string, unknown> | undefined;
                  try {
                    candidateSettings = JSON.parse(candidateSettingsJson) as Record<string, unknown>;
                  } catch {
                    candidateSettings = undefined;
                  }
                  await fetch("/api/rollout/checkpoint/stage", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id: item.id, rolloutPercent: percent, candidateSettings })
                  });
                }}
              >
                Stage %
              </Button>
              <Button
                type="button"
                tone="red"
                onClick={async () => {
                  await fetch("/api/rollout/checkpoint/rollback", {
                    method: "POST",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id: item.id })
                  });
                  await load();
                }}
              >
                Rollback
              </Button>
            </div>
          </article>
        ))}
      </Card>
    </div>
  );
}
