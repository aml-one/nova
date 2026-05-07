import { resolve as resolvePath } from "node:path";
import { SettingsRepository, type AppSettings } from "../storage/repositories/settings-repository.js";

const DEFAULT_SETTINGS: AppSettings = {
  delegatedFolders: [resolvePath(process.cwd())],
  requireApprovals: process.env.NOVA_REQUIRE_APPROVALS === "true",
  activeProvider: (process.env.NOVA_PROVIDER as "ollama" | "lmstudio" | "copilot" | undefined) ?? "copilot",
  visionProviderPriority: parseVisionPriority(process.env.NOVA_VISION_PROVIDER_PRIORITY),
  mediaProviderPriority: parseMediaPriority(process.env.NOVA_MEDIA_PROVIDER_PRIORITY),
  shell: {
    timeoutMs: Number(process.env.NOVA_SHELL_TIMEOUT_MS ?? "30000"),
    maxOutputBytes: Number(process.env.NOVA_SHELL_MAX_OUTPUT_BYTES ?? String(1024 * 1024))
  },
  skills: {
    isolationEnabled: process.env.NOVA_SKILL_ISOLATION === "true",
    timeoutMs: Number(process.env.NOVA_SKILL_TIMEOUT_MS ?? "15000"),
    maxMemoryMb: Number(process.env.NOVA_SKILL_MAX_MB ?? "256"),
    skillAuthoringDisabled: process.env.NOVA_SKILL_AUTHORING_DISABLED === "true"
  },
  web: {
    loginEnabled: true,
    hideProviderModelInStats: false,
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
    },
    sendOnEnter: false,
    voiceDictationAutoSend: false,
    voiceDictationSilenceSec: 2,
    voiceContinuousConversation: false,
    readAloudMessages: false,
    showThinkingInChat: true,
    textScale: "normal"
  },
  learning: {
    enabled: process.env.NOVA_LEARNING_ENABLED === "true" || process.env.NOVA_LEARNING_ENABLED === undefined,
    idleMinutes: Number(process.env.NOVA_LEARNING_IDLE_MINUTES ?? "3"),
    intervalMs: Number(process.env.NOVA_LEARNING_INTERVAL_MS ?? "120000"),
    minFailuresForAutoImprove: Number(process.env.NOVA_LEARNING_MIN_FAILURES ?? "2")
  },
  costGovernor: {
    enabled: process.env.NOVA_COST_GOVERNOR_ENABLED === "true",
    dailyBudgetUsd: Number(process.env.NOVA_COST_GOVERNOR_DAILY_BUDGET_USD ?? "5"),
    qualityTier:
      process.env.NOVA_COST_GOVERNOR_QUALITY_TIER === "high" || process.env.NOVA_COST_GOVERNOR_QUALITY_TIER === "economy"
        ? process.env.NOVA_COST_GOVERNOR_QUALITY_TIER
        : "balanced",
    providerPricing: {
      ollamaPer1k: Number(process.env.NOVA_COST_OLLAMA_PER_1K ?? "0.0002"),
      lmstudioPer1k: Number(process.env.NOVA_COST_LMSTUDIO_PER_1K ?? "0.001"),
      copilotPer1k: Number(process.env.NOVA_COST_COPILOT_PER_1K ?? "0.008")
    }
  },
  messagingAccess: {
    novaPhoneNumber: process.env.NOVA_PHONE_NUMBER ?? "",
    denyUnknownNumbers: true,
    channelTiers: {
      signal: [],
      whatsapp: []
    },
    systemAdmins: [],
    guests: [],
    importantPeople: []
  },
  emotions: {
    enabled: process.env.NOVA_EMOTIONS_ENABLED !== "false",
    expressionStyle:
      process.env.NOVA_EMOTIONS_STYLE === "subtle" || process.env.NOVA_EMOTIONS_STYLE === "expressive"
        ? process.env.NOVA_EMOTIONS_STYLE
        : "balanced",
    mirrorUserValence: process.env.NOVA_EMOTIONS_MIRROR_USER_VALENCE === "true"
  },
  identityBackup: {
    enabled: process.env.NOVA_IDENTITY_BACKUP_ENABLED === "true",
    intervalDays: Number(process.env.NOVA_IDENTITY_BACKUP_INTERVAL_DAYS ?? "1"),
    labelPrefix: process.env.NOVA_IDENTITY_BACKUP_LABEL_PREFIX ?? "nova-core",
    gitRemote: normalizeIdentityBackupGitRemote(process.env.NOVA_IDENTITY_BACKUP_GIT_REMOTE)
  },
  models: {
    defaultByProvider: {
      ollama: process.env.OLLAMA_MODEL ?? "",
      lmstudio: process.env.LMSTUDIO_MODEL ?? "",
      copilot: process.env.COPILOT_MODEL ?? ""
    },
    ollamaThinkingEnabled:
      process.env.NOVA_OLLAMA_THINK?.trim().toLowerCase() === "true" || process.env.NOVA_OLLAMA_THINK?.trim() === "1"
  },
  ollama: {
    disabled: process.env.NOVA_OLLAMA_DISABLED === "false" ? false : true,
    numPredict: defaultOllamaNumPredictFromEnv(),
    keepAlive: process.env.NOVA_OLLAMA_KEEP_ALIVE?.trim() || "30m"
  },
  lmstudio: {
    disabled: process.env.NOVA_LMSTUDIO_DISABLED === "false" ? false : true
  },
  copilot: {
    baseUrl: process.env.COPILOT_BASE_URL ?? "",
    apiKey: process.env.COPILOT_API_KEY ?? "",
    defaultModel: process.env.COPILOT_MODEL ?? "gpt-4o-mini",
    disabled: process.env.NOVA_COPILOT_DISABLED === "true"
  },
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
  updates: {
    enabled: process.env.NOVA_UPDATES_ENABLED === "true",
    checkIntervalMs: Number(process.env.NOVA_UPDATES_INTERVAL_MS ?? String(24 * 60 * 60 * 1000)),
    repoOwner: process.env.NOVA_UPDATES_REPO_OWNER ?? "",
    repoName: process.env.NOVA_UPDATES_REPO_NAME ?? "",
    channel: process.env.NOVA_UPDATES_CHANNEL === "beta" ? "beta" : "stable",
    autoApply: process.env.NOVA_UPDATES_AUTO_APPLY === "true"
  },
  offlineMode: {
    enabled: process.env.NOVA_OFFLINE_MODE === "true"
  },
  memoryBear: {
    enabled: process.env.NOVA_MEMORYBEAR_ENABLED !== "false",
    baseUrl: process.env.NOVA_MEMORYBEAR_BASE_URL?.trim() || "http://127.0.0.1:8000",
    apiKey: process.env.NOVA_MEMORYBEAR_API_KEY?.trim() ?? "",
    searchSwitch:
      process.env.NOVA_MEMORYBEAR_SEARCH_SWITCH === "0" || process.env.NOVA_MEMORYBEAR_SEARCH_SWITCH === "1"
        ? process.env.NOVA_MEMORYBEAR_SEARCH_SWITCH
        : "2",
    storageType: process.env.NOVA_MEMORYBEAR_STORAGE_TYPE === "rag" ? "rag" : "neo4j",
    syncWrites: process.env.NOVA_MEMORYBEAR_SYNC_WRITES === "true"
  },
  sentiCore: {
    enabled: process.env.NOVA_SENTICORE_ENABLED === "true",
    orchestrationMarkdownPath: process.env.NOVA_SENTICORE_ORCHESTRATION_PATH?.trim() ?? ""
  },
  orpheusTts: {
    enabled: process.env.NOVA_ORPHEUS_TTS_ENABLED !== "false",
    baseUrl: process.env.NOVA_ORPHEUS_TTS_BASE_URL?.trim() || "http://127.0.0.1:5005",
    apiKey: process.env.NOVA_ORPHEUS_TTS_API_KEY?.trim() ?? "",
    voice: process.env.NOVA_ORPHEUS_TTS_VOICE?.trim() || "tara",
    model: process.env.NOVA_ORPHEUS_TTS_MODEL?.trim() ?? "",
    responseFormat:
      process.env.NOVA_ORPHEUS_TTS_FORMAT === "mp3"
        ? "mp3"
        : process.env.NOVA_ORPHEUS_TTS_FORMAT === "wav" ||
            process.env.NOVA_ORPHEUS_TTS_FORMAT === "opus" ||
            process.env.NOVA_ORPHEUS_TTS_FORMAT === "pcm" ||
            process.env.NOVA_ORPHEUS_TTS_FORMAT === "flac"
          ? process.env.NOVA_ORPHEUS_TTS_FORMAT
          : "wav"
  },
  skillSettings: {}
};

