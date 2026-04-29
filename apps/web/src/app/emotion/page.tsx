"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type EmotionEvent = {
  id: string;
  userId: string;
  source: string;
  trigger: string;
  valence: number;
  arousal: number;
  label: string;
  createdAt: string;
  metadata?: Record<string, unknown>;
};

export default function EmotionPage() {
  const [itemsByDate, setItemsByDate] = useState<Record<string, EmotionEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const [userId, setUserId] = useState("nova-system");

  async function load(targetUserId?: string): Promise<void> {
    setLoading(true);
    const query = targetUserId ? `?userId=${encodeURIComponent(targetUserId)}` : "";
    const response = await fetch(`/api/emotion/history${query}`);
    const data = (await response.json()) as { itemsByDate?: Record<string, EmotionEvent[]> };
    setItemsByDate(data.itemsByDate ?? {});
    setLoading(false);
  }

  useEffect(() => {
    void load(userId);
  }, [userId]);

  const dates = Object.keys(itemsByDate).sort((a, b) => (a < b ? 1 : -1));

  return (
    <main style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 980 }}>
      <h1>Emotion Timeline</h1>
      <p>Track emotional transitions over time and what triggered them.</p>
      <p>
        <Link href="/dashboard">Dashboard</Link> · <Link href="/learning">Learning</Link> ·{" "}
        <Link href="/settings">Settings</Link>
      </p>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="user id (e.g. nova-system)"
          style={{ minWidth: 260, padding: 8 }}
        />
        <button type="button" onClick={() => void load(userId)}>
          Refresh
        </button>
      </div>
      {loading ? <p>Loading...</p> : null}
      {!loading &&
        dates.map((date) => (
          <section key={date} style={{ marginBottom: 18 }}>
            <h2>{date}</h2>
            <div style={{ display: "grid", gap: 10 }}>
              {itemsByDate[date]?.map((item) => (
                <article key={item.id} style={{ border: "1px solid #ddd", borderRadius: 8, padding: 10 }}>
                  <div>
                    <strong>{new Date(item.createdAt).toLocaleTimeString()}</strong> · {item.userId} · {item.source}
                  </div>
                  <div>
                    <strong>{item.label}</strong> (v={item.valence.toFixed(2)}, a={item.arousal.toFixed(2)})
                  </div>
                  <div>Trigger: {item.trigger}</div>
                  {item.metadata ? <pre style={{ margin: 0 }}>{JSON.stringify(item.metadata, null, 2)}</pre> : null}
                </article>
              ))}
            </div>
          </section>
        ))}
    </main>
  );
}
