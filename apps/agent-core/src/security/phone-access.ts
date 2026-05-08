import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";

export type RoleName = "admin" | "co_admin" | "restricted" | "important" | "guest" | "unknown";

export type ChannelAccessProfile = {
  role: RoleName;
  allowed: boolean;
  /** When `true`, the match was made by Signal sealed-sender UUID rather than phone. */
  matchedBySignalUuid?: boolean;
  capabilities: {
    cameraAccess: boolean;
    shellAccess: boolean;
    securityCenterAccess: boolean;
    schedulerAccess: boolean;
  };
};

export type ChannelAccessOptions = {
  /**
   * Optional Signal sealed-sender Service ID. When provided and `channel === "signal"`, sealed-sender
   * messages are matched against `messagingAccess.channelTiers.signal[].signalUuid` even when the
   * E.164 phone number is hidden on the wire.
   */
  signalUuid?: string;
};

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function tierCapabilities(tier: "admin" | "co_admin" | "restricted" | "guest"): ChannelAccessProfile["capabilities"] {
  if (tier === "admin" || tier === "co_admin") {
    return {
      cameraAccess: true,
      shellAccess: true,
      securityCenterAccess: true,
      schedulerAccess: true
    };
  }
  if (tier === "restricted") {
    return {
      cameraAccess: true,
      shellAccess: false,
      securityCenterAccess: false,
      schedulerAccess: false
    };
  }
  return {
    cameraAccess: false,
    shellAccess: false,
    securityCenterAccess: false,
    schedulerAccess: false
  };
}

function tierToRole(tier: "admin" | "co_admin" | "restricted" | "guest"): RoleName {
  return tier;
}

export function resolveChannelAccess(
  channel: "whatsapp" | "signal" | "web",
  phoneNumber: string | undefined,
  settings: AppSettings,
  options: ChannelAccessOptions = {}
): ChannelAccessProfile {
  const access = settings.messagingAccess;
  const normalized = normalizePhone(phoneNumber);
  const signalUuid = normalizeSignalUuid(options.signalUuid);

  // Signal sealed-sender — try to match by UUID first when phone is missing or unknown.
  if (channel === "signal" && signalUuid) {
    const channelRows = access.channelTiers?.signal ?? [];
    const uuidRow = channelRows.find((entry) => entry.signalUuid && entry.signalUuid.toLowerCase() === signalUuid);
    if (uuidRow) {
      return {
        role: tierToRole(uuidRow.tier),
        allowed: true,
        matchedBySignalUuid: true,
        capabilities: tierCapabilities(uuidRow.tier)
      };
    }
    const fromPerson = resolveSignalTierByPersonIdentityUuid(signalUuid, access);
    if (fromPerson) {
      return fromPerson;
    }
  }

  if (!normalized) {
    return {
      role: "unknown",
      allowed: access.denyUnknownNumbers !== true,
      capabilities: tierCapabilities("guest")
    };
  }
  const channelRows = channel === "signal" || channel === "whatsapp" ? access.channelTiers?.[channel] ?? [] : [];
  const digitsOnly = (p: string) => p.replace(/\D/g, "");
  const nd = normalized ? digitsOnly(normalized) : "";
  let channelTier = channelRows.find((entry) => entry.phone === normalized)?.tier;
  if (!channelTier && nd) {
    channelTier = channelRows.find((entry) => digitsOnly(entry.phone) === nd)?.tier;
  }
  // Same person often uses one number on Signal and WhatsApp; inherit Signal tier when no WhatsApp row matches.
  if (!channelTier && channel === "whatsapp" && normalized) {
    const sigRows = access.channelTiers?.signal ?? [];
    channelTier =
      sigRows.find((entry) => entry.phone === normalized)?.tier ??
      sigRows.find((entry) => digitsOnly(entry.phone) === nd)?.tier;
  }
  if (channelTier) {
    return {
      role: tierToRole(channelTier),
      allowed: true,
      capabilities: tierCapabilities(channelTier)
    };
  }
  // Legacy fallback (pre-tier settings).
  if (access.systemAdmins.includes(normalized)) {
    return {
      role: "admin",
      allowed: true,
      capabilities: tierCapabilities("admin")
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
      capabilities: tierCapabilities("guest")
    };
  }
  return {
    role: "unknown",
    allowed: access.denyUnknownNumbers !== true,
    capabilities: tierCapabilities("guest")
  };
}

function normalizePhone(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/[^\d+]/g, "");
  if (!cleaned) return "";
  return cleaned.startsWith("+") ? cleaned : `+${cleaned}`;
}

/** Normalize to E.164-ish `+digits…` for comparing allow lists to inbound identities. */
export function normalizeE164Phone(value: string | undefined): string {
  return normalizePhone(value);
}

function normalizeSignalUuid(value: string | undefined): string {
  if (typeof value !== "string") return "";
  const t = value.trim().toLowerCase();
  if (!t || !UUID_REGEX.test(t)) return "";
  return t;
}

/**
 * Sealed-sender UUID is stored on `person_identities` (often after an earlier non-sealed message);
 * channel tiers may only list E.164. Map UUID → person → phone → tier.
 */
function resolveSignalTierByPersonIdentityUuid(
  signalUuid: string,
  access: AppSettings["messagingAccess"]
): ChannelAccessProfile | undefined {
  try {
    const identities = new PersonIdentitiesRepository();
    const personId = identities.findPersonIdByIdentity("signal_uuid", signalUuid);
    if (!personId) return undefined;
    const list = identities.listIdentitiesForPerson(personId);
    const phoneRaw = list.find((r) => r.kind === "phone_e164")?.value;
    const linkedPhone = normalizePhone(phoneRaw);
    if (!linkedPhone) return undefined;
    const channelRows = access.channelTiers?.signal ?? [];
    const digitsOnly = (p: string) => p.replace(/\D/g, "");
    const nd = digitsOnly(linkedPhone);
    let channelTier = channelRows.find((entry) => entry.phone === linkedPhone)?.tier;
    if (!channelTier && nd) {
      channelTier = channelRows.find((entry) => digitsOnly(entry.phone) === nd)?.tier;
    }
    if (!channelTier) return undefined;
    return {
      role: tierToRole(channelTier),
      allowed: true,
      matchedBySignalUuid: true,
      capabilities: tierCapabilities(channelTier)
    };
  } catch {
    return undefined;
  }
}
