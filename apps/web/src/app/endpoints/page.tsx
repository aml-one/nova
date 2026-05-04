"use client";

import { useEffect, useMemo, useState } from "react";
import { cn } from "../../lib/cn";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { EndpointResultBody } from "./endpoint-result-view";
import { triggerBlobDownload } from "../../lib/audio-download";

type EndpointCategory =
  | "system"
  | "debug"
  | "observability"
  | "persona-memory"
  | "chat"
  | "integrations"
  | "voice";

type EndpointItem = {
  category: EndpointCategory;
  /** Short human title shown first (e.g. Health, Spoken audio). */
  title: string;
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  note: string;
};

const CATEGORY_META: Record<EndpointCategory, { label: string; sectionClass: string; badgeClass: string }> = {
  system: {
    label: "System",
    sectionClass:
      "border-emerald-300/50 bg-emerald-100/40 dark:border-emerald-500/35 dark:bg-emerald-950/45",
    badgeClass: "bg-emerald-200/70 text-emerald-950 dark:bg-emerald-800/60 dark:text-emerald-50"
  },
  debug: {
    label: "Debug",
    sectionClass:
      "border-violet-300/50 bg-violet-100/45 dark:border-violet-500/35 dark:bg-violet-950/45",
    badgeClass: "bg-violet-200/70 text-violet-950 dark:bg-violet-800/60 dark:text-violet-50"
  },
  observability: {
    label: "Observability",
    sectionClass: "border-sky-300/50 bg-sky-100/45 dark:border-sky-500/35 dark:bg-sky-950/45",
    badgeClass: "bg-sky-200/70 text-sky-950 dark:bg-sky-800/60 dark:text-sky-50"
  },
  "persona-memory": {
    label: "Persona & memory",
    sectionClass:
      "border-amber-300/55 bg-amber-100/45 dark:border-amber-500/35 dark:bg-amber-950/45",
    badgeClass: "bg-amber-200/75 text-amber-950 dark:bg-amber-800/55 dark:text-amber-50"
  },
  chat: {
    label: "Chat & providers",
    sectionClass: "border-rose-300/50 bg-rose-100/40 dark:border-rose-500/35 dark:bg-rose-950/45",
    badgeClass: "bg-rose-200/70 text-rose-950 dark:bg-rose-800/55 dark:text-rose-50"
  },
  integrations: {
    label: "Integrations",
    sectionClass:
      "border-cyan-300/50 bg-cyan-100/40 dark:border-cyan-500/35 dark:bg-cyan-950/45",
    badgeClass: "bg-cyan-200/70 text-cyan-950 dark:bg-cyan-800/55 dark:text-cyan-50"
  },
  voice: {
    label: "Voice & speech",
    sectionClass:
      "border-indigo-300/50 bg-indigo-100/45 dark:border-indigo-500/35 dark:bg-indigo-950/45",
    badgeClass: "bg-indigo-200/70 text-indigo-950 dark:bg-indigo-800/55 dark:text-indigo-50"
  }
};

const CATEGORY_ORDER: EndpointCategory[] = [
  "system",
  "debug",
  "observability",
  "persona-memory",
  "chat",
  "integrations",
  "voice"
];

