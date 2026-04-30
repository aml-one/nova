"use client";

import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "../../components/ui/card";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { Checkbox } from "../../components/ui/checkbox";
import { HealthPill } from "../../components/ui/health-pill";

type HealthCheck = { id: string; name: string; level: "green" | "orange" | "red"; detail: string; lastSuccessfulAt?: string };
type FullHealth = { level: "green" | "orange" | "red"; checks: HealthCheck[] };
type ProviderCatalog = {
  models?: { ollama?: Array<{ id: string }>; lmstudio?: Array<{ id: string }>; copilot?: Array<{ id: string }> };
  setup?: Record<string, { configured: boolean; details: string; steps: string[] }>;
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
  web: {
    loginEnabled: boolean;
    hideProviderModelInStats: boolean;
    sendOnEnter: boolean;
    chatStyle: {
      userBubbleColor: string;
      assistantBubbleColor: string;
      userTextColor: string;
      assistantTextColor: string;
      bubbleBackgroundEnabled: boolean;
      borderColor: string;
      borderThicknessPx: number;
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
  identityBackup: { enabled: boolean; intervalDays: number; labelPrefix: string };
  models: { defaultByProvider: { ollama: string; lmstudio: string; copilot: string } };
  copilot: { baseUrl: string; apiKey: string; defaultModel: string };
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
type ImprovementHistoryByDate = Record<string, Array<{ category?: string; accepted?: boolean; result?: string }>>;
type TimelineFilterKey = "persona" | "knowledge" | "backup";
type WebsiteProject = { id: string; name: string; domain: string; subdomain: string; local_path: string; remote_www_root: string; remote_subfolder: string };
type SetupCheckResult = { ok: boolean; detail: string };
type SshTestResult = { ok: boolean; detail: string } | null;

const DEFAULT_SETTINGS: SettingsState = {
  delegatedFolders: [],
  requireApprovals: false,
  activeProvider: "ollama",
  web: {
    loginEnabled: true,
    hideProviderModelInStats: false,
    sendOnEnter: false,
    chatStyle: {
      userBubbleColor: "#dbeafe",
      assistantBubbleColor: "#e9d5ff",
      userTextColor: "#0f172a",
      assistantTextColor: "#0f172a",
      bubbleBackgroundEnabled: true,
      borderColor: "#94a3b8",
      borderThicknessPx: 1,
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
  identityBackup: { enabled: false, intervalDays: 1, labelPrefix: "nova-core" },
  models: { defaultByProvider: { ollama: "", lmstudio: "", copilot: "" } },
  copilot: { baseUrl: "", apiKey: "", defaultModel: "gpt-4o-mini" },
  updates: { enabled: false, checkIntervalMs: 1800000, repoOwner: "", repoName: "", channel: "stable", autoApply: false }
  , offlineMode: { enabled: false },
  skillSettings: {}
};

export default function SettingsPage() {
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
  const [channelsSetupMode, setChannelsSetupMode] = useState<"signal" | "whatsapp" | "both">("both");
  const [sshTestResult, setSshTestResult] = useState<SshTestResult>(null);

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
    const response = await fetch("/api/personas/versions?personaId=default");
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
    const response = await fetch("/api/setup/copilot/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        baseUrl: settings.copilot.baseUrl,
        apiKey: settings.copilot.apiKey
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
  const websiteBuilderSettings = (settings.skillSettings["website-builder"] ?? {}) as Record<string, unknown>;
  const cameraVisionSettings = (settings.skillSettings["camera-vision"] ?? {}) as Record<string, unknown>;
  const selectedWebsiteBuilderProvider = String(websiteBuilderSettings.provider ?? settings.activeProvider);
  const selectedWebsiteBuilderModels =
    selectedWebsiteBuilderProvider === "ollama"
      ? modelOptions.ollama ?? []
      : selectedWebsiteBuilderProvider === "lmstudio"
        ? modelOptions.lmstudio ?? []
        : modelOptions.copilot ?? [];
  const websiteBuilderModel = String(websiteBuilderSettings.model ?? "");
  const updateErrorMessage = normalizeUpdateError(updateStatus?.lastError);
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
        <div className="grid gap-4 lg:grid-cols-[220px_1fr]">
          <Card className="h-fit lg:sticky lg:top-24">
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
          <div>
        {tab === "general" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">General & Safety</h2>
            <label className="flex items-center gap-2"><Checkbox checked={settings.requireApprovals} onChange={(e) => setSettings((p) => ({ ...p, requireApprovals: e.target.checked }))} /> Require approvals</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.loginEnabled} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, loginEnabled: e.target.checked } }))} /> Enable Web login</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.hideProviderModelInStats} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, hideProviderModelInStats: e.target.checked } }))} /> Hide provider/model in chat statistics</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.sendOnEnter} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, sendOnEnter: e.target.checked } }))} /> Send message on Enter (Shift+Enter for newline)</label>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.chatStyle.bubbleBackgroundEnabled} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, bubbleBackgroundEnabled: e.target.checked } } }))} /> Enable bubble backgrounds in chat</label>
            <div className="grid gap-2 md:grid-cols-2">
              <label className="grid gap-1 text-xs">
                Nova bubble color (left)
                <Input type="color" value={settings.web.chatStyle.assistantBubbleColor} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, assistantBubbleColor: e.target.value } } }))} />
              </label>
              <label className="grid gap-1 text-xs">
                User bubble color (right)
                <Input type="color" value={settings.web.chatStyle.userBubbleColor} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, userBubbleColor: e.target.value } } }))} />
              </label>
              <label className="grid gap-1 text-xs">
                Nova text color (left)
                <Input type="color" value={settings.web.chatStyle.assistantTextColor} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, assistantTextColor: e.target.value } } }))} />
              </label>
              <label className="grid gap-1 text-xs">
                User text color (right)
                <Input type="color" value={settings.web.chatStyle.userTextColor} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, userTextColor: e.target.value } } }))} />
              </label>
              <label className="grid gap-1 text-xs">
                Bubble border color
                <Input type="color" value={settings.web.chatStyle.borderColor} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, borderColor: e.target.value } } }))} />
              </label>
              <label className="grid gap-1 text-xs">
                Border thickness (px)
                <Input type="number" min={0} max={8} value={settings.web.chatStyle.borderThicknessPx} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, borderThicknessPx: Number(e.target.value || 0) } } }))} />
              </label>
              <label className="grid gap-1 text-xs">
                Bubble corner radius (0-30px)
                <Input type="number" min={0} max={30} value={settings.web.chatStyle.bubbleRadiusPx} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, bubbleRadiusPx: Number(e.target.value || 0) } } }))} />
              </label>
            </div>
            <label className="flex items-center gap-2"><Checkbox checked={settings.web.chatStyle.showNames} onChange={(e) => setSettings((p) => ({ ...p, web: { ...p.web, chatStyle: { ...p.web.chatStyle, showNames: e.target.checked } } }))} /> Show names in chat bubbles (Nova, You)</label>
            <div className="rounded-ui border bg-surface p-3">
              <div className="mb-2 text-xs font-semibold text-muted">Live chat style preview</div>
              <div className="space-y-2 rounded-ui border bg-surface2 p-2">
                <article
                  className="ml-auto max-w-[85%] border p-2.5"
                  style={{
                    backgroundColor: settings.web.chatStyle.bubbleBackgroundEnabled
                      ? settings.web.chatStyle.userBubbleColor
                      : "transparent",
                    color: settings.web.chatStyle.userTextColor,
                    borderColor: settings.web.chatStyle.borderColor,
                    borderWidth: `${settings.web.chatStyle.borderThicknessPx}px`,
                    borderRadius: `${settings.web.chatStyle.bubbleRadiusPx}px`
                  }}
                >
                  {settings.web.chatStyle.showNames ? <div className="mb-1 text-[11px] font-semibold">You</div> : null}
                  <div className="text-xs">Can you summarize what changed?</div>
                </article>
                <article
                  className="mr-auto max-w-[85%] border p-2.5"
                  style={{
                    backgroundColor: settings.web.chatStyle.bubbleBackgroundEnabled
                      ? settings.web.chatStyle.assistantBubbleColor
                      : "transparent",
                    color: settings.web.chatStyle.assistantTextColor,
                    borderColor: settings.web.chatStyle.borderColor,
                    borderWidth: `${settings.web.chatStyle.borderThicknessPx}px`,
                    borderRadius: `${settings.web.chatStyle.bubbleRadiusPx}px`
                  }}
                >
                  {settings.web.chatStyle.showNames ? <div className="mb-1 text-[11px] font-semibold">Nova</div> : null}
                  <div className="text-xs">Updated styling preview is now active.</div>
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
              <Select value={settings.activeProvider} onChange={(e) => setSettings((p) => ({ ...p, activeProvider: e.target.value as SettingsState["activeProvider"] }))}>
                <option value="ollama">Ollama</option>
                <option value="lmstudio">LM Studio</option>
                <option value="copilot">Copilot</option>
              </Select>
            </label>
            <div className="grid gap-2 md:grid-cols-3">
              <label className="grid gap-1 text-sm">
                Ollama default model
                <Select value={settings.models.defaultByProvider.ollama} onChange={(e) => setSettings((p) => ({ ...p, models: { defaultByProvider: { ...p.models.defaultByProvider, ollama: e.target.value } } }))}>
                  <option value="">Auto / env default</option>
                  {(modelOptions.ollama ?? []).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                LM Studio default model
                <Select value={settings.models.defaultByProvider.lmstudio} onChange={(e) => setSettings((p) => ({ ...p, models: { defaultByProvider: { ...p.models.defaultByProvider, lmstudio: e.target.value } } }))}>
                  <option value="">Auto / env default</option>
                  {(modelOptions.lmstudio ?? []).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </Select>
              </label>
              <label className="grid gap-1 text-sm">
                Copilot default model
                <Select value={settings.models.defaultByProvider.copilot} onChange={(e) => setSettings((p) => ({ ...p, models: { defaultByProvider: { ...p.models.defaultByProvider, copilot: e.target.value } } }))}>
                  <option value="">Auto / env default</option>
                  {(modelOptions.copilot ?? []).map((m) => <option key={m.id} value={m.id}>{m.id}</option>)}
                </Select>
              </label>
            </div>
            <label className="flex items-center gap-2"><Checkbox checked={settings.costGovernor.enabled} onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, enabled: e.target.checked } }))} /> Enable smart cost governor</label>
            <div className="grid gap-2 md:grid-cols-2">
              <Input type="number" value={settings.costGovernor.dailyBudgetUsd} onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, dailyBudgetUsd: Number(e.target.value || 0) } }))} placeholder="Daily budget USD" />
              <Select value={settings.costGovernor.qualityTier} onChange={(e) => setSettings((p) => ({ ...p, costGovernor: { ...p.costGovernor, qualityTier: e.target.value as "high" | "balanced" | "economy" } }))}>
                <option value="high">High quality</option>
                <option value="balanced">Balanced</option>
                <option value="economy">Economy</option>
              </Select>
            </div>
            <div className="space-y-2 rounded-ui border bg-surface p-3">
              <h3 className="font-semibold">Copilot quick setup</h3>
              <p className="text-xs text-muted">
                Use any OpenAI-compatible provider endpoint. The base URL should expose a <code>/models</code> route, and API key is created in that provider dashboard.
              </p>
              <p className="text-xs text-muted">
                If you use GitHub Models, check <a className="underline" href="https://github.com/marketplace/models" target="_blank" rel="noreferrer">GitHub Models</a> and create a token in your account settings.
              </p>
              <Input value={settings.copilot.baseUrl} onChange={(e) => setSettings((p) => ({ ...p, copilot: { ...p.copilot, baseUrl: e.target.value } }))} placeholder="COPILOT_BASE_URL" />
              <Input value={settings.copilot.apiKey} onChange={(e) => setSettings((p) => ({ ...p, copilot: { ...p.copilot, apiKey: e.target.value } }))} placeholder="COPILOT_API_KEY" />
              <Input value={settings.copilot.defaultModel} onChange={(e) => setSettings((p) => ({ ...p, copilot: { ...p.copilot, defaultModel: e.target.value } }))} placeholder="Default model" />
              <div className="flex flex-wrap gap-2">
                <Button type="button" tone="purple" onClick={() => void runCopilotSetupValidation()}>Validate Copilot setup</Button>
              </div>
              {copilotSetupOutput ? (
                <textarea className="h-24 w-full rounded-ui border bg-white p-2 font-mono text-xs" value={copilotSetupOutput} readOnly />
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
            <Select value={settings.updates.channel} onChange={(e) => setSettings((p) => ({ ...p, updates: { ...p.updates, channel: e.target.value as "stable" | "beta" } }))}>
              <option value="stable">Stable</option>
              <option value="beta">Beta</option>
            </Select>
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
            <h2 className="text-lg font-semibold">Camera Vision Skill</h2>
            <p className="text-xs text-muted">
              Add RTSP camera URLs (one per line). Example: <code>rtsp://user:password@192.168.31.10:554/h.264</code>
            </p>
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
          </Card>
        ) : null}

        {tab === "skill:website-builder" ? (
          <Card className="space-y-3">
            <h2 className="text-lg font-semibold">Website Builder Skill</h2>
            <p className="text-xs text-muted">Configure SSH/Caddy defaults and manage created websites.</p>
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
                  value={selectedWebsiteBuilderProvider}
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
                  <option value="ollama">Ollama</option>
                  <option value="lmstudio">LM Studio</option>
                  <option value="copilot">Copilot</option>
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
                  {selectedWebsiteBuilderModels.map((m) => (
                    <option key={m.id} value={m.id}>{m.id}</option>
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

        {tab.startsWith("skill:") && tab !== "skill:website-builder" && tab !== "skill:camera-vision" && tab !== "skill:cameraVision" ? (
          <Card>
            <h2 className="text-lg font-semibold">Skill Settings</h2>
            <p className="text-sm text-muted">This tab is contributed by a skill. Custom UI can be added here by that skill.</p>
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

type IdentityTimelineItem = {
  id: string;
  at: string;
  title: string;
  detail: string;
  side: "left" | "right";
  accentClass: string;
  kind: "awakening" | "persona" | "knowledge" | "backup";
  meta?: Record<string, string | number>;
};

function buildIdentityTimeline(input: {
  defaultPersona: PersonaState;
  versions: PersonaVersion[];
  improvementHistoryByDate: ImprovementHistoryByDate;
  latestIdentityBackup: BackupRunState;
}): IdentityTimelineItem[] {
  const items: IdentityTimelineItem[] = [];
  const sortedVersions = [...input.versions].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  if (sortedVersions.length === 0) {
    items.push({
      id: "awakening",
      at: new Date(0).toISOString(),
      title: "Awakening",
      detail: `Base voice: ${input.defaultPersona.voice}; style: ${input.defaultPersona.style.join(", ") || "none"}`,
      side: "left",
      accentClass: "bg-emerald-400",
      kind: "awakening",
      meta: {
        voice: input.defaultPersona.voice,
        style: input.defaultPersona.style.join(", ") || "none"
      }
    });
  } else {
    sortedVersions.forEach((version, index) => {
      items.push({
        id: `persona-v${version.version}`,
        at: version.createdAt,
        title: index === 0 ? "Awakening Persona" : `Persona Evolution v${version.version}`,
        detail: index === 0
          ? `Initial foundation set. Voice: ${input.defaultPersona.voice}`
          : `Identity refined through ongoing learning and user interaction.`,
        side: index % 2 === 0 ? "left" : "right",
        accentClass: index % 2 === 0 ? "bg-orange-400" : "bg-rose-500",
        kind: "persona",
        meta: {
          version: version.version,
          voice: input.defaultPersona.voice,
          styles: input.defaultPersona.style.join(", ") || "none"
        }
      });
    });
  }
  const learningDates = Object.keys(input.improvementHistoryByDate).sort((a, b) => Date.parse(a) - Date.parse(b));
  let cumulativeKnowledge = 0;
  learningDates.slice(-8).forEach((dateKey, index) => {
    const dayItems = input.improvementHistoryByDate[dateKey] ?? [];
    const researched = dayItems.filter((item) => item.category === "research").length;
    const improvements = dayItems.filter((item) => item.category === "improvement").length;
    cumulativeKnowledge += researched + improvements;
    items.push({
      id: `learning-${dateKey}`,
      at: `${dateKey}T12:00:00.000Z`,
      title: "Knowledge Growth",
      detail: `Research notes: ${researched}, improvements: ${improvements}, cumulative growth score: ${cumulativeKnowledge}`,
      side: index % 2 === 0 ? "right" : "left",
      accentClass: "bg-sky-500",
      kind: "knowledge",
      meta: {
        day: dateKey,
        research: researched,
        improvements,
        cumulativeGrowth: cumulativeKnowledge
      }
    });
  });
  if (input.latestIdentityBackup?.createdAt) {
    items.push({
      id: "identity-backup",
      at: input.latestIdentityBackup.createdAt,
      title: input.latestIdentityBackup.status === "success" ? "Identity Safeguarded" : "Backup Attempt",
      detail:
        input.latestIdentityBackup.status === "success"
          ? `Backup saved. Branch: ${input.latestIdentityBackup.branch ?? "n/a"}`
          : `Backup issue: ${input.latestIdentityBackup.error ?? "unknown error"}`,
      side: "right",
      accentClass: input.latestIdentityBackup.status === "success" ? "bg-lime-500" : "bg-rose-500",
      kind: "backup",
      meta: {
        status: input.latestIdentityBackup.status ?? "unknown",
        branch: input.latestIdentityBackup.branch ?? "n/a",
        error: input.latestIdentityBackup.error ?? ""
      }
    });
  }
  const sorted = items
    .filter((item) => Number.isFinite(Date.parse(item.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  if (!sorted.length || sorted[sorted.length - 1]?.title !== "Awakening Persona") {
    sorted.push({
      id: "origin-awakening-fallback",
      at: "1970-01-01T00:00:00.000Z",
      title: "Awakening",
      detail: `Nova was initialized with voice "${input.defaultPersona.voice}" and core goals to help, learn, and evolve.`,
      side: "left",
      accentClass: "bg-emerald-400",
      kind: "awakening",
      meta: {
        voice: input.defaultPersona.voice,
        style: input.defaultPersona.style.join(", ") || "none"
      }
    });
  }
  return sorted;
}

function IdentityEvolutionGraph(input: {
  items: IdentityTimelineItem[];
  filters: Record<TimelineFilterKey, boolean>;
  onToggleFilter: (key: TimelineFilterKey) => void;
  onRestoreVersion: (version: number) => void;
  restoringVersion: number | null;
}) {
  const { items, filters, onToggleFilter, onRestoreVersion, restoringVersion } = input;
  const filteredItems = items.filter((item) => {
    if (item.kind === "awakening" || item.kind === "persona") return filters.persona;
    if (item.kind === "knowledge") return filters.knowledge;
    if (item.kind === "backup") return filters.backup;
    return true;
  });
  const [selectedId, setSelectedId] = useState<string>(filteredItems[0]?.id ?? items[0]?.id ?? "");
  const selected = filteredItems.find((item) => item.id === selectedId) ?? filteredItems[0] ?? items[0];
  const selectedVersion = Number(selected?.meta?.version ?? 0);
  const [confirmStepVersion, setConfirmStepVersion] = useState<number | null>(null);
  const [typedConfirm, setTypedConfirm] = useState("");

  return (
    <div className="rounded-ui border bg-surface2 p-3">
      <div className="mb-2 flex items-center justify-between text-[11px] text-muted">
        <span className="font-semibold text-emerald-400">Present</span>
        <span className="font-semibold text-orange-300">Awakening</span>
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute bottom-0 left-1/2 top-0 w-1 -translate-x-1/2 rounded-full bg-gradient-to-t from-orange-400 via-rose-500 to-sky-500" />
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onToggleFilter("persona")}
            className={`rounded-ui border px-2 py-1 text-[11px] ${filters.persona ? "border-orange-400/50 bg-orange-400/15 text-orange-200" : "border-slate-500/40 text-muted"}`}
          >
            Personality
          </button>
          <button
            type="button"
            onClick={() => onToggleFilter("knowledge")}
            className={`rounded-ui border px-2 py-1 text-[11px] ${filters.knowledge ? "border-sky-400/50 bg-sky-400/15 text-sky-200" : "border-slate-500/40 text-muted"}`}
          >
            Knowledge
          </button>
          <button
            type="button"
            onClick={() => onToggleFilter("backup")}
            className={`rounded-ui border px-2 py-1 text-[11px] ${filters.backup ? "border-lime-400/50 bg-lime-400/15 text-lime-200" : "border-slate-500/40 text-muted"}`}
          >
            Backups
          </button>
        </div>
        <div className="space-y-4">
          {filteredItems.map((item) => (
            <div key={item.id} className={`grid grid-cols-[1fr_24px_1fr] items-center gap-2 ${item.side === "left" ? "" : ""}`}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`${item.side === "left" ? "text-right" : "invisible"} rounded-ui border bg-surface p-2 transition hover:border-sky-400/60 ${
                  selected?.id === item.id ? "border-sky-400/70 bg-sky-500/10" : ""
                }`}
              >
                <div className="text-[11px] font-semibold">{item.title}</div>
                <div className="text-[10px] text-muted">{item.detail}</div>
                <div className="mt-1 text-[10px] text-muted">{formatTimelineDate(item.at)}</div>
              </button>
              <div className="relative flex items-center justify-center">
                <button
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`z-10 inline-flex h-4 w-4 rounded-full border-2 border-white/90 ${item.accentClass} ${
                    selected?.id === item.id ? "ring-2 ring-sky-300/70 ring-offset-1 ring-offset-surface2" : ""
                  }`}
                  title={`Open ${item.title} details`}
                />
              </div>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className={`${item.side === "right" ? "text-left" : "invisible"} rounded-ui border bg-surface p-2 transition hover:border-sky-400/60 ${
                  selected?.id === item.id ? "border-sky-400/70 bg-sky-500/10" : ""
                }`}
              >
                <div className="text-[11px] font-semibold">{item.title}</div>
                <div className="text-[10px] text-muted">{item.detail}</div>
                <div className="mt-1 text-[10px] text-muted">{formatTimelineDate(item.at)}</div>
              </button>
            </div>
          ))}
        </div>
      </div>
      {selected ? (
        <div className="mt-3 rounded-ui border bg-surface p-3">
          <div className="mb-1 flex items-center justify-between gap-2">
            <strong className="text-sm">{selected.title}</strong>
            <span className="rounded-ui border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] uppercase tracking-wide text-sky-300">
              {selected.kind}
            </span>
          </div>
          <div className="mb-2 text-xs text-muted">{selected.detail}</div>
          <div className="text-[11px] text-muted">When: {formatTimelineDate(selected.at)}</div>
          {selected.meta ? (
            <div className="mt-2 grid gap-1 rounded-ui border bg-surface2 p-2 text-[11px]">
              {Object.entries(selected.meta).map(([key, value]) => (
                <div key={key} className="flex items-start justify-between gap-2">
                  <span className="text-muted">{prettifyKey(key)}</span>
                  <span className="text-right">{String(value)}</span>
                </div>
              ))}
            </div>
          ) : null}
          {selected.kind === "persona" && selectedVersion > 0 ? (
            <div className="mt-3">
              {confirmStepVersion !== selectedVersion ? (
                <Button
                  type="button"
                  tone="orange"
                  disabled={restoringVersion !== null}
                  onClick={() => {
                    const ok = window.confirm(
                      `First confirmation: Restore Nova base identity to persona version ${selectedVersion}?`
                    );
                    if (!ok) return;
                    setConfirmStepVersion(selectedVersion);
                    setTypedConfirm("");
                  }}
                >
                  {`Restore Persona v${selectedVersion}`}
                </Button>
              ) : (
                <div className="space-y-2 rounded-ui border border-rose-500/40 bg-rose-500/10 p-2">
                  <div className="text-xs font-semibold text-rose-200">
                    Second confirmation required
                  </div>
                  <div className="text-[11px] text-rose-200/90">
                    Type <code>RESTORE</code> and click confirm to continue.
                  </div>
                  <Input
                    value={typedConfirm}
                    onChange={(e) => setTypedConfirm(e.target.value)}
                    placeholder="Type RESTORE"
                  />
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      tone="red"
                      disabled={restoringVersion !== null || typedConfirm.trim().toUpperCase() !== "RESTORE"}
                      onClick={() => {
                        void onRestoreVersion(selectedVersion);
                        setConfirmStepVersion(null);
                        setTypedConfirm("");
                      }}
                    >
                      {restoringVersion === selectedVersion ? "Restoring..." : "Confirm restore"}
                    </Button>
                    <Button
                      type="button"
                      tone="neutral"
                      disabled={restoringVersion !== null}
                      onClick={() => {
                        setConfirmStepVersion(null);
                        setTypedConfirm("");
                      }}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function formatTimelineDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
}

function prettifyKey(key: string): string {
  return key
    .replace(/([A-Z])/g, " $1")
    .replace(/[_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
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

function normalizeSettings(value: Partial<SettingsState> | undefined): SettingsState {
  return {
    delegatedFolders: value?.delegatedFolders ?? DEFAULT_SETTINGS.delegatedFolders,
    requireApprovals: value?.requireApprovals ?? DEFAULT_SETTINGS.requireApprovals,
    activeProvider: value?.activeProvider ?? DEFAULT_SETTINGS.activeProvider,
    web: {
      loginEnabled: value?.web?.loginEnabled ?? DEFAULT_SETTINGS.web.loginEnabled,
      hideProviderModelInStats: value?.web?.hideProviderModelInStats ?? DEFAULT_SETTINGS.web.hideProviderModelInStats,
      sendOnEnter: value?.web?.sendOnEnter ?? DEFAULT_SETTINGS.web.sendOnEnter,
      chatStyle: {
        userBubbleColor: value?.web?.chatStyle?.userBubbleColor ?? DEFAULT_SETTINGS.web.chatStyle.userBubbleColor,
        assistantBubbleColor: value?.web?.chatStyle?.assistantBubbleColor ?? DEFAULT_SETTINGS.web.chatStyle.assistantBubbleColor,
        userTextColor: value?.web?.chatStyle?.userTextColor ?? DEFAULT_SETTINGS.web.chatStyle.userTextColor,
        assistantTextColor: value?.web?.chatStyle?.assistantTextColor ?? DEFAULT_SETTINGS.web.chatStyle.assistantTextColor,
        bubbleBackgroundEnabled:
          value?.web?.chatStyle?.bubbleBackgroundEnabled ?? DEFAULT_SETTINGS.web.chatStyle.bubbleBackgroundEnabled,
        borderColor: value?.web?.chatStyle?.borderColor ?? DEFAULT_SETTINGS.web.chatStyle.borderColor,
        borderThicknessPx: value?.web?.chatStyle?.borderThicknessPx ?? DEFAULT_SETTINGS.web.chatStyle.borderThicknessPx,
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
      }
    },
    copilot: {
      baseUrl: value?.copilot?.baseUrl ?? DEFAULT_SETTINGS.copilot.baseUrl,
      apiKey: value?.copilot?.apiKey ?? DEFAULT_SETTINGS.copilot.apiKey,
      defaultModel: value?.copilot?.defaultModel ?? DEFAULT_SETTINGS.copilot.defaultModel
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
}
