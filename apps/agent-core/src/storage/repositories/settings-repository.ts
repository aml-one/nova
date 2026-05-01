import { getDatabase } from "../sqlite.js";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

export type AppSettings = {
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
    hideProviderModelInStats: boolean;
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
    sendOnEnter: boolean;
  };
  learning: {
    enabled: boolean;
    idleMinutes: number;
    intervalMs: number;
    minFailuresForAutoImprove: number;
  };
  costGovernor: {
    enabled: boolean;
    dailyBudgetUsd: number;
    qualityTier: "high" | "balanced" | "economy";
    providerPricing: {
      ollamaPer1k: number;
      lmstudioPer1k: number;
      copilotPer1k: number;
    };
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
  models: {
    defaultByProvider: {
      ollama: string;
      lmstudio: string;
      copilot: string;
    };
  };
  copilot: {
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    /** When true, Nova never routes chat to Copilot (router + catalog skip). */
    disabled: boolean;
  };
  updates: {
    enabled: boolean;
    checkIntervalMs: number;
    repoOwner: string;
    repoName: string;
    channel: "stable" | "beta";
    autoApply: boolean;
  };
  offlineMode: {
    enabled: boolean;
  };
  skillSettings: Record<string, Record<string, unknown>>;
};

const SETTINGS_KEY = "app_settings";

