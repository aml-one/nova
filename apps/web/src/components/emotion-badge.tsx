"use client";

import { useEffect, useMemo, useState } from "react";

type EmotionState = {
  valence: number;
  arousal: number;
  label: string;
};

export function EmotionBadge() {
  const [state, setState] = useState<EmotionState | null>(null);

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const response = await fetch("/api/emotion/state?userId=nova-system");
        const data = (await response.json()) as { state?: EmotionState | null };
        if (alive) {
          setState(data.state ?? null);
        }
      } catch {
        if (alive) {
          setState(null);
        }
      }
    };
    void load();
    const timer = setInterval(() => void load(), 5000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);

  const color = useMemo(() => {
    const label = state?.label ?? "neutral";
    if (label === "joyful") return "#16a34a";
    if (label === "curious") return "#2563eb";
    if (label === "empathetic") return "#7c3aed";
    if (label === "frustrated") return "#dc2626";
    if (label === "anxious") return "#d97706";
    if (label === "guilty") return "#b45309";
    return "#6b7280";
  }, [state?.label]);

  return (
    <div
      title={
        state
          ? `Nova is ${state.label} (valence=${state.valence.toFixed(2)}, arousal=${state.arousal.toFixed(2)})`
          : "Nova emotional state unavailable"
      }
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid rgba(148,163,184,0.5)",
        borderRadius: 999,
        padding: "4px 10px",
        background: `linear-gradient(135deg, ${color}22, rgba(148,163,184,0.20))`,
        boxShadow: "inset 0 1px 0 rgba(255,255,255,0.25)"
      }}
    >
      <span
        style={{
          width: 10,
          height: 10,
          borderRadius: "50%",
          background: color,
          display: "inline-block"
        }}
      />
      <span style={{ fontSize: 12, fontWeight: 700 }}>
        {state ? `Nova's ${state.label}` : "Nova's unknown"}
      </span>
    </div>
  );
}
