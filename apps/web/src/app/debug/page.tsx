"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";

type LogLine = string;

export default function DebugPage() {
  const [agentLines, setAgentLines] = useState<LogLine[]>([]);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [clientLines, setClientLines] = useState<LogLine[]>([]);
  const origRef = useRef<{ log: typeof console.log; warn: typeof console.warn; error: typeof console.error } | null>(null);

  const pullAgent = useCallback(async () => {
    setAgentError(null);
    try {
      const response = await fetch("/api/debug/runtime-log?limit=250", { credentials: "include" });
      const data = (await response.json()) as { lines?: string[]; error?: string };
      if (!response.ok) {
        setAgentError(data.error ?? `HTTP ${response.status}`);
        return;
      }
      setAgentLines(data.lines ?? []);
    } catch (e) {
      setAgentError(e instanceof Error ? e.message : "fetch failed");
    }
  }, []);

  useEffect(() => {
    void pullAgent();
    const id = setInterval(() => void pullAgent(), 8000);
    return () => clearInterval(id);
  }, [pullAgent]);

  useEffect(() => {
    const max = 400;
    const push = (prefix: string, args: unknown[]) => {
      const parts = args.map((a) => {
        if (typeof a === "string") return a;
        try {
          return JSON.stringify(a);
        } catch {
          return String(a);
        }
      });
      const line = `${prefix} ${parts.join(" ")}`;
      setClientLines((prev) => [...prev, line].slice(-max));
    };
    const olog = console.log.bind(console);
    const owarn = console.warn.bind(console);
    const oerr = console.error.bind(console);
    origRef.current = { log: olog, warn: owarn, error: oerr };
    console.log = (...a: unknown[]) => {
      push("[log]", a);
      olog(...a);
    };
    console.warn = (...a: unknown[]) => {
      push("[warn]", a);
      owarn(...a);
    };
    console.error = (...a: unknown[]) => {
      push("[error]", a);
      oerr(...a);
    };
    const onErr = (event: ErrorEvent) => {
      push("[window.error]", [event.message, event.filename, event.lineno]);
    };
    const onRej = (event: PromiseRejectionEvent) => {
      push("[unhandledrejection]", [String(event.reason)]);
    };
    window.addEventListener("error", onErr);
    window.addEventListener("unhandledrejection", onRej);
    return () => {
      window.removeEventListener("error", onErr);
      window.removeEventListener("unhandledrejection", onRej);
      const o = origRef.current;
      if (o) {
        console.log = o.log;
        console.warn = o.warn;
        console.error = o.error;
      }
    };
  }, []);

  const mergedPreview = useMemo(() => {
    return [
      "— Agent-core (this tab also mirrors console below) —",
      ...agentLines.slice(-120),
      "",
      "— This browser tab (console.* + window errors) —",
      ...clientLines.slice(-120)
    ].join("\n");
  }, [agentLines, clientLines]);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Debug</h1>
        <p className="text-sm text-muted">
          Agent-core stdout captured on the machine running <code className="text-[11px]">agent-core</code> (last ~500 lines, since process start). This page also records{" "}
          <code className="text-[11px]">console.log/warn/error</code> and window errors from <strong>this</strong> browser tab only — not a full substitute for the terminal, but you can leave it open instead of watching the server console.
        </p>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button type="button" tone="blue" onClick={() => void pullAgent()}>
            Refresh agent log
          </Button>
          <Button type="button" tone="neutral" onClick={() => setClientLines([])}>
            Clear tab console buffer
          </Button>
        </div>
        {agentError ? <p className="mt-2 text-xs text-rose-400">{agentError}</p> : null}
      </Card>
      <Card>
        <h2 className="mb-2 text-lg font-semibold">Live tail (preview)</h2>
        <pre className="max-h-[min(70vh,520px)] overflow-auto rounded-ui border bg-surface2 p-3 font-mono text-[11px] leading-relaxed text-text">
          {mergedPreview || "—"}
        </pre>
      </Card>
    </div>
  );
}
