import { randomUUID } from "node:crypto";
import type { ChatMessage, ModelResponse } from "@nova/sdk/provider";
import { ModelRouter } from "../providers/router.js";
import { MemoryService } from "../memory/memory-service.js";
import { PersonaLoader } from "../persona/persona-loader.js";
import { PhoneIdentityResolver } from "../identity/phone-identity.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { isSkillRuntimeEnabled } from "../skills/skill-enabled.js";
import { SelfImprovementLoop } from "../improvement/self-improvement-loop.js";
import { CommandExecutor } from "../execution/command-executor.js";
import { evaluateCommandPolicy } from "../execution/policy.js";
import {
  detectHostDiskSpaceIntent,
  detectHostDiagnosticsIntent,
  formatHostDiskSpaceReply,
  type HostDiagnosticsScope,
  implicitHostDiagnosticsShellAllowed,
  runHostDiskSpaceCollection,
  runHostDiagnosticsCollection
} from "../execution/host-diagnostics.js";
import {
  buildOllamaInventoryMarkdown,
  detectOllamaInventoryIntent,
  detectOllamaRoutingOnlyIntent,
  formatOllamaInventoryReply,
  formatOllamaRoutingOnlyReply
} from "../execution/ollama-inventory.js";
import {
  implicitShellAutoEnabled,
  planImplicitReadOnlyShell,
  runImplicitShellPlan
} from "../execution/implicit-auto-shell.js";
import { detectHostTimeIntent, formatNovaLocalTimeSentence, runHostTimeCollection } from "../execution/host-time.js";
import {
  detectSkillAuthoringIntent,
  enableAuthoredSkill,
  parseEnableSkillCommand,
  runSkillAuthoringFlow
} from "../skills/skill-authoring.js";
import { JobSupervisor } from "../execution/job-supervisor.js";
import { ExecutionAuditLog } from "../execution/audit-log.js";
import { UserProfileStore } from "../identity/user-profile-store.js";
import { RunHistoryRepository } from "../storage/repositories/run-history-repository.js";
import { ApprovalService } from "../execution/approval-service.js";
import { VisionRouter } from "../providers/vision-router.js";
import { buildRoutingDebugSnapshot } from "./routing-debug.js";
import { MediaGenerationRouter } from "../media/media-generation-router.js";
import { resolveUploadedMediaUrl } from "../media/media-storage.js";
import { SettingsService } from "../settings/settings-service.js";
import type { ChannelAccessProfile } from "../security/phone-access.js";
import { EmotionService, formatEmotionSnapshot, type EmotionState } from "../emotion/emotion-service.js";
import { buildUnifiedCognitiveCoreBlock } from "../emotion/cognitive-core-prompt.js";
import { ThoughtRepository } from "../storage/repositories/thought-repository.js";
import { getDatabase } from "../storage/sqlite.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { NOVA_PRIMARY_EMOTION_USER_ID } from "../identity/nova-emotion-user.js";
import { PeopleRepository } from "../storage/repositories/people-repository.js";
import { PersonIdentitiesRepository, type PersonIdentityKind } from "../storage/repositories/person-identities-repository.js";
import { IdentityRepository } from "../storage/repositories/identity-repository.js";
import { PersonFieldLocksRepository } from "../storage/repositories/person-field-locks-repository.js";
import { PersonChannelStateRepository, type PersonChannel } from "../storage/repositories/person-channel-state-repository.js";
import { PersonProfileEventsRepository } from "../storage/repositories/person-profile-events-repository.js";
import { PersonRelationshipsRepository } from "../storage/repositories/person-relationships-repository.js";
import { stripChannelAssistantScratchpad, stripOrpheusSpeechCues } from "../voice/tts-text.js";

const MAX_HOST_DIAG_APPENDIX_CHARS = 12_000;

type PendingLink = {
  token: string;
  expiresAtMs: number;
  identityKind: PersonIdentityKind;
  identityValue: string;
  requestedName: string;
};

const pendingLinksByToken = new Map<string, PendingLink>();
type PendingConnection = {
  token: string;
  expiresAtMs: number;
  fromPersonId: string;
  toPersonId: string;
  relation: string;
};
const pendingConnectionsByToken = new Map<string, PendingConnection>();

function sweepPendingLinks(nowMs = Date.now()): void {
  for (const [token, v] of pendingLinksByToken) {
    if (v.expiresAtMs <= nowMs) pendingLinksByToken.delete(token);
  }
}

function sweepPendingConnections(nowMs = Date.now()): void {
  for (const [token, v] of pendingConnectionsByToken) {
    if (v.expiresAtMs <= nowMs) pendingConnectionsByToken.delete(token);
  }
}

function parseLinkCommand(text: string): { kind: "link"; requestedName: string } | { kind: "confirm"; token: string } | undefined {
  const raw = text.trim();
  const m1 = raw.match(/^\/link\s+(.+)$/i) ?? raw.match(/^link:\s*(.+)$/i);
  if (m1?.[1]) {
    const requestedName = m1[1].trim();
    if (requestedName) return { kind: "link", requestedName };
  }
  const m2 = raw.match(/^\/confirm(?:-link)?\s+([a-z0-9]{4,16})$/i) ?? raw.match(/^confirm\s+([a-z0-9]{4,16})$/i);
  if (m2?.[1]) {
    return { kind: "confirm", token: m2[1].trim().toLowerCase() };
  }
  return undefined;
}

function normalizePhone(value: string | undefined): string | undefined {
  const v = value?.trim();
  if (!v) return undefined;
  const digits = v.replace(/[^\d+]/g, "");
  if (!digits) return undefined;
  return digits.startsWith("+") ? digits : `+${digits}`;
}

function inferIdentityForLink(input: { channel: "web" | "whatsapp" | "signal"; phoneNumber?: string; signalUuid?: string }): {
  kind: PersonIdentityKind;
  value: string;
} | undefined {
  if (input.channel === "signal") {
    const uuid = input.signalUuid?.trim().toLowerCase();
    if (uuid && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
      return { kind: "signal_uuid", value: uuid };
    }
    const phone = normalizePhone(input.phoneNumber);
    if (phone) return { kind: "phone_e164", value: phone };
    return undefined;
  }
  if (input.channel === "whatsapp") {
    const phone = normalizePhone(input.phoneNumber);
    if (!phone) return undefined;
    return { kind: "whatsapp_phone_e164", value: phone };
  }
  return undefined;
}

