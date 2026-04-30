"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Button } from "../../components/ui/button";

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
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Emotion Timeline</h1>
        <p className="text-sm text-muted">Track emotional transitions over time and what triggered them.</p>
        <p className="text-sm text-muted"><Link href="/learning" className="underline">Back to Learning</Link></p>
      </div>
      <div className="flex gap-2">
        <Input
          value={userId}
          onChange={(event) => setUserId(event.target.value)}
          placeholder="user id (e.g. nova-system)"
          className="max-w-sm"
        />
        <Button type="button" tone="purple" onClick={() => void load(userId)}>
          Refresh
        </Button>
      </div>
      {loading ? <Card>Loading...</Card> : null}
      {!loading &&
        dates.map((date) => (
          <section key={date} className="space-y-2">
            <h2 className="text-lg font-semibold">{date}</h2>
            <div className="grid gap-2">
              {itemsByDate[date]?.map((item) => (
                <article key={item.id} className="rounded-ui border bg-surface2 p-3">
                  <div>
                    <strong>{new Date(item.createdAt).toLocaleTimeString()}</strong> · {item.userId} · {item.source}
                  </div>
                  <div>
                    <strong>{item.label}</strong> (v={item.valence.toFixed(2)}, a={item.arousal.toFixed(2)})
                  </div>
                  <div>Trigger: {item.trigger}</div>
                  {item.metadata ? <pre className="m-0 overflow-x-auto text-xs">{JSON.stringify(item.metadata, null, 2)}</pre> : null}
                </article>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}