export class SettingsRepository {
  get(): AppSettings | undefined {
    const db = getDatabase();
    const row = db.prepare("SELECT value FROM app_settings WHERE key = ? LIMIT 1").get(SETTINGS_KEY) as
      | { value?: string }
      | undefined;
    if (!row?.value) {
      return undefined;
    }
    try {
      const parsed = JSON.parse(row.value) as Partial<AppSettings>;
      const copilotApiKeyRaw = typeof parsed.copilot?.apiKey === "string" ? parsed.copilot.apiKey : "";
      const copilotApiKey = copilotApiKeyRaw.startsWith("enc:v1:")
        ? decryptValue(copilotApiKeyRaw) ?? ""
        : copilotApiKeyRaw;
      return {
        delegatedFolders: Array.isArray(parsed.delegatedFolders)
          ? parsed.delegatedFolders.filter((entry): entry is string => typeof entry === "string")
          : [],
        requireApprovals: parsed.requireApprovals === true,
        activeProvider: parsed.activeProvider === "lmstudio" || parsed.activeProvider === "copilot" ? parsed.activeProvider : "ollama",
        visionProviderPriority: Array.isArray(parsed.visionProviderPriority)
          ? parsed.visionProviderPriority.filter(
              (entry): entry is "lmstudio" | "ollama" | "cloud" =>
                entry === "lmstudio" || entry === "ollama" || entry === "cloud"
            )
          : [],
        mediaProviderPriority: Array.isArray(parsed.mediaProviderPriority)
          ? parsed.mediaProviderPriority.filter((entry): entry is "comfyui" | "cloud" => entry === "comfyui" || entry === "cloud")
          : [],
        shell: {
          timeoutMs: Number(parsed.shell?.timeoutMs ?? 0),
          maxOutputBytes: Number(parsed.shell?.maxOutputBytes ?? 0)
        },
        skills: {
          isolationEnabled: parsed.skills?.isolationEnabled === true,
          timeoutMs: Number(parsed.skills?.timeoutMs ?? 0),
          maxMemoryMb: Number(parsed.skills?.maxMemoryMb ?? 0)
        },
        web: {
          loginEnabled: parsed.web?.loginEnabled !== false,
          hideProviderModelInStats: parsed.web?.hideProviderModelInStats === true,
          chatStyle: {
            userBubbleColor:
              typeof parsed.web?.chatStyle?.userBubbleColor === "string" ? parsed.web.chatStyle.userBubbleColor : "#dbeafe",
            assistantBubbleColor:
              typeof parsed.web?.chatStyle?.assistantBubbleColor === "string"
                ? parsed.web.chatStyle.assistantBubbleColor
                : "#e9d5ff",
            userTextColor:
              typeof parsed.web?.chatStyle?.userTextColor === "string" ? parsed.web.chatStyle.userTextColor : "#0f172a",
            assistantTextColor:
              typeof parsed.web?.chatStyle?.assistantTextColor === "string"
                ? parsed.web.chatStyle.assistantTextColor
                : "#0f172a",
            userActionIconColor:
              typeof parsed.web?.chatStyle?.userActionIconColor === "string"
                ? parsed.web.chatStyle.userActionIconColor
                : "#475569",
            assistantActionIconColor:
              typeof parsed.web?.chatStyle?.assistantActionIconColor === "string"
                ? parsed.web.chatStyle.assistantActionIconColor
                : "#475569",
            statsTextColor:
              typeof parsed.web?.chatStyle?.statsTextColor === "string"
                ? parsed.web.chatStyle.statsTextColor
                : "#64748b",
            userBubbleColorLight:
              typeof parsed.web?.chatStyle?.userBubbleColorLight === "string"
                ? parsed.web.chatStyle.userBubbleColorLight
                : "#dbeafe",
            assistantBubbleColorLight:
              typeof parsed.web?.chatStyle?.assistantBubbleColorLight === "string"
                ? parsed.web.chatStyle.assistantBubbleColorLight
                : "#f5f3ff",
            userTextColorLight:
              typeof parsed.web?.chatStyle?.userTextColorLight === "string"
                ? parsed.web.chatStyle.userTextColorLight
                : "#0f172a",
            assistantTextColorLight:
              typeof parsed.web?.chatStyle?.assistantTextColorLight === "string"
                ? parsed.web.chatStyle.assistantTextColorLight
                : "#0f172a",
            userActionIconColorLight:
              typeof parsed.web?.chatStyle?.userActionIconColorLight === "string"
                ? parsed.web.chatStyle.userActionIconColorLight
                : "#475569",
            assistantActionIconColorLight:
              typeof parsed.web?.chatStyle?.assistantActionIconColorLight === "string"
                ? parsed.web.chatStyle.assistantActionIconColorLight
                : "#475569",
            statsTextColorLight:
              typeof parsed.web?.chatStyle?.statsTextColorLight === "string"
                ? parsed.web.chatStyle.statsTextColorLight
                : "#475569",
            bubbleBackgroundEnabled: parsed.web?.chatStyle?.bubbleBackgroundEnabled !== false,
            borderColor:
              typeof parsed.web?.chatStyle?.borderColor === "string" ? parsed.web.chatStyle.borderColor : "#94a3b8",
            borderThicknessPx: Number(parsed.web?.chatStyle?.borderThicknessPx ?? 1),
            userBorderThicknessPx: Number(parsed.web?.chatStyle?.userBorderThicknessPx ?? parsed.web?.chatStyle?.borderThicknessPx ?? 1),
            assistantBorderThicknessPx: Number(parsed.web?.chatStyle?.assistantBorderThicknessPx ?? parsed.web?.chatStyle?.borderThicknessPx ?? 1),
            userBackgroundOpacityPct: Number(parsed.web?.chatStyle?.userBackgroundOpacityPct ?? (parsed.web?.chatStyle?.bubbleBackgroundEnabled !== false ? 100 : 0)),
            assistantBackgroundOpacityPct: Number(parsed.web?.chatStyle?.assistantBackgroundOpacityPct ?? (parsed.web?.chatStyle?.bubbleBackgroundEnabled !== false ? 100 : 0)),
            bubbleRadiusPx: Number(parsed.web?.chatStyle?.bubbleRadiusPx ?? 16),
            showNames: parsed.web?.chatStyle?.showNames !== false
          },
          sendOnEnter: parsed.web?.sendOnEnter === true
        },
        learning: {
          enabled: parsed.learning?.enabled === true,
          idleMinutes: Number(parsed.learning?.idleMinutes ?? 0),
          intervalMs: Number(parsed.learning?.intervalMs ?? 0),
          minFailuresForAutoImprove: Number(parsed.learning?.minFailuresForAutoImprove ?? 0)
        },
        costGovernor: {
          enabled: parsed.costGovernor?.enabled === true,
          dailyBudgetUsd: Number(parsed.costGovernor?.dailyBudgetUsd ?? 0),
          qualityTier:
            parsed.costGovernor?.qualityTier === "high" || parsed.costGovernor?.qualityTier === "economy"
              ? parsed.costGovernor.qualityTier
              : "balanced",
          providerPricing: {
            ollamaPer1k: Number(parsed.costGovernor?.providerPricing?.ollamaPer1k ?? 0),
            lmstudioPer1k: Number(parsed.costGovernor?.providerPricing?.lmstudioPer1k ?? 0),
            copilotPer1k: Number(parsed.costGovernor?.providerPricing?.copilotPer1k ?? 0)
          }
        },
        messagingAccess: {
          novaPhoneNumber: typeof parsed.messagingAccess?.novaPhoneNumber === "string" ? parsed.messagingAccess.novaPhoneNumber : "",
          denyUnknownNumbers: parsed.messagingAccess?.denyUnknownNumbers !== false,
          systemAdmins: Array.isArray(parsed.messagingAccess?.systemAdmins)
            ? parsed.messagingAccess?.systemAdmins.filter((item): item is string => typeof item === "string")
            : [],
          guests: Array.isArray(parsed.messagingAccess?.guests)
            ? parsed.messagingAccess?.guests.filter((item): item is string => typeof item === "string")
            : [],
          importantPeople: Array.isArray(parsed.messagingAccess?.importantPeople)
            ? parsed.messagingAccess.importantPeople
                .filter((item) => typeof item?.phone === "string")
                .map((item) => ({
                  phone: String(item.phone),
                  permissions: {
                    cameraAccess: (item as { permissions?: Record<string, unknown> }).permissions?.cameraAccess === true,
                    shellAccess: (item as { permissions?: Record<string, unknown> }).permissions?.shellAccess === true,
                    securityCenterAccess:
                      (item as { permissions?: Record<string, unknown> }).permissions?.securityCenterAccess === true,
                    schedulerAccess: (item as { permissions?: Record<string, unknown> }).permissions?.schedulerAccess === true
                  }
                }))
            : []
        },
        emotions: {
          enabled: parsed.emotions?.enabled === true,
          expressionStyle:
            parsed.emotions?.expressionStyle === "subtle" || parsed.emotions?.expressionStyle === "expressive"
              ? parsed.emotions.expressionStyle
              : "balanced",
          mirrorUserValence: parsed.emotions?.mirrorUserValence === true
        },
        identityBackup: {
          enabled: parsed.identityBackup?.enabled === true,
          intervalDays: Number(parsed.identityBackup?.intervalDays ?? 0),
          labelPrefix: typeof parsed.identityBackup?.labelPrefix === "string" ? parsed.identityBackup.labelPrefix : "nova-core"
        },
        models: {
          defaultByProvider: {
            ollama: typeof parsed.models?.defaultByProvider?.ollama === "string" ? parsed.models.defaultByProvider.ollama : "",
            lmstudio:
              typeof parsed.models?.defaultByProvider?.lmstudio === "string" ? parsed.models.defaultByProvider.lmstudio : "",
            copilot:
              typeof parsed.models?.defaultByProvider?.copilot === "string" ? parsed.models.defaultByProvider.copilot : ""
          }
        },
        copilot: {
          baseUrl: typeof parsed.copilot?.baseUrl === "string" ? parsed.copilot.baseUrl : "",
          apiKey: copilotApiKey,
          defaultModel: typeof parsed.copilot?.defaultModel === "string" ? parsed.copilot.defaultModel : "",
          disabled: parsed.copilot?.disabled === true
        },
        updates: {
          enabled: parsed.updates?.enabled === true,
          checkIntervalMs: Number(parsed.updates?.checkIntervalMs ?? 0),
          repoOwner: typeof parsed.updates?.repoOwner === "string" ? parsed.updates.repoOwner : "",
          repoName: typeof parsed.updates?.repoName === "string" ? parsed.updates.repoName : "",
          channel: parsed.updates?.channel === "beta" ? "beta" : "stable",
          autoApply: parsed.updates?.autoApply === true
        },
        offlineMode: {
          enabled: parsed.offlineMode?.enabled === true
        },
        skillSettings:
          parsed.skillSettings && typeof parsed.skillSettings === "object"
            ? (parsed.skillSettings as Record<string, Record<string, unknown>>)
            : {}
      };
    } catch {
      return undefined;
    }
  }

  upsert(settings: AppSettings): void {
    const db = getDatabase();
    const toStore: AppSettings = {
      ...settings,
      copilot: {
        ...settings.copilot,
        apiKey: settings.copilot.apiKey ? encryptValue(settings.copilot.apiKey) : ""
      }
    };
    db.prepare(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
      `
    ).run(SETTINGS_KEY, JSON.stringify(toStore));
  }
}

function encryptValue(value: string): string {
  const key = getEncryptionKey();
  if (!key) return value;
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `enc:v1:${iv.toString("base64")}:${authTag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptValue(payload: string): string | undefined {
  const key = getEncryptionKey();
  if (!key) return undefined;
  const parts = payload.split(":");
  if (parts.length !== 5) return undefined;
  try {
    const iv = Buffer.from(parts[2], "base64");
    const authTag = Buffer.from(parts[3], "base64");
    const encrypted = Buffer.from(parts[4], "base64");
    const decipher = createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    return decrypted.toString("utf8");
  } catch {
    return undefined;
  }
}

function getEncryptionKey(): Buffer | undefined {
  const secret = process.env.NOVA_SETTINGS_SECRET?.trim();
  if (!secret) return undefined;
  return createHash("sha256").update(secret).digest();
}
