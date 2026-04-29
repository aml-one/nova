import { resolve as resolvePath } from "node:path";
import { SettingsRepository, type AppSettings } from "../storage/repositories/settings-repository.js";

const DEFAULT_SETTINGS: AppSettings = {
  delegatedFolders: [resolvePath(process.cwd())],
  requireApprovals: process.env.NOVA_REQUIRE_APPROVALS === "true",
  activeProvider: (process.env.NOVA_PROVIDER as "ollama" | "lmstudio" | "copilot" | undefined) ?? "ollama",
  visionProviderPriority: parseVisionPriority(process.env.NOVA_VISION_PROVIDER_PRIORITY),
  mediaProviderPriority: parseMediaPriority(process.env.NOVA_MEDIA_PROVIDER_PRIORITY),
  shell: {
    timeoutMs: Number(process.env.NOVA_SHELL_TIMEOUT_MS ?? "30000"),
    maxOutputBytes: Number(process.env.NOVA_SHELL_MAX_OUTPUT_BYTES ?? String(1024 * 1024))
  },
  skills: {
    isolationEnabled: process.env.NOVA_SKILL_ISOLATION === "true",
    timeoutMs: Number(process.env.NOVA_SKILL_TIMEOUT_MS ?? "15000"),
    maxMemoryMb: Number(process.env.NOVA_SKILL_MAX_MB ?? "256")
  },
  web: {
    loginEnabled: true
  },
  learning: {
    enabled: process.env.NOVA_LEARNING_ENABLED === "true" || process.env.NOVA_LEARNING_ENABLED === undefined,
    idleMinutes: Number(process.env.NOVA_LEARNING_IDLE_MINUTES ?? "3"),
    intervalMs: Number(process.env.NOVA_LEARNING_INTERVAL_MS ?? "120000"),
    minFailuresForAutoImprove: Number(process.env.NOVA_LEARNING_MIN_FAILURES ?? "2")
  },
  messagingAccess: {
    novaPhoneNumber: process.env.NOVA_PHONE_NUMBER ?? "",
    denyUnknownNumbers: true,
    systemAdmins: [],
    guests: [],
    importantPeople: []
  },
  emotions: {
    enabled: process.env.NOVA_EMOTIONS_ENABLED === "true",
    expressionStyle:
      process.env.NOVA_EMOTIONS_STYLE === "subtle" || process.env.NOVA_EMOTIONS_STYLE === "expressive"
        ? process.env.NOVA_EMOTIONS_STYLE
        : "balanced",
    mirrorUserValence: process.env.NOVA_EMOTIONS_MIRROR_USER_VALENCE === "true"
  },
  identityBackup: {
    enabled: process.env.NOVA_IDENTITY_BACKUP_ENABLED === "true",
    intervalDays: Number(process.env.NOVA_IDENTITY_BACKUP_INTERVAL_DAYS ?? "1"),
    labelPrefix: process.env.NOVA_IDENTITY_BACKUP_LABEL_PREFIX ?? "nova-core"
  }
};

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
        maxMemoryMb: update.skills?.maxMemoryMb ?? current.skills.maxMemoryMb
      },
      web: {
        loginEnabled: update.web?.loginEnabled ?? current.web.loginEnabled
      },
      learning: {
        enabled: update.learning?.enabled ?? current.learning.enabled,
        idleMinutes: update.learning?.idleMinutes ?? current.learning.idleMinutes,
        intervalMs: update.learning?.intervalMs ?? current.learning.intervalMs,
        minFailuresForAutoImprove:
          update.learning?.minFailuresForAutoImprove ?? current.learning.minFailuresForAutoImprove
      },
      messagingAccess: {
        novaPhoneNumber: update.messagingAccess?.novaPhoneNumber ?? current.messagingAccess.novaPhoneNumber,
        denyUnknownNumbers: update.messagingAccess?.denyUnknownNumbers ?? current.messagingAccess.denyUnknownNumbers,
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
        labelPrefix: update.identityBackup?.labelPrefix ?? current.identityBackup.labelPrefix
      }
    });
    this.repo.upsert(next);
    return next;
  }

  private normalize(settings: AppSettings): AppSettings {
    const delegatedFolders = settings.delegatedFolders
      .map((entry) => resolvePath(entry))
      .filter((entry, index, all) => entry.length > 0 && all.indexOf(entry) === index);
    return {
      delegatedFolders: delegatedFolders.length > 0 ? delegatedFolders : [resolvePath(process.cwd())],
      requireApprovals: settings.requireApprovals === true,
      activeProvider: normalizeActiveProvider(settings.activeProvider),
      visionProviderPriority: normalizeVisionPriority(settings.visionProviderPriority),
      mediaProviderPriority: normalizeMediaPriority(settings.mediaProviderPriority),
      shell: {
        timeoutMs: clampInt(settings.shell?.timeoutMs, 1000, 10 * 60 * 1000, DEFAULT_SETTINGS.shell.timeoutMs),
        maxOutputBytes: clampInt(settings.shell?.maxOutputBytes, 8 * 1024, 16 * 1024 * 1024, DEFAULT_SETTINGS.shell.maxOutputBytes)
      },
      skills: {
        isolationEnabled: settings.skills?.isolationEnabled === true,
        timeoutMs: clampInt(settings.skills?.timeoutMs, 1000, 5 * 60 * 1000, DEFAULT_SETTINGS.skills.timeoutMs),
        maxMemoryMb: clampInt(settings.skills?.maxMemoryMb, 64, 4096, DEFAULT_SETTINGS.skills.maxMemoryMb)
      },
      web: {
        loginEnabled: settings.web?.loginEnabled !== false
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
      messagingAccess: {
        novaPhoneNumber: normalizePhone(settings.messagingAccess?.novaPhoneNumber),
        denyUnknownNumbers: settings.messagingAccess?.denyUnknownNumbers !== false,
        systemAdmins: normalizePhoneList(settings.messagingAccess?.systemAdmins),
        guests: normalizePhoneList(settings.messagingAccess?.guests),
        importantPeople: normalizeImportantPeople(settings.messagingAccess?.importantPeople)
      },
      emotions: {
        enabled: settings.emotions?.enabled === true,
        expressionStyle:
          settings.emotions?.expressionStyle === "subtle" || settings.emotions?.expressionStyle === "expressive"
            ? settings.emotions.expressionStyle
            : "balanced",
        mirrorUserValence: settings.emotions?.mirrorUserValence === true
      },
      identityBackup: {
        enabled: settings.identityBackup?.enabled === true,
        intervalDays: clampInt(settings.identityBackup?.intervalDays, 1, 30, 1),
        labelPrefix: normalizeLabelPrefix(settings.identityBackup?.labelPrefix)
      }
    };
  }
}

function normalizeActiveProvider(value: AppSettings["activeProvider"] | undefined): AppSettings["activeProvider"] {
  return value === "lmstudio" || value === "copilot" ? value : "ollama";
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

function normalizeLabelPrefix(value: string | undefined): string {
  const normalized = (value ?? "")
    .trim()
    .replace(/[^a-zA-Z0-9-_]/g, "-")
    .slice(0, 40);
  return normalized.length > 0 ? normalized : "nova-core";
}