function defaultOllamaNumPredictFromEnv(): number {
  const raw = process.env.NOVA_OLLAMA_NUM_PREDICT?.trim();
  if (!raw) return 8192;
  const p = Number(raw);
  if (!Number.isFinite(p)) return 8192;
  if (p === -1) return -1;
  if (p < 1) return 8192;
  return Math.min(131072, Math.trunc(p));
}

function normalizeOllamaNumPredict(raw: unknown): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return 8192;
  const n = Math.trunc(raw);
  if (n === -1) return -1;
  if (n < 1) return 8192;
  return Math.min(131072, n);
}

function normalizeOllamaKeepAlive(raw: unknown): string {
  const s = typeof raw === "string" ? raw.trim() : "";
  if (!s) return "30m";
  return s.slice(0, 32);
}

function mergeSkillSettings(
  current: Record<string, Record<string, unknown>>,
  patch?: Record<string, Record<string, unknown>>
): Record<string, Record<string, unknown>> {
  if (!patch || typeof patch !== "object") {
    return current;
  }
  const out: Record<string, Record<string, unknown>> = { ...current };
  for (const [skillId, vals] of Object.entries(patch)) {
    if (!vals || typeof vals !== "object" || Array.isArray(vals)) {
      continue;
    }
    out[skillId] = { ...(current[skillId] ?? {}), ...(vals as Record<string, unknown>) };
  }
  return out;
}

export class SettingsService {
  private readonly repo = new SettingsRepository();

  get(): AppSettings {
    const existing = this.repo.get();
    if (!existing) {
      this.repo.upsert(DEFAULT_SETTINGS);
      return DEFAULT_SETTINGS;
    }
    const normalized = this.normalize(existing);
    if (JSON.stringify(existing) !== JSON.stringify(normalized)) {
      this.repo.upsert(normalized);
    }
    return normalized;
  }

