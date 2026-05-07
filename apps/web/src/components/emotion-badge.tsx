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

/**
 * Stored token `"neutral"` is shown to users as **"Calm"** ("neutral" reads like a settings
 * dropdown, not a mood). The token itself stays unchanged so existing rows / IDs / styling
 * switches keep working.
 */
function humanizeMoodLabel(label: string): string {
  return label === "neutral" ? "calm" : label;
}

function capitalizeFirst(value: string): string {
  return value.length === 0 ? value : `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function moodAccent(label: string): { dot: string; glow: string } {
  switch (label) {
    case "joyful":
      return { dot: "bg-emerald-400", glow: "shadow-[0_0_12px_rgba(52,211,153,0.45)]" };
    case "curious":
      return { dot: "bg-amber-300", glow: "shadow-[0_0_12px_rgba(253,224,71,0.45)]" };
    case "empathetic":
      return { dot: "bg-fuchsia-400", glow: "shadow-[0_0_12px_rgba(232,121,249,0.4)]" };
    case "loving":
      return { dot: "bg-pink-400", glow: "shadow-[0_0_12px_rgba(244,114,182,0.45)]" };
    case "sad":
      return { dot: "bg-violet-500", glow: "shadow-[0_0_12px_rgba(139,92,246,0.45)]" };
    case "angry":
      return { dot: "bg-red-500", glow: "shadow-[0_0_14px_rgba(248,113,113,0.55)]" };
    case "frustrated":
      return { dot: "bg-rose-400", glow: "shadow-[0_0_12px_rgba(251,113,133,0.4)]" };
    case "anxious":
      return { dot: "bg-purple-400", glow: "shadow-[0_0_12px_rgba(192,132,252,0.4)]" };
    case "guilty":
      return { dot: "bg-orange-400", glow: "shadow-[0_0_12px_rgba(251,146,60,0.35)]" };
    default:
      return { dot: "bg-slate-400", glow: "shadow-[0_0_8px_rgba(148,163,184,0.35)]" };
  }
}

/** Subtle pill fill + border tint keyed to mood (still readable on light/dark). */
function moodChrome(label: string): { bg: string; border: string } {
  switch (label) {
    case "joyful":
      return {
        bg: "from-emerald-500/22 via-emerald-400/10 to-white/[0.06] dark:from-emerald-500/25 dark:via-emerald-400/12 dark:to-white/[0.04]",
        border: "border-emerald-400/30 dark:border-emerald-400/22"
      };
    case "curious":
      return {
        bg: "from-amber-400/24 via-yellow-300/12 to-white/[0.06] dark:from-amber-500/22 dark:via-yellow-400/10 dark:to-white/[0.04]",
        border: "border-amber-300/35 dark:border-amber-400/25"
      };
    case "empathetic":
      return {
        bg: "from-fuchsia-500/22 via-pink-400/10 to-white/[0.06] dark:from-fuchsia-500/25 dark:via-pink-400/12 dark:to-white/[0.04]",
        border: "border-fuchsia-400/30 dark:border-fuchsia-400/22"
      };
    case "loving":
      return {
        bg: "from-pink-500/24 via-rose-300/12 to-white/[0.06] dark:from-pink-500/26 dark:via-rose-400/12 dark:to-white/[0.04]",
        border: "border-pink-400/35 dark:border-pink-400/24"
      };
    case "sad":
      return {
        bg: "from-violet-600/24 via-purple-500/12 to-white/[0.06] dark:from-violet-600/26 dark:via-purple-500/12 dark:to-white/[0.04]",
        border: "border-violet-500/30 dark:border-violet-400/22"
      };
    case "angry":
      return {
        bg: "from-red-600/26 via-rose-500/14 to-white/[0.06] dark:from-red-600/28 dark:via-rose-500/14 dark:to-white/[0.04]",
        border: "border-red-500/35 dark:border-red-400/28"
      };
    case "frustrated":
      return {
        bg: "from-rose-500/22 via-rose-400/10 to-white/[0.06] dark:from-rose-500/25 dark:via-rose-400/12 dark:to-white/[0.04]",
        border: "border-rose-400/30 dark:border-rose-400/22"
      };
    case "anxious":
      return {
        bg: "from-purple-500/22 via-violet-400/10 to-white/[0.06] dark:from-purple-500/25 dark:via-violet-400/12 dark:to-white/[0.04]",
        border: "border-purple-400/30 dark:border-purple-400/22"
      };
    case "guilty":
      return {
        bg: "from-orange-500/22 via-orange-400/10 to-white/[0.06] dark:from-orange-500/25 dark:via-orange-400/12 dark:to-white/[0.04]",
        border: "border-orange-400/30 dark:border-orange-400/22"
      };
    default:
      return {
        bg: "from-sky-400/16 via-slate-400/6 to-white/[0.06] dark:from-sky-500/18 dark:via-slate-500/8 dark:to-white/[0.03]",
        border: "border-sky-300/28 dark:border-white/[0.1]"
      };
  }
}

export function EmotionBadge({ userId = WEB_CHAT_EMOTION_USER_ID }: { userId?: string }) {
  const [state, setState] = useState<EmotionState | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const response = await fetch(`/api/emotion/state?userId=${encodeURIComponent(userId)}`, {
        credentials: "include"
      });
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
  const chrome = useMemo(() => moodChrome(label), [label]);

  const displayLabel = state ? capitalizeFirst(humanizeMoodLabel(state.label)) : "";

  return (
    <div
      title={
        state
          ? `Nova is ${humanizeMoodLabel(state.label)} (valence=${state.valence.toFixed(2)}, arousal=${state.arousal.toFixed(2)}) · one mood for all channels & users`
          : "Nova emotional state unavailable (enable emotion core in Settings)"
      }
      className={cn(
        "inline-flex items-center gap-2 rounded-full border bg-gradient-to-r px-2.5 py-1 backdrop-blur-md",
        chrome.bg,
        chrome.border
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
      <span className="max-w-[11rem] truncate text-[11px] font-medium leading-tight text-slate-800 dark:text-slate-100">
        {state ? <>Nova&apos;s {displayLabel}</> : <span className="text-muted">Mood unavailable</span>}
      </span>
    </div>
  );
}
