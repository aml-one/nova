/* eslint-disable react/no-unescaped-entities */
"use client";

import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import {
  FaBrain,
  FaCheck,
  FaCopy,
  FaFloppyDisk,
  FaPenToSquare,
  FaPlus,
  FaRotateRight,
  FaStop,
  FaTrash,
  FaDownload,
  FaVolumeHigh,
  FaXmark
} from "react-icons/fa6";
import { Card } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/cn";
import { dispatchNovaEmotionRefresh } from "../lib/emotion-user";
import { ChatMarkdown } from "../components/chat-markdown";
import { triggerBlobDownload } from "../lib/audio-download";
import { loadAudioElementThenPlay } from "../lib/audio-play";
import { shouldUseNovaIdentityBufferedChat } from "../lib/nova-identity-chat";

type MediaItem = {
  url: string;
  kind: "image" | "video";
  posterUrl?: string;
  name?: string;
};

type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  text: string;
  attachments?: MediaItem[];
  thinkingText?: string;
  thinkingCollapsed?: boolean;
  stats?: {
    tokensPerSecond: number;
    elapsedMs: number;
    tokenCount: number;
    firstTokenMs?: number;
    provider?: string;
    model?: string;
    hideProviderModel?: boolean;
    providerTps?: number;
  };
  isPending?: boolean;
};

type StreamPhase = "thinking" | "reasoning" | "web-search";

type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  turns: ChatTurn[];
};
type PendingUpload = {
  id: string;
  file: File;
  progress: number;
  status: "queued" | "uploading" | "done" | "failed";
  previewUrl?: string;
  uploaded?: MediaItem;
  error?: string;
};