  updatePartial(update: Partial<AppSettings>): AppSettings {
    const current = this.get();
    const next: AppSettings = this.normalize({
      delegatedFolders: update.delegatedFolders ?? current.delegatedFolders,
      requireApprovals: update.requireApprovals ?? current.requireApprovals,
      activeProvider: update.activeProvider ?? current.activeProvider,
      visionProviderPriority: update.visionProviderPriority ?? current.visionProviderPriority,
      mediaProviderPriority: update.mediaProviderPriority ?? current.mediaProviderPriority,
      shell: {
        timeoutMs: update.shell?.timeoutMs ?? current.shell.timeoutMs,
        maxOutputBytes: update.shell?.maxOutputBytes ?? current.shell.maxOutputBytes
      },
      skills: {
        isolationEnabled: update.skills?.isolationEnabled ?? current.skills.isolationEnabled,
        timeoutMs: update.skills?.timeoutMs ?? current.skills.timeoutMs,
        maxMemoryMb: update.skills?.maxMemoryMb ?? current.skills.maxMemoryMb,
        skillAuthoringDisabled: update.skills?.skillAuthoringDisabled ?? current.skills.skillAuthoringDisabled
      },
      web: {
        loginEnabled: update.web?.loginEnabled ?? current.web.loginEnabled,
        hideProviderModelInStats: update.web?.hideProviderModelInStats ?? current.web.hideProviderModelInStats,
        chatStyle: {
          userBubbleColor: update.web?.chatStyle?.userBubbleColor ?? current.web.chatStyle.userBubbleColor,
          assistantBubbleColor: update.web?.chatStyle?.assistantBubbleColor ?? current.web.chatStyle.assistantBubbleColor,
          userTextColor: update.web?.chatStyle?.userTextColor ?? current.web.chatStyle.userTextColor,
          assistantTextColor: update.web?.chatStyle?.assistantTextColor ?? current.web.chatStyle.assistantTextColor,
          userActionIconColor: update.web?.chatStyle?.userActionIconColor ?? current.web.chatStyle.userActionIconColor,
          assistantActionIconColor:
            update.web?.chatStyle?.assistantActionIconColor ?? current.web.chatStyle.assistantActionIconColor,
          statsTextColor: update.web?.chatStyle?.statsTextColor ?? current.web.chatStyle.statsTextColor,
          userBubbleColorLight:
            update.web?.chatStyle?.userBubbleColorLight ?? current.web.chatStyle.userBubbleColorLight,
          assistantBubbleColorLight:
            update.web?.chatStyle?.assistantBubbleColorLight ?? current.web.chatStyle.assistantBubbleColorLight,
          userTextColorLight: update.web?.chatStyle?.userTextColorLight ?? current.web.chatStyle.userTextColorLight,
          assistantTextColorLight:
            update.web?.chatStyle?.assistantTextColorLight ?? current.web.chatStyle.assistantTextColorLight,
          userActionIconColorLight:
            update.web?.chatStyle?.userActionIconColorLight ?? current.web.chatStyle.userActionIconColorLight,
          assistantActionIconColorLight:
            update.web?.chatStyle?.assistantActionIconColorLight ?? current.web.chatStyle.assistantActionIconColorLight,
          statsTextColorLight:
            update.web?.chatStyle?.statsTextColorLight ?? current.web.chatStyle.statsTextColorLight,
          bubbleBackgroundEnabled:
            update.web?.chatStyle?.bubbleBackgroundEnabled ?? current.web.chatStyle.bubbleBackgroundEnabled,
          borderColor: update.web?.chatStyle?.borderColor ?? current.web.chatStyle.borderColor,
          borderThicknessPx: update.web?.chatStyle?.borderThicknessPx ?? current.web.chatStyle.borderThicknessPx,
          userBorderThicknessPx:
            update.web?.chatStyle?.userBorderThicknessPx ?? current.web.chatStyle.userBorderThicknessPx,
          assistantBorderThicknessPx:
            update.web?.chatStyle?.assistantBorderThicknessPx ?? current.web.chatStyle.assistantBorderThicknessPx,
          userBackgroundOpacityPct:
            update.web?.chatStyle?.userBackgroundOpacityPct ?? current.web.chatStyle.userBackgroundOpacityPct,
          assistantBackgroundOpacityPct:
            update.web?.chatStyle?.assistantBackgroundOpacityPct ?? current.web.chatStyle.assistantBackgroundOpacityPct,
          bubbleRadiusPx: update.web?.chatStyle?.bubbleRadiusPx ?? current.web.chatStyle.bubbleRadiusPx,
          showNames: update.web?.chatStyle?.showNames ?? current.web.chatStyle.showNames
        },
        sendOnEnter: update.web?.sendOnEnter ?? current.web.sendOnEnter,
        voiceDictationAutoSend:
          typeof update.web?.voiceDictationAutoSend === "boolean"
            ? update.web.voiceDictationAutoSend
            : current.web.voiceDictationAutoSend,
        voiceDictationSilenceSec:
          typeof update.web?.voiceDictationSilenceSec === "number" && Number.isFinite(update.web.voiceDictationSilenceSec)
            ? clampInt(Math.round(update.web.voiceDictationSilenceSec), 1, 4, current.web.voiceDictationSilenceSec)
            : current.web.voiceDictationSilenceSec,
        voiceContinuousConversation:
          typeof update.web?.voiceContinuousConversation === "boolean"
            ? update.web.voiceContinuousConversation
            : current.web.voiceContinuousConversation,
        readAloudMessages:
          typeof update.web?.readAloudMessages === "boolean"
            ? update.web.readAloudMessages
            : current.web.readAloudMessages,
        showThinkingInChat:
          typeof update.web?.showThinkingInChat === "boolean"
            ? update.web.showThinkingInChat
            : current.web.showThinkingInChat,
        textScale:
          update.web?.textScale === "medium" || update.web?.textScale === "big" || update.web?.textScale === "normal"
            ? update.web.textScale
            : current.web.textScale
      },
      learning: {
        enabled: update.learning?.enabled ?? current.learning.enabled,
        idleMinutes: update.learning?.idleMinutes ?? current.learning.idleMinutes,
        intervalMs: update.learning?.intervalMs ?? current.learning.intervalMs,
        minFailuresForAutoImprove:
          update.learning?.minFailuresForAutoImprove ?? current.learning.minFailuresForAutoImprove
      },
      costGovernor: {
        enabled: update.costGovernor?.enabled ?? current.costGovernor.enabled,
        dailyBudgetUsd: update.costGovernor?.dailyBudgetUsd ?? current.costGovernor.dailyBudgetUsd,
        qualityTier: update.costGovernor?.qualityTier ?? current.costGovernor.qualityTier,
        providerPricing: {
          ollamaPer1k: update.costGovernor?.providerPricing?.ollamaPer1k ?? current.costGovernor.providerPricing.ollamaPer1k,
          lmstudioPer1k: update.costGovernor?.providerPricing?.lmstudioPer1k ?? current.costGovernor.providerPricing.lmstudioPer1k,
          copilotPer1k: update.costGovernor?.providerPricing?.copilotPer1k ?? current.costGovernor.providerPricing.copilotPer1k
        }
      },
      messagingAccess: {
        novaPhoneNumber: update.messagingAccess?.novaPhoneNumber ?? current.messagingAccess.novaPhoneNumber,
        denyUnknownNumbers: update.messagingAccess?.denyUnknownNumbers ?? current.messagingAccess.denyUnknownNumbers,
        channelTiers: update.messagingAccess?.channelTiers ?? current.messagingAccess.channelTiers,
        systemAdmins: update.messagingAccess?.systemAdmins ?? current.messagingAccess.systemAdmins,
        guests: update.messagingAccess?.guests ?? current.messagingAccess.guests,
        importantPeople: update.messagingAccess?.importantPeople ?? current.messagingAccess.importantPeople
      },
      emotions: {
        enabled: update.emotions?.enabled ?? current.emotions.enabled,
        expressionStyle: update.emotions?.expressionStyle ?? current.emotions.expressionStyle,
        mirrorUserValence: update.emotions?.mirrorUserValence ?? current.emotions.mirrorUserValence
      },
      identityBackup: {
        enabled: update.identityBackup?.enabled ?? current.identityBackup.enabled,
        intervalDays: update.identityBackup?.intervalDays ?? current.identityBackup.intervalDays,
        labelPrefix: update.identityBackup?.labelPrefix ?? current.identityBackup.labelPrefix,
        gitRemote:
          update.identityBackup?.gitRemote !== undefined
            ? normalizeIdentityBackupGitRemote(update.identityBackup.gitRemote)
            : current.identityBackup.gitRemote
      },
      ollama: {
        disabled: update.ollama?.disabled ?? current.ollama.disabled,
        numPredict:
          typeof update.ollama?.numPredict === "number" && Number.isFinite(update.ollama.numPredict)
            ? update.ollama.numPredict
            : current.ollama.numPredict,
        keepAlive:
          typeof update.ollama?.keepAlive === "string" ? update.ollama.keepAlive : current.ollama.keepAlive
      },
      lmstudio: {
        disabled: update.lmstudio?.disabled ?? current.lmstudio.disabled
      },
      models: {
        defaultByProvider: {
          ollama: update.models?.defaultByProvider?.ollama ?? current.models.defaultByProvider.ollama,
          lmstudio: update.models?.defaultByProvider?.lmstudio ?? current.models.defaultByProvider.lmstudio,
          copilot: update.models?.defaultByProvider?.copilot ?? current.models.defaultByProvider.copilot
        },
        ollamaThinkingEnabled: update.models?.ollamaThinkingEnabled ?? current.models.ollamaThinkingEnabled
      },
      copilot: {
        baseUrl: update.copilot?.baseUrl ?? current.copilot.baseUrl,
        apiKey: update.copilot?.apiKey ?? current.copilot.apiKey,
        defaultModel: update.copilot?.defaultModel ?? current.copilot.defaultModel,
        disabled: update.copilot?.disabled ?? current.copilot.disabled
      },
      vision: {
        ollamaModel: update.vision?.ollamaModel ?? current.vision.ollamaModel,
        ollamaBaseUrl: update.vision?.ollamaBaseUrl ?? current.vision.ollamaBaseUrl,
        lmstudioModel: update.vision?.lmstudioModel ?? current.vision.lmstudioModel,
        lmstudioBaseUrl: update.vision?.lmstudioBaseUrl ?? current.vision.lmstudioBaseUrl,
        cloudModel: update.vision?.cloudModel ?? current.vision.cloudModel,
        cloudBaseUrl: update.vision?.cloudBaseUrl ?? current.vision.cloudBaseUrl,
        cloudApiKey: update.vision?.cloudApiKey ?? current.vision.cloudApiKey,
        swapLocalModelsForVision: update.vision?.swapLocalModelsForVision ?? current.vision.swapLocalModelsForVision
      },
      updates: {
        enabled: update.updates?.enabled ?? current.updates.enabled,
        checkIntervalMs: update.updates?.checkIntervalMs ?? current.updates.checkIntervalMs,
        repoOwner: update.updates?.repoOwner ?? current.updates.repoOwner,
        repoName: update.updates?.repoName ?? current.updates.repoName,
        channel: update.updates?.channel ?? current.updates.channel,
        autoApply: update.updates?.autoApply ?? current.updates.autoApply
      },
      offlineMode: {
        enabled: update.offlineMode?.enabled ?? current.offlineMode.enabled
      },
      memoryBear: {
        enabled: update.memoryBear?.enabled ?? current.memoryBear.enabled,
        baseUrl: update.memoryBear?.baseUrl ?? current.memoryBear.baseUrl,
        apiKey: update.memoryBear?.apiKey ?? current.memoryBear.apiKey,
        searchSwitch: update.memoryBear?.searchSwitch ?? current.memoryBear.searchSwitch,
        storageType: update.memoryBear?.storageType ?? current.memoryBear.storageType,
        syncWrites: update.memoryBear?.syncWrites ?? current.memoryBear.syncWrites
      },
      sentiCore: {
        enabled: update.sentiCore?.enabled ?? current.sentiCore.enabled,
        orchestrationMarkdownPath:
          update.sentiCore?.orchestrationMarkdownPath ?? current.sentiCore.orchestrationMarkdownPath
      },
      orpheusTts: {
        enabled: update.orpheusTts?.enabled ?? current.orpheusTts.enabled,
        baseUrl: update.orpheusTts?.baseUrl ?? current.orpheusTts.baseUrl,
        apiKey: update.orpheusTts?.apiKey ?? current.orpheusTts.apiKey,
        voice: update.orpheusTts?.voice ?? current.orpheusTts.voice,
        model: update.orpheusTts?.model ?? current.orpheusTts.model,
        responseFormat: update.orpheusTts?.responseFormat ?? current.orpheusTts.responseFormat
      },
      skillSettings: mergeSkillSettings(current.skillSettings, update.skillSettings)
    });
    this.repo.upsert(next);
    return next;
  }

