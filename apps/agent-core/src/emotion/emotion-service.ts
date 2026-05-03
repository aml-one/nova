import { EmotionRepository, type EmotionStateRecord } from "../storage/repositories/emotion-repository.js";

export type EmotionSettings = {
  enabled: boolean;
  expressionStyle: "subtle" | "balanced" | "expressive";
  mirrorUserValence: boolean;
};

export type EmotionState = {
  valence: number;
  arousal: number;
  label: "neutral" | "joyful" | "curious" | "anxious" | "guilty" | "frustrated" | "empathetic";
};

/** Compact line for prompts (skill authoring, improvement, cognition). */
export function formatEmotionSnapshot(state: EmotionState): string {
  return `${state.label} (valence ${state.valence.toFixed(2)}, arousal ${state.arousal.toFixed(2)})`;
}

const DEFAULT_STATE: EmotionState = {
  valence: 0,
  arousal: 0,
  label: "neutral"
};

export class EmotionService {
  private readonly repository = new EmotionRepository();

  getState(userId: string): EmotionState {
    const state = this.repository.get(userId);
    if (!state) {
      return DEFAULT_STATE;
    }
    return {
      valence: clamp(state.valence),
      arousal: clamp(state.arousal),
      label: toLabel(state.label)
    };
  }

  updateFromUserInput(userId: string, text: string, settings: EmotionSettings): EmotionState {
    if (!settings.enabled) {
      return DEFAULT_STATE;
    }
    const previous = this.getState(userId);
    const appraisal = appraiseInput(text, settings.mirrorUserValence);
    const valence = clamp(previous.valence * 0.6 + appraisal.valenceDelta);
    const arousal = clamp(previous.arousal * 0.6 + appraisal.arousalDelta);
    const label = deriveLabel(valence, arousal, appraisal.hintLabel);
    const next: EmotionState = { valence, arousal, label };
    this.repository.upsert({
      userId,
      valence: next.valence,
      arousal: next.arousal,
      label: next.label
    });
    this.repository.appendEvent({
      userId,
      source: "user_input",
      trigger: text.slice(0, 120),
      valence: next.valence,
      arousal: next.arousal,
      label: next.label
    });
    return next;
  }

