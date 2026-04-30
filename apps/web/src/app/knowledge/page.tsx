"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";

type Node = { id: string; label: string; count: number };
type Edge = { source: string; target: string; weight: number };

export default function KnowledgePage() {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);

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

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Knowledge Graph</h1>
        <p className="text-sm text-muted">Entity relationship timeline extracted from long-term memory.</p>
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
