"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { FaChevronDown, FaCopy, FaPenToSquare, FaRotateRight } from "react-icons/fa6";
import QRCode from "qrcode";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { Select } from "../../components/ui/select";
import { Checkbox } from "../../components/ui/checkbox";
import { HealthPill } from "../../components/ui/health-pill";
import {
  IdentityEvolutionGraph,
  buildIdentityTimeline,
  type ImprovementHistoryByDate,
  type TimelineFilterKey
} from "../../components/identity-evolution-graph";
import { isSkillRuntimeEnabled } from "../../lib/skill-enabled";
import {
  buildSkillBadgeMap,
  badgeClassForSkillBadgeState,
  labelForSkillBadgeState,
  type SkillBadgeState
} from "../../lib/skill-badge";
import { VoiceWakeWordPanel, OrpheusTtsPreviewCard } from "../../components/voice-settings-panel";
import { apiFetch } from "../../lib/api-fetch";
import { clearAgentRestartExpected, markAgentRestartExpected } from "../../lib/agent-restart-grace";

const SIGNAL_CAPTCHA_GENERATE_URL = "https://signalcaptchas.org/registration/generate.html";

function extractSignalCaptchaToken(raw: string): string {
  let t = raw.trim();
  if (!t) return "";
  const proto = t.toLowerCase().indexOf("signalcaptcha://");
  if (proto >= 0) {
    t = t.slice(proto + "signalcaptcha://".length).trim();
  }
  const m = t.match(/(signal-hcaptcha-[^\s"'<>]+)/i);
  if (m?.[1]) return m[1];
  const first = t.split(/\s/)[0]?.trim();
  return first ?? t;
}

function normalizeIdentityBackupGitRemote(value: string | undefined, fallback: string): string {
  const t = String(value ?? fallback).trim();
  if (!t || t.length > 128 || !/^[A-Za-z0-9._-]+$/.test(t)) {
    return fallback;
  }
  return t;
}

async function readJsonOrEmpty<T>(response: Response): Promise<T> {
  try {
    const raw = await response.text();
    if (!raw.trim()) return {} as T;
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
}

function messageLooksLikeSignalCaptchaRequired(message: string): boolean {
  return message.toLowerCase().includes("captcha");
}

type HealthCheck = { id: string; name: string; level: "green" | "orange" | "red"; detail: string; lastSuccessfulAt?: string };
type FullHealth = { level: "green" | "orange" | "red"; checks: HealthCheck[] };
type ProviderCatalog = {
  models?: {
    ollama?: Array<{ id: string }>;
    lmstudio?: Array<{ id: string }>;
    copilot?: Array<{ id: string }>;
    ollamaVision?: Array<{ id: string }>;
  };
  setup?: Record<string, { configured: boolean; details: string; steps: string[] }>;
};
type ModelPingResult = {
  provider: "ollama" | "lmstudio" | "copilot";
  healthOk: boolean;
  healthDetail?: string;
  chatOk?: boolean;
  chatDetail?: string;
  chatLatencyMs?: number;
  modelTried?: string;
};
type ChannelDebugEntry = {
  id: string;
  at: string;
  channel: "signal" | "whatsapp";
  direction: "in" | "out";
  transport?: "webhook" | "baileys" | "dispatcher" | "next_proxy" | "receive_ws";
  correlationId: string;
  peer: string;
  textPreview: string;
  trace: string[];
  reachedNova?: boolean;
  error?: string;
};
type UpdateStatus = {
  installedAt: string;
  latestPushedAt?: string;
  latestCommitSha?: string;
  latestCommitUrl?: string;
  updateAvailable: boolean;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
  lastRollback?: { at: string; toCommitSha: string };
  pendingPostUpdateProbe?: { previousCommitSha: string; appliedAt: string };
};
type SettingsState = {
  delegatedFolders: string[];
  requireApprovals: boolean;
  activeProvider: "ollama" | "lmstudio" | "copilot";
  ollama: { disabled: boolean; numPredict: number; keepAlive: string };
  lmstudio: { disabled: boolean };
  web: {
    loginEnabled: boolean;
    hideProviderModelInStats: boolean;
    sendOnEnter: boolean;
    voiceDictationAutoSend: boolean;
    voiceDictationSilenceSec: number;
    voiceContinuousConversation: boolean;
    readAloudMessages: boolean;
    showThinkingInChat: boolean;
    textScale: "normal" | "medium" | "big";
    chatStyle: {
      userBubbleColor: string;
      assistantBubbleColor: string;
      userTextColor: string;
      assistantTextColor: string;
      userActionIconColor: string;
      assistantActionIconColor: string;
      statsTextColor: string;
      userBubbleColorLight: string;
      assistantBubbleColorLight: string;
      userTextColorLight: string;
      assistantTextColorLight: string;
      userActionIconColorLight: string;
      assistantActionIconColorLight: string;
      statsTextColorLight: string;
      bubbleBackgroundEnabled: boolean;
      borderColor: string;
      borderThicknessPx: number;
      userBorderThicknessPx: number;
      assistantBorderThicknessPx: number;
      userBackgroundOpacityPct: number;
      assistantBackgroundOpacityPct: number;
      bubbleRadiusPx: number;
      showNames: boolean;
    };
  };
  learning: { enabled: boolean; idleMinutes: number; intervalMs: number; minFailuresForAutoImprove: number };
  costGovernor: {
    enabled: boolean;
    dailyBudgetUsd: number;
    qualityTier: "high" | "balanced" | "economy";
    providerPricing: { ollamaPer1k: number; lmstudioPer1k: number; copilotPer1k: number };
  };
  emotions: { enabled: boolean; expressionStyle: "subtle" | "balanced" | "expressive"; mirrorUserValence: boolean };
  memoryBear: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    searchSwitch: "0" | "1" | "2";
    storageType: "neo4j" | "rag";
    syncWrites: boolean;
  };
  sentiCore: { enabled: boolean; orchestrationMarkdownPath: string };
  orpheusTts: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    voice: string;
    model: string;
    responseFormat: "mp3" | "wav" | "opus" | "pcm" | "flac";
  };
  messagingAccess: {
    novaPhoneNumber: string;
    denyUnknownNumbers: boolean;
    channelTiers: {
      signal: Array<{ phone: string; tier: "admin" | "co_admin" | "restricted" | "guest" }>;
      whatsapp: Array<{ phone: string; tier: "admin" | "co_admin" | "restricted" | "guest" }>;
    };
    systemAdmins: string[];
    guests: string[];
    importantPeople: Array<{
      phone: string;
      permissions: {
        cameraAccess: boolean;
        shellAccess: boolean;
        securityCenterAccess: boolean;
        schedulerAccess: boolean;
      };
    }>;
  };
  shell: { timeoutMs: number; maxOutputBytes: number };
  skills: { isolationEnabled: boolean; timeoutMs: number; maxMemoryMb: number; skillAuthoringDisabled: boolean };
  identityBackup: { enabled: boolean; intervalDays: number; labelPrefix: string; gitRemote: string };
  models: { defaultByProvider: { ollama: string; lmstudio: string; copilot: string }; ollamaThinkingEnabled: boolean };
  copilot: { baseUrl: string; apiKey: string; defaultModel: string; disabled: boolean };
  visionProviderPriority: Array<"lmstudio" | "ollama" | "cloud">;
  vision: {
    ollamaModel: string;
    ollamaBaseUrl: string;
    lmstudioModel: string;
    lmstudioBaseUrl: string;
    cloudModel: string;
    cloudBaseUrl: string;
    cloudApiKey: string;
    swapLocalModelsForVision: boolean;
  };
  updates: { enabled: boolean; checkIntervalMs: number; repoOwner: string; repoName: string; channel: "stable" | "beta"; autoApply: boolean };
  offlineMode: { enabled: boolean };
  skillSettings: Record<string, Record<string, unknown>>;
};
type SkillManifest = {
  id: string;
  name: string;
  description: string;
  settingsTab?: { id: string; label: string; tone?: "blue" | "purple" | "orange" | "green" | "pink" | "yellow"; description?: string };
};
type PersonaState = {
  id: string;
  voice: string;
  style: string[];
  systemPrompt: string;
};
type PersonaVersion = { version: number; createdAt: string };
type BackupRunState = { status?: "success" | "failed"; createdAt?: string; branch?: string; error?: string } | null;
type WebsiteProject = { id: string; name: string; domain: string; subdomain: string; local_path: string; remote_www_root: string; remote_subfolder: string };
type SetupCheckResult = { ok: boolean; detail: string };
type SignalBootstrapResult = {
  ok?: boolean;
  bridge?: SetupCheckResult;
  detail?: string;
  executedCommand?: string;
  receiveWebhookUrl?: string;
  dockerSnippet?: string;
  nextStep?: string;
  suggestedEnv?: string;
  error?: string;
};
type WhatsAppWebBridgeStatus = {
  state?: "idle" | "starting" | "qr" | "connected" | "reconnecting" | "logged_out" | "error";
  qr?: string;
  detail?: string;
  connected?: boolean;
  startedAt?: string;
  lastEventAt?: string;
  lastDisconnectCode?: number;
  lastDisconnectMessage?: string;
  lastConnection?: string;
  authDir?: string;
};
type SshTestResult = { ok: boolean; detail: string } | null;

const DEFAULT_SETTINGS: SettingsState = {
  delegatedFolders: [],
  requireApprovals: false,
  activeProvider: "copilot",
  ollama: { disabled: true, numPredict: 8192, keepAlive: "30m" },
  lmstudio: { disabled: true },
  web: {
    loginEnabled: true,
    hideProviderModelInStats: false,
    sendOnEnter: false,
    voiceDictationAutoSend: false,
    voiceDictationSilenceSec: 2,
    voiceContinuousConversation: false,
    readAloudMessages: false,
    showThinkingInChat: true,
    textScale: "normal",
    chatStyle: {
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
    }
  },
  learning: { enabled: true, idleMinutes: 3, intervalMs: 120000, minFailuresForAutoImprove: 2 },
  costGovernor: {
    enabled: false,
    dailyBudgetUsd: 5,
    qualityTier: "balanced",
    providerPricing: { ollamaPer1k: 0.0002, lmstudioPer1k: 0.001, copilotPer1k: 0.008 }
  },
  emotions: { enabled: true, expressionStyle: "balanced", mirrorUserValence: true },
  memoryBear: {
    enabled: true,
    baseUrl: "http://127.0.0.1:8000",
    apiKey: "",
    searchSwitch: "2",
    storageType: "neo4j",
    syncWrites: false
  },
  sentiCore: { enabled: false, orchestrationMarkdownPath: "" },
  orpheusTts: {
    enabled: true,
    baseUrl: "http://127.0.0.1:5005",
    apiKey: "",
    voice: "tara",
    model: "",
    responseFormat: "wav"
  },
  messagingAccess: {
    novaPhoneNumber: "",
    denyUnknownNumbers: true,
    channelTiers: { signal: [], whatsapp: [] },
    systemAdmins: [],
    guests: [],
    importantPeople: []
  },
  shell: { timeoutMs: 30000, maxOutputBytes: 1024 * 1024 },
  skills: { isolationEnabled: false, timeoutMs: 15000, maxMemoryMb: 256, skillAuthoringDisabled: false },
  identityBackup: { enabled: false, intervalDays: 1, labelPrefix: "nova-core", gitRemote: "" },
  models: { defaultByProvider: { ollama: "", lmstudio: "", copilot: "" }, ollamaThinkingEnabled: false },
  copilot: { baseUrl: "", apiKey: "", defaultModel: "gpt-4o-mini", disabled: false },
  visionProviderPriority: ["lmstudio", "ollama", "cloud"],
  vision: {
    ollamaModel: "",
    ollamaBaseUrl: "",
    lmstudioModel: "",
    lmstudioBaseUrl: "",
    cloudModel: "",
    cloudBaseUrl: "",
    cloudApiKey: "",
    swapLocalModelsForVision: false
  },
  updates: { enabled: false, checkIntervalMs: 1800000, repoOwner: "", repoName: "", channel: "stable", autoApply: false }
  , offlineMode: { enabled: false },
  skillSettings: {}
};

const COPILOT_PRESETS: Array<{
  id: string;
  label: string;
  baseUrl: string;
  model: string;
  note: string;
  authMode: "api-key" | "device-login";
}> = [
  {
    id: "github-models",
    label: "GitHub Models",
    baseUrl: "https://models.inference.ai.azure.com",
    model: "gpt-4o-mini",
    note: "Use a GitHub personal access token with Models access.",
    authMode: "api-key"
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    baseUrl: "https://openrouter.ai/api/v1",
    model: "openai/gpt-4o-mini",
    note: "Use your OpenRouter API key and pick any listed model id.",
    authMode: "api-key"
  },
  {
    id: "custom",
    label: "Custom OpenAI-compatible",
    baseUrl: "http://127.0.0.1:1234/v1",
    model: "gpt-4o-mini",
    note: "Works with local gateways (LM Studio, vLLM, LiteLLM, etc.) exposing /models.",
    authMode: "api-key"
  },
  {
    id: "github-device-login",
    label: "GitHub Device Login (OpenClaw-style)",
    baseUrl: "https://api.githubcopilot.com",
    model: "gpt-4o-mini",
    note: "Use one-time code login in terminal, then runtime token exchange for Copilot.",
    authMode: "device-login"
  }
];

/** Select value when Copilot routing is turned off (persisted as copilot.disabled). */
const COPILOT_MODEL_DISABLED_VALUE = "__nova_disabled__";
const OLLAMA_PROVIDER_DISABLED_VALUE = "__nova_ollama_provider_disabled__";
const LMSTUDIO_PROVIDER_DISABLED_VALUE = "__nova_lmstudio_provider_disabled__";

function firstAvailableProviderId(s: SettingsState): SettingsState["activeProvider"] {
  if (s.ollama.disabled !== true) return "ollama";
  if (s.lmstudio.disabled !== true) return "lmstudio";
  if (s.copilot.disabled !== true) return "copilot";
  return "copilot";
}

function normalizeVisionPriorityWeb(
  value: Array<"lmstudio" | "ollama" | "cloud"> | undefined
): Array<"lmstudio" | "ollama" | "cloud"> {
  const defaults: Array<"lmstudio" | "ollama" | "cloud"> = ["lmstudio", "ollama", "cloud"];
  const raw = Array.isArray(value) && value.length > 0 ? value : defaults;
  const seen = new Set<"lmstudio" | "ollama" | "cloud">();
  const out: Array<"lmstudio" | "ollama" | "cloud"> = [];
  for (const item of raw) {
    if (item === "lmstudio" || item === "ollama" || item === "cloud") {
      if (!seen.has(item)) {
        seen.add(item);
        out.push(item);
      }
    }
  }
  for (const d of defaults) {
    if (!seen.has(d)) out.push(d);
  }
  return out;
}

function patchVisionPriorityAt(
  prev: Array<"lmstudio" | "ollama" | "cloud">,
  index: 0 | 1 | 2,
  choice: "lmstudio" | "ollama" | "cloud"
): Array<"lmstudio" | "ollama" | "cloud"> {
  const next = [...prev];
  next[index] = choice;
  return normalizeVisionPriorityWeb(next);
}

function dedupeCatalogModelsById<T extends { id: string }>(models: T[]): T[] {
  const seen = new Set<string>();
  return models.filter((m) => {
    const id = m.id.trim();
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

export default function SettingsPage() {
  const { resolvedTheme } = useTheme();
  const router = useRouter();
  const [tab, setTab] = useState("general");
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [health, setHealth] = useState<FullHealth | null>(null);
  const [catalog, setCatalog] = useState<ProviderCatalog | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus | null>(null);
  const [updateApplying, setUpdateApplying] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [newFolder, setNewFolder] = useState("");
  const [backupLabel, setBackupLabel] = useState("nova-core");
  const [skillManifests, setSkillManifests] = useState<SkillManifest[]>([]);
  const [defaultPersona, setDefaultPersona] = useState<PersonaState>({
    id: "default",
    voice: "helpful",
    style: ["direct", "clear"],
    systemPrompt: "You are Nova, a practical and concise autonomous assistant."
  });
  const [personaSource, setPersonaSource] = useState<"file" | "fallback">("fallback");
  const [personaPath, setPersonaPath] = useState<string>("");
  const [personaVersions, setPersonaVersions] = useState<PersonaVersion[]>([]);
  const [improvementHistoryByDate, setImprovementHistoryByDate] = useState<ImprovementHistoryByDate>({});
  const [latestIdentityBackup, setLatestIdentityBackup] = useState<BackupRunState>(null);
  const [timelineFilters, setTimelineFilters] = useState<Record<TimelineFilterKey, boolean>>({
    persona: true,
    knowledge: true,
    backup: true
  });
  const [restoringPersonaVersion, setRestoringPersonaVersion] = useState<number | null>(null);
  const [websites, setWebsites] = useState<WebsiteProject[]>([]);
  const [signalSetupCheck, setSignalSetupCheck] = useState<SetupCheckResult | null>(null);
  const [copilotSetupOutput, setCopilotSetupOutput] = useState<string>("");
  const [copilotDeviceLoginSessionId, setCopilotDeviceLoginSessionId] = useState<string>("");
  const [copilotDeviceLoginState, setCopilotDeviceLoginState] = useState<
    "idle" | "starting" | "waiting_for_user" | "authorized" | "failed" | "cancelled"
  >("idle");
  const [copilotDeviceLoginUrl, setCopilotDeviceLoginUrl] = useState<string>("");
  const [copilotDeviceLoginCode, setCopilotDeviceLoginCode] = useState<string>("");
  const [copilotDeviceLoginLogs, setCopilotDeviceLoginLogs] = useState<string[]>([]);
  const [copilotDeviceLoginMessage, setCopilotDeviceLoginMessage] = useState<string>("");
  const [modelPingLoading, setModelPingLoading] = useState(false);
  const [modelPingResults, setModelPingResults] = useState<ModelPingResult[] | null>(null);
  const [modelPingError, setModelPingError] = useState<string | null>(null);
  const [channelsSetupMode, setChannelsSetupMode] = useState<"signal" | "whatsapp" | "both">("both");
  const [signalVerificationCode, setSignalVerificationCode] = useState("");
  const [signalRegisterStatus, setSignalRegisterStatus] = useState<SetupCheckResult | null>(null);
  const [signalRegistrationCaptcha, setSignalRegistrationCaptcha] = useState("");
  const [signalRegistrationUseVoice, setSignalRegistrationUseVoice] = useState(false);
  const [signalQrDeviceName, setSignalQrDeviceName] = useState("Nova Agent Web");
  const [signalQrLoading, setSignalQrLoading] = useState(false);
  const [signalQrImageUrl, setSignalQrImageUrl] = useState<string | null>(null);
  const [signalQrEndpoint, setSignalQrEndpoint] = useState<string | null>(null);
  const [signalAccountsLoading, setSignalAccountsLoading] = useState(false);
  const [signalLinkedAccounts, setSignalLinkedAccounts] = useState<string[] | null>(null);
  const [signalQrDismissed, setSignalQrDismissed] = useState(false);
  const [signalDockerLogsExpanded, setSignalDockerLogsExpanded] = useState(false);
  const [signalCaptchaModalOpen, setSignalCaptchaModalOpen] = useState(false);
  const [signalCaptchaModalDetail, setSignalCaptchaModalDetail] = useState("");
  const [signalCaptchaPasteDraft, setSignalCaptchaPasteDraft] = useState("");
  const [signalCaptchaBusy, setSignalCaptchaBusy] = useState(false);
  const [whatsAppQrDataUrl, setWhatsAppQrDataUrl] = useState<string | null>(null);
  const [whatsAppQrRenderError, setWhatsAppQrRenderError] = useState<string | null>(null);
  const [whatsAppLinkRunning, setWhatsAppLinkRunning] = useState(false);
  const [whatsAppInlineHint, setWhatsAppInlineHint] = useState<string | null>(null);
  const [whatsAppPollError, setWhatsAppPollError] = useState<string | null>(null);
  const [whatsAppWebStatus, setWhatsAppWebStatus] = useState<WhatsAppWebBridgeStatus | null>(null);
  const [channelDebugEntries, setChannelDebugEntries] = useState<ChannelDebugEntry[]>([]);
  const [channelDebugError, setChannelDebugError] = useState<string | null>(null);
  const [channelDebugLoading, setChannelDebugLoading] = useState(false);
  const [channelDebugAutoRefresh, setChannelDebugAutoRefresh] = useState(true);
  const [signalDockerLogs, setSignalDockerLogs] = useState("");
  const [signalDockerNote, setSignalDockerNote] = useState<string | null>(null);
  const signalDockerLogsRef = useRef<HTMLPreElement | null>(null);
  /**
   * "conversation" collapses internal transport rows into a chat-like timeline (User: …,
   * Nova typing…, Nova: response). "raw" keeps the full diagnostic trace for debugging.
   */
  const [channelDebugView, setChannelDebugView] = useState<"conversation" | "raw">("conversation");
  // Tracks consecutive failed channel-debug refreshes so a one-off blip (Next.js dev hot-reload, brief
  // 503 from agent-core) does not flash the red "Temporary connection problem" banner. Only persistent
  // (≥3 polls = ~12 s) outages are surfaced to the user.
  const channelDebugFailureCountRef = useRef(0);
  const [sshTestResult, setSshTestResult] = useState<SshTestResult>(null);
  const lastSavedChatStyleRef = useRef<string>("");
  const lastSavedVoiceSilenceSecRef = useRef<number>(DEFAULT_SETTINGS.web.voiceDictationSilenceSec);
  const [chatStyleSaveState, setChatStyleSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [voiceSilenceSaveState, setVoiceSilenceSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [sentiCoreModalOpen, setSentiCoreModalOpen] = useState(false);
  const [sentiCoreDraft, setSentiCoreDraft] = useState("");
  const [sentiCoreResolvedPath, setSentiCoreResolvedPath] = useState("");
  const [sentiCoreMissingFile, setSentiCoreMissingFile] = useState(false);
  const [sentiCoreLoading, setSentiCoreLoading] = useState(false);
  const [sentiCoreSaving, setSentiCoreSaving] = useState(false);
  const [sentiCoreModalError, setSentiCoreModalError] = useState<string | null>(null);

  const isLightMode = resolvedTheme === "light";
  const activeAssistantBubbleColor = isLightMode ? settings.web.chatStyle.assistantBubbleColorLight : settings.web.chatStyle.assistantBubbleColor;
  const activeUserBubbleColor = isLightMode ? settings.web.chatStyle.userBubbleColorLight : settings.web.chatStyle.userBubbleColor;
  const activeAssistantTextColor = isLightMode ? settings.web.chatStyle.assistantTextColorLight : settings.web.chatStyle.assistantTextColor;
  const activeUserTextColor = isLightMode ? settings.web.chatStyle.userTextColorLight : settings.web.chatStyle.userTextColor;
  const activeAssistantActionIconColor = isLightMode
    ? settings.web.chatStyle.assistantActionIconColorLight
    : settings.web.chatStyle.assistantActionIconColor;
  const activeUserActionIconColor = isLightMode
    ? settings.web.chatStyle.userActionIconColorLight
    : settings.web.chatStyle.userActionIconColor;
  const activeStatsTextColor = isLightMode ? settings.web.chatStyle.statsTextColorLight : settings.web.chatStyle.statsTextColor;

  function patchThemeChatStyle(input: {
    dark: Partial<SettingsState["web"]["chatStyle"]>;
    light: Partial<SettingsState["web"]["chatStyle"]>;
  }): void {
    setSettings((p) => ({
      ...p,
      web: {
        ...p.web,
        chatStyle: {
          ...p.web.chatStyle,
          ...(isLightMode ? input.light : input.dark)
        }
      }
    }));
  }

  useEffect(() => {
    void (async () => {
      const stateResponse = await apiFetch("/api/auth/state", { credentials: "include" });
      const stateData = (await stateResponse.json()) as { loginEnabled?: boolean };
      const loginEnabled = stateData.loginEnabled !== false;
      const meResponse = await apiFetch("/api/auth/me", { credentials: "include" });
      if (loginEnabled && !meResponse.ok) {
        await apiFetch("/api/auth/logout", { method: "POST", credentials: "include" }).catch(() => undefined);
        router.push("/login");
        return;
      }
      await Promise.all([
        loadSettings(),
        loadHealth(),
        loadCatalog(),
        loadUpdateStatus(),
        refreshWhatsAppWebStatus(),
        loadSkillManifests(),
        loadWebsites(),
        loadDefaultPersona(),
        loadPersonaVersions(),
        loadImprovementHistory(),
        loadIdentityBackupStatus()
      ]);
      setLoading(false);
    })();
  }, [router]);

  useEffect(() => {
    if (loading) return;
    const raw = typeof window !== "undefined" ? window.location.search : "";
    const q = new URLSearchParams(raw).get("tab");
    if (!q) return;
    const staticTabs = ["general", "models", "identity", "channels", "learning", "voice", "backup", "updates"];
    if (staticTabs.includes(q)) {
      setTab(q);
      return;
    }
    if (q.startsWith("skill:")) {
      const sid = q.slice("skill:".length);
      const ok = skillManifests.some((item) => (item.settingsTab?.id ?? item.id) === sid);
      if (ok) setTab(q);
    }
  }, [loading, skillManifests]);

  useEffect(() => {
    if (loading) return;
    const serialized = JSON.stringify(settings.web.chatStyle);
    if (!lastSavedChatStyleRef.current) {
      lastSavedChatStyleRef.current = serialized;
      setChatStyleSaveState("idle");
      return;
    }
    if (serialized === lastSavedChatStyleRef.current) return;
    setChatStyleSaveState("saving");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ web: { chatStyle: settings.web.chatStyle } })
          });
          if (response.ok) {
            lastSavedChatStyleRef.current = serialized;
            setChatStyleSaveState("saved");
            setTimeout(() => setChatStyleSaveState("idle"), 1200);
          } else {
            setChatStyleSaveState("error");
          }
        } catch {
          setChatStyleSaveState("error");
        }
      })();
    }, 350);
    return () => clearTimeout(timer);
  }, [settings.web.chatStyle, loading]);

  useEffect(() => {
    if (loading) return;
    const sec = settings.web.voiceDictationSilenceSec;
    if (sec === lastSavedVoiceSilenceSecRef.current) {
      setVoiceSilenceSaveState("idle");
      return;
    }
    setVoiceSilenceSaveState("saving");
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const response = await apiFetch("/api/settings", {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ web: { voiceDictationSilenceSec: sec } })
          });
          if (response.ok) {
            lastSavedVoiceSilenceSecRef.current = sec;
            setVoiceSilenceSaveState("saved");
            setTimeout(() => setVoiceSilenceSaveState("idle"), 1200);
          } else {
            setVoiceSilenceSaveState("error");
          }
        } catch {
          setVoiceSilenceSaveState("error");
        }
      })();
    }, 400);
    return () => clearTimeout(timer);
  }, [settings.web.voiceDictationSilenceSec, loading]);

  useEffect(() => {
    if (!copilotDeviceLoginSessionId) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      const response = await apiFetch(`/api/setup/copilot/device-login/status?sessionId=${encodeURIComponent(copilotDeviceLoginSessionId)}`);
      const data = (await response.json().catch(() => ({}))) as {
        state?: "starting" | "waiting_for_user" | "authorized" | "failed" | "cancelled";
        url?: string;
        userCode?: string;
        logs?: string[];
        message?: string;
      };
      if (cancelled || !response.ok) return;
      setCopilotDeviceLoginState(data.state ?? "failed");
      setCopilotDeviceLoginUrl(data.url ?? "");
      setCopilotDeviceLoginCode(data.userCode ?? "");
      setCopilotDeviceLoginLogs(Array.isArray(data.logs) ? data.logs : []);
      setCopilotDeviceLoginMessage(data.message ?? "");
      if (data.state === "authorized" || data.state === "failed" || data.state === "cancelled") return;
      setTimeout(() => void poll(), 1500);
    };
    void poll();
    return () => {
      cancelled = true;
    };
  }, [copilotDeviceLoginSessionId]);

  useEffect(() => {
    if (copilotDeviceLoginState !== "authorized") return;
    void loadCatalog();
  }, [copilotDeviceLoginState]);

  useEffect(() => {
    if (loading) return;
    void loadCatalog();
  }, [settings.ollama.disabled, settings.lmstudio.disabled, loading]);

  async function loadSettings(): Promise<void> {
    const response = await apiFetch("/api/settings");
    const data = await readJsonOrEmpty<{ settings?: Partial<SettingsState> }>(response);
    if (response.ok) {
      const normalized = normalizeSettings(data.settings);
      setSettings(normalized);
      lastSavedVoiceSilenceSecRef.current = normalized.web.voiceDictationSilenceSec;
    }
  }
  async function loadHealth(): Promise<void> {
    const response = await apiFetch("/api/system/health");
    const data = await readJsonOrEmpty<{ health?: FullHealth }>(response);
    if (response.ok) setHealth(data.health ?? null);
  }
  async function loadCatalog(): Promise<void> {
    const response = await apiFetch("/api/providers/catalog");
    const data = await readJsonOrEmpty<ProviderCatalog>(response);
    if (response.ok) setCatalog(data);
  }
  async function loadUpdateStatus(): Promise<void> {
    const response = await apiFetch("/api/system/update/status");
    const data = await readJsonOrEmpty<{ status?: UpdateStatus }>(response);
    if (response.ok) setUpdateStatus(data.status ?? null);
  }
  async function loadSkillManifests(): Promise<void> {
    const response = await apiFetch("/api/skills/manifests");
    const data = await readJsonOrEmpty<{ items?: SkillManifest[] }>(response);
    if (response.ok) setSkillManifests(data.items ?? []);
  }
  async function loadWebsites(): Promise<void> {
    const response = await apiFetch("/api/websites");
    const data = await readJsonOrEmpty<{ items?: WebsiteProject[] }>(response);
    if (response.ok) setWebsites(data.items ?? []);
  }
  async function loadDefaultPersona(): Promise<void> {
    const response = await apiFetch("/api/persona/default");
    const data = await readJsonOrEmpty<{ persona?: PersonaState; source?: "file" | "fallback"; filePath?: string }>(response);
    if (!response.ok || !data.persona) return;
    setDefaultPersona({
      id: data.persona.id || "default",
      voice: data.persona.voice || "helpful",
      style: Array.isArray(data.persona.style) ? data.persona.style : [],
      systemPrompt: data.persona.systemPrompt || ""
    });
    setPersonaSource(data.source === "file" ? "file" : "fallback");
    setPersonaPath(data.filePath ?? "");
  }
  async function loadPersonaVersions(): Promise<void> {
    const response = await apiFetch("/api/personas/versions?personaId=default&rewritesOnly=true");
    const data = await readJsonOrEmpty<{ items?: PersonaVersion[] }>(response);
    if (response.ok) {
      setPersonaVersions(Array.isArray(data.items) ? data.items : []);
    }
  }
  async function loadImprovementHistory(): Promise<void> {
    const response = await apiFetch("/api/improvement/history");
    const data = await readJsonOrEmpty<{ itemsByDate?: ImprovementHistoryByDate }>(response);
    if (response.ok) {
      setImprovementHistoryByDate(data.itemsByDate ?? {});
    }
  }
  async function loadIdentityBackupStatus(): Promise<void> {
    const response = await apiFetch("/api/backup/identity/status");
    const data = await readJsonOrEmpty<{ latestSuccess?: BackupRunState; latestRun?: BackupRunState }>(response);
    if (response.ok) {
      setLatestIdentityBackup(data.latestSuccess ?? data.latestRun ?? null);
    }
  }

  async function openSentiCoreEditor(): Promise<void> {
    setSentiCoreModalError(null);
    setSentiCoreModalOpen(true);
    setSentiCoreLoading(true);
    setSentiCoreDraft("");
    setSentiCoreResolvedPath("");
    setSentiCoreMissingFile(false);
    try {
      const r = await apiFetch("/api/settings/senti-core/file");
      const data = (await r.json()) as { path?: string; content?: string; missing?: boolean; error?: string };
      if (!r.ok) {
        setSentiCoreModalError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setSentiCoreDraft(data.content ?? "");
      setSentiCoreResolvedPath(data.path ?? "");
      setSentiCoreMissingFile(data.missing === true);
    } catch {
      setSentiCoreModalError("Could not load file (network error).");
    } finally {
      setSentiCoreLoading(false);
    }
  }

  async function saveSentiCoreEditor(): Promise<void> {
    setSentiCoreModalError(null);
    setSentiCoreSaving(true);
    try {
      const r = await apiFetch("/api/settings/senti-core/file", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: sentiCoreDraft })
      });
      const data = (await r.json()) as { error?: string };
      if (!r.ok) {
        setSentiCoreModalError(data.error ?? `HTTP ${r.status}`);
        return;
      }
      setSentiCoreMissingFile(false);
      setStatus("Orchestration markdown saved.");
      setSentiCoreModalOpen(false);
    } catch {
      setSentiCoreModalError("Could not save file (network error).");
    } finally {
      setSentiCoreSaving(false);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    setError(null);
    const response = await apiFetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(settings)
    });
    const data = (await response.json()) as { settings?: Partial<SettingsState>; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Save failed");
    } else {
      setSettings(normalizeSettings(data.settings));
      setStatus("Settings saved");
    }
    setSaving(false);
  }

  async function pushIdentityBackup(): Promise<void> {
    setStatus(null);
    const response = await apiFetch("/api/backup/identity/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: backupLabel })
    });
    const data = (await response.json()) as { branch?: string; error?: string };
    if (!response.ok) {
      if ((data.error ?? "").includes("persona_exists")) {
        setError("Backup sanity check failed because default persona file was missing. Nova will recreate it automatically now; try Push Backup again.");
      } else {
        setError(data.error ?? "Backup failed");
      }
    }
    else setStatus(`Backup pushed on ${data.branch ?? "branch"}`);
  }

  async function checkUpdates(): Promise<void> {
    const response = await apiFetch("/api/system/update/check", { method: "POST" });
    const data = await readJsonOrEmpty<{ status?: UpdateStatus; error?: string }>(response);
    if (!response.ok) setError(data.error ?? "Update check failed");
    else setUpdateStatus(data.status ?? null);
  }

  async function applyUpdates(): Promise<void> {
    setUpdateApplying(true);
    setError(null);
    setStatus("Applying update... Nova will restart services. Waiting for reconnect.");
    try {
      markAgentRestartExpected();
      const response = await apiFetch("/api/system/update/apply", { method: "POST" });
      const data = await readJsonOrEmpty<{ result?: { message?: string }; error?: string }>(response);
      if (!response.ok) {
        clearAgentRestartExpected();
        setError(data.error ?? "Update apply failed");
        return;
      }
      setStatus(data.result?.message ?? "Update apply requested");
      await waitForServerBackAfterUpdate();
      setStatus("Nova is back online. Reloading UI...");
      clearAgentRestartExpected();
      window.setTimeout(() => {
        router.refresh();
        window.location.reload();
      }, 450);
    } catch (err) {
      clearAgentRestartExpected();
      setError(err instanceof Error ? err.message : "Update apply failed");
    } finally {
      setUpdateApplying(false);
    }
  }

  async function waitForServerBackAfterUpdate(): Promise<void> {
    const maxAttempts = 90; // ~3 minutes
    for (let i = 0; i < maxAttempts; i += 1) {
      try {
        const response = await fetch(`/api/system/update/status?t=${Date.now()}`, {
          method: "GET",
          credentials: "include",
          cache: "no-store"
        });
        if (response.ok) {
          const data = await readJsonOrEmpty<{ status?: UpdateStatus }>(response);
          setUpdateStatus(data.status ?? null);
          return;
        }
      } catch {
        // During restart this is expected.
      }
      await new Promise((r) => setTimeout(r, 2000));
    }
    setStatus("Update command was sent, but reconnect timed out. Refresh the page in a few moments.");
  }

  function updateChannelSetup(patch: Record<string, string>): void {
    setSettings((p) => ({
      ...p,
      skillSettings: {
        ...p.skillSettings,
        ["channel-setup"]: { ...(p.skillSettings["channel-setup"] ?? {}), ...patch }
      }
    }));
  }

  function updateChannelTier(
    channel: "signal" | "whatsapp",
    index: number,
    patch: Partial<{ phone: string; tier: "admin" | "co_admin" | "restricted" | "guest" }>
  ): void {
    setSettings((prev) => {
      const rows = [...prev.messagingAccess.channelTiers[channel]];
      const row = rows[index];
      if (!row) return prev;
      rows[index] = { ...row, ...patch };
      return {
        ...prev,
        messagingAccess: {
          ...prev.messagingAccess,
          channelTiers: {
            ...prev.messagingAccess.channelTiers,
            [channel]: rows
          }
        }
      };
    });
  }

  function addChannelTierRow(channel: "signal" | "whatsapp"): void {
    setSettings((prev) => ({
      ...prev,
      messagingAccess: {
        ...prev.messagingAccess,
        channelTiers: {
          ...prev.messagingAccess.channelTiers,
          [channel]: [...prev.messagingAccess.channelTiers[channel], { phone: "", tier: "guest" }]
        }
      }
    }));
  }

  function removeChannelTierRow(channel: "signal" | "whatsapp", index: number): void {
    setSettings((prev) => ({
      ...prev,
      messagingAccess: {
        ...prev.messagingAccess,
        channelTiers: {
          ...prev.messagingAccess.channelTiers,
          [channel]: prev.messagingAccess.channelTiers[channel].filter((_, i) => i !== index)
        }
      }
    }));
  }

  async function runOneClickChannelSetup(): Promise<void> {
    setError(null);
    setStatus(null);
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const response = await apiFetch("/api/setup/channels/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signalApiUrl: values.signalApiUrl ?? "",
        signalAccountNumber: values.signalAccountNumber ?? settings.messagingAccess.novaPhoneNumber ?? "",
        whatsAppPhoneNumberId: values.whatsAppPhoneNumberId ?? "",
        whatsAppToken: values.whatsAppToken ?? "",
        whatsAppAppSecret: values.whatsAppAppSecret ?? ""
      })
    });
    const data = await readJsonOrEmpty<{
      signal?: SetupCheckResult;
      whatsApp?: SetupCheckResult;
      suggestedEnv?: string;
      error?: string;
    }>(response);
    if (!response.ok) {
      setError(data.error ?? "Channel setup test failed");
      return;
    }
    setSignalSetupCheck(data.signal ?? null);
    setStatus("Channel setup checked. Review result and save settings.");
  }

  async function runSignalDockerBootstrap(): Promise<void> {
    setError(null);
    setStatus(null);
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const signalAccountNumber = values.signalAccountNumber ?? settings.messagingAccess.novaPhoneNumber ?? "";
    const webhookPublicOrigin = typeof window !== "undefined" ? window.location.origin : "";
    const response = await apiFetch("/api/setup/channels/signal/bootstrap", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signalAccountNumber, webhookPublicOrigin })
    });
    const data = await readJsonOrEmpty<SignalBootstrapResult>(response);
    if (!response.ok) {
      setError(data.error ?? "Could not bootstrap Signal bridge.");
      return;
    }
    setSignalSetupCheck({
      ok: data.bridge?.ok === true,
      detail: data.bridge?.detail ?? data.detail ?? "Bridge started"
    });
    updateChannelSetup({
      signalApiUrl: "http://127.0.0.1:8085",
      signalAccountNumber
    });
    const hook = data.receiveWebhookUrl ? ` Webhook: ${data.receiveWebhookUrl}` : "";
    const snippet = data.dockerSnippet ? `\n\nIf Docker runs on another machine, run:\n${data.dockerSnippet}` : "";
    setStatus(`Signal bridge bootstrap completed.${hook}${snippet}`.trim());
  }

  async function runSignalRegisterStart(opts?: { captchaOverride?: string }): Promise<boolean> {
    setError(null);
    setStatus(null);
    setSignalRegisterStatus(null);
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const signalApiUrl = values.signalApiUrl ?? "http://127.0.0.1:8085";
    const signalAccountNumber = values.signalAccountNumber ?? settings.messagingAccess.novaPhoneNumber ?? "";
    const captcha = (opts?.captchaOverride ?? signalRegistrationCaptcha).trim();
    const response = await apiFetch("/api/setup/channels/signal/register", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        signalApiUrl,
        signalAccountNumber,
        ...(captcha ? { captcha } : {}),
        ...(signalRegistrationUseVoice ? { useVoice: true } : {})
      })
    });
    const data = await readJsonOrEmpty<{ detail?: string; endpointTried?: string; error?: string }>(response);
    if (!response.ok) {
      const message = (typeof data.error === "string" && data.error.trim()) || "Could not start Signal registration.";
      const detail = typeof data.detail === "string" ? data.detail.trim() : "";
      const combined = [message, detail].filter(Boolean).join(" ");
      setSignalRegisterStatus({ ok: false, detail: combined || message });
      if (messageLooksLikeSignalCaptchaRequired(combined)) {
        setSignalCaptchaModalDetail(combined.slice(0, 900));
        setSignalCaptchaModalOpen(true);
        setStatus("Signal needs a registration captcha — use the panel that opened, or paste a token below.");
      } else {
        setError(combined || message);
      }
      return false;
    }
    setSignalCaptchaModalOpen(false);
    setSignalRegisterStatus({ ok: true, detail: data.detail ?? "Registration started" });
    setSignalSetupCheck({
      ok: true,
      detail: "SMS registration started"
    });
    setSignalRegistrationCaptcha("");
    setSignalCaptchaPasteDraft("");
    setStatus("SMS code sent. Enter the verification code, then click Submit verification code.");
    return true;
  }

  async function runSignalVerifyCode(): Promise<void> {
    setError(null);
    setStatus(null);
    setSignalRegisterStatus(null);
    const code = signalVerificationCode.trim();
    if (!code) {
      const message = "Enter the Signal verification code first.";
      setSignalRegisterStatus({ ok: false, detail: message });
      setError(message);
      return;
    }
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const signalApiUrl = values.signalApiUrl ?? "http://127.0.0.1:8085";
    const signalAccountNumber = values.signalAccountNumber ?? settings.messagingAccess.novaPhoneNumber ?? "";
    const response = await apiFetch("/api/setup/channels/signal/verify", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ signalApiUrl, signalAccountNumber, code })
    });
    const data = await readJsonOrEmpty<{ detail?: string; endpointTried?: string; error?: string }>(response);
    if (!response.ok) {
      const message = data.error ?? "Could not verify Signal code.";
      setSignalRegisterStatus({ ok: false, detail: message });
      setError(message);
      return;
    }
    setSignalRegisterStatus({ ok: true, detail: data.detail ?? "Verified and linked" });
    setSignalSetupCheck({
      ok: true,
      detail: data.detail ?? "Linked"
    });
    setSignalVerificationCode("");
    setStatus("Signal number linked successfully. Run Validate and then Save Settings.");
  }

  async function runSignalQrLinkFetch(): Promise<void> {
    setError(null);
    setStatus(null);
    setSignalQrEndpoint(null);
    setSignalQrLoading(true);
    setSignalLinkedAccounts(null);
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const signalApiUrl = values.signalApiUrl ?? "http://127.0.0.1:8085";
    try {
      const response = await apiFetch("/api/setup/channels/signal/qrcodelink", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          signalApiUrl,
          deviceName: signalQrDeviceName.trim() || "Nova Agent Web"
        })
      });
      const data = await readJsonOrEmpty<{
        error?: string;
        detail?: string;
        imageBase64?: string;
        mimeType?: string;
        endpointTried?: string;
      }>(response);
      if (!response.ok) {
        setSignalQrImageUrl(null);
        setError(data.error ?? data.detail ?? "Could not load Signal link QR.");
        return;
      }
      if (data.imageBase64 && data.mimeType) {
        setSignalQrDismissed(false);
        setSignalQrImageUrl(`data:${data.mimeType};base64,${data.imageBase64}`);
      } else {
        setSignalQrImageUrl(null);
        setError("Signal bridge returned no image. Is signal-cli-rest-api running at the URL above?");
        return;
      }
      setSignalQrEndpoint(typeof data.endpointTried === "string" ? data.endpointTried : null);
      setStatus(data.detail ?? "Scan the QR with Signal on your phone, then refresh linked accounts.");
    } catch (e) {
      setSignalQrImageUrl(null);
      setError(e instanceof Error ? e.message : "Signal QR request failed");
    } finally {
      setSignalQrLoading(false);
    }
  }

  async function runSignalAccountsRefresh(): Promise<void> {
    setError(null);
    setSignalAccountsLoading(true);
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const signalApiUrl = values.signalApiUrl ?? "http://127.0.0.1:8085";
    try {
      const response = await apiFetch("/api/setup/channels/signal/accounts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ signalApiUrl })
      });
      const data = await readJsonOrEmpty<{ error?: string; detail?: string; accounts?: string[] }>(response);
      if (!response.ok) {
        setSignalLinkedAccounts(null);
        setError(data.error ?? data.detail ?? "Could not list Signal accounts.");
        return;
      }
      const accounts = Array.isArray(data.accounts) ? data.accounts : [];
      setSignalLinkedAccounts(accounts);
      if (accounts.length === 1) {
        updateChannelSetup({ signalAccountNumber: accounts[0]! });
        setStatus(`Linked account: ${accounts[0]}. Filled Signal account number — validate and save when ready.`);
      } else if (accounts.length > 1) {
        setStatus(`${accounts.length} accounts on this bridge. Pick one for SIGNAL_ACCOUNT_NUMBER above.`);
      } else {
        setStatus(data.detail ?? "No accounts on the bridge yet.");
      }
    } catch (e) {
      setSignalLinkedAccounts(null);
      setError(e instanceof Error ? e.message : "Accounts request failed");
    } finally {
      setSignalAccountsLoading(false);
    }
  }

  async function fetchWhatsAppWebStatusOnly(): Promise<
    { ok: true; status: WhatsAppWebBridgeStatus } | { ok: false; detail: string }
  > {
    const response = await apiFetch("/api/setup/channels/whatsapp/web/status");
    const data = (await response.json().catch(() => ({}))) as { status?: WhatsAppWebBridgeStatus; error?: string };
    if (!response.ok) {
      return { ok: false, detail: data.error ?? `HTTP ${response.status}` };
    }
    return { ok: true, status: data.status ?? {} };
  }

  async function refreshWhatsAppWebStatus(): Promise<void> {
    const response = await apiFetch("/api/setup/channels/whatsapp/web/status");
    const data = (await response.json()) as { status?: WhatsAppWebBridgeStatus; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not load WhatsApp Web status.");
      return;
    }
    setWhatsAppWebStatus(data.status ?? null);
  }

  const refreshChannelDebug = useCallback(async (): Promise<void> => {
    setChannelDebugLoading(true);
    setSignalDockerNote(null);
    const msgPromise = (async () => {
      const response = await apiFetch("/api/setup/channels/message-debug?limit=200");
      const data = (await response.json().catch(() => ({}))) as { items?: ChannelDebugEntry[]; error?: string };
      return { response, data };
    })();
    const dockerPromise = (async () => {
      const response = await apiFetch("/api/setup/channels/signal-docker-logs?lines=250");
      const data = (await response.json().catch(() => ({}))) as { ok?: boolean; logs?: string; detail?: string; error?: string };
      return { response, data };
    })();
    let pollFailed = false;
    let pendingErrorMessage: string | null = null;
    try {
      const [{ response: msgRes, data: msgData }, { response: dockerRes, data: dockerData }] = await Promise.all([
        msgPromise,
        dockerPromise
      ]);
      if (!msgRes.ok) {
        pollFailed = true;
        pendingErrorMessage = msgData.error ?? `HTTP ${msgRes.status}`;
      } else {
        setChannelDebugEntries(Array.isArray(msgData.items) ? msgData.items : []);
      }
      if (!dockerRes.ok) {
        setSignalDockerNote(dockerData.error ?? `Docker logs HTTP ${dockerRes.status}`);
      } else if (dockerData.ok === false) {
        setSignalDockerNote(dockerData.detail ?? dockerData.error ?? "Docker logs unavailable on this host.");
      } else {
        setSignalDockerLogs(typeof dockerData.logs === "string" ? dockerData.logs : "");
        setSignalDockerNote(null);
      }
    } catch (e) {
      pollFailed = true;
      pendingErrorMessage = e instanceof Error ? e.message : String(e);
    } finally {
      setChannelDebugLoading(false);
    }
    if (pollFailed) {
      channelDebugFailureCountRef.current += 1;
      // Only show the red "Temporary connection problem" banner after ~12 s of sustained failure
      // (3 × 4 s poll). One-shot blips during agent-core hot-reload or brief 503s stay invisible.
      if (channelDebugFailureCountRef.current >= 3 && pendingErrorMessage) {
        setChannelDebugError(pendingErrorMessage);
      }
    } else {
      channelDebugFailureCountRef.current = 0;
      setChannelDebugError(null);
    }
  }, []);

  // Auto-scroll the Signal bridge (Docker) log pane to the bottom whenever new content arrives so
  // the user sees the freshest Gin lines without manually scrolling.
  useEffect(() => {
    if (!signalDockerLogsExpanded) return;
    const el = signalDockerLogsRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [signalDockerLogs, signalDockerLogsExpanded]);

  useEffect(() => {
    if (tab !== "channels") return;
    void refreshChannelDebug();
    if (!channelDebugAutoRefresh) {
      return;
    }
    const id = window.setInterval(() => void refreshChannelDebug(), 4000);
    return () => window.clearInterval(id);
  }, [tab, channelDebugAutoRefresh, refreshChannelDebug]);

  useEffect(() => {
    const raw = whatsAppWebStatus?.qr?.trim();
    if (!raw) {
      setWhatsAppQrDataUrl(null);
      setWhatsAppQrRenderError(null);
      return;
    }
    let cancelled = false;
    setWhatsAppQrRenderError(null);
    void QRCode.toDataURL(raw, { margin: 2, width: 320, errorCorrectionLevel: "M" }).then(
      (url) => {
        if (!cancelled) setWhatsAppQrDataUrl(url);
      },
      () => {
        if (!cancelled) {
          setWhatsAppQrDataUrl(null);
          setWhatsAppQrRenderError("Could not draw the QR (check that dependencies are installed).");
        }
      }
    );
    return () => {
      cancelled = true;
    };
  }, [whatsAppWebStatus?.qr]);

  async function linkWhatsAppWithFreshQr(): Promise<void> {
    setError(null);
    setWhatsAppPollError(null);
    setWhatsAppInlineHint(
      "Resetting any saved Web session on the agent host and starting a new link. A QR will appear below when ready (usually a few seconds)."
    );
    setWhatsAppLinkRunning(true);
    try {
      const response = await apiFetch("/api/setup/channels/whatsapp/web/start", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ forceNewPairing: true })
      });
      const data = (await response.json()) as { status?: WhatsAppWebBridgeStatus; error?: string };
      if (!response.ok) {
        setWhatsAppInlineHint(null);
        setError(data.error ?? "Could not start WhatsApp Web bridge. Is agent-core running where Settings expects it?");
        return;
      }
      let status = data.status ?? null;
      setWhatsAppWebStatus(status ?? null);
      if (status?.qr) {
        setWhatsAppInlineHint("Scan this QR with WhatsApp → Settings → Linked devices → Link a device.");
        setStatus(null);
        return;
      }
      if (status?.state === "connected") {
        setWhatsAppInlineHint("Already connected on this host — no QR needed.");
        setStatus(null);
        return;
      }
      const deadline = Date.now() + 90_000;
      while (Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 1500));
        const polled = await fetchWhatsAppWebStatusOnly();
        if (!polled.ok) {
          setWhatsAppPollError(polled.detail);
          continue;
        }
        setWhatsAppPollError(null);
        status = polled.status;
        setWhatsAppWebStatus(polled.status);
        if (polled.status.qr) {
          setWhatsAppInlineHint("Scan this QR with WhatsApp → Settings → Linked devices → Link a device.");
          setStatus(null);
          return;
        }
        if (polled.status.state === "connected") {
          setWhatsAppInlineHint("WhatsApp Web connected.");
          setStatus(null);
          return;
        }
        if (polled.status.state === "error" || polled.status.state === "logged_out" || polled.status.state === "idle") {
          setWhatsAppInlineHint(polled.status.detail ?? "Bridge stopped or needs attention.");
          setStatus(null);
          return;
        }
      }
      setWhatsAppInlineHint("No QR yet after 90s. Confirm agent-core is running on the same machine (or reachable), then try again or Refresh status.");
      setStatus(null);
    } finally {
      setWhatsAppLinkRunning(false);
    }
  }

  async function signalCaptchaReadClipboard(): Promise<void> {
    setSignalCaptchaBusy(true);
    try {
      const text = await navigator.clipboard.readText();
      const token = extractSignalCaptchaToken(text);
      if (!token) {
        setStatus("Clipboard was empty or did not contain a captcha token.");
        return;
      }
      setSignalRegistrationCaptcha(token);
      setSignalCaptchaPasteDraft(token);
      setStatus("Captcha token captured from clipboard.");
    } catch {
      setStatus("Could not read clipboard — paste manually or allow clipboard permission for this site.");
    } finally {
      setSignalCaptchaBusy(false);
    }
  }

  async function signalCaptchaApplyDraftAndRetry(): Promise<void> {
    const token = extractSignalCaptchaToken(signalCaptchaPasteDraft);
    if (!token) {
      setStatus("Paste the captcha link or token first.");
      return;
    }
    setSignalRegistrationCaptcha(token);
    setSignalCaptchaBusy(true);
    try {
      await runSignalRegisterStart({ captchaOverride: token });
    } finally {
      setSignalCaptchaBusy(false);
    }
  }

  async function stopWhatsAppWebBridgeAction(): Promise<void> {
    setError(null);
    setWhatsAppInlineHint(null);
    setWhatsAppPollError(null);
    const response = await apiFetch("/api/setup/channels/whatsapp/web/stop", { method: "POST" });
    const data = (await response.json()) as { status?: WhatsAppWebBridgeStatus; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not stop WhatsApp Web bridge.");
      return;
    }
    setWhatsAppWebStatus(data.status ?? null);
    setStatus("WhatsApp Web bridge stopped.");
  }

  async function runCopilotSetupValidation(): Promise<void> {
    setError(null);
    setStatus(null);
    if (settings.copilot.disabled) {
      setCopilotSetupOutput(
        "Copilot is disabled. Pick Auto / env default or a model in Copilot default model (not Disabled), save, then validate."
      );
      setStatus(null);
      return;
    }
    const preset = COPILOT_PRESETS.find((item) => item.baseUrl === settings.copilot.baseUrl.trim());
    const sendApiKey = preset?.authMode === "device-login" ? "" : settings.copilot.apiKey;
    const response = await apiFetch("/api/setup/copilot/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: settings.copilot.baseUrl,
        apiKey: sendApiKey
      })
    });
    const data = (await response.json()) as { check?: SetupCheckResult; suggestedEnv?: string; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Copilot setup validation failed");
      return;
    }
    const header = `Copilot: ${data.check?.ok ? "OK" : "Needs attention"} - ${data.check?.detail ?? "-"}`;
    setCopilotSetupOutput([header, "", data.suggestedEnv ?? ""].join("\n"));
    setStatus("Copilot setup validated. Review result and save settings.");
  }

  async function runModelConnectivityTest(): Promise<void> {
    setError(null);
    setStatus(null);
    setModelPingError(null);
    setModelPingLoading(true);
    try {
      const response = await apiFetch("/api/models/ping", { method: "POST" });
      const data = (await response.json().catch(() => ({}))) as { results?: ModelPingResult[]; error?: string };
      if (!response.ok) {
        setModelPingResults(null);
        setModelPingError(data.error ?? "Model ping failed");
        return;
      }
      setModelPingResults(Array.isArray(data.results) ? data.results : []);
      setStatus("Model connectivity checked. Save settings first if you changed defaults since last save.");
    } catch {
      setModelPingResults(null);
      setModelPingError("Could not reach Nova agent for model ping.");
    } finally {
      setModelPingLoading(false);
    }
  }

  async function startCopilotDeviceLogin(): Promise<void> {
    setError(null);
    setStatus(null);
    setCopilotDeviceLoginState("starting");
    setCopilotDeviceLoginLogs([]);
    setCopilotDeviceLoginCode("");
    setCopilotDeviceLoginUrl("");
    setCopilotDeviceLoginMessage("");
    const response = await apiFetch("/api/setup/copilot/device-login/start", { method: "POST" });
    const data = (await response.json().catch(() => ({}))) as {
      sessionId?: string;
      state?: "starting" | "waiting_for_user" | "authorized" | "failed" | "cancelled";
      error?: string;
    };
    if (!response.ok || !data.sessionId) {
      setCopilotDeviceLoginState("failed");
      setError(data.error ?? "Could not start Copilot device login.");
      return;
    }
    setCopilotDeviceLoginSessionId(data.sessionId);
    setCopilotDeviceLoginState(data.state ?? "starting");
    setStatus("Device login started. Enter the one-time code on GitHub.");
  }

  async function cancelCopilotDeviceLogin(): Promise<void> {
    if (!copilotDeviceLoginSessionId) return;
    await apiFetch("/api/setup/copilot/device-login/cancel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ sessionId: copilotDeviceLoginSessionId })
    });
    setCopilotDeviceLoginState("cancelled");
    setCopilotDeviceLoginMessage("Device login cancelled.");
  }

  async function copyCopilotDeviceCode(): Promise<void> {
    if (!copilotDeviceLoginCode) return;
    try {
      await navigator.clipboard.writeText(copilotDeviceLoginCode);
      setStatus("Copied one-time code to clipboard.");
    } catch {
      setError("Could not copy one-time code. Please copy manually.");
    }
  }

  async function testWebsiteBuilderSshConnection(): Promise<void> {
    setSshTestResult(null);
    const response = await apiFetch("/api/websites/test-ssh", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        sshHost: websiteBuilderSettings.sshHost ?? "",
        sshUser: websiteBuilderSettings.sshUser ?? "",
        sshPort: Number(websiteBuilderSettings.sshPort ?? 22),
        sshPrivateKeyPath: websiteBuilderSettings.sshPrivateKeyPath ?? ""
      })
    });
    const data = (await response.json()) as { ok?: boolean; detail?: string; error?: string };
    setSshTestResult({
      ok: response.ok && data.ok === true,
      detail: response.ok ? (data.detail ?? "SSH connection test completed.") : (data.error ?? "SSH connection test failed.")
    });
  }
  async function saveDefaultPersona(): Promise<void> {
    const response = await apiFetch("/api/persona/default", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(defaultPersona)
    });
    const data = (await response.json()) as { persona?: PersonaState; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not save base identity");
      return;
    }
    if (data.persona) {
      setDefaultPersona(data.persona);
      setPersonaSource("file");
      await loadPersonaVersions();
    }
    setStatus("Base identity saved.");
  }
  async function restorePersonaVersion(version: number): Promise<void> {
    if (!Number.isFinite(version) || version <= 0) return;
    setRestoringPersonaVersion(version);
    setStatus(null);
    setError(null);
    const response = await apiFetch("/api/personas/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ personaId: "default", version })
    });
    const data = (await response.json()) as { ok?: boolean; error?: string };
    if (!response.ok) {
      setError(data.error ?? `Failed to restore persona version ${version}`);
      setRestoringPersonaVersion(null);
      return;
    }
    await Promise.all([loadDefaultPersona(), loadPersonaVersions()]);
    setStatus(`Restored base identity to version ${version}.`);
    setRestoringPersonaVersion(null);
  }

  const modelOptions = catalog?.models ?? {};
  const ollamaVisionCatalog = modelOptions.ollamaVision ?? [];
  const websiteBuilderSettings = (settings.skillSettings["website-builder"] ?? {}) as Record<string, unknown>;
  const perplexicaSettings = (settings.skillSettings["perplexica-websearch"] ?? {}) as Record<string, unknown>;
  const cameraVisionSettings = (settings.skillSettings["camera-vision"] ?? {}) as Record<string, unknown>;
  const websiteBuilderProviderStored = String(websiteBuilderSettings.provider ?? settings.activeProvider);
  const websiteBuilderProviderEffective = ((): "ollama" | "lmstudio" | "copilot" => {
    if (websiteBuilderProviderStored === "ollama" && settings.ollama.disabled === true) return firstAvailableProviderId(settings);
    if (websiteBuilderProviderStored === "lmstudio" && settings.lmstudio.disabled === true) return firstAvailableProviderId(settings);
    if (websiteBuilderProviderStored === "copilot" && settings.copilot.disabled === true) return firstAvailableProviderId(settings);
    if (websiteBuilderProviderStored === "ollama" || websiteBuilderProviderStored === "lmstudio" || websiteBuilderProviderStored === "copilot") {
      return websiteBuilderProviderStored;
    }
    return firstAvailableProviderId(settings);
  })();
  const selectedWebsiteBuilderModels =
    websiteBuilderProviderEffective === "ollama"
      ? modelOptions.ollama ?? []
      : websiteBuilderProviderEffective === "lmstudio"
        ? modelOptions.lmstudio ?? []
        : modelOptions.copilot ?? [];
  const websiteBuilderModel = String(websiteBuilderSettings.model ?? "");
  const updateErrorMessage = normalizeUpdateError(updateStatus?.lastError);
  const selectedCopilotPreset =
    COPILOT_PRESETS.find((item) => item.baseUrl === settings.copilot.baseUrl) ??
    COPILOT_PRESETS.find((item) => item.id === "custom");
  const tabs = [
    { id: "general", label: "General", tone: "blue" as const },
    { id: "models", label: "Models", tone: "purple" as const },
    { id: "identity", label: "Identity", tone: "pink" as const },
    { id: "channels", label: "Channels", tone: "orange" as const },
    { id: "learning", label: "Memory & cores", tone: "green" as const },
    { id: "voice", label: "Voice", tone: "purple" as const },
    { id: "backup", label: "Backup", tone: "pink" as const },
    { id: "updates", label: "Updates", tone: "yellow" as const }
  ].concat(
    skillManifests
      .filter((item) => item.settingsTab || item.id === "camera-vision")
      .map((item) => ({
        id: `skill:${item.settingsTab?.id ?? item.id}`,
        label: item.settingsTab?.label ?? item.name,
        tone: item.settingsTab?.tone ?? ("purple" as const)
      }))
  );
  const skillBadgeById = buildSkillBadgeMap(skillManifests, health?.checks ?? [], settings.skillSettings);
  const cameraSkillManifest = skillManifests.find((item) => item.id === "camera-vision" || item.id === "cameraVision");
  const cameraSkillStatus: SkillBadgeState =
    skillBadgeById["camera-vision"] ?? skillBadgeById["cameraVision"] ?? "ready";
  const skillBadgeForSettingsTab = (tabItemId: string): SkillBadgeState => {
    const sid = tabItemId.replace("skill:", "");
    const manifest = skillManifests.find((m) => (m.settingsTab?.id ?? m.id) === sid);
    const key = manifest?.id ?? sid;
    return skillBadgeById[key] ?? "ready";
  };
  const identityTimeline = buildIdentityTimeline({
    defaultPersona,
    versions: personaVersions,
    improvementHistoryByDate,
    latestIdentityBackup
  });

  return (
    <form onSubmit={save} className="grid items-start gap-4 lg:grid-cols-[1fr_380px]">
      <div className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-semibold">
              <span>Settings</span>
              <span
                className={`inline-flex h-5 min-w-[68px] items-center justify-center rounded-full px-2 text-[10px] font-semibold ${
                  loading
                    ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/20 dark:text-emerald-300"
                    : "invisible"
                }`}
                aria-live="polite"
              >
                Loading...
              </span>
            </h1>
            <p className="text-sm text-muted">Modern control center with setup guidance and live status.</p>
          </div>
          <div className="flex min-w-[220px] flex-col items-end gap-1">
            <Button type="submit" tone="green" disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
            <span className={`text-xs ${status ? "text-emerald-600" : error ? "text-rose-600" : "invisible"}`}>
              {status ?? error ?? "placeholder"}
            </span>
          </div>
        </div>
        <div className="grid items-start gap-4 lg:grid-cols-[220px_1fr]">
          <Card className="h-fit self-start lg:sticky lg:top-0">
            <div className="mb-2 flex items-center justify-between">
              <h2 className="text-sm font-semibold">Settings Menu</h2>
            </div>
            <div className="space-y-1">
              {tabs.map((item) => (
                <Button
                  key={item.id}
                  type="button"
                  tone={tab === item.id ? item.tone ?? "blue" : "neutral"}
                  onClick={() => setTab(item.id)}
                  className={`w-full justify-start text-left ${tab === item.id ? "font-semibold shadow-sm ring-1 ring-black/[0.07] dark:ring-white/12" : ""}`}
                  title={item.label}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span>{item.label}</span>
                    {item.id.startsWith("skill:") ? (
                      <span className={badgeClassForSkillBadgeState(skillBadgeForSettingsTab(item.id))}>
                        {labelForSkillBadgeState(skillBadgeForSettingsTab(item.id))}
                      </span>
                    ) : null}
                  </span>
                </Button>
              ))}
            </div>
          </Card>
          <div className="min-w-0 self-start">
        {tab === "general" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">General & Safety</h2>
            <label className="flex items-center gap-2"><Checkbox checked={settings.requireApprovals} onChange={(e) => setSettings((p) => ({ ...p, requireApprovals: e.target.checked }))} /> Require approvals</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.loginEnabled} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, loginEnabled: e.target.checked } }))} /> Enable Web login</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.hideProviderModelInStats} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, hideProviderModelInStats: e.target.checked } }))} /> Hide provider/model in chat statistics</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.sendOnEnter} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, sendOnEnter: e.target.checked } }))} /> Send message on Enter (Shift+Enter for newline)</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.chatStyle.bubbleBackgroundEnabled} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, bubbleBackgroundEnabled: e.target.checked } } }))} /> Enable bubble backgrounds in chat</label>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-ui border bg-surface p-3">
                <div className="text-xs font-semibold text-muted">Nova (left)</div>
                <ColorPickerRow
                  label="Background color"
                  value={activeAssistantBubbleColor}
                  onChange={(value) =>
                    patchThemeChatStyle({
                      dark: { assistantBubbleColor: value },
                      light: { assistantBubbleColorLight: value }
                    })
                  }
                />
                <label className="grid gap-1 text-xs">
                  Background opacity ({settings.web.chatStyle.assistantBackgroundOpacityPct}%)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.web.chatStyle.assistantBackgroundOpacityPct}
                    onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, assistantBackgroundOpacityPct: Number(e.target.value || 0) } } }))}
                  />
                </label>
                <ColorPickerRow
                  label="Text color"
                  value={activeAssistantTextColor}
                  onChange={(value) =>
                    patchThemeChatStyle({
                      dark: { assistantTextColor: value },
                      light: { assistantTextColorLight: value }
                    })
                  }
                />
                <ColorPickerRow
                  label="Action icon color"
                  value={activeAssistantActionIconColor}
                  onChange={(value) =>
                    patchThemeChatStyle({
                      dark: { assistantActionIconColor: value },
                      light: { assistantActionIconColorLight: value }
                    })
                  }
                />
                <label className="grid gap-1 text-xs">
                  Border thickness (px)
                  <Input type="number" min={0} max={8} value={settings.web.chatStyle.assistantBorderThicknessPx} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, assistantBorderThicknessPx: Number(e.target.value || 0) } } }))} />
                </label>
              </div>
              <div className="space-y-2 rounded-ui border bg-surface p-3">
                <div className="text-xs font-semibold text-muted">User (right)</div>
                <ColorPickerRow
                  label="Background color"
                  value={activeUserBubbleColor}
                  onChange={(value) =>
                    patchThemeChatStyle({
                      dark: { userBubbleColor: value },
                      light: { userBubbleColorLight: value }
                    })
                  }
                />
                <label className="grid gap-1 text-xs">
                  Background opacity ({settings.web.chatStyle.userBackgroundOpacityPct}%)
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={settings.web.chatStyle.userBackgroundOpacityPct}
                    onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, userBackgroundOpacityPct: Number(e.target.value || 0) } } }))}
                  />
                </label>
                <ColorPickerRow
                  label="Text color"
                  value={activeUserTextColor}
                  onChange={(value) =>
                    patchThemeChatStyle({
                      dark: { userTextColor: value },
                      light: { userTextColorLight: value }
                    })
                  }
                />
                <ColorPickerRow
                  label="Action icon color"
                  value={activeUserActionIconColor}
                  onChange={(value) =>
                    patchThemeChatStyle({
                      dark: { userActionIconColor: value },
                      light: { userActionIconColorLight: value }
                    })
                  }
                />
                <label className="grid gap-1 text-xs">
                  Border thickness (px)
                  <Input type="number" min={0} max={8} value={settings.web.chatStyle.userBorderThicknessPx} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, userBorderThicknessPx: Number(e.target.value || 0) } } }))} />
                </label>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <ColorPickerRow
                label="Bubble border color"
                value={settings.web.chatStyle.borderColor}
                onChange={(value) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, borderColor: value } } }))}
              />
              <ColorPickerRow
                label="Stats line color"
                value={activeStatsTextColor}
                onChange={(value) =>
                  patchThemeChatStyle({
                    dark: { statsTextColor: value },
                    light: { statsTextColorLight: value }
                  })
                }
              />
              <label className="grid gap-1 text-xs">
                Bubble corner radius (0-30px)
                <Input type="number" min={0} max={30} value={settings.web.chatStyle.bubbleRadiusPx} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, bubbleRadiusPx: Number(e.target.value || 0) } } }))} />
              </label>
            </div>
            <div className="flex items-center justify-between rounded-ui border bg-surface p-2 text-xs text-muted">
              <span>
                Editing <strong>{isLightMode ? "Light" : "Dark"}</strong> mode palette. Switch theme to edit the other palette.
              </span>
              <span
                className={
                  chatStyleSaveState === "saving"
                    ? "text-amber-600"
                    : chatStyleSaveState === "saved"
                      ? "text-emerald-600"
                      : chatStyleSaveState === "error"
                        ? "text-rose-600"
                        : "text-muted"
                }
              >
                {chatStyleSaveState === "saving"
                  ? "Saving style..."
                  : chatStyleSaveState === "saved"
                    ? "Style saved"
                    : chatStyleSaveState === "error"
                      ? "Save failed"
                      : " "}
              </span>
            </div>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.chatStyle.showNames} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, showNames: e.target.checked } } }))} /> Show names in chat bubbles (Nova, You)</label>
            <div className="rounded-ui border bg-surface p-3">
              <div className="mb-2 text-xs font-semibold text-muted">Live chat style preview</div>
              <div className="space-y-2 rounded-ui border bg-surface2 p-2">
                <article
                  className="ml-auto max-w-[85%] border p-2.5"
                  style={{
                    backgroundColor: settings.web.chatStyle.bubbleBackgroundEnabled
                      ? withOpacity(activeUserBubbleColor, settings.web.chatStyle.userBackgroundOpacityPct)
                      : "transparent",
                    color: activeUserTextColor,
                    borderColor: settings.web.chatStyle.borderColor,
                    borderWidth: `${settings.web.chatStyle.userBorderThicknessPx}px`,
                    borderRadius: `${settings.web.chatStyle.bubbleRadiusPx}px`
                  }}
                >
                  {settings.web.chatStyle.showNames ? <div className="mb-1 text-[11px] font-semibold">You</div> : null}
                  <div className="text-xs">Can you summarize what changed?</div>
                  <div className="mt-1 flex justify-end gap-2">
                    <FaCopy className="h-3.5 w-3.5" style={{ color: activeUserActionIconColor }} />
                    <FaPenToSquare className="h-3.5 w-3.5" style={{ color: activeUserActionIconColor }} />
                    <FaRotateRight className="h-3.5 w-3.5" style={{ color: activeUserActionIconColor }} />
                  </div>
                </article>
                <article
                  className="mr-auto max-w-[85%] border p-2.5"
                  style={{
                    backgroundColor: settings.web.chatStyle.bubbleBackgroundEnabled
                      ? withOpacity(activeAssistantBubbleColor, settings.web.chatStyle.assistantBackgroundOpacityPct)
                      : "transparent",
                    color: activeAssistantTextColor,
                    borderColor: settings.web.chatStyle.borderColor,
                    borderWidth: `${settings.web.chatStyle.assistantBorderThicknessPx}px`,
                    borderRadius: `${settings.web.chatStyle.bubbleRadiusPx}px`
                  }}
                >
                  {settings.web.chatStyle.showNames ? <div className="mb-1 text-[11px] font-semibold">Nova</div> : null}
                  <div className="text-xs">Updated styling preview is now active.</div>
                  <div className="mt-1">
                    <FaCopy className="h-3.5 w-3.5" style={{ color: activeAssistantActionIconColor }} />
                  </div>
                  <div className="mt-1 text-[11px]" style={{ color: activeStatsTextColor }}>
                    2.9 t/s · 36 tok · 12.9s · ollama/gemma4:26B
                  </div>
                </article>
              </div>
            </div>
            <label className="flex items-center gap-2"><Checkbox checked={settings.offlineMode.enabled} onChange={(e) => setSettings((p) => ({ ...p, offlineMode: { enabled: e.target.checked } }))} /> Offline mode (blocks cloud provider calls)</label>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-xs">
                Shell timeout (ms)
                <Input type="number" value={settings.shell.timeoutMs} onChange={(e) => setSettings((p) => ({ ...p, shell: { ...p.shell, timeoutMs: Number(e.target.value || 0) } }))} placeholder="Shell timeout ms" />
              </label>
              <label className="grid gap-1 text-xs">
                Shell max output (bytes)
                <Input type="number" value={settings.shell.maxOutputBytes} onChange={(e) => setSettings((p) => ({ ...p, shell: { ...p.shell, maxOutputBytes: Number(e.target.value || 0) } }))} placeholder="Shell max bytes" />
              </label>
            </div>
            <div className="space-y-2 rounded-ui border bg-surface2 p-3">
              <h3 className="text-sm font-semibold">Skills execution</h3>
              <p className="text-[11px] text-muted leading-snug">
                Isolation runs untrusted skill code in a subprocess with tighter limits. If <code className="font-mono text-[10px]">NOVA_SKILL_ISOLATION</code> is set to{" "}
                <code className="font-mono text-[10px]">true</code>/<code className="font-mono text-[10px]">false</code>, it overrides this checkbox.
              </p>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.skills.isolationEnabled}
                  onChange={(e) => setSettings((p) => ({ ...p, skills: { ...p.skills, isolationEnabled: e.target.checked } }))}
                />
                Skill process isolation (recommended on shared machines)
              </label>
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={settings.skills.skillAuthoringDisabled}
                  onChange={(e) =>
                    setSettings((p) => ({ ...p, skills: { ...p.skills, skillAuthoringDisabled: e.target.checked } }))
                  }
                />
                <span>
                  <span className="font-medium">Disable skill authoring from chat</span>
                  <span className="mt-0.5 block text-[11px] text-muted leading-snug">
                    Blocks Nova from starting the automatic “create a skill” flow from user messages. Same idea as{" "}
                    <code className="font-mono text-[10px]">NOVA_SKILL_AUTHORING_DISABLED</code> when that env is not set.
                  </span>
                </span>
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs">
                  Skill timeout (ms)
                  <Input
                    type="number"
                    value={settings.skills.timeoutMs}
                    onChange={(e) =>
                      setSettings((p) => ({ ...p, skills: { ...p.skills, timeoutMs: Number(e.target.value || 0) } }))
                    }
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Skill max memory (MB)
                  <Input
                    type="number"
                    value={settings.skills.maxMemoryMb}
                    onChange={(e) =>
                      setSettings((p) => ({ ...p, skills: { ...p.skills, maxMemoryMb: Number(e.target.value || 0) } }))
                    }
                  />
                </label>
              </div>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-xs">
                Ollama price ($ / 1k tokens)
                <Input type="number" step="0.000001" value={settings.costGovernor.providerPricing.ollamaPer1k} onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, providerPricing: { ...p.costGovernor.providerPricing, ollamaPer1k: Number(e.target.value || 0) } } }))} placeholder="Ollama $/1k tok" />
              </label>
              <label className="grid gap-1 text-xs">
                LM Studio price ($ / 1k tokens)
                <Input type="number" step="0.000001" value={settings.costGovernor.providerPricing.lmstudioPer1k} onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, providerPricing: { ...p.costGovernor.providerPricing, lmstudioPer1k: Number(e.target.value || 0) } } }))} placeholder="LM Studio $/1k tok" />
              </label>
              <label className="grid gap-1 text-xs">
                Copilot price ($ / 1k tokens)
                <Input type="number" step="0.000001" value={settings.costGovernor.providerPricing.copilotPer1k} onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, providerPricing: { ...p.costGovernor.providerPricing, copilotPer1k: Number(e.target.value || 0) } } }))} placeholder="Copilot $/1k tok" />
              </label>
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Delegated Folders</h3>
              {settings.delegatedFolders.map((folder) => (
                <div key={folder} className="flex items-center justify-between rounded-ui border bg-surface p-2 text-xs">
                  <code>{folder}</code>
                  <Button type="button" tone="red" onClick={() => setSettings((p) => ({ ...p, delegatedFolders: p.delegatedFolders.filter((f) => f !== folder) }))}>Remove</Button>
                </div>
              ))}
              <div className="flex gap-2">
                <Input value={newFolder} onChange={(e) => setNewFolder(e.target.value)} placeholder="Add folder path" />
                <Button type="button" tone="green" onClick={() => {
                  const value = newFolder.trim();
                  if (!value) return;
                  setSettings((p) => ({ ...p, delegatedFolders: p.delegatedFolders.includes(value) ? p.delegatedFolders : [...p.delegatedFolders, value] }));
                  setNewFolder("");
                }}>Add</Button>
              </div>
            </div>
          </Card>
        ) : null}

        {tab === "models" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Providers & Model Selection</h2>
            <label className="grid gap-1 text-sm">
              Primary provider
              <Select
                value={settings.activeProvider}
                onChange={(e) => {
                  const v = e.target.value as SettingsState["activeProvider"];
                  setSettings((p) => {
                    if (v === "ollama") return { ...p, activeProvider: "ollama", ollama: { ...p.ollama, disabled: false } };
                    if (v === "lmstudio") return { ...p, activeProvider: "lmstudio", lmstudio: { disabled: false } };
                    return { ...p, activeProvider: "copilot", copilot: { ...p.copilot, disabled: false } };
                  });
                }}
              >
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
                <option value="copilot">Copilot</option>
              </Select>
            </label>
            <div className="space-y-2 rounded-ui border bg-surface2 p-3">
              <label className="flex items-start gap-2 text-sm">
                <Checkbox
                  checked={settings.models.ollamaThinkingEnabled}
                  onChange={(e) =>
                    setSettings((p) => ({ ...p, models: { ...p.models, ollamaThinkingEnabled: e.target.checked } }))
                  }
                />
                <span>
                  <span className="font-medium">Ollama native thinking</span>
                  <span className="mt-0.5 block text-[11px] text-muted leading-snug">
                    When enabled, Ollama uses <code className="font-mono text-[10px]">think: true</code> so supported models stream reasoning traces (final text may appear in thinking fields). Leave off for reliable plain answers and for Gemma-style models. If{" "}
                    <code className="font-mono text-[10px]">NOVA_OLLAMA_THINK</code> is set in the environment, it overrides this checkbox.
                  </span>
                </span>
              </label>
            </div>
            <div className="space-y-3 rounded-ui border bg-surface2 p-3">
              <h3 className="text-sm font-semibold">Ollama generation</h3>
              <label className="grid gap-1 text-sm">
                Max reply tokens (<span className="font-mono text-xs">num_predict</span>)
                <Input
                  type="number"
                  min={-1}
                  max={131072}
                  value={settings.ollama.numPredict}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setSettings((p) => ({
                      ...p,
                      ollama: {
                        ...p.ollama,
                        numPredict: Number.isFinite(v) ? Math.trunc(v) : p.ollama.numPredict
                      }
                    }));
                  }}
                />
                <span className="text-[11px] text-muted leading-snug">
                  Caps how long a single reply can grow before Ollama stops cleanly. Use <strong>-1</strong> for the model/Ollama default.
                  If <code className="font-mono text-[10px]">NOVA_OLLAMA_NUM_PREDICT</code> is set in the environment, it overrides this field.
                </span>
              </label>
              <label className="grid gap-1 text-sm">
                keep_alive
                <Input
                  value={settings.ollama.keepAlive}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      ollama: { ...p.ollama, keepAlive: e.target.value.slice(0, 32) }
                    }))
                  }
                  placeholder="30m"
                />
                <span className="text-[11px] text-muted leading-snug">
                  How long Ollama keeps the loaded model in memory after a request (e.g.{" "}
                  <code className="font-mono text-[10px]">30m</code>, <code className="font-mono text-[10px]">5m</code>,{" "}
                  <code className="font-mono text-[10px]">0</code>). If{" "}
                  <code className="font-mono text-[10px]">NOVA_OLLAMA_KEEP_ALIVE</code> is set, it overrides this field.
                </span>
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-sm">
                Ollama default model
                <Select
                  value={settings.ollama.disabled ? OLLAMA_PROVIDER_DISABLED_VALUE : settings.models.defaultByProvider.ollama}
                  onChange={(e) =>
                    setSettings((p) => {
                      const id = e.target.value;
                      if (id === OLLAMA_PROVIDER_DISABLED_VALUE) {
                        const next: SettingsState = {
                          ...p,
                          ollama: { ...p.ollama, disabled: true },
                          models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, ollama: "" } }
                        };
                        return {
                          ...next,
                          activeProvider: p.activeProvider === "ollama" ? firstAvailableProviderId(next) : p.activeProvider
                        };
                      }
                      return {
                        ...p,
                        ollama: { ...p.ollama, disabled: false },
                        models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, ollama: id } }
                      };
                    })
                  }
                >
                  <option value="">Auto / env default</option>
                  <option value={OLLAMA_PROVIDER_DISABLED_VALUE}>Disabled — never use Ollama</option>
                  {dedupeCatalogModelsById(modelOptions.ollama ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                LM Studio default model
                <Select
                  value={
                    settings.lmstudio.disabled ? LMSTUDIO_PROVIDER_DISABLED_VALUE : settings.models.defaultByProvider.lmstudio
                  }
                  onChange={(e) =>
                    setSettings((p) => {
                      const id = e.target.value;
                      if (id === LMSTUDIO_PROVIDER_DISABLED_VALUE) {
                        const next: SettingsState = {
                          ...p,
                          lmstudio: { disabled: true },
                          models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, lmstudio: "" } }
                        };
                        return {
                          ...next,
                          activeProvider: p.activeProvider === "lmstudio" ? firstAvailableProviderId(next) : p.activeProvider
                        };
                      }
                      return {
                        ...p,
                        lmstudio: { disabled: false },
                        models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, lmstudio: id } }
                      };
                    })
                  }
                >
                  <option value="">Auto / env default</option>
                  <option value={LMSTUDIO_PROVIDER_DISABLED_VALUE}>Disabled — never use LM Studio</option>
                  {dedupeCatalogModelsById(modelOptions.lmstudio ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                Copilot default model
                <Select
                  value={settings.copilot.disabled ? COPILOT_MODEL_DISABLED_VALUE : settings.models.defaultByProvider.copilot}
                  onChange={(e) =>
                    setSettings((p) => {
                      const id = e.target.value;
                      if (id === COPILOT_MODEL_DISABLED_VALUE) {
                        const next: SettingsState = {
                          ...p,
                          copilot: { ...p.copilot, disabled: true, defaultModel: "" },
                          models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, copilot: "" } }
                        };
                        return {
                          ...next,
                          activeProvider: p.activeProvider === "copilot" ? firstAvailableProviderId(next) : p.activeProvider
                        };
                      }
                      return {
                        ...p,
                        copilot: { ...p.copilot, disabled: false, defaultModel: id },
                        models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, copilot: id } }
                      };
                    })
                  }
                >
                  <option value="">Auto / env default</option>
                  <option value={COPILOT_MODEL_DISABLED_VALUE}>Disabled — never use Copilot</option>
                  {dedupeCatalogModelsById(modelOptions.copilot ?? []).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="space-y-3 rounded-ui border bg-surface2 p-3">
              <h3 className="text-sm font-semibold">Vision (images / video)</h3>
              <p className="text-[11px] text-muted leading-snug">
                Used when Nova detects a vision-style request. Leave model fields empty to use environment defaults (
                <code className="font-mono text-[10px]">OLLAMA_VISION_*</code>, <code className="font-mono text-[10px]">LMSTUDIO_VISION_*</code>,{" "}
                <code className="font-mono text-[10px]">CLOUD_VISION_*</code>). Set a <strong>remote base URL</strong> to send vision work to another machine (e.g. home PC) without changing chat routing.
              </p>
              <div className="grid gap-2 sm:grid-cols-3">
                <label className="grid gap-1 text-xs">
                  Try vision first
                  <Select
                    value={settings.visionProviderPriority[0] ?? "lmstudio"}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        visionProviderPriority: patchVisionPriorityAt(
                          normalizeVisionPriorityWeb(p.visionProviderPriority),
                          0,
                          e.target.value as "lmstudio" | "ollama" | "cloud"
                        )
                      }))
                    }
                  >
                    <option value="lmstudio">LM Studio</option>
                    <option value="ollama">Ollama</option>
                    <option value="cloud">Cloud (OpenAI-compatible)</option>
                  </Select>
                </label>
                <label className="grid gap-1 text-xs">
                  Then
                  <Select
                    value={settings.visionProviderPriority[1] ?? "ollama"}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        visionProviderPriority: patchVisionPriorityAt(
                          normalizeVisionPriorityWeb(p.visionProviderPriority),
                          1,
                          e.target.value as "lmstudio" | "ollama" | "cloud"
                        )
                      }))
                    }
                  >
                    <option value="lmstudio">LM Studio</option>
                    <option value="ollama">Ollama</option>
                    <option value="cloud">Cloud (OpenAI-compatible)</option>
                  </Select>
                </label>
                <label className="grid gap-1 text-xs">
                  Then
                  <Select
                    value={settings.visionProviderPriority[2] ?? "cloud"}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        visionProviderPriority: patchVisionPriorityAt(
                          normalizeVisionPriorityWeb(p.visionProviderPriority),
                          2,
                          e.target.value as "lmstudio" | "ollama" | "cloud"
                        )
                      }))
                    }
                  >
                    <option value="lmstudio">LM Studio</option>
                    <option value="ollama">Ollama</option>
                    <option value="cloud">Cloud (OpenAI-compatible)</option>
                  </Select>
                </label>
              </div>
              <label className="flex items-start gap-2 text-xs">
                <Checkbox
                  checked={settings.vision.swapLocalModelsForVision}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      vision: { ...p.vision, swapLocalModelsForVision: e.target.checked }
                    }))
                  }
                />
                <span>
                  <span className="font-medium">Unload chat model for vision (local Ollama / LM Studio)</span>
                  <span className="mt-0.5 block text-[11px] text-muted leading-snug">
                    When the primary provider matches the vision lane and vision uses the <strong>same</strong> host as chat, Nova frees VRAM first: <strong>Ollama</strong> uses a short keep-alive unload; <strong>LM Studio</strong> calls{" "}
                    <code className="font-mono text-[10px]">POST /api/v1/models/unload</code> (optional bearer{" "}
                    <code className="font-mono text-[10px]">LMSTUDIO_API_KEY</code> / <code className="font-mono text-[10px]">LM_API_TOKEN</code>). Then it runs the vision model and unloads it afterward. The next chat reloads your chat model (first reply may be slightly slower). Ignored if you set a different vision base URL for that provider.
                  </span>
                </span>
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs">
                  Ollama vision model
                  <Select
                    value={settings.vision.ollamaModel}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, ollamaModel: e.target.value } }))}
                  >
                    <option value="">Auto / env default (OLLAMA_VISION_MODEL)</option>
                    {(() => {
                      const current = settings.vision.ollamaModel.trim();
                      const listed = dedupeCatalogModelsById(ollamaVisionCatalog);
                      const inList = current && listed.some((m) => m.id === current);
                      return (
                        <>
                          {listed.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.id}
                            </option>
                          ))}
                          {current && !inList ? (
                            <option value={current}>
                              {current} (custom — not in detected vision list)
                            </option>
                          ) : null}
                        </>
                      );
                    })()}
                  </Select>
                  {settings.ollama.disabled !== true && ollamaVisionCatalog.length === 0 ? (
                    <span className="text-[10px] text-muted leading-snug">
                      No vision models detected yet (Ollama unreachable or none report the <code className="font-mono text-[10px]">vision</code> capability). Use Auto / env default, or upgrade Ollama so{" "}
                      <code className="font-mono text-[10px]">/api/show</code> exposes capabilities.
                    </span>
                  ) : null}
                </label>
                <label className="grid gap-1 text-xs">
                  Ollama vision base URL (optional remote)
                  <Input
                    value={settings.vision.ollamaBaseUrl}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, ollamaBaseUrl: e.target.value } }))}
                    placeholder="http://192.168.1.50:11434"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  LM Studio vision model
                  <Input
                    value={settings.vision.lmstudioModel}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, lmstudioModel: e.target.value } }))}
                    placeholder="empty = env default"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  LM Studio vision API base (optional remote)
                  <Input
                    value={settings.vision.lmstudioBaseUrl}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, lmstudioBaseUrl: e.target.value } }))}
                    placeholder="http://host:1234/v1"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Cloud vision model
                  <Input
                    value={settings.vision.cloudModel}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, cloudModel: e.target.value } }))}
                    placeholder="e.g. gpt-4o-mini"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Cloud vision base URL
                  <Input
                    value={settings.vision.cloudBaseUrl}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, cloudBaseUrl: e.target.value } }))}
                    placeholder="https://api.openai.com/v1"
                  />
                </label>
                <label className="grid gap-1 text-xs md:col-span-2">
                  Cloud vision API key
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={settings.vision.cloudApiKey}
                    onChange={(e) => setSettings((p) => ({ ...p, vision: { ...p.vision, cloudApiKey: e.target.value } }))}
                    placeholder="Stored encrypted when NOVA_SETTINGS_SECRET is set"
                  />
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 rounded-ui border bg-surface2 p-2">
              <Button type="button" tone="green" disabled={modelPingLoading} onClick={() => void runModelConnectivityTest()}>
                {modelPingLoading ? "Testing…" : "Test model connections"}
              </Button>
              <span className="text-[11px] text-muted">
                Health check plus a minimal chat on each <strong>enabled</strong> provider using saved default models (disabled providers are omitted). Save the form if you just changed them.
              </span>
            </div>
            {modelPingError ? <p className="text-xs text-rose-600">{modelPingError}</p> : null}
            {modelPingResults && modelPingResults.length > 0 ? (
              <div className="grid gap-2 md:grid-cols-3">
                {modelPingResults.map((row) => (
                  <div key={row.provider} className="rounded-ui border bg-surface p-2 text-xs">
                    <div className="font-semibold capitalize">{row.provider}</div>
                    <div className="mt-1">
                      Health:{" "}
                      <span className={row.healthOk ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}>
                        {row.healthOk ? "OK" : row.healthDetail ?? "unreachable"}
                      </span>
                    </div>
                    {row.chatOk !== undefined ? (
                      <div className="mt-0.5">
                        Chat:{" "}
                        <span className={row.chatOk ? "text-emerald-700 dark:text-emerald-400" : "text-rose-600"}>
                          {row.chatOk ? `OK (${row.chatLatencyMs ?? "?"} ms)` : row.chatDetail ?? "failed"}
                        </span>
                      </div>
                    ) : (
                      <div className="mt-0.5 text-muted">Chat: skipped (health failed)</div>
                    )}
                    <div className="mt-0.5 font-mono text-[10px] text-muted">
                      Model tried: {row.modelTried?.trim() ? row.modelTried : "default / env"}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="text-[11px] text-muted leading-snug">
              Copilot usage follows your GitHub Copilot plan. Pick <em>Disabled</em> to remove Copilot from routing entirely (local-first only when using Ollama/LM Studio fallbacks). Otherwise choose a mini/smaller model for lighter chat.{" "}
              <em>Auto / env default</em> uses <code className="font-mono text-[10px]">COPILOT_MODEL</code> when set, otherwise Nova uses{" "}
              <code className="font-mono text-[10px]">gpt-4o-mini</code>. Ollama and LM Studio default to <em>Disabled</em> until you enable them and pick models.
            </p>
            <div className="space-y-3 rounded-ui border bg-surface2 p-3">
              <div>
                <h3 className="text-sm font-semibold">Smart cost governor</h3>
                <p className="mt-1 text-[11px] text-muted leading-snug">
                  Nova records a rough <strong>estimated cost in USD</strong> on each completed reply (using simple per-provider rates per 1k output tokens; local Ollama/LM Studio are tiny by default, cloud Copilot higher). When the governor is on, it adds up today’s estimates from the run history and compares them to your daily cap.
                </p>
                <p className="mt-1 text-[11px] text-muted leading-snug">
                  <strong>Quality tier</strong> tweaks those estimates (High counts a bit higher, Economy a bit lower) so the budget feels stricter or looser. If the budget is already met or exceeded and the tier is <strong>Economy</strong>, normal chat prefers the first available <strong>local</strong> default (Ollama, then LM Studio) when those providers are enabled, to steer away from further paid cloud use.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.costGovernor.enabled}
                  onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, enabled: e.target.checked } }))}
                />
                Enable smart cost governor
              </label>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:gap-3">
                <label className="grid min-w-0 flex-1 gap-1 text-sm">
                  <span>Daily budget (USD)</span>
                  <Input
                    className="h-10 py-0 leading-normal"
                    type="number"
                    min={0}
                    step={0.5}
                    value={settings.costGovernor.dailyBudgetUsd}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        costGovernor: { ...p.costGovernor, dailyBudgetUsd: Number(e.target.value || 0) }
                      }))
                    }
                  />
                </label>
                <label className="grid min-w-0 flex-1 gap-1 text-sm">
                  <span>Quality tier</span>
                  <Select
                    className="h-10 py-0 leading-normal"
                    value={settings.costGovernor.qualityTier}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        costGovernor: { ...p.costGovernor, qualityTier: e.target.value as "high" | "balanced" | "economy" }
                      }))
                    }
                  >
                    <option value="high">High — stricter cost estimate (1.25×)</option>
                    <option value="balanced">Balanced — baseline estimate</option>
                    <option value="economy">Economy — looser estimate (0.85×); over budget nudges to local defaults</option>
                  </Select>
                </label>
              </div>
              <p className="text-[10px] text-muted leading-snug">
                <strong>Daily budget:</strong> maximum <strong>estimated</strong> spend for today before governor rules kick in (default is often 5). Not a hard cloud invoice — only Nova’s internal estimate vs this number.{" "}
                <strong>Quality tier</strong> fine-tunes how quickly you hit the daily cap; Economy also enables the local-model nudge when over budget.
              </p>
            </div>
            <div className="space-y-2 rounded-ui border bg-surface p-3">
              <h3 className="font-semibold">Copilot quick setup</h3>
              <p className="text-xs text-muted">
                Pick a preset: API-key backends need a pasted key; GitHub device login stores tokens in{" "}
                <code className="font-mono">~/.nova/copilot-auth.json</code>.
              </p>
              <div className="grid gap-2 md:grid-cols-3">
                {COPILOT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    className="rounded-ui border bg-surface2 p-2 text-left text-xs transition hover:border-blue-500/60"
                    onClick={() =>
                      setSettings((p) => ({
                        ...p,
                        models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, copilot: preset.model } },
                        copilot: {
                          ...p.copilot,
                          disabled: false,
                          baseUrl: preset.baseUrl,
                          defaultModel: preset.model,
                          ...(preset.authMode === "device-login" ? { apiKey: "" } : {})
                        }
                      }))
                    }
                  >
                    <div className="font-semibold">{preset.label}</div>
                    <div className="mt-1 text-muted">{preset.note}</div>
                    <div className="mt-1 font-mono text-[10px] text-muted">{preset.baseUrl}</div>
                  </button>
                ))}
              </div>
              <div className="rounded-ui border bg-surface2 p-2 text-xs text-muted">
                <div><strong>Step 1:</strong> Choose preset (or enter your own base URL).</div>
                <div>
                  <strong>Step 2:</strong>{" "}
                  {selectedCopilotPreset?.authMode === "device-login"
                    ? "Run device login in terminal, complete one-time code on GitHub, then use generated auth profile."
                    : "Paste API key; pick the Copilot default model from the dropdown above."}
                </div>
                <div><strong>Step 3:</strong> Click Validate, then Save Settings.</div>
              </div>
              {selectedCopilotPreset?.authMode === "device-login" ? (
                <div className="space-y-2 rounded-ui border border-blue-500/35 bg-blue-500/10 p-2 text-xs">
                  <div className="font-semibold text-blue-800 dark:text-blue-200">GitHub one-time code login flow</div>
                  <div className="text-muted">Start from UI, then enter the one-time code on GitHub.</div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      type="button"
                      tone="blue"
                      onClick={() => void startCopilotDeviceLogin()}
                      disabled={
                        settings.copilot.disabled ||
                        copilotDeviceLoginState === "starting" ||
                        copilotDeviceLoginState === "waiting_for_user"
                      }
                    >
                      {copilotDeviceLoginState === "starting" || copilotDeviceLoginState === "waiting_for_user"
                        ? "Login running..."
                        : "Start device login"}
                    </Button>
                    <Button
                      type="button"
                      tone="neutral"
                      onClick={() => void cancelCopilotDeviceLogin()}
                      disabled={!copilotDeviceLoginSessionId || copilotDeviceLoginState !== "waiting_for_user"}
                    >
                      Cancel
                    </Button>
                    <span className="text-muted">State: {copilotDeviceLoginState}</span>
                  </div>
                  {copilotDeviceLoginUrl ? (
                    <div className="text-muted">
                      Open:{" "}
                      <a className="underline" href={copilotDeviceLoginUrl} target="_blank" rel="noreferrer">
                        {copilotDeviceLoginUrl}
                      </a>
                    </div>
                  ) : null}
                  {copilotDeviceLoginCode ? (
                    <div className="flex items-center justify-between gap-2 rounded-ui border bg-surface px-2 py-1 font-mono text-[12px]">
                      <span>
                        One-time code: <strong>{copilotDeviceLoginCode}</strong>
                      </span>
                      <Button type="button" tone="neutral" onClick={() => void copyCopilotDeviceCode()}>
                        Copy code
                      </Button>
                    </div>
                  ) : null}
                  {copilotDeviceLoginMessage ? (
                    <div className="text-muted">{copilotDeviceLoginMessage}</div>
                  ) : (
                    <div className="text-muted">
                      After login completes, runtime can exchange GitHub auth for Copilot tokens automatically.
                    </div>
                  )}
                  {copilotDeviceLoginLogs.length > 0 ? (
                    <textarea
                      className="h-24 w-full rounded-ui border bg-surface p-2 font-mono text-[11px]"
                      value={copilotDeviceLoginLogs.join("\n")}
                      readOnly
                    />
                  ) : null}
                  <div className="text-muted">
                    If your repo has no <code>login</code> script, set <code>NOVA_COPILOT_DEVICE_LOGIN_COMMAND</code> in env.
                  </div>
                </div>
              ) : null}
              <div className="rounded-ui border bg-surface2 p-2 text-[11px] text-muted">
                Optional exchange endpoint for advanced setups: <code>https://api.github.com/copilot_internal/v2/token</code>
              </div>
              <Input value={settings.copilot.baseUrl} onChange={(e) => setSettings((p) => ({ ...p, copilot: { ...p.copilot, baseUrl: e.target.value } }))} placeholder="COPILOT_BASE_URL" />
              {selectedCopilotPreset?.authMode === "device-login" ? (
                <div className="rounded-ui border bg-surface2 p-2 text-xs text-muted">
                  API key field is hidden for GitHub device login. Credentials load from{" "}
                  <code className="font-mono">~/.nova/copilot-auth.json</code> after you authorize. Switch preset if you need to paste an API key instead.
                </div>
              ) : (
                <Input value={settings.copilot.apiKey} onChange={(e) => setSettings((p) => ({ ...p, copilot: { ...p.copilot, apiKey: e.target.value } }))} placeholder="COPILOT_API_KEY" />
              )}
              <div className="flex flex-wrap gap-2">
                <Button type="button" tone="purple" disabled={settings.copilot.disabled} onClick={() => void runCopilotSetupValidation()}>Validate Copilot setup</Button>
                <a className="text-xs underline" href="https://github.com/marketplace/models" target="_blank" rel="noreferrer">GitHub Models</a>
                <a className="text-xs underline" href="https://openrouter.ai/models" target="_blank" rel="noreferrer">OpenRouter Models</a>
              </div>
              {copilotSetupOutput ? (
                <textarea className="h-24 w-full rounded-ui border bg-surface p-2 font-mono text-xs" value={copilotSetupOutput} readOnly />
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === "identity" ? (
          <Card className="space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">Base Identity</h2>
                <p className="text-xs text-muted">
                  This is Nova&apos;s core persona. Emotion and learning can evolve behavior over time, but this file is the base anchor used at startup.
                </p>
              </div>
              <span className={`rounded-ui border px-2 py-0.5 text-xs ${personaSource === "file" ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-300" : "border-amber-500/40 bg-amber-500/15 text-amber-300"}`}>
                {personaSource === "file" ? "Loaded from file" : "Using fallback"}
              </span>
            </div>
            <label className="grid gap-1 text-xs">
              Voice
              <Input value={defaultPersona.voice} onChange={(e) => setDefaultPersona((p) => ({ ...p, voice: e.target.value }))} placeholder="helpful / mentor / playful..." />
            </label>
            <label className="grid gap-1 text-xs">
              Style tags (comma separated)
              <Input
                value={defaultPersona.style.join(", ")}
                onChange={(e) => setDefaultPersona((p) => ({ ...p, style: e.target.value.split(",").map((item) => item.trim()).filter(Boolean) }))}
                placeholder="direct, concise, warm"
              />
            </label>
            <label className="grid gap-1 text-xs">
              System prompt
              <textarea
                className="min-h-[180px] w-full rounded-ui border bg-surface px-2 py-1 text-sm"
                value={defaultPersona.systemPrompt}
                onChange={(e) => setDefaultPersona((p) => ({ ...p, systemPrompt: e.target.value }))}
              />
            </label>
            <div className="flex items-center gap-2">
              <Button type="button" tone="pink" onClick={() => void saveDefaultPersona()}>Save Base Identity</Button>
              {personaPath ? <span className="text-xs text-muted">File: <code>{personaPath}</code></span> : null}
            </div>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              Identity backups include persona files + learning history + DB snapshot, so Nova&apos;s evolving identity is recoverable after machine issues.
            </div>
            <div className="rounded-ui border bg-surface p-3 space-y-3">
              <div>
                <h3 className="text-sm font-semibold">Orchestration markdown (SOUL-style identity)</h3>
                <p className="text-xs text-muted">
                  Point this to a <strong>markdown file on the agent-core host</strong> that describes who Nova chooses to be — your continuity document, not a third-party setup guide.
                  Inspiration:{" "}
                  <a className="underline" href="https://soul.md/" rel="noreferrer" target="_blank">
                    soul.md
                  </a>
                  . Technically Nova appends this file after base persona/memory; it pairs well with{" "}
                  <a className="underline" href="https://github.com/chuchuyei/SentiCore" rel="noreferrer" target="_blank">
                    SentiCore
                  </a>{" "}
                  prompts when that content lives in your own <code className="text-[11px]">SOUL.md</code>.
                </p>
              </div>
              <label className="flex items-center gap-2 text-sm">
                <Checkbox
                  checked={settings.sentiCore.enabled}
                  onChange={(e) => setSettings((p) => ({ ...p, sentiCore: { ...p.sentiCore, enabled: e.target.checked } }))}
                />
                Inject orchestration markdown into cognitive prompts
              </label>
              <label className="grid gap-1 text-xs">
                Absolute path on agent host (your authored SOUL-style file)
                <Input
                  value={settings.sentiCore.orchestrationMarkdownPath}
                  onChange={(e) =>
                    setSettings((p) => ({ ...p, sentiCore: { ...p.sentiCore, orchestrationMarkdownPath: e.target.value } }))
                  }
                  placeholder="/Users/you/nova/config/SOUL.md"
                />
              </label>
              <p className="text-[11px] text-muted">
                After changing the path, click <strong>Save Settings</strong> at the top before opening the editor (the agent reads the saved path). Avoid aiming this at unrelated docs (e.g. upstream READMEs).
              </p>
              <Button type="button" tone="orange" className="text-sm font-semibold" onClick={() => void openSentiCoreEditor()}>
                Edit SOUL-style markdown…
              </Button>
            </div>
            <div className="rounded-ui border bg-surface p-3">
              <div className="mb-2">
                <h3 className="text-sm font-semibold">Identity Evolution Graph</h3>
                <p className="text-xs text-muted">
                  Bottom is Awakening. Top is Present. This view combines personality updates, learning activity, and backup milestones.
                </p>
              </div>
              <IdentityEvolutionGraph
                items={identityTimeline}
                filters={timelineFilters}
                onToggleFilter={(key) => setTimelineFilters((prev) => ({ ...prev, [key]: !prev[key] }))}
                onRestoreVersion={(version) => void restorePersonaVersion(version)}
                restoringVersion={restoringPersonaVersion}
              />
            </div>
          </Card>
        ) : null}

        {tab === "channels" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">WhatsApp / Signal Bridge Setup</h2>
            <p className="text-xs text-muted">Beginner-friendly setup flow inspired by OpenClaw-style onboarding.</p>
            <div className="rounded-ui border bg-surface p-3 text-xs text-muted">
              <div className="mb-1 font-semibold text-slate-700 dark:text-slate-200">Recommended order</div>
              <ol className="list-inside list-decimal space-y-1">
                <li>Choose which channel to configure first (Signal, WhatsApp, or both).</li>
                <li>Fill the credentials below (Nova auto-uses your phone number where possible).</li>
                <li>Run one-click validation to test connectivity and generate a ready-to-paste env block.</li>
                <li>Save settings, restart services once, then send a test message from your phone.</li>
              </ol>
            </div>
            <label className="grid gap-1 text-sm">
              Setup target
              <Select value={channelsSetupMode} onChange={(e) => setChannelsSetupMode(e.target.value as "signal" | "whatsapp" | "both")}>
                <option value="both">Validate Signal + WhatsApp</option>
                <option value="signal">Validate Signal only</option>
                <option value="whatsapp">Validate WhatsApp only</option>
              </Select>
            </label>
            <label className="grid gap-1 text-sm">Nova phone number<Input value={settings.messagingAccess.novaPhoneNumber} onChange={(e) => setSettings((p) => ({ ...p, messagingAccess: { ...p.messagingAccess, novaPhoneNumber: e.target.value } }))} /></label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.messagingAccess.denyUnknownNumbers} onChange={(e) => setSettings((p) => ({ ...p, messagingAccess: { ...p.messagingAccess, denyUnknownNumbers: e.target.checked } }))} /> Silent deny unknown numbers</label>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-2 rounded-ui border bg-surface p-3">
                <h3 className="text-sm font-semibold">Signal setup (self-hosted)</h3>
                <p className="text-xs text-muted">
                  Install and run <a className="underline" href="https://github.com/bbernhard/signal-cli-rest-api" target="_blank" rel="noreferrer">signal-cli-rest-api</a>. If this number already uses Signal on a phone, use{" "}
                  <strong className="text-foreground">Generate link QR</strong> below (linked device). SMS registration is only for numbers not yet on Signal.
                </p>
                <Input
                  value={String((settings.skillSettings["channel-setup"] as Record<string, unknown> | undefined)?.signalApiUrl ?? "")}
                  onChange={(e) => updateChannelSetup({ signalApiUrl: e.target.value })}
                  placeholder="SIGNAL_API_URL (example: http://127.0.0.1:8080)"
                />
                <Input
                  value={String((settings.skillSettings["channel-setup"] as Record<string, unknown> | undefined)?.signalAccountNumber ?? settings.messagingAccess.novaPhoneNumber ?? "")}
                  onChange={(e) => updateChannelSetup({ signalAccountNumber: e.target.value })}
                  placeholder="SIGNAL_ACCOUNT_NUMBER"
                />
                <div className="text-[11px] text-muted">
                  Install guide: run Docker container from project docs, open REST API, verify account registration, then paste URL + account number here.
                </div>
              </div>
              <div className="space-y-2 rounded-ui border bg-surface p-3">
                <h3 className="text-sm font-semibold">WhatsApp setup</h3>
                <p className="text-xs text-muted">Primary: link your phone with WhatsApp Web (below). Optional: Meta Cloud API in the expandable section.</p>
                <div className="grid gap-3 rounded-ui border bg-surface2 p-3">
                  <div>
                    <h4 className="text-xs font-semibold text-foreground">WhatsApp Web (same phone app)</h4>
                    <p className="mt-0.5 text-[11px] leading-snug text-muted">
                      Clears the saved Baileys session on the <strong className="text-foreground">agent-core host</strong>, then shows a new pairing QR. You must scan within the timeout shown in WhatsApp. Agent-core and Next must point at the same machine (or a reachable agent URL).
                    </p>
                  </div>
                  {whatsAppInlineHint ? (
                    <div className="rounded-ui border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-[12px] font-medium leading-snug text-sky-950 dark:text-sky-100">
                      {whatsAppLinkRunning ? <span className="mr-2 inline-block h-3 w-3 animate-spin rounded-full border-2 border-sky-600 border-t-transparent align-middle" aria-hidden /> : null}
                      {whatsAppInlineHint}
                    </div>
                  ) : null}
                  {whatsAppPollError ? (
                    <p className="text-[11px] font-medium text-amber-800 dark:text-amber-200">Status poll: {whatsAppPollError}</p>
                  ) : null}
                  <div className="text-[11px] text-muted">
                    Status: <strong className="text-foreground">{whatsAppWebStatus?.state ?? "unknown"}</strong>
                    {whatsAppWebStatus?.detail ? ` — ${whatsAppWebStatus.detail}` : ""}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" tone="blue" disabled={whatsAppLinkRunning} onClick={() => void linkWhatsAppWithFreshQr()}>
                      {whatsAppLinkRunning ? "Working…" : "Link WhatsApp — show QR"}
                    </Button>
                    <Button type="button" tone="neutral" disabled={whatsAppLinkRunning} onClick={() => void refreshWhatsAppWebStatus()}>
                      Refresh status
                    </Button>
                    <Button type="button" tone="red" disabled={whatsAppLinkRunning} onClick={() => void stopWhatsAppWebBridgeAction()}>
                      Stop bridge
                    </Button>
                  </div>
                  {whatsAppWebStatus?.state === "connected" ? (
                    <p className="text-[11px] font-medium text-emerald-800 dark:text-emerald-200">WhatsApp Web is connected on this host.</p>
                  ) : null}
                  {whatsAppWebStatus?.qr && whatsAppWebStatus?.state !== "connected" ? (
                    <div className="space-y-2 rounded-ui border border-border bg-surface p-3">
                      <div className="text-[11px] font-semibold text-muted">Scan this QR with WhatsApp</div>
                      {whatsAppQrDataUrl ? (
                        <img
                          className="h-64 w-64 max-w-full rounded-ui border border-border bg-white p-2"
                          src={whatsAppQrDataUrl}
                          alt="WhatsApp Web pairing QR code"
                        />
                      ) : (
                        <div className="space-y-1">
                          <p className="text-[11px] text-muted">Rendering QR…</p>
                          <p className="text-[11px] text-muted">
                            If this never renders, click Refresh status. As a fallback, here is the raw QR payload (for debugging):
                          </p>
                          <Textarea readOnly value={whatsAppWebStatus.qr} rows={3} />
                        </div>
                      )}
                      {whatsAppQrRenderError ? <p className="text-[11px] text-rose-600 dark:text-rose-400">{whatsAppQrRenderError}</p> : null}
                    </div>
                  ) : null}
                </div>
                <details className="rounded-ui border border-border/70 bg-surface2 p-2">
                  <summary className="cursor-pointer list-none text-[11px] font-semibold text-muted outline-none [&::-webkit-details-marker]:hidden">
                    Meta Cloud API (optional) — click to expand
                  </summary>
                  <p className="mb-2 mt-2 text-[11px] text-muted">Use only if you prefer Meta-hosted WhatsApp instead of Web link above.</p>
                  <div className="space-y-2">
                    <Input
                      value={String((settings.skillSettings["channel-setup"] as Record<string, unknown> | undefined)?.whatsAppPhoneNumberId ?? "")}
                      onChange={(e) => updateChannelSetup({ whatsAppPhoneNumberId: e.target.value })}
                      placeholder="WHATSAPP_PHONE_NUMBER_ID"
                    />
                    <Input
                      value={String((settings.skillSettings["channel-setup"] as Record<string, unknown> | undefined)?.whatsAppToken ?? "")}
                      onChange={(e) => updateChannelSetup({ whatsAppToken: e.target.value })}
                      placeholder="WHATSAPP_TOKEN"
                    />
                    <Input
                      value={String((settings.skillSettings["channel-setup"] as Record<string, unknown> | undefined)?.whatsAppAppSecret ?? "")}
                      onChange={(e) => updateChannelSetup({ whatsAppAppSecret: e.target.value })}
                      placeholder="WHATSAPP_APP_SECRET (optional)"
                    />
                  </div>
                </details>
              </div>
            </div>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              <div>
                <strong>Signal quick checklist:</strong> <strong>Start Signal bridge via Docker</strong> {"->"} link phone with <strong>Generate link QR</strong> (or SMS registration only if the number is new to Signal) {"->"}
                validate {"->"} save settings.
              </div>
              <div>
                <strong>WhatsApp quick checklist:</strong> <strong>Link WhatsApp — show QR</strong> {"->"} scan in the phone app {"->"} validate {"->"} save. (Meta Cloud path is optional.)
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-1">
              <Button type="button" tone="blue" onClick={() => void runSignalDockerBootstrap()}>
                Start Signal bridge via Docker
              </Button>
              <Button
                type="button"
                tone="green"
                onClick={async () => {
                  if (channelsSetupMode === "signal") {
                    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
                    const response = await apiFetch("/api/setup/channels/test", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        signalApiUrl: values.signalApiUrl ?? "",
                        signalAccountNumber: values.signalAccountNumber ?? settings.messagingAccess.novaPhoneNumber ?? "",
                        whatsAppPhoneNumberId: "",
                        whatsAppToken: "",
                        whatsAppAppSecret: ""
                      })
                    });
                    const data = await readJsonOrEmpty<{ signal?: SetupCheckResult; suggestedEnv?: string; error?: string }>(response);
                    if (!response.ok) {
                      setError(data.error ?? "Signal setup test failed");
                      return;
                    }
                    setSignalSetupCheck(data.signal ?? null);
                    setStatus("Signal setup checked.");
                    return;
                  }
                  if (channelsSetupMode === "whatsapp") {
                    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
                    const response = await apiFetch("/api/setup/channels/test", {
                      method: "POST",
                      headers: { "content-type": "application/json" },
                      body: JSON.stringify({
                        signalApiUrl: "",
                        signalAccountNumber: "",
                        whatsAppPhoneNumberId: values.whatsAppPhoneNumberId ?? "",
                        whatsAppToken: values.whatsAppToken ?? "",
                        whatsAppAppSecret: values.whatsAppAppSecret ?? ""
                      })
                    });
                    const data = (await response.json()) as { whatsApp?: SetupCheckResult; suggestedEnv?: string; error?: string };
                    if (!response.ok) {
                      setError(data.error ?? "WhatsApp setup test failed");
                      return;
                    }
                    setSignalSetupCheck(null);
                    setStatus("WhatsApp setup checked.");
                    return;
                  }
                  await runOneClickChannelSetup();
                }}
              >
                Validate selected setup
              </Button>
              {signalSetupCheck ? (
                <span
                  className={`inline-flex items-center rounded-full border px-2 py-1 text-[11px] font-semibold ${
                    signalSetupCheck.ok
                      ? "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-200"
                      : "border-amber-600/40 bg-amber-50 text-amber-950 dark:border-amber-400/60 dark:bg-amber-400/10 dark:text-amber-200"
                  }`}
                  aria-live="polite"
                >
                  Signal: {signalSetupCheck.ok ? "OK" : "Needs attention"} - {signalSetupCheck.detail || "-"}
                </span>
              ) : null}
            </div>
            <div className="space-y-3 rounded-ui border bg-surface p-3">
              <h3 className="text-sm font-semibold">Signal: link phone (QR)</h3>
              <p className="text-[11px] leading-snug text-muted">
                Same as Signal Desktop: this bridge becomes a linked device on your primary phone. Open Signal on the phone → Settings → Linked devices → Link new device, then scan the QR. No SMS code.
              </p>
              <label className="grid gap-1 text-xs">
                Device name (shown under linked devices on the phone)
                <Input
                  value={signalQrDeviceName}
                  onChange={(e) => setSignalQrDeviceName(e.target.value)}
                  placeholder="Nova Agent Web"
                />
              </label>
              <div className="flex flex-wrap gap-2">
                <Button type="button" tone="blue" disabled={signalQrLoading} onClick={() => void runSignalQrLinkFetch()}>
                  {signalQrLoading ? "Loading QR…" : "Generate link QR"}
                </Button>
                <Button type="button" tone="green" disabled={signalAccountsLoading} onClick={() => void runSignalAccountsRefresh()}>
                  {signalAccountsLoading ? "Checking…" : "Refresh linked accounts"}
                </Button>
              </div>
              {signalQrEndpoint ? (
                <p className="break-all font-mono text-[10px] text-muted" title="Upstream URL used by agent-core">
                  {signalQrEndpoint}
                </p>
              ) : null}
              {signalQrImageUrl ? (
                <div className="space-y-2 rounded-ui border border-border bg-surface2 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-[11px] font-semibold text-muted">Scan with your phone</div>
                    <div className="flex flex-wrap gap-2">
                      {!signalQrDismissed ? (
                        <Button type="button" tone="neutral" className="h-7 px-2 text-xs" onClick={() => setSignalQrDismissed(true)}>
                          Dismiss QR
                        </Button>
                      ) : (
                        <Button type="button" tone="blue" className="h-7 px-2 text-xs" onClick={() => setSignalQrDismissed(false)}>
                          Show QR again
                        </Button>
                      )}
                    </div>
                  </div>
                  {!signalQrDismissed ? (
                    <img
                      className="max-h-80 w-80 max-w-full rounded-ui border border-border bg-white p-2"
                      src={signalQrImageUrl}
                      alt="Signal device link QR code"
                    />
                  ) : (
                    <p className="text-[11px] text-muted">QR hidden. Use Show QR again, or Generate link QR for a fresh code.</p>
                  )}
                  <p className="text-[11px] text-muted">
                    signal-cli-rest-api issues a new QR on each request. If scanning fails or times out, click Generate link QR again.
                  </p>
                </div>
              ) : null}
              {signalLinkedAccounts !== null ? (
                <div className="rounded-ui border border-emerald-600/25 bg-surface2 p-2 text-[11px]">
                  <div className="mb-1 font-semibold text-muted">Accounts on this bridge</div>
                  {signalLinkedAccounts.length > 0 ? (
                    <ul className="list-inside list-disc space-y-1 font-mono">
                      {signalLinkedAccounts.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-muted">None yet — finish linking on the phone, then Refresh linked accounts.</p>
                  )}
                </div>
              ) : null}
            </div>
            <details className="rounded-ui border bg-surface p-2">
              <summary className="cursor-pointer list-none text-sm font-semibold text-foreground outline-none [&::-webkit-details-marker]:hidden">
                Signal: new number (SMS) — only if this number is not on Signal yet
              </summary>
              <div className="mt-3 space-y-3 border-t border-border/60 pt-3">
                <p className="text-[11px] leading-snug text-muted">
                  If your number already uses Signal on a phone, skip this — use <strong className="text-foreground">Generate link QR</strong> above. Otherwise: request the SMS code, enter it below, then submit. If Nova says a captcha is required, open the captcha helper panel (or it may open automatically).
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" tone="purple" onClick={() => void runSignalRegisterStart()}>
                    Step 1 — request SMS / voice code
                  </Button>
                  <Button
                    type="button"
                    tone="neutral"
                    onClick={() => {
                      setSignalCaptchaModalDetail("");
                      setSignalCaptchaModalOpen(true);
                    }}
                  >
                    Captcha helper panel
                  </Button>
                </div>
                <label className="grid gap-1 text-xs">
                  SMS or voice verification code
                  <Input
                    value={signalVerificationCode}
                    onChange={(e) => setSignalVerificationCode(e.target.value)}
                    placeholder="Digits from Signal / SMS"
                  />
                </label>
                <label className="flex cursor-pointer items-center gap-2 text-xs text-text">
                  <Checkbox
                    checked={signalRegistrationUseVoice}
                    onChange={(e) => setSignalRegistrationUseVoice(e.target.checked)}
                  />
                  Request voice call instead of SMS (optional)
                </label>
                <label className="grid gap-1 text-xs">
                  Captcha token (filled automatically from the helper when possible)
                  <Textarea
                    value={signalRegistrationCaptcha}
                    onChange={(e) => setSignalRegistrationCaptcha(e.target.value)}
                    placeholder="signal-hcaptcha-… (pasted URL or token is fine)"
                    rows={2}
                    className="font-mono text-[11px]"
                  />
                </label>
                <div className="flex flex-wrap items-start gap-2">
                  <Button type="button" tone="green" onClick={() => void runSignalVerifyCode()}>
                    Submit verification code
                  </Button>
                  {signalRegisterStatus ? (
                    <span
                      className={`inline-flex max-w-full min-w-0 flex-1 items-center rounded-lg border px-2 py-1.5 text-xs font-semibold leading-snug sm:flex-initial sm:rounded-full ${
                        signalRegisterStatus.ok
                          ? "border-emerald-600/35 bg-emerald-50 text-emerald-900 dark:border-emerald-400/60 dark:bg-emerald-400/10 dark:text-emerald-200"
                          : "border-rose-600/40 bg-rose-50 text-rose-900 dark:border-rose-400/60 dark:bg-rose-400/10 dark:text-rose-200"
                      }`}
                      aria-live="polite"
                    >
                      <span className="break-words">
                        SMS registration: {signalRegisterStatus.ok ? "OK" : "Failed"} — {signalRegisterStatus.detail}
                      </span>
                    </span>
                  ) : null}
                </div>
              </div>
            </details>
            <div className="rounded-ui border bg-surface p-3 space-y-3">
              <h3 className="text-sm font-semibold">Allowed phone numbers by channel</h3>
              <p className="text-xs text-muted">
                Assign tiers for messaging channels only (Signal/WhatsApp). Save Settings to apply.
              </p>
              <div className="grid gap-3 md:grid-cols-2">
                {(["signal", "whatsapp"] as const).map((channel) => (
                  <div key={channel} className="rounded-ui border bg-surface2 p-2 space-y-2">
                    <div className="flex items-center justify-between">
                      <strong className="text-sm">{channel === "signal" ? "Signal" : "WhatsApp"}</strong>
                      <Button type="button" tone="blue" className="h-7 px-2 text-xs" onClick={() => addChannelTierRow(channel)}>
                        Add
                      </Button>
                    </div>
                    <div className="space-y-1.5">
                      {settings.messagingAccess.channelTiers[channel].map((row, idx) => (
                        <div
                          key={`${channel}-${idx}`}
                          className="grid grid-cols-1 gap-1.5 sm:grid-cols-[minmax(14rem,1fr)_130px_auto] sm:items-center"
                        >
                          <Input
                            value={row.phone}
                            onChange={(e) => updateChannelTier(channel, idx, { phone: e.target.value })}
                            placeholder="+15551234567"
                            title={row.phone.trim() || "E.164 phone number"}
                            className="min-w-0 font-mono text-[13px]"
                          />
                          <Select
                            value={row.tier}
                            onChange={(e) =>
                              updateChannelTier(channel, idx, {
                                tier: e.target.value as "admin" | "co_admin" | "restricted" | "guest"
                              })
                            }
                          >
                            <option value="admin">Admin</option>
                            <option value="co_admin">Co-Admin</option>
                            <option value="restricted">Restricted</option>
                            <option value="guest">Guest</option>
                          </Select>
                          <Button type="button" tone="red" className="h-9 px-2 text-xs" onClick={() => removeChannelTierRow(channel, idx)}>
                            Remove
                          </Button>
                        </div>
                      ))}
                      {settings.messagingAccess.channelTiers[channel].length === 0 ? (
                        <p className="text-[11px] text-muted">No numbers assigned yet.</p>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="rounded-ui border bg-surface p-3 space-y-2">
              <h3 className="text-sm font-semibold">Tier control (fixed policy)</h3>
              <div className="overflow-auto">
                <table className="w-full min-w-[620px] text-[13px] leading-snug">
                  <thead>
                    <tr className="text-left text-slate-600 dark:text-muted">
                      <th className="px-2 py-1">Tier</th>
                      <th className="px-2 py-1">Capabilities</th>
                      <th className="px-2 py-1">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr className="border-t border-border/60">
                      <td className="px-2 py-1 font-semibold">Admin</td>
                      <td className="px-2 py-1">All channel capabilities</td>
                      <td className="px-2 py-1 text-muted">
                        Only one phone number may be Admin globally (the same E.164 on Signal and WhatsApp counts once).
                      </td>
                    </tr>
                    <tr className="border-t border-border/60">
                      <td className="px-2 py-1 font-semibold">Co-Admin</td>
                      <td className="px-2 py-1">All channel capabilities</td>
                      <td className="px-2 py-1 text-muted">Operationally same as Admin for channel actions, but intended no admin-account management.</td>
                    </tr>
                    <tr className="border-t border-border/60">
                      <td className="px-2 py-1 font-semibold">Restricted</td>
                      <td className="px-2 py-1">Skills allowed except system-changing actions; shell blocked</td>
                      <td className="px-2 py-1 text-muted">No shell, no scheduler, no security-center actions.</td>
                    </tr>
                    <tr className="border-t border-border/60">
                      <td className="px-2 py-1 font-semibold">Guest</td>
                      <td className="px-2 py-1">Conversation + media assistant tasks only</td>
                      <td className="px-2 py-1 text-muted">Talk to Nova, ask image/video generation; no system controls.</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              <BridgeGuide title="SignalBridge" item={catalog?.setup?.signalBridge} />
              <BridgeGuide title="WhatsAppBridge" item={catalog?.setup?.whatsAppBridge} />
            </div>
            <div className="rounded-ui border bg-surface p-3 space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Channel message trace</h3>
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="tablist"
                    aria-label="Trace view mode"
                    className="inline-flex overflow-hidden rounded-md border border-border/60 text-[11px]"
                  >
                    <button
                      type="button"
                      role="tab"
                      aria-selected={channelDebugView === "conversation"}
                      className={`px-2 py-1 transition ${
                        channelDebugView === "conversation"
                          ? "bg-indigo-600 text-white"
                          : "bg-surface text-muted hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      }`}
                      onClick={() => setChannelDebugView("conversation")}
                    >
                      Conversation
                    </button>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={channelDebugView === "raw"}
                      className={`px-2 py-1 transition ${
                        channelDebugView === "raw"
                          ? "bg-indigo-600 text-white"
                          : "bg-surface text-muted hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                      }`}
                      onClick={() => setChannelDebugView("raw")}
                    >
                      Raw trace
                    </button>
                  </div>
                  <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted">
                    <Checkbox checked={channelDebugAutoRefresh} onChange={(e) => setChannelDebugAutoRefresh(e.target.checked)} />
                    Auto-refresh (4s)
                  </label>
                  <button
                    type="button"
                    aria-label="Refresh channel message trace"
                    className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-black/5 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                    onClick={() => void refreshChannelDebug()}
                    disabled={channelDebugLoading}
                  >
                    <FaRotateRight className={`h-4 w-4 ${channelDebugLoading ? "animate-spin" : ""}`} />
                  </button>
                </div>
              </div>
              <p className="text-[11px] text-muted leading-snug">
                Only <strong className="text-foreground">Signal/WhatsApp</strong> webhook traffic (not browser chat). In-memory; clears when agent-core restarts.
              </p>
              <p className="text-[11px] text-muted leading-snug">
                <strong className="text-foreground">All on one Mac:</strong> Signal bridge runs in Docker; use{" "}
                <code className="text-[10px]">http://host.docker.internal:8787/v1/webhooks/signal</code> (default) so the container posts to agent-core on the host — not{" "}
                <code className="text-[10px]">http://localhost:3000/…</code> (inside Docker, <code className="text-[10px]">localhost</code> is the container). Bootstrap applies this when you open Settings from{" "}
                <code className="text-[10px]">localhost</code>. Public hostnames still use <code className="text-[10px]">https://…/api/webhooks/signal</code>.
              </p>
              <p className="text-[11px] text-muted leading-snug">
                Rows: <strong className="text-foreground">none</strong> = no POST here · <code className="text-[10px]">signature_invalid</code> ·{" "}
                <code className="text-[10px]">parsed_zero_messages</code> · <code className="text-[10px]">access_denied</code> · <code className="text-[10px]">orchestrator_error</code> · in but no out = send.
              </p>
              <p className="text-[11px] text-muted leading-snug">
                <strong className="text-foreground">next_proxy</strong> rows = Next could not reach the agent or the agent returned an error body.{" "}
                <strong className="text-foreground">receive_ws</strong> = inbound over the Signal REST WebSocket (works when webhooks cannot reach this agent).{" "}
                <strong className="text-foreground">Docker</strong> = last lines from <code className="text-[10px]">nova-signal-bridge</code> on this machine (same Mac as agent-core).
              </p>
              <div className="flex flex-wrap gap-3 text-[11px]">
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-cyan-600/60 bg-cyan-600/35" aria-hidden />
                  receive_ws
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-violet-500/60 bg-violet-500/35" aria-hidden />
                  Next proxy
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-blue-500/60 bg-blue-500/35" aria-hidden />
                  Signal in
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-indigo-600/60 bg-indigo-600/35" aria-hidden />
                  Signal out
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-emerald-500/60 bg-emerald-500/35" aria-hidden />
                  WhatsApp in
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="inline-block h-3 w-3 shrink-0 rounded-sm border border-teal-600/60 bg-teal-600/35" aria-hidden />
                  WhatsApp out
                </span>
              </div>
              {channelDebugError ? <p className="text-xs text-red-600 dark:text-red-400">{channelDebugError}</p> : null}
              {/* Two stacked rows (was a 2-column grid). The trace + Docker logs each get the full content
                  width so long Signal payloads (sourceUuid, dataMessage JSON) don't wrap into a narrow column. */}
              <div className="flex flex-col gap-2">
                <div className="min-h-[400px]">
                  <div className="mb-1 text-[11px] font-medium text-muted">Agent + Next</div>
                  <div className="h-[460px] min-h-[400px] space-y-1.5 overflow-y-auto overflow-x-hidden rounded border border-border/60 bg-surface2 p-2">
                    {channelDebugEntries.length === 0 && channelDebugLoading ? (
                      <p className="px-1 py-4 text-center text-xs text-muted">Loading…</p>
                    ) : null}
                    {channelDebugEntries.length === 0 && !channelDebugLoading ? (
                      <p className="px-1 py-4 text-center text-xs text-muted">
                        No webhook hits yet — only Signal/WhatsApp POSTs to the agent show here.
                      </p>
                    ) : null}
                    {channelDebugView === "conversation"
                      ? buildChannelConversation(channelDebugEntries).map((item) => (
                          <ConversationRow key={item.id} item={item} />
                        ))
                      : channelDebugEntries.map((entry) => {
                      const handledElsewhere = entry.trace?.includes("deduped_other_transport") ?? false;
                      const novaStatus =
                        entry.direction === "in" && typeof entry.reachedNova === "boolean"
                          ? handledElsewhere
                            ? { label: "handled elsewhere", tone: "text-sky-700 dark:text-sky-300" }
                            : entry.reachedNova
                              ? { label: "Nova handled", tone: "text-emerald-700 dark:text-emerald-400" }
                              : { label: "Nova did not handle", tone: "text-amber-700 dark:text-amber-400" }
                          : null;
                      return (
                      <div
                        key={entry.id}
                        className={`rounded-md border border-border/40 px-2 py-1.5 text-[12px] leading-snug ${channelDebugRowAccent(entry)}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
                            <span className="font-mono text-[11px] text-muted">{formatChannelDebugTime(entry.at)}</span>
                            <strong className="capitalize">{entry.channel}</strong>
                            <span className="text-muted">·</span>
                            <span>{entry.direction === "in" ? "in" : "out"}</span>
                            {entry.transport ? (
                              <>
                                <span className="text-muted">·</span>
                                <span className="text-[11px]">{entry.transport}</span>
                              </>
                            ) : null}
                          </div>
                          {novaStatus ? (
                            <span className={`shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium dark:bg-white/10 ${novaStatus.tone}`}>
                              {novaStatus.label}
                            </span>
                          ) : null}
                        </div>
                        {entry.peer ? (
                          <div className="truncate text-[11px] text-muted" title={entry.peer}>
                            Peer: {entry.peer}
                          </div>
                        ) : null}
                        <div className="break-words">{entry.textPreview}</div>
                        {entry.trace?.length ? (
                          <div className="mt-1 flex flex-wrap gap-1">
                            {entry.trace.map((step, ti) => (
                              <span key={`${entry.id}-t-${ti}`} className="rounded bg-black/10 px-1.5 py-0 font-mono text-[10px] dark:bg-white/10">
                                {step}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="mt-1 truncate font-mono text-[10px] text-muted" title={entry.correlationId}>
                          corr: {entry.correlationId}
                        </div>
                        {entry.error ? <div className="mt-1 text-[11px] text-red-600 dark:text-red-400">{entry.error}</div> : null}
                      </div>
                      );
                    })}
                    {channelDebugView === "conversation" && buildChannelConversation(channelDebugEntries).length === 0 && channelDebugEntries.length > 0 ? (
                      <p className="px-1 py-4 text-center text-xs text-muted">
                        No conversation events yet — only diagnostic rows in this window. Switch to <em>Raw trace</em> to inspect them.
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="min-h-0">
                  <button
                    type="button"
                    className="mb-1 flex w-full items-center justify-between gap-2 rounded-md border border-border/60 bg-surface2 px-2 py-1.5 text-left text-[11px] font-medium text-muted transition hover:bg-black/[0.04] dark:hover:bg-white/[0.06]"
                    onClick={() => setSignalDockerLogsExpanded((v) => !v)}
                    aria-expanded={signalDockerLogsExpanded}
                  >
                    <span>Signal bridge (Docker)</span>
                    <FaChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform ${signalDockerLogsExpanded ? "rotate-180" : ""}`} aria-hidden />
                  </button>
                  {signalDockerLogsExpanded ? (
                    <div className="flex h-[460px] min-h-[400px] flex-col rounded border border-border/60 bg-surface2">
                      {signalDockerNote ? (
                        <p className="shrink-0 border-b border-border/50 p-2 text-[11px] text-amber-800 dark:text-amber-200">{signalDockerNote}</p>
                      ) : null}
                      {/* Auto-scroll to bottom on each refresh so the latest Gin lines stay in view. */}
                      <pre
                        ref={signalDockerLogsRef}
                        className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-2 font-mono text-[10px] leading-snug text-muted"
                      >
                        {signalDockerLogs || (channelDebugLoading ? "Loading…" : "(no log lines)")}
                      </pre>
                    </div>
                  ) : (
                    <p className="rounded-md border border-dashed border-border/60 px-2 py-2 text-[11px] text-muted">
                      Collapsed by default. Expand to view <code className="text-[10px]">nova-signal-bridge</code> logs — newest entries at the bottom (auto-scrolled).
                    </p>
                  )}
                </div>
              </div>
            </div>
          </Card>
        ) : null}

        {tab === "learning" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Learning, memory & cognitive cores</h2>
            <label className="flex items-center gap-2"><Checkbox checked={settings.learning.enabled} onChange={(e) => setSettings((p) => ({ ...p, learning: { ...p.learning, enabled: e.target.checked } }))} /> Enable background learning</label>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-xs">
                Idle minutes before cycle
                <Input type="number" value={settings.learning.idleMinutes} onChange={(e) => setSettings((p) => ({ ...p, learning: { ...p.learning, idleMinutes: Number(e.target.value || 0) } }))} placeholder="Idle minutes" />
              </label>
              <label className="grid gap-1 text-xs">
                Cycle interval (ms)
                <Input type="number" value={settings.learning.intervalMs} onChange={(e) => setSettings((p) => ({ ...p, learning: { ...p.learning, intervalMs: Number(e.target.value || 0) } }))} placeholder="Cycle interval ms" />
              </label>
              <label className="grid gap-1 text-xs">
                Auto-improve failure threshold
                <Input type="number" value={settings.learning.minFailuresForAutoImprove} onChange={(e) => setSettings((p) => ({ ...p, learning: { ...p.learning, minFailuresForAutoImprove: Number(e.target.value || 0) } }))} placeholder="Failures threshold" />
              </label>
            </div>
            <p className="text-xs text-muted">Lower values run learning more often. Auto-improvement triggers only when recent failure count reaches the threshold.</p>
            <label className="flex items-center gap-2"><Checkbox checked={settings.emotions.enabled} onChange={(e) => setSettings((p) => ({ ...p, emotions: { ...p.emotions, enabled: e.target.checked } }))} /> Enable emotion core</label>
            {settings.emotions.enabled ? (
              <label className="grid gap-1 text-xs">
                Emotional expression intensity
                <Select value={settings.emotions.expressionStyle} onChange={(e) => setSettings((p) => ({ ...p, emotions: { ...p.emotions, expressionStyle: e.target.value as SettingsState["emotions"]["expressionStyle"] } }))}>
                  <option value="subtle">Subtle</option>
                  <option value="balanced">Balanced</option>
                  <option value="expressive">Expressive</option>
                </Select>
                <span className="text-[11px] text-muted">
                  Applied by agent-core in mood overlays (how strongly tone cues surface in prompts). Subtle is quieter; expressive is more vivid.
                </span>
              </label>
            ) : (
              <p className="text-[11px] text-muted">Turn on emotion core to adjust expression intensity.</p>
            )}
            <label className="flex items-center gap-2">
              <Checkbox
                checked={settings.emotions.mirrorUserValence}
                onChange={(e) => setSettings((p) => ({ ...p, emotions: { ...p.emotions, mirrorUserValence: e.target.checked } }))}
              />
              Mirror user valence from phrasing
            </label>
            <p className="text-xs text-muted">
              Orchestration markdown / SOUL-style identity: configure under <strong>Settings → Identity</strong>, then <strong>Edit SOUL-style markdown…</strong> on the agent host file you chose (your narrative manifesto, not an unrelated install guide).
            </p>
            <div className="mt-4 border-t border-border pt-3 space-y-2">
              <h3 className="text-sm font-semibold">MemoryBear (optional)</h3>
              <p className="text-xs text-muted">
                Connect to a running{" "}
                <a className="underline" href="https://github.com/SuanmoSuanyangTechnology/MemoryBear" rel="noreferrer" target="_blank">
                  MemoryBear
                </a>{" "}
                API. Nova maps each Nova user to a MemoryBear end-user automatically. Paste a service API key with the <code className="text-xs">memory</code> scope.
              </p>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={settings.memoryBear.enabled}
                  onChange={(e) => setSettings((p) => ({ ...p, memoryBear: { ...p.memoryBear, enabled: e.target.checked } }))}
                />
                Enable MemoryBear retrieval + optional writes
              </label>
              <label className="grid gap-1 text-xs">
                MemoryBear base URL (e.g. http://127.0.0.1:8000)
                <Input
                  value={settings.memoryBear.baseUrl}
                  onChange={(e) => setSettings((p) => ({ ...p, memoryBear: { ...p.memoryBear, baseUrl: e.target.value } }))}
                  placeholder="http://127.0.0.1:8000"
                />
              </label>
              <label className="grid gap-1 text-xs">
                API key (Bearer)
                <Input
                  type="password"
                  autoComplete="off"
                  value={settings.memoryBear.apiKey}
                  onChange={(e) => setSettings((p) => ({ ...p, memoryBear: { ...p.memoryBear, apiKey: e.target.value } }))}
                  placeholder="sk-…"
                />
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs">
                  Search mode
                  <Select
                    value={settings.memoryBear.searchSwitch}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        memoryBear: { ...p.memoryBear, searchSwitch: e.target.value as SettingsState["memoryBear"]["searchSwitch"] }
                      }))
                    }
                  >
                    <option value="0">0 — verify</option>
                    <option value="1">1 — direct</option>
                    <option value="2">2 — fast (default)</option>
                  </Select>
                </label>
                <label className="grid gap-1 text-xs">
                  Storage
                  <Select
                    value={settings.memoryBear.storageType}
                    onChange={(e) =>
                      setSettings((p) => ({
                        ...p,
                        memoryBear: { ...p.memoryBear, storageType: e.target.value as SettingsState["memoryBear"]["storageType"] }
                      }))
                    }
                  >
                    <option value="neo4j">neo4j</option>
                    <option value="rag">rag</option>
                  </Select>
                </label>
              </div>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={settings.memoryBear.syncWrites}
                  onChange={(e) => setSettings((p) => ({ ...p, memoryBear: { ...p.memoryBear, syncWrites: e.target.checked } }))}
                />
                Sync each chat turn to MemoryBear after reply (write/sync)
              </label>
            </div>
          </Card>
        ) : null}

        {tab === "voice" ? (
          <Card className="space-y-4">
            <div>
              <h2 className="text-lg font-semibold">Voice & speech</h2>
              <p className="text-xs text-muted">
                Wake-word tooling and Orpheus HTTP TTS for chat read-aloud. Previously opened from the sidebar; everything lives here now (
                <code className="text-[11px]">/settings?tab=voice</code>
                ).
              </p>
            </div>
            <div className="rounded-xl border border-border bg-surface/90 p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <div className="text-xs font-medium text-text">Voice auto-send silence</div>
                  <p className="mt-0.5 max-w-md text-[10px] leading-snug text-muted">
                    When “Auto-send after silence” is on in the chat options menu, Nova waits this long after the composer stops changing, then sends the message. The same duration stops server microphone capture after you finish speaking.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="tabular-nums text-sm font-semibold text-text">{settings.web.voiceDictationSilenceSec}s</span>
                  {voiceSilenceSaveState === "saving" ? (
                    <span className="text-[10px] text-muted">Saving…</span>
                  ) : voiceSilenceSaveState === "saved" ? (
                    <span className="text-[10px] text-emerald-600 dark:text-emerald-400">Saved</span>
                  ) : voiceSilenceSaveState === "error" ? (
                    <span className="text-[10px] text-rose-500">Error</span>
                  ) : null}
                </div>
              </div>
              <div className="mt-3 px-0.5">
                <input
                  type="range"
                  className="voice-silence-slider"
                  min={1}
                  max={4}
                  step={1}
                  value={settings.web.voiceDictationSilenceSec}
                  aria-valuemin={1}
                  aria-valuemax={4}
                  aria-valuenow={settings.web.voiceDictationSilenceSec}
                  aria-label="Seconds of silence before auto-sending dictated chat"
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      web: {
                        ...p.web,
                        voiceDictationSilenceSec: Math.min(4, Math.max(1, Number(e.target.value) || 2))
                      }
                    }))
                  }
                />
                <div className="mt-1 flex justify-between text-[10px] tabular-nums text-muted">
                  <span>1s</span>
                  <span>2s</span>
                  <span>3s</span>
                  <span>4s</span>
                </div>
              </div>
            </div>
            <VoiceWakeWordPanel />
            <div className="rounded-ui border border-border bg-surface/80 p-3 space-y-3">
              <h3 className="text-sm font-semibold">Orpheus TTS (optional)</h3>
              <p className="text-xs text-muted">
                <a className="underline" href="https://github.com/Lex-au/Orpheus-FastAPI" rel="noreferrer" target="_blank">
                  Orpheus-FastAPI
                </a>{" "}
                exposes <code className="text-xs">POST /v1/audio/speech</code>. Agent-core proxies synthesis for the web UI.
              </p>
              <label className="flex items-center gap-2">
                <Checkbox
                  checked={settings.orpheusTts.enabled}
                  onChange={(e) => setSettings((p) => ({ ...p, orpheusTts: { ...p.orpheusTts, enabled: e.target.checked } }))}
                />
                Enable Orpheus HTTP TTS
              </label>
              <label className="grid gap-1 text-xs">
                Base URL (e.g. http://127.0.0.1:5005)
                <Input
                  value={settings.orpheusTts.baseUrl}
                  onChange={(e) => setSettings((p) => ({ ...p, orpheusTts: { ...p.orpheusTts, baseUrl: e.target.value } }))}
                  placeholder="http://127.0.0.1:5005"
                />
              </label>
              <label className="grid gap-1 text-xs">
                API key (optional)
                <Input
                  type="password"
                  autoComplete="off"
                  value={settings.orpheusTts.apiKey}
                  onChange={(e) => setSettings((p) => ({ ...p, orpheusTts: { ...p.orpheusTts, apiKey: e.target.value } }))}
                  placeholder="Bearer if required"
                />
              </label>
              <div className="grid gap-2 md:grid-cols-2">
                <label className="grid gap-1 text-xs">
                  Voice id
                  <Input
                    value={settings.orpheusTts.voice}
                    onChange={(e) => setSettings((p) => ({ ...p, orpheusTts: { ...p.orpheusTts, voice: e.target.value } }))}
                    placeholder="upstream default / speaker id"
                  />
                </label>
                <label className="grid gap-1 text-xs">
                  Model (optional)
                  <Input
                    value={settings.orpheusTts.model}
                    onChange={(e) => setSettings((p) => ({ ...p, orpheusTts: { ...p.orpheusTts, model: e.target.value } }))}
                    placeholder="tts-1 or omit"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs">
                Response format
                <Select
                  value={settings.orpheusTts.responseFormat}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      orpheusTts: { ...p.orpheusTts, responseFormat: e.target.value as SettingsState["orpheusTts"]["responseFormat"] }
                    }))
                  }
                >
                  <option value="wav">wav (fastest start in browser)</option>
                  <option value="opus">opus</option>
                  <option value="pcm">pcm</option>
                  <option value="mp3">mp3</option>
                  <option value="flac">flac</option>
                </Select>
              </label>
            </div>
            <p className="text-[11px] text-muted">
              If spoken audio sounds wrong, call{" "}
              <code className="rounded bg-black/15 px-1 py-0.5 text-[10px]">POST /api/voice/tts-trace</code> with{" "}
              <code className="text-[10px]">{`{ "text": "…same assistant markdown…" }`}</code> — JSON shows{" "}
              <strong>sentToOrpheus</strong> (exact string passed to Orpheus after stripping markdown and mood tags).
            </p>
            <OrpheusTtsPreviewCard />
          </Card>
        ) : null}

        {tab === "backup" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Identity Backup</h2>
            <p className="text-xs text-muted">
              Pushes a snapshot branch to the Git remote you configure below (default <code className="text-[11px]">origin</code>). For a <strong>public</strong> Nova repo, create an empty <strong>private</strong> repository, then on the agent host run once:{" "}
              <code className="text-[11px]">git remote add identity-private &lt;private-repo-url&gt;</code> and set push remote to{" "}
              <code className="text-[11px]">identity-private</code>. Needs Git + credentials with push access to that remote. Includes DB, personas, config, and learning sidecars. If Git says the repo is not initialized, set{" "}
              <code className="text-[11px]">NOVA_REPO_ROOT</code> on the agent to the monorepo path.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={settings.identityBackup.enabled}
                onChange={(e) => setSettings((p) => ({ ...p, identityBackup: { ...p.identityBackup, enabled: e.target.checked } }))}
              />
              Enable automatic identity backup
            </label>
            <div className="grid gap-3 md:grid-cols-2">
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-text">Interval (days)</span>
                <span className="text-muted">Minimum full days between automatic backup runs (1–30).</span>
                <Input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.identityBackup.intervalDays}
                  onChange={(e) =>
                    setSettings((p) => ({ ...p, identityBackup: { ...p.identityBackup, intervalDays: Number(e.target.value || 1) } }))
                  }
                  placeholder="e.g. 1"
                />
              </label>
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-text">Label prefix</span>
                <span className="text-muted">Short tag used in snapshot folder names and backup labels (letters, numbers, dash).</span>
                <Input
                  value={settings.identityBackup.labelPrefix}
                  onChange={(e) => setSettings((p) => ({ ...p, identityBackup: { ...p.identityBackup, labelPrefix: e.target.value } }))}
                  placeholder="e.g. nova-core"
                />
              </label>
              <label className="grid gap-1 text-xs md:col-span-2">
                <span className="font-medium text-text">Push remote name</span>
                <span className="text-muted">
                  Git remote for <code className="text-[10px]">git push</code> (not a URL). Add the URL once on the server with{" "}
                  <code className="text-[10px]">git remote add …</code>. Override via env <code className="text-[10px]">NOVA_IDENTITY_BACKUP_GIT_REMOTE</code>.
                </span>
                <Input
                  value={settings.identityBackup.gitRemote}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      identityBackup: { ...p.identityBackup, gitRemote: e.target.value }
                    }))
                  }
                  placeholder="origin"
                  spellCheck={false}
                />
              </label>
            </div>
            <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-end">
              <label className="grid gap-1 text-xs">
                <span className="font-medium text-text">Manual backup label (optional)</span>
                <span className="text-muted">Extra tag for this one-off push; combined with date when the backup runs.</span>
                <Input value={backupLabel} onChange={(e) => setBackupLabel(e.target.value)} placeholder="e.g. before-os-upgrade" />
              </label>
              <Button type="button" tone="pink" className="md:mb-0.5" onClick={() => void pushIdentityBackup()}>
                Push backup now
              </Button>
            </div>
          </Card>
        ) : null}

        {tab === "updates" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Auto Updates</h2>
            <p className="text-xs text-muted">Automatic checks run at most once per day. Use "Check now" anytime for a manual check.</p>
            <p className="text-xs text-muted">
              Recommended on macOS: run Nova under a launchd service once, then this button can update + restart without manual SSH. See{" "}
              <code className="rounded bg-black/15 px-1 py-0.5 text-[10px]">scripts/install-macos-service.sh</code>{" "}
              (<code className="text-[10px]">docs/macos-service.md</code>): the installer runs the stack as <strong>your</strong> macOS user, so <strong>Apply latest</strong> (automatic <code className="text-[10px]">git pull</code> inside agent-core) never writes root-owned files under <code className="text-[10px]">.git</code>. Re-run the installer after upgrading Nova; if <code className="text-[10px]">.git</code> was already damaged, run <code className="text-[10px]">sudo bash scripts/repair-nova-git-ownership.sh</code> once from your user.
            </p>
            <label className="flex items-center gap-2"><Checkbox checked={settings.updates.enabled} onChange={(e) => setSettings((p) => ({ ...p, updates: { ...p.updates, enabled: e.target.checked } }))} /> Enable update checks</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.updates.autoApply} onChange={(e) => setSettings((p) => ({ ...p, updates: { ...p.updates, autoApply: e.target.checked } }))} /> Auto apply updates in background</label>
            <div className="grid gap-2 md:grid-cols-3">
              <Input value={settings.updates.repoOwner} onChange={(e) => setSettings((p) => ({ ...p, updates: { ...p.updates, repoOwner: e.target.value } }))} placeholder="Repo owner" />
              <Input value={settings.updates.repoName} onChange={(e) => setSettings((p) => ({ ...p, updates: { ...p.updates, repoName: e.target.value } }))} placeholder="Repo name" />
              <Input type="number" value={settings.updates.checkIntervalMs} onChange={(e) => setSettings((p) => ({ ...p, updates: { ...p.updates, checkIntervalMs: Number(e.target.value || 0) } }))} placeholder="Check interval ms" />
            </div>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              Update channel is currently a single stream from your configured repository.
              <div className="mt-1">Current mode: <strong>Repository HEAD</strong> (channel selector reserved for future multi-track releases).</div>
            </div>
            <div className="flex gap-2">
              <Button type="button" tone="yellow" onClick={() => void checkUpdates()}>Check now</Button>
              <Button type="button" tone="orange" onClick={() => void applyUpdates()} disabled={updateApplying}>
                {updateApplying ? "Applying… restarting…" : "Apply latest"}
              </Button>
            </div>
            {updateApplying ? (
              <div className="rounded-ui border border-orange-400/40 bg-orange-400/10 p-2 text-xs text-orange-900 dark:text-orange-100">
                Updating Nova in progress. Services may disconnect briefly; this page will auto-reload when agent-core responds again.
              </div>
            ) : null}
            {updateStatus ? (
              <div className="rounded-ui border bg-surface p-2 text-sm">
                <div>Installed at: {updateStatus.installedAt ? new Date(updateStatus.installedAt).toLocaleString() : "-"}</div>
                <div>Latest push: {updateStatus.latestPushedAt ? new Date(updateStatus.latestPushedAt).toLocaleString() : "-"}</div>
                <div>Latest commit: {updateStatus.latestCommitSha ? updateStatus.latestCommitSha.slice(0, 10) : "-"}</div>
                <div>Available: {updateStatus.updateAvailable ? "Yes" : "No"}</div>
                <div>Last checked: {updateStatus.lastCheckedAt ? new Date(updateStatus.lastCheckedAt).toLocaleString() : "-"}</div>
                <div>Last applied: {updateStatus.lastAppliedAt ? new Date(updateStatus.lastAppliedAt).toLocaleString() : "-"}</div>
                {updateStatus.pendingPostUpdateProbe ? (
                  <div className="text-amber-600 dark:text-amber-300">
                    Post-update health probe in progress. If Nova does not become healthy, the supervisor will roll back to{" "}
                    <code>{updateStatus.pendingPostUpdateProbe.previousCommitSha.slice(0, 10)}</code> automatically.
                  </div>
                ) : null}
                {updateStatus.lastRollback ? (
                  <div className="text-amber-600 dark:text-amber-300">
                    Last automatic rollback: {new Date(updateStatus.lastRollback.at).toLocaleString()} → reverted to{" "}
                    <code>{updateStatus.lastRollback.toCommitSha.slice(0, 10)}</code>. The latest update was reverted because the new code never became healthy.
                  </div>
                ) : null}
                {updateErrorMessage ? <div className="text-red-600">{updateErrorMessage}</div> : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === "skill:camera-vision" || tab === "skill:cameraVision" ? (
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Camera Vision Skill</h2>
              <span className={badgeClassForSkillBadgeState(cameraSkillStatus)}>{labelForSkillBadgeState(cameraSkillStatus)}</span>
            </div>
            <p className="text-xs text-muted">
              Add RTSP camera URLs (one per line). You can name a camera using <code>name|rtsp://...</code>. Example: <code>front-door|rtsp://user:password@192.168.31.10:554/h.264</code>
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isSkillRuntimeEnabled(settings.skillSettings, "camera-vision")}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    skillSettings: {
                      ...p.skillSettings,
                      ["camera-vision"]: { ...p.skillSettings["camera-vision"], enabled: e.target.checked },
                      ["cameraVision"]: { ...(p.skillSettings["cameraVision"] ?? {}), enabled: e.target.checked }
                    }
                  }))
                }
              />
              Enable camera vision skill
            </label>
            <textarea
              className="min-h-[120px] w-full rounded-ui border bg-surface px-2 py-1 text-sm"
                value={String(cameraVisionSettings.rtspUrls ?? cameraVisionSettings.rtsp_urls ?? "")}
              onChange={(e) =>
                setSettings((p) => ({
                  ...p,
                  skillSettings: {
                    ...p.skillSettings,
                      ["camera-vision"]: { ...p.skillSettings["camera-vision"], rtspUrls: e.target.value },
                      ["cameraVision"]: { ...(p.skillSettings["cameraVision"] ?? {}), rtspUrls: e.target.value }
                  }
                }))
              }
              placeholder={"rtsp://user:password@camera-1:554/stream\nrtsp://user:password@camera-2:554/h.264"}
            />
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              <div className="font-semibold">Detected camera entries</div>
              {String(cameraVisionSettings.rtspUrls ?? cameraVisionSettings.rtsp_urls ?? "")
                .split(/\r?\n/)
                .map((line) => line.trim())
                .filter(Boolean)
                .map((line, idx) => (
                  <div key={`${line}-${idx}`}>{line}</div>
                ))}
              {!String(cameraVisionSettings.rtspUrls ?? "").trim() ? <div>No cameras configured yet.</div> : null}
            </div>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              <div className="font-semibold">How this works right now</div>
              <div>- The UI stores camera URLs in settings; save settings to persist.</div>
              <div>- The runtime skill must be present in the loaded skill manifests to become truly active.</div>
              <div>- The current web UI does not provide a live video viewer here; snapshots/detections are triggered by skill usage and camera/lab routes.</div>
              {!cameraSkillManifest ? (
                <div className="mt-1 text-rose-300">Runtime camera skill module is not loaded. It will remain inactive until installed/loaded.</div>
              ) : null}
            </div>
          </Card>
        ) : null}

        {tab === "skill:website-builder" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Website Builder Skill</h2>
            <p className="text-xs text-muted">Configure SSH/Caddy defaults and manage created websites.</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isSkillRuntimeEnabled(settings.skillSettings, "website-builder")}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    skillSettings: {
                      ...p.skillSettings,
                      ["website-builder"]: { ...(p.skillSettings["website-builder"] ?? {}), enabled: e.target.checked }
                    }
                  }))
                }
              />
              Enable website builder skill
            </label>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              SSH must be passwordless (public key auth). Do not use passwords here. Optionally provide a private key path.
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <Input
                value={String(websiteBuilderSettings.sshHost ?? "")}
                onChange={(e) => setSettings((p) => ({ ...p, skillSettings: { ...p.skillSettings, ["website-builder"]: { ...p.skillSettings["website-builder"], sshHost: e.target.value } } }))}
                placeholder="Default SSH host"
              />
              <Input
                value={String(websiteBuilderSettings.sshUser ?? "")}
                onChange={(e) => setSettings((p) => ({ ...p, skillSettings: { ...p.skillSettings, ["website-builder"]: { ...p.skillSettings["website-builder"], sshUser: e.target.value } } }))}
                placeholder="Default SSH user"
              />
              <Input
                type="number"
                value={String(websiteBuilderSettings.sshPort ?? "22")}
                onChange={(e) => setSettings((p) => ({ ...p, skillSettings: { ...p.skillSettings, ["website-builder"]: { ...p.skillSettings["website-builder"], sshPort: Number(e.target.value || 22) } } }))}
                placeholder="Default SSH port"
              />
              <Input
                value={String(websiteBuilderSettings.sshPrivateKeyPath ?? "")}
                onChange={(e) => setSettings((p) => ({ ...p, skillSettings: { ...p.skillSettings, ["website-builder"]: { ...p.skillSettings["website-builder"], sshPrivateKeyPath: e.target.value } } }))}
                placeholder="SSH private key path (optional)"
              />
              <Input
                value={String(websiteBuilderSettings.remoteWwwRoot ?? "/var/www")}
                onChange={(e) => setSettings((p) => ({ ...p, skillSettings: { ...p.skillSettings, ["website-builder"]: { ...p.skillSettings["website-builder"], remoteWwwRoot: e.target.value } } }))}
                placeholder="Remote www root"
              />
              <Input
                value={String(websiteBuilderSettings.caddyFilePath ?? "/etc/caddy/Caddyfile")}
                onChange={(e) => setSettings((p) => ({ ...p, skillSettings: { ...p.skillSettings, ["website-builder"]: { ...p.skillSettings["website-builder"], caddyFilePath: e.target.value } } }))}
                placeholder="Caddy file path"
              />
            </div>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-xs">
                Website Builder provider
                <Select
                  value={websiteBuilderProviderEffective}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["website-builder"]: { ...p.skillSettings["website-builder"], provider: e.target.value }
                      }
                    }))
                  }
                >
                  <option value="ollama" disabled={settings.ollama.disabled === true}>
                    Ollama{settings.ollama.disabled === true ? " (disabled in Models)" : ""}
                  </option>
                  <option value="lmstudio" disabled={settings.lmstudio.disabled === true}>
                    LM Studio{settings.lmstudio.disabled === true ? " (disabled in Models)" : ""}
                  </option>
                  <option value="copilot" disabled={settings.copilot.disabled === true}>
                    Copilot{settings.copilot.disabled === true ? " (disabled in Models)" : ""}
                  </option>
                </Select>
              </label>
              <label className="grid gap-1 text-xs">
                Website Builder model (optional override)
                <Select
                  value={websiteBuilderModel}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["website-builder"]: { ...p.skillSettings["website-builder"], model: e.target.value }
                      }
                    }))
                  }
                >
                  <option value="">Auto (use provider default)</option>
                  {dedupeCatalogModelsById(selectedWebsiteBuilderModels).map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.id}
                    </option>
                  ))}
                </Select>
              </label>
            </div>
            <div className="flex items-center gap-2">
              <Button type="button" tone="blue" onClick={() => void testWebsiteBuilderSshConnection()}>
                Test SSH connection
              </Button>
              {sshTestResult ? (
                <span className={`text-xs ${sshTestResult.ok ? "text-emerald-600" : "text-rose-600"}`}>{sshTestResult.detail}</span>
              ) : null}
            </div>
            <div className="space-y-2">
              <h3 className="font-semibold">Built Websites</h3>
              {websites.length === 0 ? <p className="text-xs text-muted">No websites found yet.</p> : null}
              {websites.map((site) => (
                <div key={site.id} className="flex items-center justify-between rounded-ui border bg-surface p-2 text-xs">
                  <div>
                    <div className="font-semibold">{site.name}</div>
                    <div className="text-muted">{`${site.subdomain}.${site.domain} -> ${site.remote_www_root}/${site.remote_subfolder}`}</div>
                  </div>
                  <Button
                    type="button"
                    tone="red"
                    onClick={async () => {
                      await apiFetch("/api/websites", {
                        method: "DELETE",
                        headers: { "content-type": "application/json" },
                        body: JSON.stringify({ id: site.id })
                      });
                      await loadWebsites();
                    }}
                  >
                    Delete
                  </Button>
                </div>
              ))}
            </div>
          </Card>
        ) : null}

        {tab === "skill:perplexica-websearch" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Perplexica Web Search Skill</h2>
            <p className="text-xs text-muted">
              Configure local or remote Perplexica endpoint. Nova will use this skill for explicit web-search/current-events queries, alongside normal model chat.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isSkillRuntimeEnabled(settings.skillSettings, "perplexica-websearch")}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    skillSettings: {
                      ...p.skillSettings,
                      ["perplexica-websearch"]: { ...(p.skillSettings["perplexica-websearch"] ?? {}), enabled: e.target.checked }
                    }
                  }))
                }
              />
              Enable Perplexica web search skill
            </label>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-xs">
                Perplexica base URL
                <Input
                  value={String(perplexicaSettings.baseUrl ?? "http://127.0.0.1:3008")}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["perplexica-websearch"]: { ...p.skillSettings["perplexica-websearch"], baseUrl: e.target.value }
                      }
                    }))
                  }
                  placeholder="http://127.0.0.1:3008"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Request timeout (ms)
                <Input
                  type="number"
                  min={1000}
                  max={120000}
                  value={String(perplexicaSettings.timeoutMs ?? 30000)}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["perplexica-websearch"]: { ...p.skillSettings["perplexica-websearch"], timeoutMs: Number(e.target.value || 30000) }
                      }
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                Max sources
                <Input
                  type="number"
                  min={1}
                  max={20}
                  value={String(perplexicaSettings.maxSources ?? 6)}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["perplexica-websearch"]: { ...p.skillSettings["perplexica-websearch"], maxSources: Number(e.target.value || 6) }
                      }
                    }))
                  }
                />
              </label>
              <label className="grid gap-1 text-xs">
                Focus mode
                <Input
                  value={String(perplexicaSettings.focusMode ?? "webSearch")}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["perplexica-websearch"]: { ...p.skillSettings["perplexica-websearch"], focusMode: e.target.value }
                      }
                    }))
                  }
                  placeholder="webSearch"
                />
              </label>
              <label className="grid gap-1 text-xs">
                Optimization mode
                <Input
                  value={String(perplexicaSettings.optimizationMode ?? "speed")}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["perplexica-websearch"]: { ...p.skillSettings["perplexica-websearch"], optimizationMode: e.target.value }
                      }
                    }))
                  }
                  placeholder="speed"
                />
              </label>
              <label className="flex items-center gap-2 text-xs md:pt-6">
                <Checkbox
                  checked={Boolean(perplexicaSettings.stream ?? false)}
                  onChange={(e) =>
                    setSettings((p) => ({
                      ...p,
                      skillSettings: {
                        ...p.skillSettings,
                        ["perplexica-websearch"]: { ...p.skillSettings["perplexica-websearch"], stream: e.target.checked }
                      }
                    }))
                  }
                />
                Stream responses when endpoint supports it
              </label>
            </div>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              Your current setup example: <code className="font-mono">http://127.0.0.1:3008</code>. You can point to LAN/remote hosts too.
            </div>
          </Card>
        ) : null}

        {tab === "skill:network-defense" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Network Defense Skill</h2>
            <p className="text-xs text-muted">
              Monitor connections, flag anomalies, and (with explicit confirmation) apply firewall-style mitigations. Use the{" "}
              <strong>Security</strong> area in the app for analyze / harden flows once the skill is enabled.
            </p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isSkillRuntimeEnabled(settings.skillSettings, "network-defense")}
                onChange={(e) =>
                  setSettings((p) => ({
                    ...p,
                    skillSettings: {
                      ...p.skillSettings,
                      ["network-defense"]: { ...(p.skillSettings["network-defense"] ?? {}), enabled: e.target.checked }
                    }
                  }))
                }
              />
              Enable network defense skill
            </label>
          </Card>
        ) : null}

        {tab.startsWith("skill:") &&
        tab !== "skill:website-builder" &&
        tab !== "skill:perplexica-websearch" &&
        tab !== "skill:camera-vision" &&
        tab !== "skill:cameraVision" &&
        tab !== "skill:network-defense" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">
              {((): string => {
                const sid = tab.replace(/^skill:/, "");
                const m = skillManifests.find((item) => (item.settingsTab?.id ?? item.id) === sid);
                return m?.name ?? sid;
              })()}
            </h2>
            <p className="text-sm text-muted">This tab is contributed by a skill. Custom UI can be added here by that skill.</p>
            <label className="flex items-center gap-2 text-sm">
              <Checkbox
                checked={isSkillRuntimeEnabled(settings.skillSettings, tab.replace(/^skill:/, ""))}
                onChange={(e) => {
                  const sid = tab.replace(/^skill:/, "");
                  setSettings((p) => ({
                    ...p,
                    skillSettings: {
                      ...p.skillSettings,
                      [sid]: { ...(p.skillSettings[sid] ?? {}), enabled: e.target.checked }
                    }
                  }));
                }}
              />
              Enable this skill
            </label>
            <p className="text-xs text-muted">Click <strong>Save Settings</strong> above to persist changes on this page.</p>
          </Card>
        ) : null}
          </div>
        </div>

      </div>

      <aside className="space-y-3 lg:self-start">
        <Card className="lg:sticky lg:top-24 lg:flex lg:max-h-[calc(100vh-6rem-10px)] lg:flex-col">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Health checks</h2>
            <Button type="button" tone="blue" onClick={() => void loadHealth()}>Refresh</Button>
          </div>
          <div className="mb-2">
            <HealthPill
              level={health?.level ?? "orange"}
              label={health?.level === "green" ? "Operational" : health?.level === "orange" ? "Not all configured" : undefined}
              className="w-[150px] min-w-[150px] max-w-[150px] shrink-0 justify-center whitespace-nowrap overflow-hidden text-ellipsis"
            />
          </div>
          <div className="space-y-2 overflow-y-auto lg:min-h-0 lg:flex-1">
            {(health?.checks ?? []).map((check) => (
              <article key={check.id} className="rounded-ui border bg-surface p-2 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <strong>{check.name}</strong>
                  <HealthPill
                    level={check.level}
                    label={healthLabelForCheck(check)}
                    className="w-[150px] min-w-[150px] max-w-[150px] shrink-0 justify-center whitespace-nowrap overflow-hidden text-ellipsis"
                  />
                </div>
                <div className="text-muted">{check.detail}</div>
                <div className="text-muted">Last OK: {check.lastSuccessfulAt ? new Date(check.lastSuccessfulAt).toLocaleString() : "-"}</div>
              </article>
            ))}
          </div>
        </Card>
      </aside>

      {signalCaptchaModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="signal-captcha-modal-title"
          onClick={() => setSignalCaptchaModalOpen(false)}
        >
          <div className="w-full max-w-lg md:max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <Card className="flex max-h-[90vh] w-full flex-col gap-3 overflow-hidden p-4 shadow-xl">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="signal-captcha-modal-title" className="text-base font-semibold">
                  Signal registration captcha
                </h3>
                <Button type="button" tone="neutral" onClick={() => setSignalCaptchaModalOpen(false)}>
                  Close
                </Button>
              </div>
              {signalCaptchaModalDetail ? (
                <p className="rounded-ui border border-amber-500/35 bg-amber-500/10 px-2 py-1.5 text-[11px] text-amber-950 dark:text-amber-100">{signalCaptchaModalDetail}</p>
              ) : null}
              <p className="text-[11px] leading-snug text-muted">
                Complete the check on the official page (embedded below if your browser allows it). When Signal shows a blocked navigation to{" "}
                <code className="text-[10px]">signalcaptcha://…</code>, copy that line from the browser, then use <strong className="text-foreground">Read from clipboard</strong> — Nova strips the token and retries registration for you.
              </p>
              <div className="overflow-hidden rounded-ui border border-border bg-white dark:bg-slate-950">
                <iframe
                  title="Signal registration captcha"
                  className="h-[min(360px,45vh)] w-full"
                  src={SIGNAL_CAPTCHA_GENERATE_URL}
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <a
                  className="inline-flex items-center justify-center rounded-ui border border-blue-500/70 bg-pastelBlue px-2.5 py-1.5 text-xs font-medium text-slate-900 shadow-sm transition hover:brightness-95"
                  href={SIGNAL_CAPTCHA_GENERATE_URL}
                  target="_blank"
                  rel="noreferrer"
                >
                  Open captcha in new tab
                </a>
                <Button type="button" tone="neutral" disabled={signalCaptchaBusy} onClick={() => void signalCaptchaReadClipboard()}>
                  {signalCaptchaBusy ? "…" : "Read captcha from clipboard"}
                </Button>
                <Button type="button" tone="purple" disabled={signalCaptchaBusy} onClick={() => void signalCaptchaApplyDraftAndRetry()}>
                  {signalCaptchaBusy ? "…" : "Use pasted text & retry SMS step"}
                </Button>
              </div>
              <label className="grid gap-1 text-xs">
                Or paste the blocked link / token here (then click the purple button above)
                <Textarea
                  value={signalCaptchaPasteDraft}
                  onChange={(e) => {
                    const v = e.target.value;
                    setSignalCaptchaPasteDraft(v);
                    const tok = extractSignalCaptchaToken(v);
                    if (tok) setSignalRegistrationCaptcha(tok);
                  }}
                  rows={3}
                  className="font-mono text-[11px]"
                  placeholder="signalcaptcha://signal-hcaptcha-… or paste from DevTools console"
                  spellCheck={false}
                />
              </label>
            </Card>
          </div>
        </div>
      ) : null}

      {sentiCoreModalOpen ? (
        <div
          className="fixed inset-0 z-[100] flex items-center justify-center bg-black/55 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="senti-core-editor-title"
          onClick={() => setSentiCoreModalOpen(false)}
        >
          <div className="w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <Card className="flex max-h-[90vh] w-full flex-col gap-3 overflow-hidden p-4 shadow-xl">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h3 id="senti-core-editor-title" className="text-base font-semibold">
                Edit orchestration markdown (SOUL-style)
              </h3>
              <div className="flex flex-wrap gap-2">
                <Button type="button" tone="neutral" onClick={() => setSentiCoreModalOpen(false)}>
                  Close
                </Button>
                <Button type="button" tone="green" disabled={sentiCoreSaving || sentiCoreLoading} onClick={() => void saveSentiCoreEditor()}>
                  {sentiCoreSaving ? "Saving…" : "Save file"}
                </Button>
              </div>
            </div>
            {sentiCoreResolvedPath ? (
              <p className="break-all font-mono text-[11px] text-muted">{sentiCoreResolvedPath}</p>
            ) : null}
            {sentiCoreMissingFile ? (
              <p className="rounded-ui border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-xs text-amber-100">
                File did not exist yet — saving will create it (directories are created if needed).
              </p>
            ) : null}
            {sentiCoreModalError ? <p className="text-xs text-rose-400">{sentiCoreModalError}</p> : null}
            {sentiCoreLoading ? (
              <p className="text-sm text-muted">Loading…</p>
            ) : (
              <Textarea
                className="min-h-[min(420px,50vh)] w-full shrink font-mono text-xs leading-relaxed"
                value={sentiCoreDraft}
                onChange={(e) => setSentiCoreDraft(e.target.value)}
                spellCheck={false}
              />
            )}
            </Card>
          </div>
        </div>
      ) : null}
    </form>
  );
}

