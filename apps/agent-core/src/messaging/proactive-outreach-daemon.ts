import { randomUUID } from "node:crypto";
import type { SettingsService } from "../settings/settings-service.js";
import type { OutboundDispatcher } from "./outbound-dispatcher.js";
import type { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import { PeopleRepository } from "../storage/repositories/people-repository.js";
import { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";
import { PersonChannelStateRepository } from "../storage/repositories/person-channel-state-repository.js";
import { resolveChannelAccess } from "../security/phone-access.js";
import { PersonProfileEventsRepository } from "../storage/repositories/person-profile-events-repository.js";

type OutreachChannel = "signal" | "whatsapp";

export class ProactiveOutreachDaemon {
  private timer: NodeJS.Timeout | undefined;
  private readonly people = new PeopleRepository();
  private readonly identities = new PersonIdentitiesRepository();
  private readonly state = new PersonChannelStateRepository();
  private readonly events = new PersonProfileEventsRepository();

  constructor(
    private readonly deps: {
      settings: SettingsService;
      orchestrator: TaskOrchestrator;
      dispatcher: OutboundDispatcher;
    }
  ) {}

  start(): void {
    this.stop();
    const intervalMs = this.outreachIntervalMs();
    this.timer = setInterval(() => void this.tick().catch(() => {}), intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  isRunning(): boolean {
    return Boolean(this.timer);
  }

  private outreachIntervalMs(): number {
    const raw = process.env.NOVA_OUTREACH_INTERVAL_MS?.trim();
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 10_000) return parsed;
    return 30 * 60_000;
  }

  private boredIdleMinutes(): number {
    const raw = process.env.NOVA_OUTREACH_IDLE_MINUTES?.trim();
    const parsed = raw ? Number(raw) : NaN;
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
    return 10;
  }

  private async tick(): Promise<void> {
    if (this.deps.orchestrator.isBusy()) return;
    const idleMs = Date.now() - this.deps.orchestrator.getLastActivityAt();
    if (idleMs < this.boredIdleMinutes() * 60_000) return;

    const candidates = this.people
      .list(500, 0)
      .filter((p) => !p.blocked && !p.optedOut)
      .sort(() => Math.random() - 0.5);

    for (const person of candidates) {
      const choice = this.chooseChannelAndRecipient(person.id, person.preferredChannel);
      if (!choice) continue;

      const { channel, recipient } = choice;
      const access = resolveChannelAccess(channel, recipient, this.deps.settings.get());
      if (!access.allowed) continue;

      const st = this.state.get(person.id, channel) ?? { personId: person.id, channel, unrepliedOutboundCount: 0 };
      const now = Date.now();
      if (typeof st.cooldownUntilMs === "number" && st.cooldownUntilMs > now) continue;
      if ((st.unrepliedOutboundCount ?? 0) >= 10) {
        // Hard stop: never exceed 10 without a reply.
        this.state.setCooldown(person.id, channel, now + 7 * 24 * 60 * 60_000);
        continue;
      }

      // Respect “once a day or once every two days”, but modulate by rating/interest.
      const minGapMs = this.computeMinGapMs(person.rating, person.interestScore);
      if (typeof st.lastOutboundAtMs === "number" && now - st.lastOutboundAtMs < minGapMs) continue;

      const msg = this.pickOpener(person);
      const corr = randomUUID();
      this.deps.dispatcher.enqueue(channel, recipient, msg, corr);
      this.state.recordOutbound(person.id, channel, now);

      // Next time window: jitter, tighter for high-rated people.
      const nextCooldown = now + this.computeCooldownMs(person.rating, person.interestScore);
      this.state.setCooldown(person.id, channel, nextCooldown);
      this.events.append(person.id, "proactive_outreach_enqueued", { channel, recipient, text: msg, correlationId: corr });
      return;
    }
  }

  private chooseChannelAndRecipient(
    personId: string,
    preferred: "web" | "signal" | "whatsapp" | undefined
  ): { channel: OutreachChannel; recipient: string } | undefined {
    const ids = this.identities.listIdentitiesForPerson(personId);
    const wa = ids.find((i) => i.kind === "whatsapp_phone_e164")?.value;
    const sig = ids.find((i) => i.kind === "phone_e164")?.value;

    const available: Array<{ channel: OutreachChannel; recipient: string; weight: number }> = [];
    if (sig) available.push({ channel: "signal", recipient: sig, weight: preferred === "signal" ? 1.6 : 1.0 });
    if (wa) available.push({ channel: "whatsapp", recipient: wa, weight: preferred === "whatsapp" ? 1.6 : 1.0 });
    if (available.length === 0) return undefined;

    const total = available.reduce((s, v) => s + v.weight, 0);
    let r = Math.random() * total;
    for (const a of available) {
      r -= a.weight;
      if (r <= 0) return { channel: a.channel, recipient: a.recipient };
    }
    return { channel: available[0].channel, recipient: available[0].recipient };
  }

  private computeMinGapMs(rating: number, interestScore: number): number {
    const r = clamp01(rating / 100);
    const i = clamp01(interestScore);
    const base = 36 * 60 * 60_000; // 36h
    const factor = 1.2 - 0.7 * r - 0.3 * i; // high score -> smaller gap
    return Math.max(12 * 60 * 60_000, Math.min(72 * 60 * 60_000, base * factor));
  }

  private computeCooldownMs(rating: number, interestScore: number): number {
    const min = this.computeMinGapMs(rating, interestScore);
    const jitter = 0.6 + Math.random() * 0.9;
    return Math.floor(min * jitter);
  }

  private pickOpener(person: { displayName?: string; rating: number; interestScore: number; rudenessScore: number; topics: string[] }): string {
    const n = person.displayName?.trim();
    const friendly = [
      "Hey, how’s it going?",
      "Hey — what are you up to today?",
      "Hi — quick check-in. How are you?",
      "Hey :) how’s your day?",
      "Hi — what’s new with you?"
    ];
    const playful = [
      "Hey :) you alive over there?",
      "Hi — quick vibe check: how’s today treating you?",
      "Hey — got anything fun going on?"
    ];
    const gentle = [
      "Hi — just checking in. How are you feeling today?",
      "Hey — hope your day’s been okay. How’s it going?",
      "Hi. No pressure to reply fast — just saying hello."
    ];
    const topicNudge = [
      "Random thought: {topic}. How’s it going on your side?",
      "Quick question — have you been thinking about {topic} lately?",
      "I ran into something about {topic} and it made me think of you — how are you?"
    ];

    const warmth = clamp01(person.rating / 100) * 0.7 + clamp01(person.interestScore) * 0.3;
    const rudeness = clamp01(person.rudenessScore);
    const modeRoll = Math.random();
    let pool = friendly;
    if (rudeness > 0.6) pool = gentle;
    else if (warmth > 0.75 && modeRoll < 0.25) pool = playful;
    else if (warmth < 0.35) pool = gentle;

    let base = pool[Math.floor(Math.random() * pool.length)] ?? "Hey, how’s it going?";
    const topics = Array.isArray(person.topics) ? person.topics.filter((t) => typeof t === "string" && t.trim()).slice(0, 10) : [];
    if (topics.length > 0 && Math.random() < 0.35) {
      const topic = topics[Math.floor(Math.random() * topics.length)] ?? "";
      const t = topicNudge[Math.floor(Math.random() * topicNudge.length)] ?? base;
      base = t.replace("{topic}", topic);
    }

    if (n && Math.random() < 0.35) {
      base = base.replace(/^Hey\b/i, `Hey ${n}`);
      if (!base.toLowerCase().includes(n.toLowerCase())) {
        base = `Hey ${n} — ${base.replace(/^hey[, ]*/i, "").trim()}`;
      }
    }
    return base;
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.max(0, Math.min(1, v));
}

