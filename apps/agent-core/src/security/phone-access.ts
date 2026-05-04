import type { AppSettings } from "../storage/repositories/settings-repository.js";

export type RoleName = "admin" | "co_admin" | "restricted" | "important" | "guest" | "unknown";

export type ChannelAccessProfile = {
  role: RoleName;
  allowed: boolean;
  capabilities: {
    cameraAccess: boolean;
    shellAccess: boolean;
    securityCenterAccess: boolean;
    schedulerAccess: boolean;
  };
};

export function resolveChannelAccess(
  channel: "whatsapp" | "signal" | "web",
  phoneNumber: string | undefined,
  settings: AppSettings
): ChannelAccessProfile {
  const normalized = normalizePhone(phoneNumber);
  const access = settings.messagingAccess;
  if (!normalized) {
    return {
      role: "unknown",
      allowed: access.denyUnknownNumbers !== true,
      capabilities: {
        cameraAccess: false,
        shellAccess: false,
        securityCenterAccess: false,
        schedulerAccess: false
      }
    };
  }
  const channelRows = channel === "signal" || channel === "whatsapp" ? access.channelTiers?.[channel] ?? [] : [];
  const channelTier = channelRows.find((entry) => entry.phone === normalized)?.tier;
  if (channelTier === "admin") {
    return {
      role: "admin",
      allowed: true,
      capabilities: {
        cameraAccess: true,
        shellAccess: true,
        securityCenterAccess: true,
        schedulerAccess: true
      }
    };
  }
  if (channelTier === "co_admin") {
    return {
      role: "co_admin",
      allowed: true,
      capabilities: {
        cameraAccess: true,
        shellAccess: true,
        securityCenterAccess: true,
        schedulerAccess: true
      }
    };
  }
  if (channelTier === "restricted") {
    return {
      role: "restricted",
      allowed: true,
      capabilities: {
        cameraAccess: true,
        shellAccess: false,
        securityCenterAccess: false,
        schedulerAccess: false
      }
    };
  }
  if (channelTier === "guest") {
    return {
      role: "guest",
      allowed: true,
      capabilities: {
        cameraAccess: false,
        shellAccess: false,
        securityCenterAccess: false,
        schedulerAccess: false
      }
    };
  }
  // Legacy fallback (pre-tier settings).
  if (access.systemAdmins.includes(normalized)) {
    return {
      role: "admin",
      allowed: true,
      capabilities: {
        cameraAccess: true,
        shellAccess: true,
        securityCenterAccess: true,
        schedulerAccess: true
      }
    };
  }
  const important = access.importantPeople.find((entry) => entry.phone === normalized);
  if (important) {
    return {
      role: "important",
      allowed: true,
      capabilities: {
        cameraAccess: important.permissions.cameraAccess,
        shellAccess: important.permissions.shellAccess,
        securityCenterAccess: important.permissions.securityCenterAccess,
        schedulerAccess: important.permissions.schedulerAccess
      }
    };
  }
  if (access.guests.includes(normalized)) {
    return {
      role: "guest",
      allowed: true,
      capabilities: {
        cameraAccess: false,
        shellAccess: false,
        securityCenterAccess: false,
        schedulerAccess: false
      }
    };
  }
  return {
    role: "unknown",
    allowed: access.denyUnknownNumbers !== true,
    capabilities: {
      cameraAccess: false,
      shellAccess: false,
      securityCenterAccess: false,
      schedulerAccess: false
    }
  };
}

function normalizePhone(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}
