"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { formatLocalDayHeading, groupByLocalCalendarDate } from "../../lib/local-date";
import { WEB_CHAT_EMOTION_USER_ID } from "../../lib/emotion-user";

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
  const moodUserId = WEB_CHAT_EMOTION_USER_ID;

  async function load(targetUserId?: string): Promise<void> {
    setLoading(true);
    const id = targetUserId ?? moodUserId;
    const response = await fetch(`/api/emotion/history?userId=${encodeURIComponent(id)}`);
    const data = (await response.json()) as { items?: EmotionEvent[]; itemsByDate?: Record<string, EmotionEvent[]> };
    const flat = Array.isArray(data.items) ? data.items : [];
    setItemsByDate(flat.length > 0 ? groupByLocalCalendarDate(flat) : data.itemsByDate ?? {});
    setLoading(false);
  }

  useEffect(() => {
    void load(moodUserId);
  }, []);

  const dates = Object.keys(itemsByDate).sort((a, b) => (a < b ? 1 : -1));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Emotion Timeline</h1>
        <p className="text-sm text-muted">Track emotional transitions over time and what triggered them.</p>
        <p className="text-xs text-muted">
          One mood for all platforms and contacts — stored as <code>{moodUserId}</code> (includes learning-loop events).
        </p>
        <p className="text-xs text-muted">
          `v` means valence (how positive/pleasant the feeling is), and `a` means arousal (how energized/active it is).
        </p>
        <p className="text-sm text-muted"><Link href="/learning" className="underline">Back to Learning</Link></p>
      </div>
      <div className="flex gap-2">
        <Button type="button" tone="purple" onClick={() => void load(moodUserId)}>
          Refresh
        </Button>
      </div>
      {loading ? <Card>Loading...</Card> : null}
      {!loading &&
        dates.map((date) => (
          <section key={date} className="space-y-2">
            <h2 className="text-lg font-semibold">{formatLocalDayHeading(date)}</h2>
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
                  {renderEmotionMetadata(item.metadata)}
                </article>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function renderEmotionMetadata(metadata?: Record<string, unknown>): ReactNode | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  const event = typeof metadata.event === "string" ? metadata.event : undefined;
  const source = typeof metadata.source === "string" ? metadata.source : undefined;
  const reason = typeof metadata.reason === "string" ? metadata.reason : undefined;
  const confidence = typeof metadata.confidence === "number" ? metadata.confidence : undefined;
  return (
    <div className="mt-1 space-y-1 text-xs text-muted">
      {event ? <div>Event: {event}</div> : null}
      {source ? <div>Source detail: {source}</div> : null}
      {reason ? <div>Reason: {reason}</div> : null}
      {confidence !== undefined ? <div>Confidence: {confidence.toFixed(2)}</div> : null}
    </div>
  );
}
