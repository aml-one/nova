"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { NOVA_EMOTION_REFRESH_EVENT, WEB_CHAT_EMOTION_USER_ID } from "../lib/emotion-user";
import { cn } from "../lib/cn";

type EmotionState = {
  valence: number;
  arousal: number;
  label: string;
};

const POLL_VISIBLE_MS = 900;
const POLL_HIDDEN_MS = 8000;

function moodAccent(label: string): { dot: string; glow: string } {
  switch (label) {
    case "joyful":
      return { dot: "bg-emerald-400", glow: "shadow-[0_0_12px_rgba(52,211,153,0.45)]" };
    case "curious":
      return { dot: "bg-sky-400", glow: "shadow-[0_0_12px_rgba(56,189,248,0.4)]" };
    case "empathetic":
      return { dot: "bg-violet-400", glow: "shadow-[0_0_12px_rgba(167,139,250,0.4)]" };
    case "frustrated":
      return { dot: "bg-rose-400", glow: "shadow-[0_0_12px_rgba(251,113,133,0.4)]" };
    case "anxious":
      return { dot: "bg-amber-400", glow: "shadow-[0_0_12px_rgba(251,191,36,0.35)]" };
    case "guilty":
      return { dot: "bg-orange-400", glow: "shadow-[0_0_12px_rgba(251,146,60,0.35)]" };
    default:
      return { dot: "bg-slate-400", glow: "shadow-[0_0_8px_rgba(148,163,184,0.35)]" };
  }
}

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

  const label = state?.label ?? "neutral";
  const { dot, glow } = useMemo(() => moodAccent(label), [label]);

  return (
    <div
      title={
        state
          ? `Nova is ${state.label} (valence=${state.valence.toFixed(2)}, arousal=${state.arousal.toFixed(2)}) · one mood for all channels & users`
          : "Nova emotional state unavailable (enable emotion core in Settings)"
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1",
        "border-slate-300/25 bg-gradient-to-r from-white/12 to-white/[0.04] backdrop-blur-md",
        "dark:border-white/[0.09] dark:from-white/[0.08] dark:to-white/[0.02]"
      )}
    >
      <span
        className={cn(
          "h-2 w-2 shrink-0 animate-pulse rounded-full ring-2 ring-white/35 dark:ring-black/25",
          dot,
          glow
        )}
        aria-hidden
      />
      <span className="max-w-[11rem] truncate text-[11px] font-medium leading-tight text-slate-800 dark:text-slate-100/95">
        {state ? (
          <>
            Nova&apos;s <span className="capitalize text-slate-600 dark:text-slate-300/95">{state.label}</span>
          </>
        ) : (
          <span className="text-muted">Mood unavailable</span>
        )}
      </span>
    </div>
  );
}
