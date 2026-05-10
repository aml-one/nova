/* eslint-disable react/no-unescaped-entities */
"use client";

import Image from "next/image";
import type { RefObject } from "react";
import { FormEvent, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "next-themes";
import {
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
  FaXmark,
  FaMicrophone,
  FaChevronDown,
  FaArrowUp,
  FaGear
} from "react-icons/fa6";
import { Textarea } from "../components/ui/textarea";
import { Select } from "../components/ui/select";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { cn } from "../lib/cn";
import { dispatchNovaEmotionRefresh, NOVA_EMOTION_REFRESH_EVENT, WEB_CHAT_EMOTION_USER_ID } from "../lib/emotion-user";
import { ChatMarkdown } from "../components/chat-markdown";
import { triggerBlobDownload } from "../lib/audio-download";
import { loadAudioElementThenPlay } from "../lib/audio-play";
import { shouldUseNovaIdentityBufferedChat } from "../lib/nova-identity-chat";
import { useShellHeaderExtras } from "../components/shell-header-extras";
import { apiFetch } from "../lib/api-fetch";
import { stripMarkdownForTts, splitTextForTts } from "../lib/chat-tts-text";
import { stripOrpheusCuesForChatDisplay } from "../lib/orpheus-chat-display";
import { NovaThreeSpeakingOrb, type NovaThreeSpeakingOrbHandle } from "../components/NovaThreeSpeakingOrb";
import { TtsVoiceOrbDriver } from "../lib/tts-voice-orb-driver";

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

type TtsTrace = {
  requestText?: string;
  preparedForSpeech?: string;
  sentToOrpheus?: string;
  correlationId?: string;
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

/** Max distinct synthesized clips kept in memory per chat session (replay without calling speak-audio again). */
const MAX_SESSION_TTS_AUDIO_CACHE = 10;

/** Skip server transcribe for accidental empty/stop blobs (avoids STT misconfig spam). */
const NOVA_CHAT_STT_MIN_AUDIO_BYTES = 900;
/** RMS on FloatTimeDomainData; speech must exceed this before silence countdown applies. */
const NOVA_CHAT_MIC_SILENCE_RMS_THRESHOLD = 0.012;
/** Avoid cutting off the very start of an utterance before auto-stop can fire. */
const NOVA_CHAT_MIC_SILENCE_MIN_RECORD_MS = 520;
/** Web Speech anti-hallucination: only accept text near detected speech energy. */
const NOVA_CHAT_WEB_SPEECH_ENERGY_RMS_THRESHOLD = 0.018;
const NOVA_CHAT_WEB_SPEECH_ENERGY_WINDOW_MS = 2200;
/** Stop voice re-listen if the user stays silent; never transcribe pure room tone. */
const NOVA_CHAT_STT_NO_SPEECH_STOP_MS = 8000;
const NOVA_CHAT_STT_SERVER_HINT =
  "Server speech-to-text is not configured on the agent (set OPENAI_API_KEY or NOVA_STT_COMMAND). Use Chrome or Edge for in-browser dictation, or configure the agent.";

function chatTtsCacheKey(turnId: string, cleaned: string): string {
  return `${turnId}\u0000${cleaned}`;
}

function touchChatTtsCacheOrder(order: string[], key: string): void {
  const i = order.indexOf(key);
  if (i >= 0) {
    order.splice(i, 1);
    order.push(key);
  }
}

function rememberChatTtsBlob(
  map: Map<string, { blob: Blob; mime: string }>,
  order: string[],
  key: string,
  value: { blob: Blob; mime: string }
): void {
  if (map.has(key)) {
    const i = order.indexOf(key);
    if (i >= 0) order.splice(i, 1);
  }
  map.set(key, value);
  order.push(key);
  while (order.length > MAX_SESSION_TTS_AUDIO_CACHE) {
    const oldest = order.shift();
    if (oldest) map.delete(oldest);
  }
}

function looksLikeNoiseHallucination(text: string): boolean {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (words.length < 6) return false;
  const unique = new Set(words).size;
  const uniqueRatio = unique / words.length;
  return uniqueRatio < 0.38;
}

function getMicCapabilityError(): string | null {
  if (typeof window === "undefined") return null;
  if (!window.isSecureContext) {
    return "Microphone needs HTTPS (secure context). Start the stack with NOVA_WEB_HTTPS=true; for LAN mic access use NOVA_WEB_TLS_SAN=IP:YOUR_LAN_IP and optional NOVA_WEB_STANDARD_PORTS=1 (https://host on port 443; binding 80/443 may require sudo).";
  }
  if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
    return "This browser does not support microphone capture (getUserMedia).";
  }
  return null;
}

function describeMicStartError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === "NotAllowedError" || error.name === "SecurityError") {
      return "Microphone permission denied. Allow mic access in browser/site settings and try again.";
    }
    if (error.name === "NotFoundError" || error.name === "DevicesNotFoundError") {
      return "No microphone detected. Connect/select a mic and try again.";
    }
    if (error.name === "NotReadableError" || error.name === "TrackStartError") {
      return "Microphone is busy or unavailable. Close other apps using the mic and retry.";
    }
  }
  return "Microphone permission denied or unavailable.";
}

type SpeechRecognitionCtor = new () => SpeechRecognition;

function getBrowserSpeechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionCtor;
    webkitSpeechRecognition?: SpeechRecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

