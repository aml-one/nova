"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

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
    <main style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 980 }}>
      <h1>Learning Timeline</h1>
      <p>Detailed self-improvement events grouped by date.</p>
      <p>
        <Link href="/dashboard">Dashboard</Link> · <Link href="/settings">Settings</Link> · <Link href="/emotion">Emotion</Link>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <button type="button" onClick={() => void load()}>
          Refresh
        </button>
        <button type="button" onClick={() => void runCycleNow()} disabled={running}>
          {running ? "Running..." : "Run Learning Cycle Now"}
        </button>
      </div>
      {status ? <p>{status}</p> : null}
      {loading ? <p>Loading...</p> : null}
      {!loading &&
        dates.map((date) => (
          <section key={date} style={{ marginBottom: 18 }}>
            <h2>{date}</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {itemsByDate[date]?.map((item) => (
                <article key={item.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
                  <div>
                    <strong>{new Date(item.at).toLocaleTimeString()}</strong> · {item.category} ·{" "}
                    {item.accepted ? "accepted" : "not accepted"}
                  </div>
                  <div>{item.proposal}</div>
                  {item.result ? <div style={{ color: "#444" }}>Result: {item.result}</div> : null}
                  {item.details ? <pre style={{ margin: 0 }}>{JSON.stringify(item.details, null, 2)}</pre> : null}
                </article>
              ))}
            </div>
          </section>
        ))}
    </main>
  );
}
