"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";

type Branch = { id: string; label: string; created_at: string };
type ReplayMessage = { id: string; role: string; content: string; created_at: string };

export default function ReplayPage() {
  const [branches, setBranches] = useState<Branch[]>([]);
  const [branchId, setBranchId] = useState("");
  const [messages, setMessages] = useState<ReplayMessage[]>([]);
  const [prompt, setPrompt] = useState("");
  const [fromRunId, setFromRunId] = useState("");

  async function loadBranches(): Promise<void> {
    const response = await fetch("/api/chat/replay");
    const data = (await response.json()) as { branches?: Branch[] };
    if (response.ok) setBranches(data.branches ?? []);
  }

  async function loadMessages(targetBranchId: string): Promise<void> {
    const response = await fetch(`/api/chat/replay?branchId=${encodeURIComponent(targetBranchId)}`);
    const data = (await response.json()) as { messages?: ReplayMessage[] };
    if (response.ok) setMessages(data.messages ?? []);
  }

  useEffect(() => {
    void loadBranches();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Time Travel Replay</h1>
        <p className="text-sm text-muted">Fork from any past run and branch the conversation.</p>
      </Card>
      <Card className="space-y-2">
        <Input value={fromRunId} onChange={(e) => setFromRunId(e.target.value)} placeholder="Source run_id for fork" />
        <Button
          type="button"
          tone="green"
          onClick={async () => {
            const response = await fetch("/api/chat/replay/fork", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ fromRunId, label: `fork-${new Date().toISOString()}` })
            });
            const data = (await response.json()) as { branchId?: string };
            if (response.ok && data.branchId) {
              setBranchId(data.branchId);
              await loadBranches();
              await loadMessages(data.branchId);
            }
          }}
        >
          Fork Branch
        </Button>
      </Card>
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Branches</h2>
        <div className="grid gap-2 md:grid-cols-2">
          {branches.map((branch) => (
            <button
              key={branch.id}
              type="button"
              className="rounded-ui border bg-surface p-2 text-left text-sm"
              onClick={() => {
                setBranchId(branch.id);
                void loadMessages(branch.id);
              }}
            >
              <strong>{branch.label}</strong>
              <div className="text-xs text-muted">{branch.id}</div>
            </button>
          ))}
        </div>
      </Card>
      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Branch Messages</h2>
        {messages.map((msg) => (
          <article key={msg.id} className="rounded-ui border bg-surface p-2 text-sm">
            <strong>{msg.role}</strong>: {msg.content}
          </article>
        ))}
        {branchId ? (
          <div className="space-y-2">
            <Textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={3} placeholder="Continue this branch..." />
            <Button
              type="button"
              tone="blue"
              onClick={async () => {
                if (!prompt.trim()) return;
                await fetch("/api/chat/replay/message", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({ branchId, message: prompt })
                });
                setPrompt("");
                await loadMessages(branchId);
              }}
            >
              Send in Branch
            </Button>
          </div>
        ) : null}
      </Card>
    </div>
  );
}
