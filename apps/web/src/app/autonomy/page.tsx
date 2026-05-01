"use client";

import { useMemo, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";

type InspectPayload = Record<string, unknown>;

export default function AutonomyPage() {
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(300);
  const [payload, setPayload] = useState<InspectPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const formatted = useMemo(() => JSON.stringify(payload ?? {}, null, 2), [payload]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/improvement/inspect?limit=${encodeURIComponent(String(limit))}`);
      const data = (await response.json()) as InspectPayload & { error?: string };
      if (!response.ok) {
        setError(String(data.error ?? "Failed to load autonomy snapshot"));
        setPayload(null);
      } else {
        setPayload(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  async function copyJson(): Promise<void> {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold">Autonomy Health</h1>
        <p className="text-sm text-muted">
          Snapshot of learning, thoughts, emotions, outcomes, and loop diagnostics. Copy the JSON and share it for deep review.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">Rows</label>
          <input
            type="number"
            min={20}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value || 300))}
            className="h-8 w-24 rounded-ui border bg-surface px-2 text-sm"
          />
          <Button type="button" tone="blue" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Refresh snapshot"}
          </Button>
          <Button type="button" tone="purple" onClick={() => void copyJson()} disabled={!payload}>
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </div>
      </Card>

      {error ? <Card className="text-sm text-rose-400">{error}</Card> : null}

      <Card>
        {!payload ? (
          <p className="text-sm text-muted">Press "Refresh snapshot" to load diagnostics.</p>
        ) : (
          <pre className="max-h-[68vh] overflow-auto rounded-ui border bg-surface2 p-3 text-xs">{formatted}</pre>
        )}
      </Card>
    </div>
  );
}
