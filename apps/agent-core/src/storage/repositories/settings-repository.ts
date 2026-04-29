import { getDatabase } from "../sqlite.js";

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
          loginEnabled: parsed.web?.loginEnabled !== false
        },
        learning: {
          enabled: parsed.learning?.enabled === true,
          idleMinutes: Number(parsed.learning?.idleMinutes ?? 0),
          intervalMs: Number(parsed.learning?.intervalMs ?? 0),
          minFailuresForAutoImprove: Number(parsed.learning?.minFailuresForAutoImprove ?? 0)
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
        }
      };
    } catch {
      return undefined;
    }
  }

  upsert(settings: AppSettings): void {
    const db = getDatabase();
    db.prepare(
      `
      INSERT INTO app_settings (key, value, updated_at)
      VALUES (?, ?, CURRENT_TIMESTAMP)
      ON CONFLICT(key) DO UPDATE SET
        value = excluded.value,
        updated_at = CURRENT_TIMESTAMP
      `
    ).run(SETTINGS_KEY, JSON.stringify(settings));
  }
}
