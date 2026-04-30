"use client";

import { FormEvent, useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Button } from "../../components/ui/button";

type MemoryCard = {
  id: string;
  userId: string;
  title: string;
  content: string;
  pinned: boolean;
  updatedAt: string;
};

export default function MemoryPage() {
  const [items, setItems] = useState<MemoryCard[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  async function load(): Promise<void> {
    const response = await fetch("/api/memory/cards");
    const data = (await response.json()) as { items?: MemoryCard[] };
    if (response.ok) setItems(data.items ?? []);
  }

  useEffect(() => {
    void load();
  }, []);

  async function addCard(event: FormEvent): Promise<void> {
    event.preventDefault();
    if (!title.trim() || !content.trim()) return;
    await fetch("/api/memory/cards", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title, content, pinned: true })
    });
    setTitle("");
    setContent("");
    await load();
  }

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="mb-2 text-2xl font-semibold">Memory Cards</h1>
        <p className="text-sm text-muted">Pin durable facts Nova should keep in long-term context.</p>
      </Card>
      <Card>
        <form onSubmit={addCard} className="space-y-2">
          <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Card title" />
          <Textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} placeholder="Important fact or instruction..." />
          <Button type="submit" tone="green">Add Card</Button>
        </form>
      </Card>
      <Card className="space-y-2">
        {items.map((item) => (
          <article key={item.id} className="rounded-ui border bg-surface p-3">
            <div className="mb-1 flex items-center justify-between">
              <strong>{item.title}</strong>
              <Button
                type="button"
                tone="red"
                onClick={async () => {
                  await fetch("/api/memory/cards", {
                    method: "DELETE",
                    headers: { "content-type": "application/json" },
                    body: JSON.stringify({ id: item.id })
                  });
                  await load();
                }}
              >
                Delete
              </Button>
            </div>
            <p className="whitespace-pre-wrap text-sm">{item.content}</p>
            <p className="text-xs text-muted">Updated {new Date(item.updatedAt).toLocaleString()}</p>
          </article>
        ))}
      </Card>
    </div>
  );
}
