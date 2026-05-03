/**
 * Nova’s single mood bucket for **all channels and all contacts** (alias id `local-web-user`; legacy `nova-system` unused).
 * Matches agent-core `NOVA_PRIMARY_EMOTION_USER_ID`.
 */
export const WEB_CHAT_EMOTION_USER_ID = "local-web-user";

/** Same id — clearer name for non-web callers. */
export const NOVA_UNIFIED_MOOD_USER_ID = WEB_CHAT_EMOTION_USER_ID;

/** Dispatched after chat turns so header mood refreshes without waiting for the poll interval. */
export const NOVA_EMOTION_REFRESH_EVENT = "nova-emotion-refresh";

export function dispatchNovaEmotionRefresh(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NOVA_EMOTION_REFRESH_EVENT));
}