  /**
   * Auto-link a Signal sealed-sender UUID to an existing channel-tier row keyed by phone.
   *
   * Called once per inbound Signal envelope where BOTH `sourceNumber` AND `sourceUuid` are present.
   * Subsequent sealed-sender messages from the same UUID can then be matched even though `sourceNumber`
   * is hidden on the wire. Returns true when the link was actually written (new or changed).
   */
  linkSignalUuidToPhone(phone: string, signalUuid: string): boolean {
    const normalizedPhone = normalizePhone(phone);
    const normalizedUuid = normalizeSignalUuid(signalUuid);
    if (!normalizedPhone || !normalizedUuid) return false;
    const current = this.get();
    const rows = current.messagingAccess.channelTiers.signal;
    const idx = rows.findIndex((row) => row.phone === normalizedPhone);
    if (idx < 0) return false;
    if (rows[idx].signalUuid === normalizedUuid) return false;
    const nextRows = rows.map((row, i) => (i === idx ? { ...row, signalUuid: normalizedUuid } : row));
    const next: AppSettings = {
      ...current,
      messagingAccess: {
        ...current.messagingAccess,
        channelTiers: {
          ...current.messagingAccess.channelTiers,
          signal: nextRows
        }
      }
    };
    this.repo.upsert(next);
    return true;
  }

