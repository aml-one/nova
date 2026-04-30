"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

type LearningItem = {
  id: string;
  at: string;
  category: string;
  proposal: string;
  accepted: boolean;
  result?: string;
  details?: Record<string, unknown>;
};

export default function LearningPage() {
  const [itemsByDate, setItemsByDate] = useState<Record<string, LearningItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  async function load(): Promise<void> {
    setLoading(true);
    const response = await fetch("/api/improvement/history");
    const data = (await response.json()) as { itemsByDate?: Record<string, LearningItem[]> };
    setItemsByDate(data.itemsByDate ?? {});
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function runCycleNow(): Promise<void> {
    setRunning(true);
    setStatus(null);
    const response = await fetch("/api/improvement/cycle", { method: "POST" });
    const data = (await response.json()) as { result?: string; error?: string };
    setStatus(response.ok ? data.result ?? "cycle complete" : data.error ?? "cycle failed");
    await load();
    setRunning(false);
  }

  const dates = Object.keys(itemsByDate).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Learning Timeline</h1>
        <p className="text-sm text-muted">Detailed self-improvement events grouped by date.</p>
        <p className="text-sm text-muted">
          <Link href="/emotion" className="underline">Open Emotion Timeline</Link>
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" tone="blue" onClick={() => void load()}>
          Refresh
        </Button>
        <Button type="button" tone="green" onClick={() => void runCycleNow()} disabled={running}>
          {running ? "Running..." : "Run Learning Cycle"}
        </Button>
      </div>
      {status ? <Card>{status}</Card> : null}
      {loading ? <Card>Loading...</Card> : null}
      {!loading &&
        dates.map((date) => (
          <section key={date} className="space-y-2">
            <h2 className="text-lg font-semibold">{date}</h2>
            <div className="grid gap-2">
              {itemsByDate[date]?.map((item) => (
                <article key={item.id} className="rounded-ui border bg-surface2 p-3">
                  <div>
                    <strong>{new Date(item.at).toLocaleTimeString()}</strong> · {item.category} ·{" "}
                    {item.accepted ? "accepted" : "not accepted"}
                  </div>
                  <div>{item.proposal}</div>
                  {item.result ? <div className="text-muted">Result: {item.result}</div> : null}
                  {renderLearningDetails(item.details)}
                </article>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function renderLearningDetails(details?: Record<string, unknown>): ReactNode | null {
  if (!details || Object.keys(details).length === 0) return null;

  const topics = Array.isArray(details.topics) ? details.topics.map((item) => String(item)) : [];
  const runId = typeof details.runId === "string" ? details.runId : undefined;
  const userId = typeof details.userId === "string" ? details.userId : undefined;
  const failures =
    typeof details.failures === "number" || typeof details.failures === "string" ? String(details.failures) : undefined;
  const notes = typeof details.notes === "string" ? details.notes : undefined;

  return (
    <div className="mt-1 space-y-1 text-xs text-muted">
      {topics.length > 0 ? <div>Topics: {topics.join(", ")}</div> : null}
      {failures ? <div>Recent failures considered: {failures}</div> : null}
      {notes ? <div>Notes: {notes}</div> : null}
      {runId ? <div>Run: {runId}</div> : null}
      {userId ? <div>User: {userId}</div> : null}
    </div>
  );
}