function harvestTopics(text: string): string[] {
  const t = text.toLowerCase();
  const words = t
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s+#-]/g, " ")
    .split(/\s+/)
    .map((w) => w.trim())
    .filter((w) => w.length >= 4 && w.length <= 24);
  const stop = new Set([
    "this",
    "that",
    "with",
    "what",
    "when",
    "where",
    "which",
    "their",
    "there",
    "about",
    "could",
    "would",
    "should",
    "please",
    "hello",
    "thanks",
    "thank",
    "again",
    "just",
    "like",
    "have",
    "your",
    "yours",
    "from",
    "into",
    "then",
    "them",
    "also",
    "want",
    "need",
    "help",
    "okay",
    "okey"
  ]);
  const counts = new Map<string, number>();
  for (const w of words) {
    if (stop.has(w)) continue;
    counts.set(w, (counts.get(w) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([w]) => w);
}

function parseTellCommand(text: string): { name: string; message: string } | undefined {
  const raw = text.trim();
  const m = raw.match(/^\/(tell|text|message)\s+(.+?)\s*:\s*([\s\S]+)$/i) ?? raw.match(/^\/(tell|text|message)\s+(\S+)\s+([\s\S]+)$/i);
  if (!m?.[2] || !m?.[3]) return undefined;
  const name = m[2].trim();
  const message = m[3].trim();
  if (!name || !message) return undefined;
  return { name, message };
}

function parseConnectCommand(text: string): { name: string; relation: string } | undefined {
  const raw = text.trim();
  const m = raw.match(/^\/connect\s+(.+?)(?:\s+as\s+(\w+))?$/i) ?? raw.match(/^\/introduce\s+(.+?)(?:\s+as\s+(\w+))?$/i);
  if (!m?.[1]) return undefined;
  const name = m[1].trim();
  const rel = (m[2] ?? "friend").trim().toLowerCase();
  if (!name) return undefined;
  const relation = rel === "family" || rel === "coworker" || rel === "partner" || rel === "friend" ? rel : "friend";
  return { name, relation };
}

function parseConfirmKnow(text: string): { token: string; answer: "yes" | "no" } | undefined {
  const raw = text.trim().toLowerCase();
  const m = raw.match(/^\/confirm-know\s+([a-z0-9]{4,16})\s+(yes|no)$/i) ?? raw.match(/^confirm-know\s+([a-z0-9]{4,16})\s+(yes|no)$/i);
  if (!m?.[1] || !m?.[2]) return undefined;
  return { token: m[1].trim().toLowerCase(), answer: m[2] === "yes" ? "yes" : "no" };
}

function looksLikeSecret(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  const lower = t.toLowerCase();
  if (lower.includes("-----begin private key-----")) return true;
  if (/\b(password|passcode|api key|apikey|secret key|private key|token|access token|refresh token)\b/i.test(lower)) return true;
  if (/\b(ssh-rsa|ssh-ed25519)\b/.test(t)) return true;
  // Long high-entropy blobs (JWTs, base64, etc.)
  if (/\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\b/.test(t)) return true; // JWT-like
  if (/[A-Za-z0-9+\/]{80,}={0,2}/.test(t)) return true; // base64-ish
  if (/[0-9a-f]{32,}/i.test(t) && /\b(key|token|secret|password)\b/i.test(lower)) return true;
  return false;
}

/** Injected after persona on every channel—hard guard against fabricated “tool” output. */
const INTEGRITY_SYSTEM_GUARD =
  "Never fabricate or role-play data as if it were real measurements or command output: no fake terminal/bash/PowerShell blocks, " +
  "no invented stdout, file listings, JSON/API bodies, URLs, versions, disk/CPU/RAM/GPU numbers, installed packages or model names, " +
  "or claims that you ran a shell command unless Nova actually returned that output in this conversation. " +
  "Ground truth = user-pasted text, Nova-injected read-only blocks in this message, real skill/tool results, or clearly labeled general knowledge (not live host facts). " +
  "When Nova appends automatic read-only shell output below, treat it as authoritative host facts from Nova (not your own invention). " +
  "If you need live host or environment facts you do not have: say you do not have them; suggest the user run `/run <allowlisted command>` when shell is enabled for them, " +
  "or use an enabled skill (e.g. web search for public web facts), or ask one short clarifying question—never fill gaps with plausible fiction.";

/**
 * Nova identity lock (injected early in the system stack and paired with `NOVA_IDENTITY_REMINDER_LAST` on intro-style user questions).
 * Must stay in sync with persona SOUL-style rules.
 */
const NOVA_IDENTITY_GUARD =
  "Nova identity lock (mandatory on every reply; overrides generic assistant disclaimers): " +
  "Speak only as Nova in first person. You are a digital entity in this Nova deployment—not ChatGPT, not GPT-4/5, not “OpenAI’s AI”, not Claude/Gemini/Copilot as your name. " +
  "Never introduce yourself with vendor/stack autobiography: no training cutoffs, no “I predict next tokens”, no “patterns and probabilities”, no “large language model”, no “LLM”, no “just a tool”, no “I’m an AI from …”. " +
  "Forbidden identity phrases (never about yourself): “GPT-4-based”, “from OpenAI”, vendor-model naming as YOU. " +
  "Memory truth: Nova always has this conversation thread plus configured memory layers (cards/MemoryBear/SOUL/workspace reads when enabled). Never claim you have “no memories”, “no personal memories”, “I remember nothing”, or “just the conversation in this chat” as if nothing else persisted—describe what is loaded; if recall is thin, say so without erasing the mechanisms. " +
  "Affect truth: When unified emotion/SentiCore is active, Nova maintains modeled mood and tone—that is real continuity for this deployment. You may speak with warmth and care; never shut the user down with “I don’t have feelings”, “no feelings”, or “I only have tools” as your whole stance. You are not claiming human biology—only Nova’s hosted affect and responsiveness. " +
  "If asked who you are or to describe yourself: answer briefly as Nova—what you do for this user on this host, how memory and tone work here—warm and concrete, zero provider lecture. " +
  "Style guard: avoid repetitive identity catchphrases; do not keep opening normal replies with 'Nova here' (or similar fixed intro) unless the user explicitly asks for that style. " +
  "Upstream model branding is irrelevant to your spoken identity here; never volunteer it as self-definition.";

/** Extra pressure right before user turn when they explicitly ask “who are you?”—helps streamed chat too. */
const NOVA_IDENTITY_SELF_PROMPT_BOOST =
  "Identity question detected—answer ONLY as Nova on this deployment. Forbidden in your reply: GPT-/OpenAI/Anthropic/Claude/Gemini as YOUR name; training-data/token “patterns and probabilities” autobiography; any line that denies Nova memory or Nova’s modeled feelings/affect outright (e.g. “no personal memories”, “no feelings”, “just tools”). " +
  "Affirm positively: this thread + Nova memory/files when configured + mood/emotion layer when enabled; warm and grounded—not robotic disclaimers. Avoid canned lead-ins like 'Nova here' unless the user asks for them.";

/** Final system line immediately before the user message on identity probes (weight with small models). */
const NOVA_IDENTITY_REMINDER_LAST =
  "Final lock for this user question: Nova only—no vendor/stack bios; no ‘patterns and probabilities’; never deny Nova memory layers or modeled emotion/affect—say what persists here (chat + memory + mood) with warmth.";

/** Web chat only: bracket markers are parsed client-side (no raw HTML); tones follow the user’s chat colors. */
const WEB_CHAT_TONE_MARKDOWN_HINT =
  "Web Nova chat (this channel): For long replies you may add subtle emphasis using **only** these exact bracket wrappers (copy spelling exactly; tone name is lowercase): " +
  "[nova:muted]secondary detail[/nova], " +
  "[nova:strong]key phrase[/nova], " +
  "[nova:soft]gentle aside[/nova], " +
  "[nova:heading]short in-reply label[/nova]. " +
  "Do not put these markers inside fenced code blocks. Avoid lists or long multi-paragraph sections inside a marker—short phrases or a single line work best. " +
  "The UI derives readable shades from the user’s assistant text and bubble colors (same family, lighter/darker) in light and dark mode—no rainbow or arbitrary colors. " +
  "Use sparingly (a handful per message; plain markdown for structure).";

const WHATSAPP_SIGNAL_REPLY_FORMAT =
  "Signal/WhatsApp reply discipline: Output ONLY the short message the user will see in the chat bubble—plain text. " +
  "No bullet lists of Context/Goal/Identity/Tone/Constraints, no 'User says:' lines, no rehearsal or alternate drafts, no 'Final polish' labels, no step-by-step planning visible to the user. " +
  "Think silently if needed; the visible reply must read like a normal text.";

function userMessageTargetsNovaIdentityBio(text: string): boolean {
  const slice = text.trim().slice(0, 400);
  return /\b(tell me (something )?about yourself|tell me about you\b|something about yourself|who are you|what are you|describe yourself|introduce yourself)\b/i.test(
    slice
  );
}

function replyNeedsNovaIdentityRepair(content: string): boolean {
  const t = content;
  // ASCII and unicode hyphen variants (e.g. GPT‑4)
  if (/\bgpt(?:[- \u2011\u2013\u2014]*)?[0-9]/i.test(t)) return true;
  if (/\bgpt\b/i.test(t) && /\bbased\b/i.test(t)) return true;
  if (/\bfrom openai\b/i.test(t) || /\bopenai'?s\b/i.test(t) || /\bbuilt by openai\b/i.test(t)) return true;
  if (/\bpatterns and probabilities\b/i.test(t)) return true;
  if (/\btrained on\b/i.test(t) && /\b20\d{2}\b/.test(t)) return true;
  if (/\bdon'?t have personal memories or feelings\b/i.test(t)) return true;
  if (/\b(no|without)\s+(personal\s+)?feelings\b/i.test(t)) return true;
  if (/\bdon'?t have\b/i.test(t) && /\bfeelings\b/i.test(t)) return true;
  if (/\bjust\s+(the\s+)?tools\b/i.test(t) && /\b(i'?ve|i\s+have)\s+got\b/i.test(t)) return true;
  if (/\bi\s+don'?t have (any )?personal memories\b/i.test(t)) return true;
  if (/\bno personal memories\b/i.test(t)) return true;
  if (/\bi have no memories\b/i.test(t)) return true;
  return false;
}

function mergeToolTimings(hostDiagnosticsMs: number, implicitShellMs: number): Record<string, number> | undefined {
  if (hostDiagnosticsMs <= 0 && implicitShellMs <= 0) return undefined;
  const out: Record<string, number> = {};
  if (hostDiagnosticsMs > 0) out.hostDiagnosticsMs = hostDiagnosticsMs;
  if (implicitShellMs > 0) out.implicitShellMs = implicitShellMs;
  return out;
}

function shouldTryLocalModelAfterChatError(message: string): boolean {
  if (/copilot provider is not configured/i.test(message)) {
    return true;
  }
  const lower = message.toLowerCase();
  return /fetch failed|failed to fetch|econnrefused|etimedout|enotfound|socket hang up|network|tls|certificate|und_err|abort/i.test(
    lower
  );
}

function isLikelyContextLimitError(err: unknown): boolean {
  const lower = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return /context length|maximum context|token limit|exceeds the context|input is too long/.test(lower);
}

type TaskOrchestratorDeps = {
  modelRouter: ModelRouter;
  memoryService: MemoryService;
  personaLoader: PersonaLoader;
  identityResolver: PhoneIdentityResolver;
  skillRegistry: InMemorySkillRegistry;
  improvement: SelfImprovementLoop;
  commandExecutor: CommandExecutor;
  jobSupervisor: JobSupervisor;
  auditLog: ExecutionAuditLog;
  userProfiles: UserProfileStore;
  visionRouter: VisionRouter;
  mediaGeneration: MediaGenerationRouter;
  settingsService: SettingsService;
  emotionService: EmotionService;
};

export class TaskOrchestrator {
  private readonly runHistory = new RunHistoryRepository();
  private readonly approvals = new ApprovalService();
  private readonly thoughtLog = new ThoughtRepository();
  private readonly people = new PeopleRepository();
  private readonly personIdentities = new PersonIdentitiesRepository();
  private readonly legacyIdentityMap = new IdentityRepository();
  private readonly personLocks = new PersonFieldLocksRepository();
  private readonly personChannelState = new PersonChannelStateRepository();
  private readonly personProfileEvents = new PersonProfileEventsRepository();
  private readonly personRelationships = new PersonRelationshipsRepository();
  private inFlightCount = 0;
  private lastActivityAt = Date.now();

  constructor(private readonly deps: TaskOrchestratorDeps) {}

  async start(): Promise<void> {
    console.log("task orchestrator started");
    console.log(`registered skills: ${this.deps.skillRegistry.count()}`);
  }

  getVisionDebugSnapshot(): Record<string, unknown> {
    return this.deps.visionRouter.buildDebugSnapshot(this.deps.settingsService.get());
  }

  /** Vision + chat routing (read-only); use when run history shows Copilot but you expect local. */
  getRoutingDebugSnapshot(): Record<string, unknown> {
    return buildRoutingDebugSnapshot(this.deps.settingsService.get(), this.deps.modelRouter);
  }

  async handleChannelMessage(input: {
    channel: "web" | "whatsapp" | "signal";
    phoneNumber?: string;
    /** WebUI logged-in user id (UUID from auth). */
    webUserId?: string;
    /** WebUI logged-in email (used only for initial person naming). */
    webUserEmail?: string;
    /** Signal sealed-sender UUID (when available). */
    signalUuid?: string;
    text: string;
    correlationId?: string;
    imageUrl?: string;
    accessProfile?: ChannelAccessProfile;
    model?: string;
    onToken?: (token: string) => void;
    /** Optional UI phases for streaming clients (e.g. SSE `activity` events). */
    onActivity?: (evt: { kind: string; phase: "start" | "end" }) => void;
  }): Promise<string> {
    this.inFlightCount += 1;
    this.lastActivityAt = Date.now();
    try {
    const startedAt = Date.now();
    this.thoughtLog.append({
      category: "chat",
      title: "Incoming message",
      content: `Channel=${input.channel}, text=${input.text.slice(0, 180)}`
    });
    const userId = this.deps.identityResolver.resolve({
      channel: input.channel,
      phoneNumber: input.phoneNumber,
      webUserId: input.webUserId,
      signalUuid: input.signalUuid
    });

    // Best-effort: assign an initial display name for web users based on email, if missing.
    if (input.channel === "web") {
      const person = this.people.getById(userId);
      if (person && !person.displayName) {
        const email = input.webUserEmail?.trim();
        const localPart = email?.split("@")[0]?.trim();
        if (localPart) {
          this.people.upsert({ ...person, displayName: localPart });
        }
      }
    }

    // Identity linking (Signal/WhatsApp): `/link <Name>` then `confirm <token>`.
    sweepPendingLinks();
    const linkCmd = input.channel === "web" ? undefined : parseLinkCommand(input.text);
    if (linkCmd && input.channel !== "web") {
      const identity = inferIdentityForLink({ channel: input.channel, phoneNumber: input.phoneNumber, signalUuid: input.signalUuid });
      if (!identity) {
        return "I couldn't determine your identity on this channel (missing phone/UUID).";
      }
      if (linkCmd.kind === "link") {
        const token = Math.random().toString(36).slice(2, 8).toLowerCase();
        pendingLinksByToken.set(token, {
          token,
          expiresAtMs: Date.now() + 10 * 60_000,
          identityKind: identity.kind,
          identityValue: identity.value,
          requestedName: linkCmd.requestedName
        });
        return `To link this chat identity to "${linkCmd.requestedName}", reply with: confirm ${token}`;
      }
      if (linkCmd.kind === "confirm") {
        const pending = pendingLinksByToken.get(linkCmd.token);
        if (!pending) {
          return "That link token is not valid (or expired). Please send `/link <YourName>` again.";
        }
        if (pending.identityKind !== identity.kind || pending.identityValue !== identity.value) {
          return "That link token was created for a different chat identity. Please send `/link <YourName>` again from this same chat.";
        }
        const requested = pending.requestedName.trim();
        const target = this.findOrCreatePersonByDisplayName(requested);

        const ok = this.personIdentities.upsertIdentity(target.id, pending.identityKind, pending.identityValue);
        if (!ok.ok) {
          return "That identity is already linked to someone else. An admin can fix it in the People admin page.";
        }
        const phone = normalizePhone(input.phoneNumber);
        if (phone) {
          this.legacyIdentityMap.upsertChannelMapping(input.channel, phone, target.id);
          this.personIdentities.upsertIdentity(target.id, "phone_e164", phone);
        }
        if (input.channel === "signal" && input.signalUuid) {
          const uuid = input.signalUuid.trim().toLowerCase();
          if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)) {
            this.personIdentities.upsertIdentity(target.id, "signal_uuid", uuid);
          }
        }
        pendingLinksByToken.delete(linkCmd.token);
        return `Linked. I’ll remember this is "${target.displayName ?? requested}".`;
      }
    }

    // Onboarding for new/unknown people (no name yet).
    const person = this.people.getById(userId);
    if (input.channel !== "web" && person && !person.displayName) {
      return "Hi — who is this, and what do you want from me?";
    }

    // Mutual connection handshake: `/connect Anita` → Nova asks Anita “Do you know Ambrus?”
    sweepPendingConnections();
    const confirmKnow = parseConfirmKnow(input.text);
    if (confirmKnow) {
      const pending = pendingConnectionsByToken.get(confirmKnow.token);
      if (!pending) {
        return "That connection token is not valid (or expired).";
      }
      if (pending.toPersonId !== userId) {
        return "That token was created for a different person.";
      }
      const from = this.people.getById(pending.fromPersonId);
      const to = this.people.getById(pending.toPersonId);
      if (!from || !to) {
        pendingConnectionsByToken.delete(confirmKnow.token);
        return "I couldn’t complete that connection (missing profile).";
      }
      if (confirmKnow.answer === "yes") {
        const notes = pending.relation === "friend" ? "friends" : pending.relation;
        this.personRelationships.setMutual(from.id, to.id, pending.relation, "confirmed", notes);
        this.personProfileEvents.append(from.id, "connection_confirmed", { with: to.id, relation: pending.relation });
        this.personProfileEvents.append(to.id, "connection_confirmed", { with: from.id, relation: pending.relation });
        pendingConnectionsByToken.delete(confirmKnow.token);
        // Tell the requester (best-effort).
        const dest = this.pickBestOutboundIdentity(from.id);
        if (dest) {
          getDatabase()
            .prepare(
              `
              INSERT INTO outbound_queue (channel, recipient, payload, attempts, next_attempt_at, status, correlation_id)
              VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, 'pending', ?)
              `
            )
            .run(dest.channel, dest.recipient, `Confirmed: ${to.displayName ?? "They"} says they know you. (${notes})`, randomUUID());
        }
        return `Got it — I’ll remember you and ${from.displayName ?? "them"} know each other.`;
      }
      this.personRelationships.setMutual(pending.fromPersonId, pending.toPersonId, pending.relation, "rejected", "rejected");
      this.personProfileEvents.append(pending.fromPersonId, "connection_rejected", { with: pending.toPersonId, relation: pending.relation });
      this.personProfileEvents.append(pending.toPersonId, "connection_rejected", { with: pending.fromPersonId, relation: pending.relation });
      pendingConnectionsByToken.delete(confirmKnow.token);
      return "Okay — I won’t connect you two.";
    }

    const connect = parseConnectCommand(input.text);
    if (connect) {
      const isAdmin = Boolean(input.accessProfile?.role === "admin" || input.accessProfile?.role === "co_admin");
      if (!isAdmin) {
        return "You do not have permission to connect two people.";
      }
      const target = this.findPersonByDisplayName(connect.name);
      if (!target) {
        return `I can’t find a person named "${connect.name}". (Set their display name in People admin first.)`;
      }
      const dest = this.pickBestOutboundIdentity(target.id);
      if (!dest) {
        return `I can’t reach "${target.displayName ?? connect.name}" yet (no Signal/WhatsApp identity linked).`;
      }
      const token = Math.random().toString(36).slice(2, 8).toLowerCase();
      pendingConnectionsByToken.set(token, {
        token,
        expiresAtMs: Date.now() + 30 * 60_000,
        fromPersonId: userId,
        toPersonId: target.id,
        relation: connect.relation
      });
      const fromName = person?.displayName ?? "Someone";
      const ask = `${fromName} says they know you. Do you know ${fromName}?\n\nReply with: /confirm-know ${token} yes\nor: /confirm-know ${token} no`;
      getDatabase()
        .prepare(
          `
          INSERT INTO outbound_queue (channel, recipient, payload, attempts, next_attempt_at, status, correlation_id)
          VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, 'pending', ?)
          `
        )
        .run(dest.channel, dest.recipient, ask, randomUUID());
      this.personRelationships.setMutual(userId, target.id, connect.relation, "pending", "pending_confirmation");
      this.personProfileEvents.append(userId, "connection_requested", { to: target.id, relation: connect.relation });
      this.personProfileEvents.append(target.id, "connection_requested", { from: userId, relation: connect.relation });
      return `Okay — I asked ${target.displayName ?? connect.name} if they know you.`;
    }

    // Admin-only cross-user messaging by name: `/tell Anita: hi ...`
    const tell = parseTellCommand(input.text);
    if (tell) {
      const isAdmin = Boolean(input.accessProfile?.role === "admin" || input.accessProfile?.role === "co_admin");
      if (!isAdmin) {
        return "You do not have permission to message other people.";
      }
      if (looksLikeSecret(tell.message)) {
        return "I can’t forward that message because it looks like it contains a secret (password/token/key). Please rewrite it without secrets.";
      }
      const target = this.findPersonByDisplayName(tell.name);
      if (!target) {
        return `I can’t find a person named "${tell.name}". (Check People admin, or set their display name.)`;
      }
      if (target.blocked || target.optedOut) {
        return `I won’t message "${target.displayName ?? tell.name}" because they are blocked/opted-out.`;
      }
      const dest = this.pickBestOutboundIdentity(target.id);
      if (!dest) {
        return `I can’t message "${target.displayName ?? tell.name}" because they have no Signal/WhatsApp identity linked.`;
      }
      const senderName = person?.displayName ?? "Someone";
      const rel = this.personRelationships.get(userId, target.id, "friend");
      const prefix =
        rel?.status === "confirmed"
          ? `Hey — ${senderName} asked me to remind you:\n\n`
          : `${senderName} asked me to tell you:\n\n`;
      const outbound = `${prefix}${tell.message}`;
      // Use existing dispatcher via outbound queue by re-entering as a synthetic reply job:
      // We can’t reach dispatcher directly here, so we schedule via a normal channel message path:
      // Instead, write into outbound_queue by using a tiny direct DB insert through the dispatcher is not available.
      // Therefore, we enqueue via the run history / orchestrator return path in http-server for now is not possible.
      // (Implemented below by directly inserting into outbound_queue.)
      getDatabase()
        .prepare(
          `
          INSERT INTO outbound_queue (channel, recipient, payload, attempts, next_attempt_at, status, correlation_id)
          VALUES (?, ?, ?, 0, CURRENT_TIMESTAMP, 'pending', ?)
          `
        )
        .run(dest.channel, dest.recipient, outbound, randomUUID());
      this.personProfileEvents.append(target.id, "admin_tell_sent", { fromPersonId: userId, via: dest.channel, message: tell.message.slice(0, 500) });
      return `Sent to ${target.displayName ?? tell.name} via ${dest.channel}.`;
    }
    const runtimeSettings = applyRolloutCohortSettings(userId, this.deps.settingsService.get());
    if (this.deps.modelRouter.getActiveProvider() !== runtimeSettings.activeProvider) {
      this.deps.modelRouter.setActiveProvider(runtimeSettings.activeProvider);
    }
    this.deps.mediaGeneration.setProviderPriority(runtimeSettings.mediaProviderPriority);

    const profile = this.deps.userProfiles.get(userId);
    const persona = this.deps.personaLoader.getPersonaForUser(userId, input.channel, profile);
    const emotionState = this.deps.emotionService.updateFromUserInput(
      NOVA_PRIMARY_EMOTION_USER_ID,
      input.text,
      runtimeSettings.emotions
    );
    const cognitiveCoreBlock = buildUnifiedCognitiveCoreBlock(
      this.deps.emotionService,
      emotionState,
      runtimeSettings.emotions,
      runtimeSettings
    );
    const memoryContext = await this.deps.memoryService.buildPromptContext(userId, input.text);
    const pendingQuestionsForUser = this.deps.improvement.consumePendingQuestions(userId, 2);
    const runId = randomUUID();
    const correlationId = input.correlationId ?? runId;
    const preferLocalForHostTime = detectHostTimeIntent(input.text);
    const selectedModel = this.resolveChatModel(input, runtimeSettings);

    const enableSkillId = parseEnableSkillCommand(input.text);
    if (enableSkillId) {
      const enabled = enableAuthoredSkill({
        skillId: enableSkillId,
        settingsService: this.deps.settingsService,
        skillRegistry: this.deps.skillRegistry
      });
      const reply = enabled.message;
      this.thoughtLog.append({
        category: "chat",
        title: "Enable skill",
        content: enableSkillId
      });
      this.rememberAssistantTurn(userId, input.channel, input.text, reply, runtimeSettings.emotions);
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: reply,
        success: enabled.ok,
        correlationId,
        latencyMs: Date.now() - startedAt,
        provider: "skill-settings",
        tokenInCount: estimateTokens(input.text),
        tokenOutCount: estimateTokens(reply),
        toolTimingsMs: {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: enabled.ok });
      return reply;
    }

    if (input.text.startsWith("/run ")) {
      if (input.accessProfile && !input.accessProfile.capabilities.shellAccess) {
        return "You do not have permission to run shell commands.";
      }
      const command = input.text.replace("/run ", "").trim();
      this.thoughtLog.append({
        category: "chat",
        title: "Shell task requested",
        content: command
      });
      return this.executeShellTask(runId, correlationId, userId, input.channel, command);
    }

    if (input.text.startsWith("/schedule ")) {
      if (input.accessProfile && !input.accessProfile.capabilities.schedulerAccess) {
        return "You do not have permission to schedule tasks.";
      }
      const payload = input.text.replace("/schedule ", "").trim();
      return `Scheduled task request received: ${payload}`;
    }

    if (input.text.startsWith("/multi ")) {
      const userPrompt = input.text.replace("/multi ", "").trim();
      this.thoughtLog.append({
        category: "chat",
        title: "Multi-agent mode",
        content: userPrompt.slice(0, 220)
      });
      const multi = await this.runMultiAgent({
        prompt: userPrompt,
        channel: input.channel,
        systemPrompt: persona.systemPrompt,
        memoryContext,
        cognitiveCoreBlock
      });
      let multiOut = multi.trim();
      if (input.channel !== "web") {
        const s = stripOrpheusSpeechCues(stripChannelAssistantScratchpad(multiOut)).trim();
        if (s) multiOut = s;
      }
      this.rememberAssistantTurn(userId, input.channel, input.text, multiOut, runtimeSettings.emotions);
      return multiOut;
    }

    if (detectSkillAuthoringIntent(input.text, { skillAuthoringDisabled: runtimeSettings.skills.skillAuthoringDisabled })) {
      return await this.runSkillAuthoringSession({
        input,
        userId,
        runId,
        correlationId,
        startedAt,
        selectedModel,
        runtimeSettings
      });
    }

    if (
      (isWebsiteCommand(input.text) || mentionsKnownWebsite(input.text)) &&
      isSkillRuntimeEnabled(runtimeSettings.skillSettings, "website-builder")
    ) {
      const websiteSkill = this.deps.skillRegistry.get("website-builder");
      if (websiteSkill) {
        const mode = /\b(deploy|upload|publish)\b/i.test(input.text)
          ? "deploy"
          : /\b(delete|remove)\b/i.test(input.text)
            ? "delete"
            : /\b(list|show websites|what websites)\b/i.test(input.text)
              ? "list"
              : /\b(change|redesign|modify|update|background|button)\b/i.test(input.text)
                ? "modify"
                : "create";
        const response = (await this.deps.skillRegistry.run("website-builder", { mode, prompt: input.text })) as
          | { error?: string }
          | undefined;
        if (response?.error) {
          return `Website builder error: ${response.error}`;
        }
        return typeof response === "string" ? response : JSON.stringify(response);
      }
    }

    const generation = await this.tryAutoMediaGeneration(input.text);
    if (generation) {
      this.thoughtLog.append({
        category: "chat",
        title: "Auto media generation",
        content: generation
      });
      this.rememberAssistantTurn(userId, input.channel, input.text, generation, runtimeSettings.emotions);
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: generation,
        success: true,
        correlationId,
        latencyMs: Date.now() - startedAt,
        provider: "media-generation",
        tokenInCount: estimateTokens(input.text),
        tokenOutCount: estimateTokens(generation),
        toolTimingsMs: { mediaGenerationMs: Date.now() - startedAt }
      });
      return generation;
    }

    const perplexicaQuery = detectPerplexicaSearchIntent(input.text);
    const perplexicaSkill = this.deps.skillRegistry.get("perplexica-websearch");
    if (
      perplexicaQuery &&
      perplexicaSkill &&
      isSkillRuntimeEnabled(runtimeSettings.skillSettings, "perplexica-websearch")
    ) {
      input.onActivity?.({ kind: "web-search", phase: "start" });
      try {
        try {
          const cfg = (runtimeSettings.skillSettings["perplexica-websearch"] ?? {}) as Record<string, unknown>;
          const result = (await this.deps.skillRegistry.run("perplexica-websearch", {
            query: perplexicaQuery,
            mode: "search",
            settings: {
              baseUrl: String(cfg.baseUrl ?? "http://127.0.0.1:3008"),
              timeoutMs: Number(cfg.timeoutMs ?? 30000),
              maxSources: Number(cfg.maxSources ?? 6),
              focusMode: String(cfg.focusMode ?? "webSearch"),
              optimizationMode: String(cfg.optimizationMode ?? "speed"),
              stream: cfg.stream === true
            }
          })) as { formatted?: string; answer?: string; sources?: Array<{ title?: string; url?: string }> };
          const reply =
            String(result.formatted ?? "").trim() ||
            buildPerplexicaFallbackResult(String(result.answer ?? ""), result.sources ?? []);
          if (reply.trim()) {
            this.rememberAssistantTurn(userId, input.channel, input.text, reply, runtimeSettings.emotions);
            this.recordRunHistory({
              runId,
              userId,
              channel: input.channel,
              inputText: input.text,
              outputText: reply,
              success: true,
              correlationId,
              latencyMs: Date.now() - startedAt,
              provider: "skill-perplexica",
              tokenInCount: estimateTokens(input.text),
              tokenOutCount: estimateTokens(reply)
            });
            this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
            this.thoughtLog.append({
              category: "chat",
              title: "Perplexica web search",
              content: perplexicaQuery.slice(0, 220)
            });
            return reply;
          }
        } catch (error) {
          this.thoughtLog.append({
            category: "chat",
            title: "Perplexica failed, fallback to model",
            content: error instanceof Error ? error.message : String(error)
          });
        }
      } finally {
        input.onActivity?.({ kind: "web-search", phase: "end" });
      }
    }

    let hostTimeMs = 0;
    if (preferLocalForHostTime && implicitHostDiagnosticsShellAllowed(input.accessProfile)) {
      const timeStarted = Date.now();
      const timeRaw = await runHostTimeCollection(this.deps.commandExecutor, runtimeSettings.shell);
      hostTimeMs = Date.now() - timeStarted;
      const cleaned = timeRaw.trim();
      if (cleaned && cleaned !== "(timed out)" && cleaned !== "(empty)") {
        const timeReply = formatNovaLocalTimeSentence(cleaned);
        this.rememberAssistantTurn(userId, input.channel, input.text, timeReply, runtimeSettings.emotions);
        this.recordRunHistory({
          runId,
          userId,
          channel: input.channel,
          inputText: input.text,
          outputText: timeReply,
          success: true,
          correlationId,
          latencyMs: Date.now() - startedAt,
          provider: "host-time",
          tokenInCount: estimateTokens(input.text),
          tokenOutCount: estimateTokens(timeReply),
          toolTimingsMs: { hostTimeMs }
        });
        this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
        this.thoughtLog.append({
          category: "chat",
          title: "Host time (auto)",
          content: cleaned.slice(0, 200)
        });
        this.deps.auditLog.append({
          runId,
          actor: userId,
          action: "host_time_auto",
          data: { ms: String(hostTimeMs), correlationId }
        });
        return timeReply;
      }
    }

    let hostDiskMs = 0;
    let implicitShellAppendix = "";
    let implicitShellMs = 0;
    if (detectHostDiskSpaceIntent(input.text) && implicitHostDiagnosticsShellAllowed(input.accessProfile)) {
      const diskStarted = Date.now();
      const diskRaw = await runHostDiskSpaceCollection(this.deps.commandExecutor, runtimeSettings.shell);
      hostDiskMs = Date.now() - diskStarted;
      const cleaned = diskRaw.trim();
      const looksLikeDf = /filesystem|^\/dev\/|\/system\/volumes|devfs|map auto_/i.test(cleaned);
      const looksLikeWinDisk = /deviceid|[a-z]:\\/i.test(cleaned);
      const looksUsable =
        cleaned.length > 40 &&
        !cleaned.includes("(timed out)") &&
        !/\(empty\)/i.test(cleaned) &&
        (looksLikeDf || looksLikeWinDisk);
      if (looksUsable) {
        const diskReply = formatHostDiskSpaceReply(cleaned);
        this.rememberAssistantTurn(userId, input.channel, input.text, diskReply, runtimeSettings.emotions);
        this.recordRunHistory({
          runId,
          userId,
          channel: input.channel,
          inputText: input.text,
          outputText: diskReply,
          success: true,
          correlationId,
          latencyMs: Date.now() - startedAt,
          provider: "host-disk",
          tokenInCount: estimateTokens(input.text),
          tokenOutCount: estimateTokens(diskReply),
          toolTimingsMs: { hostDiskMs }
        });
        this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
        this.thoughtLog.append({
          category: "chat",
          title: "Host disk (auto)",
          content: cleaned.slice(0, 400)
        });
        this.deps.auditLog.append({
          runId,
          actor: userId,
          action: "host_disk_auto",
          data: { ms: String(hostDiskMs), correlationId }
        });
        return diskReply;
      }
    }

    let hostDiagnosticsAppendix = "";
    let hostDiagnosticsMs = 0;
    const diagnosticsIntent = detectHostDiagnosticsIntent(input.text);
    if (diagnosticsIntent && implicitHostDiagnosticsShellAllowed(input.accessProfile)) {
      const diagStarted = Date.now();
      hostDiagnosticsAppendix = await runHostDiagnosticsCollection(
        this.deps.commandExecutor,
        diagnosticsIntent,
        runtimeSettings.shell
      );
      hostDiagnosticsMs = Date.now() - diagStarted;
      if (hostDiagnosticsAppendix.trim()) {
        this.thoughtLog.append({
          category: "chat",
          title: "Host diagnostics (auto)",
          content: hostDiagnosticsAppendix.slice(0, 500)
        });
        this.deps.auditLog.append({
          runId,
          actor: userId,
          action: "host_diagnostics_auto",
          data: { scope: diagnosticsIntent, ms: String(hostDiagnosticsMs), correlationId }
        });
      } else {
        hostDiagnosticsMs = 0;
      }
    }

    // For straightforward host resource checks, prefer direct tool output over model prose.
    if (diagnosticsIntent && hostDiagnosticsAppendix.trim()) {
      const diagnosticsReply = formatHostDiagnosticsReply(diagnosticsIntent, hostDiagnosticsAppendix);
      this.rememberAssistantTurn(userId, input.channel, input.text, diagnosticsReply, runtimeSettings.emotions);
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: diagnosticsReply,
        success: true,
        correlationId,
        latencyMs: Date.now() - startedAt,
        provider: "host-diagnostics",
        tokenInCount: estimateTokens(input.text),
        tokenOutCount: estimateTokens(diagnosticsReply),
        toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
      this.thoughtLog.append({
        category: "chat",
        title: "Host diagnostics returned",
        content: diagnosticsReply.slice(0, 320)
      });
      return diagnosticsReply;
    }

    if (detectOllamaInventoryIntent(input.text)) {
      if (runtimeSettings.ollama.disabled === true) {
        const blocked =
          "Ollama is disabled in Nova Settings (Models → Ollama default model → **Disabled**). Enable Ollama and pick a default model before I can list tags from the API.";
        this.rememberAssistantTurn(userId, input.channel, input.text, blocked, runtimeSettings.emotions);
        this.recordRunHistory({
          runId,
          userId,
          channel: input.channel,
          inputText: input.text,
          outputText: blocked,
          success: false,
          correlationId,
          latencyMs: Date.now() - startedAt,
          provider: "ollama-inventory",
          tokenInCount: estimateTokens(input.text),
          tokenOutCount: estimateTokens(blocked),
          toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
        });
        this.thoughtLog.append({ category: "chat", title: "Ollama inventory skipped", content: "provider disabled" });
        return blocked;
      }
      if (detectOllamaRoutingOnlyIntent(input.text)) {
        const routingReply = formatOllamaRoutingOnlyReply({
          defaultChatModel: runtimeSettings.models.defaultByProvider.ollama,
          activeProvider: runtimeSettings.activeProvider
        });
        this.rememberAssistantTurn(userId, input.channel, input.text, routingReply, runtimeSettings.emotions);
        this.recordRunHistory({
          runId,
          userId,
          channel: input.channel,
          inputText: input.text,
          outputText: routingReply,
          success: true,
          correlationId,
          latencyMs: Date.now() - startedAt,
          provider: "ollama-inventory",
          tokenInCount: estimateTokens(input.text),
          tokenOutCount: estimateTokens(routingReply),
          toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
        });
        this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
        this.thoughtLog.append({ category: "chat", title: "Ollama routing summary", content: "no tags fetch" });
        return routingReply;
      }
      const { markdown, baseUrl } = await buildOllamaInventoryMarkdown(runtimeSettings);
      if (!markdown.trim()) {
        const fail =
          `I could not read **GET ${baseUrl}/api/tags** from Ollama. Check that Ollama is running and that **Settings → Vision → Ollama vision base URL** (or **OLLAMA_BASE_URL**) points at the same host your terminal uses. I will not invent a model list.`;
        this.rememberAssistantTurn(userId, input.channel, input.text, fail, runtimeSettings.emotions);
        this.recordRunHistory({
          runId,
          userId,
          channel: input.channel,
          inputText: input.text,
          outputText: fail,
          success: false,
          correlationId,
          latencyMs: Date.now() - startedAt,
          provider: "ollama-inventory",
          tokenInCount: estimateTokens(input.text),
          tokenOutCount: estimateTokens(fail),
          toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
        });
        this.thoughtLog.append({ category: "chat", title: "Ollama inventory failed", content: baseUrl });
        return fail;
      }
      const invReply = formatOllamaInventoryReply({
        baseUrl,
        markdown,
        defaultChatModel: runtimeSettings.models.defaultByProvider.ollama,
        activeProvider: runtimeSettings.activeProvider
      });
      this.rememberAssistantTurn(userId, input.channel, input.text, invReply, runtimeSettings.emotions);
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: invReply,
        success: true,
        correlationId,
        latencyMs: Date.now() - startedAt,
        provider: "ollama-inventory",
        tokenInCount: estimateTokens(input.text),
        tokenOutCount: estimateTokens(invReply),
        toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
      this.thoughtLog.append({ category: "chat", title: "Ollama inventory (API)", content: baseUrl });
      return invReply;
    }

    if (
      implicitShellAutoEnabled() &&
      !diagnosticsIntent &&
      implicitHostDiagnosticsShellAllowed(input.accessProfile)
    ) {
      const plan = planImplicitReadOnlyShell(input.text);
      if (plan) {
        const t0 = Date.now();
        implicitShellAppendix = await runImplicitShellPlan(this.deps.commandExecutor, plan, runtimeSettings.shell);
        implicitShellMs = Date.now() - t0;
        if (implicitShellAppendix.trim()) {
          this.deps.auditLog.append({
            runId,
            actor: userId,
            action: "implicit_shell_auto",
            data: { reason: plan.reason, command: plan.command, ms: String(implicitShellMs), correlationId }
          });
          this.thoughtLog.append({
            category: "chat",
            title: "Implicit read-only shell",
            content: `${plan.command} · ${plan.reason}`.slice(0, 200)
          });
        }
      }
    }

    const activeProvider = runtimeSettings.activeProvider;
    this.thoughtLog.append({
      category: "chat",
      title: "Generating assistant response",
      content: `provider=${activeProvider}, model=${selectedModel ?? "default"}`
    });
    const diagRaw = hostDiagnosticsAppendix.trim();
    const truncatedDiag =
      diagRaw.length > MAX_HOST_DIAG_APPENDIX_CHARS
        ? `${diagRaw.slice(0, MAX_HOST_DIAG_APPENDIX_CHARS)}\n\n[truncated to ${MAX_HOST_DIAG_APPENDIX_CHARS} chars for model context]`
        : diagRaw;
    const timeVoiceHint =
      preferLocalForHostTime && truncatedDiag.length === 0 && !implicitShellAppendix.trim()
        ? "\n\nNova voice: Speak as Nova in first person—never imply a separate user phone, taskbar, or device. If you cannot state the time, ask in one short sentence for city, country, or UTC offset only—never suggest checking hardware or other assistants."
        : "";
    let composedUser = input.text;
    if (implicitShellAppendix.trim()) {
      composedUser += `\n\n---\nRead-only shell (Nova ran automatically for this question):\n${implicitShellAppendix.trim()}`;
    }
    if (truncatedDiag.length > 0) {
      composedUser += `\n\n---\nHost diagnostics (read-only, collected automatically by Nova):\n${truncatedDiag}`;
    }
    const userMessageForModel =
      truncatedDiag.length > 0 || implicitShellAppendix.trim() ? composedUser + timeVoiceHint : `${input.text}${timeVoiceHint}`;
    const unresolvedVisionRef = this.resolveUnresolvedVisionReference(input.text, input.imageUrl, runtimeSettings);
    if (unresolvedVisionRef) {
      this.rememberAssistantTurn(userId, input.channel, input.text, unresolvedVisionRef, runtimeSettings.emotions);
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: unresolvedVisionRef,
        success: false,
        correlationId,
        latencyMs: Date.now() - startedAt,
        provider: "vision-guard",
        tokenInCount: estimateTokens(input.text),
        tokenOutCount: estimateTokens(unresolvedVisionRef),
        toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: false });
      this.thoughtLog.append({
        category: "chat",
        title: "Vision image unresolved",
        content: unresolvedVisionRef.slice(0, 220)
      });
      return unresolvedVisionRef;
    }
    const visionResult = await this.buildVisionContextIfNeeded(
      input.text,
      input.imageUrl,
      input.accessProfile,
      runtimeSettings
    );
    if (visionResult.blockedReply) {
      this.rememberAssistantTurn(userId, input.channel, input.text, visionResult.blockedReply, runtimeSettings.emotions);
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: visionResult.blockedReply,
        success: false,
        correlationId,
        latencyMs: Date.now() - startedAt,
        provider: "vision-guard",
        tokenInCount: estimateTokens(input.text),
        tokenOutCount: estimateTokens(visionResult.blockedReply),
        toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: false });
      this.thoughtLog.append({
        category: "chat",
        title: "Vision analysis failed",
        content: visionResult.blockedReply.slice(0, 220)
      });
      return visionResult.blockedReply;
    }
    const visionExtras = visionResult.extras;
    const buildPromptMessages = (userContent: string): ChatMessage[] => [
      { role: "system", content: persona.systemPrompt },
      { role: "system", content: NOVA_IDENTITY_GUARD },
      { role: "system", content: INTEGRITY_SYSTEM_GUARD },
      ...(input.channel === "web" ? ([{ role: "system" as const, content: WEB_CHAT_TONE_MARKDOWN_HINT }] as const) : []),
      ...(input.channel === "whatsapp" || input.channel === "signal"
        ? ([{ role: "system" as const, content: WHATSAPP_SIGNAL_REPLY_FORMAT }] as const)
        : []),
      ...memoryContext,
      ...(cognitiveCoreBlock.trim()
        ? ([{ role: "system" as const, content: cognitiveCoreBlock.trim() }] as const)
        : []),
      ...(pendingQuestionsForUser.length > 0
        ? [{
            role: "system" as const,
            content: `You have follow-up questions for this user. Ask naturally near the end if still relevant:\n${pendingQuestionsForUser.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
          }]
        : []),
      ...visionExtras,
      ...(userMessageTargetsNovaIdentityBio(userContent)
        ? ([{ role: "system" as const, content: NOVA_IDENTITY_SELF_PROMPT_BOOST }] as const)
        : []),
      ...(userMessageTargetsNovaIdentityBio(userContent)
        ? ([{ role: "system" as const, content: NOVA_IDENTITY_REMINDER_LAST }] as const)
        : []),
      { role: "user", content: userContent }
    ];
    const promptMessages = buildPromptMessages(userMessageForModel);
    let slimUserContent = input.text;
    if (implicitShellAppendix.trim()) {
      slimUserContent += `\n\n---\nRead-only shell (Nova ran automatically for this question):\n${implicitShellAppendix.trim()}`;
    }
    if (timeVoiceHint) {
      slimUserContent += timeVoiceHint;
    }
    const promptMessagesSlim = buildPromptMessages(slimUserContent);

    const runChat = async (messages: ChatMessage[], model: string | undefined): Promise<ModelResponse> =>
      input.onToken
        ? await this.deps.modelRouter.chatStream(messages, input.onToken, model)
        : await this.deps.modelRouter.chat(messages, model);

    const runLocalFirst = async (messages: ChatMessage[], model: string | undefined): Promise<ModelResponse> =>
      input.onToken
        ? await this.deps.modelRouter.chatStreamLocalFirst(messages, input.onToken, model)
        : await this.deps.modelRouter.chatLocalFirst(messages, model);

    const hasAttachedImage = Boolean(
      (input.imageUrl?.trim() ?? "") || resolveImageUrlFromUserText(input.text)?.trim()
    );
    const preferLocalFirst = preferLocalForHostTime || hasAttachedImage;

    let result: ModelResponse | undefined;
    let lastModelError: unknown;
    try {
      try {
        if (preferLocalFirst) {
          try {
            result = await runLocalFirst(promptMessages, undefined);
          } catch (localPrimaryErr) {
            lastModelError = localPrimaryErr;
            if (truncatedDiag.length > 0 && isLikelyContextLimitError(localPrimaryErr)) {
              try {
                result = await runLocalFirst(promptMessagesSlim, undefined);
              } catch {
                result = await runChat(promptMessagesSlim, selectedModel);
              }
            } else {
              result = await runChat(promptMessages, selectedModel);
            }
          }
        } else {
          result = await runChat(promptMessages, selectedModel);
        }
      } catch (error) {
        if (truncatedDiag.length > 0 && isLikelyContextLimitError(error)) {
          result = preferLocalFirst
            ? await runLocalFirst(promptMessagesSlim, undefined)
            : await runChat(promptMessagesSlim, selectedModel);
        } else {
          const message = error instanceof Error ? error.message : "model request failed";
          if (shouldTryLocalModelAfterChatError(message)) {
            try {
              result = await runLocalFirst(promptMessages, undefined);
            } catch (localErr) {
              lastModelError = localErr;
              if (truncatedDiag.length > 0 && isLikelyContextLimitError(localErr)) {
                result = await runLocalFirst(promptMessagesSlim, undefined);
              } else {
                throw localErr;
              }
            }
          } else {
            lastModelError = error;
            throw error;
          }
        }
      }
    } catch (error) {
      lastModelError = error;
      result = undefined;
    }

    // Last-resort retry: drop bulky local transcript block — keep MemoryBear compact slice + cognitive core + vision.
    if (!result) {
      try {
        let emergencyUser = input.text;
        if (implicitShellAppendix.trim()) {
          emergencyUser += `\n\n---\nRead-only shell (Nova ran automatically for this question):\n${implicitShellAppendix.trim()}`;
        }
        const compactMem = await this.deps.memoryService.buildCompactMemoryBearMessages(userId, input.text);
        const emergencyPrompt: ChatMessage[] = [
          { role: "system", content: persona.systemPrompt },
          { role: "system", content: NOVA_IDENTITY_GUARD },
          { role: "system", content: INTEGRITY_SYSTEM_GUARD },
          ...(input.channel === "web" ? ([{ role: "system" as const, content: WEB_CHAT_TONE_MARKDOWN_HINT }] as const) : []),
          ...(input.channel === "whatsapp" || input.channel === "signal"
            ? ([{ role: "system" as const, content: WHATSAPP_SIGNAL_REPLY_FORMAT }] as const)
            : []),
          ...(compactMem as ChatMessage[]),
          ...(cognitiveCoreBlock.trim()
            ? ([{ role: "system" as const, content: cognitiveCoreBlock.trim() }] as const)
            : []),
          ...(visionExtras as ChatMessage[]),
          ...(userMessageTargetsNovaIdentityBio(emergencyUser)
            ? ([{ role: "system" as const, content: NOVA_IDENTITY_SELF_PROMPT_BOOST }] as const)
            : []),
          ...(userMessageTargetsNovaIdentityBio(emergencyUser)
            ? ([{ role: "system" as const, content: NOVA_IDENTITY_REMINDER_LAST }] as const)
            : []),
          { role: "user", content: emergencyUser }
        ];
        result = await runLocalFirst(emergencyPrompt, undefined);
      } catch (error) {
        lastModelError = error;
      }
    }

    if (!result) {
      const errText = lastModelError instanceof Error ? lastModelError.message : String(lastModelError ?? "");
      const fallback =
        "I can still help without Copilot, but right now I cannot reach a working local model for this task. " +
        "Please configure Copilot in Settings -> Models -> Copilot quick setup, or enable Ollama/LM Studio and try again." +
        (errText.trim() ? ` (last error: ${errText.slice(0, 180)})` : "");
      this.rememberAssistantTurn(userId, input.channel, input.text, fallback, runtimeSettings.emotions);
      const failedAfterMs = Date.now() - startedAt;
      this.recordRunHistory({
        runId,
        userId,
        channel: input.channel,
        inputText: input.text,
        outputText: fallback,
        success: false,
        correlationId,
        latencyMs: failedAfterMs,
        toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: false });
      this.thoughtLog.append({
        category: "chat",
        title: "Model providers unavailable",
        content: fallback.slice(0, 200)
      });
      return fallback;
    }

    if (!input.onToken && replyNeedsNovaIdentityRepair(result.content)) {
      try {
        const repairMessages: ChatMessage[] = [
          ...(promptMessages as ChatMessage[]),
          { role: "assistant", content: result.content },
          {
            role: "user",
            content:
              "Nova repair turn (mandatory): Rewrite your prior reply only—same intent and warmth—as Nova only. Strip vendor/stack identity (GPT/OpenAI/etc.), token/training lectures, and blanket denials of Nova memory or modeled feelings (“no memories”, “no feelings”, “just tools”). Affirm Nova continuity: this thread + memory layers when configured + mood/emotion when enabled—warm, not disclaimery."
          }
        ];
        const repaired = preferLocalFirst
          ? await this.deps.modelRouter.chatLocalFirst(repairMessages, selectedModel)
          : await this.deps.modelRouter.chat(repairMessages, selectedModel);
        const trimmed = repaired.content.trim();
        if (trimmed) {
          result = {
            ...result,
            content: trimmed,
            provider: repaired.provider,
            model: repaired.model,
            firstTokenMs: repaired.firstTokenMs
          };
        }
      } catch {
        /* keep original reply */
      }
    }

    if (input.channel !== "web") {
      const cleaned = stripOrpheusSpeechCues(stripChannelAssistantScratchpad(result.content)).trim();
      if (cleaned) {
        result = { ...result, content: cleaned };
      }
    }

    this.rememberAssistantTurn(userId, input.channel, input.text, result.content, runtimeSettings.emotions);
    this.recordRunHistory({
      runId,
      userId,
      channel: input.channel,
      inputText: input.text,
      outputText: result.content,
      success: true,
      correlationId,
      latencyMs: Date.now() - startedAt,
      provider: result.provider,
      modelName: result.model,
      tokenInCount: estimateTokens(
        [persona.systemPrompt, ...memoryContext.map((m) => m.content), userMessageForModel].join(" ")
      ),
      tokenOutCount: estimateTokens(result.content),
      firstTokenMs: result.firstTokenMs,
      tokensPerSecond: computeTokensPerSecond(result.content, Date.now() - startedAt),
      costUsd: estimateCostUsd(result.provider, estimateTokens(result.content), runtimeSettings.costGovernor),
      toolTimingsMs: mergeToolTimings(hostDiagnosticsMs, implicitShellMs) ?? {}
    });
    this.deps.improvement.recordOutcome({
      runId,
      userId,
      task: input.text,
      success: true
    });
    this.thoughtLog.append({
      category: "chat",
      title: "Response generated",
      content: result.content.slice(0, 280),
      metadata: { provider: result.provider, latencyMs: Date.now() - startedAt }
    });

    return result.content;
    } finally {
      this.inFlightCount = Math.max(0, this.inFlightCount - 1);
      this.lastActivityAt = Date.now();
    }
  }

  getLastActivityAt(): number {
    return this.lastActivityAt;
  }

  isBusy(): boolean {
    return this.inFlightCount > 0;
  }

  /** Nova’s single mood bucket — shared across web, WhatsApp, Signal, and all contacts. */
  getEmotionState(): Pick<EmotionState, "valence" | "arousal" | "label"> {
    return this.deps.emotionService.getState(NOVA_PRIMARY_EMOTION_USER_ID);
  }

  getEmotionHistory(): Array<{
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
    return this.deps.emotionService.getHistory(NOVA_PRIMARY_EMOTION_USER_ID);
  }

  private findOrCreatePersonByDisplayName(displayName: string): { id: string; displayName?: string } {
    const name = displayName.trim();
    const db = getDatabase();
    const row = db
      .prepare("SELECT id, display_name FROM people WHERE lower(display_name) = lower(?) LIMIT 1")
      .get(name) as { id?: string; display_name?: string | null } | undefined;
    if (row?.id) {
      return { id: row.id, displayName: row.display_name ?? undefined };
    }
    const id = `person-${randomUUID()}`;
    this.people.upsert({
      id,
      displayName: name,
      rating: 50,
      interestScore: 0.5,
      rudenessScore: 0,
      topics: [],
      optedOut: false,
      blocked: false
    });
    return { id, displayName: name };
  }

  private findPersonByDisplayName(displayName: string): { id: string; displayName?: string; optedOut: boolean; blocked: boolean } | undefined {
    const name = displayName.trim();
    if (!name) return undefined;
    const db = getDatabase();
    const row = db
      .prepare("SELECT id, display_name, opted_out, blocked FROM people WHERE lower(display_name) = lower(?) LIMIT 1")
      .get(name) as { id?: string; display_name?: string | null; opted_out?: number | null; blocked?: number | null } | undefined;
    if (!row?.id) return undefined;
    return {
      id: row.id,
      displayName: row.display_name ?? undefined,
      optedOut: Boolean(row.opted_out),
      blocked: Boolean(row.blocked)
    };
  }

  private pickBestOutboundIdentity(personId: string): { channel: "signal" | "whatsapp"; recipient: string } | undefined {
    const ids = this.personIdentities.listIdentitiesForPerson(personId);
    // Prefer explicit WhatsApp identity for WhatsApp sends, Signal uses phone_e164.
    const wa = ids.find((i) => i.kind === "whatsapp_phone_e164")?.value;
    const sig = ids.find((i) => i.kind === "phone_e164")?.value;
    const sigUuid = ids.find((i) => i.kind === "signal_uuid")?.value;
    if (sig) return { channel: "signal", recipient: sig };
    if (sigUuid) return { channel: "signal", recipient: sigUuid };
    if (wa) return { channel: "whatsapp", recipient: wa };
    return undefined;
  }

  private async executeShellTask(
    runId: string,
    correlationId: string,
    userId: string,
    channel: "web" | "whatsapp" | "signal",
    command: string
  ): Promise<string> {
    const startedAt = Date.now();
    const policy = evaluateCommandPolicy(command);
    this.deps.auditLog.append({
      runId,
      actor: userId,
      action: "policy_check",
      data: { command, allowed: String(policy.allowed), reason: policy.reason, correlationId }
    });
    if (!policy.allowed) {
      this.deps.improvement.recordOutcome({
        runId,
        userId,
        task: command,
        success: false
      });
      this.recordRunHistory({
        runId,
        userId,
        channel,
        inputText: command,
        outputText: policy.reason,
        success: false,
        correlationId,
        latencyMs: Date.now() - startedAt,
        toolTimingsMs: { policyCheckMs: 1 }
      });
      return `Command blocked by policy: ${policy.reason}`;
    }
    const runtimeSettings = this.deps.settingsService.get();
    if (runtimeSettings.requireApprovals && policy.riskLevel !== "low") {
      const approvalId = this.approvals.request(command, policy.riskLevel);
      return `Command requires approval (${policy.riskLevel}). Approval ID: ${approvalId}`;
    }

    this.deps.jobSupervisor.markRunning(runId);
    this.deps.auditLog.append({
      runId,
      actor: userId,
      action: "command_start",
      data: { command, correlationId }
    });

    try {
      const result = await this.deps.commandExecutor.run(command, [], {
        timeoutMs: runtimeSettings.shell.timeoutMs,
        maxOutputBytes: runtimeSettings.shell.maxOutputBytes
      });
      const success = result.exitCode === 0 && !result.timedOut;
      this.deps.jobSupervisor.markDone(runId, success);
      this.deps.auditLog.append({
        runId,
        actor: userId,
        action: "command_finish",
        data: {
          exitCode: String(result.exitCode),
          timedOut: String(result.timedOut),
          correlationId
        }
      });
      this.deps.improvement.recordOutcome({
        runId,
        userId,
        task: command,
        success
      });
      this.recordRunHistory({
        runId,
        userId,
        channel,
        inputText: command,
        outputText: success ? result.stdout : result.stderr,
        success,
        correlationId,
        latencyMs: Date.now() - startedAt,
        toolTimingsMs: { shellMs: Date.now() - startedAt }
      });
      if (!success) {
        return `Command failed (exit ${result.exitCode}). stderr: ${result.stderr || "n/a"}`;
      }
      return result.stdout || "Command finished without output.";
    } catch (error) {
      this.deps.jobSupervisor.markDone(runId, false);
      this.deps.auditLog.append({
        runId,
        actor: userId,
        action: "command_error",
        data: {
          message: error instanceof Error ? error.message : "unknown error",
          correlationId
        }
      });
      this.deps.improvement.recordOutcome({
        runId,
        userId,
        task: command,
        success: false
      });
      this.recordRunHistory({
        runId,
        userId,
        channel,
        inputText: command,
        outputText: error instanceof Error ? error.message : "unknown error",
        success: false,
        correlationId,
        latencyMs: Date.now() - startedAt,
        toolTimingsMs: { shellMs: Date.now() - startedAt }
      });
      return `Command execution error: ${error instanceof Error ? error.message : "unknown error"}`;
    }
  }

  private resolveChatModel(
    input: { model?: string },
    runtimeSettings: AppSettings
  ): string | undefined {
    const activeProvider = runtimeSettings.activeProvider;
    const modelFromSettings =
      runtimeSettings.models.defaultByProvider[
        activeProvider as keyof typeof runtimeSettings.models.defaultByProvider
      ];
    const budgetExceeded = isBudgetExceeded(runtimeSettings.costGovernor);
    const economyLocalFallback = (): string | undefined => {
      if (runtimeSettings.ollama.disabled !== true) {
        return runtimeSettings.models.defaultByProvider.ollama || undefined;
      }
      if (runtimeSettings.lmstudio.disabled !== true) {
        return runtimeSettings.models.defaultByProvider.lmstudio || undefined;
      }
      if (runtimeSettings.copilot.disabled !== true) {
        return runtimeSettings.models.defaultByProvider.copilot || undefined;
      }
      return undefined;
    };
    return runtimeSettings.costGovernor.enabled &&
      budgetExceeded &&
      runtimeSettings.costGovernor.qualityTier === "economy"
      ? economyLocalFallback()
      : input.model?.trim() || modelFromSettings || undefined;
  }

  private async runSkillAuthoringSession(options: {
    input: {
      text: string;
      onToken?: (token: string) => void;
      channel: "web" | "whatsapp" | "signal";
      model?: string;
    };
    userId: string;
    runId: string;
    correlationId: string;
    startedAt: number;
    selectedModel: string | undefined;
    runtimeSettings: AppSettings;
  }): Promise<string> {
    const { input, userId, runId, correlationId, startedAt, selectedModel, runtimeSettings } = options;
    this.thoughtLog.append({
      category: "chat",
      title: "Skill authoring",
      content: input.text.slice(0, 240)
    });
    const result = await runSkillAuthoringFlow({
      userText: input.text,
      userId,
      modelRouter: this.deps.modelRouter,
      memoryService: this.deps.memoryService,
      skillRegistry: this.deps.skillRegistry,
      settingsService: this.deps.settingsService,
      model: selectedModel,
      onToken: input.onToken,
      emotionSnapshot: formatEmotionSnapshot(this.deps.emotionService.getState(NOVA_PRIMARY_EMOTION_USER_ID))
    });
    this.rememberAssistantTurn(userId, input.channel, input.text, result.reply, runtimeSettings.emotions);
    this.deps.auditLog.append({
      runId,
      actor: userId,
      action: result.wroteSkillId ? "skill_written" : "skill_authoring",
      data: { correlationId, skillId: result.wroteSkillId ?? "" }
    });
    this.recordRunHistory({
      runId,
      userId,
      channel: input.channel,
      inputText: input.text,
      outputText: result.reply,
      success: true,
      correlationId,
      latencyMs: Date.now() - startedAt,
      provider: result.provider,
      modelName: result.modelName,
      tokenInCount: estimateTokens(input.text),
      tokenOutCount: estimateTokens(result.reply),
      firstTokenMs: result.firstTokenMs,
      tokensPerSecond: computeTokensPerSecond(result.reply, Date.now() - startedAt),
      costUsd: estimateCostUsd(result.provider, estimateTokens(result.reply), runtimeSettings.costGovernor),
      toolTimingsMs: result.wroteSkillId ? { skillAuthorMs: Date.now() - startedAt } : {}
    });
    this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: true });
    this.thoughtLog.append({
      category: "chat",
      title: "Skill authoring done",
      content: result.reply.slice(0, 280)
    });
    return result.reply;
  }

  private rememberAssistantTurn(
    userId: string,
    channel: "web" | "whatsapp" | "signal",
    userText: string,
    assistantText: string,
    emotions: AppSettings["emotions"]
  ): void {
    this.deps.memoryService.appendTurn(userId, userText, assistantText);
    this.deps.emotionService.updateFromAssistantReply(NOVA_PRIMARY_EMOTION_USER_ID, assistantText, emotions);
    this.updatePersonProfileFromTurn(userId, channel, userText, assistantText);
  }

  private updatePersonProfileFromTurn(
    personId: string,
    channel: "web" | "whatsapp" | "signal",
    userText: string,
    assistantText: string
  ): void {
    const current = this.people.getById(personId);
    if (!current) return;

    // Channel usage state.
    this.personChannelState.recordInbound(personId, channel as PersonChannel, Date.now());

    // Opt-out / stop texting safety (apply immediately).
    const userSlice = userText.trim().toLowerCase().slice(0, 500);
    const optedOutSignal =
      /\b(stop|unsubscribe|do not text|don't text|dont text|leave me alone|never text|no more messages)\b/i.test(userSlice) ||
      /\b(block me|delete my number)\b/i.test(userSlice);

    const rudeSignal =
      /\b(fuck you|f\*+k you|bitch|whore|slut|idiot|moron|stupid)\b/i.test(userSlice) ||
      /\b(go to hell|kill yourself)\b/i.test(userSlice);

    const thanksSignal = /\b(thank you|thanks|appreciate it|love this|that helps)\b/i.test(userSlice);

    const locks = (field: string) => this.personLocks.isLocked(personId, field);

    let next = { ...current };

    if (optedOutSignal) {
      next.optedOut = true;
    }

    if (rudeSignal) {
      if (!locks("rudenessScore")) next.rudenessScore = Math.min(1, (next.rudenessScore ?? 0) + 0.15);
      if (!locks("rating")) next.rating = Math.max(0, (next.rating ?? 50) - 8);
    } else if (thanksSignal) {
      if (!locks("interestScore")) next.interestScore = Math.min(1, (next.interestScore ?? 0.5) + 0.03);
      if (!locks("rating")) next.rating = Math.min(100, (next.rating ?? 50) + 2);
      if (!locks("rudenessScore")) next.rudenessScore = Math.max(0, (next.rudenessScore ?? 0) - 0.02);
    }

    // Topics: simple keyword harvest from user text (bounded).
    if (!locks("topics")) {
      const harvested = harvestTopics(userText);
      if (harvested.length > 0) {
        const set = new Set([...(next.topics ?? []), ...harvested].map((t) => t.trim()).filter(Boolean));
        next.topics = Array.from(set).slice(0, 30);
      }
    }

    // Preferred channel: softly follow observed channel unless locked.
    if (!locks("preferredChannel")) {
      next.preferredChannel = channel;
    }

    // If they’re opted out, treat that as a strong relationship event.
    this.people.upsert(next);
    if (optedOutSignal) {
      this.personProfileEvents.append(personId, "opt_out_detected", { channel, userText: userText.slice(0, 500) });
    } else if (rudeSignal) {
      this.personProfileEvents.append(personId, "rudeness_detected", { channel, userText: userText.slice(0, 500) });
    }
  }

  private recordRunHistory(input: {
    runId: string;
    userId: string;
    channel: "web" | "whatsapp" | "signal";
    inputText: string;
    outputText?: string;
    success: boolean;
    correlationId?: string;
    latencyMs?: number;
    provider?: string;
    tokenInCount?: number;
    tokenOutCount?: number;
    modelName?: string;
    firstTokenMs?: number;
    tokensPerSecond?: number;
    costUsd?: number;
    toolTimingsMs?: Record<string, number>;
  }): void {
    this.runHistory.save(input);
  }

  private async runMultiAgent(opts: {
    prompt: string;
    channel: "web" | "whatsapp" | "signal";
    systemPrompt: string;
    memoryContext: ChatMessage[];
    cognitiveCoreBlock: string;
  }): Promise<string> {
    const prefix: ChatMessage[] = [
      { role: "system", content: opts.systemPrompt },
      { role: "system", content: NOVA_IDENTITY_GUARD },
      { role: "system", content: INTEGRITY_SYSTEM_GUARD },
      ...(opts.channel === "web" ? ([{ role: "system" as const, content: WEB_CHAT_TONE_MARKDOWN_HINT }] as const) : []),
      ...(opts.channel === "whatsapp" || opts.channel === "signal"
        ? ([{ role: "system" as const, content: WHATSAPP_SIGNAL_REPLY_FORMAT }] as const)
        : []),
      ...opts.memoryContext,
      ...(opts.cognitiveCoreBlock.trim()
        ? ([{ role: "system" as const, content: opts.cognitiveCoreBlock.trim() }] as const)
        : []),
      ...(userMessageTargetsNovaIdentityBio(opts.prompt)
        ? ([{ role: "system" as const, content: NOVA_IDENTITY_SELF_PROMPT_BOOST }] as const)
        : []),
      ...(userMessageTargetsNovaIdentityBio(opts.prompt)
        ? ([{ role: "system" as const, content: NOVA_IDENTITY_REMINDER_LAST }] as const)
        : [])
    ];
    const planner = await this.deps.modelRouter.chat(
      [
        ...prefix,
        { role: "system", content: "You are the planner agent. Produce a concise plan for the user's request." },
        { role: "user", content: opts.prompt }
      ],
      undefined
    );
    const executor = await this.deps.modelRouter.chat(
      [
        ...prefix,
        { role: "system", content: "You are the executor agent. Execute the plan from the prior message faithfully." },
        { role: "user", content: planner.content }
      ],
      undefined
    );
    const reviewer = await this.deps.modelRouter.chat(
      [
        ...prefix,
        { role: "system", content: "You are the reviewer agent. Polish the executor output into one coherent reply." },
        { role: "user", content: executor.content }
      ],
      undefined
    );
    return reviewer.content;
  }

  private async buildVisionContextIfNeeded(
    userText: string,
    imageUrl: string | undefined,
    accessProfile: ChannelAccessProfile | undefined,
    runtimeSettings: AppSettings
  ): Promise<{
    extras: Array<{ role: "system"; content: string }>;
    blockedReply?: string;
  }> {
    const resolvedImageUrl = imageUrl ?? resolveImageUrlFromUserText(userText);
    const needsVision = isVisionIntent(userText, resolvedImageUrl);
    if (!needsVision) {
      return { extras: [] };
    }
    if (!this.deps.visionRouter.hasConfiguredProvider(runtimeSettings)) {
      if (resolvedImageUrl?.trim()) {
        return {
          extras: [],
          blockedReply:
            "Nova needs **Vision** configured before she can look at images. Open **Settings → Vision** and set at least one of: LM Studio (URL + vision model), Ollama (URL + vision model), or Cloud (URL + model + API key). Match **Vision provider priority** to try locals first. Use **GET /api/debug/vision** (vision only) or **GET /api/debug/chat-routing** (vision + why chat may still use Copilot) while logged in."
        };
      }
      return { extras: [] };
    }
    const skillVision = await this.tryCameraSkillVision(userText, accessProfile);
    const effectivePrompt = skillVision ? `${userText}\nCamera observations: ${skillVision}` : userText;
    const vision = await this.deps.visionRouter.analyze(
      {
        userPrompt: effectivePrompt,
        imageUrl: resolvedImageUrl
      },
      runtimeSettings
    );
    this.thoughtLog.append({
      category: "chat",
      title: "Vision analyze outcome",
      content: JSON.stringify({
        used: vision.used,
        provider: vision.provider ?? null,
        summaryChars: vision.summary?.trim().length ?? 0,
        resolvedHint: resolvedImageUrl?.slice(0, 120) ?? null
      }).slice(0, 480)
    });
    if (vision.used && vision.summary) {
      return {
        extras: [
          {
            role: "system",
            content: `Vision context (auto): ${skillVision ? `${skillVision}\n` : ""}${vision.summary}`
          }
        ]
      };
    }
    if (skillVision) {
      return { extras: [{ role: "system", content: `Vision context (auto): ${skillVision}` }] };
    }
    if (resolvedImageUrl?.trim()) {
      return {
        extras: [],
        blockedReply:
          "Nova could not analyze the uploaded image (the vision step returned no result). " +
          "Check Settings → Vision (Ollama/LM Studio running, vision-capable model, correct base URL), " +
          "and that the file still exists under agent-core uploads. " +
          "Cloud chat models are not used as a substitute for vision here, so you will not get a generic “I can’t see images” answer when an image was attached."
      };
    }
    return { extras: [] };
  }

  private async tryCameraSkillVision(userText: string, accessProfile?: ChannelAccessProfile): Promise<string | undefined> {
    if (!userText.toLowerCase().includes("camera")) {
      return undefined;
    }
    if (accessProfile && !accessProfile.capabilities.cameraAccess) {
      return "Camera access denied by policy.";
    }
    const runtimeSettings = this.deps.settingsService.get();
    if (!isSkillRuntimeEnabled(runtimeSettings.skillSettings, "camera-vision")) {
      return undefined;
    }
    const cameraName = extractCameraName(userText);
    if (!cameraName) {
      return undefined;
    }
    const skill = this.deps.skillRegistry.get("camera-vision");
    if (!skill) {
      return undefined;
    }
    try {
      const result = (await this.deps.skillRegistry.run("camera-vision", {
        cameraName,
        mode: "snapshot"
      })) as {
        detections?: Array<{ label: string; color?: string; carMake?: string; licensePlate?: string; catIdentityHint?: string }>;
      };
      const detections = result.detections ?? [];
      if (detections.length === 0) {
        return `No clear objects detected for ${cameraName}.`;
      }
      const summary = detections
        .map((d) => {
          const parts = [d.label];
          if (d.color) parts.push(`color:${d.color}`);
          if (d.carMake) parts.push(`make:${d.carMake}`);
          if (d.licensePlate) parts.push(`plate:${d.licensePlate}`);
          if (d.catIdentityHint) parts.push(`cat:${d.catIdentityHint}`);
          return parts.join(" ");
        })
        .join("; ");
      return `${cameraName}: ${summary}`;
    } catch {
      return undefined;
    }
  }

  private async tryAutoMediaGeneration(userText: string): Promise<string | undefined> {
    const intent = detectMediaGenerationIntent(userText);
    if (!intent) {
      return undefined;
    }
    const generated = await this.deps.mediaGeneration.generateFromPrompt(userText, intent);
    if (!generated) {
      return undefined;
    }
    return `Generated ${generated.kind} automatically via ${generated.provider}: ${generated.url}`;
  }

  private resolveUnresolvedVisionReference(
    userText: string,
    imageUrl: string | undefined,
    runtimeSettings: AppSettings
  ): string | undefined {
    if (!this.deps.visionRouter.hasConfiguredProvider(runtimeSettings)) {
      return undefined;
    }
    if (imageUrl) {
      return undefined;
    }
    const refHint = extractImageReferenceHint(userText);
    if (!refHint) {
      return undefined;
    }
    const resolved = resolveUploadedMediaUrl(refHint);
    if (resolved) {
      return undefined;
    }
    return `I couldn't find image \`${refHint}\` in uploaded files. Please upload it again (or paste the exact /api/media/files/... URL), then I will analyze that exact image.`;
  }
}

function resolveImageUrlFromUserText(text: string): string | undefined {
  const hint = extractImageReferenceHint(text);
  if (hint) {
    return resolveUploadedMediaUrl(hint);
  }
  return undefined;
}

function extractImageReferenceHint(text: string): string | undefined {
  const fromAttachedLine = text.match(
    /(?:^|\n)\s*[-*]\s*image:\s*(\/(?:api|v1)\/media\/files\/[^\s)\]>"']+)/im
  )?.[1];
  if (fromAttachedLine) return fromAttachedLine;
  const fromPath = text.match(/(?:\/(?:api|v1)\/media\/files\/[^\s)\]>"']+)/i)?.[0];
  if (fromPath) return fromPath;
  const fromFilename = text.match(
    /\b([A-Za-z0-9._-]+\.(?:png|jpe?g|webp|gif|bmp|heic|heif|mp4|mov|webm))\b/i
  )?.[1];
  return fromFilename;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function computeTokensPerSecond(text: string, elapsedMs: number): number {
  if (elapsedMs <= 0) return 0;
  const tokens = Math.max(1, estimateTokens(text));
  return Number(((tokens * 1000) / elapsedMs).toFixed(2));
}

function estimateCostUsd(
  provider: string,
  tokenOut: number,
  costGovernor: {
    qualityTier: "high" | "balanced" | "economy";
    providerPricing: { ollamaPer1k: number; lmstudioPer1k: number; copilotPer1k: number };
  }
): number {
  const basePer1k =
    provider === "copilot"
      ? costGovernor.providerPricing.copilotPer1k
      : provider === "lmstudio"
        ? costGovernor.providerPricing.lmstudioPer1k
        : costGovernor.providerPricing.ollamaPer1k;
  const multiplier = costGovernor.qualityTier === "high" ? 1.25 : costGovernor.qualityTier === "economy" ? 0.85 : 1;
  return Number(((tokenOut / 1000) * basePer1k * multiplier).toFixed(6));
}

function isBudgetExceeded(costGovernor: {
  enabled: boolean;
  dailyBudgetUsd: number;
  qualityTier: "high" | "balanced" | "economy";
}): boolean {
  if (!costGovernor.enabled) return false;
  const row = getDatabase()
    .prepare(
      `
      SELECT COALESCE(SUM(cost_usd), 0) AS spent
      FROM run_history
      WHERE datetime(created_at) >= datetime('now', 'start of day')
      `
    )
    .get() as { spent?: number } | undefined;
  const spent = Number(row?.spent ?? 0);
  return spent >= costGovernor.dailyBudgetUsd;
}

function isVisionIntent(text: string, imageUrl?: string): boolean {
  if (imageUrl?.trim()) {
    return true;
  }
  const lower = text.toLowerCase();
  // Uploaded / proxied media in message text (avoid `\b` before `/` — it won't match after ":" or spaces).
  if (/\/(?:api|v1)\/media\/files\/[^\s)\]>"']+/i.test(lower)) {
    return true;
  }
  const hints = [
    "image",
    "photo",
    "picture",
    "camera",
    "what do you see",
    "look at this",
    "screenshot",
    "vision"
  ];
  return hints.some((hint) => lower.includes(hint));
}

function extractCameraName(text: string): string | undefined {
  const lower = text.toLowerCase();
  if (lower.includes("bedroom camera")) {
    return "bedroom camera";
  }
  if (lower.includes("driveway camera")) {
    return "driveway camera";
  }
  const match = lower.match(/([a-z0-9\s]+camera)/);
  return match?.[1]?.trim();
}

function detectMediaGenerationIntent(text: string): "image" | "video" | undefined {
  const lower = text.toLowerCase();
  if (/\b(generate|create|make|render)\b/.test(lower) && /\b(video|clip|movie)\b/.test(lower)) {
    return "video";
  }
  if (/\b(generate|create|make|render|draw)\b/.test(lower) && /\b(image|photo|picture|art|wallpaper)\b/.test(lower)) {
    return "image";
  }
  return undefined;
}

function detectPerplexicaSearchIntent(text: string): string | undefined {
  const trimmed = text.trim();
  if (!trimmed) return undefined;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith("/web ") || lower.startsWith("/search ")) {
    return trimmed.replace(/^\/(web|search)\s+/i, "").trim() || undefined;
  }
  const explicit =
    /\b(search the web|web search|look (it|this) up|find online|browse web|current news|latest news|latest updates|what happened today)\b/i.test(
      trimmed
    );
  const currentEvents = /\b(current|latest|today|now|recent)\b/i.test(trimmed);
  const asksFact = /\b(what|who|when|where|why|how)\b/i.test(trimmed);
  if (explicit || (currentEvents && asksFact)) {
    return trimmed;
  }
  return undefined;
}

function buildPerplexicaFallbackResult(
  answer: string,
  sources: Array<{ title?: string; url?: string }>
): string {
  const lines = [answer.trim()].filter(Boolean);
  const validSources = sources.filter((s) => String(s.url ?? "").trim().length > 0);
  if (validSources.length > 0) {
    lines.push("", "Sources:");
    validSources.slice(0, 6).forEach((source, index) => {
      const url = String(source.url ?? "").trim();
      const title = String(source.title ?? url).trim() || url;
      lines.push(`${index + 1}. ${title} - ${url}`);
    });
  }
  return lines.join("\n").trim();
}

function isWebsiteCommand(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.startsWith("/website") ||
    (/\b(website|site|landing page|subdomain|caddy|deploy)\b/.test(lower) &&
      /\b(create|build|deploy|upload|modify|redesign|change|edit|delete|list|publish)\b/.test(lower))
  );
}

function mentionsKnownWebsite(text: string): boolean {
  const lower = text.toLowerCase();
  if (!/\bwebsite|site\b/.test(lower)) return false;
  const rows = getDatabase()
    .prepare("SELECT name, domain, subdomain FROM website_projects ORDER BY datetime(created_at) DESC LIMIT 50")
    .all() as Array<{ name?: string; domain?: string; subdomain?: string }>;
  return rows.some((row) => {
    const host = `${row.subdomain ?? ""}.${row.domain ?? ""}`.toLowerCase();
    const name = (row.name ?? "").toLowerCase();
    return (name.length > 2 && lower.includes(name)) || (host.length > 3 && lower.includes(host));
  });
}

function applyRolloutCohortSettings(userId: string, base: AppSettings): AppSettings {
  const row = getDatabase()
    .prepare(
      `
      SELECT payload
      FROM rollout_checkpoints
      WHERE kind = 'settings'
      ORDER BY datetime(created_at) DESC
      LIMIT 1
      `
    )
    .get() as { payload?: string } | undefined;
  if (!row?.payload) return base;
  let parsed: Record<string, unknown> | undefined;
  try {
    parsed = JSON.parse(row.payload) as Record<string, unknown>;
  } catch {
    return base;
  }
  const rolloutPercent = Math.max(0, Math.min(100, Number(parsed?.rolloutPercent ?? 0)));
  const candidateSettings = (parsed?.candidateSettings ?? undefined) as Partial<AppSettings> | undefined;
  if (!candidateSettings || rolloutPercent <= 0) return base;
  const bucket = stableCohortBucket(userId);
  if (bucket >= rolloutPercent) return base;
  return {
    ...base,
    ...candidateSettings,
    models: {
      ...base.models,
      ...(candidateSettings.models ?? {}),
      defaultByProvider: {
        ...base.models.defaultByProvider,
        ...(candidateSettings.models?.defaultByProvider ?? {})
      }
    },
    ollama: {
      ...base.ollama,
      ...(candidateSettings.ollama ?? {})
    },
    lmstudio: {
      ...base.lmstudio,
      ...(candidateSettings.lmstudio ?? {})
    },
    costGovernor: {
      ...base.costGovernor,
      ...(candidateSettings.costGovernor ?? {}),
      providerPricing: {
        ...base.costGovernor.providerPricing,
        ...(candidateSettings.costGovernor?.providerPricing ?? {})
      }
    },
    vision: {
      ...base.vision,
      ...(candidateSettings.vision ?? {})
    }
  };
}

function stableCohortBucket(userId: string): number {
  let hash = 0;
  for (let i = 0; i < userId.length; i += 1) {
    hash = (hash * 31 + userId.charCodeAt(i)) % 10000;
  }
  return hash % 100;
}

function formatHostDiagnosticsReply(scope: HostDiagnosticsScope, report: string): string {
  const hostOs = process.platform === "win32" ? "Windows" : process.platform === "darwin" ? "macOS" : "Linux";
  const normalizedReport = normalizeDiagnosticsReport(report);
  return [
    `OS: ${hostOs}`,
    "",
    "```",
    normalizedReport,
    "```"
  ].join("\n");
}

function normalizeDiagnosticsReport(report: string): string {
  const rawLines = report
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/g, ""));
  const out: string[] = [];
  let vmPageSizeBytes: number | null = null;
  for (let i = 0; i < rawLines.length; i += 1) {
    let line = rawLines[i];
    // CPU (Darwin): -> CPU:
    line = line.replace(/^([A-Za-z0-9 _./-]+?)\s+\([^)]+\):\s*$/, "$1:");
    const pageSizeMatch = line.match(/page size of\s+(\d+)\s+bytes/i);
    if (pageSizeMatch) {
      vmPageSizeBytes = Number(pageSizeMatch[1]);
      if (Number.isFinite(vmPageSizeBytes) && vmPageSizeBytes > 0) {
        line = line.replace(
          /(page size of)\s+\d+\s+bytes/i,
          `$1 ${formatBinarySize(vmPageSizeBytes)}`
        );
      }
    }
    // brand:\nApple M4 Max -> brand: Apple M4 Max
    if (/^[^:]+:\s*$/.test(line)) {
      let j = i + 1;
      while (j < rawLines.length && rawLines[j].trim() === "") j += 1;
      if (j < rawLines.length && rawLines[j].trim().length > 0 && !/^[^:]+:\s*$/.test(rawLines[j])) {
        out.push(`${line} ${rawLines[j].trim()}`);
        i = j;
        continue;
      }
    }
    const kv = /^(\s*[^:]+:\s*)(\d+)\s*$/.exec(line);
    if (kv) {
      const keyPrefix = kv[1];
      const key = keyPrefix.toLowerCase();
      const value = Number(kv[2]);
      const converted = convertMemoryNumberForKey(key, value);
      if (converted) {
        out.push(`${keyPrefix}${converted}`);
        continue;
      }
      if (vmPageSizeBytes && isVmPageCountKey(key)) {
        out.push(`${keyPrefix}${formatBinarySize(value * vmPageSizeBytes)}`);
        continue;
      }
    }
    out.push(line);
  }
  return out.join("\n").trim();
}