  private normalize(settings: AppSettings): AppSettings {
    const delegatedFolders = settings.delegatedFolders
      .map((entry) => resolvePath(entry))
      .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
    return {
      delegatedFolders: delegatedFolders.length > 0 ? delegatedFolders : [resolvePath(process.cwd())],
      requireApprovals: settings.requireApprovals === true,
      activeProvider: normalizeActiveProvider(settings.activeProvider, settings),
      visionProviderPriority: normalizeVisionPriority(settings.visionProviderPriority),
      mediaProviderPriority: normalizeMediaPriority(settings.mediaProviderPriority),
      shell: {
        timeoutMs: clampInt(settings.shell?.timeoutMs, 1000, 10 * 60 * 1000, DEFAULT_SETTINGS.shell.timeoutMs),
        maxOutputBytes: clampInt(settings.shell?.maxOutputBytes, 8 * 1024, 16 * 1024 * 1024, DEFAULT_SETTINGS.shell.maxOutputBytes)
      },
      skills: {
        isolationEnabled: settings.skills?.isolationEnabled === true,
        timeoutMs: clampInt(settings.skills?.timeoutMs, 1000, 5 * 60 * 1000, DEFAULT_SETTINGS.skills.timeoutMs),
        maxMemoryMb: clampInt(settings.skills?.maxMemoryMb, 64, 4096, DEFAULT_SETTINGS.skills.maxMemoryMb),
        skillAuthoringDisabled: settings.skills?.skillAuthoringDisabled === true
      },
      web: {
        loginEnabled: settings.web?.loginEnabled !== false,
        hideProviderModelInStats: settings.web?.hideProviderModelInStats === true,
        chatStyle: {
          userBubbleColor: normalizeHexColor(settings.web?.chatStyle?.userBubbleColor, DEFAULT_SETTINGS.web.chatStyle.userBubbleColor),
          assistantBubbleColor: normalizeHexColor(
            settings.web?.chatStyle?.assistantBubbleColor,
            DEFAULT_SETTINGS.web.chatStyle.assistantBubbleColor
          ),
          userTextColor: normalizeHexColor(settings.web?.chatStyle?.userTextColor, DEFAULT_SETTINGS.web.chatStyle.userTextColor),
          assistantTextColor: normalizeHexColor(
            settings.web?.chatStyle?.assistantTextColor,
            DEFAULT_SETTINGS.web.chatStyle.assistantTextColor
          ),
          userActionIconColor: normalizeHexColor(
            settings.web?.chatStyle?.userActionIconColor,
            DEFAULT_SETTINGS.web.chatStyle.userActionIconColor
          ),
          assistantActionIconColor: normalizeHexColor(
            settings.web?.chatStyle?.assistantActionIconColor,
            DEFAULT_SETTINGS.web.chatStyle.assistantActionIconColor
          ),
          statsTextColor: normalizeHexColor(
            settings.web?.chatStyle?.statsTextColor,
            DEFAULT_SETTINGS.web.chatStyle.statsTextColor
          ),
          userBubbleColorLight: normalizeHexColor(
            settings.web?.chatStyle?.userBubbleColorLight,
            DEFAULT_SETTINGS.web.chatStyle.userBubbleColorLight
          ),
          assistantBubbleColorLight: normalizeHexColor(
            settings.web?.chatStyle?.assistantBubbleColorLight,
            DEFAULT_SETTINGS.web.chatStyle.assistantBubbleColorLight
          ),
          userTextColorLight: normalizeHexColor(
            settings.web?.chatStyle?.userTextColorLight,
            DEFAULT_SETTINGS.web.chatStyle.userTextColorLight
          ),
          assistantTextColorLight: normalizeHexColor(
            settings.web?.chatStyle?.assistantTextColorLight,
            DEFAULT_SETTINGS.web.chatStyle.assistantTextColorLight
          ),
          userActionIconColorLight: normalizeHexColor(
            settings.web?.chatStyle?.userActionIconColorLight,
            DEFAULT_SETTINGS.web.chatStyle.userActionIconColorLight
          ),
          assistantActionIconColorLight: normalizeHexColor(
            settings.web?.chatStyle?.assistantActionIconColorLight,
            DEFAULT_SETTINGS.web.chatStyle.assistantActionIconColorLight
          ),
          statsTextColorLight: normalizeHexColor(
            settings.web?.chatStyle?.statsTextColorLight,
            DEFAULT_SETTINGS.web.chatStyle.statsTextColorLight
          ),
          bubbleBackgroundEnabled: settings.web?.chatStyle?.bubbleBackgroundEnabled !== false,
          borderColor: normalizeHexColor(settings.web?.chatStyle?.borderColor, DEFAULT_SETTINGS.web.chatStyle.borderColor),
          borderThicknessPx: clampInt(settings.web?.chatStyle?.borderThicknessPx, 0, 8, DEFAULT_SETTINGS.web.chatStyle.borderThicknessPx),
          userBorderThicknessPx: clampInt(
            settings.web?.chatStyle?.userBorderThicknessPx,
            0,
            8,
            settings.web?.chatStyle?.borderThicknessPx ?? DEFAULT_SETTINGS.web.chatStyle.userBorderThicknessPx
          ),
          assistantBorderThicknessPx: clampInt(
            settings.web?.chatStyle?.assistantBorderThicknessPx,
            0,
            8,
            settings.web?.chatStyle?.borderThicknessPx ?? DEFAULT_SETTINGS.web.chatStyle.assistantBorderThicknessPx
          ),
          userBackgroundOpacityPct: clampInt(
            settings.web?.chatStyle?.userBackgroundOpacityPct,
            0,
            100,
            settings.web?.chatStyle?.bubbleBackgroundEnabled === false ? 0 : DEFAULT_SETTINGS.web.chatStyle.userBackgroundOpacityPct
          ),
          assistantBackgroundOpacityPct: clampInt(
            settings.web?.chatStyle?.assistantBackgroundOpacityPct,
            0,
            100,
            settings.web?.chatStyle?.bubbleBackgroundEnabled === false
              ? 0
              : DEFAULT_SETTINGS.web.chatStyle.assistantBackgroundOpacityPct
          ),
          bubbleRadiusPx: clampInt(settings.web?.chatStyle?.bubbleRadiusPx, 0, 30, DEFAULT_SETTINGS.web.chatStyle.bubbleRadiusPx),
          showNames: settings.web?.chatStyle?.showNames !== false
        },
        sendOnEnter: settings.web?.sendOnEnter === true,
        voiceDictationAutoSend: settings.web?.voiceDictationAutoSend === true,
        voiceDictationSilenceSec: clampInt(
          Math.round(Number(settings.web?.voiceDictationSilenceSec)),
          1,
          4,
          DEFAULT_SETTINGS.web.voiceDictationSilenceSec
        ),
        voiceContinuousConversation: settings.web?.voiceContinuousConversation === true,
        readAloudMessages: settings.web?.readAloudMessages === true,
        showThinkingInChat: settings.web?.showThinkingInChat !== false,
        textScale:
          settings.web?.textScale === "medium" || settings.web?.textScale === "big" || settings.web?.textScale === "normal"
            ? settings.web.textScale
            : "normal"
      },
      learning: {
        enabled: settings.learning?.enabled !== false,
        idleMinutes: clampInt(settings.learning?.idleMinutes, 1, 120, DEFAULT_SETTINGS.learning.idleMinutes),
        intervalMs: clampInt(settings.learning?.intervalMs, 15_000, 60 * 60 * 1000, DEFAULT_SETTINGS.learning.intervalMs),
        minFailuresForAutoImprove: clampInt(
          settings.learning?.minFailuresForAutoImprove,
          1,
          20,
          DEFAULT_SETTINGS.learning.minFailuresForAutoImprove
        )
      },
      costGovernor: {
        enabled: settings.costGovernor?.enabled === true,
        dailyBudgetUsd: clampInt(Math.floor(settings.costGovernor?.dailyBudgetUsd ?? 0), 1, 1000, 5),
        qualityTier:
          settings.costGovernor?.qualityTier === "high" || settings.costGovernor?.qualityTier === "economy"
            ? settings.costGovernor.qualityTier
            : "balanced",
        providerPricing: {
          ollamaPer1k: clampFloat(settings.costGovernor?.providerPricing?.ollamaPer1k, 0, 1, 0.0002),
          lmstudioPer1k: clampFloat(settings.costGovernor?.providerPricing?.lmstudioPer1k, 0, 1, 0.001),
          copilotPer1k: clampFloat(settings.costGovernor?.providerPricing?.copilotPer1k, 0, 1, 0.008)
        }
      },
      messagingAccess: {
        novaPhoneNumber: normalizePhone(settings.messagingAccess?.novaPhoneNumber),
        denyUnknownNumbers: settings.messagingAccess?.denyUnknownNumbers !== false,
        channelTiers: normalizeChannelTiers(settings.messagingAccess?.channelTiers),
        systemAdmins: normalizePhoneList(settings.messagingAccess?.systemAdmins),
        guests: normalizePhoneList(settings.messagingAccess?.guests),
        importantPeople: normalizeImportantPeople(settings.messagingAccess?.importantPeople)
      },
      emotions: {
        enabled: settings.emotions?.enabled !== false,
        expressionStyle:
          settings.emotions?.expressionStyle === "subtle" || settings.emotions?.expressionStyle === "expressive"
            ? settings.emotions.expressionStyle
            : "balanced",
        mirrorUserValence: settings.emotions?.mirrorUserValence === true
      },
      identityBackup: {
        enabled: settings.identityBackup?.enabled === true,
        intervalDays: clampInt(settings.identityBackup?.intervalDays, 1, 30, 1),
        labelPrefix: normalizeLabelPrefix(settings.identityBackup?.labelPrefix),
        gitRemote: normalizeIdentityBackupGitRemote(settings.identityBackup?.gitRemote)
      },
      models: {
        defaultByProvider: {
          ollama: String(settings.models?.defaultByProvider?.ollama ?? "").trim(),
          lmstudio: String(settings.models?.defaultByProvider?.lmstudio ?? "").trim(),
          copilot: String(settings.models?.defaultByProvider?.copilot ?? "").trim()
        },
        ollamaThinkingEnabled: settings.models?.ollamaThinkingEnabled === true
      },
      ollama: {
        disabled: settings.ollama?.disabled !== false,
        numPredict: normalizeOllamaNumPredict(settings.ollama?.numPredict),
        keepAlive: normalizeOllamaKeepAlive(settings.ollama?.keepAlive)
      },
      lmstudio: {
        disabled: settings.lmstudio?.disabled !== false
      },
      copilot: {
        baseUrl: String(settings.copilot?.baseUrl ?? "").trim(),
        apiKey: String(settings.copilot?.apiKey ?? "").trim(),
        defaultModel: String(settings.copilot?.defaultModel ?? "gpt-4o-mini").trim(),
        disabled: settings.copilot?.disabled === true
      },
      vision: {
        ollamaModel: String(settings.vision?.ollamaModel ?? "").trim(),
        ollamaBaseUrl: String(settings.vision?.ollamaBaseUrl ?? "").trim(),
        lmstudioModel: String(settings.vision?.lmstudioModel ?? "").trim(),
        lmstudioBaseUrl: String(settings.vision?.lmstudioBaseUrl ?? "").trim(),
        cloudModel: String(settings.vision?.cloudModel ?? "").trim(),
        cloudBaseUrl: String(settings.vision?.cloudBaseUrl ?? "").trim(),
        cloudApiKey: String(settings.vision?.cloudApiKey ?? "").trim(),
        swapLocalModelsForVision: settings.vision?.swapLocalModelsForVision === true
      },
      updates: {
        enabled: settings.updates?.enabled === true,
        checkIntervalMs: clampInt(
          settings.updates?.checkIntervalMs,
          24 * 60 * 60 * 1000,
          7 * 24 * 60 * 60 * 1000,
          24 * 60 * 60 * 1000
        ),
        repoOwner: String(settings.updates?.repoOwner ?? "").trim(),
        repoName: String(settings.updates?.repoName ?? "").trim(),
        channel: settings.updates?.channel === "beta" ? "beta" : "stable",
        autoApply: settings.updates?.autoApply === true
      },
      offlineMode: {
        enabled: settings.offlineMode?.enabled === true
      },
      memoryBear: {
        enabled: settings.memoryBear?.enabled !== false,
        baseUrl: String(settings.memoryBear?.baseUrl ?? "").trim() || "http://127.0.0.1:8000",
        apiKey: String(settings.memoryBear?.apiKey ?? "").trim(),
        searchSwitch:
          settings.memoryBear?.searchSwitch === "0" || settings.memoryBear?.searchSwitch === "1"
            ? settings.memoryBear.searchSwitch
            : "2",
        storageType: settings.memoryBear?.storageType === "rag" ? "rag" : "neo4j",
        syncWrites: settings.memoryBear?.syncWrites === true
      },
      sentiCore: {
        enabled: settings.sentiCore?.enabled === true,
        orchestrationMarkdownPath: String(settings.sentiCore?.orchestrationMarkdownPath ?? "")
          .trim()
          .slice(0, 2048)
      },
      orpheusTts: {
        enabled: settings.orpheusTts?.enabled !== false,
        baseUrl: String(settings.orpheusTts?.baseUrl ?? "").trim() || "http://127.0.0.1:5005",
        apiKey: String(settings.orpheusTts?.apiKey ?? "").trim(),
        voice: (String(settings.orpheusTts?.voice ?? "").trim().slice(0, 128) || "tara").slice(0, 128),
        model: String(settings.orpheusTts?.model ?? "").trim().slice(0, 128),
        responseFormat:
          settings.orpheusTts?.responseFormat === "mp3"
            ? "mp3"
            : settings.orpheusTts?.responseFormat === "wav" ||
                settings.orpheusTts?.responseFormat === "opus" ||
                settings.orpheusTts?.responseFormat === "pcm" ||
                settings.orpheusTts?.responseFormat === "flac"
              ? settings.orpheusTts.responseFormat
              : "wav"
      },
      skillSettings:
        settings.skillSettings && typeof settings.skillSettings === "object"
          ? settings.skillSettings
          : {}
    };
  }
}

