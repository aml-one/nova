"use client";

import { useEffect, useState } from "react";
import { apiFetch } from "../lib/api-fetch";

type TextScale = "normal" | "medium" | "big";

const SCALE_SEQUENCE: TextScale[] = ["normal", "medium", "big"];

const SCALE_LABEL: Record<TextScale, string> = {
  normal: "Normal",
  medium: "Medium",
  big: "Big"
};

function nextScale(current: TextScale): TextScale {
  const idx = SCALE_SEQUENCE.indexOf(current);
  return SCALE_SEQUENCE[(idx + 1) % SCALE_SEQUENCE.length];
}

function applyScale(scale: TextScale): void {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute("data-text-scale", scale);
}

export function TextScaleToggle() {
  const [mounted, setMounted] = useState(false);
  const [scale, setScale] = useState<TextScale>("normal");

  useEffect(() => {
    setMounted(true);
    let cancelled = false;
    void (async () => {
      try {
        const response = await apiFetch("/api/settings");
        const data = (await response.json()) as { settings?: { web?: { textScale?: string } } };
        if (!response.ok || cancelled) return;
        const ts = data.settings?.web?.textScale;
        const legacy =
          typeof window !== "undefined" ? window.localStorage.getItem("nova:text-scale") : null;
        const legacyOk = legacy === "medium" || legacy === "big" || legacy === "normal";
        if (
          legacyOk &&
          (ts === undefined || ts === "normal") &&
          legacy !== "normal"
        ) {
          await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ web: { textScale: legacy } })
          });
          setScale(legacy);
          applyScale(legacy);
          try {
            window.localStorage.removeItem("nova:text-scale");
          } catch {
            /* ignore */
          }
          return;
        }
        if (ts === "medium" || ts === "big" || ts === "normal") {
          setScale(ts);
          applyScale(ts);
          return;
        }
        if (legacyOk) {
          setScale(legacy);
          applyScale(legacy);
        }
      } catch {
        const legacy = typeof window !== "undefined" ? window.localStorage.getItem("nova:text-scale") : null;
        if (legacy === "medium" || legacy === "big" || legacy === "normal") {
          setScale(legacy);
          applyScale(legacy);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!mounted) return null;

  const currentLabel = SCALE_LABEL[scale];
  const next = nextScale(scale);
  const nextLabel = SCALE_LABEL[next];

  return (
    <button
      type="button"
      onClick={() => {
        setScale(next);
        applyScale(next);
        void (async () => {
          try {
            await apiFetch("/api/settings", {
              method: "PUT",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ web: { textScale: next } })
            });
          } catch {
            // Ignore save failures; scale still applied in-session.
          }
        })();
      }}
      className="inline-flex h-8 min-w-[2.9rem] items-center justify-center rounded-ui px-2 text-[11px] font-semibold text-slate-600 transition hover:bg-slate-500/10 dark:text-slate-300 dark:hover:bg-slate-400/10"
      title={`Text size: ${currentLabel} (${scale === "normal" ? "100%" : scale === "medium" ? "125%" : "150%"}). Click for ${nextLabel}.`}
      aria-label={`Text size ${currentLabel}. Click for ${nextLabel}.`}
    >
      <span className="mr-1 text-xs">A</span>
      <span>{currentLabel}</span>
    </button>
  );
}