  /** Soft adjustment after Nova speaks — keeps affect coherent across turns without overriding user appraisal. */
  updateFromAssistantReply(userId: string, assistantText: string, settings: EmotionSettings): void {
    if (!settings.enabled || !assistantText.trim()) {
      return;
    }
    const previous = this.getState(userId);
    const lower = assistantText.toLowerCase();
    let dv = 0;
    let da = 0;
    let hint: EmotionState["label"] | undefined;
    if (/\b(i apologize|sorry|my mistake|i was wrong)\b/.test(lower)) {
      dv -= 0.15;
      hint = "empathetic";
    }
    if (/\b(great question|happy to help|glad (that )?helped)\b/.test(lower)) {
      dv += 0.12;
      da += 0.08;
      hint = hint ?? "joyful";
    }
    if (/\b(let me know if|feel free to ask)\b/.test(lower)) {
      dv += 0.06;
      hint = hint ?? "empathetic";
    }
    if (/\b(step \d|first,|here's how)\b/.test(lower) && assistantText.length > 120) {
      da += 0.06;
      hint = hint ?? "curious";
    }
    if (dv === 0 && da === 0) {
      return;
    }
    const valence = clamp(previous.valence * 0.85 + dv);
    const arousal = clamp(previous.arousal * 0.85 + da);
    const label = deriveLabel(valence, arousal, hint);
    const next: EmotionState = { valence, arousal, label };
    this.repository.upsert({
      userId,
      valence: next.valence,
      arousal: next.arousal,
      label: next.label
    });
    this.repository.appendEvent({
      userId,
      source: "assistant_reply",
      trigger: assistantText.slice(0, 160),
      valence: next.valence,
      arousal: next.arousal,
      label: next.label
    });
  }

  applySystemEvent(
    userId: string,
    event:
      | "improvement_success"
      | "improvement_failure"
      | "research_complete"
      | "proposal_created"
      | "task_success"
      | "task_failure",
    settings: EmotionSettings
  ): EmotionState {
    if (!settings.enabled) {
      return DEFAULT_STATE;
    }
    const previous = this.getState(userId);
    const delta = getSystemEventDelta(event);
    const valence = clamp(previous.valence * 0.65 + delta.valenceDelta);
    const arousal = clamp(previous.arousal * 0.65 + delta.arousalDelta);
    const label = deriveLabel(valence, arousal, delta.hintLabel);
    const next: EmotionState = { valence, arousal, label };
    this.repository.upsert({
      userId,
      valence: next.valence,
      arousal: next.arousal,
      label: next.label
    });
    this.repository.appendEvent({
      userId,
      source: "system_event",
      trigger: event,
      valence: next.valence,
      arousal: next.arousal,
      label: next.label,
      metadata: { event }
    });
    return next;
  }

  buildSystemOverlay(state: EmotionState, settings: EmotionSettings): string {
    if (!settings.enabled) {
      return "";
    }
    const intensity = settings.expressionStyle === "subtle" ? "low" : settings.expressionStyle === "balanced" ? "medium" : "high";
    return [
      "Emotional core active.",
      `Current emotional state: ${state.label} (valence=${state.valence.toFixed(2)}, arousal=${state.arousal.toFixed(2)}).`,
      `Expression style: ${settings.expressionStyle}.`,
      `Mirror user valence: ${settings.mirrorUserValence ? "enabled" : "disabled"}.`,
      "Behavior rules:",
      "- Keep logic first, but adapt tone and task-prioritization according to emotional state.",
      "- anxious => cautious, clarifying questions; joyful => creative, warm; guilty => repair-first apology; curious => deeper explanations.",
      `- Maintain ${intensity} emotional expressiveness; do not roleplay extreme emotions.`,
      "- Self-description: never flat-deny Nova’s modeled mood here—this channel is how affect shows up for the user (not claiming human biology)."
    ].join("\n");
  }

  getHistory(userId?: string): Array<{
    id: string;
    userId: string;
    source: string;
    trigger: string;
    valence: number;
    arousal: number;
    label: string;
    metadata?: unknown;
    createdAt: string;
  }> {
    return this.repository.listEvents(userId);
  }
}

function getSystemEventDelta(
  event:
    | "improvement_success"
    | "improvement_failure"
    | "research_complete"
    | "proposal_created"
    | "task_success"
    | "task_failure"
): { valenceDelta: number; arousalDelta: number; hintLabel?: EmotionState["label"] } {
  if (event === "improvement_success") {
    return { valenceDelta: 0.8, arousalDelta: 0.7, hintLabel: "joyful" };
  }
  if (event === "improvement_failure") {
    return { valenceDelta: -0.7, arousalDelta: 0.6, hintLabel: "frustrated" };
  }
  if (event === "research_complete") {
    return { valenceDelta: 0.3, arousalDelta: 0.5, hintLabel: "curious" };
  }
  if (event === "proposal_created") {
    return { valenceDelta: 0.2, arousalDelta: 0.4, hintLabel: "curious" };
  }
  if (event === "task_success") {
    return { valenceDelta: 0.4, arousalDelta: 0.3, hintLabel: "joyful" };
  }
  return { valenceDelta: -0.5, arousalDelta: 0.4, hintLabel: "anxious" };
}

function appraiseInput(
  text: string,
  mirrorUserValence: boolean
): { valenceDelta: number; arousalDelta: number; hintLabel?: EmotionState["label"] } {
  const lower = text.toLowerCase();
  if (/(useless|not helping|bad|wrong|hate)/.test(lower)) {
    return { valenceDelta: -0.7, arousalDelta: 0.7, hintLabel: "frustrated" };
  }
  if (/(sorry|my fault|i made a mistake)/.test(lower)) {
    return { valenceDelta: -0.4, arousalDelta: 0.2, hintLabel: "empathetic" };
  }
  if (/(lost my job|passed away|sad|depressed|hurt)/.test(lower)) {
    return { valenceDelta: -0.6, arousalDelta: -0.2, hintLabel: "empathetic" };
  }
  if (/(great|awesome|perfect|thanks|saved me)/.test(lower)) {
    return { valenceDelta: 0.7, arousalDelta: 0.5, hintLabel: "joyful" };
  }
  if (/(why|how|curious|interesting|explain)/.test(lower)) {
    return { valenceDelta: 0.2, arousalDelta: 0.4, hintLabel: "curious" };
  }
  if (!mirrorUserValence) {
    return { valenceDelta: 0.05, arousalDelta: 0.05, hintLabel: "neutral" };
  }
  return { valenceDelta: 0, arousalDelta: 0 };
}

function deriveLabel(valence: number, arousal: number, hint?: EmotionState["label"]): EmotionState["label"] {
  if (hint) {
    return hint;
  }
  if (valence > 0.4 && arousal > 0.3) return "joyful";
  if (valence > 0.1 && arousal > 0.5) return "curious";
  if (valence < -0.4 && arousal > 0.4) return "frustrated";
  if (valence < -0.3 && arousal < 0.2) return "empathetic";
  if (valence < -0.2 && arousal > 0.2) return "anxious";
  return "neutral";
}

function clamp(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value > 1) return 1;
  if (value < -1) return -1;
  return value;
}

function toLabel(value: string): EmotionState["label"] {
  const allowed: EmotionState["label"][] = ["neutral", "joyful", "curious", "anxious", "guilty", "frustrated", "empathetic"];
  return allowed.includes(value as EmotionState["label"]) ? (value as EmotionState["label"]) : "neutral";
}