type ConversationItem =
  | {
      kind: "user";
      id: string;
      at: string;
      peer: string;
      channel: "signal" | "whatsapp";
      text: string;
      reachedNova: boolean | null;
      correlationId: string;
    }
  | {
      kind: "nova";
      id: string;
      at: string;
      peer: string;
      channel: "signal" | "whatsapp";
      text: string;
      hasAudio: boolean;
      audioBytes: number | null;
      audioFailed: boolean;
      audioFailReason: string | null;
      correlationId: string;
    }
  | {
      kind: "typing";
      id: string;
      at: string;
      peer: string;
      channel: "signal" | "whatsapp";
      correlationId: string;
    }
  | {
      kind: "system";
      id: string;
      at: string;
      peer: string;
      channel: "signal" | "whatsapp";
      text: string;
      tone: "info" | "warn" | "error";
      correlationId: string;
    };

const ORPHEUS_CUE_RE = /<\s*(?:laugh|sigh|chuckle|cough|sniffle|groan|gasp)\b[^>]*>/gi;

function stripCuesForDisplay(text: string): string {
  if (!text) return text;
  return text.replace(ORPHEUS_CUE_RE, "").replace(/\s+([,.!?;:])/g, "$1").replace(/\s{2,}/g, " ").trim();
}

function extractAudioBytesFromPreview(preview: string): number | null {
  const match = /\((\d+)\s*bytes\)/i.exec(preview);
  if (!match) return null;
  const n = Number(match[1]);
  return Number.isFinite(n) ? n : null;
}

