"use client";

import { useEffect, useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { HealthPill } from "../../components/ui/health-pill";

type ThoughtItem = {
  id: string;
  category: "chat" | "learning" | "system";
  title: string;
  content: string;
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
    <div className="space-y-4">
      <Card className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="text-2xl font-semibold">Live Thoughts</h1>
          <p className="text-sm text-muted">Always-on feed of Nova's internal reasoning, including idle cycles.</p>
        </div>
        <div className="flex items-center gap-2">
          <HealthPill level={loading ? "orange" : "green"} />
          <Button type="button" tone="blue" onClick={() => void load()}>
            Refresh now
          </Button>
        </div>
      </Card>
      <Card className="grid gap-2 md:grid-cols-3">
        <article className="rounded-ui border bg-surface p-3 text-sm">Chat thoughts: {stats.chat}</article>
        <article className="rounded-ui border bg-surface p-3 text-sm">Learning thoughts: {stats.learning}</article>
        <article className="rounded-ui border bg-surface p-3 text-sm">System thoughts: {stats.system}</article>
      </Card>
      <Card className="space-y-2">
        <div className="max-h-[68vh] space-y-2 overflow-y-auto pr-1">
          {items.length === 0 ? <p className="text-sm text-muted">No thoughts yet.</p> : null}
          {items.map((item) => (
            <article key={item.id} className="rounded-ui border bg-surface p-3">
              <div className="mb-1 flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold uppercase text-muted">{item.category}</span>
                <span className="text-muted">{new Date(item.createdAt).toLocaleString()}</span>
              </div>
              <h3 className="text-sm font-semibold">{item.title}</h3>
              <p className="whitespace-pre-wrap text-sm text-muted">{item.content}</p>
            </article>
          ))}
        </div>
      </Card>
    </div>
  );
}

function dedupeById(items: ThoughtItem[]): ThoughtItem[] {
  const map = new Map<string, ThoughtItem>();
  for (const item of items) {
    map.set(item.id, item);
  }
  return Array.from(map.values()).sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
}