function stripMarkdownForTts(raw: string): string {
  let visible = raw;
  for (const pattern of [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<reasoning>([\s\S]*?)<\/reasoning>/gi,
    /<think>([\s\S]*?)<\/redacted_thinking>/gi
  ]) {
    visible = visible.replace(pattern, () => "");
  }
  visible = visible.trim();
  visible = visible.replace(/```[\s\S]*?```/g, " ");
  /** Keep inner speech; strip only Nova chat tone wrappers (was deleting wrapped sentences entirely). */
  visible = visible.replace(/\[nova:[^\]]+\]([\s\S]*?)\[\/nova\]/gi, "$1");
  visible = visible.replace(/\[\/nova\]/gi, " ");
  visible = visible.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  visible = visible.replace(/[\uFEFF\u200B-\u200D]/g, "");
  visible = visible.replace(/[\u2013\u2014]/g, ", ");
  visible = visible.replace(/[#*_>`]+/g, " ");
  visible = visible.replace(/\s+/g, " ").trim();
  return visible.slice(0, 8000);
}

export default function HomePage() {
  const { resolvedTheme } = useTheme();
  const [message, setMessage] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string>("");
  const [uploads, setUploads] = useState<PendingUpload[]>([]);
  const [loading, setLoading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [lightbox, setLightbox] = useState<{ items: MediaItem[]; index: number } | null>(null);
  const [showThinkingInChat, setShowThinkingInChat] = useState(true);
  const [liveThinkingCollapsed, setLiveThinkingCollapsed] = useState(false);
  const [liveThinking, setLiveThinking] = useState("Analyzing your request...");
  const [hideProviderModelInStats, setHideProviderModelInStats] = useState(false);
  const [chatStyleReady, setChatStyleReady] = useState(false);
  const [chatStyle, setChatStyle] = useState({
    userBubbleColor: "#dbeafe",
    assistantBubbleColor: "#e9d5ff",
    userTextColor: "#0f172a",
    assistantTextColor: "#0f172a",
    userActionIconColor: "#475569",
    assistantActionIconColor: "#475569",
    statsTextColor: "#64748b",
    userBubbleColorLight: "#dbeafe",
    assistantBubbleColorLight: "#f5f3ff",
    userTextColorLight: "#0f172a",
    assistantTextColorLight: "#0f172a",
    userActionIconColorLight: "#475569",
    assistantActionIconColorLight: "#475569",
    statsTextColorLight: "#475569",
    bubbleBackgroundEnabled: true,
    borderColor: "#94a3b8",
    borderThicknessPx: 1,
    userBorderThicknessPx: 1,
    assistantBorderThicknessPx: 1,
    userBackgroundOpacityPct: 100,
    assistantBackgroundOpacityPct: 100,
    bubbleRadiusPx: 16,
    showNames: true
  });
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [sendOnEnter, setSendOnEnter] = useState(false);
  const [readAloudMessages, setReadAloudMessages] = useState(false);
  const readAloudRef = useRef(readAloudMessages);
  const [ttsPlayingTurnId, setTtsPlayingTurnId] = useState<string | null>(null);
  const [ttsGeneratingTurnId, setTtsGeneratingTurnId] = useState<string | null>(null);
  const chatTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  const chatTtsObjectUrlRef = useRef<string | null>(null);
  const chatTtsFetchAbortRef = useRef<AbortController | null>(null);
  /** Last synthesized clip per turn (same payload as speak-audio) for download without re-fetch when possible. */
  const chatTtsBlobCacheRef = useRef<Map<string, { blob: Blob; mime: string }>>(new Map());
  const [streamPhase, setStreamPhase] = useState<StreamPhase>("thinking");
  const webSearchDepthRef = useRef(0);
  const lastStreamRawRef = useRef("");
  const streamAbortRef = useRef<AbortController | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [lastCopiedTurnId, setLastCopiedTurnId] = useState<string | null>(null);
  const [sessionDeleteConfirmOpen, setSessionDeleteConfirmOpen] = useState(false);
  const sessionDeletePopoverRef = useRef<HTMLDivElement | null>(null);
  const hasLoadedSessionsRef = useRef(false);
  const hasDoneInitialBottomScrollRef = useRef(false);
  const uploadPreviewUrlsRef = useRef<Map<string, string>>(new Map());
  const compactActionClass = "inline-flex h-9 min-w-9 items-center justify-center px-2";
  const bubbleIconActionClass =
    "inline-flex h-7 w-7 items-center justify-center transition-[filter] hover:brightness-110";
  const isDarkTheme = resolvedTheme !== "light";
  const userBubbleColorForTheme = isDarkTheme ? chatStyle.userBubbleColor : chatStyle.userBubbleColorLight;
  const assistantBubbleColorForTheme = isDarkTheme ? chatStyle.assistantBubbleColor : chatStyle.assistantBubbleColorLight;
  const userTextColorForTheme = isDarkTheme ? chatStyle.userTextColor : chatStyle.userTextColorLight;
  const assistantTextColorForTheme = isDarkTheme ? chatStyle.assistantTextColor : chatStyle.assistantTextColorLight;
  const userActionIconColorForTheme = isDarkTheme ? chatStyle.userActionIconColor : chatStyle.userActionIconColorLight;
  const assistantActionIconColorForTheme = isDarkTheme
    ? chatStyle.assistantActionIconColor
    : chatStyle.assistantActionIconColorLight;
  const statsTextColorForTheme = isDarkTheme ? chatStyle.statsTextColor : chatStyle.statsTextColorLight;

  const uploadedMedia = useMemo(
    () =>
      uploads
        .filter((item) => item.status === "done" && item.uploaded)
        .map((item) => item.uploaded as MediaItem),
    [uploads]
  );

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (!lightbox) return;
      if (event.key === "Escape") {
        setLightbox(null);
        return;
      }
      if (event.key === "ArrowRight") {
        setLightbox((prev) => (prev ? { ...prev, index: (prev.index + 1) % prev.items.length } : prev));
      }
      if (event.key === "ArrowLeft") {
        setLightbox((prev) =>
          prev
            ? { ...prev, index: (prev.index - 1 + prev.items.length) % prev.items.length }
            : prev
        );
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [lightbox]);

  useEffect(() => {
    setSessionDeleteConfirmOpen(false);
  }, [activeSessionId]);

  useEffect(() => {
    if (!sessionDeleteConfirmOpen) return;
    function onPointerDown(event: MouseEvent): void {
      const el = sessionDeletePopoverRef.current;
      if (el && !el.contains(event.target as Node)) {
        setSessionDeleteConfirmOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setSessionDeleteConfirmOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [sessionDeleteConfirmOpen]);

  useEffect(() => {
    if (!loading) return;
    let active = true;
    const loadThought = async () => {
      const response = await fetch("/api/thoughts?limit=8");
      const data = (await response.json()) as {
        items?: Array<{ title?: string; content?: string; category?: string }>;
      };
      if (!active || !response.ok) return;
      const latest = data.items?.[0];
      if (latest?.title || latest?.content) {
        setLiveThinking(`${latest.title ?? "Thinking"}\n${latest.content ?? ""}`.trim());
      }
    };
    void loadThought();
    const timer = setInterval(() => void loadThought(), 1200);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [loading]);

  useEffect(() => {
    void (async () => {
      try {
        const response = await fetch("/api/settings");
        const data = (await response.json()) as {
          settings?: {
            web?: {
              hideProviderModelInStats?: boolean;
              sendOnEnter?: boolean;
              chatStyle?: {
                userBubbleColor?: string;
                assistantBubbleColor?: string;
                userTextColor?: string;
                assistantTextColor?: string;
                userActionIconColor?: string;
                assistantActionIconColor?: string;
                statsTextColor?: string;
                userBubbleColorLight?: string;
                assistantBubbleColorLight?: string;
                userTextColorLight?: string;
                assistantTextColorLight?: string;
                userActionIconColorLight?: string;
                assistantActionIconColorLight?: string;
                statsTextColorLight?: string;
                bubbleBackgroundEnabled?: boolean;
                borderColor?: string;
                borderThicknessPx?: number;
                userBorderThicknessPx?: number;
                assistantBorderThicknessPx?: number;
                userBackgroundOpacityPct?: number;
                assistantBackgroundOpacityPct?: number;
                bubbleRadiusPx?: number;
                showNames?: boolean;
              };
            };
          };
        };
        if (response.ok) {
          setHideProviderModelInStats(data.settings?.web?.hideProviderModelInStats === true);
          setSendOnEnter(data.settings?.web?.sendOnEnter === true);
          setChatStyle((prev) => ({
            userBubbleColor: data.settings?.web?.chatStyle?.userBubbleColor ?? prev.userBubbleColor,
            assistantBubbleColor: data.settings?.web?.chatStyle?.assistantBubbleColor ?? prev.assistantBubbleColor,
            userTextColor: data.settings?.web?.chatStyle?.userTextColor ?? prev.userTextColor,
            assistantTextColor: data.settings?.web?.chatStyle?.assistantTextColor ?? prev.assistantTextColor,
            userActionIconColor: data.settings?.web?.chatStyle?.userActionIconColor ?? prev.userActionIconColor,
            assistantActionIconColor:
              data.settings?.web?.chatStyle?.assistantActionIconColor ?? prev.assistantActionIconColor,
            statsTextColor: data.settings?.web?.chatStyle?.statsTextColor ?? prev.statsTextColor,
            userBubbleColorLight: data.settings?.web?.chatStyle?.userBubbleColorLight ?? prev.userBubbleColorLight,
            assistantBubbleColorLight:
              data.settings?.web?.chatStyle?.assistantBubbleColorLight ?? prev.assistantBubbleColorLight,
            userTextColorLight: data.settings?.web?.chatStyle?.userTextColorLight ?? prev.userTextColorLight,
            assistantTextColorLight:
              data.settings?.web?.chatStyle?.assistantTextColorLight ?? prev.assistantTextColorLight,
            userActionIconColorLight:
              data.settings?.web?.chatStyle?.userActionIconColorLight ?? prev.userActionIconColorLight,
            assistantActionIconColorLight:
              data.settings?.web?.chatStyle?.assistantActionIconColorLight ?? prev.assistantActionIconColorLight,
            statsTextColorLight: data.settings?.web?.chatStyle?.statsTextColorLight ?? prev.statsTextColorLight,
            bubbleBackgroundEnabled: data.settings?.web?.chatStyle?.bubbleBackgroundEnabled ?? prev.bubbleBackgroundEnabled,
            borderColor: data.settings?.web?.chatStyle?.borderColor ?? prev.borderColor,
            borderThicknessPx: data.settings?.web?.chatStyle?.borderThicknessPx ?? prev.borderThicknessPx,
            userBorderThicknessPx:
              data.settings?.web?.chatStyle?.userBorderThicknessPx ??
              data.settings?.web?.chatStyle?.borderThicknessPx ??
              prev.userBorderThicknessPx,
            assistantBorderThicknessPx:
              data.settings?.web?.chatStyle?.assistantBorderThicknessPx ??
              data.settings?.web?.chatStyle?.borderThicknessPx ??
              prev.assistantBorderThicknessPx,
            userBackgroundOpacityPct:
              data.settings?.web?.chatStyle?.userBackgroundOpacityPct ??
              ((data.settings?.web?.chatStyle?.bubbleBackgroundEnabled ?? prev.bubbleBackgroundEnabled) ? 100 : 0),
            assistantBackgroundOpacityPct:
              data.settings?.web?.chatStyle?.assistantBackgroundOpacityPct ??
              ((data.settings?.web?.chatStyle?.bubbleBackgroundEnabled ?? prev.bubbleBackgroundEnabled) ? 100 : 0),
            bubbleRadiusPx: data.settings?.web?.chatStyle?.bubbleRadiusPx ?? prev.bubbleRadiusPx,
            showNames: data.settings?.web?.chatStyle?.showNames ?? prev.showNames
          }));
        }
      } finally {
        setChatStyleReady(true);
      }
    })();
  }, []);

  useEffect(() => {
    if (hasLoadedSessionsRef.current) return;
    hasLoadedSessionsRef.current = true;
    try {
      const raw = localStorage.getItem("nova.chat.sessions.v1");
      const parsed = raw ? (JSON.parse(raw) as ChatSession[]) : [];
      if (parsed.length > 0) {
        setSessions(parsed);
        setActiveSessionId(parsed[0].id);
        setTurns(parsed[0].turns ?? []);
      } else {
        const initial = createEmptySession();
        setSessions([initial]);
        setActiveSessionId(initial.id);
      }
    } catch {
      const initial = createEmptySession();
      setSessions([initial]);
      setActiveSessionId(initial.id);
    }
  }, []);

  useEffect(() => {
    if (!hasLoadedSessionsRef.current || !activeSessionId) return;
    const nextTitle = buildSessionTitle(turns);
    setSessions((prev) => {
      let changed = false;
      const next = prev.map((session) => {
        if (session.id !== activeSessionId) {
          return session;
        }
        const sameTurns = equalTurns(session.turns ?? [], turns);
        const sameTitle = session.title === nextTitle;
        if (sameTurns && sameTitle) {
          return session;
        }
        changed = true;
        return {
          ...session,
          turns: turns.map((turn) => ({ ...turn })),
          title: nextTitle,
          updatedAt: new Date().toISOString()
        };
      });
      return changed ? next : prev;
    });
  }, [turns, activeSessionId]);

  useEffect(() => {
    if (!hasLoadedSessionsRef.current) return;
    localStorage.setItem("nova.chat.sessions.v1", JSON.stringify(sessions));
  }, [sessions]);

  useLayoutEffect(() => {
    const container = chatScrollRef.current;
    if (!container || !autoScrollEnabled) return;
    container.scrollTo({
      top: container.scrollHeight,
      behavior: loading ? "auto" : "smooth"
    });
  }, [turns, liveThinking, loading, autoScrollEnabled]);

  useEffect(() => {
    if (!chatStyleReady) return;
    if (!hasLoadedSessionsRef.current) return;
    if (hasDoneInitialBottomScrollRef.current) return;
    const container = chatScrollRef.current;
    if (!container) return;
    hasDoneInitialBottomScrollRef.current = true;
    setAutoScrollEnabled(true);
    requestAnimationFrame(() => {
      container.scrollTo({ top: container.scrollHeight, behavior: "auto" });
    });
  }, [chatStyleReady, turns.length, activeSessionId]);

  useEffect(() => {
    const nextMap = new Map<string, string>();
    for (const item of uploads) {
      if (item.previewUrl) {
        nextMap.set(item.id, item.previewUrl);
      }
    }
    for (const [id, url] of uploadPreviewUrlsRef.current.entries()) {
      if (!nextMap.has(id)) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke failures.
        }
      }
    }
    uploadPreviewUrlsRef.current = nextMap;
  }, [uploads]);

  useEffect(() => {
    return () => {
      for (const url of uploadPreviewUrlsRef.current.values()) {
        try {
          URL.revokeObjectURL(url);
        } catch {
          // Ignore revoke failures.
        }
      }
      uploadPreviewUrlsRef.current.clear();
    };
  }, []);

  useEffect(() => {
    readAloudRef.current = readAloudMessages;
  }, [readAloudMessages]);

  useEffect(() => {
    try {
      const v = window.localStorage.getItem("nova-chat-read-aloud");
      if (v === "1") {
        setReadAloudMessages(true);
      }
    } catch {
      // Ignore storage failures.
    }
  }, []);

  const stopChatTtsPlayback = useCallback(() => {
    chatTtsFetchAbortRef.current?.abort();
    chatTtsFetchAbortRef.current = null;
    const el = chatTtsAudioRef.current;
    if (el) {
      el.pause();
      el.removeAttribute("src");
      void el.load();
    }
    if (chatTtsObjectUrlRef.current) {
      URL.revokeObjectURL(chatTtsObjectUrlRef.current);
      chatTtsObjectUrlRef.current = null;
    }
    setTtsPlayingTurnId(null);
    setTtsGeneratingTurnId(null);
  }, []);

  useEffect(() => () => stopChatTtsPlayback(), [stopChatTtsPlayback]);

  useEffect(() => {
    stopChatTtsPlayback();
    chatTtsBlobCacheRef.current.clear();
  }, [activeSessionId, stopChatTtsPlayback]);

  const playChatTts = useCallback(
    async (turnId: string, rawText: string): Promise<void> => {
      const cleaned = stripMarkdownForTts(rawText);
      if (!cleaned.trim()) {
        return;
      }
      stopChatTtsPlayback();
      const ac = new AbortController();
      chatTtsFetchAbortRef.current = ac;
      setTtsGeneratingTurnId(turnId);
      try {
        const response = await fetch("/api/voice/speak-audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text: cleaned }),
          signal: ac.signal
        });
        if (!response.ok) {
          setTtsGeneratingTurnId(null);
          return;
        }
        const blob = await response.blob();
        const mime = response.headers.get("content-type") ?? "audio/wav";
        chatTtsBlobCacheRef.current.set(turnId, { blob: blob.slice(), mime });
        const url = URL.createObjectURL(blob);
        chatTtsObjectUrlRef.current = url;
        const el = chatTtsAudioRef.current;
        if (!el) {
          URL.revokeObjectURL(url);
          chatTtsObjectUrlRef.current = null;
          setTtsGeneratingTurnId(null);
          return;
        }
        el.src = url;
        setTtsGeneratingTurnId(null);
        setTtsPlayingTurnId(turnId);
        el.onended = () => {
          stopChatTtsPlayback();
        };
        el.onerror = () => {
          stopChatTtsPlayback();
        };
        await loadAudioElementThenPlay(el).catch(() => stopChatTtsPlayback());
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          stopChatTtsPlayback();
        } else {
          setTtsGeneratingTurnId(null);
        }
      } finally {
        if (chatTtsFetchAbortRef.current === ac) {
          chatTtsFetchAbortRef.current = null;
        }
      }
    },
    [stopChatTtsPlayback]
  );

  const downloadChatTtsForTurn = useCallback(async (turnId: string, rawText: string): Promise<void> => {
    const cleaned = stripMarkdownForTts(rawText);
    if (!cleaned.trim()) return;
    const cached = chatTtsBlobCacheRef.current.get(turnId);
    let blob: Blob;
    let mime: string;
    if (cached) {
      blob = cached.blob;
      mime = cached.mime;
    } else {
      const response = await fetch("/api/voice/speak-audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: cleaned })
      });
      if (!response.ok) return;
      blob = await response.blob();
      mime = response.headers.get("content-type") ?? "audio/wav";
      chatTtsBlobCacheRef.current.set(turnId, { blob: blob.slice(), mime });
    }
    triggerBlobDownload(blob, mime, `nova-chat-${turnId.slice(0, 12)}`);
  }, []);

  function stopGeneration(): void {
    streamAbortRef.current?.abort();
    stopChatTtsPlayback();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    const streamAbort = new AbortController();
    streamAbortRef.current = streamAbort;
    const readyUploads = await ensureUploads(streamAbort.signal);
    const attachmentLines = readyUploads.length
      ? `\n\nAttached media:\n${readyUploads.map((item) => `- ${item.kind}: ${item.url}`).join("\n")}`
      : "";
    const composedMessage = `${trimmed}${attachmentLines}`;
    const userTurn: ChatTurn = { id: randomId(), role: "user", text: trimmed, attachments: readyUploads, isPending: true };
    setTurns((prev) => [...prev, userTurn]);
    setMessage("");
    setLoading(true);
    setLiveThinking("Planning response...");
    webSearchDepthRef.current = 0;
    lastStreamRawRef.current = "";
    setStreamPhase("thinking");
    const assistantId = randomId();
    setTurns((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        text: "",
        thinkingCollapsed: false
      }
    ]);
    if (streamAbort.signal.aborted) {
      setTurns((prev) => prev.filter((t) => t.id !== userTurn.id && t.id !== assistantId));
      setLoading(false);
      streamAbortRef.current = null;
      return;
    }
    try {
      const visionImageUrl = toAgentVisionImageUrl(readyUploads.find((item) => item.kind === "image")?.url);
      const identityBufferedChat = shouldUseNovaIdentityBufferedChat(trimmed);

      if (identityBufferedChat) {
        const startedAt = Date.now();
        setStreamPhase("thinking");
        dispatchNovaEmotionRefresh();
        const buffered = await fetchNovaBufferedChatReply({
          composedMessage,
          imageUrl: visionImageUrl,
          signal: streamAbort.signal
        });
        if (!buffered.ok) {
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === assistantId
                ? { ...turn, text: `Error: ${buffered.error}`, thinkingText: undefined }
                : turn.id === userTurn.id
                  ? { ...turn, isPending: false }
                  : turn
            )
          );
          return;
        }
        dispatchNovaEmotionRefresh();
        lastStreamRawRef.current = buffered.reply;
        const { visible, thinking } = extractThinking({ text: buffered.reply });
        const elapsedMs = Math.max(1, Date.now() - startedAt);
        const tokenCount = estimateTokens(visible);
        const tokensPerSecond = Number(((tokenCount * 1000) / elapsedMs).toFixed(1));
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? {
                  ...turn,
                  text: visible,
                  attachments: extractMediaFromText(visible),
                  thinkingText: thinking || undefined,
                  stats: {
                    tokenCount,
                    elapsedMs,
                    tokensPerSecond,
                    hideProviderModel: hideProviderModelInStats
                  }
                }
              : turn
          )
        );
        setTurns((prev) => prev.map((turn) => (turn.id === userTurn.id ? { ...turn, isPending: false } : turn)));
        setUploads([]);
        dispatchNovaEmotionRefresh();
        if (
          readAloudRef.current &&
          visible.trim().length > 0 &&
          !visible.includes("_Stopped._") &&
          !/\/Stopped\./i.test(visible)
        ) {
          void playChatTts(assistantId, visible);
        }
      } else {
        const startedAt = Date.now();
        let emotionRefreshedOnFirstToken = false;
        const response = await fetch("/api/chat/stream", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            message: composedMessage,
            imageUrl: visionImageUrl
          }),
          signal: streamAbort.signal
        });
        if (!response.ok || !response.body) {
          const data = (await response.json().catch(() => ({}))) as { error?: string };
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === assistantId
                ? { ...turn, text: `Error: ${data.error ?? "Request failed"}`, thinkingText: undefined }
                : turn.id === userTurn.id
                  ? { ...turn, isPending: false }
                  : turn
            )
          );
          return;
        }
        /** Coalesce burst token events (many `data:` lines per chunk) into one React update per macrotask — avoids maximum update depth. */
        let streamPartialFlushQueued = false;
        let pendingStreamPartialText = "";
        const applyStreamPartialNow = (partialText: string): void => {
          if (!emotionRefreshedOnFirstToken && partialText.trim().length > 0) {
            emotionRefreshedOnFirstToken = true;
            dispatchNovaEmotionRefresh();
          }
          lastStreamRawRef.current = partialText;
          let nextPhase: StreamPhase = "thinking";
          if (webSearchDepthRef.current > 0) {
            nextPhase = "web-search";
          } else if (isInsideReasoningStream(partialText)) {
            nextPhase = "reasoning";
          }
          setStreamPhase((prev) => (prev === nextPhase ? prev : nextPhase));
          const { visible, thinking } = extractThinking({ text: partialText });
          setTurns((prev) =>
            prev.map((turn) =>
              turn.id === assistantId
                ? {
                    ...turn,
                    text: visible,
                    attachments: extractMediaFromText(visible),
                    thinkingText: thinking || undefined
                  }
                : turn
            )
          );
        };

        const streamResult = await readSseStream(
          response.body,
          streamAbort.signal,
          (partialText) => {
            pendingStreamPartialText = partialText;
            if (!streamPartialFlushQueued) {
              streamPartialFlushQueued = true;
              queueMicrotask(() => {
                streamPartialFlushQueued = false;
                applyStreamPartialNow(pendingStreamPartialText);
              });
            }
          },
          (evt) => {
            if (evt.kind !== "web-search") return;
            if (evt.phase === "start") {
              webSearchDepthRef.current += 1;
              setStreamPhase((prev) => (prev === "web-search" ? prev : "web-search"));
            } else {
              webSearchDepthRef.current = Math.max(0, webSearchDepthRef.current - 1);
              if (webSearchDepthRef.current === 0) {
                const raw = lastStreamRawRef.current;
                const next = isInsideReasoningStream(raw) ? "reasoning" : "thinking";
                setStreamPhase((prev) => (prev === next ? prev : next));
              }
            }
          }
        );
        const { visible, thinking, firstTokenMs, provider, model: modelName, hideProviderModel, providerTps } =
          extractThinking(streamResult);
        const elapsedMs = Math.max(1, Date.now() - startedAt);
        const tokenCount = estimateTokens(visible);
        const tokensPerSecond = Number(((tokenCount * 1000) / elapsedMs).toFixed(1));
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? {
                  ...turn,
                  text: visible,
                  attachments: extractMediaFromText(visible),
                  thinkingText: thinking || undefined,
                  stats: {
                    tokenCount,
                    elapsedMs,
                    tokensPerSecond,
                    firstTokenMs,
                    provider,
                    model: modelName,
                    hideProviderModel: hideProviderModel || hideProviderModelInStats,
                    providerTps
                  }
                }
              : turn
          )
        );
        setTurns((prev) => prev.map((turn) => (turn.id === userTurn.id ? { ...turn, isPending: false } : turn)));
        setUploads([]);
        dispatchNovaEmotionRefresh();
        if (
          readAloudRef.current &&
          visible.trim().length > 0 &&
          !visible.includes("_Stopped._") &&
          !/\/Stopped\./i.test(visible)
        ) {
          void playChatTts(assistantId, visible);
        }
      }
    } catch (error) {
      const aborted =
        (error instanceof DOMException && error.name === "AbortError") ||
        (error instanceof Error &&
          (error.name === "AbortError" || /aborted a request|AbortError/i.test(error.message)));
      if (aborted) {
        const { visible, thinking } = extractThinking({ text: lastStreamRawRef.current });
        const base = visible.trim() || "(no text yet)";
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? {
                  ...turn,
                  text: `${base}\n\n_Stopped._`,
                  thinkingText: thinking?.trim() || undefined
                }
              : turn.id === userTurn.id
                ? { ...turn, isPending: false }
                : turn
          )
        );
      } else {
        const raw = error instanceof Error ? error.message : "Unknown error";
        const hint =
          /fetch failed|failed to fetch/i.test(raw)
            ? " Check that agent-core is running and NOVA_AGENT_API_URL matches where it listens."
            : "";
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? { ...turn, text: `Error: ${raw}${hint}`, thinkingText: undefined }
              : turn.id === userTurn.id
                ? { ...turn, isPending: false }
                : turn
          )
        );
      }
    } finally {
      setStreamPhase("thinking");
      setLoading(false);
      streamAbortRef.current = null;
    }
  }

  async function ensureUploads(signal?: AbortSignal): Promise<MediaItem[]> {
    const latestDone = uploads
      .map((item) => item.uploaded)
      .filter((item): item is MediaItem => Boolean(item));
    const queued = uploads.filter((item) => item.status === "queued" || item.status === "failed");
    if (!queued.length) return latestDone;
    const newlyUploaded: MediaItem[] = [];
    for (const item of queued) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      const uploaded = await uploadOne(item);
      if (uploaded) newlyUploaded.push(uploaded);
    }
    return [...latestDone, ...newlyUploaded];
  }

  async function uploadOne(target: PendingUpload): Promise<MediaItem | null> {
    setUploads((prev) =>
      prev.map((item) => (item.id === target.id ? { ...item, status: "uploading", progress: Math.max(item.progress, 5) } : item))
    );
    const pulse = setInterval(() => {
      setUploads((prev) =>
        prev.map((item) =>
          item.id === target.id && item.status === "uploading"
            ? { ...item, progress: Math.min(item.progress + 8, 92) }
            : item
        )
      );
    }, 140);
    try {
      const base64 = await fileToBase64(target.file);
      const response = await fetch("/api/media/upload", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filename: target.file.name, base64 })
      });
      const data = (await response.json()) as {
        url?: string;
        posterUrl?: string;
        kind?: "image" | "video" | "other";
        error?: string;
      };
      if (!response.ok || !data.url || (data.kind !== "image" && data.kind !== "video")) {
        throw new Error(data.error ?? "Upload failed");
      }
      const uploaded: MediaItem = {
        url: data.url,
        posterUrl: data.posterUrl || undefined,
        kind: data.kind,
        name: target.file.name
      };
      setUploads((prev) =>
        prev.map((item) => (item.id === target.id ? { ...item, status: "done", progress: 100, uploaded } : item))
      );
      return uploaded;
    } catch (error) {
      setUploads((prev) =>
        prev.map((item) =>
          item.id === target.id
            ? { ...item, status: "failed", error: error instanceof Error ? error.message : "Upload error" }
            : item
        )
      );
      return null;
    } finally {
      clearInterval(pulse);
    }
  }

  function addFiles(list: FileList | File[]): void {
    const files = Array.from(list).filter((file) => inferMediaKind(file.name));
    if (!files.length) return;
    const next = files.map<PendingUpload>((file) => ({
      id: `${file.name}-${file.size}-${Math.random().toString(16).slice(2)}`,
      file,
      progress: 0,
      status: "queued",
      previewUrl: URL.createObjectURL(file)
    }));
    setUploads((prev) => [...prev, ...next]);
  }

  function moveUpload(id: string, direction: -1 | 1): void {
    setUploads((prev) => {
      const index = prev.findIndex((item) => item.id === id);
      const target = index + direction;
      if (index < 0 || target < 0 || target >= prev.length) return prev;
      const copy = [...prev];
      const temp = copy[index];
      copy[index] = copy[target];
      copy[target] = temp;
      return copy;
    });
  }

  async function copyTurnText(value: string, turnId: string): Promise<void> {
    if (!value.trim()) return;
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
      } else {
        throw new Error("Clipboard API unavailable");
      }
    } catch {
      // Fallback for environments where navigator.clipboard is blocked/unavailable.
      try {
        const textarea = document.createElement("textarea");
        textarea.value = value;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        textarea.style.pointerEvents = "none";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      } catch {
        return;
      }
    }
    setLastCopiedTurnId(turnId);
    setTimeout(() => {
      setLastCopiedTurnId((prev) => (prev === turnId ? null : prev));
    }, 1200);
  }

  function deleteActiveSession(): void {
    if (!activeSessionId) return;
    const remaining = sessions.filter((item) => item.id !== activeSessionId);
    setSessionDeleteConfirmOpen(false);
    if (remaining.length === 0) {
      const fallback = createEmptySession();
      setSessions([fallback]);
      setActiveSessionId(fallback.id);
      setTurns([]);
      setMessage("");
      setUploads([]);
      return;
    }
    const nextActive = remaining[0];
    setSessions(remaining);
    setActiveSessionId(nextActive.id);
    setTurns(nextActive.turns ?? []);
    setMessage("");
    setUploads([]);
  }

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col gap-4">
      <Card className="flex h-full min-h-0 flex-1 flex-col overflow-hidden">
        <div className="mb-2 flex shrink-0 items-center justify-between">
          <h1 className="text-2xl font-semibold">Nova Chat</h1>
          <div className="flex items-center gap-1.5">
            <Select
              className="h-9 min-w-[260px] py-1 pl-2 pr-6 text-sm leading-normal"
              value={activeSessionId}
              onChange={(event) => {
                const sessionId = event.target.value;
                const session = sessions.find((item) => item.id === sessionId);
                if (!session) return;
                setActiveSessionId(session.id);
                setTurns(session.turns ?? []);
              }}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  {session.title}
                </option>
              ))}
            </Select>
            <Button
              type="button"
              tone="green"
              className="inline-flex h-8 min-w-8 items-center justify-center px-2"
              onClick={() => {
                setSessionDeleteConfirmOpen(false);
                const next = createEmptySession();
                setSessions((prev) => [next, ...prev]);
                setActiveSessionId(next.id);
                setTurns([]);
                setMessage("");
                setUploads([]);
              }}
              title="Start new session"
            >
              <FaPlus className="h-5 w-5" />
            </Button>
            <Button
              type="button"
              tone="neutral"
              className="inline-flex h-8 min-w-8 items-center justify-center px-2"
              onClick={() => {
                setSessionDeleteConfirmOpen(false);
                const active = sessions.find((item) => item.id === activeSessionId);
                if (!active) return;
                const next = window.prompt("Rename session", active.title)?.trim();
                if (!next) return;
                setSessions((prev) => prev.map((item) => (item.id === activeSessionId ? { ...item, title: next } : item)));
              }}
              title="Rename active session"
            >
              <FaPenToSquare className="h-5 w-5" />
            </Button>
            <div ref={sessionDeletePopoverRef} className="relative">
              <Button
                type="button"
                tone="red"
                className="inline-flex h-8 min-w-8 items-center justify-center px-2"
                onClick={() => {
                  if (!activeSessionId) return;
                  setSessionDeleteConfirmOpen((open) => !open);
                }}
                title="Delete active session"
                aria-expanded={sessionDeleteConfirmOpen}
                aria-haspopup="dialog"
              >
                <FaTrash className="h-5 w-5" />
              </Button>
              {sessionDeleteConfirmOpen ? (
                <div
                  className="absolute right-0 top-full z-30 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-ui border border-rose-500/35 bg-surface2 p-3 shadow-lg ring-1 ring-black/10 dark:ring-white/10"
                  role="dialog"
                  aria-labelledby="session-delete-confirm-title"
                >
                  <p id="session-delete-confirm-title" className="mb-3 text-sm font-medium text-foreground">
                    Delete this session? This cannot be undone.
                  </p>
                  <div className="flex justify-end gap-2">
                    <Button type="button" tone="neutral" className="text-sm" onClick={() => setSessionDeleteConfirmOpen(false)}>
                      Cancel
                    </Button>
                    <Button type="button" tone="red" className="text-sm" onClick={() => deleteActiveSession()}>
                      Delete session
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
        <div
          ref={chatScrollRef}
          className="min-h-0 flex-1 space-y-2 overflow-y-auto overflow-x-hidden rounded-xl border bg-surface p-3"
          onScroll={(event) => {
            const target = event.currentTarget;
            const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
            const nearBottom = distanceFromBottom < 56;
            setAutoScrollEnabled(nearBottom);
          }}
        >
          {!chatStyleReady ? <div className="text-sm text-muted">Loading chat style…</div> : null}
          {chatStyleReady && turns.length === 0 ? <div className="text-sm text-muted">Start chatting with Nova.</div> : null}
          {chatStyleReady && turns.map((turn, index) => (
            <article
              key={turn.id}
              className={
                turn.role === "user"
                  ? "ml-auto w-fit min-w-[250px] max-w-[85%] border p-2.5"
                  : "mr-auto w-full border p-2.5"
              }
              style={
                turn.role === "user"
                  ? {
                      backgroundColor: chatStyle.bubbleBackgroundEnabled
                        ? withOpacity(userBubbleColorForTheme, chatStyle.userBackgroundOpacityPct)
                        : "transparent",
                      color: ensureReadableTextColor(userTextColorForTheme, isDarkTheme),
                      borderColor: chatStyle.borderColor,
                      borderWidth: `${chatStyle.userBorderThicknessPx}px`,
                      borderRadius: `${chatStyle.bubbleRadiusPx}px`
                    }
                  : {
                      backgroundColor: chatStyle.bubbleBackgroundEnabled
                        ? withOpacity(assistantBubbleColorForTheme, chatStyle.assistantBackgroundOpacityPct)
                        : "transparent",
                      color: ensureReadableTextColor(assistantTextColorForTheme, isDarkTheme),
                      borderColor: chatStyle.borderColor,
                      borderWidth: `${chatStyle.assistantBorderThicknessPx}px`,
                      borderRadius: `${chatStyle.bubbleRadiusPx}px`
                    }
              }
            >
              {chatStyle.showNames ? <div className="mb-1 text-xs font-semibold">{turn.role === "user" ? "You" : "Nova"}</div> : null}
              {editingTurnId === turn.id ? (
                <div className="space-y-2">
                  <Textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} rows={3} />
                </div>
              ) : (
                <div className="text-sm">
                  {turn.role === "assistant" &&
                  showThinkingInChat &&
                  loading &&
                  index === turns.length - 1 &&
                  !turn.text.trim() &&
                  !(turn.thinkingText?.trim()) ? (
                    <div className="space-y-2">
                      <div className="text-xs font-semibold text-muted">Nova is working</div>
                      {(
                        [
                          { phase: "thinking" as const, label: "Thinking" },
                          { phase: "reasoning" as const, label: "Reasoning" },
                          { phase: "web-search" as const, label: "Web search" }
                        ] as const
                      )
                        .filter(({ phase }) => streamPhase === phase)
                        .map(({ phase, label }) => (
                          <div
                            key={phase}
                            className={cn(
                              "flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all",
                              "nova-thinking-row-active border-blue-400/60 bg-blue-500/15"
                            )}
                          >
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full border nova-thinking-orb border-blue-300/80" />
                            <span className="text-xs font-medium">{label}</span>
                            <span className="flex items-center gap-1.5 pl-0.5">
                              <span className="h-1.5 w-1.5 rounded-full nova-thinking-dot-1 bg-blue-300" />
                              <span className="h-1.5 w-1.5 rounded-full nova-thinking-dot-2 bg-blue-300" />
                              <span className="h-1.5 w-1.5 rounded-full nova-thinking-dot-3 bg-blue-300" />
                            </span>
                          </div>
                        ))}
                      {!liveThinkingCollapsed ? (
                        <div className="rounded-ui border bg-surface p-2 text-[11px] text-muted">
                          <div className="mb-0.5 flex items-center justify-between">
                            <span className="font-semibold">Live log</span>
                            <button
                              type="button"
                              className="rounded-ui border bg-surface2 px-1.5 py-0.5 text-[10px]"
                              onClick={() => setLiveThinkingCollapsed((prev) => !prev)}
                            >
                              Hide
                            </button>
                          </div>
                          <div className="whitespace-pre-wrap">{liveThinking}</div>
                        </div>
                      ) : (
                        <button
                          type="button"
                          className="text-[11px] text-muted underline"
                          onClick={() => setLiveThinkingCollapsed(false)}
                        >
                          Show live log
                        </button>
                      )}
                    </div>
                  ) : (
                    <>
                      <ChatMarkdown
                        content={turn.text || (turn.role === "assistant" && loading ? "..." : "")}
                        toneSeed={
                          turn.role === "assistant"
                            ? {
                                textColor: ensureReadableTextColor(assistantTextColorForTheme, isDarkTheme),
                                bubbleBackground: chatStyle.bubbleBackgroundEnabled
                                  ? withOpacity(assistantBubbleColorForTheme, chatStyle.assistantBackgroundOpacityPct)
                                  : isDarkTheme
                                    ? "rgb(30, 41, 59)"
                                    : "rgb(248, 250, 252)",
                                variant: isDarkTheme ? "dark" : "light"
                              }
                            : undefined
                        }
                      />
                      {turn.role === "assistant" && ttsGeneratingTurnId === turn.id ? (
                        <div className="mt-2 space-y-1">
                          <div
                            className={cn(
                              "flex items-center gap-2 rounded-full border px-3 py-1.5 transition-all",
                              "border-amber-400/60 bg-amber-500/15"
                            )}
                          >
                            <span className="h-3.5 w-3.5 shrink-0 rounded-full border border-amber-300/80 nova-thinking-orb" />
                            <span className="text-xs font-medium text-amber-950 dark:text-amber-100">Generating audio…</span>
                            <span className="flex items-center gap-1.5 pl-0.5">
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 nova-thinking-dot-1" />
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 nova-thinking-dot-2" />
                              <span className="h-1.5 w-1.5 rounded-full bg-amber-400 nova-thinking-dot-3" />
                            </span>
                          </div>
                          <p className="text-[11px] text-muted">
                            Orpheus is synthesizing speech. WAV is the default for quickest playback in the browser; switch format under Settings → Voice if needed.
                          </p>
                        </div>
                      ) : null}
                    </>
                  )}
                </div>
              )}
              {turn.role === "user" ? (
                <div className="mt-2 flex items-center justify-between gap-2">
                  <button
                    type="button"
                    className={bubbleIconActionClass}
                    style={{ color: ensureReadableTextColor(userActionIconColorForTheme, isDarkTheme) }}
                    onClick={() => void copyTurnText(turn.text, turn.id)}
                    title="Copy message"
                  >
                    {lastCopiedTurnId === turn.id ? <FaCheck className="h-3.5 w-3.5 text-emerald-400" /> : <FaCopy className="h-3.5 w-3.5" />}
                  </button>
                  <div className="flex items-center gap-1.5">
                    <button
                      type="button"
                      className={bubbleIconActionClass}
                      style={{ color: ensureReadableTextColor(userActionIconColorForTheme, isDarkTheme) }}
                      onClick={() => {
                        setEditingTurnId(turn.id);
                        setEditingText(turn.text);
                      }}
                      title="Edit"
                    >
                      <FaPenToSquare className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      className={bubbleIconActionClass}
                      style={{ color: ensureReadableTextColor(userActionIconColorForTheme, isDarkTheme) }}
                      onClick={() => {
                        setMessage(turn.text);
                        requestAnimationFrame(() => {
                          const el = chatScrollRef.current;
                          if (el) {
                            el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
                          }
                        });
                      }}
                      title="Regenerate"
                    >
                      <FaRotateRight className="h-3.5 w-3.5" />
                    </button>
                    {editingTurnId === turn.id ? (
                      <>
                        <button
                          type="button"
                          className={bubbleIconActionClass}
                          style={{ color: ensureReadableTextColor(userActionIconColorForTheme, isDarkTheme) }}
                          onClick={() => {
                            const next = editingText.trim();
                            if (!next) return;
                            setTurns((prev) => prev.map((item) => (item.id === turn.id ? { ...item, text: next } : item)));
                            setMessage(next);
                            setEditingTurnId(null);
                          }}
                          title="Save"
                        >
                          <FaFloppyDisk className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          className={bubbleIconActionClass}
                          style={{ color: ensureReadableTextColor(userActionIconColorForTheme, isDarkTheme) }}
                          onClick={() => setEditingTurnId(null)}
                          title="Cancel"
                        >
                          <FaXmark className="h-3.5 w-3.5" />
                        </button>
                      </>
                    ) : null}
                  </div>
                </div>
              ) : null}
              {turn.role === "assistant" ? (
                <div className="mt-2 space-y-1.5">
                  <div className="-mx-0.5 overflow-x-auto overflow-y-visible pb-0.5 [scrollbar-width:thin]">
                    <div className="flex min-w-min flex-nowrap items-center gap-2 px-0.5">
                      <button
                        type="button"
                        className={bubbleIconActionClass}
                        style={{ color: ensureReadableTextColor(assistantActionIconColorForTheme, isDarkTheme) }}
                        onClick={() => void copyTurnText(turn.text, turn.id)}
                        title="Copy message"
                      >
                        {lastCopiedTurnId === turn.id ? (
                          <FaCheck className="h-3.5 w-3.5 text-emerald-400" />
                        ) : (
                          <FaCopy className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        className={bubbleIconActionClass}
                        style={{ color: ensureReadableTextColor(assistantActionIconColorForTheme, isDarkTheme) }}
                        disabled={
                          !turn.text.trim() ||
                          Boolean(loading && index === turns.length - 1 && turn.role === "assistant")
                        }
                        title={
                          ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id
                            ? "Stop audio"
                            : "Read aloud (Orpheus)"
                        }
                        aria-pressed={ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id}
                        onClick={() => {
                          if (ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id) {
                            stopChatTtsPlayback();
                          } else {
                            void playChatTts(turn.id, turn.text);
                          }
                        }}
                      >
                        {ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id ? (
                          <span className="inline-block h-3.5 w-3.5 shrink-0 rounded-[2px] bg-current" aria-hidden />
                        ) : (
                          <FaVolumeHigh className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        disabled={
                          !turn.text.trim() ||
                          Boolean(loading && index === turns.length - 1 && turn.role === "assistant") ||
                          ttsGeneratingTurnId === turn.id
                        }
                        title="Download synthesized audio (same as Read aloud)"
                        aria-label="Download synthesized audio"
                        onClick={() => void downloadChatTtsForTurn(turn.id, turn.text)}
                        className={cn(
                          "inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold shadow-sm transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-45",
                          "border-purple-400/55 bg-purple-500/20 text-purple-50 hover:bg-purple-500/30",
                          "dark:border-purple-400/45 dark:bg-purple-950/55 dark:text-purple-100 dark:hover:bg-purple-900/65"
                        )}
                      >
                        <FaDownload className="h-3.5 w-3.5 shrink-0" />
                        Save audio
                      </button>
                    </div>
                  </div>
                </div>
              ) : null}
              {turn.role === "assistant" && showThinkingInChat && turn.thinkingText ? (
                <div className="mt-2 rounded-ui border border-slate-500/60 bg-slate-200/60 p-1.5 text-xs text-slate-700 dark:bg-slate-700/45 dark:text-slate-200">
                  <button
                    type="button"
                    className="mb-1 rounded-ui border bg-surface2 px-1.5 py-0.5 text-xs"
                    onClick={() =>
                      setTurns((prev) =>
                        prev.map((item) =>
                          item.id === turn.id
                            ? { ...item, thinkingCollapsed: !item.thinkingCollapsed }
                            : item
                        )
                      )
                    }
                  >
                    {turn.thinkingCollapsed ? "Show reasoning" : "Hide reasoning"}
                  </button>
                  {!turn.thinkingCollapsed ? (
                    <div className="whitespace-pre-wrap text-[11px] leading-relaxed">{turn.thinkingText}</div>
                  ) : null}
                </div>
              ) : null}
              {turn.role === "assistant" && turn.stats ? (
                <div className="mt-2 text-[11px]" style={{ color: ensureReadableTextColor(statsTextColorForTheme, isDarkTheme) }}>
                  {turn.stats.tokensPerSecond} t/s · {turn.stats.tokenCount} tok · {(turn.stats.elapsedMs / 1000).toFixed(2)}s
                  {typeof turn.stats.firstTokenMs === "number" ? ` · first ${(turn.stats.firstTokenMs / 1000).toFixed(2)}s` : ""}
                  {typeof turn.stats.providerTps === "number" ? ` · provider ${turn.stats.providerTps} t/s` : ""}
                  {!turn.stats.hideProviderModel && (turn.stats.provider || turn.stats.model)
                    ? ` · ${turn.stats.provider ?? "provider"}${turn.stats.model ? `/${turn.stats.model}` : ""}`
                    : ""}
                </div>
              ) : null}
              {turn.attachments?.length ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  {turn.attachments.map((item, mediaIndex) => (
                    <button
                      key={`${item.url}-${mediaIndex}`}
                      type="button"
                      className="h-20 w-20 overflow-hidden rounded-xl border bg-surface/70"
                      onClick={() => setLightbox({ items: turn.attachments ?? [], index: mediaIndex })}
                    >
                      {item.kind === "image" ? (
                        <img src={item.url} alt={item.name ?? "attachment"} className="h-full w-full object-cover" />
                      ) : (
                        <img src={item.posterUrl || item.url} alt={item.name ?? "video"} className="h-full w-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <audio ref={chatTtsAudioRef} className="hidden" playsInline preload="none" />
        <form onSubmit={onSubmit} className="mt-3 shrink-0 space-y-2">
          {loading ? (
            <div className="flex min-h-10 items-center justify-between gap-3 rounded-lg border border-rose-500/50 bg-pastelRed/40 px-3 py-2 dark:bg-rose-950/35">
              <span className="min-w-0 text-sm font-medium text-slate-900 dark:text-slate-100">Nova is generating a reply…</span>
              <Button
                type="button"
                tone="red"
                className="h-9 shrink-0 px-4 text-sm font-semibold"
                onClick={() => stopGeneration()}
                title="Stop immediately"
              >
                <FaStop className="mr-2 inline h-3.5 w-3.5" />
                Stop
              </Button>
            </div>
          ) : null}
          <div
            className={cn(
              "rounded-ui border border-dashed p-3 text-sm transition",
              dragging ? "border-blue-500 bg-pastelBlue/50" : "bg-surface2"
            )}
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={(event) => {
              event.preventDefault();
              setDragging(false);
            }}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              addFiles(event.dataTransfer.files);
            }}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span>Drop images/videos here, or choose files.</span>
              <label className="cursor-pointer rounded-ui border bg-pastelGreen px-2 py-0.5 text-xs text-slate-900">
                Add files
                <input
                  type="file"
                  className="hidden"
                  multiple
                  accept="image/*,video/*"
                  onChange={(event) => {
                    if (!event.target.files) return;
                    addFiles(event.target.files);
                    event.target.value = "";
                  }}
                />
              </label>
            </div>
          </div>
          {uploads.length ? (
            <div className="rounded-2xl border bg-surface2 p-2">
              <div className="mb-2 flex flex-wrap gap-2">
                {uploads.map((item, idx) => {
                  const previewUrl =
                    item.uploaded?.kind === "video"
                      ? (item.uploaded.posterUrl || item.uploaded.url)
                      : (item.uploaded?.url || item.previewUrl);
                  return (
                    <div key={item.id} className="relative h-14 w-14 overflow-hidden rounded-lg border bg-surface">
                      {previewUrl ? (
                        <img src={previewUrl} alt={item.file.name} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center px-1 text-center text-[10px] text-muted">{item.file.name}</div>
                      )}
                      <button type="button" className="absolute right-0 top-0 inline-flex h-5 w-5 items-center justify-center rounded-bl-md bg-slate-900/80 text-white" onClick={() => setUploads((prev) => prev.filter((u) => u.id !== item.id))} title="Remove file">
                        <FaXmark className="h-3 w-3" />
                      </button>
                      {idx > 0 ? (
                        <button type="button" className="absolute bottom-0 left-0 inline-flex h-5 w-5 items-center justify-center rounded-tr-md bg-slate-900/80 text-white" onClick={() => moveUpload(item.id, -1)} title="Move earlier">
                          <FaRotateRight className="h-3 w-3 rotate-180" />
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <div className="text-xs text-muted">
                {uploads.some((item) => item.status === "failed")
                  ? "Some files failed to upload. Remove and retry."
                  : `${uploads.length} file${uploads.length > 1 ? "s" : ""} ready`}
              </div>
            </div>
          ) : null}
          <Textarea
            value={message}
            onChange={(event) => setMessage(event.target.value)}
            onKeyDown={(event) => {
              if (!sendOnEnter) return;
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!loading && message.trim()) {
                  void onSubmit(event as unknown as FormEvent<HTMLFormElement>);
                }
              }
            }}
            rows={4}
            placeholder="Ask Nova to do something..."
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-3 gap-y-1">
              <span className="min-w-0 text-xs text-muted">
                Tip: commands like <code>/run ...</code> can execute shell tasks when command mode is enabled.
              </span>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={sendOnEnter}
                  onChange={async (event) => {
                    const next = event.target.checked;
                    setSendOnEnter(next);
                    try {
                      await fetch("/api/settings", {
                        method: "PUT",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ web: { sendOnEnter: next } })
                      });
                    } catch {
                      // Ignore save failures for this optional UX preference.
                    }
                  }}
                />
                Send on Enter
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={showThinkingInChat}
                  onChange={(event) => setShowThinkingInChat(event.target.checked)}
                />
                Show thinking
              </label>
              <label className="flex items-center gap-1 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={readAloudMessages}
                  onChange={(event) => {
                    const next = event.target.checked;
                    setReadAloudMessages(next);
                    try {
                      window.localStorage.setItem("nova-chat-read-aloud", next ? "1" : "0");
                    } catch {
                      // Ignore storage failures.
                    }
                    if (!next) {
                      stopChatTtsPlayback();
                    }
                  }}
                />
                Read aloud messages
              </label>
              <Link href="/thoughts" className="inline-flex items-center text-violet-400 hover:text-violet-300" title="Open Live Thoughts">
                <FaBrain className="h-3.5 w-3.5" />
              </Link>
              {uploadedMedia.length > 0 ? <Badge tone="pink">{uploadedMedia.length} media ready</Badge> : null}
            </div>
            {!loading ? (
              <div className="flex h-8 min-w-[4.75rem] shrink-0 items-center justify-end">
                <Button
                  type="submit"
                  tone="green"
                  className={cn(
                    "h-8 w-[4.5rem] px-3 text-sm transition-opacity",
                    message.trim().length > 0 ? "opacity-100" : "pointer-events-none opacity-0 invisible"
                  )}
                >
                  Send
                </Button>
              </div>
            ) : null}
          </div>
        </form>
      </Card>
      {lightbox ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
          <div className="max-h-[92vh] w-full max-w-5xl rounded-ui border bg-surface p-3">
            <div className="mb-2 flex items-center justify-between text-sm">
              <span>
                {lightbox.index + 1}/{lightbox.items.length}
              </span>
              <Button type="button" tone="red" className="h-8 px-3 text-sm" onClick={() => setLightbox(null)}>
                Close
              </Button>
            </div>
            <div className="flex items-center justify-center">
              {lightbox.items[lightbox.index]?.kind === "video" ? (
                <video src={lightbox.items[lightbox.index]?.url} controls className="max-h-[78vh] w-full rounded-ui" />
              ) : (
                <img src={lightbox.items[lightbox.index]?.url} alt="preview" className="max-h-[78vh] rounded-ui object-contain" />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function createEmptySession(): ChatSession {
  const id = randomId();
  const now = new Date().toISOString();
  return {
    id,
    title: "New session",
    createdAt: now,
    updatedAt: now,
    turns: []
  };
}

function buildSessionTitle(turns: ChatTurn[]): string {
  const firstUser = turns.find((item) => item.role === "user" && item.text.trim().length > 0)?.text.trim();
  if (!firstUser) return "New session";
  return firstUser.slice(0, 40);
}

function equalTurns(a: ChatTurn[], b: ChatTurn[]): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    const left = a[i];
    const right = b[i];
    if (left.id !== right.id) return false;
    if (left.role !== right.role) return false;
    if (left.text !== right.text) return false;
    if (left.isPending !== right.isPending) return false;
    if (left.thinkingText !== right.thinkingText) return false;
    if (left.thinkingCollapsed !== right.thinkingCollapsed) return false;
    const leftAttachments = left.attachments ?? [];
    const rightAttachments = right.attachments ?? [];
    if (leftAttachments.length !== rightAttachments.length) return false;
    for (let j = 0; j < leftAttachments.length; j += 1) {
      if (leftAttachments[j].url !== rightAttachments[j].url || leftAttachments[j].kind !== rightAttachments[j].kind) {
        return false;
      }
    }
  }
  return true;
}

function inferMediaKind(value?: string): "image" | "video" | undefined {
  if (!value) return undefined;
  const lower = value.toLowerCase();
  if (/\.(png|jpg|jpeg|webp|gif)(\?|$)/.test(lower) || lower.includes("/view?filename=")) {
    return "image";
  }
  if (/\.(mp4|webm|mov|m4v)(\?|$)/.test(lower)) {
    return "video";
  }
  return undefined;
}

function extractMediaFromText(text: string): MediaItem[] {
  const urls = Array.from(
    new Set(
      (text.match(/https?:\/\/[^\s)]+|\/v1\/media\/files\/[^\s)]+/g) ?? []).map((item) => item.trim())
    )
  );
  return urls
    .map((url) => {
      const normalizedUrl = normalizeMediaUrl(url);
      const kind = inferMediaKind(normalizedUrl);
      if (!kind) return undefined;
      return { url: normalizedUrl, kind } satisfies MediaItem;
    })
    .filter((item): item is MediaItem => Boolean(item));
}

function normalizeMediaUrl(url: string): string {
  if (url.startsWith("/v1/media/files/")) {
    return `/api/media/files/${url.slice("/v1/media/files/".length)}`;
  }
  const marker = "/v1/media/files/";
  const idx = url.indexOf(marker);
  if (idx >= 0) {
    return `/api/media/files/${url.slice(idx + marker.length)}`;
  }
  return url;
}

function toAgentVisionImageUrl(url: string | undefined): string | undefined {
  if (!url) return undefined;
  if (url.startsWith("/api/media/files/")) {
    return `/v1/media/files/${url.slice("/api/media/files/".length)}`;
  }
  return url;
}

async function fileToBase64(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

/** True while the stream has an opened reasoning tag without its closing tag yet (partial stream safe). */
function isInsideReasoningStream(full: string): boolean {
  const lower = full.toLowerCase();
  const pairs: Array<[string, string]> = [
    ["<thinking>", "</thinking>"],
    ["<reasoning>", "</reasoning>"],
    ["<think>", "</think>"]
  ];
  for (const [open, close] of pairs) {
    const o = lower.lastIndexOf(open);
    if (o < 0) continue;
    const c = lower.lastIndexOf(close);
    if (c < o) return true;
  }
  return false;
}

function extractThinking(input: {
  text: string;
  firstTokenMs?: number;
  provider?: string;
  model?: string;
  hideProviderModel?: boolean;
  providerTps?: number;
}): {
  visible: string;
  thinking: string;
  firstTokenMs?: number;
  provider?: string;
  model?: string;
  hideProviderModel?: boolean;
  providerTps?: number;
} {
  const text = input.text;
  const thinkingParts: string[] = [];
  const patterns = [
    /<thinking>([\s\S]*?)<\/thinking>/gi,
    /<reasoning>([\s\S]*?)<\/reasoning>/gi,
    /<think>([\s\S]*?)<\/redacted_thinking>/gi
  ];
  let visible = text;
  for (const pattern of patterns) {
    visible = visible.replace(pattern, (_, thought: string) => {
      thinkingParts.push(thought.trim());
      return "";
    });
  }
  return {
    visible: visible.trim(),
    thinking: thinkingParts.join("\n\n").trim(),
    firstTokenMs: input.firstTokenMs,
    provider: input.provider,
    model: input.model,
    hideProviderModel: input.hideProviderModel,
    providerTps: input.providerTps
  };
}

function randomId(): string {
  return Math.random().toString(16).slice(2);
}

function estimateTokens(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return Math.ceil(trimmed.length / 4);
}

async function fetchNovaBufferedChatReply(input: {
  composedMessage: string;
  imageUrl?: string;
  signal: AbortSignal;
}): Promise<{ ok: true; reply: string } | { ok: false; error: string }> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      message: input.composedMessage,
      imageUrl: input.imageUrl
    }),
    signal: input.signal
  });
  const data = (await response.json().catch(() => ({}))) as { reply?: string; error?: string };
  if (!response.ok) {
    return { ok: false, error: data.error ?? `Request failed (${response.status})` };
  }
  return { ok: true, reply: data.reply ?? "" };
}

function withOpacity(hex: string, opacityPct: number): string {
  const normalized = Math.max(0, Math.min(100, Number(opacityPct || 0))) / 100;
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return hex;
  const r = Number.parseInt(match[1], 16);
  const g = Number.parseInt(match[2], 16);
  const b = Number.parseInt(match[3], 16);
  return `rgba(${r}, ${g}, ${b}, ${normalized})`;
}

function ensureReadableTextColor(hex: string, isDarkTheme: boolean): string {
  const rgb = parseHexColor(hex);
  if (!rgb) return hex;
  const luminance = (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
  if (!isDarkTheme && luminance > 0.78) return "#334155";
  if (isDarkTheme && luminance < 0.22) return "#e2e8f0";
  return hex;
}

function parseHexColor(hex: string): { r: number; g: number; b: number } | null {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!match) return null;
  return {
    r: Number.parseInt(match[1], 16),
    g: Number.parseInt(match[2], 16),
    b: Number.parseInt(match[3], 16)
  };
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
  onPartial: (text: string) => void,
  onActivity?: (evt: { kind: string; phase: "start" | "end" }) => void
): Promise<{ text: string; firstTokenMs?: number; provider?: string; model?: string; hideProviderModel?: boolean; providerTps?: number }> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let sseBuffer = "";
  let eventName = "";
  let currentData = "";
  let fullText = "";
  let startedAt = Date.now();
  let firstTokenMs: number | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let hideProviderModel = false;
  let providerTps: number | undefined;

  const onAbort = () => {
    void reader.cancel(new DOMException("Aborted", "AbortError"));
  };
  if (signal) {
    if (signal.aborted) {
      void reader.cancel(new DOMException("Aborted", "AbortError"));
      throw new DOMException("Aborted", "AbortError");
    }
    signal.addEventListener("abort", onAbort, { once: true });
  }

  try {
  while (true) {
    if (signal?.aborted) {
      await reader.cancel(new DOMException("Aborted", "AbortError")).catch(() => undefined);
      throw new DOMException("Aborted", "AbortError");
    }
    const { value, done } = await reader.read();
    if (done) break;
    sseBuffer += decoder.decode(value, { stream: true });
    const lines = sseBuffer.split(/\r?\n/);
    sseBuffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.startsWith("event:")) {
        eventName = line.slice(6).trim();
        continue;
      }
      if (line.startsWith("data:")) {
        currentData += line.slice(5).trim();
        continue;
      }
      if (line.trim() === "") {
        if (eventName && currentData) {
          const payload = JSON.parse(currentData) as {
            token?: string;
            reply?: string;
            provider?: string;
            model?: string;
            hideProviderModelInStats?: boolean;
            firstTokenMs?: number;
            tokensPerSecond?: number;
          };
          if (eventName === "start") {
            startedAt = Date.now();
            provider = payload.provider;
            model = payload.model;
            hideProviderModel = payload.hideProviderModelInStats === true;
          }
          if (eventName === "activity") {
            const act = payload as { kind?: string; phase?: string };
            if (act.kind && (act.phase === "start" || act.phase === "end")) {
              onActivity?.({ kind: act.kind, phase: act.phase });
            }
          }
          if (eventName === "token" && payload.token) {
            if (firstTokenMs === undefined) {
              firstTokenMs = Date.now() - startedAt;
            }
            fullText += payload.token;
            onPartial(fullText);
          }
          if (eventName === "done" && payload.reply != null && String(payload.reply).length > 0) {
            const replyStr = String(payload.reply);
            // Never replace a longer streamed buffer with a shorter final payload (server/token cap bugs).
            fullText = replyStr.length >= fullText.length ? replyStr : fullText;
            provider = payload.provider ?? provider;
            model = payload.model ?? model;
            hideProviderModel = payload.hideProviderModelInStats === true;
            firstTokenMs = payload.firstTokenMs ?? firstTokenMs;
            providerTps = payload.tokensPerSecond ?? providerTps;
            onPartial(fullText);
          }
          if (eventName === "error") {
            const message = (payload as { error?: string }).error ?? "stream failed";
            throw new Error(message);
          }
        }
        eventName = "";
        currentData = "";
      }
    }
  }
  return { text: fullText, firstTokenMs, provider, model, hideProviderModel, providerTps };
  } finally {
    if (signal) {
      signal.removeEventListener("abort", onAbort);
    }
  }
}