/**
 * Collapses transport-level rows into a chat-like timeline. Returns newest-first to match the
 * existing trace order. Heuristics:
 *  - skip pure noise (`deduped_other_transport`, `parsed_zero_*`, `receive_ws_connected`)
 *  - one "Nova is typing…" per correlation id (so heartbeat re-issues do not clutter the view)
 *  - merge `signal_voice_attachment_sent` + `outbound_send_ok` for the same correlation id into a
 *    single Nova row that shows both the text and the audio size
 *  - keep `outbound_send_failed` / `outbound_send_deduped_recent` / `signal_voice_attachment_failed`
 *    as small system notes so the user still sees what went wrong
 *  - skip `reply_enqueued` (it duplicates the dispatcher row)
 *  - skip `typing_indicator_off` (a Nova row implicitly ends the typing state)
 */
function buildChannelConversation(entries: ChannelDebugEntry[]): ConversationItem[] {
  const oldestFirst = [...entries].reverse();
  const items: ConversationItem[] = [];
  const seenTypingForCorr = new Set<string>();

  for (const entry of oldestFirst) {
    const trace = entry.trace ?? [];
    const has = (token: string) => trace.includes(token);
    const peer = entry.peer ?? "";
    const corr = entry.correlationId;

    // Pure-noise rows.
    if (
      has("deduped_other_transport") ||
      has("parsed_zero_text_dm_or_receipt") ||
      has("parsed_zero_messages") ||
      has("parsed_zero_messages_throttled") ||
      has("receive_ws_connected")
    ) {
      continue;
    }

    // Internal duplicate of the dispatcher row.
    if (has("reply_enqueued")) continue;
    // Implied by Nova's response.
    if (has("typing_indicator_off")) continue;

    if (entry.direction === "in") {
      if (has("parsed_inbound") && entry.textPreview && !entry.textPreview.startsWith("(")) {
        items.push({
          kind: "user",
          id: entry.id,
          at: entry.at,
          peer,
          channel: entry.channel,
          text: entry.textPreview,
          reachedNova: typeof entry.reachedNova === "boolean" ? entry.reachedNova : null,
          correlationId: corr
        });
        continue;
      }
      if (trace.some((t) => t.startsWith("access_denied"))) {
        items.push({
          kind: "system",
          id: entry.id,
          at: entry.at,
          peer,
          channel: entry.channel,
          text: entry.error || "Blocked by channel access policy",
          tone: "warn",
          correlationId: corr
        });
        continue;
      }
      if (has("orchestrator_error")) {
        items.push({
          kind: "system",
          id: entry.id,
          at: entry.at,
          peer,
          channel: entry.channel,
          text: entry.error || "Orchestrator error",
          tone: "error",
          correlationId: corr
        });
        continue;
      }
      continue;
    }

    // Outbound rows below.
    if (entry.transport !== "dispatcher") continue;

    if (has("typing_indicator_on")) {
      if (!seenTypingForCorr.has(corr)) {
        seenTypingForCorr.add(corr);
        items.push({
          kind: "typing",
          id: entry.id,
          at: entry.at,
          peer,
          channel: entry.channel,
          correlationId: corr
        });
      }
      continue;
    }

    if (has("signal_voice_attachment_sent")) {
      // Audio first; the matching `outbound_send_ok` row that follows will fill in the text.
      items.push({
        kind: "nova",
        id: entry.id,
        at: entry.at,
        peer,
        channel: entry.channel,
        text: "",
        hasAudio: true,
        audioBytes: extractAudioBytesFromPreview(entry.textPreview),
        audioFailed: false,
        audioFailReason: null,
        correlationId: corr
      });
      continue;
    }

    if (has("signal_voice_attachment_failed")) {
      // Don't add a separate row — annotate the next Nova row for the same correlation id.
      // We push a placeholder if there is none yet.
      const reason = entry.error || "Voice synthesis failed (text-only fallback)";
      items.push({
        kind: "nova",
        id: entry.id,
        at: entry.at,
        peer,
        channel: entry.channel,
        text: "",
        hasAudio: false,
        audioBytes: null,
        audioFailed: true,
        audioFailReason: reason,
        correlationId: corr
      });
      continue;
    }

    if (has("outbound_send_ok")) {
      const text = stripCuesForDisplay(entry.textPreview);
      const lastIdx = items.length - 1;
      const last = lastIdx >= 0 ? items[lastIdx] : null;
      if (
        last &&
        last.kind === "nova" &&
        last.correlationId === corr &&
        last.peer === peer &&
        last.text === ""
      ) {
        items[lastIdx] = { ...last, text, at: entry.at };
        continue;
      }
      items.push({
        kind: "nova",
        id: entry.id,
        at: entry.at,
        peer,
        channel: entry.channel,
        text,
        hasAudio: false,
        audioBytes: null,
        audioFailed: false,
        audioFailReason: null,
        correlationId: corr
      });
      continue;
    }

    if (has("outbound_send_deduped_recent")) {
      items.push({
        kind: "system",
        id: entry.id,
        at: entry.at,
        peer,
        channel: entry.channel,
        text: entry.error || "Duplicate suppressed (anti-spam guard)",
        tone: "warn",
        correlationId: corr
      });
      continue;
    }

    if (has("outbound_send_failed")) {
      items.push({
        kind: "system",
        id: entry.id,
        at: entry.at,
        peer,
        channel: entry.channel,
        text: entry.error || "Outbound send failed",
        tone: "error",
        correlationId: corr
      });
      continue;
    }
  }

  return items.reverse();
}

