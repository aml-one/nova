"use client";

import { useMemo, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type EndpointItem = {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  note: string;
};

const ENDPOINTS: EndpointItem[] = [
  { method: "GET", path: "/api/system/health", note: "Overall system health checks." },
  {
    method: "GET",
    path: "/api/debug/vision",
    note: "Vision routing snapshot (lanes, priority, configured flags) — no upstream calls."
  },
  {
    method: "GET",
    path: "/api/debug/chat-routing",
    note: "Vision + chat routing: why run history may show Copilot while vision uses local; integration skips."
  },
  { method: "GET", path: "/api/thoughts?limit=200", note: "Latest thought events." },
  { method: "GET", path: "/api/emotion/history?limit=200", note: "Emotion timeline history." },
  { method: "GET", path: "/api/improvement/inspect?limit=200", note: "Autonomy/loop diagnostics snapshot." },
  { method: "GET", path: "/api/improvement/history", note: "Learning history grouped by date." },
  { method: "GET", path: "/api/persona/default", note: "Current base persona file." },
  { method: "GET", path: "/api/personas/versions?personaId=default&rewritesOnly=true", note: "Persona rewrite history only." },
  { method: "GET", path: "/api/chat/history?limit=100", note: "Recent chat run records." },
  { method: "POST", path: "/api/chat", note: "Non-streaming chat request." },
  {
    method: "POST",
    path: "/api/chat/stream",
    note: "Streaming chat (SSE): events start, activity (e.g. web-search), token, done, error."
  },
  { method: "GET", path: "/api/providers/catalog", note: "Provider models and setup status." },
  { method: "GET", path: "/api/skills/manifests", note: "Loaded skill manifests." },
  { method: "POST", path: "/api/camera/test", note: "Test one configured camera." }
];

export default function EndpointsPage() {
  const [path, setPath] = useState(ENDPOINTS[0].path);
  const [method, setMethod] = useState<EndpointItem["method"]>(ENDPOINTS[0].method);
  const [body, setBody] = useState('{\n  "message": "hello"\n}');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState("");
  const selected = useMemo(() => ENDPOINTS.find((item) => item.path === path && item.method === method), [method, path]);

  async function runRequest(): Promise<void> {
    setLoading(true);
    const startedAt = Date.now();
    try {
      const init: RequestInit = { method, headers: {} };
      if (method !== "GET") {
        (init.headers as Record<string, string>)["content-type"] = "application/json";
        init.body = body.trim() ? body : "{}";
      }
      const response = await fetch(path, init);
      const text = await response.text();
      const elapsed = Date.now() - startedAt;
      let pretty = text;
      try {
        pretty = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // keep raw text
      }
      setResult(`[${response.status}] ${method} ${path} (${elapsed}ms)\n\n${pretty}`);
    } catch (error) {
      setResult(`Request failed: ${error instanceof Error ? error.message : "Unknown error"}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold">Endpoints</h1>
        <p className="text-sm text-muted">Browse available debug endpoints and run them directly from the web UI.</p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[1.2fr_1fr]">
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Available endpoints</h2>
          <div className="max-h-[62vh] space-y-1 overflow-auto pr-1">
            {ENDPOINTS.map((item) => {
              const active = item.path === path && item.method === method;
              return (
                <button
                  key={`${item.method}-${item.path}`}
                  type="button"
                  className={`w-full rounded-ui border px-2 py-2 text-left text-xs ${
                    active ? "border-blue-500/60 bg-blue-500/10" : "bg-surface hover:bg-surface2"
                  }`}
                  onClick={() => {
                    setPath(item.path);
                    setMethod(item.method);
                  }}
                >
                  <div className="font-semibold">{item.method} {item.path}</div>
                  <div className="text-muted">{item.note}</div>
                </button>
              );
            })}
          </div>
        </Card>
        <Card className="space-y-2">
          <h2 className="text-sm font-semibold">Endpoint viewer</h2>
          <div className="grid gap-2">
            <label className="grid gap-1 text-xs">
              Method
              <select
                value={method}
                onChange={(e) => setMethod(e.target.value as EndpointItem["method"])}
                className="h-9 rounded-ui border bg-surface px-2 text-sm"
              >
                <option>GET</option>
                <option>POST</option>
                <option>PUT</option>
                <option>DELETE</option>
              </select>
            </label>
            <label className="grid gap-1 text-xs">
              Path
              <Input value={path} onChange={(e) => setPath(e.target.value)} />
            </label>
            {method !== "GET" ? (
              <label className="grid gap-1 text-xs">
                JSON body
                <textarea
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={8}
                  className="w-full rounded-ui border bg-surface px-2 py-1.5 font-mono text-xs"
                />
              </label>
            ) : null}
            <div className="flex items-center gap-2">
              <Button type="button" tone="blue" onClick={() => void runRequest()} disabled={loading}>
                {loading ? "Running..." : "Run request"}
              </Button>
              {selected ? <span className="text-xs text-muted">{selected.note}</span> : null}
            </div>
          </div>
          <div className="rounded-ui border bg-surface2 p-2">
            <div className="mb-1 text-xs font-semibold">Result</div>
            <pre className="max-h-[46vh] overflow-auto whitespace-pre-wrap text-xs">{result || "No response yet."}</pre>
          </div>
        </Card>
      </div>
    </div>
  );
}
