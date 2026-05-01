"use client";

import { useState } from "react";
import { Button } from "./ui/button";
import { Input } from "./ui/input";

export type TimelineFilterKey = "persona" | "knowledge" | "backup";

export type ImprovementHistoryByDate = Record<string, Array<{ category?: string; accepted?: boolean; result?: string }>>;

export type IdentityTimelinePersona = {
  id: string;
  voice: string;
  style: string[];
  systemPrompt: string;
};

export type IdentityTimelinePersonaVersion = { version: number; createdAt: string };

export type IdentityTimelineBackup = {
  status?: "success" | "failed";
  createdAt?: string;
  branch?: string;
  error?: string;
} | null;

export type IdentityTimelineItem = {
  id: string;
  at: string;
  title: string;
  detail: string;
  side: "left" | "right";
  accentClass: string;
  kind: "awakening" | "persona" | "knowledge" | "backup";
  meta?: Record<string, string | number>;
};

export function buildIdentityTimeline(input: {
  defaultPersona: IdentityTimelinePersona;
  versions: IdentityTimelinePersonaVersion[];
  improvementHistoryByDate: ImprovementHistoryByDate;
  latestIdentityBackup: IdentityTimelineBackup;
}): IdentityTimelineItem[] {
  const items: IdentityTimelineItem[] = [];
  const sortedVersions = [...input.versions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (sortedVersions.length === 0) {
    items.push({
      id: "awakening",
      at: new Date(0).toISOString(),
      title: "Awakening",
      detail: `Base voice: ${input.defaultPersona.voice}; style: ${input.defaultPersona.style.join(", ") || "none"}`,
      side: "left",
      accentClass: "bg-emerald-400",
      kind: "awakening",
      meta: {
        voice: input.defaultPersona.voice,
        style: input.defaultPersona.style.join(", ") || "none"
      }
    });
  } else {
    sortedVersions.forEach((version, index) => {
      items.push({
        id: `persona-v${version.version}`,
        at: version.createdAt,
        title: index === 0 ? "Awakening Persona" : `Persona Evolution v${version.version}`,
        detail:
          index === 0
            ? `Initial foundation set. Voice: ${input.defaultPersona.voice}`
            : `Identity refined through ongoing learning and user interaction.`,
        side: index % 2 === 0 ? "left" : "right",
        accentClass: index % 2 === 0 ? "bg-orange-400" : "bg-rose-500",
        kind: "persona",
        meta: {
          version: version.version,
          voice: input.defaultPersona.voice,
          styles: input.defaultPersona.style.join(", ") || "none"
        }
      });
    });
  }
  const learningDates = Object.keys(input.improvementHistoryByDate).sort((a, b) => Date.parse(a) - Date.parse(b));
  let cumulativeKnowledge = 0;
  learningDates.slice(-8).forEach((dateKey, index) => {
    const dayItems = input.improvementHistoryByDate[dateKey] ?? [];
    const researched = dayItems.filter((item) => item.category === "research").length;
    const improvements = dayItems.filter((item) => item.category === "improvement").length;
    cumulativeKnowledge += researched + improvements;
    items.push({
      id: `learning-${dateKey}`,
      at: `${dateKey}T12:00:00.000Z`,
      title: "Knowledge Growth",
      detail: `Research notes: ${researched}, improvements: ${improvements}, cumulative growth score: ${cumulativeKnowledge} (activity score = research + improvements; not an intelligence/quality score).`,
      side: index % 2 === 0 ? "right" : "left",
      accentClass: "bg-sky-500",
      kind: "knowledge",
      meta: {
        day: dateKey,
        research: researched,
        improvements,
        cumulativeGrowth: cumulativeKnowledge
      }
    });
  });
  if (input.latestIdentityBackup?.createdAt) {
    items.push({
      id: "identity-backup",
      at: input.latestIdentityBackup.createdAt,
      title: input.latestIdentityBackup.status === "success" ? "Identity Safeguarded" : "Backup Attempt",
      detail:
        input.latestIdentityBackup.status === "success"
          ? `Backup saved. Branch: ${input.latestIdentityBackup.branch ?? "n/a"}`
          : `Backup issue: ${input.latestIdentityBackup.error ?? "unknown error"}`,
      side: "right",
      accentClass: input.latestIdentityBackup.status === "success" ? "bg-lime-500" : "bg-rose-500",
      kind: "backup",
      meta: {
        status: input.latestIdentityBackup.status ?? "unknown",
        branch: input.latestIdentityBackup.branch ?? "n/a",
        error: input.latestIdentityBackup.error ?? ""
      }
    });
  }
  const sorted = items
    .filter((item) => Number.isFinite(Date.parse(item.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!sorted.length || sorted[sorted.length - 1]?.title !== "Awakening Persona") {
    sorted.push({
      id: "origin-awakening-fallback",
      at: "1970-01-01T00:00:00.000Z",
      title: "Awakening",
      detail: `Nova was initialized with voice "${input.defaultPersona.voice}" and core goals to help, learn, and evolve.`,
      side: "left",
      accentClass: "bg-emerald-400",
      kind: "awakening",
      meta: {
        voice: input.defaultPersona.voice,
        style: input.defaultPersona.style.join(", ") || "none"
      }
    });
  }
  return sorted;
}

type IdentityEvolutionGraphBase = {
  items: IdentityTimelineItem[];
  filters: Record<TimelineFilterKey, boolean>;
  onToggleFilter: (key: TimelineFilterKey) => void;
};

type IdentityEvolutionGraphWithRestore = IdentityEvolutionGraphBase & {
  hideRestore?: false;
  onRestoreVersion: (version: number) => void;
  restoringVersion: number | null;
};

type IdentityEvolutionGraphReadOnly = IdentityEvolutionGraphBase & {
  hideRestore: true;
};

export type IdentityEvolutionGraphProps = IdentityEvolutionGraphWithRestore | IdentityEvolutionGraphReadOnly;

export function IdentityEvolutionGraph(props: IdentityEvolutionGraphProps) {
  const { items, filters, onToggleFilter } = props;
  const hideRestore = props.hideRestore === true;
  const onRestoreVersion = hideRestore ? undefined : props.onRestoreVersion;
  const restoringVersion = hideRestore ? null : props.restoringVersion;

  const filteredItems = items.filter((item) => {
    if (item.kind === "awakening" || item.kind === "persona") return filters.persona;
    if (item.kind === "knowledge") return filters.knowledge;
    if (item.kind === "backup") return filters.backup;
    return true;
  });
  const [selectedId, setSelectedId] = useState<string>(filteredItems[0]?.id ?? items[0]?.id ?? "");
  const selected = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? items[0];
  const selectedVersion = Number(selected?.meta?.version ?? 0);
  const [confirmStepVersion, setConfirmStepVersion] = useState<number | null>(null);
  const [typedConfirm, setTypedConfirm] = useState("");

  return (
    <div className="rounded-ui border bg-surface2 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
        <span className="font-semibold text-emerald-400">Present</span>
        <span className="font-semibold text-orange-300">Awakening</span>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 w-1 -translate-x-1/2 rounded-full bg-gradient-to-t from-orange-400 via-rose-500 to-sky-500" />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFilter("persona")}
            className={`rounded-ui border px-2 py-1 text-[11px] ${filters.persona ? "border-orange-400/50 bg-orange-400/15 text-orange-200" : "border-slate-500/40 text-muted"}`}
          >
            Personality
          </button>
          <button
            type="button"
            onClick={() => onToggleFilter("knowledge")}
            className={`rounded-ui border px-2 py-1 text-[11px] ${filters.knowledge ? "border-sky-400/50 bg-sky-400/15 text-sky-200" : "border-slate-500/40 text-muted"}`}
          >
            Knowledge
          </button>
          <button
            type="button"
            onClick={() => onToggleFilter("backup")}
            className={`rounded-ui border px-2 py-1 text-[11px] ${filters.backup ? "border-lime-400/50 bg-lime-400/15 text-lime-200" : "border-slate-500/40 text-muted"}`}
          >
            Backups
          </button>
        </div>
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div key={item.id} className={`grid grid-cols-[1fr_24px_1fr] items-center gap-2 ${item.side === "left" ? "" : ""}`}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`${item.side === "left" ? "text-right" : "invisible"} rounded-ui border bg-surface p-2 transition hover:border-sky-400/60 ${
                  selected?.id === item.id ? "border-sky-400/70 bg-sky-500/10" : ""
                }`}
              >
                <div className="text-[11px] font-semibold">{item.title}</div>
                <div className="text-[10px] text-muted">{item.detail}</div>
                <div className="mt-1 text-[10px] text-muted">{formatTimelineDate(item.at)}</div>
              </button>
              <div className="relative flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`z-10 inline-flex h-4 w-4 rounded-full border-2 border-white/90 ${item.accentClass} ${
                    selected?.id === item.id ? "ring-2 ring-sky-300/70 ring-offset-1 ring-offset-surface2" : ""
                  }`}
                  title={`Open ${item.title} details`}
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`${item.side === "right" ? "text-left" : "invisible"} rounded-ui border bg-surface p-2 transition hover:border-sky-400/60 ${
                  selected?.id === item.id ? "border-sky-400/70 bg-sky-500/10" : ""
                }`}
              >
                <div className="text-[11px] font-semibold">{item.title}</div>
                <div className="text-[10px] text-muted">{item.detail}</div>
                <div className="mt-1 text-[10px] text-muted">{formatTimelineDate(item.at)}</div>
              </button>
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <div className="mt-3 rounded-ui border bg-surface p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <strong className="text-sm">{selected.title}</strong>
            <span className="rounded-ui border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
              {selected.kind}
            </span>
          </div>
          <div className="mb-2 text-xs text-muted">{selected.detail}</div>
          <div className="text-[11px] text-muted">When: {formatTimelineDate(selected.at)}</div>
          {selected.meta ? (
            <div className="mt-2 grid gap-1 rounded-ui border bg-surface2 p-2 text-[11px]">
              {Object.entries(selected.meta).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-2">
                  <span className="text-muted">{prettifyKey(key)}</span>
                  <span className="text-right">{String(value)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {!hideRestore && selected.kind === "persona" && selectedVersion > 0 ? (
            <div className="mt-3">
              {confirmStepVersion !== selectedVersion ? (
                <Button
                  type="button"
                  tone="orange"
                  disabled={restoringVersion !== null}
                  onClick={() => {
                    const ok = window.confirm(
                      `First confirmation: Restore Nova base identity to persona version ${selectedVersion}?`
                    );
                    if (!ok) return;
                    setConfirmStepVersion(selectedVersion);
                    setTypedConfirm("");
                  }}
                >
                  {`Restore Persona v${selectedVersion}`}
                </Button>
              ) : (
                <div className="space-y-2 rounded-ui border border-rose-500/40 bg-rose-500/10 p-2">
                  <div className="text-xs font-semibold text-rose-200">Second confirmation required</div>
                  <div className="text-[11px] text-rose-200/90">
                    Type <code>RESTORE</code> and click confirm to continue.
                  </div>
                  <Input value={typedConfirm} onChange={(e) => setTypedConfirm(e.target.value)} placeholder="Type RESTORE" />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      tone="red"
                      disabled={restoringVersion !== null || typedConfirm.trim().toUpperCase() !== "RESTORE"}
                      onClick={() => {
                        if (onRestoreVersion) void onRestoreVersion(selectedVersion);
                        setConfirmStepVersion(null);
                        setTypedConfirm("");
                      }}
                    >
                      {restoringVersion === selectedVersion ? "Restoring..." : "Confirm restore"}
                    </Button>
                    <Button
                      type="button"
                      tone="neutral"
                      disabled={restoringVersion !== null}
                      onClick={() => {
                        setConfirmStepVersion(null);
                        setTypedConfirm("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatTimelineDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function prettifyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
