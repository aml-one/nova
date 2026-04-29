"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type SettingsState = {
  delegatedFolders: string[];
  requireApprovals: boolean;
  activeProvider: "ollama" | "lmstudio" | "copilot";
  visionProviderPriority: Array<"lmstudio" | "ollama" | "cloud">;
  mediaProviderPriority: Array<"comfyui" | "cloud">;
  shell: {
    timeoutMs: number;
    maxOutputBytes: number;
  };
  skills: {
    isolationEnabled: boolean;
    timeoutMs: number;
    maxMemoryMb: number;
  };
  web: {
    loginEnabled: boolean;
  };
  learning: {
    enabled: boolean;
    idleMinutes: number;
    intervalMs: number;
    minFailuresForAutoImprove: number;
  };
  messagingAccess: {
    novaPhoneNumber: string;
    denyUnknownNumbers: boolean;
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
  emotions: {
    enabled: boolean;
    expressionStyle: "subtle" | "balanced" | "expressive";
    mirrorUserValence: boolean;
  };
  identityBackup: {
    enabled: boolean;
    intervalDays: number;
    labelPrefix: string;
  };
};

type HealthCheck = {
  id: string;
  name: string;
  level: "green" | "orange" | "red";
  detail: string;
  fingerprint?: string;
  lastSuccessfulAt?: string;
};

type FullHealth = {
  level: "green" | "orange" | "red";
  checks: HealthCheck[];
};

type AppUser = {
  id: string;
  email: string;
  createdAt: string;
};

type EmotionSnapshot = {
  userId: string;
  state?: {
    valence: number;
    arousal: number;
    label: string;
  } | null;
};

const DEFAULT_SETTINGS: SettingsState = {
  delegatedFolders: [],
  requireApprovals: false,
  activeProvider: "ollama",
  visionProviderPriority: ["lmstudio", "ollama", "cloud"],
  mediaProviderPriority: ["comfyui", "cloud"],
  shell: {
    timeoutMs: 30000,
    maxOutputBytes: 1024 * 1024
  },
  skills: {
    isolationEnabled: false,
    timeoutMs: 15000,
    maxMemoryMb: 256
  },
  web: {
    loginEnabled: true
  },
  learning: {
    enabled: true,
    idleMinutes: 3,
    intervalMs: 120000,
    minFailuresForAutoImprove: 2
  },
  messagingAccess: {
    novaPhoneNumber: "",
    denyUnknownNumbers: true,
    systemAdmins: [],
    guests: [],
    importantPeople: []
  },
  emotions: {
    enabled: false,
    expressionStyle: "balanced",
    mirrorUserValence: true
  },
  identityBackup: {
    enabled: false,
    intervalDays: 1,
    labelPrefix: "nova-core"
  }
};

