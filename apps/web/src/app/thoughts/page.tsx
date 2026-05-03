"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { HealthPill } from "../../components/ui/health-pill";
import { Badge } from "../../components/ui/badge";
import { ThoughtMetadataDetails } from "../../components/thought-metadata";
import { cn } from "../../lib/cn";

type ThoughtItem = {
  id: string;
  category: "chat" | "learning" | "system";
  title: string;
  content: string;
  metadata?: unknown;
  createdAt: string;
};

export default function ThoughtsPage() {
  const [items, setItems] = useState<ThoughtItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void load();
    const wsUrl = `${window.location.protocol === "https:" ? "wss" : "ws"}://${window.location.host.replace("3000", "8787")}/v1/thoughts/ws`;
    const ws = new WebSocket(wsUrl);
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data) as { type?: string; items?: ThoughtItem[] };
        if (!payload.items) return;
        if (payload.type === "snapshot") {
          setItems(payload.items.slice().reverse());
          setLoading(false);
          return;
        }
        if (payload.type === "thoughts") {
          setItems((prev) => dedupeById([...payload.items!, ...prev]).slice(0, 500));
        }
      } catch {
        // ignore malformed websocket payload
      }
    };
    const timer = setInterval(() => void load(), 6000);
    return () => {
      clearInterval(timer);
      ws.close();
    };
  }, []);

  async function load(): Promise<void> {
    const response = await fetch("/api/thoughts?limit=500");
    const data = (await response.json()) as { items?: ThoughtItem[] };
    if (response.ok) {
      setItems(data.items ?? []);
    }
    setLoading(false);
  }

  const stats = useMemo(() => {
    const chat = items.filter((item) => item.category === "chat").length;
    const learning = items.filter((item) => item.category === "learning").length;
    const system = items.filter((item) => item.category === "system").length;
    return { chat, learning, system };
  }, [items]);

  return (
    <div className="space-y-5">
      <Card className="flex flex-wrap items-center justify-between gap-3 border-indigo-500/25 bg-gradient-to-br from-indigo-950/35 via-surface to-purple-950/25 p-5 shadow-lg shadow-indigo-900/15">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Live thoughts</h1>
          <p className="mt-1 max-w-xl text-sm text-muted">Internal narration — chat traces, idle learning, and system pulses.</p>
        </div>
        <div className="flex items-center gap-2">
          <HealthPill level={loading ? "orange" : "green"} label={loading ? "Syncing" : "Live"} />
          <Button type="button" tone="blue" onClick={() => void load()}>
            Refresh now
          </Button>
        </div>
      </Card>
      <div className="grid gap-3 md:grid-cols-3">
        <article className="rounded-2xl border border-sky-500/30 bg-gradient-to-br from-sky-950/50 to-surface p-4 shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-sky-200/90">Chat</div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-text">{stats.chat}</div>
          <p className="mt-1 text-xs text-muted">Turn-linked reasoning</p>
        </article>
        <article className="rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-950/45 to-surface p-4 shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-purple-200/90">Learning</div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-text">{stats.learning}</div>
          <p className="mt-1 text-xs text-muted">Idle cycles & proposals</p>
        </article>
        <article className="rounded-2xl border border-slate-500/30 bg-gradient-to-br from-slate-900/60 to-surface p-4 shadow-md">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-slate-200/90">System</div>
          <div className="mt-1 text-3xl font-bold tabular-nums text-text">{stats.system}</div>
          <p className="mt-1 text-xs text-muted">Daemon & bridges</p>
        </article>
      </div>
      <Card className="border-white/10 bg-surface/80 p-3 backdrop-blur-sm">
        <div className="max-h-[68vh] space-y-3 overflow-y-auto pr-1">
          {items.length === 0 ? <p className="text-sm text-muted">No thoughts yet.</p> : null}
          {items.map((item) => (
            <article
              key={item.id}
              className={cn(
                "overflow-hidden rounded-2xl border bg-gradient-to-br to-surface p-4 shadow-md transition hover:brightness-[1.03]",
                item.category === "chat" && "border-sky-500/35 from-sky-950/30 ring-1 ring-sky-500/10",
                item.category === "learning" && "border-purple-500/35 from-purple-950/30 ring-1 ring-purple-500/10",
                item.category === "system" && "border-slate-500/35 from-slate-900/40 ring-1 ring-slate-500/10"
              )}
            >
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
                <CategoryBadge category={item.category} />
                <time className="tabular-nums text-muted" dateTime={item.createdAt}>
                  {new Date(item.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short"
                  })}
                </time>
              </div>
              <h3 className="text-[15px] font-semibold leading-snug text-text">{item.title}</h3>
              <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-muted">{item.content}</p>
              {hasThoughtMetadata(item.metadata) ? <ThoughtMetadataDetails metadata={item.metadata} /> : null}
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

function hasThoughtMetadata(metadata: unknown): boolean {
  if (metadata === undefined || metadata === null) return false;
  if (typeof metadata === "object" && !Array.isArray(metadata) && Object.keys(metadata as object).length === 0) return false;
  return true;
}

function dedupeById(items: ThoughtItem[]): ThoughtItem[] {
  const map = new Map<string, ThoughtItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}

function CategoryBadge({ category }: { category: ThoughtItem["category"] }) {
  const tone = category === "chat" ? "blue" : category === "learning" ? "purple" : "neutral";
  const label = category === "chat" ? "Chat" : category === "learning" ? "Learning" : "System";
  return <Badge tone={tone}>{label}</Badge>;
}