function ConversationRow({ item }: { item: ConversationItem }) {
  const time = formatChannelDebugTime(item.at);
  if (item.kind === "user") {
    const novaStatus =
      item.reachedNova === null
        ? null
        : item.reachedNova
          ? { label: "Nova handled", tone: "text-emerald-700 dark:text-emerald-400" }
          : { label: "Nova did not handle", tone: "text-amber-700 dark:text-amber-400" };
    return (
      <div className="rounded-md border border-blue-500/40 bg-blue-500/[0.08] px-2 py-1.5 text-[12px] leading-snug dark:bg-blue-500/15">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[11px] text-muted">{time}</span>
            <strong>You</strong>
            <span className="text-[11px] text-muted capitalize">· {item.channel}</span>
          </div>
          {novaStatus ? (
            <span className={`shrink-0 rounded-full bg-black/5 px-2 py-0.5 text-[11px] font-medium dark:bg-white/10 ${novaStatus.tone}`}>
              {novaStatus.label}
            </span>
          ) : null}
        </div>
        <div className="break-words">{item.text}</div>
      </div>
    );
  }
  if (item.kind === "nova") {
    return (
      <div className="rounded-md border border-indigo-600/40 bg-indigo-600/[0.09] px-2 py-1.5 text-[12px] leading-snug dark:bg-indigo-950/35">
        <div className="flex items-start justify-between gap-2">
          <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
            <span className="font-mono text-[11px] text-muted">{time}</span>
            <strong>Nova</strong>
            <span className="text-[11px] text-muted capitalize">· {item.channel}</span>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {item.hasAudio ? (
              <span
                className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"
                title={item.audioBytes ? `${item.audioBytes.toLocaleString()} bytes` : undefined}
              >
                voice attached{item.audioBytes ? ` · ${Math.round(item.audioBytes / 1024)} KB` : ""}
              </span>
            ) : null}
            {item.audioFailed ? (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[11px] font-medium text-amber-800 dark:text-amber-300">
                voice failed (text only)
              </span>
            ) : null}
          </div>
        </div>
        {item.text ? <div className="break-words">{item.text}</div> : null}
        {item.audioFailed && item.audioFailReason ? (
          <div className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">{item.audioFailReason}</div>
        ) : null}
      </div>
    );
  }
  if (item.kind === "typing") {
    return (
      <div className="rounded-md border border-dashed border-indigo-600/40 bg-indigo-600/[0.04] px-2 py-1.5 text-[12px] leading-snug text-muted dark:bg-indigo-950/15">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-[11px]">{time}</span>
          <span>
            <strong>Nova</strong> is typing… <span className="italic">(generating reply{item.channel === "signal" ? " + audio" : ""})</span>
          </span>
        </div>
      </div>
    );
  }
  // system
  const tone =
    item.tone === "error"
      ? "border-red-500/50 bg-red-500/[0.08] text-red-700 dark:text-red-300"
      : item.tone === "warn"
        ? "border-amber-500/50 bg-amber-500/[0.08] text-amber-800 dark:text-amber-300"
        : "border-border/60 bg-surface2 text-muted";
  return (
    <div className={`rounded-md border px-2 py-1.5 text-[12px] leading-snug ${tone}`}>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[11px]">{time}</span>
        <span className="capitalize">{item.channel}</span>
        <span className="text-[11px] text-muted">system</span>
      </div>
      <div className="break-words">{item.text}</div>
    </div>
  );
}

