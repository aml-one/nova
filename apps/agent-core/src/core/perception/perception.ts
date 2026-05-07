export type PerceptionSource =
  | "web"
  | "signal"
  | "whatsapp"
  | "voice"
  | "vision"
  | "system"
  | "scheduler"
  | "memory"
  | "skill";

export type PerceptionModality =
  | "text"
  | "audio"
  | "image"
  | "video"
  | "sensor"
  | "state"
  | "event";

export type PerceptionConfidence = "low" | "medium" | "high";

export type PerceptionEvent<TPayload = unknown> = {
  id: string;
  source: PerceptionSource;
  modality: PerceptionModality;
  observedAt: string;
  payload: TPayload;
  correlationId?: string;
  actorId?: string;
  confidence?: PerceptionConfidence;
  tags?: string[];
};

export function isPerceptionEvent(value: unknown): value is PerceptionEvent {
  if (!value || typeof value !== "object") return false;
  const event = value as Partial<PerceptionEvent>;
  return (
    typeof event.id === "string" &&
    typeof event.source === "string" &&
    typeof event.modality === "string" &&
    typeof event.observedAt === "string" &&
    "payload" in event
  );
}
