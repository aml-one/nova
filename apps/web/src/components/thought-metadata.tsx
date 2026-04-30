"use client";

import { useMemo, useState, type ReactNode } from "react";
import { FaChevronDown, FaChevronRight } from "react-icons/fa6";
import { cn } from "../lib/cn";

function metadataSummary(value: unknown): string {
  if (value === null || value === undefined) return "Empty";
  if (typeof value === "string") {
    const t = value.trim();
    if (t.length <= 72) return t || "String";
    return `${t.slice(0, 72)}…`;
  }
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return String(value);
  if (Array.isArray(value)) return `Array · ${value.length} item${value.length === 1 ? "" : "s"}`;
  if (typeof value === "object") {
    const keys = Object.keys(value as object);
    const preview = keys.slice(0, 3).join(", ");
    const more = keys.length > 3 ? ` +${keys.length - 3}` : "";
    return keys.length ? `Object · ${keys.length} field${keys.length === 1 ? "" : "s"} (${preview}${more})` : "Object · { }";
  }
  return String(value);
}

function JsonishValue({ value, depth }: { value: unknown; depth: number }): ReactNode {
  if (depth > 14) return <span className="text-slate-500">…</span>;
  if (value === null) return <span className="text-rose-400/95">null</span>;
  if (value === undefined) return <span className="text-slate-500">undefined</span>;
  if (typeof value === "boolean") return <span className="text-amber-400/95">{String(value)}</span>;
  if (typeof value === "number") return <span className="text-violet-300 tabular-nums">{value}</span>;
  if (typeof value === "string") {
    const display = value.length > 2000 ? `${value.slice(0, 2000)}…` : value;
    return <span className="break-words text-emerald-300/95">&quot;{display}&quot;</span>;
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return <span className="text-slate-500">[]</span>;
    return (
      <ul className="mt-0.5 list-none space-y-1 border-l border-slate-600/45 pl-2.5">
        {value.map((entry, i) => (
          <li key={i} className="text-[11px] leading-snug">
            <span className="select-none text-slate-500">{i}</span>
            <span className="text-slate-600"> · </span>
            <JsonishValue value={entry} depth={depth + 1} />
          </li>
        ))}
      </ul>
    );
  }
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return <span className="text-slate-500">{`{ }`}</span>;
    return (
      <dl className="mt-0.5 space-y-1 border-l border-sky-700/35 pl-2.5">
        {entries.map(([k, v]) => (
          <div key={k} className="text-[11px] leading-snug">
            <dt className="inline font-medium text-sky-300/95">{k}</dt>
            <span className="text-slate-600">: </span>
            <dd className="inline align-top">
              <JsonishValue value={v} depth={depth + 1} />
            </dd>
          </div>
        ))}
      </dl>
    );
  }
  return <span className="text-slate-400">{String(value)}</span>;
}

export function ThoughtMetadataDetails({ metadata }: { metadata: unknown }) {
  const [open, setOpen] = useState(false);
  const summary = useMemo(() => metadataSummary(metadata), [metadata]);

  return (
    <div className="mt-2 rounded-ui border border-slate-600/35 bg-slate-950/25">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-start gap-2 px-2.5 py-2 text-left text-xs transition hover:bg-slate-800/40"
      >
        <span className="mt-0.5 shrink-0 text-slate-400">{open ? <FaChevronDown className="h-3 w-3" /> : <FaChevronRight className="h-3 w-3" />}</span>
        <span className="min-w-0 flex-1">
          <span className="font-semibold text-slate-200">{open ? "Hide" : "Show"} technical details</span>
          {!open ? <span className="mt-0.5 block truncate text-[11px] font-normal text-slate-500">{summary}</span> : null}
        </span>
      </button>
      {open ? (
        <div className={cn("max-h-[min(48vh,420px)] overflow-auto border-t border-slate-600/30 px-2.5 py-2 font-mono")}>
          <JsonishValue value={metadata} depth={0} />
        </div>
      ) : null}
    </div>
  );
}
