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
    /** When true, chat cannot trigger automatic skill authoring (same idea as NOVA_SKILL_AUTHORING_DISABLED). */
    skillAuthoringDisabled: boolean;
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
    /** When true, chat sends the composer after this many seconds with no new dictated text (voice). */
    voiceDictationAutoSend: boolean;
    /** Silence window before auto-send, seconds (1–4). */
    voiceDictationSilenceSec: number;
    /** After read-aloud / TTS finishes, start voice input automatically for back-and-forth. */
    voiceContinuousConversation: boolean;
    /** Chat read-aloud (TTS) default — persisted so it survives browser data loss. */
    readAloudMessages: boolean;
    /** Show model thinking / reasoning blocks in the chat thread. */
    showThinkingInChat: boolean;
    /** Global UI text scale (mirrors `data-text-scale` on `<html>`). */
    textScale: "normal" | "medium" | "big";
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
    channelTiers: {
      /**
       * Signal tier rows may carry an optional Signal `sourceUuid` (sealed-sender) — when present,
       * sealed-sender messages from this UUID are matched against this row even though the phone number
       * is hidden on the wire. Auto-populated on the first non-sealed message from a known phone.
       */
      signal: Array<{
        phone: string;
        signalUuid?: string;
        /** Display label in admin UIs (optional). */
        name?: string;
        tier: "admin" | "co_admin" | "restricted" | "guest";
      }>;
      whatsapp: Array<{ phone: string; name?: string; tier: "admin" | "co_admin" | "restricted" | "guest" }>;
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
  emotions: {
    enabled: boolean;
    expressionStyle: "subtle" | "balanced" | "expressive";
    mirrorUserValence: boolean;
  };
  identityBackup: {
    enabled: boolean;
    intervalDays: number;
    labelPrefix: string;
    /** Git remote name for `git push` (e.g. `identity-private` → private repo); default `origin`. */
    gitRemote: string;
  };
  /** Optional [MemoryBear](https://github.com/SuanmoSuanyangTechnology/MemoryBear) HTTP API (`/v1/...`) for long-term memory. */
  memoryBear: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    searchSwitch: "0" | "1" | "2";
    storageType: "neo4j" | "rag";
    /** When true, each chat turn is written to MemoryBear after the reply is stored locally. */
    syncWrites: boolean;
  };
  /** Optional [SentiCore](https://github.com/chuchuyei/SentiCore) orchestration markdown injected into chat (prompt-aligned). */
  sentiCore: {
    enabled: boolean;
    orchestrationMarkdownPath: string;
  };
  /** Optional [Orpheus-FastAPI](https://github.com/Lex-au/Orpheus-FastAPI) OpenAI-compatible `POST /v1/audio/speech`. */
  orpheusTts: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    voice: string;
    model: string;
    responseFormat: "mp3" | "wav" | "opus" | "pcm" | "flac";
  };
  models: {
    defaultByProvider: {
      ollama: string;
      lmstudio: string;
      copilot: string;
    };
    /** When true, Ollama `/api/chat` sends `think: true` (native reasoning traces). Default false avoids empty `content` on Gemma 4 / thinking models. */
    ollamaThinkingEnabled: boolean;
  };
  ollama: {
    /** When true (default), Ollama is excluded from routing and health pings. */
    disabled: boolean;
    /** Ollama `num_predict` (max new tokens per reply). `-1` lets Ollama/model use its default. */
    numPredict: number;
    /** Ollama `keep_alive` (e.g. `30m`, `5m`, `0`). */
    keepAlive: string;
  };
  lmstudio: {
    /** When true (default), LM Studio is excluded from routing and health pings. */
    disabled: boolean;
  };
  copilot: {
    baseUrl: string;
    apiKey: string;
    defaultModel: string;
    /** When true, Nova never routes chat to Copilot (router + catalog skip). */
    disabled: boolean;
  };
  /** Image/video understanding (separate from chat defaults). Remote base URLs delegate to another host. */
  vision: {
    ollamaModel: string;
    ollamaBaseUrl: string;
    lmstudioModel: string;
    lmstudioBaseUrl: string;
    cloudModel: string;
    cloudBaseUrl: string;
    cloudApiKey: string;
    /** When true and chat uses local Ollama, unload the chat model before vision, then unload the vision model after. */
    swapLocalModelsForVision: boolean;
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
      const visionCloudKeyRaw = typeof parsed.vision?.cloudApiKey === "string" ? parsed.vision.cloudApiKey : "";
      const visionCloudApiKey = visionCloudKeyRaw.startsWith("enc:v1:")
        ? decryptValue(visionCloudKeyRaw) ?? ""
        : visionCloudKeyRaw;
      const memoryBearApiKeyRaw = typeof parsed.memoryBear?.apiKey === "string" ? parsed.memoryBear.apiKey : "";
      const memoryBearApiKey = memoryBearApiKeyRaw.startsWith("enc:v1:")
        ? decryptValue(memoryBearApiKeyRaw) ?? ""
        : memoryBearApiKeyRaw;
      const orpheusApiKeyRaw = typeof parsed.orpheusTts?.apiKey === "string" ? parsed.orpheusTts.apiKey : "";
      const orpheusTtsApiKey = orpheusApiKeyRaw.startsWith("enc:v1:")
        ? decryptValue(orpheusApiKeyRaw) ?? ""
        : orpheusApiKeyRaw;
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
          maxMemoryMb: Number(parsed.skills?.maxMemoryMb ?? 0),
          skillAuthoringDisabled: parsed.skills?.skillAuthoringDisabled === true
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
          sendOnEnter: parsed.web?.sendOnEnter === true,
          voiceDictationAutoSend: parsed.web?.voiceDictationAutoSend === true,
          voiceDictationSilenceSec: (() => {
            const n = Number(parsed.web?.voiceDictationSilenceSec);
            if (!Number.isFinite(n)) return 2;
            return Math.min(4, Math.max(1, n));
          })(),
          voiceContinuousConversation: parsed.web?.voiceContinuousConversation === true,
          readAloudMessages: parsed.web?.readAloudMessages === true,
          showThinkingInChat: parsed.web?.showThinkingInChat !== false,
          textScale:
            parsed.web?.textScale === "medium" || parsed.web?.textScale === "big" || parsed.web?.textScale === "normal"
              ? parsed.web.textScale
              : "normal"
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
          channelTiers: {
            signal: Array.isArray(parsed.messagingAccess?.channelTiers?.signal)
              ? parsed.messagingAccess.channelTiers.signal
                  .filter((item) => typeof item?.phone === "string")
                  .map((item) => {
                    const row: {
                      phone: string;
                      signalUuid?: string;
                      name?: string;
                      tier: "admin" | "co_admin" | "restricted" | "guest";
                    } = {
                      phone: String(item.phone),
                      tier:
                        item.tier === "admin" || item.tier === "co_admin" || item.tier === "restricted" || item.tier === "guest"
                          ? item.tier
                          : "guest"
                    };
                    if (typeof item.signalUuid === "string" && item.signalUuid.trim().length > 0) {
                      row.signalUuid = String(item.signalUuid).trim().toLowerCase();
                    }
                    if (typeof item.name === "string" && item.name.trim().length > 0) {
                      row.name = item.name.trim();
                    }
                    return row;
                  })
              : [],
            whatsapp: Array.isArray(parsed.messagingAccess?.channelTiers?.whatsapp)
              ? parsed.messagingAccess.channelTiers.whatsapp
                  .filter((item) => typeof item?.phone === "string")
                  .map((item) => {
                    const row: { phone: string; name?: string; tier: "admin" | "co_admin" | "restricted" | "guest" } = {
                      phone: String(item.phone),
                      tier:
                        item.tier === "admin" || item.tier === "co_admin" || item.tier === "restricted" || item.tier === "guest"
                          ? item.tier
                          : "guest"
                    };
                    if (typeof item.name === "string" && item.name.trim().length > 0) {
                      row.name = item.name.trim();
                    }
                    return row;
                  })
              : []
          },
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
          enabled: parsed.emotions?.enabled === false ? false : true,
          expressionStyle:
            parsed.emotions?.expressionStyle === "subtle" || parsed.emotions?.expressionStyle === "expressive"
              ? parsed.emotions.expressionStyle
              : "balanced",
          mirrorUserValence: parsed.emotions?.mirrorUserValence === true
        },
        identityBackup: {
          enabled: parsed.identityBackup?.enabled === true,
          intervalDays: Number(parsed.identityBackup?.intervalDays ?? 0),
          labelPrefix: typeof parsed.identityBackup?.labelPrefix === "string" ? parsed.identityBackup.labelPrefix : "nova-core",
          gitRemote: normalizeStoredIdentityBackupGitRemote(parsed.identityBackup?.gitRemote)
        },
        memoryBear: {
          enabled: parsed.memoryBear?.enabled === false ? false : true,
          baseUrl: typeof parsed.memoryBear?.baseUrl === "string" ? parsed.memoryBear.baseUrl.trim() : "",
          apiKey: memoryBearApiKey,
          searchSwitch:
            parsed.memoryBear?.searchSwitch === "0" || parsed.memoryBear?.searchSwitch === "1"
              ? parsed.memoryBear.searchSwitch
              : "2",
          storageType: parsed.memoryBear?.storageType === "rag" ? "rag" : "neo4j",
          syncWrites: parsed.memoryBear?.syncWrites === true
        },
        sentiCore: {
          enabled: parsed.sentiCore?.enabled === true,
          orchestrationMarkdownPath:
            typeof parsed.sentiCore?.orchestrationMarkdownPath === "string"
              ? parsed.sentiCore.orchestrationMarkdownPath.trim().slice(0, 2048)
              : ""
        },
        orpheusTts: {
          enabled: parsed.orpheusTts?.enabled === false ? false : true,
          baseUrl: typeof parsed.orpheusTts?.baseUrl === "string" ? parsed.orpheusTts.baseUrl.trim() : "",
          apiKey: orpheusTtsApiKey,
          voice:
            (typeof parsed.orpheusTts?.voice === "string" ? parsed.orpheusTts.voice.trim().slice(0, 128) : "") || "tara",
          model: typeof parsed.orpheusTts?.model === "string" ? parsed.orpheusTts.model.trim().slice(0, 128) : "",
          responseFormat: normalizeOrpheusFormat(parsed.orpheusTts?.responseFormat)
        },
        models: {
          defaultByProvider: {
            ollama: typeof parsed.models?.defaultByProvider?.ollama === "string" ? parsed.models.defaultByProvider.ollama : "",
            lmstudio:
              typeof parsed.models?.defaultByProvider?.lmstudio === "string" ? parsed.models.defaultByProvider.lmstudio : "",
            copilot:
              typeof parsed.models?.defaultByProvider?.copilot === "string" ? parsed.models.defaultByProvider.copilot : ""
          },
          ollamaThinkingEnabled: parsed.models?.ollamaThinkingEnabled === true
        },
        ollama: {
          disabled: parsed.ollama?.disabled !== false,
          numPredict:
            typeof parsed.ollama?.numPredict === "number" && Number.isFinite(parsed.ollama.numPredict)
              ? Math.trunc(parsed.ollama.numPredict)
              : 8192,
          keepAlive:
            typeof parsed.ollama?.keepAlive === "string" && parsed.ollama.keepAlive.trim().length > 0
              ? parsed.ollama.keepAlive.trim().slice(0, 32)
              : "30m"
        },
        lmstudio: {
          disabled: parsed.lmstudio?.disabled !== false
        },
        copilot: {
          baseUrl: typeof parsed.copilot?.baseUrl === "string" ? parsed.copilot.baseUrl : "",
          apiKey: copilotApiKey,
          defaultModel: typeof parsed.copilot?.defaultModel === "string" ? parsed.copilot.defaultModel : "",
          disabled: parsed.copilot?.disabled === true
        },
        vision: {
          ollamaModel: typeof parsed.vision?.ollamaModel === "string" ? parsed.vision.ollamaModel : "",
          ollamaBaseUrl: typeof parsed.vision?.ollamaBaseUrl === "string" ? parsed.vision.ollamaBaseUrl : "",
          lmstudioModel: typeof parsed.vision?.lmstudioModel === "string" ? parsed.vision.lmstudioModel : "",
          lmstudioBaseUrl: typeof parsed.vision?.lmstudioBaseUrl === "string" ? parsed.vision.lmstudioBaseUrl : "",
          cloudModel: typeof parsed.vision?.cloudModel === "string" ? parsed.vision.cloudModel : "",
          cloudBaseUrl: typeof parsed.vision?.cloudBaseUrl === "string" ? parsed.vision.cloudBaseUrl : "",
          cloudApiKey: visionCloudApiKey,
          swapLocalModelsForVision: parsed.vision?.swapLocalModelsForVision === true
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
      },
      vision: {
        ...settings.vision,
        cloudApiKey: settings.vision.cloudApiKey ? encryptValue(settings.vision.cloudApiKey) : ""
      },
      memoryBear: {
        ...settings.memoryBear,
        apiKey: settings.memoryBear.apiKey ? encryptValue(settings.memoryBear.apiKey) : ""
      },
      orpheusTts: {
        ...settings.orpheusTts,
        apiKey: settings.orpheusTts.apiKey ? encryptValue(settings.orpheusTts.apiKey) : ""
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

function normalizeStoredIdentityBackupGitRemote(value: unknown): string {
  if (typeof value !== "string") return "origin";
  const t = value.trim();
  if (!t || t.length > 128 || !/^[A-Za-z0-9._-]+$/.test(t)) return "origin";
  return t;
}

function normalizeOrpheusFormat(raw: unknown): AppSettings["orpheusTts"]["responseFormat"] {
  const s = typeof raw === "string" ? raw.trim().toLowerCase() : "";
  if (s === "mp3") return "mp3";
  if (s === "wav" || s === "opus" || s === "pcm" || s === "flac") {
    return s as AppSettings["orpheusTts"]["responseFormat"];
  }
  return "wav";
}
