"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { formatLocalDayHeading, groupByLocalCalendarDate } from "../../lib/local-date";
import { WEB_CHAT_EMOTION_USER_ID } from "../../lib/emotion-user";
import { cn } from "../../lib/cn";

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

/** Stored token `"neutral"` is shown in the UI as `"calm"` for human readability. */
function humanizeMoodLabel(label: string): string {
  return label === "neutral" ? "calm" : label;
}

export default function EmotionPage() {
  const [itemsByDate, setItemsByDate] = useState<Record<string, EmotionEvent[]>>({});
  const [loading, setLoading] = useState(true);
  const moodUserId = WEB_CHAT_EMOTION_USER_ID;

  async function load(targetUserId?: string): Promise<void> {
    setLoading(true);
    const id = targetUserId ?? moodUserId;
    const response = await fetch(`/api/emotion/history?userId=${encodeURIComponent(id)}`, {
      credentials: "include"
    });
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
    <div className="space-y-5">
      <div className="rounded-2xl border border-violet-500/25 bg-gradient-to-br from-violet-950/40 via-surface to-sky-950/30 p-5 shadow-lg shadow-violet-900/10">
        <h1 className="text-2xl font-semibold tracking-tight text-text">Emotion timeline</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">Unified mood across channels — what Nova felt and what shifted it.</p>
        <p className="mt-2 text-[11px] text-muted">
          Stored as <code className="rounded bg-black/20 px-1 py-0.5">{moodUserId}</code>. Valence ≈ pleasantness; arousal ≈ energy.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button type="button" tone="purple" onClick={() => void load(moodUserId)}>
            Refresh
          </Button>
          <Link href="/learning" className="inline-flex items-center rounded-ui border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface2">
            Learning log
          </Link>
        </div>
      </div>

      {loading ? <Card className="p-6 text-sm text-muted">Loading…</Card> : null}

      {!loading &&
        dates.map((date) => (
          <section key={date} className="space-y-3">
            <div className="flex items-center gap-3">
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />
              <h2 className="shrink-0 text-sm font-semibold uppercase tracking-wide text-violet-200/90">{formatLocalDayHeading(date)}</h2>
              <span className="h-px flex-1 bg-gradient-to-r from-transparent via-violet-400/40 to-transparent" />
            </div>
            <div className="relative space-y-3 pl-3 md:pl-6">
              <div className="absolute bottom-2 left-[7px] top-2 w-px bg-gradient-to-b from-fuchsia-400/50 via-sky-400/35 to-emerald-400/45 md:left-[13px]" />
              {itemsByDate[date]?.map((item) => (
                <EmotionTimelineCard key={item.id} item={item} />
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function EmotionTimelineCard({ item }: { item: EmotionEvent }) {
  const accent = sourceAccent(item.source);
  const moodHue = moodAccent(item.label);
  const meta = renderEmotionMetadata(item.metadata);

  return (
    <article
      className={cn(
        "relative ml-2 overflow-hidden rounded-2xl border bg-surface/90 shadow-md backdrop-blur-sm transition hover:border-opacity-80 md:ml-4",
        accent.border,
        accent.ring
      )}
    >
      <div className={cn("absolute inset-y-0 left-0 w-1 rounded-l-2xl bg-gradient-to-b", accent.bar)} />
      <div className="p-4 pl-5">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={accent.badgeTone}>{formatSource(item.source)}</Badge>
            <span className="font-mono text-[11px] tabular-nums text-muted">{new Date(item.createdAt).toLocaleTimeString()}</span>
            <span className="text-[11px] text-muted">· {shortUser(item.userId)}</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <span
            className={cn(
              "inline-flex items-center rounded-full px-3 py-1 text-sm font-semibold text-white shadow-inner",
              "bg-gradient-to-r",
              moodHue
            )}
          >
            {humanizeMoodLabel(item.label)}
          </span>
          <MeterChip label="Valence" value={item.valence} chroma="from-emerald-400/90 to-teal-600/90" />
          <MeterChip label="Arousal" value={item.arousal} chroma="from-amber-400/90 to-orange-600/90" />
        </div>
        <p className="mt-2 text-sm leading-relaxed text-text">
          <span className="font-medium text-sky-200/95">Trigger · </span>
          <span className="text-muted">{item.trigger}</span>
        </p>
        {meta}
      </div>
    </article>
  );
}

function MeterChip({ label, value, chroma }: { label: string; value: number; chroma: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <div className="flex min-w-[120px] flex-col gap-0.5 rounded-lg border border-white/10 bg-black/15 px-2 py-1">
      <div className="flex justify-between text-[10px] font-medium uppercase tracking-wide text-muted">
        <span>{label}</span>
        <span className="tabular-nums text-text">{value.toFixed(2)}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-black/25">
        <div className={cn("h-full rounded-full bg-gradient-to-r transition-all", chroma)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function formatSource(source: string): string {
  return source.replace(/_/g, " ");
}

function shortUser(userId: string): string {
  if (userId.length <= 28) return userId;
  return `${userId.slice(0, 14)}…${userId.slice(-8)}`;
}

function sourceAccent(source: string): {
  border: string;
  ring: string;
  bar: string;
  badgeTone: "blue" | "purple" | "neutral";
} {
  if (source === "user_input") {
    return {
      border: "border-sky-500/35",
      ring: "ring-1 ring-sky-500/15",
      bar: "from-sky-400 to-cyan-500",
      badgeTone: "blue"
    };
  }
  if (source === "system_event") {
    return {
      border: "border-fuchsia-500/35",
      ring: "ring-1 ring-fuchsia-500/15",
      bar: "from-fuchsia-500 to-violet-600",
      badgeTone: "purple"
    };
  }
  return {
    border: "border-slate-500/35",
    ring: "ring-1 ring-slate-500/10",
    bar: "from-slate-400 to-slate-600",
    badgeTone: "neutral"
  };
}

function moodAccent(label: string): string {
  const key = label.toLowerCase();
  if (key.includes("joy") || key.includes("happy")) return "from-amber-400 via-orange-500 to-rose-500";
  if (key.includes("curious")) return "from-violet-500 via-fuchsia-500 to-purple-600";
  if (key.includes("calm") || key.includes("neutral")) return "from-slate-500 via-slate-600 to-zinc-700";
  if (key.includes("focus")) return "from-sky-500 to-blue-700";
  return "from-indigo-500 via-purple-600 to-pink-600";
}

function renderEmotionMetadata(metadata?: Record<string, unknown>): ReactNode | null {
  if (!metadata || Object.keys(metadata).length === 0) return null;
  const event = typeof metadata.event === "string" ? metadata.event : undefined;
  const source = typeof metadata.source === "string" ? metadata.source : undefined;
  const reason = typeof metadata.reason === "string" ? metadata.reason : undefined;
  const confidence = typeof metadata.confidence === "number" ? metadata.confidence : undefined;
  return (
    <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3 text-xs">
      <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-violet-200/80">Context</div>
      <div className="grid gap-1 text-muted">
        {event ? (
          <div>
            <span className="font-medium text-emerald-200/90">Event · </span>
            {event}
          </div>
        ) : null}
        {source ? (
          <div>
            <span className="font-medium text-sky-200/90">Source · </span>
            {source}
          </div>
        ) : null}
        {reason ? (
          <div>
            <span className="font-medium text-amber-200/90">Reason · </span>
            {reason}
          </div>
        ) : null}
        {confidence !== undefined ? (
          <div>
            <span className="font-medium text-fuchsia-200/90">Confidence · </span>
            {confidence.toFixed(2)}
          </div>
        ) : null}
      </div>
    </div>
  );
}
