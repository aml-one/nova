"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { NOVA_UNIFIED_MOOD_USER_ID } from "../../lib/emotion-user";

type Node = { id: string; label: string; count: number };
type Edge = { source: string; target: string; weight: number };

type AutonomousFact = {
  id: number;
  userId: string;
  kind: string;
  content: string;
  createdAt: string;
};

export default function KnowledgePage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [facts, setFacts] = useState<AutonomousFact[]>([]);
  const [factsScope, setFactsScope] = useState<"unified" | "all">("unified");
  const [factsRefreshNonce, setFactsRefreshNonce] = useState(0);
  const [factsLoading, setFactsLoading] = useState(false);

  useEffect(() => {
    void (async () => {
      const response = await fetch("/api/knowledge/graph");
      const data = (await response.json()) as { nodes?: Node[]; edges?: Edge[] };
      if (response.ok) {
        setNodes(data.nodes ?? []);
        setEdges(data.edges ?? []);
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      setFactsLoading(true);
      try {
        const qs =
          factsScope === "unified"
            ? `?userId=${encodeURIComponent(NOVA_UNIFIED_MOOD_USER_ID)}&limit=200`
            : "?limit=200";
        const response = await fetch(`/api/memory/autonomous-facts${qs}`);
        const data = (await response.json()) as { items?: AutonomousFact[] };
        if (cancelled) return;
        if (response.ok) {
          setFacts(data.items ?? []);
        } else {
          setFacts([]);
        }
      } finally {
        if (!cancelled) {
          setFactsLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [factsScope, factsRefreshNonce]);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Knowledge Graph</h1>
        <p className="text-sm text-muted">Entity relationship timeline extracted from long-term memory.</p>
        <p className="text-xs text-muted">
          Use this to see what Nova remembers most often. Top Nodes are key entities; Top Edges show how often entities are linked together.
        </p>
      </Card>
      <Card className="space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h2 className="text-lg font-semibold">Autonomous facts (MemoryService)</h2>
            <p className="text-xs text-muted">
              Entries Nova extracts from chat over time (same <code className="text-[11px]">long_term_memory</code> store used in prompts). Curated pins live on the{" "}
              <a className="underline" href="/memory">
                Memory
              </a>{" "}
              page.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="radio"
                name="facts-scope"
                checked={factsScope === "unified"}
                onChange={() => setFactsScope("unified")}
              />
              Unified web user
            </label>
            <label className="flex items-center gap-1.5 text-xs">
              <input type="radio" name="facts-scope" checked={factsScope === "all"} onChange={() => setFactsScope("all")} />
              All users
            </label>
            <Button
              type="button"
              tone="blue"
              onClick={() => setFactsRefreshNonce((n) => n + 1)}
              disabled={factsLoading}
            >
              {factsLoading ? "Loading…" : "Refresh"}
            </Button>
          </div>
        </div>
        <div className="max-h-[min(480px,55vh)] space-y-2 overflow-y-auto rounded-ui border bg-surface p-2">
          {facts.length === 0 && !factsLoading ? (
            <p className="text-xs text-muted">No autonomous facts yet — they appear as Nova learns from conversations.</p>
          ) : null}
          {facts.map((item) => (
            <article key={`${item.id}-${item.createdAt}`} className="rounded-ui border border-border/80 bg-surface2/80 p-2 text-xs">
              <div className="mb-1 flex flex-wrap items-center justify-between gap-1 text-[11px] text-muted">
                <span>
                  <span className="font-semibold text-text">{item.kind}</span>
                  {factsScope === "all" ? (
                    <>
                      {" "}
                      · user <code className="rounded bg-surface px-0.5">{item.userId || "—"}</code>
                    </>
                  ) : null}
                </span>
                <time dateTime={item.createdAt}>{item.createdAt ? new Date(item.createdAt).toLocaleString() : "—"}</time>
              </div>
              <p className="whitespace-pre-wrap leading-relaxed text-text">{item.content}</p>
            </article>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Top Nodes</h2>
        <div className="grid gap-2 md:grid-cols-3">
          {nodes.slice(0, 60).map((node) => (
            <article key={node.id} className="rounded-ui border bg-surface p-2 text-xs">
              <strong>{node.label}</strong> · {node.count}
            </article>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Top Edges</h2>
        <div className="space-y-1 text-xs">
          {edges.slice(0, 80).map((edge, idx) => (
            <div key={`${edge.source}-${edge.target}-${idx}`} className="rounded-ui border bg-surface p-2">
              {edge.source} → {edge.target} ({edge.weight})
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