export default function SettingsPage() {
  const router = useRouter();
  const [settings, setSettings] = useState<SettingsState>(DEFAULT_SETTINGS);
  const [newFolder, setNewFolder] = useState("");
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<FullHealth | null>(null);
  const [healthLoading, setHealthLoading] = useState(false);
  const [users, setUsers] = useState<AppUser[]>([]);
  const [newUserEmail, setNewUserEmail] = useState("");
  const [newUserPassword, setNewUserPassword] = useState("");
  const [newAdminPhone, setNewAdminPhone] = useState("");
  const [newGuestPhone, setNewGuestPhone] = useState("");
  const [newImportantPhone, setNewImportantPhone] = useState("");
  const [simPhone, setSimPhone] = useState("");
  const [simText, setSimText] = useState("");
  const [simChannel, setSimChannel] = useState<"whatsapp" | "signal">("whatsapp");
  const [simResult, setSimResult] = useState<Record<string, unknown> | null>(null);
  const [emotionSystem, setEmotionSystem] = useState<EmotionSnapshot | null>(null);
  const [emotionWebUser, setEmotionWebUser] = useState<EmotionSnapshot | null>(null);
  const [backupLabel, setBackupLabel] = useState("nova-core");
  const [backupRunning, setBackupRunning] = useState(false);
  const [backupResult, setBackupResult] = useState<{ snapshotPath?: string; branch?: string } | null>(null);
  const [backupStatus, setBackupStatus] = useState<{
    latestRun?: { status?: string; mode?: string; createdAt?: string; error?: string } | null;
    latestSuccess?: { branch?: string; createdAt?: string } | null;
  } | null>(null);

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
      const settingsResponse = await fetch("/api/settings");
      const settingsData = (await settingsResponse.json()) as { settings?: Partial<SettingsState>; error?: string };
      if (!settingsResponse.ok) {
        setError(settingsData.error ?? "Could not load settings");
        setLoading(false);
        return;
      }
      setSettings(normalizeSettings(settingsData.settings));
      await Promise.all([loadHealth(), loadUsers(), loadEmotionSnapshots(), loadBackupStatus()]);
      setLoading(false);
    })();
  }, [router]);

  async function loadEmotionSnapshots(): Promise<void> {
    const [systemRes, webRes] = await Promise.all([
      fetch("/api/emotion/state?userId=nova-system"),
      fetch("/api/emotion/state?userId=local-web-user")
    ]);
    const systemData = (await systemRes.json()) as EmotionSnapshot;
    const webData = (await webRes.json()) as EmotionSnapshot;
    if (systemRes.ok) setEmotionSystem(systemData);
    if (webRes.ok) setEmotionWebUser(webData);
  }

  async function loadHealth(): Promise<void> {
    setHealthLoading(true);
    const response = await fetch("/api/system/health");
    const data = (await response.json()) as { health?: FullHealth };
    if (response.ok) {
      setHealth(data.health ?? null);
    }
    setHealthLoading(false);
  }

  async function loadUsers(): Promise<void> {
    const response = await fetch("/api/auth/users");
    const data = (await response.json()) as { items?: AppUser[] };
    if (response.ok) {
      setUsers(data.items ?? []);
    }
  }

  async function save(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus(null);
    setError(null);
    setSaving(true);
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(settings)
      });
      const data = (await response.json()) as { settings?: Partial<SettingsState>; error?: string };
      if (!response.ok) {
        setError(data.error ?? "Failed to save settings");
        return;
      }
      setSettings(normalizeSettings(data.settings));
      setStatus("Saved");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  }

  async function logout(): Promise<void> {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  }

  async function createUser(): Promise<void> {
    setStatus(null);
    setError(null);
    const response = await fetch("/api/auth/users", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email: newUserEmail, password: newUserPassword })
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? "Could not create user");
      return;
    }
    setNewUserEmail("");
    setNewUserPassword("");
    setStatus("User created");
    await loadUsers();
  }

  async function restartService(service: "dispatcher" | "scheduler" | "agent-core"): Promise<void> {
    setStatus(null);
    setError(null);
    const response = await fetch("/api/system/restart", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ service })
    });
    const data = (await response.json()) as { error?: string };
    if (!response.ok) {
      setError(data.error ?? `Failed to restart ${service}`);
      return;
    }
    setStatus(`Restart command sent for ${service}`);
    await loadHealth();
  }

  async function runAccessSimulation(): Promise<void> {
    const response = await fetch("/api/access/simulate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        channel: simChannel,
        phoneNumber: simPhone,
        text: simText
      })
    });
    const data = (await response.json()) as Record<string, unknown>;
    if (!response.ok) {
      setError(String(data.error ?? "Simulation failed"));
      return;
    }
    setSimResult(data);
  }

  async function loadBackupStatus(): Promise<void> {
    const response = await fetch("/api/backup/identity/status");
    const data = (await response.json()) as {
      latestRun?: { status?: string; mode?: string; createdAt?: string; error?: string } | null;
      latestSuccess?: { branch?: string; createdAt?: string } | null;
    };
    if (response.ok) {
      setBackupStatus({
        latestRun: data.latestRun ?? null,
        latestSuccess: data.latestSuccess ?? null
      });
    }
  }

  async function pushIdentityBackup(): Promise<void> {
    setError(null);
    setStatus(null);
    setBackupRunning(true);
    setBackupResult(null);
    const response = await fetch("/api/backup/identity/push", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ label: backupLabel })
    });
    const data = (await response.json()) as { snapshotPath?: string; branch?: string; error?: string };
    if (!response.ok) {
      setError(data.error ?? "Identity backup push failed");
      setBackupRunning(false);
      return;
    }
    setBackupResult({ snapshotPath: data.snapshotPath, branch: data.branch });
    setStatus("Identity backup pushed to GitHub branch.");
    await loadBackupStatus();
    setBackupRunning(false);
  }

  return (
    <main style={{ fontFamily: "sans-serif", margin: "2rem auto", maxWidth: 820 }}>
      <h1>Settings</h1>
      <p>Control Nova access, safety, and workspace delegation.</p>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        <Link href="/">Chat</Link>
        <Link href="/dashboard">Dashboard</Link>
        <button type="button" onClick={logout}>
          Logout
        </button>
      </div>
      {loading ? <p>Loading...</p> : null}
      {!loading ? (
        <form onSubmit={save} style={{ display: "grid", gap: 16 }}>
          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Delegated Folder Access</h2>
            <p style={{ marginTop: 0 }}>Nova can execute shell tasks only inside these folders.</p>
            <div style={{ display: "grid", gap: 8 }}>
              {settings.delegatedFolders.map((folder) => (
                <div
                  key={folder}
                  style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}
                >
                  <code style={{ wordBreak: "break-all" }}>{folder}</code>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        delegatedFolders: prev.delegatedFolders.filter((entry) => entry !== folder)
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
              <input
                value={newFolder}
                onChange={(event) => setNewFolder(event.target.value)}
                placeholder="Add folder path"
                style={{ flex: 1, padding: 8 }}
              />
              <button
                type="button"
                onClick={() => {
                  const value = newFolder.trim();
                  if (!value) return;
                  setSettings((prev) => ({
                    ...prev,
                    delegatedFolders: prev.delegatedFolders.includes(value)
                      ? prev.delegatedFolders
                      : [...prev.delegatedFolders, value]
                  }));
                  setNewFolder("");
                }}
              >
                Add
              </button>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Safety Rules</h2>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.requireApprovals}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    requireApprovals: event.target.checked
                  }))
                }
              />
              Require approvals for medium/high-risk shell tasks
            </label>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>WebUI Access</h2>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input
                type="checkbox"
                checked={settings.web.loginEnabled}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    web: { ...prev.web, loginEnabled: event.target.checked }
                  }))
                }
              />
              Enable WebUI login screen
            </label>
            <p style={{ marginBottom: 0, color: "#555" }}>
              If disabled, users are auto-routed to dashboard without login.
            </p>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Channel Phone Access Control</h2>
            <label style={{ display: "grid", gap: 4, marginBottom: 8 }}>
              <span>Nova Phone Number</span>
              <input
                value={settings.messagingAccess.novaPhoneNumber}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    messagingAccess: { ...prev.messagingAccess, novaPhoneNumber: event.target.value }
                  }))
                }
                placeholder="+1234567890"
                style={{ padding: 8 }}
              />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 10 }}>
              <input
                type="checkbox"
                checked={settings.messagingAccess.denyUnknownNumbers}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    messagingAccess: { ...prev.messagingAccess, denyUnknownNumbers: event.target.checked }
                  }))
                }
              />
              Ignore unknown numbers completely (silent mode)
            </label>

            <h3>System Administrators (full control)</h3>
            {settings.messagingAccess.systemAdmins.map((phone) => (
              <div key={phone} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <code>{phone}</code>
                <button
                  type="button"
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      messagingAccess: {
                        ...prev.messagingAccess,
                        systemAdmins: prev.messagingAccess.systemAdmins.filter((item) => item !== phone)
                      }
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={newAdminPhone} onChange={(event) => setNewAdminPhone(event.target.value)} placeholder="+1..." style={{ flex: 1, padding: 8 }} />
              <button
                type="button"
                onClick={() => {
                  const value = newAdminPhone.trim();
                  if (!value) return;
                  setSettings((prev) => ({
                    ...prev,
                    messagingAccess: {
                      ...prev.messagingAccess,
                      systemAdmins: prev.messagingAccess.systemAdmins.includes(value)
                        ? prev.messagingAccess.systemAdmins
                        : [...prev.messagingAccess.systemAdmins, value]
                    }
                  }));
                  setNewAdminPhone("");
                }}
              >
                Add
              </button>
            </div>

            <h3>Guests (chat + image/video generation only)</h3>
            {settings.messagingAccess.guests.map((phone) => (
              <div key={phone} style={{ display: "flex", justifyContent: "space-between", marginBottom: 4 }}>
                <code>{phone}</code>
                <button
                  type="button"
                  onClick={() =>
                    setSettings((prev) => ({
                      ...prev,
                      messagingAccess: {
                        ...prev.messagingAccess,
                        guests: prev.messagingAccess.guests.filter((item) => item !== phone)
                      }
                    }))
                  }
                >
                  Remove
                </button>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8, marginBottom: 10 }}>
              <input value={newGuestPhone} onChange={(event) => setNewGuestPhone(event.target.value)} placeholder="+1..." style={{ flex: 1, padding: 8 }} />
              <button
                type="button"
                onClick={() => {
                  const value = newGuestPhone.trim();
                  if (!value) return;
                  setSettings((prev) => ({
                    ...prev,
                    messagingAccess: {
                      ...prev.messagingAccess,
                      guests: prev.messagingAccess.guests.includes(value)
                        ? prev.messagingAccess.guests
                        : [...prev.messagingAccess.guests, value]
                    }
                  }));
                  setNewGuestPhone("");
                }}
              >
                Add
              </button>
            </div>

            <h3>Important People (custom elevated permissions)</h3>
            {settings.messagingAccess.importantPeople.map((entry) => (
              <div key={entry.phone} style={{ border: "1px solid #eee", borderRadius: 6, padding: 8, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                  <code>{entry.phone}</code>
                  <button
                    type="button"
                    onClick={() =>
                      setSettings((prev) => ({
                        ...prev,
                        messagingAccess: {
                          ...prev.messagingAccess,
                          importantPeople: prev.messagingAccess.importantPeople.filter((item) => item.phone !== entry.phone)
                        }
                      }))
                    }
                  >
                    Remove
                  </button>
                </div>
                <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
                  {(
                    [
                      ["cameraAccess", "Camera access"],
                      ["shellAccess", "Shell access"],
                      ["securityCenterAccess", "Security center"],
                      ["schedulerAccess", "Scheduler access"]
                    ] as const
                  ).map(([key, label]) => (
                    <label key={key} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      <input
                        type="checkbox"
                        checked={entry.permissions[key]}
                        onChange={(event) =>
                          setSettings((prev) => ({
                            ...prev,
                            messagingAccess: {
                              ...prev.messagingAccess,
                              importantPeople: prev.messagingAccess.importantPeople.map((item) =>
                                item.phone === entry.phone
                                  ? { ...item, permissions: { ...item.permissions, [key]: event.target.checked } }
                                  : item
                              )
                            }
                          }))
                        }
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </div>
            ))}
            <div style={{ display: "flex", gap: 8 }}>
              <input
                value={newImportantPhone}
                onChange={(event) => setNewImportantPhone(event.target.value)}
                placeholder="+1..."
                style={{ flex: 1, padding: 8 }}
              />
              <button
                type="button"
                onClick={() => {
                  const value = newImportantPhone.trim();
                  if (!value) return;
                  setSettings((prev) => ({
                    ...prev,
                    messagingAccess: {
                      ...prev.messagingAccess,
                      importantPeople: prev.messagingAccess.importantPeople.some((item) => item.phone === value)
                        ? prev.messagingAccess.importantPeople
                        : [
                            ...prev.messagingAccess.importantPeople,
                            {
                              phone: value,
                              permissions: {
                                cameraAccess: false,
                                shellAccess: false,
                                securityCenterAccess: false,
                                schedulerAccess: false
                              }
                            }
                          ]
                    }
                  }));
                  setNewImportantPhone("");
                }}
              >
                Add
              </button>
            </div>
            <hr style={{ margin: "12px 0" }} />
            <h3>Access Simulator</h3>
            <p style={{ color: "#555", marginTop: 0 }}>
              Test how a phone number would be treated before saving/rolling out.
            </p>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "160px 1fr" }}>
              <select value={simChannel} onChange={(event) => setSimChannel(event.target.value as "whatsapp" | "signal")} style={{ padding: 8 }}>
                <option value="whatsapp">WhatsApp</option>
                <option value="signal">Signal</option>
              </select>
              <input
                value={simPhone}
                onChange={(event) => setSimPhone(event.target.value)}
                placeholder="+15551234567"
                style={{ padding: 8 }}
              />
            </div>
            <input
              value={simText}
              onChange={(event) => setSimText(event.target.value)}
              placeholder="Optional sample message, e.g. /run ipconfig"
              style={{ marginTop: 8, width: "100%", padding: 8 }}
            />
            <button type="button" onClick={() => void runAccessSimulation()} style={{ marginTop: 8 }}>
              Simulate Access
            </button>
            {simResult ? <pre style={{ marginTop: 8 }}>{JSON.stringify(simResult, null, 2)}</pre> : null}
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Model Routing</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Primary Chat Provider</span>
                <select
                  value={settings.activeProvider}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      activeProvider: event.target.value as SettingsState["activeProvider"]
                    }))
                  }
                  style={{ padding: 8 }}
                >
                  <option value="ollama">Ollama</option>
                  <option value="lmstudio">LM Studio</option>
                  <option value="copilot">Copilot-compatible</option>
                </select>
              </label>
              <PriorityEditor
                title="Vision Provider Priority"
                values={settings.visionProviderPriority}
                onMove={(id, direction) =>
                  setSettings((prev) => ({
                    ...prev,
                    visionProviderPriority: moveItem(prev.visionProviderPriority, id, direction)
                  }))
                }
              />
              <PriorityEditor
                title="Media Generation Priority"
                values={settings.mediaProviderPriority}
                onMove={(id, direction) =>
                  setSettings((prev) => ({
                    ...prev,
                    mediaProviderPriority: moveItem(prev.mediaProviderPriority, id, direction)
                  }))
                }
              />
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Shell Execution Limits</h2>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Command Timeout (ms)</span>
                <input
                  type="number"
                  min={1000}
                  value={settings.shell.timeoutMs}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      shell: { ...prev.shell, timeoutMs: Number(event.target.value || 0) }
                    }))
                  }
                  style={{ padding: 8 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Max Output Bytes</span>
                <input
                  type="number"
                  min={8192}
                  value={settings.shell.maxOutputBytes}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      shell: { ...prev.shell, maxOutputBytes: Number(event.target.value || 0) }
                    }))
                  }
                  style={{ padding: 8 }}
                />
              </label>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Skill Runtime</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.skills.isolationEnabled}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      skills: { ...prev.skills, isolationEnabled: event.target.checked }
                    }))
                  }
                />
                Run skills in isolated worker process
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Skill Timeout (ms)</span>
                  <input
                    type="number"
                    min={1000}
                    value={settings.skills.timeoutMs}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        skills: { ...prev.skills, timeoutMs: Number(event.target.value || 0) }
                      }))
                    }
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Skill Memory Limit (MB)</span>
                  <input
                    type="number"
                    min={64}
                    value={settings.skills.maxMemoryMb}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        skills: { ...prev.skills, maxMemoryMb: Number(event.target.value || 0) }
                      }))
                    }
                    style={{ padding: 8 }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Learning Controls</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.learning.enabled}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      learning: { ...prev.learning, enabled: event.target.checked }
                    }))
                  }
                />
                Enable idle-time background learning
              </label>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Idle Minutes</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.learning.idleMinutes}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        learning: { ...prev.learning, idleMinutes: Number(event.target.value || 0) }
                      }))
                    }
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Cycle Interval (ms)</span>
                  <input
                    type="number"
                    min={15000}
                    value={settings.learning.intervalMs}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        learning: { ...prev.learning, intervalMs: Number(event.target.value || 0) }
                      }))
                    }
                    style={{ padding: 8 }}
                  />
                </label>
                <label style={{ display: "grid", gap: 4 }}>
                  <span>Failures Before Auto-Improve</span>
                  <input
                    type="number"
                    min={1}
                    value={settings.learning.minFailuresForAutoImprove}
                    onChange={(event) =>
                      setSettings((prev) => ({
                        ...prev,
                        learning: { ...prev.learning, minFailuresForAutoImprove: Number(event.target.value || 0) }
                      }))
                    }
                    style={{ padding: 8 }}
                  />
                </label>
              </div>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Emotion Core</h2>
            <div style={{ display: "grid", gap: 10 }}>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.emotions.enabled}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      emotions: { ...prev.emotions, enabled: event.target.checked }
                    }))
                  }
                />
                Enable emotional heuristic overlay
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Expression Style</span>
                <select
                  value={settings.emotions.expressionStyle}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      emotions: {
                        ...prev.emotions,
                        expressionStyle: event.target.value as SettingsState["emotions"]["expressionStyle"]
                      }
                    }))
                  }
                  style={{ padding: 8 }}
                >
                  <option value="subtle">Subtle</option>
                  <option value="balanced">Balanced</option>
                  <option value="expressive">Expressive</option>
                </select>
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <input
                  type="checkbox"
                  checked={settings.emotions.mirrorUserValence}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      emotions: { ...prev.emotions, mirrorUserValence: event.target.checked }
                    }))
                  }
                />
                Mirror user valence for empathy alignment
              </label>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button type="button" onClick={() => void loadEmotionSnapshots()}>
                  Refresh Emotion State
                </button>
                <Link href="/emotion">Open Emotion Timeline</Link>
                <small style={{ color: "#555" }}>Runtime snapshots from Nova system/user state</small>
              </div>
              <div style={{ display: "grid", gap: 6 }}>
                <div>
                  <strong>System Emotion:</strong>{" "}
                  {emotionSystem?.state
                    ? `${emotionSystem.state.label} (v=${emotionSystem.state.valence.toFixed(2)}, a=${emotionSystem.state.arousal.toFixed(2)})`
                    : "n/a"}
                </div>
                <div>
                  <strong>Web User Emotion:</strong>{" "}
                  {emotionWebUser?.state
                    ? `${emotionWebUser.state.label} (v=${emotionWebUser.state.valence.toFixed(2)}, a=${emotionWebUser.state.arousal.toFixed(2)})`
                    : "n/a"}
                </div>
              </div>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Full Health</h2>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <HealthDot level={health?.level ?? "orange"} />
              <span>Overall: {health?.level ?? "unknown"}</span>
              <button type="button" onClick={() => void loadHealth()}>
                {healthLoading ? "Refreshing..." : "Refresh"}
              </button>
            </div>
            <div style={{ display: "grid", gap: 8 }}>
              {(health?.checks ?? []).map((check) => (
                <div
                  key={check.id}
                  style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <HealthDot level={check.level} />
                    <strong>{check.name}</strong>
                  </div>
                  <span style={{ color: "#444", textAlign: "right" }}>
                    {check.detail}
                    <br />
                    <small>
                      Last success: {check.lastSuccessfulAt ? new Date(check.lastSuccessfulAt).toLocaleString() : "-"}
                    </small>
                    {check.fingerprint ? (
                      <>
                        <br />
                        <small>Fingerprint: {check.fingerprint}</small>
                      </>
                    ) : null}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Service Restart</h2>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button type="button" onClick={() => void restartService("dispatcher")}>
                Restart Dispatcher
              </button>
              <button type="button" onClick={() => void restartService("scheduler")}>
                Restart Scheduler
              </button>
              <button type="button" onClick={() => void restartService("agent-core")}>
                Restart Agent Core
              </button>
              <button type="button" onClick={() => window.location.reload()}>
                Reload Web UI
              </button>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Identity Backup to GitHub</h2>
            <p style={{ marginTop: 0, color: "#555" }}>
              Runs sanity checks, snapshots Nova core identity artifacts, and pushes a dedicated backup branch.
            </p>
            <label style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <input
                type="checkbox"
                checked={settings.identityBackup.enabled}
                onChange={(event) =>
                  setSettings((prev) => ({
                    ...prev,
                    identityBackup: { ...prev.identityBackup, enabled: event.target.checked }
                  }))
                }
              />
              Enable automatic identity backup
            </label>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 8 }}>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Auto Backup Interval (days)</span>
                <input
                  type="number"
                  min={1}
                  max={30}
                  value={settings.identityBackup.intervalDays}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      identityBackup: {
                        ...prev.identityBackup,
                        intervalDays: Number(event.target.value || 1)
                      }
                    }))
                  }
                  style={{ padding: 8 }}
                />
              </label>
              <label style={{ display: "grid", gap: 4 }}>
                <span>Label Prefix</span>
                <input
                  value={settings.identityBackup.labelPrefix}
                  onChange={(event) =>
                    setSettings((prev) => ({
                      ...prev,
                      identityBackup: {
                        ...prev.identityBackup,
                        labelPrefix: event.target.value
                      }
                    }))
                  }
                  placeholder="nova-core"
                  style={{ padding: 8 }}
                />
              </label>
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 8 }}>
              <input
                value={backupLabel}
                onChange={(event) => setBackupLabel(event.target.value)}
                placeholder="backup label"
                style={{ padding: 8, minWidth: 220 }}
              />
              <button type="button" onClick={() => void pushIdentityBackup()} disabled={backupRunning}>
                {backupRunning ? "Pushing..." : "Push Identity Backup"}
              </button>
            </div>
            {backupResult ? (
              <div style={{ display: "grid", gap: 4 }}>
                <div>
                  <strong>Branch:</strong> <code>{backupResult.branch ?? "-"}</code>
                </div>
                <div>
                  <strong>Snapshot:</strong> <code>{backupResult.snapshotPath ?? "-"}</code>
                </div>
              </div>
            ) : null}
            <div style={{ marginTop: 8, color: "#444" }}>
              <div>
                <strong>Latest Run:</strong>{" "}
                {backupStatus?.latestRun?.createdAt
                  ? `${backupStatus.latestRun.status ?? "unknown"} (${backupStatus.latestRun.mode ?? "unknown"}) at ${new Date(
                      backupStatus.latestRun.createdAt
                    ).toLocaleString()}`
                  : "none"}
              </div>
              {backupStatus?.latestRun?.error ? <div style={{ color: "#b00020" }}>{backupStatus.latestRun.error}</div> : null}
              <div>
                <strong>Latest Success:</strong>{" "}
                {backupStatus?.latestSuccess?.createdAt
                  ? `${new Date(backupStatus.latestSuccess.createdAt).toLocaleString()} on ${backupStatus.latestSuccess.branch ?? "-"}`
                  : "none"}
              </div>
            </div>
          </section>

          <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12 }}>
            <h2>Multi-User Accounts</h2>
            <p style={{ marginTop: 0, color: "#555" }}>Separate users with separate login sessions.</p>
            <div style={{ display: "grid", gap: 8, marginBottom: 10 }}>
              {users.map((user) => (
                <div key={user.id} style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                  <code>{user.email}</code>
                  <span>{new Date(user.createdAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
            <div style={{ display: "grid", gap: 8, gridTemplateColumns: "1fr 1fr auto" }}>
              <input
                type="email"
                placeholder="new user email"
                value={newUserEmail}
                onChange={(event) => setNewUserEmail(event.target.value)}
                style={{ padding: 8 }}
              />
              <input
                type="password"
                placeholder="new user password"
                value={newUserPassword}
                onChange={(event) => setNewUserPassword(event.target.value)}
                style={{ padding: 8 }}
              />
              <button type="button" onClick={() => void createUser()}>
                Add User
              </button>
            </div>
          </section>

          <button type="submit" disabled={saving} style={{ width: 140, padding: "8px 12px" }}>
            {saving ? "Saving..." : "Save Settings"}
          </button>
          {status ? <p style={{ color: "#166534" }}>{status}</p> : null}
          {error ? <p style={{ color: "#b00020" }}>{error}</p> : null}
        </form>
      ) : null}
    </main>
  );
}

function normalizeSettings(value: Partial<SettingsState> | undefined): SettingsState {
  return {
    delegatedFolders: value?.delegatedFolders ?? DEFAULT_SETTINGS.delegatedFolders,
    requireApprovals: value?.requireApprovals ?? DEFAULT_SETTINGS.requireApprovals,
    activeProvider: value?.activeProvider ?? DEFAULT_SETTINGS.activeProvider,
    visionProviderPriority: value?.visionProviderPriority ?? DEFAULT_SETTINGS.visionProviderPriority,
    mediaProviderPriority: value?.mediaProviderPriority ?? DEFAULT_SETTINGS.mediaProviderPriority,
    shell: {
      timeoutMs: value?.shell?.timeoutMs ?? DEFAULT_SETTINGS.shell.timeoutMs,
      maxOutputBytes: value?.shell?.maxOutputBytes ?? DEFAULT_SETTINGS.shell.maxOutputBytes
    },
    skills: {
      isolationEnabled: value?.skills?.isolationEnabled ?? DEFAULT_SETTINGS.skills.isolationEnabled,
      timeoutMs: value?.skills?.timeoutMs ?? DEFAULT_SETTINGS.skills.timeoutMs,
      maxMemoryMb: value?.skills?.maxMemoryMb ?? DEFAULT_SETTINGS.skills.maxMemoryMb
    },
    web: {
      loginEnabled: value?.web?.loginEnabled ?? DEFAULT_SETTINGS.web.loginEnabled
    },
    learning: {
      enabled: value?.learning?.enabled ?? DEFAULT_SETTINGS.learning.enabled,
      idleMinutes: value?.learning?.idleMinutes ?? DEFAULT_SETTINGS.learning.idleMinutes,
      intervalMs: value?.learning?.intervalMs ?? DEFAULT_SETTINGS.learning.intervalMs,
      minFailuresForAutoImprove:
        value?.learning?.minFailuresForAutoImprove ?? DEFAULT_SETTINGS.learning.minFailuresForAutoImprove
    },
    messagingAccess: {
      novaPhoneNumber: value?.messagingAccess?.novaPhoneNumber ?? DEFAULT_SETTINGS.messagingAccess.novaPhoneNumber,
      denyUnknownNumbers: value?.messagingAccess?.denyUnknownNumbers ?? DEFAULT_SETTINGS.messagingAccess.denyUnknownNumbers,
      systemAdmins: value?.messagingAccess?.systemAdmins ?? DEFAULT_SETTINGS.messagingAccess.systemAdmins,
      guests: value?.messagingAccess?.guests ?? DEFAULT_SETTINGS.messagingAccess.guests,
      importantPeople: value?.messagingAccess?.importantPeople ?? DEFAULT_SETTINGS.messagingAccess.importantPeople
    },
    emotions: {
      enabled: value?.emotions?.enabled ?? DEFAULT_SETTINGS.emotions.enabled,
      expressionStyle: value?.emotions?.expressionStyle ?? DEFAULT_SETTINGS.emotions.expressionStyle,
      mirrorUserValence: value?.emotions?.mirrorUserValence ?? DEFAULT_SETTINGS.emotions.mirrorUserValence
    },
    identityBackup: {
      enabled: value?.identityBackup?.enabled ?? DEFAULT_SETTINGS.identityBackup.enabled,
      intervalDays: value?.identityBackup?.intervalDays ?? DEFAULT_SETTINGS.identityBackup.intervalDays,
      labelPrefix: value?.identityBackup?.labelPrefix ?? DEFAULT_SETTINGS.identityBackup.labelPrefix
    }
  };
}

function PriorityEditor({
  title,
  values,
  onMove
}: {
  title: string;
  values: string[];
  onMove: (value: string, direction: -1 | 1) => void;
}) {
  return (
    <div style={{ display: "grid", gap: 6 }}>
      <strong>{title}</strong>
      {values.map((value, index) => (
        <div key={value} style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <code style={{ minWidth: 140 }}>{value}</code>
          <button type="button" disabled={index === 0} onClick={() => onMove(value, -1)}>
            Up
          </button>
          <button type="button" disabled={index === values.length - 1} onClick={() => onMove(value, 1)}>
            Down
          </button>
        </div>
      ))}
    </div>
  );
}

function moveItem<T extends string>(values: T[], id: string, direction: -1 | 1): T[] {
  const current = values.findIndex((value) => value === id);
  if (current < 0) return values;
  const target = current + direction;
  if (target < 0 || target >= values.length) return values;
  const copy = [...values];
  const [item] = copy.splice(current, 1);
  copy.splice(target, 0, item);
  return copy;
}

function HealthDot({ level }: { level: "green" | "orange" | "red" }) {
  const color = level === "green" ? "#16a34a" : level === "orange" ? "#f59e0b" : "#dc2626";
  return (
    <span
      style={{
        width: 10,
        height: 10,
        borderRadius: "50%",
        display: "inline-block",
        background: color
      }}
    />
  );
}
