import type { AppSettings } from "../storage/repositories/settings-repository.js";

function channelSetupFromSettings(settings: AppSettings): Record<string, string> {
  return (settings.skillSettings?.["channel-setup"] ?? {}) as Record<string, string>;
}

/** Prefer env (runtime / Docker), then Settings → Channels channel-setup + nova phone. */
export function effectiveSignalApiUrl(settings: AppSettings): string {
  const cs = channelSetupFromSettings(settings);
  return (process.env.SIGNAL_API_URL?.trim() || cs.signalApiUrl?.trim() || "").replace(/\/$/, "");
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
