"use client";

import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

export default function ReportsPage() {
  const [weekly, setWeekly] = useState<{ summary?: Record<string, unknown>; items?: unknown[] }>({});
  const [digest, setDigest] = useState<{ summary?: Record<string, unknown>; items?: unknown[] }>({});

  async function load(): Promise<void> {
    const [w, d] = await Promise.all([
      fetch("/api/reports/learning/weekly"),
      fetch("/api/security/digest/overnight")
    ]);
    setWeekly(await w.json());
    setDigest(await d.json());
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-4">
      <Card className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Reports</h1>
          <p className="text-sm text-muted">Weekly learning report and overnight anomaly digest.</p>
          <p className="text-xs text-muted">Use this page for quick health snapshots. Raw JSON is available only on demand.</p>
        </div>
        <Button type="button" tone="blue" onClick={() => void load()}>Refresh</Button>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Weekly Learning</h2>
        {renderSummary(weekly.summary)}
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Show raw JSON</summary>
          <pre className="mt-2 overflow-x-auto rounded-ui border bg-surface2 p-2">{JSON.stringify(weekly.summary ?? {}, null, 2)}</pre>
        </details>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Overnight Security Digest</h2>
        {renderSummary(digest.summary)}
        <details className="mt-2 text-xs text-muted">
          <summary className="cursor-pointer">Show raw JSON</summary>
          <pre className="mt-2 overflow-x-auto rounded-ui border bg-surface2 p-2">{JSON.stringify(digest.summary ?? {}, null, 2)}</pre>
        </details>
      </Card>
    </div>
  );
}

function renderSummary(summary?: Record<string, unknown>): ReactNode {
  const data = summary ?? {};
  const entries = Object.entries(data);
  if (entries.length === 0) {
    return <p className="text-sm text-muted">No report data available yet.</p>;
  }
  return (
    <div className="grid gap-2 md:grid-cols-2">
      {entries.map(([key, value]) => (
        <article key={key} className="rounded-ui border bg-surface p-2">
          <div className="text-[11px] uppercase tracking-wide text-muted">{toLabel(key)}</div>
          <div className="text-sm">{formatValue(value)}</div>
        </article>
      ))}
    </div>
  );
}

function toLabel(key: string): string {
  return key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function formatValue(value: unknown): string {
  if (value === null || value === undefined) return "-";
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return `${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} field(s)`;
  return String(value);
}
