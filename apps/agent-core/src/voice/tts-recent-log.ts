import type { EmotionState } from "../emotion/emotion-service.js";

type TtsTraceFields = {
  requestText: string;
  preparedForSpeech: string;
  sentToOrpheus: string;
  mood: Pick<EmotionState, "label" | "valence" | "arousal"> | null;
};

export type TtsRecentEntry = TtsTraceFields & {
  at: string;
  correlationId: string;
  ok: boolean;
  error?: string;
  responseMime?: string;
  audioBytes?: number;
};

const MAX_ENTRIES = 30;
const ring: TtsRecentEntry[] = [];

export function recordTtsSpeakResult(
  input: TtsTraceFields & {
    correlationId: string;
    ok: boolean;
    error?: string;
    responseMime?: string;
    audioBytes?: number;
  }
): void {
  const entry: TtsRecentEntry = {
    at: new Date().toISOString(),
    correlationId: input.correlationId,
    ok: input.ok,
    error: input.error,
    responseMime: input.responseMime,
    audioBytes: input.audioBytes,
    requestText: input.requestText,
    preparedForSpeech: input.preparedForSpeech,
    sentToOrpheus: input.sentToOrpheus,
    mood: input.mood
  };
  ring.push(entry);
  while (ring.length > MAX_ENTRIES) {
    ring.shift();
  }
}

/** Newest first */
export function getRecentTtsEntries(limit: number, correlationId?: string): TtsRecentEntry[] {
  const n = Math.min(Math.max(1, limit), MAX_ENTRIES);
  let rows = ring.slice(-n).reverse();
  const want = correlationId?.trim();
  if (want) {
    rows = rows.filter((e) => e.correlationId === want);
  }
  return rows;
}
