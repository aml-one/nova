"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";

type LearningItem = {
  id: string;
  at: string;
  category: string;
  proposal: string;
  accepted: boolean;
  result?: string;
  details?: Record<string, unknown>;
};

type ProposalStatus = "proposed" | "approved" | "in_progress" | "implemented" | "needs_human";

type ImprovementProposal = {
  id: string;
  title: string;
  summary: string;
  details?: string;
  source: string;
  status: ProposalStatus;
  createdAt: string;
  approvedAt?: string;
  startedAt?: string;
  completedAt?: string;
};

type ImprovementProposalEvent = {
  id: string;
  proposalId: string;
  eventType: "created" | "status_changed" | "work_attempt";
  statusFrom?: ProposalStatus;
  statusTo?: ProposalStatus;
  note?: string;
  actor: string;
  createdAt: string;
};

function statusLabel(status: ProposalStatus): string {
  if (status === "needs_human") return "needs you";
  return status.replace("_", " ");
}

function latestNeedsHumanReason(events: ImprovementProposalEvent[] | undefined): string | undefined {
  if (!events) return undefined;
  for (const evt of events) {
    if (evt.eventType === "work_attempt" && (evt.statusTo === "needs_human" || evt.note?.toLowerCase().includes("needs human"))) {
      return evt.note;
    }
  }
  return undefined;
}

