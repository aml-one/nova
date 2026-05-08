import type { AppSettings } from "../storage/repositories/settings-repository.js";

function channelSetupFromSettings(settings: AppSettings): Record<string, string> {
  return (settings.skillSettings?.["channel-setup"] ?? {}) as Record<string, string>;
}

function normalizeLocalSignalApiUrl(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) return "";
  try {
    const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
    const u = new URL(withScheme);
    // Old backups can contain Docker-internal hostnames such as `nova`. From agent-core on the
    // Mac host, the signal-cli-rest-api bridge is published on localhost:8085.
    if ((u.hostname === "nova" || u.hostname === "host.docker.internal") && (u.port === "8085" || !u.port)) {
      u.hostname = "127.0.0.1";
      u.port = "8085";
      return u.toString().replace(/\/$/, "");
    }
  } catch {
    return trimmed;
  }
  return trimmed;
}

/** Prefer env (runtime / Docker), then Settings → Channels channel-setup + nova phone. */
export function effectiveSignalApiUrl(settings: AppSettings): string {
  const cs = channelSetupFromSettings(settings);
  return normalizeLocalSignalApiUrl(process.env.SIGNAL_API_URL?.trim() || cs.signalApiUrl?.trim() || "");
}

export function effectiveSignalAccountNumber(settings: AppSettings): string {
  const cs = channelSetupFromSettings(settings);
  return (
    process.env.SIGNAL_ACCOUNT_NUMBER?.trim() ||
    cs.signalAccountNumber?.trim() ||
    settings.messagingAccess?.novaPhoneNumber?.trim() ||
    ""
  );
}

export function effectiveWhatsAppPhoneNumberId(settings: AppSettings): string {
  const cs = channelSetupFromSettings(settings);
  return process.env.WHATSAPP_PHONE_NUMBER_ID?.trim() || cs.whatsAppPhoneNumberId?.trim() || "";
}

export function effectiveWhatsAppToken(settings: AppSettings): string {
  const cs = channelSetupFromSettings(settings);
  return process.env.WHATSAPP_TOKEN?.trim() || cs.whatsAppToken?.trim() || "";
}