function firstEnabledProvider(s: AppSettings): AppSettings["activeProvider"] {
  if (s.ollama.disabled !== true) return "ollama";
  if (s.lmstudio.disabled !== true) return "lmstudio";
  if (s.copilot.disabled !== true) return "copilot";
  return "copilot";
}

function normalizeActiveProvider(
  value: AppSettings["activeProvider"] | undefined,
  settings: AppSettings
): AppSettings["activeProvider"] {
  const preferred: AppSettings["activeProvider"] =
    value === "lmstudio" || value === "copilot" ? value : "ollama";
  if (preferred === "ollama" && settings.ollama.disabled === true) {
    return firstEnabledProvider(settings);
  }
  if (preferred === "lmstudio" && settings.lmstudio.disabled === true) {
    return firstEnabledProvider(settings);
  }
  if (preferred === "copilot" && settings.copilot.disabled === true) {
    return firstEnabledProvider(settings);
  }
  return preferred;
}

function normalizeVisionPriority(
  value: Array<"lmstudio" | "ollama" | "cloud"> | undefined
): Array<"lmstudio" | "ollama" | "cloud"> {
  const ordered = dedupe(value ?? []);
  const defaults: Array<"lmstudio" | "ollama" | "cloud"> = ["lmstudio", "ollama", "cloud"];
  for (const item of defaults) {
    if (!ordered.includes(item)) {
      ordered.push(item);
    }
  }
  return ordered;
}