function channelDebugRowAccent(entry: ChannelDebugEntry): string {
  if (entry.transport === "next_proxy") {
    return "border-l-[4px] border-violet-500 bg-violet-500/[0.08] dark:bg-violet-500/15";
  }
  if (entry.transport === "receive_ws") {
    return "border-l-[4px] border-cyan-600 bg-cyan-600/[0.08] dark:bg-cyan-950/30";
  }
  if (entry.channel === "signal") {
    return entry.direction === "in"
      ? "border-l-[4px] border-blue-500 bg-blue-500/[0.08] dark:bg-blue-500/15"
      : "border-l-[4px] border-indigo-600 bg-indigo-600/[0.09] dark:bg-indigo-950/35";
  }
  return entry.direction === "in"
    ? "border-l-[4px] border-emerald-500 bg-emerald-500/[0.08] dark:bg-emerald-500/15"
    : "border-l-[4px] border-teal-600 bg-teal-600/[0.09] dark:bg-teal-950/35";
}

function formatChannelDebugTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  return new Date(t).toLocaleString();
}

function BridgeGuide({ title, item }: { title: string; item?: { configured: boolean; details: string; steps: string[] } }) {
  return (
    <div className="rounded-ui border bg-surface p-3">
      <div className="mb-1 flex items-center justify-between">
        <strong>{title}</strong>
        <HealthPill level={item?.configured ? "green" : "orange"} label={item?.configured ? "Connected" : "Not Connected"} />
      </div>
      <div className="mb-1 text-xs text-muted">{item?.details ?? "No status data"}</div>
      <ol className="list-inside list-decimal text-xs text-muted">
        {(item?.steps ?? []).map((step) => <li key={step}>{step}</li>)}
      </ol>
    </div>
  );
}

