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
        position: "fixed",
        top: 10,
        right: 10,
        zIndex: 3000,
        display: "flex",
        alignItems: "center",
        gap: 8,
        border: "1px solid #ddd",
        borderRadius: 999,
        padding: "6px 10px",
        background: "#fff",
        boxShadow: "0 1px 4px rgba(0,0,0,0.08)"
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
      <span style={{ fontSize: 12, fontWeight: 600 }}>
        {state ? `Nova: ${state.label}` : "Nova: unknown"}
      </span>
    </div>
  );
}