function normalizeMediaPriority(value: Array<"comfyui" | "cloud"> | undefined): Array<"comfyui" | "cloud"> {
  const ordered = dedupe(value ?? []);
  const defaults: Array<"comfyui" | "cloud"> = ["comfyui", "cloud"];
  for (const item of defaults) {
    if (!ordered.includes(item)) {
      ordered.push(item);
    }
  }
  return ordered;
}

function parseVisionPriority(raw: string | undefined): Array<"lmstudio" | "ollama" | "cloud"> {
  if (!raw) {
    return ["lmstudio", "ollama", "cloud"];
  }
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is "lmstudio" | "ollama" | "cloud" => item === "lmstudio" || item === "ollama" || item === "cloud");
  return normalizeVisionPriority(parsed);
}

function parseMediaPriority(raw: string | undefined): Array<"comfyui" | "cloud"> {
  if (!raw) {
    return ["comfyui", "cloud"];
  }
  const parsed = raw
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter((item): item is "comfyui" | "cloud" => item === "comfyui" || item === "cloud");
  return normalizeMediaPriority(parsed);
}

function dedupe<T extends string>(items: T[]): T[] {
  return items.filter((item, index) => items.indexOf(item) === index);
}

function clampInt(value: number | undefined, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  const intValue = Math.floor(numberValue);
  if (intValue < min) return min;
  if (intValue > max) return max;
  return intValue;
}

