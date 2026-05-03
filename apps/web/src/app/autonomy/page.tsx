"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa6";
import { Button } from "../../components/ui/button";
import { Card } from "../../components/ui/card";
import { cn } from "../../lib/cn";

type InspectPayload = Record<string, unknown>;

export default function AutonomyPage() {
  const [loading, setLoading] = useState(false);
  const [limit, setLimit] = useState(300);
  const [payload, setPayload] = useState<InspectPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [jsonOpen, setJsonOpen] = useState(false);

  const formatted = useMemo(() => JSON.stringify(payload ?? {}, null, 2), [payload]);

  async function load(): Promise<void> {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const response = await fetch(`/api/improvement/inspect?limit=${encodeURIComponent(String(limit))}`);
      const data = (await response.json()) as InspectPayload & { error?: string };
      if (!response.ok) {
        setError(String(data.error ?? "Failed to load autonomy snapshot"));
        setPayload(null);
      } else {
        setPayload(data);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed");
      setPayload(null);
    } finally {
      setLoading(false);
    }
  }

  async function copyJson(): Promise<void> {
    if (!payload) return;
    try {
      await navigator.clipboard.writeText(formatted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {
      setCopied(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card className="space-y-3 border-teal-500/20 bg-gradient-to-br from-teal-950/30 via-surface to-slate-900/40 p-5">
        <h1 className="text-2xl font-semibold tracking-tight">Autonomy health</h1>
        <p className="max-w-2xl text-sm text-muted">
          Snapshot of learning, thoughts, emotions, and loop diagnostics. Scan the summary first; expand raw JSON only when debugging.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-xs text-muted">Rows</label>
          <input
            type="number"
            min={20}
            max={1000}
            value={limit}
            onChange={(e) => setLimit(Number(e.target.value || 300))}
            className="h-8 w-24 rounded-ui border bg-surface px-2 text-sm"
          />
          <Button type="button" tone="blue" onClick={() => void load()} disabled={loading}>
            {loading ? "Loading..." : "Refresh snapshot"}
          </Button>
          <Button type="button" tone="purple" onClick={() => void copyJson()} disabled={!payload}>
            {copied ? "Copied" : "Copy JSON"}
          </Button>
        </div>
      </Card>

      {error ? <Card className="border-rose-500/40 bg-rose-950/20 p-4 text-sm text-rose-200">{error}</Card> : null}

      {payload ? <AutonomySummary payload={payload} /> : null}

      <Card className="overflow-hidden border-white/10">
        <button
          type="button"
          onClick={() => setJsonOpen((o) => !o)}
          className="flex w-full items-center gap-2 border-b border-border bg-black/20 px-4 py-3 text-left text-sm font-semibold hover:bg-black/30"
        >
          <span className="text-muted">{jsonOpen ? <FaChevronDown className="h-3.5 w-3.5" /> : <FaChevronRight className="h-3.5 w-3.5" />}</span>
          Raw JSON {!payload ? "(load snapshot first)" : ""}
        </button>
        {jsonOpen && payload ? (
          <pre className="max-h-[62vh] overflow-auto bg-surface2 p-4 text-[11px] leading-relaxed">{formatted}</pre>
        ) : null}
        {!payload && !jsonOpen ? (
          <p className="p-4 text-sm text-muted">Press &quot;Refresh snapshot&quot; to load diagnostics. JSON stays collapsed until you expand it.</p>
        ) : null}
      </Card>
    </div>
  );
}

function AutonomySummary({ payload }: { payload: InspectPayload }) {
  const generatedAt = typeof payload.generatedAt === "string" ? payload.generatedAt : null;
  const summaries = payload.summaries as Record<string, unknown> | undefined;
  const diagnostics = payload.diagnostics as Record<string, unknown> | undefined;
  const status = payload.status as { learningDaemon?: unknown } | undefined;

  const thoughtCats = summaries?.thoughts as Record<string, number> | undefined;
  const emotionSummary = summaries?.emotions as { byLabel?: Record<string, number>; byTrigger?: Record<string, number> } | undefined;
  const learningSummary = summaries?.learning as {
    totalRecords?: number;
    categoryCounts?: Record<string, number>;
  } | undefined;
  const outcomes = summaries?.outcomes as { total?: number; failures?: number } | undefined;
  const loopSignals = diagnostics?.loopSignals as Array<{ id?: string; severity?: string; detail?: string }> | undefined;

  const successes =
    outcomes?.total !== undefined && outcomes?.failures !== undefined ? Math.max(0, outcomes.total - outcomes.failures) : undefined;

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <SummaryTile title="Thought mix" subtitle={generatedAt ? `Snapshot · ${new Date(generatedAt).toLocaleString()}` : "Snapshot"} accent="from-sky-500/40 to-cyan-600/25">
        <CategoryChips counts={thoughtCats} emptyLabel="No thought categories in window." />
      </SummaryTile>

      <SummaryTile title="Emotion mix" subtitle="Labels observed in recent history" accent="from-fuchsia-500/35 to-purple-700/25">
        <CategoryChips counts={emotionSummary?.byLabel} emptyLabel="No emotion labels in window." />
      </SummaryTile>

      <SummaryTile title="Learning log" subtitle="Persisted improvement entries" accent="from-violet-500/35 to-indigo-700/25">
        <dl className="mb-3 grid gap-2 text-sm">
          <Row label="Total records" value={fmtMaybe(learningSummary?.totalRecords)} />
        </dl>
        <CategoryChips counts={learningSummary?.categoryCounts} emptyLabel="No learning categories." />
      </SummaryTile>

      <SummaryTile title="Outcomes & signals" subtitle="Task traces + autonomy watchdog" accent="from-emerald-500/35 to-teal-700/25">
        <dl className="grid gap-2 text-sm">
          <Row label="Tracked outcomes" value={fmtMaybe(outcomes?.total)} />
          <Row label="Failures (tracked)" value={fmtMaybe(outcomes?.failures)} />
          <Row label="Successes (tracked)" value={successes !== undefined ? String(successes) : "—"} />
          <Row label="Learning daemon" value={status?.learningDaemon ? "running / present" : "idle / absent"} />
          <Row label="Loop findings" value={loopSignals?.length ? `${loopSignals.length} finding(s)` : "none"} />
        </dl>
        {loopSignals && loopSignals.length > 0 ? (
          <ul className="mt-3 space-y-2 border-t border-white/10 pt-3 text-[11px] text-muted">
            {loopSignals.slice(0, 4).map((sig, i) => (
              <li key={`${sig.id ?? i}`}>
                <span className={cn("mr-1 font-semibold", sig.severity === "warn" ? "text-amber-200" : "text-sky-200")}>
                  [{sig.severity ?? "info"}]
                </span>
                {sig.detail ?? sig.id ?? "signal"}
              </li>
            ))}
          </ul>
        ) : null}
      </SummaryTile>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 pb-2 last:border-0 last:pb-0">
      <dt className="text-muted">{label}</dt>
      <dd className="font-medium tabular-nums text-text">{value}</dd>
    </div>
  );
}

function fmtMaybe(v: unknown): string {
  if (v === undefined || v === null) return "—";
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  if (typeof v === "string" && v.trim()) return v;
  return String(v);
}

function CategoryChips({ counts, emptyLabel }: { counts?: Record<string, number>; emptyLabel?: string }) {
  if (!counts || Object.keys(counts).length === 0) {
    return <p className="text-sm text-muted">{emptyLabel ?? "No breakdown returned."}</p>;
  }
  const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
  return (
    <div className="flex flex-wrap gap-2">
      {entries.map(([k, n]) => (
        <span
          key={k}
          className={cn(
            "rounded-full border border-white/15 bg-black/25 px-3 py-1 text-xs font-medium capitalize text-text",
            "shadow-inner shadow-black/20"
          )}
        >
          {k.replace(/_/g, " ")} · <span className="tabular-nums text-violet-200">{n}</span>
        </span>
      ))}
    </div>
  );
}

function SummaryTile({
  title,
  subtitle,
  accent,
  children
}: {
  title: string;
  subtitle: string;
  accent: string;
  children: ReactNode;
}) {
  return (
    <Card className={cn("relative overflow-hidden border-white/10 p-4", "bg-gradient-to-br", accent)}>
      <div className="relative">
        <h3 className="text-sm font-semibold text-text">{title}</h3>
        <p className="text-[11px] text-muted">{subtitle}</p>
        <div className="mt-3">{children}</div>
      </div>
    </Card>
  );
}