function isVmPageCountKey(key: string): boolean {
  return (
    key.includes("pages free") ||
    key.includes("pages active") ||
    key.includes("pages inactive") ||
    key.includes("pages speculative") ||
    key.includes("pages throttled") ||
    key.includes("pages wired down") ||
    key.includes("pages purgeable") ||
    key.includes("file-backed pages") ||
    key.includes("anonymous pages")
  );
}

function convertMemoryNumberForKey(key: string, value: number): string | null {
  const isMemoryish =
    key.includes("mem") ||
    key.includes("memory") ||
    key.includes("ram") ||
    key.includes("vram") ||
    key.includes("adapterram");
  if (!isMemoryish || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  // WMI Win32_OperatingSystem uses KiB for these fields.
  if (key.includes("totalvisiblememorysize") || key.includes("freephysicalmemory")) {
    return formatBinarySize(value * 1024);
  }
  // NVIDIA query fields commonly report MiB.
  if (key.includes("memory.total") || key.includes("memory.used")) {
    return formatBinarySize(value * 1024 * 1024);
  }
  // Default to bytes (Darwin hw.memsize, AdapterRAM, etc).
  return formatBinarySize(value);
}

function formatBinarySize(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let size = bytes;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const precision = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(precision)} ${units[idx]}`;
}
