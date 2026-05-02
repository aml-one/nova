"use client";

import { useEffect, useState } from "react";

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

function readSavedScale(): TextScale {
  if (typeof window === "undefined") return "normal";
  const raw = window.localStorage.getItem("nova:text-scale");
  if (raw === "medium" || raw === "big" || raw === "normal") return raw;
  return "normal";
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
    const saved = readSavedScale();
    setScale(saved);
    applyScale(saved);
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
        window.localStorage.setItem("nova:text-scale", next);
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