function healthLabelForCheck(check: HealthCheck): string {
  if (check.level === "red") return "Failed / Not Configured";
  if (check.level === "orange") return "Not Connected";
  const lowered = `${check.name} ${check.detail}`.toLowerCase();
  if (/(token|key|secret|auth|credential)/.test(lowered)) return "Configured";
  if (/(bridge|signal|whatsapp|webhook|socket|http|api|connect)/.test(lowered)) return "Connected";
  return "Healthy";
}

function normalizeUpdateError(value?: string): string | undefined {
  if (!value) return undefined;
  const cleaned = value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(
      (line) =>
        line.length > 0 &&
        !line.startsWith("From https://github.com/") &&
        !line.includes("main -> origin/main") &&
        !/^[0-9a-f]{7,}\.\.[0-9a-f]{7,}\s+main\s+->\s+origin\/main$/i.test(line) &&
        !line.includes("[DEP0169]") &&
        !line.includes("Use `node --trace-deprecation") &&
        !line.includes("url.parse() behavior is not standardized")
    );
  if (cleaned.length === 0) return undefined;
  return cleaned.join(" ");
}

function ColorPickerRow(input: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="grid gap-1 text-xs">
      {input.label}
      <div className="flex items-center gap-2">
        <span className="inline-block h-8 w-8 rounded-ui border" style={{ backgroundColor: input.value }} />
        <Input
          value={input.value}
          onChange={(e) => input.onChange(e.target.value)}
          placeholder="#000000"
          className="h-8"
        />
        <input
          type="color"
          value={input.value}
          onChange={(e) => input.onChange(e.target.value)}
          className="h-8 w-10 cursor-pointer rounded-ui border bg-surface p-0.5"
        />
      </div>
    </label>
  );
}

