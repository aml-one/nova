"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NOVA_EMOTION_REFRESH_EVENT, WEB_CHAT_EMOTION_USER_ID } from "../lib/emotion-user";

type EmotionState = {
  valence: number;
  arousal: number;
  label: string;
};

const POLL_VISIBLE_MS = 900;
const POLL_HIDDEN_MS = 8000;

export function EmotionBadge({ userId = WEB_CHAT_EMOTION_USER_ID }: { userId?: string }) {
  const [state, setState] = useState<EmotionState | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`/api/emotion/state?userId=${encodeURIComponent(userId)}`);
      const data = (await response.json()) as { state?: EmotionState | null };
      setState(data.state ?? null);
    } catch {
      setState(null);
    }
  }, [userId]);

  useEffect(() => {
    let timer: ReturnType<typeof setInterval> | null = null;

    const schedulePoll = () => {
      if (timer != null) {
        clearInterval(timer);
        timer = null;
      }
      const ms = typeof document !== "undefined" && document.visibilityState === "hidden" ? POLL_HIDDEN_MS : POLL_VISIBLE_MS;
      timer = setInterval(() => void fetchState(), ms);
    };

    void fetchState();
    schedulePoll();

    const onVisibility = () => {
      void fetchState();
      schedulePoll();
    };

    const onRefresh = () => void fetchState();

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener(NOVA_EMOTION_REFRESH_EVENT, onRefresh);

    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener(NOVA_EMOTION_REFRESH_EVENT, onRefresh);
      if (timer != null) {
        clearInterval(timer);
      }
    };
  }, [fetchState, userId]);

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
          ? `Nova is ${state.label} (valence=${state.valence.toFixed(2)}, arousal=${state.arousal.toFixed(2)}) · one mood for all channels & users`
          : "Nova emotional state unavailable (enable emotion core in Settings)"
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