export default function LearningPage() {
  const [itemsByDate, setItemsByDate] = useState<Record<string, LearningItem[]>>({});
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [proposals, setProposals] = useState<ImprovementProposal[]>([]);
  const [busyProposalId, setBusyProposalId] = useState<string | null>(null);
  const [pendingOnly, setPendingOnly] = useState(true);
  const [eventMap, setEventMap] = useState<Record<string, ImprovementProposalEvent[]>>({});
  const [expandedProposalId, setExpandedProposalId] = useState<string | null>(null);
  const workingOnNowRef = useRef<HTMLDivElement | null>(null);
  const pendingScrollToWorkingNowRef = useRef(false);

  async function load(): Promise<void> {
    setLoading(true);
    const [historyResponse, proposalsResponse] = await Promise.all([
      fetch("/api/improvement/history"),
      fetch("/api/improvement/proposals")
    ]);
    const historyData = (await historyResponse.json()) as { itemsByDate?: Record<string, LearningItem[]> };
    const proposalsData = (await proposalsResponse.json()) as { items?: ImprovementProposal[] };
    setItemsByDate(historyData.itemsByDate ?? {});
    setProposals(Array.isArray(proposalsData.items) ? proposalsData.items : []);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  async function runCycleNow(): Promise<void> {
    setRunning(true);
    setStatus(null);
    const response = await fetch("/api/improvement/cycle", { method: "POST" });
    const data = (await response.json()) as { result?: string; error?: string };
    setStatus(response.ok ? data.result ?? "cycle complete" : data.error ?? "cycle failed");
    await load();
    setRunning(false);
  }

  async function updateProposalStatus(id: string, nextStatus: ImprovementProposal["status"]): Promise<void> {
    setBusyProposalId(id);
    const response = await fetch("/api/improvement/proposals/status", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: nextStatus })
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Failed to update proposal status");
      setBusyProposalId(null);
      return;
    }
    setStatus(`Proposal updated: ${nextStatus}`);
    if (nextStatus === "approved") {
      pendingScrollToWorkingNowRef.current = true;
    }
    await load();
    setBusyProposalId(null);
  }

  async function toggleProposalDetails(id: string): Promise<void> {
    if (expandedProposalId === id) {
      setExpandedProposalId(null);
      return;
    }
    setExpandedProposalId(id);
    if (eventMap[id]) return;
    const response = await fetch(`/api/improvement/proposals/events?id=${encodeURIComponent(id)}`);
    const data = (await response.json()) as { events?: ImprovementProposalEvent[]; error?: string };
    if (!response.ok) {
      setStatus(data.error ?? "Failed to load proposal activity");
      return;
    }
    setEventMap((prev) => ({ ...prev, [id]: Array.isArray(data.events) ? data.events : [] }));
  }

  const dates = Object.keys(itemsByDate).sort((a, b) => (a < b ? 1 : -1));
  const visibleProposals = pendingOnly ? proposals.filter((item) => item.status !== "implemented") : proposals;
  const activeProposal = useMemo(
    () =>
      proposals.find((item) => item.status === "in_progress") ??
      proposals.find((item) => item.status === "approved") ??
      proposals.find((item) => item.status === "needs_human") ??
      null,
    [proposals]
  );

  useEffect(() => {
    if (!activeProposal) return;
    if (eventMap[activeProposal.id]) return;
    void (async () => {
      try {
        const response = await fetch(`/api/improvement/proposals/events?id=${encodeURIComponent(activeProposal.id)}`);
        const data = (await response.json()) as { events?: ImprovementProposalEvent[] };
        setEventMap((prev) => ({ ...prev, [activeProposal.id]: Array.isArray(data.events) ? data.events : [] }));
      } catch {
        // ignore — Show Activity button will retry on demand
      }
    })();
  }, [activeProposal, eventMap]);

  useEffect(() => {
    if (!pendingScrollToWorkingNowRef.current) return;
    if (!activeProposal || activeProposal.status === "proposed") return;
    pendingScrollToWorkingNowRef.current = false;
    window.setTimeout(() => {
      workingOnNowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }, [activeProposal]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Learning Timeline</h1>
        <p className="text-sm text-muted">Detailed self-improvement events grouped by date.</p>
        <p className="text-sm text-muted">
          <Link href="/emotion" className="underline">Open Emotion Timeline</Link>
        </p>
      </div>
      <div className="flex gap-2">
        <Button type="button" tone="blue" onClick={() => void load()}>
          Refresh
        </Button>
        <Button type="button" tone="green" onClick={() => void runCycleNow()} disabled={running}>
          {running ? "Running..." : "Run Learning Cycle"}
        </Button>
      </div>
      <div ref={workingOnNowRef}>
        <Card className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">Working On Now</h2>
        {activeProposal ? (
          <article className="rounded-ui border bg-surface2 p-3 space-y-2">
            <div className="flex items-center justify-between gap-2">
              <div className="font-medium">{activeProposal.title}</div>
              <div className="text-xs uppercase tracking-wide text-muted">{statusLabel(activeProposal.status)}</div>
            </div>
            <div className="text-sm">{activeProposal.summary}</div>
            {activeProposal.details ? <div className="text-xs text-muted">Done signal: {activeProposal.details}</div> : null}
            {activeProposal.status === "needs_human" ? (
              <div className="rounded-ui border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                <div className="font-medium text-amber-200">Nova stopped and is waiting for you</div>
                <div className="text-muted">
                  {latestNeedsHumanReason(eventMap[activeProposal.id]) ?? "Open Show Activity for the reason; re-approve to retry."}
                </div>
              </div>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                tone="blue"
                disabled={busyProposalId === activeProposal.id || activeProposal.status !== "approved"}
                onClick={() => void updateProposalStatus(activeProposal.id, "in_progress")}
              >
                Start Work
              </Button>
              <Button
                type="button"
                tone="green"
                disabled={busyProposalId === activeProposal.id || activeProposal.status !== "needs_human"}
                onClick={() => void updateProposalStatus(activeProposal.id, "approved")}
              >
                Re-approve & Retry
              </Button>
              <Button
                type="button"
                tone="neutral"
                disabled={busyProposalId === activeProposal.id || activeProposal.status === "implemented"}
                onClick={() => void updateProposalStatus(activeProposal.id, "implemented")}
              >
                Mark Implemented
              </Button>
              <Button type="button" tone="purple" onClick={() => void toggleProposalDetails(activeProposal.id)}>
                {expandedProposalId === activeProposal.id ? "Hide Activity" : "Show Activity"}
              </Button>
            </div>
            {expandedProposalId === activeProposal.id ? (
              <div className="rounded-ui border bg-surface p-2 text-xs">
                {(eventMap[activeProposal.id] ?? []).length === 0 ? (
                  <div className="text-muted">No activity yet.</div>
                ) : (
                  (eventMap[activeProposal.id] ?? []).map((evt) => (
                    <div key={evt.id} className="py-1 text-muted">
                      {new Date(evt.createdAt).toLocaleString()} · {evt.actor} · {evt.eventType}
                      {evt.statusTo ? ` (${evt.statusFrom ?? "-"} -> ${evt.statusTo})` : ""}
                      {evt.note ? ` · ${evt.note}` : ""}
                    </div>
                  ))
                )}
              </div>
            ) : null}
          </article>
        ) : (
          <div className="text-sm text-muted">Nothing active right now. Approve a suggestion to start a work queue.</div>
        )}
        </Card>
      </div>
      <Card className="space-y-3 p-4">
        <h2 className="text-lg font-semibold">Suggested Improvements Queue</h2>
        <p className="text-sm text-muted">
          One-click flow: approve a suggestion, mark it in progress when Nova starts, then mark implemented when done.
        </p>
        <label className="flex items-center gap-2 text-sm text-muted">
          <input type="checkbox" checked={pendingOnly} onChange={(e) => setPendingOnly(e.target.checked)} />
          Show only pending (hide implemented)
        </label>
        <div className="grid gap-2">
          {visibleProposals.length === 0 ? (
            <div className="text-sm text-muted">No suggestions in this view. Run a learning cycle or disable pending-only.</div>
          ) : null}
          {visibleProposals.map((item) => (
            <article key={item.id} className="rounded-ui border bg-surface2 p-3 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{item.title}</div>
                <div className="text-xs uppercase tracking-wide text-muted">{statusLabel(item.status)}</div>
              </div>
              <div className="text-sm">{item.summary}</div>
              {item.details ? <div className="text-xs text-muted">Done signal: {item.details}</div> : null}
              <div className="text-xs text-muted">Created: {new Date(item.createdAt).toLocaleString()}</div>
              {item.status === "needs_human" ? (
                <div className="rounded-ui border border-amber-500/40 bg-amber-500/10 p-2 text-xs">
                  <div className="font-medium text-amber-200">Needs you</div>
                  <div className="text-muted">
                    {latestNeedsHumanReason(eventMap[item.id]) ?? "Click Show Activity for the latest reason. Re-approve to let Nova try again."}
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  tone="green"
                  disabled={
                    busyProposalId === item.id || (item.status !== "proposed" && item.status !== "needs_human")
                  }
                  onClick={() => void updateProposalStatus(item.id, "approved")}
                >
                  {item.status === "needs_human" ? "Re-approve & Retry" : "Accept"}
                </Button>
                <Button
                  type="button"
                  tone="blue"
                  disabled={busyProposalId === item.id || item.status !== "approved"}
                  onClick={() => void updateProposalStatus(item.id, "in_progress")}
                >
                  Start Work
                </Button>
                <Button
                  type="button"
                  tone="neutral"
                  disabled={busyProposalId === item.id || item.status === "implemented"}
                  onClick={() => void updateProposalStatus(item.id, "implemented")}
                >
                  Mark Implemented
                </Button>
                <Button type="button" tone="purple" onClick={() => void toggleProposalDetails(item.id)}>
                  {expandedProposalId === item.id ? "Hide Activity" : "Show Activity"}
                </Button>
              </div>
              {expandedProposalId === item.id ? (
                <div className="rounded-ui border bg-surface p-2 text-xs">
                  {(eventMap[item.id] ?? []).length === 0 ? (
                    <div className="text-muted">No activity yet.</div>
                  ) : (
                    (eventMap[item.id] ?? []).map((evt) => (
                      <div key={evt.id} className="py-1 text-muted">
                        {new Date(evt.createdAt).toLocaleString()} · {evt.actor} · {evt.eventType}
                        {evt.statusTo ? ` (${evt.statusFrom ?? "-"} -> ${evt.statusTo})` : ""}
                        {evt.note ? ` · ${evt.note}` : ""}
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </article>
          ))}
        </div>
      </Card>
      {status ? <Card>{status}</Card> : null}
      {loading ? <Card>Loading...</Card> : null}
      {!loading &&
        dates.map((date) => (
          <section key={date} className="space-y-2">
            <h2 className="text-lg font-semibold">{date}</h2>
            <div className="grid gap-2">
              {itemsByDate[date]?.map((item) => (
                <article key={item.id} className="rounded-ui border bg-surface2 p-3">
                  <div>
                    <strong>{new Date(item.at).toLocaleTimeString()}</strong> · {item.category} ·{" "}
                    {item.accepted ? "accepted" : "not accepted"}
                  </div>
                  <div>{item.proposal}</div>
                  {item.result ? <div className="text-muted">Result: {item.result}</div> : null}
                  {renderLearningDetails(item.details)}
                </article>
              ))}
            </div>
          </section>
        ))}
    </div>
  );
}

function renderLearningDetails(details?: Record<string, unknown>): ReactNode | null {
  if (!details || Object.keys(details).length === 0) return null;

  const topics = Array.isArray(details.topics) ? details.topics.map((item) => String(item)) : [];
  const runId = typeof details.runId === "string" ? details.runId : undefined;
  const userId = typeof details.userId === "string" ? details.userId : undefined;
  const failures =
    typeof details.failures === "number" || typeof details.failures === "string" ? String(details.failures) : undefined;
  const notes = typeof details.notes === "string" ? details.notes : undefined;

  return (
    <div className="mt-1 space-y-1 text-xs text-muted">
      {topics.length > 0 ? <div>Topics: {topics.join(", ")}</div> : null}
      {failures ? <div>Recent failures considered: {failures}</div> : null}
      {notes ? <div>Notes: {notes}</div> : null}
      {runId ? <div>Run: {runId}</div> : null}
      {userId ? <div>User: {userId}</div> : null}
    </div>
  );
}