function normalizeSettings(value: Partial<SettingsState> | undefined): SettingsState {
  const ollamaDisabled = value?.ollama?.disabled !== false;
  const lmstudioDisabled = value?.lmstudio?.disabled !== false;
  const draft: SettingsState = {
    delegatedFolders: value?.delegatedFolders ?? DEFAULT_SETTINGS.delegatedFolders,
    requireApprovals: value?.requireApprovals ?? DEFAULT_SETTINGS.requireApprovals,
    activeProvider: value?.activeProvider ?? DEFAULT_SETTINGS.activeProvider,
    ollama: {
      disabled: ollamaDisabled,
      numPredict:
        typeof value?.ollama?.numPredict === "number" && Number.isFinite(value.ollama.numPredict)
          ? Math.trunc(value.ollama.numPredict)
          : DEFAULT_SETTINGS.ollama.numPredict,
      keepAlive:
        typeof value?.ollama?.keepAlive === "string" && value.ollama.keepAlive.trim().length > 0
          ? value.ollama.keepAlive.trim().slice(0, 32)
          : DEFAULT_SETTINGS.ollama.keepAlive
    },
    lmstudio: { disabled: lmstudioDisabled },
    web: {
      loginEnabled: value?.web?.loginEnabled ?? DEFAULT_SETTINGS.web.loginEnabled,
      hideProviderModelInStats: value?.web?.hideProviderModelInStats ?? DEFAULT_SETTINGS.web.hideProviderModelInStats,
      sendOnEnter: value?.web?.sendOnEnter ?? DEFAULT_SETTINGS.web.sendOnEnter,
      voiceDictationAutoSend: value?.web?.voiceDictationAutoSend ?? DEFAULT_SETTINGS.web.voiceDictationAutoSend,
      voiceDictationSilenceSec: (() => {
        const n = Number(value?.web?.voiceDictationSilenceSec);
        if (!Number.isFinite(n)) return DEFAULT_SETTINGS.web.voiceDictationSilenceSec;
        return Math.min(4, Math.max(1, Math.round(n)));
      })(),
      voiceContinuousConversation:
        value?.web?.voiceContinuousConversation ?? DEFAULT_SETTINGS.web.voiceContinuousConversation,
      readAloudMessages: value?.web?.readAloudMessages === true,
      showThinkingInChat: value?.web?.showThinkingInChat !== false,
      textScale:
        value?.web?.textScale === "medium" || value?.web?.textScale === "big" || value?.web?.textScale === "normal"
          ? value.web.textScale
          : DEFAULT_SETTINGS.web.textScale,
      chatStyle: {
        userBubbleColor: value?.web?.chatStyle?.userBubbleColor ?? DEFAULT_SETTINGS.web.chatStyle.userBubbleColor,
        assistantBubbleColor: value?.web?.chatStyle?.assistantBubbleColor ?? DEFAULT_SETTINGS.web.chatStyle.assistantBubbleColor,
        userTextColor: value?.web?.chatStyle?.userTextColor ?? DEFAULT_SETTINGS.web.chatStyle.userTextColor,
        assistantTextColor: value?.web?.chatStyle?.assistantTextColor ?? DEFAULT_SETTINGS.web.chatStyle.assistantTextColor,
        userActionIconColor: value?.web?.chatStyle?.userActionIconColor ?? DEFAULT_SETTINGS.web.chatStyle.userActionIconColor,
        assistantActionIconColor:
          value?.web?.chatStyle?.assistantActionIconColor ?? DEFAULT_SETTINGS.web.chatStyle.assistantActionIconColor,
        statsTextColor: value?.web?.chatStyle?.statsTextColor ?? DEFAULT_SETTINGS.web.chatStyle.statsTextColor,
        userBubbleColorLight:
          value?.web?.chatStyle?.userBubbleColorLight ?? DEFAULT_SETTINGS.web.chatStyle.userBubbleColorLight,
        assistantBubbleColorLight:
          value?.web?.chatStyle?.assistantBubbleColorLight ?? DEFAULT_SETTINGS.web.chatStyle.assistantBubbleColorLight,
        userTextColorLight:
          value?.web?.chatStyle?.userTextColorLight ?? DEFAULT_SETTINGS.web.chatStyle.userTextColorLight,
        assistantTextColorLight:
          value?.web?.chatStyle?.assistantTextColorLight ?? DEFAULT_SETTINGS.web.chatStyle.assistantTextColorLight,
        userActionIconColorLight:
          value?.web?.chatStyle?.userActionIconColorLight ?? DEFAULT_SETTINGS.web.chatStyle.userActionIconColorLight,
        assistantActionIconColorLight:
          value?.web?.chatStyle?.assistantActionIconColorLight ??
          DEFAULT_SETTINGS.web.chatStyle.assistantActionIconColorLight,
        statsTextColorLight:
          value?.web?.chatStyle?.statsTextColorLight ?? DEFAULT_SETTINGS.web.chatStyle.statsTextColorLight,
        bubbleBackgroundEnabled:
          value?.web?.chatStyle?.bubbleBackgroundEnabled ?? DEFAULT_SETTINGS.web.chatStyle.bubbleBackgroundEnabled,
        borderColor: value?.web?.chatStyle?.borderColor ?? DEFAULT_SETTINGS.web.chatStyle.borderColor,
        borderThicknessPx: value?.web?.chatStyle?.borderThicknessPx ?? DEFAULT_SETTINGS.web.chatStyle.borderThicknessPx,
        userBorderThicknessPx:
          value?.web?.chatStyle?.userBorderThicknessPx ??
          value?.web?.chatStyle?.borderThicknessPx ??
          DEFAULT_SETTINGS.web.chatStyle.userBorderThicknessPx,
        assistantBorderThicknessPx:
          value?.web?.chatStyle?.assistantBorderThicknessPx ??
          value?.web?.chatStyle?.borderThicknessPx ??
          DEFAULT_SETTINGS.web.chatStyle.assistantBorderThicknessPx,
        userBackgroundOpacityPct:
          value?.web?.chatStyle?.userBackgroundOpacityPct ??
          ((value?.web?.chatStyle?.bubbleBackgroundEnabled ?? DEFAULT_SETTINGS.web.chatStyle.bubbleBackgroundEnabled) ? 100 : 0),
        assistantBackgroundOpacityPct:
          value?.web?.chatStyle?.assistantBackgroundOpacityPct ??
          ((value?.web?.chatStyle?.bubbleBackgroundEnabled ?? DEFAULT_SETTINGS.web.chatStyle.bubbleBackgroundEnabled) ? 100 : 0),
        bubbleRadiusPx: value?.web?.chatStyle?.bubbleRadiusPx ?? DEFAULT_SETTINGS.web.chatStyle.bubbleRadiusPx,
        showNames: value?.web?.chatStyle?.showNames ?? DEFAULT_SETTINGS.web.chatStyle.showNames
      }
    },
    learning: {
      enabled: value?.learning?.enabled ?? DEFAULT_SETTINGS.learning.enabled,
      idleMinutes: value?.learning?.idleMinutes ?? DEFAULT_SETTINGS.learning.idleMinutes,
      intervalMs: value?.learning?.intervalMs ?? DEFAULT_SETTINGS.learning.intervalMs,
      minFailuresForAutoImprove: value?.learning?.minFailuresForAutoImprove ?? DEFAULT_SETTINGS.learning.minFailuresForAutoImprove
    },
    costGovernor: {
      enabled: value?.costGovernor?.enabled ?? DEFAULT_SETTINGS.costGovernor.enabled,
      dailyBudgetUsd: value?.costGovernor?.dailyBudgetUsd ?? DEFAULT_SETTINGS.costGovernor.dailyBudgetUsd,
      qualityTier: value?.costGovernor?.qualityTier ?? DEFAULT_SETTINGS.costGovernor.qualityTier,
      providerPricing: {
        ollamaPer1k: value?.costGovernor?.providerPricing?.ollamaPer1k ?? DEFAULT_SETTINGS.costGovernor.providerPricing.ollamaPer1k,
        lmstudioPer1k: value?.costGovernor?.providerPricing?.lmstudioPer1k ?? DEFAULT_SETTINGS.costGovernor.providerPricing.lmstudioPer1k,
        copilotPer1k: value?.costGovernor?.providerPricing?.copilotPer1k ?? DEFAULT_SETTINGS.costGovernor.providerPricing.copilotPer1k
      }
    },
    emotions: {
      enabled: value?.emotions?.enabled ?? DEFAULT_SETTINGS.emotions.enabled,
      expressionStyle: value?.emotions?.expressionStyle ?? DEFAULT_SETTINGS.emotions.expressionStyle,
      mirrorUserValence: value?.emotions?.mirrorUserValence ?? DEFAULT_SETTINGS.emotions.mirrorUserValence
    },
    memoryBear: {
      enabled: value?.memoryBear?.enabled ?? DEFAULT_SETTINGS.memoryBear.enabled,
      baseUrl: value?.memoryBear?.baseUrl ?? DEFAULT_SETTINGS.memoryBear.baseUrl,
      apiKey: value?.memoryBear?.apiKey ?? DEFAULT_SETTINGS.memoryBear.apiKey,
      searchSwitch:
        value?.memoryBear?.searchSwitch === "0" || value?.memoryBear?.searchSwitch === "1"
          ? value.memoryBear.searchSwitch
          : DEFAULT_SETTINGS.memoryBear.searchSwitch,
      storageType: value?.memoryBear?.storageType === "rag" ? "rag" : DEFAULT_SETTINGS.memoryBear.storageType,
      syncWrites: value?.memoryBear?.syncWrites ?? DEFAULT_SETTINGS.memoryBear.syncWrites
    },
    sentiCore: {
      enabled: value?.sentiCore?.enabled ?? DEFAULT_SETTINGS.sentiCore.enabled,
      orchestrationMarkdownPath:
        value?.sentiCore?.orchestrationMarkdownPath ?? DEFAULT_SETTINGS.sentiCore.orchestrationMarkdownPath
    },
    orpheusTts: {
      enabled: value?.orpheusTts?.enabled ?? DEFAULT_SETTINGS.orpheusTts.enabled,
      baseUrl: value?.orpheusTts?.baseUrl ?? DEFAULT_SETTINGS.orpheusTts.baseUrl,
      apiKey: value?.orpheusTts?.apiKey ?? DEFAULT_SETTINGS.orpheusTts.apiKey,
      voice: value?.orpheusTts?.voice ?? DEFAULT_SETTINGS.orpheusTts.voice,
      model: value?.orpheusTts?.model ?? DEFAULT_SETTINGS.orpheusTts.model,
      responseFormat:
        value?.orpheusTts?.responseFormat === "mp3" ||
        value?.orpheusTts?.responseFormat === "wav" ||
        value?.orpheusTts?.responseFormat === "opus" ||
        value?.orpheusTts?.responseFormat === "pcm" ||
        value?.orpheusTts?.responseFormat === "flac"
          ? value.orpheusTts.responseFormat
          : DEFAULT_SETTINGS.orpheusTts.responseFormat
    },
    messagingAccess: {
      novaPhoneNumber: value?.messagingAccess?.novaPhoneNumber ?? DEFAULT_SETTINGS.messagingAccess.novaPhoneNumber,
      denyUnknownNumbers: value?.messagingAccess?.denyUnknownNumbers ?? DEFAULT_SETTINGS.messagingAccess.denyUnknownNumbers,
      channelTiers: {
        signal: Array.isArray(value?.messagingAccess?.channelTiers?.signal)
          ? value.messagingAccess.channelTiers.signal
              .map((row) => ({
                phone: String(row?.phone ?? "").trim(),
                tier:
                  row?.tier === "admin" || row?.tier === "co_admin" || row?.tier === "restricted" || row?.tier === "guest"
                    ? row.tier
                    : ("guest" as const)
              }))
              .filter((row) => row.phone.length > 0)
          : DEFAULT_SETTINGS.messagingAccess.channelTiers.signal,
        whatsapp: Array.isArray(value?.messagingAccess?.channelTiers?.whatsapp)
          ? value.messagingAccess.channelTiers.whatsapp
              .map((row) => ({
                phone: String(row?.phone ?? "").trim(),
                tier:
                  row?.tier === "admin" || row?.tier === "co_admin" || row?.tier === "restricted" || row?.tier === "guest"
                    ? row.tier
                    : ("guest" as const)
              }))
              .filter((row) => row.phone.length > 0)
          : DEFAULT_SETTINGS.messagingAccess.channelTiers.whatsapp
      },
      systemAdmins: value?.messagingAccess?.systemAdmins ?? DEFAULT_SETTINGS.messagingAccess.systemAdmins,
      guests: value?.messagingAccess?.guests ?? DEFAULT_SETTINGS.messagingAccess.guests,
      importantPeople: value?.messagingAccess?.importantPeople ?? DEFAULT_SETTINGS.messagingAccess.importantPeople
    },
    shell: {
      timeoutMs: value?.shell?.timeoutMs ?? DEFAULT_SETTINGS.shell.timeoutMs,
      maxOutputBytes: value?.shell?.maxOutputBytes ?? DEFAULT_SETTINGS.shell.maxOutputBytes
    },
    skills: {
      isolationEnabled: value?.skills?.isolationEnabled ?? DEFAULT_SETTINGS.skills.isolationEnabled,
      timeoutMs: value?.skills?.timeoutMs ?? DEFAULT_SETTINGS.skills.timeoutMs,
      maxMemoryMb: value?.skills?.maxMemoryMb ?? DEFAULT_SETTINGS.skills.maxMemoryMb,
      skillAuthoringDisabled: value?.skills?.skillAuthoringDisabled ?? DEFAULT_SETTINGS.skills.skillAuthoringDisabled
    },
    identityBackup: {
      enabled: value?.identityBackup?.enabled ?? DEFAULT_SETTINGS.identityBackup.enabled,
      intervalDays: value?.identityBackup?.intervalDays ?? DEFAULT_SETTINGS.identityBackup.intervalDays,
      labelPrefix: value?.identityBackup?.labelPrefix ?? DEFAULT_SETTINGS.identityBackup.labelPrefix,
      gitRemote: normalizeIdentityBackupGitRemote(
        value?.identityBackup?.gitRemote,
        DEFAULT_SETTINGS.identityBackup.gitRemote
      )
    },
    models: {
      defaultByProvider: {
        ollama: value?.models?.defaultByProvider?.ollama ?? DEFAULT_SETTINGS.models.defaultByProvider.ollama,
        lmstudio: value?.models?.defaultByProvider?.lmstudio ?? DEFAULT_SETTINGS.models.defaultByProvider.lmstudio,
        copilot: value?.models?.defaultByProvider?.copilot ?? DEFAULT_SETTINGS.models.defaultByProvider.copilot
      },
      ollamaThinkingEnabled: value?.models?.ollamaThinkingEnabled ?? DEFAULT_SETTINGS.models.ollamaThinkingEnabled
    },
    copilot: {
      baseUrl: value?.copilot?.baseUrl ?? DEFAULT_SETTINGS.copilot.baseUrl,
      apiKey: value?.copilot?.apiKey ?? DEFAULT_SETTINGS.copilot.apiKey,
      defaultModel: value?.copilot?.defaultModel ?? DEFAULT_SETTINGS.copilot.defaultModel,
      disabled: value?.copilot?.disabled ?? DEFAULT_SETTINGS.copilot.disabled
    },
    visionProviderPriority: normalizeVisionPriorityWeb(
      value?.visionProviderPriority as Array<"lmstudio" | "ollama" | "cloud"> | undefined
    ),
    vision: {
      ollamaModel: value?.vision?.ollamaModel ?? DEFAULT_SETTINGS.vision.ollamaModel,
      ollamaBaseUrl: value?.vision?.ollamaBaseUrl ?? DEFAULT_SETTINGS.vision.ollamaBaseUrl,
      lmstudioModel: value?.vision?.lmstudioModel ?? DEFAULT_SETTINGS.vision.lmstudioModel,
      lmstudioBaseUrl: value?.vision?.lmstudioBaseUrl ?? DEFAULT_SETTINGS.vision.lmstudioBaseUrl,
      cloudModel: value?.vision?.cloudModel ?? DEFAULT_SETTINGS.vision.cloudModel,
      cloudBaseUrl: value?.vision?.cloudBaseUrl ?? DEFAULT_SETTINGS.vision.cloudBaseUrl,
      cloudApiKey: value?.vision?.cloudApiKey ?? DEFAULT_SETTINGS.vision.cloudApiKey,
      swapLocalModelsForVision: value?.vision?.swapLocalModelsForVision ?? DEFAULT_SETTINGS.vision.swapLocalModelsForVision
    },
    updates: {
      enabled: value?.updates?.enabled ?? DEFAULT_SETTINGS.updates.enabled,
      checkIntervalMs: value?.updates?.checkIntervalMs ?? DEFAULT_SETTINGS.updates.checkIntervalMs,
      repoOwner: value?.updates?.repoOwner ?? DEFAULT_SETTINGS.updates.repoOwner,
      repoName: value?.updates?.repoName ?? DEFAULT_SETTINGS.updates.repoName,
      channel: value?.updates?.channel ?? DEFAULT_SETTINGS.updates.channel,
      autoApply: value?.updates?.autoApply ?? DEFAULT_SETTINGS.updates.autoApply
    },
    offlineMode: {
      enabled: value?.offlineMode?.enabled ?? DEFAULT_SETTINGS.offlineMode.enabled
    },
    skillSettings: value?.skillSettings ?? DEFAULT_SETTINGS.skillSettings
  };
  let merged: SettingsState = { ...draft };
  if (merged.activeProvider === "ollama") merged = { ...merged, ollama: { ...merged.ollama, disabled: false } };
  if (merged.activeProvider === "lmstudio") merged = { ...merged, lmstudio: { disabled: false } };
  if (merged.activeProvider === "copilot") merged = { ...merged, copilot: { ...merged.copilot, disabled: false } };
  const wb = merged.skillSettings["website-builder"] as Record<string, unknown> | undefined;
  if (wb && typeof wb === "object") {
    const rawProv = String(wb.provider ?? merged.activeProvider);
    let fixed = rawProv;
    if (fixed === "ollama" && merged.ollama.disabled === true) fixed = firstAvailableProviderId(merged);
    else if (fixed === "lmstudio" && merged.lmstudio.disabled === true) fixed = firstAvailableProviderId(merged);
    else if (fixed === "copilot" && merged.copilot.disabled === true) fixed = firstAvailableProviderId(merged);
    else if (fixed !== "ollama" && fixed !== "lmstudio" && fixed !== "copilot") fixed = firstAvailableProviderId(merged);
    if (fixed !== rawProv) {
      merged = {
        ...merged,
        skillSettings: {
          ...merged.skillSettings,
          ["website-builder"]: { ...wb, provider: fixed }
        }
      };
    }
  }
  let ap = merged.activeProvider;
  if (ap === "ollama" && merged.ollama.disabled === true) {
    ap = firstAvailableProviderId(merged);
  }
  if (ap === "lmstudio" && merged.lmstudio.disabled === true) {
    ap = firstAvailableProviderId(merged);
  }
  if (ap === "copilot" && merged.copilot.disabled === true) {
    ap = firstAvailableProviderId(merged);
  }
  return { ...merged, activeProvider: ap };
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
