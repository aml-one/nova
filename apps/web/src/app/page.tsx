/* eslint-disable react/no-unescaped-entities */
"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { FaSpinner } from "react-icons/fa6";
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
  uploaded?: MediaItem;
  error?: string;
};

export default function HomePage() {
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
  const [chatStyle, setChatStyle] = useState({
    userBubbleColor: "#dbeafe",
    assistantBubbleColor: "#e9d5ff",
    userTextColor: "#0f172a",
    assistantTextColor: "#0f172a",
    bubbleBackgroundEnabled: true,
    borderColor: "#94a3b8",
    borderThicknessPx: 1
  });
  const [editingTurnId, setEditingTurnId] = useState<string | null>(null);
  const [editingText, setEditingText] = useState("");
  const [sendOnEnter, setSendOnEnter] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const hasLoadedSessionsRef = useRef(false);

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
              bubbleBackgroundEnabled?: boolean;
              borderColor?: string;
              borderThicknessPx?: number;
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
          bubbleBackgroundEnabled: data.settings?.web?.chatStyle?.bubbleBackgroundEnabled ?? prev.bubbleBackgroundEnabled,
          borderColor: data.settings?.web?.chatStyle?.borderColor ?? prev.borderColor,
          borderThicknessPx: data.settings?.web?.chatStyle?.borderThicknessPx ?? prev.borderThicknessPx
        }));
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
    setSessions((prev) =>
      prev.map((session) =>
        session.id === activeSessionId
          ? {
              ...session,
              turns,
              title: buildSessionTitle(turns),
              updatedAt: new Date().toISOString()
            }
          : session
      )
    );
  }, [turns, activeSessionId]);

  useEffect(() => {
    if (!hasLoadedSessionsRef.current) return;
    localStorage.setItem("nova.chat.sessions.v1", JSON.stringify(sessions));
  }, [sessions]);

  useEffect(() => {
    const container = chatScrollRef.current;
    if (!container || !autoScrollEnabled) return;
    container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
  }, [turns, liveThinking, loading, autoScrollEnabled]);

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
    const assistantId = randomId();
    setTurns((prev) => [
      ...prev,
      {
        id: assistantId,
        role: "assistant",
        text: "",
        thinkingText: "Thinking...",
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
          imageUrl: readyUploads.find((item) => item.kind === "image")?.url
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
      const streamResult = await readSseStream(response.body, (partialText) => {
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
      });
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
      setTurns((prev) =>
        prev.map((turn) =>
          turn.id === assistantId
            ? { ...turn, text: `Error: ${error instanceof Error ? error.message : "Unknown error"}`, thinkingText: undefined }
            : turn
        )
      );
    } finally {
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
      status: "queued"
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

  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit lg:sticky lg:top-24">
        <h2 className="mb-2 text-lg font-semibold">Session</h2>
        <div className="space-y-2">
          <label className="text-xs text-muted">Session</label>
          <div className="space-y-1.5">
            <Select
              className="w-full"
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
            <div className="grid grid-cols-3 gap-1.5">
            <Button
              type="button"
              tone="neutral"
              onClick={() => {
                const active = sessions.find((item) => item.id === activeSessionId);
                if (!active) return;
                const next = window.prompt("Rename session", active.title)?.trim();
                if (!next) return;
                setSessions((prev) => prev.map((item) => (item.id === activeSessionId ? { ...item, title: next } : item)));
              }}
              title="Rename active session"
            >
              Rename
            </Button>
            <Button
              type="button"
              tone="red"
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
              Delete
            </Button>
            <Button
              type="button"
              tone="green"
              className="px-2"
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
              +
            </Button>
            </div>
          </div>
          <p className="text-xs text-muted">
            Tip: commands like <code>/run ...</code> can execute shell tasks when command mode is enabled.
          </p>
          {uploadedMedia.length > 0 ? <Badge tone="pink">{uploadedMedia.length} media ready</Badge> : null}
          <label className="flex items-center gap-2 text-xs text-muted">
            <input
              type="checkbox"
              checked={showThinkingInChat}
              onChange={(event) => setShowThinkingInChat(event.target.checked)}
            />
            Show thinking in chat
          </label>
          <Link href="/thoughts" className="inline-block rounded-ui border bg-pastelPurple px-2 py-1 text-xs text-slate-900">
            Open Live Thoughts
          </Link>
        </div>
      </Card>
      <Card className="flex min-h-[calc(100vh-170px)] flex-col">
        <div className="mb-2 flex items-center justify-between">
          <h1 className="text-2xl font-semibold">Nova Chat</h1>
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
        <div
          ref={chatScrollRef}
          className="mb-4 flex-1 space-y-2 overflow-y-auto rounded-xl border bg-surface p-3"
          onScroll={(event) => {
            const target = event.currentTarget;
            const nearBottom = target.scrollHeight - target.scrollTop - target.clientHeight < 36;
            setAutoScrollEnabled(nearBottom);
          }}
        >
          {turns.length === 0 ? <div className="text-sm text-muted">Start chatting with Nova.</div> : null}
          {loading && showThinkingInChat ? (
            <article className="mr-auto max-w-[85%] rounded-ui border border-slate-500/60 bg-slate-200/60 p-2.5 text-slate-700 dark:bg-slate-700/45 dark:text-slate-200">
              <div className="mb-1 text-xs font-semibold">Thinking</div>
              <button
                type="button"
                className="mb-1 rounded-ui border bg-surface2 px-1.5 py-0.5 text-xs"
                onClick={() => setLiveThinkingCollapsed((prev) => !prev)}
              >
                {liveThinkingCollapsed ? "Expand" : "Collapse"}
              </button>
              {!liveThinkingCollapsed ? <div className="whitespace-pre-wrap text-xs">{liveThinking}</div> : null}
            </article>
          ) : null}
          {turns.map((turn, index) => (
            <article
              key={turn.id}
              className={turn.role === "user" ? "ml-auto max-w-[85%] rounded-ui border p-2.5" : "mr-auto max-w-[85%] rounded-ui border p-2.5"}
              style={
                turn.role === "user"
                  ? {
                      backgroundColor: chatStyle.bubbleBackgroundEnabled ? chatStyle.userBubbleColor : "transparent",
                      color: chatStyle.userTextColor,
                      borderColor: chatStyle.borderColor,
                      borderWidth: `${chatStyle.borderThicknessPx}px`
                    }
                  : {
                      backgroundColor: chatStyle.bubbleBackgroundEnabled ? chatStyle.assistantBubbleColor : "transparent",
                      color: chatStyle.assistantTextColor,
                      borderColor: chatStyle.borderColor,
                      borderWidth: `${chatStyle.borderThicknessPx}px`
                    }
              }
            >
              <div className="mb-1 text-xs font-semibold">{turn.role === "user" ? "You" : "Nova"}</div>
              {editingTurnId === turn.id ? (
                <div className="space-y-2">
                  <Textarea value={editingText} onChange={(event) => setEditingText(event.target.value)} rows={3} />
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      tone="green"
                      onClick={() => {
                        const next = editingText.trim();
                        if (!next) return;
                        setTurns((prev) => prev.map((item) => (item.id === turn.id ? { ...item, text: next } : item)));
                        setMessage(next);
                        setEditingTurnId(null);
                      }}
                    >
                      Save
                    </Button>
                    <Button type="button" tone="red" onClick={() => setEditingTurnId(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="text-sm">
                  <ChatMarkdown content={turn.text || (turn.role === "assistant" && loading ? "..." : "")} />
                </div>
              )}
              {turn.role === "user" ? (
                <div className="mt-2 flex gap-1.5">
                  <Button
                    type="button"
                    tone="yellow"
                    onClick={() => {
                      setEditingTurnId(turn.id);
                      setEditingText(turn.text);
                    }}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    tone="orange"
                    onClick={() => {
                      setMessage(turn.text);
                      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
                    }}
                  >
                    Regenerate
                  </Button>
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
                    {turn.thinkingCollapsed ? "Show thinking" : "Hide thinking"}
                  </button>
                  {!turn.thinkingCollapsed ? <div className="whitespace-pre-wrap">{turn.thinkingText}</div> : null}
                </div>
              ) : null}
              {turn.role === "assistant" && turn.stats ? (
                <div className="mt-2 text-[11px] text-slate-700/80 dark:text-slate-200/80">
                  {turn.stats.tokensPerSecond} t/s · {turn.stats.tokenCount} tok · {(turn.stats.elapsedMs / 1000).toFixed(2)}s
                  {typeof turn.stats.firstTokenMs === "number" ? ` · first ${(turn.stats.firstTokenMs / 1000).toFixed(2)}s` : ""}
                  {typeof turn.stats.providerTps === "number" ? ` · provider ${turn.stats.providerTps} t/s` : ""}
                  {!turn.stats.hideProviderModel && (turn.stats.provider || turn.stats.model)
                    ? ` · ${turn.stats.provider ?? "provider"}${turn.stats.model ? `/${turn.stats.model}` : ""}`
                    : ""}
                </div>
              ) : null}
              {turn.attachments?.length ? (
                <div className="mt-2 grid grid-cols-2 gap-2 md:grid-cols-3">
                  {turn.attachments.map((item, mediaIndex) => (
                    <button
                      key={`${item.url}-${mediaIndex}`}
                      type="button"
                      className="overflow-hidden rounded-ui border bg-surface/70"
                      onClick={() => setLightbox({ items: turn.attachments ?? [], index: mediaIndex })}
                    >
                      {item.kind === "image" ? (
                        <img src={item.url} alt={item.name ?? "attachment"} className="h-24 w-full object-cover" />
                      ) : (
                        <img src={item.posterUrl || item.url} alt={item.name ?? "video"} className="h-24 w-full object-cover" />
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </article>
          ))}
        </div>
        <form onSubmit={onSubmit} className="space-y-2">
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
            <div className="space-y-2 rounded-ui border bg-surface2 p-2">
              {uploads.map((item, idx) => (
                <div key={item.id} className="rounded-ui border bg-surface p-2 text-xs">
                  <div className="mb-1 flex items-center justify-between gap-2">
                    <span className="truncate">{item.file.name}</span>
                    <div className="flex gap-1">
                      <Button type="button" tone="blue" onClick={() => moveUpload(item.id, -1)} disabled={idx === 0}>
                        Up
                      </Button>
                      <Button type="button" tone="blue" onClick={() => moveUpload(item.id, 1)} disabled={idx === uploads.length - 1}>
                        Down
                      </Button>
                      <Button type="button" tone="red" onClick={() => setUploads((prev) => prev.filter((u) => u.id !== item.id))}>
                        Remove
                      </Button>
                    </div>
                  </div>
                  <div className="h-2 overflow-hidden rounded-ui border bg-surface">
                    <div className="h-full bg-pastelGreen transition-all" style={{ width: `${item.progress}%` }} />
                  </div>
                  <div className="mt-1 text-muted">
                    {item.status === "failed" ? `Upload failed: ${item.error ?? "unknown error"}` : `${item.status} (${item.progress}%)`}
                  </div>
                </div>
              ))}
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
            {!loading && message.trim().length > 0 ? <Button type="submit" tone="green">Send</Button> : null}
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
              <Button type="button" tone="red" onClick={() => setLightbox(null)}>
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
      const kind = inferMediaKind(url);
      if (!kind) return undefined;
      return { url, kind } satisfies MediaItem;
    })
    .filter((item): item is MediaItem => Boolean(item));
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
  const pattern = /<thinking>([\s\S]*?)<\/thinking>/gi;
  const thinkingParts: string[] = [];
  const visible = text.replace(pattern, (_, thought: string) => {
    thinkingParts.push(thought.trim());
    return "";
  });
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
  return Math.max(1, Math.ceil(text.length / 4));
}

async function readSseStream(
  body: ReadableStream<Uint8Array>,
  onPartial: (text: string) => void
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
            firstTokenMs = payload.firstTokenMs ?? firstTokenMs;
            providerTps = payload.tokensPerSecond ?? providerTps;
            onPartial(fullText);
          }
        }
        eventName = "";
        currentData = "";
      }
    }
  }
  return { text: fullText, firstTokenMs, provider, model, hideProviderModel, providerTps };
}
