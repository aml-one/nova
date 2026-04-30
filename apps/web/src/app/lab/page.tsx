"use client";

import { useEffect, useState } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";

type AnyRecord = Record<string, unknown>;

export default function LabPage() {
  const [benchmarks, setBenchmarks] = useState<AnyRecord[]>([]);
  const [abRuns, setAbRuns] = useState<AnyRecord[]>([]);
  const [policyRules, setPolicyRules] = useState<AnyRecord[]>([]);
  const [policyCmd, setPolicyCmd] = useState("rm -rf /tmp/demo");
  const [policyResult, setPolicyResult] = useState<AnyRecord | null>(null);
  const [incidents, setIncidents] = useState<AnyRecord[]>([]);
  const [workflowTraces, setWorkflowTraces] = useState<AnyRecord[]>([]);
  const [watchlist, setWatchlist] = useState<AnyRecord[]>([]);
  const [citations, setCitations] = useState<AnyRecord[]>([]);
  const [grades, setGrades] = useState<AnyRecord[]>([]);
  const [status, setStatus] = useState<string>("");

  async function loadAll(): Promise<void> {
    const [b, ab, pr, i, wt, wl, rc, cg] = await Promise.all([
      fetch("/api/lab/benchmark"),
      fetch("/api/lab/prompt-ab"),
      fetch("/api/lab/policy/rules"),
      fetch("/api/lab/incidents"),
      fetch("/api/lab/workflow-traces"),
      fetch("/api/lab/camera-watchlist"),
      fetch("/api/lab/rag-citations"),
      fetch("/api/lab/conversation-grade")
    ]);
    setBenchmarks((((await b.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
    setAbRuns((((await ab.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
    setPolicyRules((((await pr.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
    setIncidents((((await i.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 20));
    setWorkflowTraces((((await wt.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
    setWatchlist((((await wl.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
    setCitations((((await rc.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
    setGrades((((await cg.json()) as { items?: AnyRecord[] }).items ?? []).slice(0, 12));
  }

  useEffect(() => {
    void loadAll();
  }, []);

  return (
    <div className="space-y-4">
      <Card>
        <h1 className="text-2xl font-semibold">Lab Console</h1>
        <p className="text-sm text-muted">Benchmarking, A/B prompts, policy tests, incidents, traces, watchlists, grading, and citations.</p>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Model Benchmark + Prompt A/B</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" tone="green" onClick={async () => {
            const res = await fetch("/api/lab/benchmark", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suiteName: "default" }) });
            const data = await res.json();
            setStatus(`Benchmark winner: ${(data as { winner?: { provider?: string; model?: string } }).winner?.provider ?? "n/a"}`);
            await loadAll();
          }}>Run benchmark</Button>
          <Button type="button" tone="purple" onClick={async () => {
            await fetch("/api/lab/prompt-ab", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ suiteName: "persona-ab", promptA: "friendly concise", promptB: "formal detailed" }) });
            await loadAll();
          }}>Run prompt A/B</Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 text-xs">
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(benchmarks.slice(0, 6), null, 2)}</pre>
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(abRuns.slice(0, 6), null, 2)}</pre>
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Policy As Code</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" tone="blue" onClick={async () => {
            await fetch("/api/lab/policy/rules", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: "Block delete", pattern: "(rm\\s+-rf|del\\s+/f)", action: "deny", reasonTemplate: "Potentially destructive file operation" }) });
            await loadAll();
          }}>Add sample rule</Button>
          <Input value={policyCmd} onChange={(e) => setPolicyCmd(e.target.value)} placeholder="Command to test policy" className="max-w-[420px]" />
          <Button type="button" tone="yellow" onClick={async () => {
            const res = await fetch("/api/lab/policy/test", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ command: policyCmd }) });
            setPolicyResult(await res.json() as AnyRecord);
          }}>Test command</Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 text-xs">
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(policyRules, null, 2)}</pre>
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(policyResult, null, 2)}</pre>
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Incident Timeline + Workflow Debugger</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" tone="orange" onClick={async () => {
            await fetch("/api/lab/workflow-traces", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            await loadAll();
          }}>Generate workflow traces</Button>
          <Button type="button" tone="blue" onClick={() => void loadAll()}>Refresh</Button>
        </div>
        <div className="grid gap-2 md:grid-cols-2 text-xs">
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(incidents, null, 2)}</pre>
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(workflowTraces, null, 2)}</pre>
        </div>
      </Card>

      <Card className="space-y-2">
        <h2 className="text-lg font-semibold">Watchlists, Grader, Cost Anomaly, RAG Citations</h2>
        <div className="flex flex-wrap gap-2">
          <Button type="button" tone="pink" onClick={async () => {
            await fetch("/api/lab/camera-watchlist", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ label: "Red Car", color: "red", objectType: "car", escalationAction: "notify+approval" }) });
            await loadAll();
          }}>Add watchlist sample</Button>
          <Button type="button" tone="green" onClick={async () => {
            await fetch("/api/lab/conversation-grade", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            await loadAll();
          }}>Run nightly grader</Button>
          <Button type="button" tone="yellow" onClick={async () => {
            const res = await fetch("/api/lab/cost-anomaly", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
            const data = await res.json() as { anomalies?: unknown[]; throttled?: boolean };
            setStatus(`Cost anomalies: ${data.anomalies?.length ?? 0}, throttled: ${data.throttled === true ? "yes" : "no"}`);
          }}>Check cost anomalies</Button>
        </div>
        <div className="grid gap-2 md:grid-cols-3 text-xs">
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(watchlist, null, 2)}</pre>
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(grades, null, 2)}</pre>
          <pre className="rounded-ui border bg-surface p-2 overflow-x-auto">{JSON.stringify(citations, null, 2)}</pre>
        </div>
      </Card>

      {status ? <Card className="text-sm">{status}</Card> : null}
    </div>
  );
}
