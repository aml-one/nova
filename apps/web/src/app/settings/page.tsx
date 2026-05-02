"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useTheme } from "next-themes";
import { FaCopy, FaPenToSquare, FaRotateRight } from "react-icons/fa6";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
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
type UpdateStatus = {
  installedAt: string;
  latestPushedAt?: string;
  latestCommitSha?: string;
  latestCommitUrl?: string;
  updateAvailable: boolean;
  lastCheckedAt?: string;
  lastAppliedAt?: string;
  lastError?: string;
};
type SettingsState = {
  delegatedFolders: string[];
  requireApprovals: boolean;
  activeProvider: "ollama" | "lmstudio" | "copilot";
  ollama: { disabled: boolean };
  lmstudio: { disabled: boolean };
  web: {
    loginEnabled: boolean;
    hideProviderModelInStats: boolean;
    sendOnEnter: boolean;
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
  messagingAccess: { novaPhoneNumber: string; denyUnknownNumbers: boolean; systemAdmins: string[]; guests: string[] };
  shell: { timeoutMs: number; maxOutputBytes: number };
  skills: { isolationEnabled: boolean; timeoutMs: number; maxMemoryMb: number; skillAuthoringDisabled: boolean };
  identityBackup: { enabled: boolean; intervalDays: number; labelPrefix: string };
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
type SshTestResult = { ok: boolean; detail: string } | null;

const DEFAULT_SETTINGS: SettingsState = {
  delegatedFolders: [],
  requireApprovals: false,
  activeProvider: "copilot",
  ollama: { disabled: true },
  lmstudio: { disabled: true },
  web: {
    loginEnabled: true,
    hideProviderModelInStats: false,
    sendOnEnter: false,
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
  emotions: { enabled: false, expressionStyle: "balanced", mirrorUserValence: true },
  messagingAccess: { novaPhoneNumber: "", denyUnknownNumbers: true, systemAdmins: [], guests: [] },
  shell: { timeoutMs: 30000, maxOutputBytes: 1024 * 1024 },
  skills: { isolationEnabled: false, timeoutMs: 15000, maxMemoryMb: 256, skillAuthoringDisabled: false },
  identityBackup: { enabled: false, intervalDays: 1, labelPrefix: "nova-core" },
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
  const [channelsSetupOutput, setChannelsSetupOutput] = useState<string>("");
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
  const [sshTestResult, setSshTestResult] = useState<SshTestResult>(null);
  const lastSavedChatStyleRef = useRef<string>("");
  const [chatStyleSaveState, setChatStyleSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

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
      const stateResponse = await fetch("/api/auth/state");
      const stateData = (await stateResponse.json()) as { loginEnabled?: boolean };
      const loginEnabled = stateData.loginEnabled !== false;
      const meResponse = await fetch("/api/auth/me");
      if (loginEnabled && !meResponse.ok) {
        router.push("/login");
        return;
      }
      await Promise.all([
        loadSettings(),
        loadHealth(),
        loadCatalog(),
        loadUpdateStatus(),
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
          const response = await fetch("/api/settings", {
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
    if (!copilotDeviceLoginSessionId) return;
    let cancelled = false;
    const poll = async (): Promise<void> => {
      const response = await fetch(`/api/setup/copilot/device-login/status?sessionId=${encodeURIComponent(copilotDeviceLoginSessionId)}`);
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
    const response = await fetch("/api/settings");
    const data = (await response.json()) as { settings?: Partial<SettingsState> };
    if (response.ok) setSettings(normalizeSettings(data.settings));
  }
  async function loadHealth(): Promise<void> {
    const response = await fetch("/api/system/health");
    const data = (await response.json()) as { health?: FullHealth };
    if (response.ok) setHealth(data.health ?? null);
  }
  async function loadCatalog(): Promise<void> {
    const response = await fetch("/api/providers/catalog");
    const data = (await response.json()) as ProviderCatalog;
    if (response.ok) setCatalog(data);
  }
  async function loadUpdateStatus(): Promise<void> {
    const response = await fetch("/api/system/update/status");
    const data = (await response.json()) as { status?: UpdateStatus };
    if (response.ok) setUpdateStatus(data.status ?? null);
  }
  async function loadSkillManifests(): Promise<void> {
    const response = await fetch("/api/skills/manifests");
    const data = (await response.json()) as { items?: SkillManifest[] };
    if (response.ok) setSkillManifests(data.items ?? []);
  }
  async function loadWebsites(): Promise<void> {
    const response = await fetch("/api/websites");
    const data = (await response.json()) as { items?: WebsiteProject[] };
    if (response.ok) setWebsites(data.items ?? []);
  }
  async function loadDefaultPersona(): Promise<void> {
    const response = await fetch("/api/persona/default");
    const data = (await response.json()) as { persona?: PersonaState; source?: "file" | "fallback"; filePath?: string };
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
    const response = await fetch("/api/personas/versions?personaId=default&rewritesOnly=true");
    const data = (await response.json()) as { items?: PersonaVersion[] };
    if (response.ok) {
      setPersonaVersions(Array.isArray(data.items) ? data.items : []);
    }
  }
  async function loadImprovementHistory(): Promise<void> {
    const response = await fetch("/api/improvement/history");
    const data = (await response.json()) as { itemsByDate?: ImprovementHistoryByDate };
    if (response.ok) {
      setImprovementHistoryByDate(data.itemsByDate ?? {});
    }
  }
  async function loadIdentityBackupStatus(): Promise<void> {
    const response = await fetch("/api/backup/identity/status");
    const data = (await response.json()) as { latestSuccess?: BackupRunState; latestRun?: BackupRunState };
    if (response.ok) {
      setLatestIdentityBackup(data.latestSuccess ?? data.latestRun ?? null);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setSaving(true);
    setStatus(null);
    setError(null);
    const response = await fetch("/api/settings", {
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
    const response = await fetch("/api/backup/identity/push", {
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
    const response = await fetch("/api/system/update/check", { method: "POST" });
    const data = (await response.json()) as { status?: UpdateStatus; error?: string };
    if (!response.ok) setError(data.error ?? "Update check failed");
    else setUpdateStatus(data.status ?? null);
  }

  async function applyUpdates(): Promise<void> {
    const response = await fetch("/api/system/update/apply", { method: "POST" });
    const data = (await response.json()) as { result?: { message?: string }; error?: string };
    if (!response.ok) setError(data.error ?? "Update apply failed");
    else setStatus(data.result?.message ?? "Update apply requested");
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

  async function runOneClickChannelSetup(): Promise<void> {
    setError(null);
    setStatus(null);
    const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
    const response = await fetch("/api/setup/channels/test", {
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
    const data = (await response.json()) as {
      signal?: SetupCheckResult;
      whatsApp?: SetupCheckResult;
      suggestedEnv?: string;
      error?: string;
    };
    if (!response.ok) {
      setError(data.error ?? "Channel setup test failed");
      return;
    }
    const signalLine = `Signal: ${data.signal?.ok ? "OK" : "Needs attention"} - ${data.signal?.detail ?? "-"}`;
    const waLine = `WhatsApp: ${data.whatsApp?.ok ? "OK" : "Needs attention"} - ${data.whatsApp?.detail ?? "-"}`;
    setChannelsSetupOutput([signalLine, waLine, "", data.suggestedEnv ?? ""].join("\n"));
    setStatus("Channel setup checked. Review result and save settings.");
  }

  async function copyChannelsSetupOutput(): Promise<void> {
    if (!channelsSetupOutput.trim()) return;
    try {
      await navigator.clipboard.writeText(channelsSetupOutput);
      setStatus("Copied channel setup output to clipboard.");
    } catch {
      setError("Could not copy to clipboard. Please copy manually.");
    }
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
    const response = await fetch("/api/setup/copilot/test", {
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
      const response = await fetch("/api/models/ping", { method: "POST" });
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
    const response = await fetch("/api/setup/copilot/device-login/start", { method: "POST" });
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
    await fetch("/api/setup/copilot/device-login/cancel", {
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
    const response = await fetch("/api/websites/test-ssh", {
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
    const response = await fetch("/api/persona/default", {
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
    const response = await fetch("/api/personas/rollback", {
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
    { id: "learning", label: "Learning", tone: "green" as const },
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
  const skillStatusById = buildSkillStatusMap(skillManifests, health?.checks ?? []);
  const cameraSkillManifest = skillManifests.find((item) => item.id === "camera-vision" || item.id === "cameraVision");
  const cameraSkillStatus = skillStatusById["camera-vision"] ?? skillStatusById["cameraVision"] ?? "inactive";
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
            <h1 className="text-2xl font-semibold">Settings</h1>
            <p className="text-sm text-muted">Modern control center with setup guidance and live status.</p>
          </div>
          <div className="flex min-w-[220px] flex-col items-end gap-1">
            <Button type="submit" tone="green" disabled={saving}>{saving ? "Saving..." : "Save Settings"}</Button>
            <span className={`text-xs ${status ? "text-emerald-600" : error ? "text-rose-600" : "invisible"}`}>
              {status ?? error ?? "placeholder"}
            </span>
          </div>
        </div>
        {loading ? <Card>Loading...</Card> : null}
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
                  className="w-full justify-start text-left"
                  title={item.label}
                >
                  <span className="flex w-full items-center justify-between gap-2">
                    <span>{item.label}</span>
                    {item.id.startsWith("skill:") ? (
                      <span
                        className={badgeClassForSkillStatus(skillStatusById[item.id.replace("skill:", "")] ?? "inactive")}
                      >
                        {labelForSkillStatus(skillStatusById[item.id.replace("skill:", "")] ?? "inactive")}
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
                    if (v === "ollama") return { ...p, activeProvider: "ollama", ollama: { disabled: false } };
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
                          ollama: { disabled: true },
                          models: { ...p.models, defaultByProvider: { ...p.models.defaultByProvider, ollama: "" } }
                        };
                        return {
                          ...next,
                          activeProvider: p.activeProvider === "ollama" ? firstAvailableProviderId(next) : p.activeProvider
                        };
                      }
                      return {
                        ...p,
                        ollama: { disabled: false },
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
                  Install and run <a className="underline" href="https://github.com/bbernhard/signal-cli-rest-api" target="_blank" rel="noreferrer">signal-cli-rest-api</a>, then register/link your number and use the API URL below.
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
                <h3 className="text-sm font-semibold">WhatsApp setup (Meta Cloud API)</h3>
                <p className="text-xs text-muted">
                  Create an app in <a className="underline" href="https://developers.facebook.com/" target="_blank" rel="noreferrer">Meta for Developers</a>, add WhatsApp product, then copy credentials.
                </p>
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
            </div>
            <div className="rounded-ui border bg-surface p-2 text-xs text-muted">
              <div><strong>Signal quick checklist:</strong> install `signal-cli-rest-api` {"->"} register/link number {"->"} verify API responds {"->"} paste URL/account {"->"} run validation.</div>
              <div><strong>WhatsApp quick checklist:</strong> create Meta app {"->"} add WhatsApp {"->"} generate permanent token {"->"} get phone number ID {"->"} run validation.</div>
            </div>
            <Button
              type="button"
              tone="green"
              onClick={async () => {
                if (channelsSetupMode === "signal") {
                  const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
                  const response = await fetch("/api/setup/channels/test", {
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
                  const data = (await response.json()) as { signal?: SetupCheckResult; suggestedEnv?: string; error?: string };
                  if (!response.ok) {
                    setError(data.error ?? "Signal setup test failed");
                    return;
                  }
                  const signalLine = `Signal: ${data.signal?.ok ? "OK" : "Needs attention"} - ${data.signal?.detail ?? "-"}`;
                  setChannelsSetupOutput([signalLine, "", data.suggestedEnv ?? ""].join("\n"));
                  setStatus("Signal setup checked.");
                  return;
                }
                if (channelsSetupMode === "whatsapp") {
                  const values = (settings.skillSettings["channel-setup"] ?? {}) as Record<string, string>;
                  const response = await fetch("/api/setup/channels/test", {
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
                  const waLine = `WhatsApp: ${data.whatsApp?.ok ? "OK" : "Needs attention"} - ${data.whatsApp?.detail ?? "-"}`;
                  setChannelsSetupOutput([waLine, "", data.suggestedEnv ?? ""].join("\n"));
                  setStatus("WhatsApp setup checked.");
                  return;
                }
                await runOneClickChannelSetup();
              }}
            >
              Validate selected setup + generate env
            </Button>
            {channelsSetupOutput ? (
              <div className="space-y-2">
                <textarea className="h-32 w-full rounded-ui border bg-white p-2 font-mono text-xs" value={channelsSetupOutput} readOnly />
                <Button type="button" tone="blue" onClick={() => void copyChannelsSetupOutput()}>Copy env block</Button>
              </div>
            ) : null}
            <div className="grid gap-3 md:grid-cols-2">
              <BridgeGuide title="SignalBridge" item={catalog?.setup?.signalBridge} />
              <BridgeGuide title="WhatsAppBridge" item={catalog?.setup?.whatsAppBridge} />
            </div>
          </Card>
        ) : null}

        {tab === "learning" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Learning & Emotion</h2>
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
            <Select value={settings.emotions.expressionStyle} onChange={(e) => setSettings((p) => ({ ...p, emotions: { ...p.emotions, expressionStyle: e.target.value as SettingsState["emotions"]["expressionStyle"] } }))}>
              <option value="subtle">Subtle</option>
              <option value="balanced">Balanced</option>
              <option value="expressive">Expressive</option>
            </Select>
          </Card>
        ) : null}

        {tab === "backup" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Identity Backup</h2>
            <label className="flex items-center gap-2"><Checkbox checked={settings.identityBackup.enabled} onChange={(e) => setSettings((p) => ({ ...p, identityBackup: { ...p.identityBackup, enabled: e.target.checked } }))} /> Enable automatic identity backup</label>
            <div className="grid gap-2 md:grid-cols-2">
              <Input type="number" min={1} max={30} value={settings.identityBackup.intervalDays} onChange={(e) => setSettings((p) => ({ ...p, identityBackup: { ...p.identityBackup, intervalDays: Number(e.target.value || 1) } }))} placeholder="Interval days" />
              <Input value={settings.identityBackup.labelPrefix} onChange={(e) => setSettings((p) => ({ ...p, identityBackup: { ...p.identityBackup, labelPrefix: e.target.value } }))} placeholder="Label prefix" />
            </div>
            <div className="flex gap-2">
              <Input value={backupLabel} onChange={(e) => setBackupLabel(e.target.value)} placeholder="Manual backup label" />
              <Button type="button" tone="pink" onClick={() => void pushIdentityBackup()}>Push Backup</Button>
            </div>
          </Card>
        ) : null}

        {tab === "updates" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Auto Updates</h2>
            <p className="text-xs text-muted">Automatic checks run at most once per day. Use "Check now" anytime for a manual check.</p>
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
              <Button type="button" tone="orange" onClick={() => void applyUpdates()}>Apply latest</Button>
            </div>
            {updateStatus ? (
              <div className="rounded-ui border bg-surface p-2 text-sm">
                <div>Installed at: {updateStatus.installedAt ? new Date(updateStatus.installedAt).toLocaleString() : "-"}</div>
                <div>Latest push: {updateStatus.latestPushedAt ? new Date(updateStatus.latestPushedAt).toLocaleString() : "-"}</div>
                <div>Latest commit: {updateStatus.latestCommitSha ? updateStatus.latestCommitSha.slice(0, 10) : "-"}</div>
                <div>Available: {updateStatus.updateAvailable ? "Yes" : "No"}</div>
                <div>Last checked: {updateStatus.lastCheckedAt ? new Date(updateStatus.lastCheckedAt).toLocaleString() : "-"}</div>
                <div>Last applied: {updateStatus.lastAppliedAt ? new Date(updateStatus.lastAppliedAt).toLocaleString() : "-"}</div>
                {updateErrorMessage ? <div className="text-red-600">{updateErrorMessage}</div> : null}
              </div>
            ) : null}
          </Card>
        ) : null}

        {tab === "skill:camera-vision" || tab === "skill:cameraVision" ? (
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold">Camera Vision Skill</h2>
              <span className={badgeClassForSkillStatus(cameraSkillStatus)}>{labelForSkillStatus(cameraSkillStatus)}</span>
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
                      await fetch("/api/websites", {
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

        {tab.startsWith("skill:") && tab !== "skill:website-builder" && tab !== "skill:perplexica-websearch" && tab !== "skill:camera-vision" && tab !== "skill:cameraVision" ? (
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
        <Card className="lg:sticky lg:top-24">
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
          <div className="max-h-[60vh] space-y-2 overflow-y-auto">
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
    </form>
  );
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

function buildSkillStatusMap(
  manifests: SkillManifest[],
  checks: HealthCheck[]
): Record<string, "active" | "degraded" | "inactive"> {
  const byId: Record<string, "active" | "degraded" | "inactive"> = {};
  for (const item of manifests) {
    const matched = checks.find((check) => {
      const raw = `${check.id} ${check.name} ${check.detail}`.toLowerCase();
      return raw.includes(item.id.toLowerCase()) || raw.includes(item.name.toLowerCase());
    });
    if (!matched) {
      byId[item.settingsTab?.id ?? item.id] = "inactive";
      continue;
    }
    byId[item.settingsTab?.id ?? item.id] =
      matched.level === "green" ? "active" : matched.level === "orange" ? "degraded" : "inactive";
  }
  return byId;
}

function labelForSkillStatus(status: "active" | "degraded" | "inactive"): string {
  if (status === "active") return "active";
  if (status === "degraded") return "degraded";
  return "inactive";
}

function badgeClassForSkillStatus(status: "active" | "degraded" | "inactive"): string {
  if (status === "active") return "rounded-ui border border-emerald-500/40 bg-emerald-500/15 px-1.5 py-0.5 text-[10px] text-emerald-300";
  if (status === "degraded") return "rounded-ui border border-amber-500/40 bg-amber-500/15 px-1.5 py-0.5 text-[10px] text-amber-300";
  return "rounded-ui border border-rose-500/40 bg-rose-500/15 px-1.5 py-0.5 text-[10px] text-rose-300";
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
    ollama: { disabled: ollamaDisabled },
    lmstudio: { disabled: lmstudioDisabled },
    web: {
      loginEnabled: value?.web?.loginEnabled ?? DEFAULT_SETTINGS.web.loginEnabled,
      hideProviderModelInStats: value?.web?.hideProviderModelInStats ?? DEFAULT_SETTINGS.web.hideProviderModelInStats,
      sendOnEnter: value?.web?.sendOnEnter ?? DEFAULT_SETTINGS.web.sendOnEnter,
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
    messagingAccess: {
      novaPhoneNumber: value?.messagingAccess?.novaPhoneNumber ?? DEFAULT_SETTINGS.messagingAccess.novaPhoneNumber,
      denyUnknownNumbers: value?.messagingAccess?.denyUnknownNumbers ?? DEFAULT_SETTINGS.messagingAccess.denyUnknownNumbers,
      systemAdmins: value?.messagingAccess?.systemAdmins ?? DEFAULT_SETTINGS.messagingAccess.systemAdmins,
      guests: value?.messagingAccess?.guests ?? DEFAULT_SETTINGS.messagingAccess.guests
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
      labelPrefix: value?.identityBackup?.labelPrefix ?? DEFAULT_SETTINGS.identityBackup.labelPrefix
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
  if (merged.activeProvider === "ollama") merged = { ...merged, ollama: { disabled: false } };
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