const ENDPOINTS: EndpointItem[] = [
  { category: "system", title: "Health", method: "GET", path: "/api/system/health", note: "Overall system health checks." },
  {
    category: "debug",
    title: "Vision routing",
    method: "GET",
    path: "/api/debug/vision",
    note: "Vision routing snapshot (lanes, priority, flags) — no upstream calls."
  },
  {
    category: "debug",
    title: "Chat routing",
    method: "GET",
    path: "/api/debug/chat-routing",
    note: "Why run history may show Copilot while vision uses local; integration skips."
  },
  {
    category: "observability",
    title: "Thoughts feed",
    method: "GET",
    path: "/api/thoughts?limit=200",
    note: "Latest thought events."
  },
  {
    category: "observability",
    title: "Emotion timeline",
    method: "GET",
    path: "/api/emotion/history?limit=200",
    note: "Unified Nova mood timeline (all channels/users)."
  },
  {
    category: "observability",
    title: "Chat run history",
    method: "GET",
    path: "/api/chat/history?limit=100",
    note: "Recent chat run records."
  },
  {
    category: "observability",
    title: "Autonomy inspect",
    method: "GET",
    path: "/api/improvement/inspect?limit=200",
    note: "Autonomy / improvement loop diagnostics snapshot."
  },
  {
    category: "observability",
    title: "Learning history",
    method: "GET",
    path: "/api/improvement/history",
    note: "Learning history grouped by date."
  },
  {
    category: "observability",
    title: "Agent runtime log (debug)",
    method: "GET",
    path: "/api/debug/runtime-log?limit=200",
    note: "Tail of agent-core console capture since process start. Open the Debug page for a readable view."
  },
  {
    category: "persona-memory",
    title: "Persona file",
    method: "GET",
    path: "/api/persona/default",
    note: "Current base persona YAML."
  },
  {
    category: "persona-memory",
    title: "Persona versions",
    method: "GET",
    path: "/api/personas/versions?personaId=default&rewritesOnly=true",
    note: "Persona rewrite history only."
  },
  {
    category: "persona-memory",
    title: "Autonomous facts",
    method: "GET",
    path: "/api/memory/autonomous-facts?limit=200",
    note: "Long-term MemoryService facts; optional userId filters one profile."
  },
  {
    category: "chat",
    title: "Chat (buffered)",
    method: "POST",
    path: "/api/chat",
    note: "Non-streaming chat; triggers identity repair path on intro-style questions."
  },
  {
    category: "chat",
    title: "Chat (stream)",
    method: "POST",
    path: "/api/chat/stream",
    note: "SSE: events start, activity (e.g. web-search), token, done, error."
  },
  {
    category: "chat",
    title: "Provider catalog",
    method: "GET",
    path: "/api/providers/catalog",
    note: "Models and setup status per provider."
  },
  {
    category: "integrations",
    title: "Skills manifests",
    method: "GET",
    path: "/api/skills/manifests",
    note: "Loaded workspace skill manifests."
  },
  {
    category: "integrations",
    title: "Camera test",
    method: "POST",
    path: "/api/camera/test",
    note: "Probe one configured camera."
  },
  {
    category: "voice",
    title: "Spoken audio (TTS)",
    method: "POST",
    path: "/api/voice/speak-audio",
    note: 'Binary reply: JSON body `{ "text": "…" }` → WAV/MP3/… per Settings → Voice. Same pipeline as chat read-aloud.'
  },
  {
    category: "voice",
    title: "TTS pipeline trace",
    method: "POST",
    path: "/api/voice/tts-trace",
    note: 'JSON `{ "text": "…" }` → request → preparedForSpeech → sentToOrpheus + mood; no Orpheus HTTP call.'
  },
  {
    category: "voice",
    title: "Recent TTS / read-aloud log",
    method: "GET",
    path: "/api/voice/tts-recent?limit=20",
    note:
      "Last runs from real chat read-aloud and POST speak-audio (newest first): requestText, preparedForSpeech, sentToOrpheus — compare strings when debugging repeats or glitches. In-memory on agent-core process; optional ?limit=1–50."
  }
];

/** When picking an endpoint from the list, pre-fill the POST body for common routes (easy copy/run). */
const POST_BODY_PRESETS: Partial<Record<string, string>> = {
  "/api/voice/speak-audio": '{\n  "text": "Hello from Nova."\n}',
  "/api/voice/tts-trace": '{\n  "text": "Hello from Nova."\n}',
  "/api/chat": '{\n  "message": "hello"\n}',
  "/api/chat/stream": '{\n  "message": "hello"\n}'
};