function clampFloat(value: number | undefined, min: number, max: number, fallback: number): number {
  const numberValue = Number(value);
  if (!Number.isFinite(numberValue)) {
    return fallback;
  }
  if (numberValue < min) return min;
  if (numberValue > max) return max;
  return Number(numberValue.toFixed(6));
}

function normalizePhone(value: string | undefined): string {
  const raw = (value ?? "").replace(/[^\d+]/g, "");
  if (!raw) return "";
  return raw.startsWith("+") ? raw : `+${raw}`;
}

function normalizePhoneList(values: string[] | undefined): string[] {
  const normalized = (values ?? [])
    .map((item) => normalizePhone(item))
    .filter((item) => item.length > 0);
  return dedupe(normalized);
}

function normalizeImportantPeople(
  values: AppSettings["messagingAccess"]["importantPeople"] | undefined
): AppSettings["messagingAccess"]["importantPeople"] {
  const result: AppSettings["messagingAccess"]["importantPeople"] = [];
  for (const item of values ?? []) {
    const phone = normalizePhone(item.phone);
    if (!phone) continue;
    result.push({
      phone,
      permissions: {
        cameraAccess: item.permissions?.cameraAccess === true,
        shellAccess: item.permissions?.shellAccess === true,
        securityCenterAccess: item.permissions?.securityCenterAccess === true,
        schedulerAccess: item.permissions?.schedulerAccess === true
      }
    });
  }
  return result.filter((item, index, all) => all.findIndex((other) => other.phone === item.phone) === index);
}

function normalizeChannelTiers(
  values: AppSettings["messagingAccess"]["channelTiers"] | undefined
): AppSettings["messagingAccess"]["channelTiers"] {
  const normalizeWhatsAppRows = (
    rows: Array<{ phone: string; tier: "admin" | "co_admin" | "restricted" | "guest" }> | undefined
  ) => {
    const out: Array<{ phone: string; tier: "admin" | "co_admin" | "restricted" | "guest" }> = [];
    for (const row of rows ?? []) {
      const phone = normalizePhone(row.phone);
      if (!phone) continue;
      const tier =
        row.tier === "admin" || row.tier === "co_admin" || row.tier === "restricted" || row.tier === "guest"
          ? row.tier
          : "guest";
      if (!out.find((x) => x.phone === phone)) {
        out.push({ phone, tier });
      }
    }
    return out;
  };
  const normalizeSignalRows = (
    rows: Array<{ phone: string; signalUuid?: string; tier: "admin" | "co_admin" | "restricted" | "guest" }> | undefined
  ) => {
    const out: Array<{ phone: string; signalUuid?: string; tier: "admin" | "co_admin" | "restricted" | "guest" }> = [];
    for (const row of rows ?? []) {
      const phone = normalizePhone(row.phone);
      if (!phone) continue;
      const tier =
        row.tier === "admin" || row.tier === "co_admin" || row.tier === "restricted" || row.tier === "guest"
          ? row.tier
          : "guest";
      const uuid = normalizeSignalUuid(row.signalUuid);
      if (!out.find((x) => x.phone === phone)) {
        const next: { phone: string; signalUuid?: string; tier: typeof tier } = { phone, tier };
        if (uuid) next.signalUuid = uuid;
        out.push(next);
      }
    }
    return out;
  };
  const signal = normalizeSignalRows(values?.signal);
  const whatsapp = normalizeWhatsAppRows(values?.whatsapp);

  // Safety: exactly one admin maximum globally across channels.
  let adminTaken = false;
  const clampAdmin = <T extends { tier: "admin" | "co_admin" | "restricted" | "guest" }>(rows: T[]): T[] =>
    rows.map((row) => {
      if (row.tier !== "admin") return row;
      if (!adminTaken) {
        adminTaken = true;
        return row;
      }
      return { ...row, tier: "co_admin" as const };
    });

  return {
    signal: clampAdmin(signal),
    whatsapp: clampAdmin(whatsapp)
  };
}

/**
 * Lower-cased, hyphen-stripped UUID-shape validator. Returns "" when the input doesn't look like
 * a Signal sealed-sender UUID (e.g. `b1b166c7-c4cb-46f8-be4d-e596336a3355`).
 */
function normalizeSignalUuid(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const t = value.trim().toLowerCase();
  if (!t) return "";
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(t)) return "";
  return t;
}

function normalizeLabelPrefix(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .slice(0, 40);
  return normalized.length > 0 ? normalized : "nova-core";
}

/** Safe Git remote name for `git push <remote> <branch>` (URLs belong in `git remote add`, not here). */
function normalizeIdentityBackupGitRemote(value: string | undefined): string {
  const t = String(value ?? "origin").trim();
  if (!t || t.length > 128 || !/^[A-Za-z0-9._-]+$/.test(t)) {
    return "origin";
  }
  return t;
}

function normalizeHexColor(value: string | undefined, fallback: string): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : fallback;
}
