/* eslint-disable react/no-unescaped-entities */
"use client";

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useTheme } from "next-themes";
import { FaBrain, FaCheck, FaCopy, FaFloppyDisk, FaPenToSquare, FaPlus, FaRotateRight, FaSpinner, FaTrash, FaXmark } from "react-icons/fa6";
import { Card } from "../components/ui/card";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/cn";
import { ChatMarkdown } from "../components/chat-markdown";

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
  const [streamPhase, setStreamPhase] = useState<StreamPhase>("thinking");
  const webSearchDepthRef = useRef(0);
  const lastStreamRawRef = useRef("");
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [lastCopiedTurnId, setLastCopiedTurnId] = useState<string | null>(null);
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

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    const readyUploads = await ensureUploads();
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
    try {
      const startedAt = Date.now();
      const response = await fetch("/api/chat/stream", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: composedMessage,
          imageUrl: toAgentVisionImageUrl(readyUploads.find((item) => item.kind === "image")?.url)
        })
      });
      if (!response.ok || !response.body) {
        const data = (await response.json().catch(() => ({}))) as { error?: string };
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? { ...turn, text: `Error: ${data.error ?? "Request failed"}`, thinkingText: undefined }
              : turn
          )
        );
        return;
      }
      const streamResult = await readSseStream(
        response.body,
        (partialText) => {
          lastStreamRawRef.current = partialText;
          if (webSearchDepthRef.current > 0) {
            setStreamPhase("web-search");
          } else if (isInsideReasoningStream(partialText)) {
            setStreamPhase("reasoning");
          } else {
            setStreamPhase("thinking");
          }
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
        },
        (evt) => {
          if (evt.kind !== "web-search") return;
          if (evt.phase === "start") {
            webSearchDepthRef.current += 1;
            setStreamPhase("web-search");
          } else {
            webSearchDepthRef.current = Math.max(0, webSearchDepthRef.current - 1);
            if (webSearchDepthRef.current === 0) {
              const raw = lastStreamRawRef.current;
              setStreamPhase(isInsideReasoningStream(raw) ? "reasoning" : "thinking");
            }
          }
        }
      );
      const { visible, thinking, firstTokenMs, provider, model: modelName, hideProviderModel, providerTps } = extractThinking(streamResult);
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
    } catch (error) {
      const raw = error instanceof Error ? error.message : "Unknown error";
      const hint =
        /fetch failed|failed to fetch/i.test(raw)
          ? " Check that agent-core is running and NOVA_AGENT_API_URL matches where it listens."
          : "";
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === assistantId
            ? { ...turn, text: `Error: ${raw}${hint}`, thinkingText: undefined }
            : turn
        )
      );
    } finally {
      setStreamPhase("thinking");
      setLoading(false);
    }
  }

  async function ensureUploads(): Promise<MediaItem[]> {
    const latestDone = uploads
      .map((item) => item.uploaded)
      .filter((item): item is MediaItem => Boolean(item));
    const queued = uploads.filter((item) => item.status === "queued" || item.status === "failed");
    if (!queued.length) return latestDone;
    const newlyUploaded: MediaItem[] = [];
    for (const item of queued) {
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
            <Button
              type="button"
              tone="red"
              className="inline-flex h-8 min-w-8 items-center justify-center px-2"
              onClick={() => {
                if (!activeSessionId) return;
                const ok = window.confirm("Delete this session?");
                if (!ok) return;
                const remaining = sessions.filter((item) => item.id !== activeSessionId);
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
              }}
              title="Delete active session"
            >
              <FaTrash className="h-5 w-5" />
            </Button>
            {loading ? (
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-ui border bg-surface2"
                title="Nova is streaming"
                disabled
              >
                <FaSpinner className="h-3.5 w-3.5 animate-spin text-slate-600" />
              </button>
            ) : null}
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
                      ).map(({ phase, label }) => {
                        const active = streamPhase === phase;
                        return (
                          <div
                            key={phase}
                            className={cn(
                              "flex items-center justify-between rounded-full border px-3 py-1.5 transition-all",
                              active
                                ? "nova-thinking-row-active border-blue-400/60 bg-blue-500/15"
                                : "border-slate-400/35 bg-surface opacity-70"
                            )}
                          >
                            <div className="flex items-center gap-2">
                              <span
                                className={cn(
                                  "h-3.5 w-3.5 rounded-full border",
                                  active ? "nova-thinking-orb border-blue-300/80" : "border-slate-400/70 bg-slate-400/40"
                                )}
                              />
                              <span className="text-xs font-medium">{label}</span>
                            </div>
                            <span className="flex items-center gap-1.5">
                              <span
                                className={cn("h-1.5 w-1.5 rounded-full", active ? "nova-thinking-dot-1 bg-blue-300" : "bg-slate-400/70")}
                              />
                              <span
                                className={cn("h-1.5 w-1.5 rounded-full", active ? "nova-thinking-dot-2 bg-blue-300" : "bg-slate-400/70")}
                              />
                              <span
                                className={cn("h-1.5 w-1.5 rounded-full", active ? "nova-thinking-dot-3 bg-blue-300" : "bg-slate-400/70")}
                              />
                            </span>
                          </div>
                        );
                      })}
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
                    <ChatMarkdown content={turn.text || (turn.role === "assistant" && loading ? "..." : "")} />
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
                <div className="mt-2">
                  <button
                    type="button"
                    className={bubbleIconActionClass}
                    style={{ color: ensureReadableTextColor(assistantActionIconColorForTheme, isDarkTheme) }}
                    onClick={() => void copyTurnText(turn.text, turn.id)}
                    title="Copy message"
                  >
                    {lastCopiedTurnId === turn.id ? <FaCheck className="h-3.5 w-3.5 text-emerald-400" /> : <FaCopy className="h-3.5 w-3.5" />}
                  </button>
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
        <form onSubmit={onSubmit} className="mt-3 shrink-0 space-y-2">
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
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted">
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
              <Link href="/thoughts" className="inline-flex items-center text-violet-400 hover:text-violet-300" title="Open Live Thoughts">
                <FaBrain className="h-3.5 w-3.5" />
              </Link>
              {uploadedMedia.length > 0 ? <Badge tone="pink">{uploadedMedia.length} media ready</Badge> : null}
            </div>
            <div className="flex h-8 w-[4.75rem] shrink-0 items-center justify-end">
              <Button
                type="submit"
                tone="green"
                className={cn(
                  "h-8 w-[4.5rem] px-3 text-sm transition-opacity",
                  !loading && message.trim().length > 0 ? "opacity-100" : "pointer-events-none opacity-0 invisible"
                )}
              >
                Send
              </Button>
            </div>
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
  while (true) {
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
          if (eventName === "done" && payload.reply) {
            fullText = payload.reply;
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
}