export default function EndpointsPage() {
  const [path, setPath] = useState(ENDPOINTS[0].path);
  const [method, setMethod] = useState<EndpointItem["method"]>(ENDPOINTS[0].method);
  const [body, setBody] = useState('{\n  "message": "hello"\n}');
  const [loading, setLoading] = useState(false);
  const [resultHeader, setResultHeader] = useState("");
  const [resultParsed, setResultParsed] = useState<unknown | null | undefined>(undefined);
  const [resultPretty, setResultPretty] = useState("");
  const [resultError, setResultError] = useState<string | null>(null);
  const [audioResult, setAudioResult] = useState<{ url: string; blob: Blob; mime: string } | null>(null);
  const selected = useMemo(() => ENDPOINTS.find((item) => item.path === path && item.method === method), [method, path]);

  const endpointsByCategory = useMemo(() => {
    const map = new Map<EndpointCategory, EndpointItem[]>();
    for (const cat of CATEGORY_ORDER) map.set(cat, []);
    for (const item of ENDPOINTS) {
      map.get(item.category)?.push(item);
    }
    return map;
  }, []);

  useEffect(() => {
    return () => {
      if (audioResult?.url) URL.revokeObjectURL(audioResult.url);
    };
  }, [audioResult?.url]);

  async function runRequest(): Promise<void> {
    setLoading(true);
    setResultError(null);
    setAudioResult((prev) => {
      if (prev?.url) URL.revokeObjectURL(prev.url);
      return null;
    });
    const startedAt = Date.now();
    try {
      const init: RequestInit = { method, headers: {} };
      if (method !== "GET") {
        (init.headers as Record<string, string>)["content-type"] = "application/json";
        init.body = body.trim() ? body : "{}";
      }
      const response = await fetch(path, init);
      const elapsed = Date.now() - startedAt;
      const header = `[${response.status}] ${method} ${path} (${elapsed}ms)`;
      const ct = response.headers.get("content-type") ?? "";

      if (ct.startsWith("audio/")) {
        const blob = await response.blob();
        const url = URL.createObjectURL(blob);
        setAudioResult({ url, blob, mime: ct });
        setResultHeader(header);
        setResultParsed(undefined);
        setResultPretty("");
        return;
      }

      const text = await response.text();
      let pretty = text;
      try {
        const parsed = JSON.parse(text) as unknown;
        pretty = JSON.stringify(parsed, null, 2);
        setResultParsed(parsed);
      } catch {
        setResultParsed(null);
      }
      setResultHeader(header);
      setResultPretty(pretty);
    } catch (error) {
      setResultHeader("");
      setResultParsed(undefined);
      setResultPretty("");
      setResultError(error instanceof Error ? error.message : "Unknown error");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="space-y-4">
      <Card className="space-y-2">
        <h1 className="text-2xl font-semibold">Endpoints</h1>
        <p className="text-sm text-muted">
          Browse HTTP routes exposed by this web app (mostly proxies to agent-core). Items are grouped by category with pastel bands.
          Under <strong className="text-foreground">Voice & speech</strong>, <strong className="text-foreground">Spoken audio (TTS)</strong> matches chat read-aloud;{" "}
          <strong className="text-foreground">Recent TTS / read-aloud log</strong> shows what was actually synthesized (last N), for debugging Orpheus repeats.
        </p>
      </Card>
      <div className="grid gap-4 lg:grid-cols-[710px_minmax(0,1fr)]">
        <Card className="space-y-3">
          <h2 className="text-sm font-semibold">Available endpoints</h2>
          <div className="max-h-[62vh] space-y-3 overflow-auto pr-1">
            {CATEGORY_ORDER.map((categoryId) => {
              const items = endpointsByCategory.get(categoryId) ?? [];
              if (!items.length) return null;
              const meta = CATEGORY_META[categoryId];
              return (
                <section key={categoryId} className={cn("rounded-xl border p-2.5", meta.sectionClass)}>
                  <div className="mb-2 flex items-center gap-2">
                    <span className={cn("rounded-md px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide", meta.badgeClass)}>
                      {meta.label}
                    </span>
                  </div>
                  <div className="space-y-1.5">
                    {items.map((item) => {
                      const active = item.path === path && item.method === method;
                      return (
                        <button
                          key={`${item.method}-${item.path}`}
                          type="button"
                          className={cn(
                            "w-full rounded-lg border px-2.5 py-2 text-left transition-colors",
                            active
                              ? "border-blue-500/70 bg-blue-500/15 ring-2 ring-blue-400/35 dark:border-blue-400/60 dark:bg-blue-500/20"
                              : "border-black/10 bg-white/40 hover:bg-white/70 dark:border-white/10 dark:bg-black/15 dark:hover:bg-black/25"
                          )}
                          onClick={() => {
                            setPath(item.path);
                            setMethod(item.method);
                            const preset = POST_BODY_PRESETS[item.path];
                            if (item.method !== "GET" && preset) setBody(preset);
                          }}
                        >
                          <div className="text-sm font-semibold leading-snug text-foreground">{item.title}</div>
                          <div className="mt-0.5 font-mono text-[11px] text-foreground/85">
                            {item.method} {item.path}
                          </div>
                          <div className="mt-1 text-[11px] leading-relaxed text-muted">{item.note}</div>
                        </button>
                      );
                    })}
                  </div>
                </section>
              );
            })}
          </div>
        </Card>
        <Card className="min-w-0 space-y-2">
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
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" tone="blue" onClick={() => void runRequest()} disabled={loading}>
                {loading ? "Running..." : "Run request"}
              </Button>
              {selected ? (
                <span className="text-xs text-muted">
                  <span className="font-semibold text-foreground">{selected.title}</span>
                  {" — "}
                  {selected.note}
                </span>
              ) : null}
            </div>
          </div>
          <div className="rounded-ui border bg-surface2 p-2">
            <div className="mb-1 text-xs font-semibold">Result</div>
            {resultError ? (
              <div className="rounded-lg border border-rose-400/30 bg-rose-500/10 px-2 py-2 text-xs text-rose-100">{resultError}</div>
            ) : audioResult ? (
              <div className="space-y-2">
                <div className="text-xs font-semibold text-foreground/90">{resultHeader}</div>
                <p className="text-[11px] text-muted">
                  Binary audio ({audioResult.mime}), {audioResult.blob.size.toLocaleString()} bytes — same format as chat read-aloud.
                </p>
                <audio controls src={audioResult.url} className="w-full max-w-md rounded-lg border border-border bg-black/20 p-1" />
                <Button
                  type="button"
                  tone="purple"
                  className="text-xs"
                  onClick={() =>
                    triggerBlobDownload(audioResult.blob, audioResult.mime, `nova-endpoint-tts-${Date.now().toString(36)}`)
                  }
                >
                  Download audio file
                </Button>
              </div>
            ) : resultHeader ? (
              <div className="max-h-[52vh] overflow-auto pr-0.5">
                {resultParsed !== undefined ? (
                  <EndpointResultBody header={resultHeader} parsed={resultParsed} rawPretty={resultPretty} />
                ) : (
                  <div className="text-xs text-muted">Empty or non-JSON body.</div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted">No response yet.</p>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