function IosSwitch({
  checked,
  onChange,
  id,
  disabled
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  id: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      id={id}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 ease-out",
        checked ? "bg-emerald-500" : "bg-slate-400/40 dark:bg-white/15",
        disabled && "cursor-not-allowed opacity-50"
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}

type ChatSessionHeaderControlsProps = {
  sessions: ChatSession[];
  activeSessionId: string;
  sessionDeleteConfirmOpen: boolean;
  sessionDeletePopoverRef: RefObject<HTMLDivElement | null>;
  chatOptionsPopoverRef: RefObject<HTMLDivElement | null>;
  chatOptionsOpen: boolean;
  setChatOptionsOpen: (open: boolean) => void;
  voiceDictationAutoSend: boolean;
  onVoiceDictationAutoSendChange: (next: boolean) => void;
  voiceContinuousConversation: boolean;
  onVoiceContinuousConversationChange: (next: boolean) => void;
  sendOnEnter: boolean;
  onSendOnEnterChange: (next: boolean) => void;
  showThinkingInChat: boolean;
  onShowThinkingChange: (next: boolean) => void;
  readAloudMessages: boolean;
  onReadAloudChange: (next: boolean) => void;
  onSessionChange: (sessionId: string) => void;
  onNewSession: () => void;
  onRenameClick: () => void;
  onToggleDeleteMenu: () => void;
  onCancelDelete: () => void;
  onConfirmDelete: () => void;
  closeDeletePopover: () => void;
};

function ChatSessionHeaderControls({
  sessions,
  activeSessionId,
  sessionDeleteConfirmOpen,
  sessionDeletePopoverRef,
  chatOptionsPopoverRef,
  chatOptionsOpen,
  setChatOptionsOpen,
  voiceDictationAutoSend,
  onVoiceDictationAutoSendChange,
  voiceContinuousConversation,
  onVoiceContinuousConversationChange,
  sendOnEnter,
  onSendOnEnterChange,
  showThinkingInChat,
  onShowThinkingChange,
  readAloudMessages,
  onReadAloudChange,
  onSessionChange,
  onNewSession,
  onRenameClick,
  onToggleDeleteMenu,
  onCancelDelete,
  onConfirmDelete,
  closeDeletePopover
}: ChatSessionHeaderControlsProps) {
  return (
    <>
      <div className="relative min-w-0 max-w-[min(20rem,calc(100vw-11rem))] flex-[1_1_10rem]">
        <Select
          className="min-h-9 w-full appearance-none rounded-lg border border-border bg-surface2 py-2 pl-2.5 pr-9 text-xs leading-normal text-text shadow-none ring-0 focus:outline-none focus:ring-0 dark:bg-white/[0.06]"
          value={activeSessionId}
          onChange={(event) => onSessionChange(event.target.value)}
        >
          {sessions.map((session) => (
            <option key={session.id} value={session.id}>
              {session.title}
            </option>
          ))}
        </Select>
        <FaChevronDown
          className="pointer-events-none absolute right-2.5 top-1/2 h-2.5 w-2.5 -translate-y-1/2 text-muted"
          aria-hidden
        />
      </div>
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-emerald-500/90 transition hover:bg-black/[0.06] dark:text-emerald-400/85 dark:hover:bg-white/[0.07]"
        onClick={onNewSession}
        title="Start new session"
      >
        <FaPlus className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-amber-500/90 transition hover:bg-black/[0.06] dark:text-amber-300/80 dark:hover:bg-white/[0.07]"
        onClick={onRenameClick}
        title="Rename active session"
      >
        <FaPenToSquare className="h-3.5 w-3.5" />
      </button>
      <div ref={sessionDeletePopoverRef} className="relative shrink-0">
        <button
          type="button"
          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-500/90 transition hover:bg-black/[0.06] dark:text-rose-400/80 dark:hover:bg-white/[0.07]"
          onClick={onToggleDeleteMenu}
          title="Delete active session"
          aria-expanded={sessionDeleteConfirmOpen}
          aria-haspopup="dialog"
        >
          <FaTrash className="h-3.5 w-3.5" />
        </button>
        {sessionDeleteConfirmOpen ? (
          <div
            className="absolute right-0 top-full z-50 mt-1.5 w-[min(18rem,calc(100vw-2rem))] rounded-ui border border-rose-500/35 bg-surface2 p-3 shadow-lg ring-1 ring-black/10 dark:ring-white/10"
            role="dialog"
            aria-labelledby="session-delete-confirm-title"
          >
            <p id="session-delete-confirm-title" className="mb-3 text-sm font-medium text-foreground">
              Delete this session? This cannot be undone.
            </p>
            <div className="flex justify-end gap-2">
              <Button type="button" tone="neutral" className="text-sm" onClick={onCancelDelete}>
                Cancel
              </Button>
              <Button type="button" tone="red" className="text-sm" onClick={onConfirmDelete}>
                Delete session
              </Button>
            </div>
          </div>
        ) : null}
      </div>
      <div ref={chatOptionsPopoverRef} className="relative shrink-0">
        <button
          type="button"
          className={cn(
            "inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition hover:bg-black/[0.06] hover:text-text dark:hover:bg-white/[0.07]",
            chatOptionsOpen && "bg-black/[0.06] text-text dark:bg-white/10"
          )}
          title="Chat options"
          aria-expanded={chatOptionsOpen}
          aria-haspopup="menu"
          onClick={() => {
            closeDeletePopover();
            setChatOptionsOpen(!chatOptionsOpen);
          }}
        >
          <FaGear className="h-3.5 w-3.5" />
        </button>
        {chatOptionsOpen ? (
          <div
            className="absolute right-0 top-full z-50 mt-1.5 w-[min(20rem,calc(100vw-2rem))] rounded-xl border border-border bg-surface2 p-2 shadow-xl ring-1 ring-black/5 dark:ring-white/10"
            role="menu"
          >
            <div className="flex items-center justify-between gap-3 border-b border-border/80 px-2 py-2.5">
              <div className="min-w-0 pr-1">
                <span className="text-xs text-text">Auto-send after silence</span>
                <p className="mt-0.5 text-[10px] leading-snug text-muted">
                  Sends only STT-created drafts when dictation pauses (never typed text).
                </p>
              </div>
              <IosSwitch
                id="opt-voice-autosend"
                checked={voiceDictationAutoSend}
                onChange={(next) => {
                  void onVoiceDictationAutoSendChange(next);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/80 px-2 py-2.5">
              <div className="min-w-0 pr-1">
                <span className="text-xs text-text">Continuous conversation (voice)</span>
                <p className="mt-0.5 text-[10px] leading-snug text-muted">
                  After read-aloud, auto-start listening only when you sent that turn by voice (mic or auto-send after silence) — not when you typed the message.
                </p>
              </div>
              <IosSwitch
                id="opt-voice-continuous"
                checked={voiceContinuousConversation}
                onChange={(next) => {
                  void onVoiceContinuousConversationChange(next);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/80 px-2 py-2.5 last:border-0">
              <span className="text-xs text-text">Send on Enter</span>
              <IosSwitch
                id="opt-send-enter"
                checked={sendOnEnter}
                onChange={(next) => {
                  void onSendOnEnterChange(next);
                }}
              />
            </div>
            <div className="flex items-center justify-between gap-3 border-b border-border/80 px-2 py-2.5 last:border-0">
              <span className="text-xs text-text">Show thinking</span>
              <IosSwitch id="opt-thinking" checked={showThinkingInChat} onChange={onShowThinkingChange} />
            </div>
            <div className="flex items-center justify-between gap-3 px-2 py-2.5">
              <span className="text-xs text-text">Read aloud</span>
              <IosSwitch id="opt-read-aloud" checked={readAloudMessages} onChange={onReadAloudChange} />
            </div>
            <p className="border-t border-border/60 px-2 pb-1 pt-2 text-[10px] leading-snug text-muted">
              Tip: <code className="text-[10px]">/run …</code> runs shell tasks when command mode is enabled.
            </p>
          </div>
        ) : null}
      </div>
    </>
  );
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
  const [voiceDictationAutoSend, setVoiceDictationAutoSend] = useState(false);
  const [voiceContinuousConversation, setVoiceContinuousConversation] = useState(false);
  const [voiceDictationSilenceSec, setVoiceDictationSilenceSec] = useState(2);
  const [readAloudMessages, setReadAloudMessages] = useState(false);
  const readAloudRef = useRef(readAloudMessages);
  const [kioskVoiceRedirectEnabled, setKioskVoiceRedirectEnabled] = useState(false);
  const kioskVoiceRedirectRef = useRef(false);
  const kioskClientOnlineRef = useRef(false);
  /** Drives UI (orb visibility) when the kiosk is reachable; refs stay hot for handlers inside `onSubmit`. */
  const [kioskClientOnline, setKioskClientOnline] = useState(false);
  const kioskStreamDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [ttsPlayingTurnId, setTtsPlayingTurnId] = useState<string | null>(null);
  const [ttsGeneratingTurnId, setTtsGeneratingTurnId] = useState<string | null>(null);
  const [chatTtsLastError, setChatTtsLastError] = useState<{ turnId: string; message: string } | null>(null);
  /** True only while the chat audio element is in `playing` (not during fetch/generate). */
  const [ttsPlaybackActive, setTtsPlaybackActive] = useState(false);
  const [ttsTraceOpenTurnId, setTtsTraceOpenTurnId] = useState<string | null>(null);
  const [ttsTrace, setTtsTrace] = useState<TtsTrace | null>(null);
  const [ttsTraceBusy, setTtsTraceBusy] = useState(false);
  const [ttsTraceError, setTtsTraceError] = useState<string | null>(null);
  const [sttRecording, setSttRecording] = useState(false);
  const [sttTranscribing, setSttTranscribing] = useState(false);
  const [sttError, setSttError] = useState<string | null>(null);
  const [sttCapabilityError, setSttCapabilityError] = useState<string | null>(null);
  const chatTtsAudioRef = useRef<HTMLAudioElement | null>(null);
  /** Outer wrapper: scale pulse from voice amplitude. */
  const novaTtsOrbMeterRef = useRef<HTMLDivElement | null>(null);
  /** Three.js orb from Animation project — `setSpeechLevel` driven by TTS analyser. */
  const novaThreeSpeakingOrbRef = useRef<NovaThreeSpeakingOrbHandle | null>(null);
  /** Latest unified emotion label (drives TTS orb palette). */
  const chatTtsOrbEmotionLabelRef = useRef<string>("neutral");
  const chatTtsOrbDriver = useMemo(
    () =>
      new TtsVoiceOrbDriver({
        getOrb: () => novaThreeSpeakingOrbRef.current,
        getMeter: () => novaTtsOrbMeterRef.current,
        getEmotionLabel: () => chatTtsOrbEmotionLabelRef.current,
        requireMeterForAttach: true,
        enableMoodFromEmotion: true,
        enablePeriodicDirectionFlip: true
      }),
    []
  );
  /** Agent `/v1/voice/stt-status`: whether server mic transcription is available. */
  const sttServerConfiguredRef = useRef<boolean | null>(null);
  const lastWebSpeechEndAtRef = useRef(0);
  const chatTtsObjectUrlRef = useRef<string | null>(null);
  const chatTtsFetchAbortRef = useRef<AbortController | null>(null);
  const chatSttRecorderRef = useRef<MediaRecorder | null>(null);
  const chatSttChunksRef = useRef<BlobPart[]>([]);
  const chatMicSilenceRafRef = useRef<number | null>(null);
  const chatMicSilenceCtxRef = useRef<AudioContext | null>(null);
  const chatMicHeardSpeechRef = useRef(false);
  const chatWebSpeechEnergyRafRef = useRef<number | null>(null);
  const chatWebSpeechEnergyCtxRef = useRef<AudioContext | null>(null);
  const chatWebSpeechEnergyStreamRef = useRef<MediaStream | null>(null);
  const chatWebSpeechLastVoiceAtRef = useRef(0);
  const sttWebAcceptedChunksRef = useRef<string[]>([]);
  const chatSttWebRecognitionRef = useRef<SpeechRecognition | null>(null);
  const sttWebSpeechPrefixRef = useRef("");
  /** Session-scoped clips: key = turnId + normalized TTS text (evicted after MAX_SESSION_TTS_AUDIO_CACHE). */
  const chatTtsBlobCacheRef = useRef<Map<string, { blob: Blob; mime: string }>>(new Map());
  const chatTtsCacheOrderRef = useRef<string[]>([]);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>("thinking");
  const webSearchDepthRef = useRef(0);
  const lastStreamRawRef = useRef("");
  const streamAbortRef = useRef<AbortController | null>(null);
  const chatFormRef = useRef<HTMLFormElement | null>(null);
  const dictationAutoSendTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const messageRef = useRef("");
  /** True only when the current composer draft was produced/modified by STT, never by keyboard typing. */
  const messageDraftHasVoiceInputRef = useRef(false);
  const loadingRef = useRef(false);
  const voiceDictationAutoSendRef = useRef(false);
  const voiceDictationSilenceSecRef = useRef(2);
  const sttTranscribingRef = useRef(false);
  const sttRecordingRef = useRef(false);
  const voiceContinuousConversationRef = useRef(false);
  /** After TTS ends, prefer server STT once (Web Speech often fails to pick up audio right after playback). */
  const preferServerSttAfterTtsRef = useRef(false);
  /** True only for the assistant reply to a user message sent via mic (or dictation auto-send). */
  const replyChainsVoiceListeningRef = useRef(false);
  /** Set immediately before programmatic submit from dictation silence timer. */
  const voiceDictationAutoSubmitRef = useRef(false);
  const startMicTranscriptionRef = useRef<(() => Promise<void>) | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);
  const [autoScrollEnabled, setAutoScrollEnabled] = useState(true);
  const [lastCopiedTurnId, setLastCopiedTurnId] = useState<string | null>(null);
  const [sessionDeleteConfirmOpen, setSessionDeleteConfirmOpen] = useState(false);
  const sessionDeletePopoverRef = useRef<HTMLDivElement | null>(null);
  const chatOptionsPopoverRef = useRef<HTMLDivElement | null>(null);
  const sessionRenameInputRef = useRef<HTMLInputElement | null>(null);
  const rootFileDragDepthRef = useRef(0);
  const chatComposerFileInputRef = useRef<HTMLInputElement | null>(null);
  const [sessionRenameOpen, setSessionRenameOpen] = useState(false);
  const [sessionRenameDraft, setSessionRenameDraft] = useState("");
  const [chatOptionsOpen, setChatOptionsOpen] = useState(false);
  const hasLoadedSessionsRef = useRef(false);
  const hasDoneInitialBottomScrollRef = useRef(false);
  const uploadPreviewUrlsRef = useRef<Map<string, string>>(new Map());
  const compactActionClass = "inline-flex h-9 min-w-9 items-center justify-center px-2";
  const bubbleIconActionClass =
    "inline-flex h-7 w-7 items-center justify-center transition-[filter] hover:brightness-110";
  const { setShellHeaderExtras } = useShellHeaderExtras();
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

  const kioskPresentationActive = kioskVoiceRedirectEnabled && kioskClientOnline;

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
    setSessionRenameOpen(false);
    setChatOptionsOpen(false);
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
    if (!chatOptionsOpen) return;
    function onPointerDown(event: MouseEvent): void {
      const el = chatOptionsPopoverRef.current;
      if (el && !el.contains(event.target as Node)) {
        setChatOptionsOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setChatOptionsOpen(false);
      }
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [chatOptionsOpen]);

  useEffect(() => {
    if (!sessionRenameOpen) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") {
        setSessionRenameOpen(false);
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [sessionRenameOpen]);

  useLayoutEffect(() => {
    if (!sessionRenameOpen) return;
    const id = requestAnimationFrame(() => {
      sessionRenameInputRef.current?.focus();
      sessionRenameInputRef.current?.select();
    });
    return () => cancelAnimationFrame(id);
  }, [sessionRenameOpen]);

  useEffect(() => {
    if (!loading) return;
    let active = true;
    const loadThought = async () => {
      const response = await apiFetch("/api/thoughts?limit=8");
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
        const response = await apiFetch("/api/settings");
        const data = (await response.json()) as {
          settings?: {
            web?: {
              hideProviderModelInStats?: boolean;
              sendOnEnter?: boolean;
              voiceDictationAutoSend?: boolean;
              voiceDictationSilenceSec?: number;
              voiceContinuousConversation?: boolean;
              readAloudMessages?: boolean;
              kioskVoiceRedirectEnabled?: boolean;
              showThinkingInChat?: boolean;
              textScale?: "normal" | "medium" | "big";
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
          setVoiceDictationAutoSend(data.settings?.web?.voiceDictationAutoSend === true);
          setVoiceContinuousConversation(data.settings?.web?.voiceContinuousConversation === true);
          {
            const s = Number(data.settings?.web?.voiceDictationSilenceSec);
            setVoiceDictationSilenceSec(
              Number.isFinite(s) ? Math.min(4, Math.max(1, Math.round(s))) : 2
            );
          }
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
          setReadAloudMessages(data.settings?.web?.readAloudMessages === true);
          setKioskVoiceRedirectEnabled(data.settings?.web?.kioskVoiceRedirectEnabled === true);
          setShowThinkingInChat(data.settings?.web?.showThinkingInChat !== false);
          {
            const ts = data.settings?.web?.textScale;
            if (ts === "medium" || ts === "big" || ts === "normal") {
              try {
                document.documentElement.setAttribute("data-text-scale", ts);
              } catch {
                /* ignore */
              }
            }
          }
          try {
            const legacyRa = window.localStorage.getItem("nova-chat-read-aloud");
            if (legacyRa === "1" && data.settings?.web?.readAloudMessages !== true) {
              await apiFetch("/api/settings", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ web: { readAloudMessages: true } })
              });
              setReadAloudMessages(true);
            }
            window.localStorage.removeItem("nova-chat-read-aloud");
            const legacyTs = window.localStorage.getItem("nova:text-scale");
            const serverTs = data.settings?.web?.textScale;
            if (
              (legacyTs === "medium" || legacyTs === "big") &&
              (serverTs === "normal" || serverTs === undefined)
            ) {
              await apiFetch("/api/settings", {
                method: "PUT",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ web: { textScale: legacyTs } })
              });
              try {
                document.documentElement.setAttribute("data-text-scale", legacyTs);
              } catch {
                /* ignore */
              }
            }
            window.localStorage.removeItem("nova:text-scale");
          } catch {
            /* ignore migration */
          }
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
    kioskVoiceRedirectRef.current = kioskVoiceRedirectEnabled;
  }, [kioskVoiceRedirectEnabled]);

  useEffect(() => {
    if (!kioskVoiceRedirectEnabled) {
      kioskClientOnlineRef.current = false;
      setKioskClientOnline(false);
      return;
    }
    let cancelled = false;
    const poll = async (): Promise<void> => {
      try {
        const r = await apiFetch("/api/kiosk/status");
        const d = (await r.json().catch(() => ({}))) as { alive?: boolean };
        if (!cancelled) {
          const online = r.ok && d.alive === true;
          kioskClientOnlineRef.current = online;
          setKioskClientOnline(online);
        }
      } catch {
        if (!cancelled) {
          kioskClientOnlineRef.current = false;
          setKioskClientOnline(false);
        }
      }
    };
    void poll();
    const id = setInterval(() => void poll(), 5000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [kioskVoiceRedirectEnabled]);

  useEffect(() => {
    const pull = async (): Promise<void> => {
      try {
        const response = await fetch(`/api/emotion/state?userId=${encodeURIComponent(WEB_CHAT_EMOTION_USER_ID)}`, {
          credentials: "include"
        });
        const data = (await response.json()) as { state?: { label?: string } | null };
        const next = (data.state?.label ?? "neutral").trim().toLowerCase();
        chatTtsOrbEmotionLabelRef.current = next.length ? next : "neutral";
      } catch {
        // Keep last label on transient failures.
      }
    };
    void pull();
    const onRefresh = (): void => {
      void pull();
    };
    window.addEventListener(NOVA_EMOTION_REFRESH_EVENT, onRefresh);
    return () => {
      window.removeEventListener(NOVA_EMOTION_REFRESH_EVENT, onRefresh);
    };
  }, []);

  const teardownChatTtsWebAudio = useCallback(() => {
    chatTtsOrbDriver.teardownAudioGraph();
  }, [chatTtsOrbDriver]);

  const teardownChatTtsWebAudioRef = useRef(teardownChatTtsWebAudio);
  teardownChatTtsWebAudioRef.current = teardownChatTtsWebAudio;

  const disarmWebSpeechEnergyGate = useCallback(() => {
    if (chatWebSpeechEnergyRafRef.current != null) {
      cancelAnimationFrame(chatWebSpeechEnergyRafRef.current);
      chatWebSpeechEnergyRafRef.current = null;
    }
    const stream = chatWebSpeechEnergyStreamRef.current;
    chatWebSpeechEnergyStreamRef.current = null;
    if (stream) {
      try {
        stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore stream stop failures.
      }
    }
    const ctx = chatWebSpeechEnergyCtxRef.current;
    chatWebSpeechEnergyCtxRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => {
        // Ignore close failures.
      });
    }
    chatWebSpeechLastVoiceAtRef.current = 0;
  }, []);

  const armWebSpeechEnergyGate = useCallback(async () => {
    disarmWebSpeechEnergyGate();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    chatWebSpeechEnergyStreamRef.current = stream;
    const win = typeof window !== "undefined" ? window : undefined;
    const AudioCtor = win?.AudioContext ?? (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) return;
    const ctx = new AudioCtor();
    chatWebSpeechEnergyCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.22;
    source.connect(analyser);
    const buf = new Float32Array(analyser.fftSize);
    const tick = (): void => {
      analyser.getFloatTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] ?? 0;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, buf.length));
      if (rms > NOVA_CHAT_WEB_SPEECH_ENERGY_RMS_THRESHOLD) {
        chatWebSpeechLastVoiceAtRef.current = performance.now();
      }
      chatWebSpeechEnergyRafRef.current = requestAnimationFrame(tick);
    };
    chatWebSpeechEnergyRafRef.current = requestAnimationFrame(tick);
  }, [disarmWebSpeechEnergyGate]);

  const refreshSttServerConfigured = useCallback(async (force = false): Promise<boolean> => {
    if (!force && sttServerConfiguredRef.current !== null) {
      return sttServerConfiguredRef.current;
    }
    try {
      const r = await apiFetch("/api/voice/stt-status");
      const j = (await r.json()) as { configured?: boolean };
      sttServerConfiguredRef.current = Boolean(j.configured);
    } catch {
      sttServerConfiguredRef.current = false;
    }
    return sttServerConfiguredRef.current ?? false;
  }, []);

  useEffect(() => {
    void refreshSttServerConfigured(false);
  }, [refreshSttServerConfigured]);

  const attachTtsVoiceOrbDriver = useCallback(
    (el: HTMLAudioElement) => {
      chatTtsOrbDriver.attach(el);
    },
    [chatTtsOrbDriver]
  );

  const stopChatTtsPlayback = useCallback((opts?: { naturalTtsEnd?: boolean }) => {
    if (!opts?.naturalTtsEnd) {
      preferServerSttAfterTtsRef.current = false;
    }
    chatTtsOrbDriver.stopDriving();
    chatTtsFetchAbortRef.current?.abort();
    chatTtsFetchAbortRef.current = null;
    const el = chatTtsAudioRef.current;
    if (el) {
      el.onplaying = null;
      el.onended = null;
      el.pause();
      el.removeAttribute("src");
      void el.load();
    }
    if (chatTtsObjectUrlRef.current) {
      URL.revokeObjectURL(chatTtsObjectUrlRef.current);
      chatTtsObjectUrlRef.current = null;
    }
    setTtsPlaybackActive(false);
    setTtsPlayingTurnId(null);
    setTtsGeneratingTurnId(null);
    if (opts?.naturalTtsEnd) {
      const chainFromVoiceSend = replyChainsVoiceListeningRef.current;
      replyChainsVoiceListeningRef.current = false;
      if (chainFromVoiceSend) {
        preferServerSttAfterTtsRef.current = true;
      }
      window.setTimeout(() => {
        if (!voiceContinuousConversationRef.current || !chainFromVoiceSend) return;
        if (loadingRef.current || sttTranscribingRef.current || sttRecordingRef.current) return;
        if (getMicCapabilityError()) return;
        void startMicTranscriptionRef.current?.();
      }, 1100);
    }
  }, [chatTtsOrbDriver]);

  const persistSendOnEnter = useCallback(async (next: boolean) => {
    setSendOnEnter(next);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ web: { sendOnEnter: next } })
      });
    } catch {
      // Ignore save failures for this optional UX preference.
    }
  }, []);

  const persistVoiceDictationAutoSend = useCallback(async (next: boolean) => {
    setVoiceDictationAutoSend(next);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ web: { voiceDictationAutoSend: next } })
      });
    } catch {
      // Ignore save failures for this optional UX preference.
    }
  }, []);

  const persistVoiceContinuousConversation = useCallback(async (next: boolean) => {
    setVoiceContinuousConversation(next);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ web: { voiceContinuousConversation: next } })
      });
    } catch {
      // Ignore save failures for this optional UX preference.
    }
  }, []);

  const persistShowThinkingInChat = useCallback(async (next: boolean) => {
    setShowThinkingInChat(next);
    try {
      await apiFetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ web: { showThinkingInChat: next } })
      });
    } catch {
      // Ignore save failures for this optional UX preference.
    }
  }, []);

  useEffect(() => {
    messageRef.current = message;
  }, [message]);
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  useEffect(() => {
    voiceDictationAutoSendRef.current = voiceDictationAutoSend;
  }, [voiceDictationAutoSend]);
  useEffect(() => {
    voiceDictationSilenceSecRef.current = voiceDictationSilenceSec;
  }, [voiceDictationSilenceSec]);
  useEffect(() => {
    sttTranscribingRef.current = sttTranscribing;
  }, [sttTranscribing]);
  useEffect(() => {
    sttRecordingRef.current = sttRecording;
  }, [sttRecording]);
  useEffect(() => {
    voiceContinuousConversationRef.current = voiceContinuousConversation;
  }, [voiceContinuousConversation]);

  useEffect(() => {
    if (!voiceDictationAutoSend || loading || sttTranscribing) {
      if (dictationAutoSendTimerRef.current) {
        clearTimeout(dictationAutoSendTimerRef.current);
        dictationAutoSendTimerRef.current = null;
      }
      return;
    }
    const trimmed = message.trim();
    if (!trimmed || !messageDraftHasVoiceInputRef.current) {
      if (dictationAutoSendTimerRef.current) {
        clearTimeout(dictationAutoSendTimerRef.current);
        dictationAutoSendTimerRef.current = null;
      }
      return;
    }
    const ms = Math.round(Math.min(4, Math.max(1, voiceDictationSilenceSec)) * 1000);
    if (dictationAutoSendTimerRef.current) {
      clearTimeout(dictationAutoSendTimerRef.current);
    }
    dictationAutoSendTimerRef.current = setTimeout(() => {
      dictationAutoSendTimerRef.current = null;
      if (!voiceDictationAutoSendRef.current || loadingRef.current || sttTranscribingRef.current) return;
      const m = messageRef.current.trim();
      if (!m || !messageDraftHasVoiceInputRef.current) return;
      voiceDictationAutoSubmitRef.current = true;
      chatFormRef.current?.requestSubmit();
    }, ms);
    return () => {
      if (dictationAutoSendTimerRef.current) {
        clearTimeout(dictationAutoSendTimerRef.current);
        dictationAutoSendTimerRef.current = null;
      }
    };
  }, [message, voiceDictationAutoSend, voiceDictationSilenceSec, loading, sttTranscribing]);

  const toggleReadAloudHeader = useCallback(
    (next: boolean) => {
      setReadAloudMessages(next);
      void (async () => {
        try {
          await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ web: { readAloudMessages: next } })
          });
        } catch {
          // Ignore save failures for this optional UX preference.
        }
      })();
      if (!next) {
        stopChatTtsPlayback();
      }
    },
    [stopChatTtsPlayback]
  );

  useEffect(() => () => stopChatTtsPlayback(), [stopChatTtsPlayback]);

  useEffect(
    () => () => {
      teardownChatTtsWebAudioRef.current();
    },
    []
  );

  useEffect(() => {
    setSttCapabilityError(getMicCapabilityError());
  }, []);

  useEffect(
    () => () => {
      if (chatMicSilenceRafRef.current != null) {
        cancelAnimationFrame(chatMicSilenceRafRef.current);
        chatMicSilenceRafRef.current = null;
      }
      disarmWebSpeechEnergyGate();
      void chatMicSilenceCtxRef.current?.close().catch(() => {
        // Ignore close failures.
      });
      chatMicSilenceCtxRef.current = null;
      try {
        chatSttRecorderRef.current?.stream.getTracks().forEach((t) => t.stop());
      } catch {
        // Ignore stop failures.
      }
      try {
        chatSttWebRecognitionRef.current?.abort();
      } catch {
        // Ignore abort failures.
      }
      chatSttWebRecognitionRef.current = null;
    },
    [disarmWebSpeechEnergyGate]
  );

  useEffect(() => {
    stopChatTtsPlayback();
    chatTtsBlobCacheRef.current.clear();
    chatTtsCacheOrderRef.current.length = 0;
  }, [activeSessionId, stopChatTtsPlayback]);

  const playChatTts = useCallback(
    async (turnId: string, rawText: string): Promise<void> => {
      const cleaned = stripMarkdownForTts(rawText);
      if (!cleaned.trim()) {
        return;
      }
      setChatTtsLastError(null);
      const key = chatTtsCacheKey(turnId, cleaned);
      const map = chatTtsBlobCacheRef.current;
      const order = chatTtsCacheOrderRef.current;
      const cached = map.get(key);
      stopChatTtsPlayback();

      const playBlobChunk = async (el: HTMLAudioElement, blob: Blob, runAc: AbortController): Promise<void> => {
        if (chatTtsObjectUrlRef.current) {
          URL.revokeObjectURL(chatTtsObjectUrlRef.current);
          chatTtsObjectUrlRef.current = null;
        }
        const objectUrl = URL.createObjectURL(blob);
        chatTtsObjectUrlRef.current = objectUrl;
        el.src = objectUrl;
        el.onplaying = () => {
          setTtsPlaybackActive(true);
          requestAnimationFrame(() => {
            requestAnimationFrame(() => attachTtsVoiceOrbDriver(el));
          });
        };
        await loadAudioElementThenPlay(el);
        await new Promise<void>((resolve, reject) => {
          const onEnded = () => {
            cleanup();
            resolve();
          };
          const onError = () => {
            cleanup();
            reject(new Error("tts playback failed"));
          };
          const onAbort = () => {
            cleanup();
            reject(new DOMException("Aborted", "AbortError"));
          };
          const cleanup = () => {
            el.removeEventListener("ended", onEnded);
            el.removeEventListener("error", onError);
            runAc.signal.removeEventListener("abort", onAbort);
          };
          el.addEventListener("ended", onEnded, { once: true });
          el.addEventListener("error", onError, { once: true });
          runAc.signal.addEventListener("abort", onAbort, { once: true });
        });
      };

      const fetchTtsBlob = async (text: string, runAc: AbortController): Promise<{ blob: Blob; mime: string }> => {
        const response = await apiFetch("/api/voice/speak-audio", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
          signal: runAc.signal
        });
        if (!response.ok) {
          const errBody = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(errBody.error?.trim() || `tts request failed (${response.status})`);
        }
        const mime = response.headers.get("content-type") ?? "audio/wav";
        const blob = await response.blob();
        return { blob, mime };
      };

      if (cached) {
        touchChatTtsCacheOrder(order, key);
        const el = chatTtsAudioRef.current;
        if (!el) {
          return;
        }
        const ac = new AbortController();
        chatTtsFetchAbortRef.current = ac;
        setTtsPlayingTurnId(turnId);
        try {
          await playBlobChunk(el, cached.blob.slice(), ac);
          stopChatTtsPlayback({ naturalTtsEnd: true });
        } catch (err) {
          const aborted = err instanceof DOMException && err.name === "AbortError";
          if (!aborted) {
            const message = err instanceof Error ? err.message : String(err);
            setChatTtsLastError({ turnId, message });
            stopChatTtsPlayback();
          }
        } finally {
          if (chatTtsFetchAbortRef.current === ac) {
            chatTtsFetchAbortRef.current = null;
          }
        }
        return;
      }

      const chunks = splitTextForTts(cleaned);
      const ac = new AbortController();
      chatTtsFetchAbortRef.current = ac;
      setTtsGeneratingTurnId(turnId);
      try {
        const el = chatTtsAudioRef.current;
        if (!el) {
          setTtsGeneratingTurnId(null);
          return;
        }
        let currentFetch = fetchTtsBlob(chunks[0]!, ac);
        const cachedParts: Blob[] = [];
        let mime = "audio/wav";
        setTtsGeneratingTurnId(null);
        setTtsPlayingTurnId(turnId);
        for (let i = 0; i < chunks.length; i++) {
          const current = await currentFetch;
          cachedParts.push(current.blob.slice());
          mime = current.mime || mime;
          const nextIndex = i + 1;
          currentFetch =
            nextIndex < chunks.length ? fetchTtsBlob(chunks[nextIndex]!, ac) : Promise.resolve(current);
          await playBlobChunk(el, current.blob, ac);
        }
        const blob = new Blob(cachedParts, { type: mime });
        rememberChatTtsBlob(map, order, key, { blob: blob.slice(), mime });
        stopChatTtsPlayback({ naturalTtsEnd: true });
      } catch (err) {
        const aborted = err instanceof DOMException && err.name === "AbortError";
        if (!aborted) {
          const message = err instanceof Error ? err.message : String(err);
          setChatTtsLastError({ turnId, message });
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
    [stopChatTtsPlayback, attachTtsVoiceOrbDriver]
  );

  const playChatTtsOrKiosk = useCallback(
    async (turnId: string, visible: string): Promise<void> => {
      if (kioskVoiceRedirectRef.current && kioskClientOnlineRef.current) {
        const cleaned = stripMarkdownForTts(visible);
        const response = await apiFetch("/api/kiosk/publish", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            type: "assistant_output",
            turnId,
            markdown: visible,
            ttsText: cleaned.trim() ? cleaned : ""
          })
        });
        if (response.ok) {
          const data = (await response.json().catch(() => ({}))) as { delivered?: number };
          if ((data.delivered ?? 0) > 0) {
            return;
          }
        }
      }
      await playChatTts(turnId, visible);
    },
    [playChatTts]
  );

  const clearKioskAssistantMarkdownSchedule = useCallback((): void => {
    if (kioskStreamDebounceRef.current) {
      clearTimeout(kioskStreamDebounceRef.current);
      kioskStreamDebounceRef.current = null;
    }
  }, []);

  const scheduleKioskAssistantMarkdown = useCallback((markdown: string): void => {
    if (!kioskVoiceRedirectRef.current || !kioskClientOnlineRef.current) {
      return;
    }
    if (kioskStreamDebounceRef.current) {
      clearTimeout(kioskStreamDebounceRef.current);
    }
    kioskStreamDebounceRef.current = setTimeout(() => {
      kioskStreamDebounceRef.current = null;
      void apiFetch("/api/kiosk/publish", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ type: "assistant_delta", markdown })
      });
    }, 110);
  }, []);

  const downloadChatTtsForTurn = useCallback(async (turnId: string, rawText: string): Promise<void> => {
    const cleaned = stripMarkdownForTts(rawText);
    if (!cleaned.trim()) return;
    const key = chatTtsCacheKey(turnId, cleaned);
    const map = chatTtsBlobCacheRef.current;
    const order = chatTtsCacheOrderRef.current;
    const cached = map.get(key);
    let blob: Blob;
    let mime: string;
    if (cached) {
      blob = cached.blob;
      mime = cached.mime;
      touchChatTtsCacheOrder(order, key);
    } else {
      const response = await apiFetch("/api/voice/speak-audio", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: cleaned })
      });
      if (!response.ok) return;
      blob = await response.blob();
      mime = response.headers.get("content-type") ?? "audio/wav";
      rememberChatTtsBlob(map, order, key, { blob: blob.slice(), mime });
    }
    triggerBlobDownload(blob, mime, `nova-chat-${turnId.slice(0, 12)}`);
  }, []);

  const openTtsTraceForTurn = useCallback(async (turnId: string, rawText: string): Promise<void> => {
    const cleaned = stripMarkdownForTts(rawText);
    setTtsTraceOpenTurnId(turnId);
    setTtsTrace(null);
    setTtsTraceError(null);
    if (!cleaned.trim()) {
      setTtsTraceError("Nothing to speak after cleanup.");
      return;
    }
    setTtsTraceBusy(true);
    try {
      const response = await apiFetch("/api/voice/tts-trace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: cleaned })
      });
      const data = (await response.json().catch(() => ({}))) as TtsTrace & { error?: string };
      if (!response.ok) {
        setTtsTraceError(data.error || `tts-trace failed (${response.status})`);
        return;
      }
      setTtsTrace(data);
    } catch (e) {
      setTtsTraceError(e instanceof Error ? e.message : String(e));
    } finally {
      setTtsTraceBusy(false);
    }
  }, []);

  function stopGeneration(): void {
    clearKioskAssistantMarkdownSchedule();
    streamAbortRef.current?.abort();
    stopChatTtsPlayback();
  }

  function disarmChatMicSilenceMonitor(): void {
    if (chatMicSilenceRafRef.current != null) {
      cancelAnimationFrame(chatMicSilenceRafRef.current);
      chatMicSilenceRafRef.current = null;
    }
    const ctx = chatMicSilenceCtxRef.current;
    chatMicSilenceCtxRef.current = null;
    if (ctx) {
      void ctx.close().catch(() => {
        // Ignore close failures.
      });
    }
  }

  function armChatMicSilenceMonitor(stream: MediaStream, recorder: MediaRecorder): void {
    disarmChatMicSilenceMonitor();
    const win = typeof window !== "undefined" ? window : undefined;
    const AudioCtor = win?.AudioContext ?? (win as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtor) {
      return;
    }
    const ctx = new AudioCtor();
    chatMicSilenceCtxRef.current = ctx;
    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.28;
    try {
      source.connect(analyser);
    } catch {
      disarmChatMicSilenceMonitor();
      return;
    }

    const silenceMs = Math.min(4000, Math.max(1000, Math.round(voiceDictationSilenceSecRef.current * 1000)));
    const t0 = performance.now();
    let heardSpeech = false;
    let lastAbove = t0;
    const buf = new Float32Array(analyser.fftSize);

    const tick = (): void => {
      if (recorder.state !== "recording") {
        disarmChatMicSilenceMonitor();
        return;
      }
      analyser.getFloatTimeDomainData(buf);
      let sumSq = 0;
      for (let i = 0; i < buf.length; i++) {
        const v = buf[i] ?? 0;
        sumSq += v * v;
      }
      const rms = Math.sqrt(sumSq / Math.max(1, buf.length));
      const now = performance.now();
      if (rms > NOVA_CHAT_MIC_SILENCE_RMS_THRESHOLD) {
        heardSpeech = true;
        chatMicHeardSpeechRef.current = true;
        lastAbove = now;
      }
      const quietFor = now - lastAbove;
      const elapsed = now - t0;
      if (
        (heardSpeech && elapsed >= NOVA_CHAT_MIC_SILENCE_MIN_RECORD_MS && quietFor >= silenceMs) ||
        (!heardSpeech && elapsed >= NOVA_CHAT_STT_NO_SPEECH_STOP_MS)
      ) {
        disarmChatMicSilenceMonitor();
        try {
          if (recorder.state === "recording") {
            recorder.stop();
          }
        } catch {
          // Ignore stop failures.
        }
        return;
      }
      chatMicSilenceRafRef.current = requestAnimationFrame(tick);
    };

    chatMicSilenceRafRef.current = requestAnimationFrame(tick);
  }

  async function transcribeBlobToMessage(blob: Blob): Promise<void> {
    setSttError(null);
    setSttTranscribing(true);
    sttTranscribingRef.current = true;
    try {
      const form = new FormData();
      form.append("audio", blob, `nova-mic-${Date.now()}.webm`);
      const response = await apiFetch("/api/voice/transcribe-audio", { method: "POST", body: form });
      const data = (await response.json().catch(() => ({}))) as { text?: string; error?: string };
      if (!response.ok) {
        const raw = data.error ?? "Transcription failed.";
        if (raw.includes("Speech-to-text is not configured")) {
          sttServerConfiguredRef.current = false;
          setSttError(NOVA_CHAT_STT_SERVER_HINT);
        } else {
          setSttError(raw);
        }
        return;
      }
      const transcript = (data.text ?? "").trim();
      if (!transcript) {
        setSttError("No speech detected. Try again closer to the microphone.");
        return;
      }
      sttServerConfiguredRef.current = true;
      messageDraftHasVoiceInputRef.current = true;
      setMessage((prev) => (prev.trim().length ? `${prev.trim()} ${transcript}` : transcript));
    } catch {
      setSttError("Could not transcribe audio.");
    } finally {
      setSttTranscribing(false);
      sttTranscribingRef.current = false;
    }
  }

  async function startMediaRecorderTranscription(): Promise<void> {
    if (typeof MediaRecorder === "undefined") {
      setSttError("This browser does not support MediaRecorder microphone capture.");
      return;
    }
    disarmChatMicSilenceMonitor();
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const recorder = new MediaRecorder(stream);
    chatSttRecorderRef.current = recorder;
    chatSttChunksRef.current = [];
    chatMicHeardSpeechRef.current = false;
    recorder.ondataavailable = (event) => {
      if (event.data && event.data.size > 0) chatSttChunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      disarmChatMicSilenceMonitor();
      const chunks = chatSttChunksRef.current;
      chatSttChunksRef.current = [];
      const type = recorder.mimeType || "audio/webm";
      const blob = new Blob(chunks, { type });
      recorder.stream.getTracks().forEach((t) => t.stop());
      chatSttRecorderRef.current = null;
      setSttRecording(false);
      sttRecordingRef.current = false;
      if (chatMicHeardSpeechRef.current && blob.size >= NOVA_CHAT_STT_MIN_AUDIO_BYTES) {
        void transcribeBlobToMessage(blob);
      } else {
        setSttError("No speech detected.");
      }
      chatMicHeardSpeechRef.current = false;
    };
    recorder.start();
    armChatMicSilenceMonitor(stream, recorder);
    setSttRecording(true);
    sttRecordingRef.current = true;
  }

  async function startMicTranscription(): Promise<void> {
    if (sttRecording || sttTranscribing) return;
    setSttError(null);
    try {
      if (preferServerSttAfterTtsRef.current) {
        preferServerSttAfterTtsRef.current = false;
        const serverOk = await refreshSttServerConfigured(true);
        if (serverOk) {
          await startMediaRecorderTranscription();
          return;
        }
      }
      const capabilityError = getMicCapabilityError();
      setSttCapabilityError(capabilityError);
      if (capabilityError) {
        setSttError(capabilityError);
        return;
      }
      try {
        if (navigator.permissions?.query) {
          const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
          if (status.state === "denied") {
            setSttError("Microphone permission is blocked for this site. Allow it in browser settings.");
            return;
          }
        }
      } catch {
        // Permission API can fail on some browsers; continue to getUserMedia.
      }

      const SpeechRecCtor = getBrowserSpeechRecognitionCtor();
      if (SpeechRecCtor) {
        try {
          try {
            chatSttWebRecognitionRef.current?.abort();
          } catch {
            /* ignore */
          }
          chatSttWebRecognitionRef.current = null;
          sttWebSpeechPrefixRef.current = message.trimEnd();
          sttWebAcceptedChunksRef.current = [];
          {
            const gapSinceLastEnd = Date.now() - lastWebSpeechEndAtRef.current;
            await new Promise((r) => setTimeout(r, gapSinceLastEnd < 3200 ? 200 : 55));
          }
          const rec = new SpeechRecCtor();
          rec.continuous = true;
          rec.interimResults = false;
          rec.lang = navigator.language || "en-US";
          await armWebSpeechEnergyGate();
          rec.onresult = (event: SpeechRecognitionEvent) => {
            let changed = false;
            for (let i = event.resultIndex; i < event.results.length; i++) {
              const result = event.results[i];
              if (!result || !result.isFinal) continue;
              const alt = result[0];
              const spoken = (alt?.transcript ?? "").trim();
              if (!spoken) continue;
              if (!/[a-z0-9]/i.test(spoken)) continue;
              const confidence = typeof alt?.confidence === "number" ? alt.confidence : NaN;
              if (Number.isFinite(confidence) && confidence < 0.5) continue;
              if (spoken.length < 3) continue;
              if (looksLikeNoiseHallucination(spoken)) continue;
              const msSinceVoice = performance.now() - chatWebSpeechLastVoiceAtRef.current;
              if (msSinceVoice > NOVA_CHAT_WEB_SPEECH_ENERGY_WINDOW_MS) continue;
              sttWebAcceptedChunksRef.current.push(spoken);
              changed = true;
            }
            if (!changed) return;
            const prefix = sttWebSpeechPrefixRef.current;
            const spoken = sttWebAcceptedChunksRef.current.join(" ").trim();
            const next = spoken ? (prefix ? `${prefix} ${spoken}` : spoken) : prefix;
            messageDraftHasVoiceInputRef.current = true;
            setMessage(next.trim());
          };
          rec.onerror = (event: SpeechRecognitionErrorEvent) => {
            if (event.error === "aborted") return;
            if (chatSttWebRecognitionRef.current === rec) {
              chatSttWebRecognitionRef.current = null;
            }
            disarmWebSpeechEnergyGate();
            setSttRecording(false);
            sttRecordingRef.current = false;
            if (event.error === "not-allowed") {
              setSttError("Microphone permission denied. Allow mic access for this site.");
              return;
            }
            const tryServerStt =
              event.error === "network" ||
              event.error === "service-not-allowed" ||
              event.error === "disconnected";
            if (tryServerStt) {
              void (async () => {
                const ok = await refreshSttServerConfigured(true);
                if (!ok) {
                  setSttError(
                    "Browser speech failed (network). The agent this page talks to still reports no server STT (OPENAI_API_KEY or NOVA_STT_COMMAND), or the check could not reach it. Reload the page after fixing the agent; on LAN set NOVA_AGENT_API_URL for the web server to the Mac that runs agent-core. Otherwise fix Wi‑Fi / VPN."
                  );
                  return;
                }
                try {
                  await startMediaRecorderTranscription();
                } catch (err) {
                  setSttError(describeMicStartError(err));
                }
              })();
              return;
            }
            if (event.error !== "no-speech") {
              setSttError(`Voice recognition: ${event.error}`);
            }
          };
          rec.onend = () => {
            lastWebSpeechEndAtRef.current = Date.now();
            if (chatSttWebRecognitionRef.current === rec) {
              chatSttWebRecognitionRef.current = null;
            }
            disarmWebSpeechEnergyGate();
            if (!chatSttRecorderRef.current) {
              setSttRecording(false);
              sttRecordingRef.current = false;
            }
          };
          chatSttWebRecognitionRef.current = rec;
          {
            let started = false;
            let lastStartErr: unknown;
            for (let attempt = 0; attempt < 6; attempt++) {
              try {
                rec.start();
                started = true;
                break;
              } catch (err) {
                lastStartErr = err;
                await new Promise((r) => setTimeout(r, 85 + attempt * 55));
              }
            }
            if (!started) {
              throw lastStartErr ?? new Error("Speech recognition could not start");
            }
          }
          setSttRecording(true);
          sttRecordingRef.current = true;
          return;
        } catch {
          try {
            chatSttWebRecognitionRef.current?.abort();
          } catch {
            /* ignore */
          }
          disarmWebSpeechEnergyGate();
          chatSttWebRecognitionRef.current = null;
        }
      }

      const serverOk = await refreshSttServerConfigured(true);
      if (!serverOk) {
        setSttError(`${NOVA_CHAT_STT_SERVER_HINT} Reload after configuring the agent.`);
        return;
      }
      await startMediaRecorderTranscription();
    } catch (error) {
      setSttError(describeMicStartError(error));
    }
  }

  function stopMicTranscription(): void {
    const web = chatSttWebRecognitionRef.current;
    if (web) {
      disarmWebSpeechEnergyGate();
      try {
        web.stop();
      } catch {
        setSttRecording(false);
        sttRecordingRef.current = false;
      }
      return;
    }
    const recorder = chatSttRecorderRef.current;
    if (!recorder) return;
    disarmChatMicSilenceMonitor();
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      setSttRecording(false);
      sttRecordingRef.current = false;
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (dictationAutoSendTimerRef.current) {
      clearTimeout(dictationAutoSendTimerRef.current);
      dictationAutoSendTimerRef.current = null;
    }
    const viaVoiceAutoSend = voiceDictationAutoSubmitRef.current;
    voiceDictationAutoSubmitRef.current = false;
    sttRecordingRef.current = sttRecording;
    sttTranscribingRef.current = sttTranscribing;
    const viaVoiceDraft = messageDraftHasVoiceInputRef.current;
    replyChainsVoiceListeningRef.current = Boolean(viaVoiceDraft && (viaVoiceAutoSend || sttRecording || sttTranscribing));
    stopMicTranscription();
    const trimmed = message.trim();
    if (!trimmed || loading) return;
    clearKioskAssistantMarkdownSchedule();
    messageDraftHasVoiceInputRef.current = false;
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
        if (kioskVoiceRedirectRef.current && kioskClientOnlineRef.current && visible.trim().length > 0) {
          void apiFetch("/api/kiosk/publish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "assistant_delta", markdown: visible })
          });
        }
        if (
          readAloudRef.current &&
          visible.trim().length > 0 &&
          !visible.includes("_Stopped._") &&
          !/\/Stopped\./i.test(visible)
        ) {
          void playChatTtsOrKiosk(assistantId, visible);
        }
      } else {
        const startedAt = Date.now();
        let emotionRefreshedOnFirstToken = false;
        const response = await apiFetch("/api/chat/stream", {
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
          scheduleKioskAssistantMarkdown(visible);
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
        clearKioskAssistantMarkdownSchedule();
        if (kioskVoiceRedirectRef.current && kioskClientOnlineRef.current && visible.trim().length > 0) {
          void apiFetch("/api/kiosk/publish", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ type: "assistant_delta", markdown: visible })
          });
        }
        if (
          readAloudRef.current &&
          visible.trim().length > 0 &&
          !visible.includes("_Stopped._") &&
          !/\/Stopped\./i.test(visible)
        ) {
          void playChatTtsOrKiosk(assistantId, visible);
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
        const looksTransient =
          /network error|fetch failed|failed to fetch|load failed|connection (closed|reset|refused)|the operation could not be completed|stream failed/i.test(raw);
        const friendly = looksTransient
          ? "Nova was momentarily unreachable (the agent service was likely restarting). Please try again in a few seconds."
          : `Error: ${raw}`;
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantId
              ? { ...turn, text: friendly, thinkingText: undefined }
              : turn.id === userTurn.id
                ? { ...turn, isPending: false }
                : turn
          )
        );
      }
    } finally {
      clearKioskAssistantMarkdownSchedule();
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
      const response = await apiFetch("/api/media/upload", {
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

  const deleteActiveSession = useCallback((): void => {
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
  }, [activeSessionId, sessions]);

  const commitSessionRename = useCallback(() => {
    const next = sessionRenameDraft.trim();
    if (!next || !activeSessionId) {
      setSessionRenameOpen(false);
      return;
    }
    setSessions((prev) => prev.map((item) => (item.id === activeSessionId ? { ...item, title: next } : item)));
    setSessionRenameOpen(false);
  }, [sessionRenameDraft, activeSessionId]);

  useLayoutEffect(() => {
    setShellHeaderExtras(
      <ChatSessionHeaderControls
        sessions={sessions}
        activeSessionId={activeSessionId}
        sessionDeleteConfirmOpen={sessionDeleteConfirmOpen}
        sessionDeletePopoverRef={sessionDeletePopoverRef}
        chatOptionsPopoverRef={chatOptionsPopoverRef}
        chatOptionsOpen={chatOptionsOpen}
        setChatOptionsOpen={setChatOptionsOpen}
        voiceDictationAutoSend={voiceDictationAutoSend}
        onVoiceDictationAutoSendChange={(next) => {
          void persistVoiceDictationAutoSend(next);
        }}
        voiceContinuousConversation={voiceContinuousConversation}
        onVoiceContinuousConversationChange={(next) => {
          void persistVoiceContinuousConversation(next);
        }}
        sendOnEnter={sendOnEnter}
        onSendOnEnterChange={(next) => {
          void persistSendOnEnter(next);
        }}
        showThinkingInChat={showThinkingInChat}
        onShowThinkingChange={(next) => {
          void persistShowThinkingInChat(next);
        }}
        readAloudMessages={readAloudMessages}
        onReadAloudChange={toggleReadAloudHeader}
        onSessionChange={(sessionId) => {
          const session = sessions.find((item) => item.id === sessionId);
          if (!session) return;
          setActiveSessionId(session.id);
          setTurns(session.turns ?? []);
        }}
        onNewSession={() => {
          setSessionDeleteConfirmOpen(false);
          setChatOptionsOpen(false);
          const next = createEmptySession();
          setSessions((prev) => [next, ...prev]);
          setActiveSessionId(next.id);
          setTurns([]);
          setMessage("");
          setUploads([]);
        }}
        onRenameClick={() => {
          setSessionDeleteConfirmOpen(false);
          setChatOptionsOpen(false);
          const active = sessions.find((item) => item.id === activeSessionId);
          if (!active) return;
          setSessionRenameDraft(active.title);
          setSessionRenameOpen(true);
        }}
        onToggleDeleteMenu={() => {
          if (!activeSessionId) return;
          setChatOptionsOpen(false);
          setSessionDeleteConfirmOpen((open) => !open);
        }}
        onCancelDelete={() => setSessionDeleteConfirmOpen(false)}
        onConfirmDelete={() => deleteActiveSession()}
        closeDeletePopover={() => setSessionDeleteConfirmOpen(false)}
      />
    );
    return () => setShellHeaderExtras(null);
  }, [
    activeSessionId,
    chatOptionsOpen,
    deleteActiveSession,
    persistSendOnEnter,
    persistShowThinkingInChat,
    persistVoiceContinuousConversation,
    persistVoiceDictationAutoSend,
    readAloudMessages,
    sendOnEnter,
    voiceContinuousConversation,
    voiceDictationAutoSend,
    sessionDeleteConfirmOpen,
    sessions,
    setShellHeaderExtras,
    showThinkingInChat,
    toggleReadAloudHeader
  ]);

  startMicTranscriptionRef.current = startMicTranscription;

  return (
    <div
      className="relative flex h-full min-h-0 flex-1 flex-col overflow-hidden bg-surface"
      onDragEnter={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        rootFileDragDepthRef.current += 1;
        setDragging(true);
      }}
      onDragLeave={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        rootFileDragDepthRef.current = Math.max(0, rootFileDragDepthRef.current - 1);
        if (rootFileDragDepthRef.current === 0) {
          setDragging(false);
        }
      }}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes("Files")) {
          event.preventDefault();
        }
      }}
      onDrop={(event) => {
        if (![...event.dataTransfer.types].includes("Files")) return;
        event.preventDefault();
        rootFileDragDepthRef.current = 0;
        setDragging(false);
        addFiles(event.dataTransfer.files);
      }}
    >
      <div
        ref={chatScrollRef}
        className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden [scrollbar-gutter:stable]"
        onScroll={(event) => {
          const target = event.currentTarget;
          const distanceFromBottom = target.scrollHeight - target.scrollTop - target.clientHeight;
          const nearBottom = distanceFromBottom < 120;
          setAutoScrollEnabled(nearBottom);
        }}
      >
        <div
          className={cn(
            "space-y-2 px-6 pb-6 sm:px-7",
            chatStyleReady && turns.length > 0 ? "pt-[30px]" : "pt-2"
          )}
        >
          {!chatStyleReady ? <div className="text-sm text-muted">Loading chat style…</div> : null}
          {chatStyleReady && turns.length === 0 ? (
            <div className="flex min-h-[min(48vh,26rem)] flex-col items-center justify-center py-10">
              <div className="relative h-40 w-[min(85vw,22rem)] shrink-0">
                <Image
                  src="/brand/nova_logo.png"
                  alt="Nova"
                  fill
                  sizes="(max-width: 768px) 85vw, 22rem"
                  className="object-contain"
                  priority
                />
              </div>
            </div>
          ) : null}
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
                        content={
                          turn.role === "assistant"
                            ? stripOrpheusCuesForChatDisplay(
                                turn.text || (loading ? "..." : "")
                              )
                            : turn.text || ""
                        }
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
                          <p className="text-[11px] text-muted">Nova is synthesizing speech. Please hold on.</p>
                        </div>
                      ) : null}
                      {turn.role === "assistant" && chatTtsLastError?.turnId === turn.id ? (
                        <p className="mt-2 text-[11px] text-red-600 dark:text-red-400" role="alert">
                          Read-aloud failed: {chatTtsLastError.message}
                        </p>
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
                  <div className="-mx-0.5 overflow-x-auto overflow-y-visible pb-0.5 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
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
                        className={cn(
                          bubbleIconActionClass,
                          (ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id) &&
                            "rounded-full border border-cyan-400/45 bg-cyan-500/10",
                          ttsPlayingTurnId === turn.id && "h-7 w-auto min-w-[4.75rem] px-2"
                        )}
                        style={{ color: ensureReadableTextColor(assistantActionIconColorForTheme, isDarkTheme) }}
                        disabled={
                          !turn.text.trim() ||
                          Boolean(loading && index === turns.length - 1 && turn.role === "assistant")
                        }
                        title={
                          ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id
                            ? "Stop audio"
                            : "Read aloud — replay uses cached audio when this message unchanged (session, last 10 clips)"
                        }
                        aria-pressed={ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id}
                        onClick={() => {
                          if (ttsPlayingTurnId === turn.id || ttsGeneratingTurnId === turn.id) {
                            stopChatTtsPlayback();
                          } else {
                            void playChatTtsOrKiosk(turn.id, turn.text);
                          }
                        }}
                      >
                        {ttsPlayingTurnId === turn.id ? (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-200">
                            <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] bg-current" aria-hidden />
                            <span>Speaking</span>
                          </span>
                        ) : ttsGeneratingTurnId === turn.id ? (
                          <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] bg-current" aria-hidden />
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
                          bubbleIconActionClass,
                          "disabled:cursor-not-allowed disabled:opacity-45"
                        )}
                        style={{ color: ensureReadableTextColor(assistantActionIconColorForTheme, isDarkTheme) }}
                      >
                        <FaDownload className="h-3.5 w-3.5 shrink-0" />
                      </button>
                      <button
                        type="button"
                        disabled={!turn.text.trim()}
                        title="Show spoken transcript (what Nova actually sent to TTS after cleanup)"
                        aria-label="Show spoken transcript"
                        onClick={() => void openTtsTraceForTurn(turn.id, turn.text)}
                        className={cn(bubbleIconActionClass, "disabled:cursor-not-allowed disabled:opacity-45")}
                        style={{ color: ensureReadableTextColor(assistantActionIconColorForTheme, isDarkTheme) }}
                      >
                        TTS
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
      </div>
      <audio ref={chatTtsAudioRef} className="hidden" playsInline preload="none" />
      {ttsTraceOpenTurnId ? (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl rounded-ui border border-border bg-surface p-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-text">Spoken transcript</div>
                <div className="mt-0.5 text-[11px] text-muted">
                  Shows the exact text agent-core prepared for TTS (useful when quotes/markdown are stripped).
                </div>
              </div>
              <button
                type="button"
                className="rounded-ui border border-border bg-surface2 px-2 py-1 text-xs text-text"
                onClick={() => {
                  setTtsTraceOpenTurnId(null);
                  setTtsTrace(null);
                  setTtsTraceError(null);
                }}
              >
                Close
              </button>
            </div>
            <div className="mt-3 space-y-3">
              {ttsTraceBusy ? <div className="text-xs text-muted">Loading…</div> : null}
              {ttsTraceError ? <div className="text-xs text-rose-500">{ttsTraceError}</div> : null}
              {ttsTrace ? (
                <>
                  <div className="space-y-1">
                    <div className="text-xs font-semibold text-text">Prepared for speech</div>
                    <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-ui border border-border bg-surface2 p-2 text-[12px] text-text">
                      {ttsTrace.preparedForSpeech || ""}
                    </pre>
                  </div>
                  <details className="text-xs text-muted">
                    <summary className="cursor-pointer">Show full TTS trace JSON</summary>
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-ui border border-border bg-surface2 p-2 text-[11px] text-muted">
                      {JSON.stringify(ttsTrace, null, 2)}
                    </pre>
                  </details>
                </>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
      <div className="relative z-10 -mt-8 mb-[55px] shrink-0 bg-gradient-to-t from-surface from-15% via-surface/90 to-transparent pb-[max(0.5rem,env(safe-area-inset-bottom,0px))] pt-10">
        <form ref={chatFormRef} onSubmit={onSubmit} className="flex w-full flex-col gap-2">
          {loading ? (
            <div className="flex w-full min-h-9 items-center justify-between gap-3 border-t border-border/70 bg-surface2/50 py-2 pl-6 pr-4 backdrop-blur-sm dark:border-white/[0.06] dark:bg-white/[0.03]">
              <span className="min-w-0 text-xs text-muted sm:text-sm">Nova is generating a reply…</span>
              <button
                type="button"
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border/90 bg-surface/80 px-2.5 text-xs font-medium text-text shadow-none transition hover:bg-surface2 dark:border-white/10 dark:bg-white/[0.06] dark:hover:bg-white/[0.1]"
                onClick={() => stopGeneration()}
                title="Stop generation"
              >
                <FaStop className="h-2.5 w-2.5 opacity-80" aria-hidden />
                Stop
              </button>
            </div>
          ) : null}
          {uploads.length ? (
            <div className="px-6">
              <div className="rounded-2xl border border-border bg-surface2/90 p-2">
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
            </div>
          ) : null}
          <div className="px-6">
          <div
            className={cn(
              "flex w-full items-center gap-1.5 rounded-[22px] border bg-surface2 px-2 py-1 transition sm:gap-2 sm:px-2.5",
              dragging ? "border-sky-500/55" : "border-border"
            )}
          >
            <input
              ref={chatComposerFileInputRef}
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
            <button
              type="button"
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted transition hover:bg-black/6 dark:hover:bg-white/10"
              onClick={() => chatComposerFileInputRef.current?.click()}
              title="Add images or videos"
            >
              <FaPlus className="h-3.5 w-3.5" />
            </button>
            <textarea
              value={message}
              onChange={(event) => {
                messageDraftHasVoiceInputRef.current = false;
                if (dictationAutoSendTimerRef.current) {
                  clearTimeout(dictationAutoSendTimerRef.current);
                  dictationAutoSendTimerRef.current = null;
                }
                setMessage(event.target.value);
              }}
              onKeyDown={(event) => {
                if (!sendOnEnter) return;
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!loading && message.trim()) {
                    void onSubmit(event as unknown as FormEvent<HTMLFormElement>);
                  }
                }
              }}
              rows={1}
              placeholder="Ask anything"
              className="min-h-[36px] max-h-[180px] w-full flex-1 resize-none border-0 bg-transparent py-1.5 text-sm leading-snug text-text shadow-none outline-none ring-0 placeholder:text-muted focus:outline-none focus-visible:outline-none focus:ring-0 focus-visible:ring-0"
            />
            <div className="flex h-8 shrink-0 items-center gap-1 sm:gap-1.5">
              {uploadedMedia.length > 0 ? (
                <span className="hidden sm:inline">
                  <Badge tone="pink">{uploadedMedia.length} media</Badge>
                </span>
              ) : null}
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-medium transition",
                  sttRecording
                    ? "bg-rose-500/20 text-rose-900 dark:bg-rose-500/25 dark:text-rose-50"
                    : "bg-black/[0.06] text-text hover:bg-black/[0.09] dark:bg-white/10 dark:hover:bg-white/16",
                  (sttTranscribing || Boolean(sttCapabilityError)) && "cursor-not-allowed opacity-55"
                )}
                onClick={() => {
                  if (sttRecording) {
                    stopMicTranscription();
                  } else {
                    void startMicTranscription();
                  }
                }}
                disabled={sttTranscribing || Boolean(sttCapabilityError)}
                title={
                  sttCapabilityError
                    ? sttCapabilityError
                    : sttRecording
                      ? "Stop voice input (live text while speaking in supported browsers)"
                      : "Voice: live text in Chrome/Edge, or record and transcribe on the server"
                }
              >
                <FaMicrophone className={cn("h-3.5 w-3.5 shrink-0", sttRecording && "animate-pulse")} />
                <span className="max-[380px]:hidden">{sttRecording ? "Listening…" : sttTranscribing ? "…" : "Voice"}</span>
              </button>
              <button
                type="submit"
                disabled={loading || !message.trim()}
                title="Send message"
                className={cn(
                  "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold transition",
                  !loading && message.trim().length > 0
                    ? "bg-slate-900 text-white hover:bg-slate-800 dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100"
                    : "cursor-not-allowed bg-border/50 text-muted dark:bg-white/10 dark:text-slate-500"
                )}
              >
                <FaArrowUp className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          </div>
          {sttError || sttCapabilityError ? (
            <div className="px-6 text-center text-xs text-rose-400">{sttError ?? sttCapabilityError}</div>
          ) : null}
        </form>
      </div>
      {ttsPlaybackActive && ttsPlayingTurnId !== null && !kioskPresentationActive ? (
        <div
          className="pointer-events-none absolute left-1/2 top-[40%] z-[55] -translate-x-1/2 -translate-y-1/2"
          aria-hidden
        >
          <div
            ref={novaTtsOrbMeterRef}
            className="h-[377px] w-[377px] shrink-0 origin-center overflow-visible rounded-full bg-transparent"
          >
            <NovaThreeSpeakingOrb ref={novaThreeSpeakingOrbRef} className="h-full w-full" preset="speaking" baseColor="#ff4420" />
          </div>
        </div>
      ) : null}
      {sessionRenameOpen ? (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/55 p-4 backdrop-blur-[2px]"
          role="presentation"
          onClick={() => setSessionRenameOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="session-rename-title"
            className="w-full max-w-md rounded-2xl border border-border bg-surface2 p-5 shadow-2xl ring-1 ring-black/10 dark:ring-white/10"
            onClick={(event) => event.stopPropagation()}
          >
            <h2 id="session-rename-title" className="mb-3 text-sm font-semibold text-text">
              Rename session
            </h2>
            <input
              ref={sessionRenameInputRef}
              type="text"
              value={sessionRenameDraft}
              onChange={(event) => setSessionRenameDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  commitSessionRename();
                }
              }}
              className="mb-4 w-full rounded-xl border border-border bg-surface px-3 py-2 text-sm text-text outline-none ring-0 focus:outline-none focus:ring-0"
            />
            <div className="flex justify-end gap-2">
              <Button type="button" tone="neutral" className="px-4" onClick={() => setSessionRenameOpen(false)}>
                Cancel
              </Button>
              <Button type="button" tone="green" className="px-4" onClick={() => commitSessionRename()}>
                Save
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
  const response = await apiFetch("/api/chat", {
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
