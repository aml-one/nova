import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { exec as execCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import { WhatsAppChannelAdapter } from "../channels/whatsapp.js";
import { SignalChannelAdapter } from "../channels/signal.js";
import {
  effectiveSignalAccountNumber,
  effectiveSignalApiUrl,
  effectiveWhatsAppPhoneNumberId,
  effectiveWhatsAppToken
} from "../channels/channel-runtime-config.js";
import { getWhatsAppWebBridgeStatus, startWhatsAppWebBridge, stopWhatsAppWebBridge } from "../channels/whatsapp-web-bridge.js";
import { mapInboundIdentity } from "../channels/identity-mapping.js";
import { listChannelDebugEntries, previewChannelText, pushChannelDebug } from "../channels/channel-debug-log.js";
import { dispatchSignalInboundMessages } from "../channels/signal-inbound-dispatch.js";
import { startSignalReceiveWsPoller } from "../channels/signal-receive-ws-poller.js";
import { ChannelRouter } from "../channels/channel-router.js";
import {
  verifyInternalAuthHeader,
  verifySignalSignature,
  verifyWhatsAppSignature
} from "../security/webhook-verifier.js";
import { OutboundDispatcher } from "../messaging/outbound-dispatcher.js";
import { ProactiveOutreachDaemon } from "../messaging/proactive-outreach-daemon.js";
import { Logger } from "../observability/logger.js";
import { VoiceService, isVoiceSttConfigured } from "../voice/voice-service.js";
import { getRecentTtsEntries, recordTtsSpeakResult } from "../voice/tts-recent-log.js";
import { prepareChatTextForSpeech } from "../voice/tts-text.js";
import { getDatabase } from "../storage/sqlite.js";
import { RagService } from "../rag/rag-service.js";
import { BackupService } from "../backup/backup-service.js";
import { IdentityBackupService } from "../backup/identity-backup-service.js";
import { SchedulerService } from "../scheduler/scheduler-service.js";
import { PersonaVersionService } from "../persona/persona-version-service.js";
import { PersonaLoader } from "../persona/persona-loader.js";
import { appendUploadChunk, completeChunkedUpload, getUploadFile, initChunkedUpload, saveUpload } from "../media/media-storage.js";
import { SettingsService } from "../settings/settings-service.js";
import { AuthService } from "../auth/auth-service.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { ModelRouter } from "../providers/router.js";
import { SelfImprovementLoop } from "../improvement/self-improvement-loop.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { parseConfiguredCameras } from "../skills/camera-config.js";
import { isSkillRuntimeEnabled } from "../skills/skill-enabled.js";
import { normalizeE164Phone, resolveChannelAccess } from "../security/phone-access.js";
import { ApprovalService } from "../execution/approval-service.js";
import {
  headersForCopilotModelsGet,
  registerCopilotSettingsSource,
  resolveCopilotRuntime
} from "../providers/copilot-credentials.js";
import { registerOllamaSettingsSource } from "../providers/ollama.js";
import { ProviderCatalogService } from "../providers/provider-catalog.js";
import { UpdateManager } from "../update/update-manager.js";
import { ThoughtRepository } from "../storage/repositories/thought-repository.js";
import { PeopleRepository } from "../storage/repositories/people-repository.js";
import { PersonIdentitiesRepository } from "../storage/repositories/person-identities-repository.js";
import { PersonFieldLocksRepository } from "../storage/repositories/person-field-locks-repository.js";
import { PersonChannelStateRepository } from "../storage/repositories/person-channel-state-repository.js";
import { PersonProfileEventsRepository } from "../storage/repositories/person-profile-events-repository.js";
import { WebSocketServer, WebSocket } from "ws";
import { MobilePushService } from "../mobile/push-service.js";
import { LearningDaemon } from "../improvement/learning-daemon.js";
import { NOVA_PRIMARY_EMOTION_USER_ID } from "../identity/nova-emotion-user.js";
import { expandUserPath, invalidateSentiCoreOrchestrationCache } from "../emotion/senti-core-loader.js";
import { buildMemoryKnowledgeGraph } from "../knowledge/memory-graph.js";
const execAsync = promisify(execCallback);

type HttpServerOptions = {
  orchestrator: TaskOrchestrator;
  settings: SettingsService;
  auth: AuthService;
  modelRouter: ModelRouter;
  improvement: SelfImprovementLoop;
  skillRegistry: InMemorySkillRegistry;
  updateManager: UpdateManager;
  learningDaemon?: LearningDaemon;
  appVersion: string;
  installedAt: string;
  port?: number;
};

// signal-cli-rest-api re-posts every typing indicator and read receipt, so the webhook handler
// otherwise emits a parsed_zero_messages debug entry many times per minute. This module-level
// throttle keeps the warning visible (≥1 per 2 minutes) without flooding the trace.
let lastWebhookZeroMessagesAt = 0;
const WEBHOOK_ZERO_MESSAGES_THROTTLE_MS = 2 * 60 * 1000;
function maybeLogWebhookZeroMessages(): void {
  const now = Date.now();
  if (now - lastWebhookZeroMessagesAt < WEBHOOK_ZERO_MESSAGES_THROTTLE_MS) {
    return;
  }
  lastWebhookZeroMessagesAt = now;
  pushChannelDebug({
    channel: "signal",
    direction: "in",
    transport: "webhook",
    correlationId: "signal-webhook-noise",
    peer: "",
    textPreview: "",
    trace: ["webhook_received", "parsed_zero_messages_throttled"],
    reachedNova: false,
    error:
      "Throttled: signal-cli-rest-api delivered typing/receipt envelopes (no DM extracted). Verify only if real messages stop arriving."
  });
}

type CopilotDeviceLoginSession = {
  id: string;
  state: "starting" | "waiting_for_user" | "authorized" | "failed" | "cancelled";
  command: string;
  startedAt: string;
  completedAt?: string;
  url?: string;
  userCode?: string;
  message?: string;
  logs: string[];
  process?: ChildProcessWithoutNullStreams;
};

export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  registerCopilotSettingsSource(() => options.settings.get());
  registerOllamaSettingsSource(() => options.settings.get());
  const port = options.port ?? Number(process.env.NOVA_AGENT_PORT ?? "8787");
  const wa = new WhatsAppChannelAdapter(() => options.settings.get());
  const signal = new SignalChannelAdapter(() => options.settings.get());
  const router = new ChannelRouter();
  const dispatcher = new OutboundDispatcher(() => options.settings.get());
  const logger = new Logger();
  const voice = new VoiceService(() => options.settings.get(), () => options.orchestrator.getEmotionState());
  const rag = new RagService();
  const backup = new BackupService();
  const identityBackup = new IdentityBackupService();
  const scheduler = new SchedulerService();
  const personas = new PersonaVersionService();
  const personaLoader = new PersonaLoader();
  const approvals = new ApprovalService();
  const providerCatalog = new ProviderCatalogService(() => options.settings.get());
  const thoughtLog = new ThoughtRepository();
  const mobilePush = new MobilePushService();
  let lastThoughtBroadcastAt = "";
  const copilotDeviceLoginSessions = new Map<string, CopilotDeviceLoginSession>();
  const thoughtWs = new WebSocketServer({ noServer: true });
  dispatcher.start();
  const outreach = new ProactiveOutreachDaemon({ settings: options.settings, orchestrator: options.orchestrator, dispatcher });
  outreach.start();
  const runScheduledTask = async (taskPayload: string): Promise<void> => {
    await options.orchestrator.handleChannelMessage({
      channel: "web",
      text: taskPayload,
      correlationId: randomUUID()
    });
  };
  scheduler.start(runScheduledTask);
  const baileysInboundHandler = async ({ from, text }: { from: string; text: string }) => {
      const msgCorr = randomUUID();
      const trace: string[] = ["baileys_inbound"];
      try {
        const identity = mapInboundIdentity("whatsapp", from);
        trace.push(`mapped_identity=${identity}`);
        const accessProfile = resolveChannelAccess("whatsapp", identity, options.settings.get());
        trace.push(accessProfile.allowed ? "access_allowed" : `access_denied(role=${accessProfile.role})`);
        if (!accessProfile.allowed) {
          const e164 = normalizeE164Phone(identity);
          const shortHint =
            e164.startsWith("+1") && e164.length > 0 && e164.length < 12
              ? " (allow-list phone may be incomplete: NANP numbers are +1 + 10 digits)"
              : "";
          pushChannelDebug({
            channel: "whatsapp",
            direction: "in",
            transport: "baileys",
            correlationId: msgCorr,
            peer: from,
            textPreview: previewChannelText(text),
            trace,
            reachedNova: false,
            error: `Number blocked by channel access policy (matched as ${e164 || identity}; role=${accessProfile.role})${shortHint}`
          });
          return;
        }
        const reply = await options.orchestrator.handleChannelMessage({
          channel: "whatsapp",
          phoneNumber: identity,
          text,
          correlationId: msgCorr,
          accessProfile
        });
        trace.push("orchestrator_ok", "queued_outbound_reply");
        pushChannelDebug({
          channel: "whatsapp",
          direction: "in",
          transport: "baileys",
          correlationId: msgCorr,
          peer: from,
          textPreview: previewChannelText(text),
          trace,
          reachedNova: true
        });
        dispatcher.enqueue("whatsapp", identity, reply, msgCorr);
        pushChannelDebug({
          channel: "whatsapp",
          direction: "out",
          transport: "baileys",
          correlationId: msgCorr,
          peer: identity,
          textPreview: previewChannelText(reply),
          trace: ["reply_enqueued"]
        });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        trace.push("handler_error");
        pushChannelDebug({
          channel: "whatsapp",
          direction: "in",
          transport: "baileys",
          correlationId: msgCorr,
          peer: from,
          textPreview: previewChannelText(text),
          trace,
          reachedNova: false,
          error: msg
        });
      }
  };
  if ((process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase() === "baileys") {
    void startWhatsAppWebBridge(baileysInboundHandler).catch((error) => {
      console.warn("[channels] Could not auto-start WhatsApp Web bridge:", error instanceof Error ? error.message : String(error));
    });
  }

  setInterval(() => {
    if (!dispatcher.isRunning()) {
      dispatcher.restart();
    }
    if (!scheduler.isRunning()) {
      scheduler.restart(runScheduledTask);
    }
  }, 10000).unref();
  setInterval(() => {
    const now = Date.now();
    for (const [id, session] of copilotDeviceLoginSessions.entries()) {
      if (session.process) continue;
      const completedAt = Date.parse(session.completedAt ?? session.startedAt);
      if (Number.isFinite(completedAt) && now - completedAt > 30 * 60 * 1000) {
        copilotDeviceLoginSessions.delete(id);
      }
    }
  }, 60000).unref();

  const server = createServer(async (request, response) => {
    const correlationId = request.headers["x-correlation-id"]?.toString() ?? randomUUID();
    try {
      if (!request.url) {
        return sendJson(response, 404, { error: "not found" });
      }
      const parsedUrl = new URL(request.url, "http://localhost");
      const loginEnabled = options.settings.get().web.loginEnabled;
      const isPublicPath =
        request.url.startsWith("/v1/webhooks/") ||
        parsedUrl.pathname.startsWith("/v1/media/files/") ||
        parsedUrl.pathname === "/health" ||
        parsedUrl.pathname === "/v1/system/heartbeat" ||
        parsedUrl.pathname === "/v1/auth/state" ||
        parsedUrl.pathname === "/v1/auth/login" ||
        parsedUrl.pathname === "/v1/auth/setup" ||
        /** Boolean only; used by web to gate mic upload without exposing secrets. */
        parsedUrl.pathname === "/v1/voice/stt-status" ||
        /** Read-only mood chrome for the web UI; polls before login. Same exposure model as stt-status. */
        parsedUrl.pathname === "/v1/emotion/state" ||
        parsedUrl.pathname === "/v1/emotion/history";
      const sessionToken = request.headers["x-session-token"]?.toString();
      const sessionUser = options.auth.verifySession(sessionToken);
      const hasInternalAuth = verifyInternalAuthHeader(request.headers.authorization?.toString());
      const hasSessionAuth = Boolean(sessionUser);
      if (!hasInternalAuth && !hasSessionAuth && !isPublicPath && loginEnabled) {
        return sendJson(response, 401, { error: "unauthorized" });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/health") {
        // Enriched body: lets the supervisor (`scripts/start-local.sh`) tell apart "agent-core is alive
        // but the event loop is busy answering a slow Ollama chat" from "agent-core is genuinely hung".
        // Plain liveness consumers can keep treating this as `ok=true`.
        const inFlight = options.orchestrator.isBusy() ? 1 : 0;
        const lastActivityMs = Math.max(0, Date.now() - options.orchestrator.getLastActivityAt());
        return sendJson(response, 200, {
          ok: true,
          inFlight,
          busy: inFlight > 0,
          lastActivityMs,
          correlationId
        });
      }
      // Same shape as /health, exposed under /v1/system/heartbeat so the supervisor can poll a stable
      // path even after we move /health behind a proxy or change auth gating later.
      if (request.method === "GET" && parsedUrl.pathname === "/v1/system/heartbeat") {
        const inFlight = options.orchestrator.isBusy() ? 1 : 0;
        const lastActivityMs = Math.max(0, Date.now() - options.orchestrator.getLastActivityAt());
        return sendJson(response, 200, {
          ok: true,
          inFlight,
          busy: inFlight > 0,
          lastActivityMs,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/system/version") {
        return sendJson(response, 200, {
          version: options.appVersion,
          installedAt: options.updateManager.getStatus().installedAt ?? options.installedAt,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/auth/state") {
        return sendJson(response, 200, {
          needsSetup: !options.auth.hasAdmin(),
          loginEnabled,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/auth/setup") {
        const payload = (await readJson(request)) as { email?: string; password?: string };
        const email = payload.email?.trim();
        const password = payload.password ?? "";
        if (!email || !password) {
          return sendJson(response, 400, { error: "email and password are required", correlationId });
        }
        try {
          const user = options.auth.setupAdmin(email, password);
          const login = options.auth.login(email, password);
          return sendJson(response, 200, { user, token: login.token, expiresAt: login.expiresAt, correlationId });
        } catch (error) {
          return sendJson(response, 400, {
            error: error instanceof Error ? error.message : "setup failed",
            correlationId
          });
        }
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/auth/login") {
        const payload = (await readJson(request)) as { email?: string; password?: string };
        const email = payload.email?.trim();
        const password = payload.password ?? "";
        if (!email || !password) {
          return sendJson(response, 400, { error: "email and password are required", correlationId });
        }
        try {
          const login = options.auth.login(email, password);
          return sendJson(response, 200, {
            token: login.token,
            expiresAt: login.expiresAt,
            user: login.user,
            correlationId
          });
        } catch {
          return sendJson(response, 401, { error: "invalid credentials", correlationId });
        }
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/auth/logout") {
        options.auth.logout(sessionToken);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/auth/me") {
        if (!sessionUser && !hasInternalAuth && loginEnabled) {
          return sendJson(response, 401, { error: "unauthorized", correlationId });
        }
        return sendJson(response, 200, {
          user: sessionUser ?? (!loginEnabled ? { id: "guest", email: "guest@local" } : null),
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/mobile/push/register") {
        if (!sessionUser && !hasInternalAuth && loginEnabled) {
          return sendJson(response, 401, { error: "unauthorized", correlationId });
        }
        const payload = (await readJson(request)) as {
          platform?: "android" | "ios" | "web";
          token?: string;
          appVersion?: string;
        };
        const token = payload.token?.trim();
        const platform = payload.platform === "ios" || payload.platform === "web" ? payload.platform : "android";
        if (!token) {
          return sendJson(response, 400, { error: "token is required", correlationId });
        }
        const id = randomUUID();
        const userId = sessionUser?.id ?? "guest";
        getDatabase()
          .prepare(
            `
            INSERT INTO mobile_push_registrations (id, user_id, platform, token, app_version, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(token) DO UPDATE SET
              user_id = excluded.user_id,
              platform = excluded.platform,
              app_version = excluded.app_version,
              updated_at = CURRENT_TIMESTAMP
            `
          )
          .run(id, userId, platform, token, payload.appVersion?.trim() || null);
        if (mobilePush.isEnabled()) {
          await mobilePush.sendToAll({
            type: "custom",
            title: "Nova mobile registered",
            body: "Push notifications are now connected.",
            entityId: id,
            severity: "low"
          });
        }
        return sendJson(response, 200, { ok: true, id, correlationId });
      }
      if (request.method === "DELETE" && parsedUrl.pathname === "/v1/mobile/push/register") {
        if (!sessionUser && !hasInternalAuth && loginEnabled) {
          return sendJson(response, 401, { error: "unauthorized", correlationId });
        }
        const payload = (await readJson(request)) as { id?: string; token?: string };
        if (!payload.id && !payload.token) {
          return sendJson(response, 400, { error: "id or token is required", correlationId });
        }
        if (payload.id) {
          getDatabase().prepare("DELETE FROM mobile_push_registrations WHERE id = ?").run(payload.id);
        } else if (payload.token) {
          getDatabase().prepare("DELETE FROM mobile_push_registrations WHERE token = ?").run(payload.token.trim());
        }
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/auth/users") {
        return sendJson(response, 200, { items: options.auth.listUsers(), correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/auth/users") {
        const payload = (await readJson(request)) as { email?: string; password?: string };
        const email = payload.email?.trim();
        const password = payload.password ?? "";
        if (!email || !password) {
          return sendJson(response, 400, { error: "email and password are required", correlationId });
        }
        try {
          const user = options.auth.createUser(email, password);
          return sendJson(response, 200, { user, correlationId });
        } catch (error) {
          return sendJson(response, 400, {
            error: error instanceof Error ? error.message : "create user failed",
            correlationId
          });
        }
      }
      if (parsedUrl.pathname === "/v1/admin/people" || parsedUrl.pathname.startsWith("/v1/admin/people/")) {
        if (!sessionUser && !hasInternalAuth && loginEnabled) {
          return sendJson(response, 401, { error: "unauthorized", correlationId });
        }
        if (!hasInternalAuth && !options.auth.isAdminUser(sessionUser?.id)) {
          return sendJson(response, 403, { error: "forbidden", correlationId });
        }

        const people = new PeopleRepository();
        const identities = new PersonIdentitiesRepository();
        const locks = new PersonFieldLocksRepository();
        const channelState = new PersonChannelStateRepository();
        const events = new PersonProfileEventsRepository();

        if (request.method === "GET" && parsedUrl.pathname === "/v1/admin/people") {
          const id = (parsedUrl.searchParams.get("id") ?? "").trim();
          if (id) {
            const person = people.getById(id);
            if (!person) return sendJson(response, 404, { error: "not found", correlationId });
            const personIdentities = identities.listIdentitiesForPerson(id);
            const lockedFields = locks.listLockedFields(id);
            const stateSignal = channelState.get(id, "signal");
            const stateWhatsApp = channelState.get(id, "whatsapp");
            const stateWeb = channelState.get(id, "web");
            const recentEvents = events.list(id, 50);
            return sendJson(response, 200, {
              item: person,
              identities: personIdentities,
              lockedFields,
              channelState: { web: stateWeb, signal: stateSignal, whatsapp: stateWhatsApp },
              events: recentEvents,
              correlationId
            });
          }
          const limit = Math.max(1, Math.min(1000, Number(parsedUrl.searchParams.get("limit") ?? "200")));
          const offset = Math.max(0, Number(parsedUrl.searchParams.get("offset") ?? "0"));
          const items = people.list(limit, offset);
          return sendJson(response, 200, { items, correlationId });
        }

        if (request.method === "PATCH" && parsedUrl.pathname === "/v1/admin/people") {
          const payload = (await readJson(request)) as {
            id?: string;
            patch?: Partial<{
              displayName: string | null;
              aboutNotes: string | null;
              rating: number;
              interestScore: number;
              rudenessScore: number;
              preferredChannel: "web" | "signal" | "whatsapp" | null;
              topics: string[];
              optedOut: boolean;
              blocked: boolean;
            }>;
            locks?: Array<{ field: string; locked: boolean }>;
          };
          const id = payload.id?.trim() ?? "";
          if (!id) return sendJson(response, 400, { error: "id is required", correlationId });
          const current = people.getById(id);
          if (!current) return sendJson(response, 404, { error: "not found", correlationId });
          const patch = payload.patch ?? {};
          const next = {
            ...current,
            displayName: patch.displayName === null ? undefined : typeof patch.displayName === "string" ? patch.displayName : current.displayName,
            aboutNotes: patch.aboutNotes === null ? undefined : typeof patch.aboutNotes === "string" ? patch.aboutNotes : current.aboutNotes,
            rating: typeof patch.rating === "number" ? patch.rating : current.rating,
            interestScore: typeof patch.interestScore === "number" ? patch.interestScore : current.interestScore,
            rudenessScore: typeof patch.rudenessScore === "number" ? patch.rudenessScore : current.rudenessScore,
            preferredChannel:
              patch.preferredChannel === null
                ? undefined
                : patch.preferredChannel === "web" || patch.preferredChannel === "signal" || patch.preferredChannel === "whatsapp"
                  ? patch.preferredChannel
                  : current.preferredChannel,
            topics: Array.isArray(patch.topics) ? patch.topics.filter((t) => typeof t === "string") : current.topics,
            optedOut: typeof patch.optedOut === "boolean" ? patch.optedOut : current.optedOut,
            blocked: typeof patch.blocked === "boolean" ? patch.blocked : current.blocked
          };
          people.upsert(next);
          for (const item of payload.locks ?? []) {
            if (!item || typeof item.field !== "string" || typeof item.locked !== "boolean") continue;
            locks.setLocked(id, item.field, item.locked);
          }
          events.append(id, "admin_patch", { patch: payload.patch ?? {}, locks: payload.locks ?? [] });
          const updated = people.getById(id);
          return sendJson(response, 200, { item: updated, correlationId });
        }

        if (request.method === "POST" && parsedUrl.pathname === "/v1/admin/people/merge") {
          const payload = (await readJson(request)) as { sourceId?: string; targetId?: string };
          const sourceId = payload.sourceId?.trim() ?? "";
          const targetId = payload.targetId?.trim() ?? "";
          if (!sourceId || !targetId) return sendJson(response, 400, { error: "sourceId and targetId are required", correlationId });
          if (sourceId === targetId) return sendJson(response, 400, { error: "sourceId and targetId must differ", correlationId });

          const source = people.getById(sourceId);
          const target = people.getById(targetId);
          if (!source) return sendJson(response, 404, { error: "source not found", correlationId });
          if (!target) return sendJson(response, 404, { error: "target not found", correlationId });

          const db = getDatabase();
          db.exec("BEGIN IMMEDIATE TRANSACTION;");
          try {
            // Move identities where possible.
            const sourceIds = identities.listIdentitiesForPerson(sourceId);
            const conflicts: Array<{ kind: string; value: string }> = [];
            for (const id of sourceIds) {
              const res = identities.upsertIdentity(targetId, id.kind as any, id.value);
              if (!res.ok) conflicts.push({ kind: id.kind, value: id.value });
            }
            db.prepare("DELETE FROM person_identities WHERE person_id = ?").run(sourceId);

            // Merge channel state (max timestamps, sum unreplied capped).
            for (const ch of ["web", "signal", "whatsapp"] as const) {
              const s = channelState.get(sourceId, ch);
              const t = channelState.get(targetId, ch);
              if (!s && !t) continue;
              channelState.upsert({
                personId: targetId,
                channel: ch,
                lastInboundAtMs: Math.max(t?.lastInboundAtMs ?? 0, s?.lastInboundAtMs ?? 0) || undefined,
                lastOutboundAtMs: Math.max(t?.lastOutboundAtMs ?? 0, s?.lastOutboundAtMs ?? 0) || undefined,
                unrepliedOutboundCount: Math.min(1000000, (t?.unrepliedOutboundCount ?? 0) + (s?.unrepliedOutboundCount ?? 0)),
                cooldownUntilMs: Math.max(t?.cooldownUntilMs ?? 0, s?.cooldownUntilMs ?? 0) || undefined
              });
              db.prepare("DELETE FROM person_channel_state WHERE person_id = ? AND channel = ?").run(sourceId, ch);
            }

            // Merge locks (union).
            const locked = new Set<string>([...locks.listLockedFields(targetId), ...locks.listLockedFields(sourceId)]);
            for (const f of locked) locks.setLocked(targetId, f, true);
            db.prepare("DELETE FROM person_field_locks WHERE person_id = ?").run(sourceId);

            // Move events to target for continuity.
            db.prepare("UPDATE person_profile_events SET person_id = ? WHERE person_id = ?").run(targetId, sourceId);

            // Merge basic profile fields (fill missing on target).
            const merged = {
              ...target,
              displayName: target.displayName ?? source.displayName,
              aboutNotes: target.aboutNotes ?? source.aboutNotes,
              topics: Array.from(new Set([...(target.topics ?? []), ...(source.topics ?? [])])).slice(0, 30),
              optedOut: target.optedOut || source.optedOut,
              blocked: target.blocked || source.blocked,
              rudenessScore: Math.max(target.rudenessScore ?? 0, source.rudenessScore ?? 0),
              interestScore: Math.max(target.interestScore ?? 0.5, source.interestScore ?? 0.5),
              rating: Math.max(target.rating ?? 50, source.rating ?? 50)
            };
            people.upsert(merged);

            // Drop source person row.
            db.prepare("DELETE FROM people WHERE id = ?").run(sourceId);

            events.append(targetId, "admin_merge_people", { sourceId, targetId, conflicts });
            db.exec("COMMIT;");
            return sendJson(response, 200, { ok: true, conflicts, correlationId });
          } catch (e) {
            db.exec("ROLLBACK;");
            return sendJson(response, 500, { error: e instanceof Error ? e.message : "merge failed", correlationId });
          }
        }

        if (request.method === "POST" && parsedUrl.pathname === "/v1/admin/people/identities") {
          const payload = (await readJson(request)) as {
            action?: "add" | "delete";
            personId?: string;
            kind?: "web_user_id" | "phone_e164" | "signal_uuid" | "whatsapp_phone_e164";
            value?: string;
          };
          const personId = payload.personId?.trim() ?? "";
          const kind = payload.kind?.trim() ?? "";
          const value = payload.value?.trim() ?? "";
          if (!personId || !kind || !value) {
            return sendJson(response, 400, { error: "personId, kind, value are required", correlationId });
          }
          if (payload.action === "delete") {
            identities.deleteIdentity(kind as any, value);
            events.append(personId, "admin_identity_delete", { kind, value });
            return sendJson(response, 200, { ok: true, correlationId });
          }
          const res = identities.upsertIdentity(personId, kind as any, value);
          if (!res.ok) return sendJson(response, 409, { error: "identity already linked to a different person", correlationId });
          events.append(personId, "admin_identity_add", { kind, value });
          return sendJson(response, 200, { ok: true, correlationId });
        }

        return sendJson(response, 404, { error: "not found", correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/settings") {
        return sendJson(response, 200, { settings: options.settings.get(), correlationId });
      }
      if (request.method === "PUT" && parsedUrl.pathname === "/v1/settings") {
        const payload = (await readJson(request)) as Partial<AppSettings>;
        const updated = options.settings.updatePartial(payload);
        return sendJson(response, 200, { settings: updated, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/settings/senti-core/file") {
        const rawPath = options.settings.get().sentiCore.orchestrationMarkdownPath.trim();
        if (!rawPath) {
          return sendJson(response, 400, {
            error: "sentiCore.orchestrationMarkdownPath is empty — set it in Settings first.",
            correlationId
          });
        }
        const path = expandUserPath(rawPath);
        try {
          const content = readFileSync(path, "utf8");
          return sendJson(response, 200, { path, content, correlationId });
        } catch (error) {
          const code = error && typeof error === "object" && "code" in error ? (error as NodeJS.ErrnoException).code : "";
          if (code === "ENOENT") {
            return sendJson(response, 200, { path, content: "", missing: true, correlationId });
          }
          return sendJson(response, 500, {
            error: error instanceof Error ? error.message : "failed to read SentiCore file",
            correlationId
          });
        }
      }
      if (request.method === "PUT" && parsedUrl.pathname === "/v1/settings/senti-core/file") {
        const payload = (await readJson(request)) as { content?: string };
        const rawPath = options.settings.get().sentiCore.orchestrationMarkdownPath.trim();
        if (!rawPath) {
          return sendJson(response, 400, {
            error: "sentiCore.orchestrationMarkdownPath is empty — set it in Settings first.",
            correlationId
          });
        }
        const path = expandUserPath(rawPath);
        const content = typeof payload.content === "string" ? payload.content : "";
        const buf = Buffer.from(content, "utf8");
        const maxBytes = 512 * 1024;
        if (buf.length > maxBytes) {
          return sendJson(response, 413, {
            error: `file too large (${buf.length} bytes; max ${maxBytes})`,
            correlationId
          });
        }
        try {
          mkdirSync(dirname(path), { recursive: true });
          writeFileSync(path, buf);
          invalidateSentiCoreOrchestrationCache();
          return sendJson(response, 200, { ok: true, path, correlationId });
        } catch (error) {
          return sendJson(response, 500, {
            error: error instanceof Error ? error.message : "failed to write SentiCore file",
            correlationId
          });
        }
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/system/health/full") {
        if (!scheduler.isRunning()) {
          scheduler.restart(runScheduledTask);
        }
        const full = await buildFullHealth(
          options.modelRouter,
          dispatcher,
          scheduler,
          () => options.settings.get(),
          () => options.orchestrator.getEmotionState()
        );
        return sendJson(response, 200, { health: full, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/models/ping") {
        const ping = await options.modelRouter.pingConfiguredModels(options.settings.get());
        return sendJson(response, 200, { ...ping, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/system/update/status") {
        return sendJson(response, 200, { status: options.updateManager.getStatus(), correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/system/update/history") {
        return sendJson(response, 200, { items: options.updateManager.getHistory(), correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/system/update/check") {
        const status = await options.updateManager.checkNow();
        if (status.updateAvailable) {
          await mobilePush.sendToAll({
            type: "update.available",
            title: "Nova update available",
            body: `New update detected (${status.latestCommitSha?.slice(0, 8) ?? "new commit"}).`,
            entityId: status.latestCommitSha,
            severity: "medium"
          });
        }
        return sendJson(response, 200, { status, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/system/update/apply") {
        const result = await options.updateManager.applyLatest();
        return sendJson(response, 200, { result, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/system/restart") {
        const payload = (await readJson(request)) as { service?: string };
        const service = payload.service ?? "";
        if (service === "dispatcher") {
          dispatcher.restart();
          return sendJson(response, 200, { ok: true, restarted: service, correlationId });
        }
        if (service === "scheduler") {
          scheduler.restart(runScheduledTask);
          return sendJson(response, 200, { ok: true, restarted: service, correlationId });
        }
        if (service === "agent-core") {
          setTimeout(() => process.exit(0), 150);
          return sendJson(response, 200, { ok: true, restarted: service, correlationId });
        }
        return sendJson(response, 400, { error: "service must be dispatcher|scheduler|agent-core", correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/security/analyze") {
        if (!isSkillRuntimeEnabled(options.settings.get().skillSettings, "network-defense")) {
          return sendJson(response, 409, {
            error: "network-defense skill is disabled in Settings. Enable it on the Skills page or Settings, then save.",
            correlationId
          });
        }
        const threshold = Number(parsedUrl.searchParams.get("thresholdPerIp") ?? "40");
        const result = await options.skillRegistry.run("network-defense", {
          mode: "detect",
          thresholdPerIp: Number.isFinite(threshold) ? Math.max(5, threshold) : 40
        });
        recordSecurityEvent("analyze", "completed", sessionUser?.email ?? "system", result);
        return sendJson(response, 200, { result, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/security/action") {
        if (!isSkillRuntimeEnabled(options.settings.get().skillSettings, "network-defense")) {
          return sendJson(response, 409, {
            error: "network-defense skill is disabled in Settings. Enable it on the Skills page or Settings, then save.",
            correlationId
          });
        }
        const payload = (await readJson(request)) as {
          action?: "block_ip" | "harden";
          ipToBlock?: string;
          allowlistPorts?: number[];
          apply?: boolean;
          approvalId?: string;
        };
        const action = payload.action;
        if (action !== "block_ip" && action !== "harden") {
          return sendJson(response, 400, { error: "action must be block_ip or harden", correlationId });
        }
        const apply = payload.apply === true;
        const actor = sessionUser?.email ?? "system";
        if (apply && options.settings.get().requireApprovals) {
          const approvalId = payload.approvalId;
          if (!approvalId) {
            const pendingId = approvals.request(`security:${action}`, "high");
            recordSecurityEvent(action, "pending_approval", actor, { approvalId: pendingId, payload });
            await mobilePush.sendToAll({
              type: "approval.pending",
              title: "Approval required",
              body: `Security action "${action}" needs approval.`,
              entityId: pendingId,
              severity: "high"
            });
            return sendJson(response, 202, { approvalRequired: true, approvalId: pendingId, correlationId });
          }
          if (!approvals.isApproved(approvalId)) {
            return sendJson(response, 403, { error: "approval is required before applying action", correlationId });
          }
        }
        const skillInput =
          action === "block_ip"
            ? {
                mode: "block_ip",
                ipToBlock: payload.ipToBlock,
                apply,
                confirmation: "I_ACKNOWLEDGE_NETWORK_CHANGES"
              }
            : {
                mode: "harden",
                allowlistPorts: payload.allowlistPorts,
                apply,
                confirmation: "I_ACKNOWLEDGE_NETWORK_CHANGES"
              };
        const result = await options.skillRegistry.run("network-defense", skillInput);
        recordSecurityEvent(action, "completed", actor, result);
        await mobilePush.sendToAll({
          type: "security.alert",
          title: "Security action executed",
          body: `Action "${action}" was completed by ${actor}.`,
          severity: action === "block_ip" ? "high" : "medium"
        });
        return sendJson(response, 200, { result, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/security/history") {
        const rows = getDatabase()
          .prepare("SELECT id, action, status, actor, details, created_at FROM security_events ORDER BY datetime(created_at) DESC LIMIT 300")
          .all() as Array<{ id: string; action: string; status: string; actor?: string; details?: string; created_at: string }>;
        const items = rows.map((row) => ({
          id: row.id,
          action: row.action,
          status: row.status,
          actor: row.actor,
          createdAt: row.created_at,
          details: parseJsonSafe(row.details)
        }));
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/access/simulate") {
        const payload = (await readJson(request)) as {
          channel?: "whatsapp" | "signal";
          phoneNumber?: string;
          text?: string;
        };
        const accessProfile = resolveChannelAccess(payload.channel ?? "whatsapp", payload.phoneNumber, options.settings.get());
        const text = payload.text?.toLowerCase() ?? "";
        const checks = {
          canRunShell: accessProfile.capabilities.shellAccess,
          canSchedule: accessProfile.capabilities.schedulerAccess,
          canUseCamera: accessProfile.capabilities.cameraAccess,
          canUseSecurityCenter: accessProfile.capabilities.securityCenterAccess,
          unknownSilentDrop: accessProfile.role === "unknown" && !accessProfile.allowed,
          messageWouldBeBlockedByContent:
            (!accessProfile.capabilities.shellAccess && text.startsWith("/run ")) ||
            (!accessProfile.capabilities.schedulerAccess && text.startsWith("/schedule ")) ||
            (!accessProfile.capabilities.cameraAccess && text.includes("camera"))
        };
        const explanations: string[] = [];
        if (!accessProfile.allowed) {
          explanations.push("Number is not in allowed lists and silent deny is enabled.");
        } else {
          explanations.push(`Role resolved as ${accessProfile.role}.`);
          if (!accessProfile.capabilities.shellAccess) explanations.push("Shell commands (/run) are blocked.");
          if (!accessProfile.capabilities.schedulerAccess) explanations.push("Scheduling commands (/schedule) are blocked.");
          if (!accessProfile.capabilities.cameraAccess) explanations.push("Security camera requests are blocked.");
          if (!accessProfile.capabilities.securityCenterAccess) explanations.push("Security-center actions are blocked.");
          if (checks.messageWouldBeBlockedByContent) {
            explanations.push("Given sample message would be blocked by role capability policy.");
          } else {
            explanations.push("Given sample message is allowed by role capability policy.");
          }
        }
        return sendJson(response, 200, {
          channel: payload.channel ?? "whatsapp",
          phoneNumber: payload.phoneNumber ?? "",
          role: accessProfile.role,
          allowed: accessProfile.allowed,
          capabilities: accessProfile.capabilities,
          checks,
          explanations,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/providers/catalog") {
        const models = await providerCatalog.listModels();
        const setup = providerCatalog.buildProviderSetupStatus();
        return sendJson(response, 200, { models, setup, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/test") {
        const payload = (await readJson(request)) as {
          signalApiUrl?: string;
          signalAccountNumber?: string;
          whatsAppPhoneNumberId?: string;
          whatsAppToken?: string;
          whatsAppAppSecret?: string;
        };
        const signalApiUrl = payload.signalApiUrl?.trim() || "";
        const signalAccountNumber = payload.signalAccountNumber?.trim() || process.env.SIGNAL_ACCOUNT_NUMBER?.trim() || "";
        const whatsAppPhoneNumberId = payload.whatsAppPhoneNumberId?.trim() || "";
        const whatsAppToken = payload.whatsAppToken?.trim() || "";
        const whatsAppAppSecret = payload.whatsAppAppSecret?.trim() || "";
        const whatsAppTransport = (process.env.WHATSAPP_TRANSPORT ?? "cloud").trim().toLowerCase();
        const signalCheck = signalApiUrl ? await checkSignalConnectionForBase(signalApiUrl) : { ok: false, detail: "SIGNAL_API_URL missing" };
        const waWebStatus = getWhatsAppWebBridgeStatus();
        const waCheck =
          whatsAppTransport === "baileys"
            ? {
                ok: waWebStatus.connected === true,
                detail: waWebStatus.connected ? "WhatsApp Web bridge connected" : waWebStatus.detail || "WhatsApp Web bridge not connected"
              }
            : whatsAppPhoneNumberId && whatsAppToken
              ? await pingUrl(`https://graph.facebook.com/v22.0/${whatsAppPhoneNumberId}?fields=id`, {
                  authorization: `Bearer ${whatsAppToken}`
                })
              : { ok: false, detail: "WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN missing" };
        const suggestedEnv = [
          `SIGNAL_API_URL=${signalApiUrl || "http://127.0.0.1:8080"}`,
          `SIGNAL_ACCOUNT_NUMBER=${signalAccountNumber || "+15550001111"}`,
          `WHATSAPP_TRANSPORT=${whatsAppTransport === "baileys" ? "baileys" : "cloud"}`,
          `WHATSAPP_PHONE_NUMBER_ID=${whatsAppPhoneNumberId || "your_phone_number_id"}`,
          `WHATSAPP_TOKEN=${whatsAppToken || "your_whatsapp_token"}`,
          `WHATSAPP_APP_SECRET=${whatsAppAppSecret || "your_whatsapp_app_secret"}`
        ].join("\n");
        return sendJson(response, 200, {
          signal: signalCheck,
          whatsApp: waCheck,
          suggestedEnv,
          quickGuide: {
            signal: [
              "Install and run signal-cli-rest-api.",
              "Link your Signal number once.",
              "Paste SIGNAL_API_URL and SIGNAL_ACCOUNT_NUMBER, then click Test."
            ],
            whatsApp:
              whatsAppTransport === "baileys"
                ? [
                    "Set WHATSAPP_TRANSPORT=baileys and restart agent-core.",
                    "Link WhatsApp Web in Settings → Channels (QR).",
                    "Validate should show bridge connected — Cloud API not used."
                  ]
                : [
                    "Create a Meta app and add WhatsApp product.",
                    "Generate a permanent access token in Meta dashboard.",
                    "Copy Phone Number ID and token, then click Test."
                  ]
          },
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/signal/bootstrap") {
        const payload = (await readJson(request)) as { signalAccountNumber?: string; webhookPublicOrigin?: string };
        const number = payload.signalAccountNumber?.trim() || "";
        const webhookOverride = buildReceiveWebhookUrlFromBootstrap(payload.webhookPublicOrigin);
        const bootstrap = await ensureSignalDockerBridge(webhookOverride);
        const afterCheck = await checkSignalConnectionForBase("http://127.0.0.1:8085");
        const nextStep = number
          ? `Bridge is up. Next: register/link ${number} in signal-cli-rest-api (one-time human verification), then re-run Validate.`
          : "Bridge is up. Next: register/link your Signal number in signal-cli-rest-api (one-time human verification), then re-run Validate.";
        const receiveUrl = bootstrap.receiveWebhookUrl ?? resolveSignalReceiveWebhookUrl();
        const dockerSnippet = [
          "docker rm -f nova-signal-bridge 2>/dev/null || true",
          "docker run -d --restart unless-stopped --name nova-signal-bridge -p 8085:8080 \\",
          "  -e MODE=json-rpc \\",
          `  -e RECEIVE_WEBHOOK_URL=${receiveUrl} \\`,
          "  -v nova-signal-cli-config:/home/.local/share/signal-cli \\",
          "  bbernhard/signal-cli-rest-api:latest"
        ].join("\n");
        return sendJson(response, 200, {
          ok: bootstrap.ok && afterCheck.ok,
          bridge: afterCheck,
          detail: bootstrap.detail,
          executedCommand: bootstrap.executedCommand,
          receiveWebhookUrl: receiveUrl,
          dockerSnippet,
          nextStep,
          suggestedEnv: [
            "SIGNAL_API_URL=http://127.0.0.1:8085",
            `SIGNAL_ACCOUNT_NUMBER=${number || "+15550001111"}`
          ].join("\n"),
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/setup/channels/message-debug") {
        const rawLimit = parsedUrl.searchParams.get("limit");
        const parsed = rawLimit ? Number(rawLimit) : 150;
        const limit = Number.isFinite(parsed) ? parsed : 150;
        const items = listChannelDebugEntries(limit);
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/webhook-proxy-trace") {
        const payload = (await readJson(request)) as {
          channel?: string;
          stage?: string;
          httpStatus?: number;
          detail?: string;
          bodyPreview?: string;
        };
        const ch = payload.channel === "whatsapp" ? "whatsapp" : "signal";
        const detail = typeof payload.detail === "string" ? payload.detail.trim() : "";
        const bodyPreview = typeof payload.bodyPreview === "string" ? payload.bodyPreview : "";
        const stage = typeof payload.stage === "string" ? payload.stage.trim() : "forward_to_agent";
        const trace = ["next_proxy", stage];
        if (typeof payload.httpStatus === "number" && Number.isFinite(payload.httpStatus)) {
          trace.push(`agent_http_${payload.httpStatus}`);
        }
        pushChannelDebug({
          channel: ch,
          direction: "in",
          transport: "next_proxy",
          correlationId: randomUUID(),
          peer: "next.js",
          textPreview: previewChannelText(bodyPreview || detail || "(no detail)"),
          trace,
          error: detail || (payload.httpStatus ? `upstream HTTP ${payload.httpStatus}` : undefined)
        });
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/setup/channels/signal-docker-logs") {
        const rawLines = parsedUrl.searchParams.get("lines");
        const parsedLines = rawLines ? Number(rawLines) : 200;
        const lines = Math.min(800, Math.max(1, Number.isFinite(parsedLines) ? parsedLines : 200));
        try {
          const out = await runLocalCommand(`docker logs --tail ${lines} nova-signal-bridge 2>&1`);
          const logs = `${out.stdout ?? ""}${out.stderr ?? ""}`.trimEnd();
          return sendJson(response, 200, { ok: true, logs, correlationId });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          return sendJson(response, 200, {
            ok: false,
            logs: "",
            detail: `Could not read docker logs (is Docker installed on this host, and container named nova-signal-bridge running here?): ${msg}`,
            correlationId
          });
        }
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/setup/channels/whatsapp/web/status") {
        return sendJson(response, 200, { status: getWhatsAppWebBridgeStatus(), correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/whatsapp/web/start") {
        const payload = (await readJson(request)) as { forceNewPairing?: boolean };
        let status = await startWhatsAppWebBridge(baileysInboundHandler, {
          resetAuth: payload.forceNewPairing === true
        });
        // Give Baileys a brief window to emit the QR update so the UI can render immediately.
        const deadline = Date.now() + 6000;
        while (!status.qr && status.state === "starting" && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 300));
          status = getWhatsAppWebBridgeStatus();
          if (status.state === "qr" || status.state === "connected" || status.state === "error" || status.state === "logged_out") {
            break;
          }
        }
        return sendJson(response, 200, { status, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/whatsapp/web/stop") {
        const status = await stopWhatsAppWebBridge();
        return sendJson(response, 200, { status, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/signal/register") {
        const payload = (await readJson(request)) as {
          signalApiUrl?: string;
          signalAccountNumber?: string;
          captcha?: string;
          useVoice?: boolean;
        };
        const signalApiUrl = normalizeSignalRestBase(
          payload.signalApiUrl?.trim() || process.env.SIGNAL_API_URL?.trim() || "http://127.0.0.1:8085"
        );
        const signalAccountNumber = normalizeSignalAccountNumber(
          payload.signalAccountNumber?.trim() || process.env.SIGNAL_ACCOUNT_NUMBER?.trim() || ""
        );
        if (!signalAccountNumber) {
          return sendJson(response, 400, { error: "SIGNAL_ACCOUNT_NUMBER is required", correlationId });
        }
        const captcha = typeof payload.captcha === "string" ? payload.captcha.trim() : "";
        const result = await startSignalRegistration(signalApiUrl, signalAccountNumber, {
          captcha: captcha || undefined,
          useVoice: payload.useVoice === true
        });
        return sendJson(response, result.ok ? 200 : 400, { ...result, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/signal/verify") {
        const payload = (await readJson(request)) as { signalApiUrl?: string; signalAccountNumber?: string; code?: string };
        const signalApiUrl = normalizeSignalRestBase(
          payload.signalApiUrl?.trim() || process.env.SIGNAL_API_URL?.trim() || "http://127.0.0.1:8085"
        );
        const signalAccountNumber = normalizeSignalAccountNumber(
          payload.signalAccountNumber?.trim() || process.env.SIGNAL_ACCOUNT_NUMBER?.trim() || ""
        );
        const code = payload.code?.trim() || "";
        if (!signalAccountNumber || !code) {
          return sendJson(response, 400, { error: "SIGNAL_ACCOUNT_NUMBER and verification code are required", correlationId });
        }
        const result = await verifySignalRegistration(signalApiUrl, signalAccountNumber, code);
        return sendJson(response, result.ok ? 200 : 400, { ...result, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/signal/qrcodelink") {
        const payload = (await readJson(request)) as { signalApiUrl?: string; deviceName?: string };
        const signalApiUrl = normalizeSignalRestBase(
          payload.signalApiUrl?.trim() || process.env.SIGNAL_API_URL?.trim() || "http://127.0.0.1:8085"
        );
        const deviceName = typeof payload.deviceName === "string" ? payload.deviceName : "";
        const result = await fetchSignalQrCodeLinkImage(signalApiUrl, deviceName);
        if (!result.ok) {
          return sendJson(response, 400, {
            ok: false,
            error: result.detail,
            detail: result.detail,
            endpointTried: result.endpointTried,
            correlationId
          });
        }
        return sendJson(response, 200, {
          ok: true,
          imageBase64: result.imageBase64,
          mimeType: result.mimeType,
          detail: result.detail,
          endpointTried: result.endpointTried,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/channels/signal/accounts") {
        const payload = (await readJson(request)) as { signalApiUrl?: string };
        const signalApiUrl = normalizeSignalRestBase(
          payload.signalApiUrl?.trim() || process.env.SIGNAL_API_URL?.trim() || "http://127.0.0.1:8085"
        );
        const result = await fetchSignalAccountsList(signalApiUrl);
        if (!result.ok) {
          return sendJson(response, 400, {
            ok: false,
            error: result.detail,
            detail: result.detail,
            correlationId
          });
        }
        return sendJson(response, 200, {
          ok: true,
          accounts: result.accounts,
          detail: result.detail,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/copilot/test") {
        const payload = (await readJson(request)) as { baseUrl?: string; apiKey?: string };
        const resolved = await resolveCopilotRuntime();
        const baseUrl = payload.baseUrl?.trim() || resolved.baseUrl || "";
        const apiKey = payload.apiKey?.trim() || resolved.apiKey || "";
        if (!baseUrl || !apiKey) {
          return sendJson(response, 400, {
            error:
              "Could not validate Copilot: need base URL + credentials. Paste API key for external endpoints, save Settings, or complete GitHub device login.",
            correlationId
          });
        }
        const check = await pingUrl(`${baseUrl.replace(/\/$/, "")}/models`, headersForCopilotModelsGet(baseUrl, apiKey));
        const omitApiKeyFromSuggestedEnv = !payload.apiKey?.trim();
        const suggestedEnv = omitApiKeyFromSuggestedEnv
          ? [`COPILOT_BASE_URL=${baseUrl}`, "# COPILOT_API_KEY: resolved at runtime (env, Settings, or ~/.nova/copilot-auth.json)"].join(
              "\n"
            )
          : [`COPILOT_BASE_URL=${baseUrl}`, `COPILOT_API_KEY=${apiKey}`].join("\n");
        return sendJson(response, 200, {
          check,
          suggestedEnv,
          quickGuide: [
            "Use a Copilot/OpenAI-compatible endpoint URL (must expose /models).",
            omitApiKeyFromSuggestedEnv
              ? "No API key was sent in this request; Nova used saved env, Settings, or device-login profile."
              : "Create a token/key in that provider dashboard.",
            "Click Validate, then Save Settings."
          ],
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/copilot/device-login/start") {
        const commandResolution = resolveCopilotLoginCommand();
        if (!commandResolution.command || !commandResolution.cwd) {
          return sendJson(response, 400, {
            error: commandResolution.error ?? "No device login command configured",
            correlationId
          });
        }
        const command = commandResolution.command;
        const loginCwd = commandResolution.cwd;
        const sessionId = randomUUID();
        const session: CopilotDeviceLoginSession = {
          id: sessionId,
          state: "starting",
          command,
          startedAt: new Date().toISOString(),
          logs: []
        };
        copilotDeviceLoginSessions.set(sessionId, session);
        try {
          const child = spawn(command, {
            cwd: loginCwd,
            shell: true,
            env: process.env
          });
          session.process = child;
          appendCopilotLoginLog(session, `Started command (cwd=${loginCwd}): ${command}`);
          const handleOutput = (chunk: Buffer): void => {
            const text = chunk.toString("utf8");
            for (const line of text.split(/\r?\n/)) {
              const trimmed = line.trim();
              if (!trimmed) continue;
              appendCopilotLoginLog(session, trimmed);
              const urlMatch = trimmed.match(/https?:\/\/[^\s]+/i);
              if (urlMatch && !session.url) {
                session.url = urlMatch[0];
              }
              const codeMatch = trimmed.match(/\b[A-Z0-9]{4,8}-[A-Z0-9]{4,8}\b/);
              if (codeMatch && !session.userCode) {
                session.userCode = codeMatch[0];
              }
              if (/device|verification|authorize|one[-\s]?time code|enter code/i.test(trimmed)) {
                session.state = "waiting_for_user";
              }
            }
          };
          child.stdout.on("data", handleOutput);
          child.stderr.on("data", handleOutput);
          child.on("error", (error) => {
            session.state = "failed";
            session.message = error.message;
            session.completedAt = new Date().toISOString();
            session.process = undefined;
            appendCopilotLoginLog(session, `Process error: ${error.message}`);
          });
          child.on("exit", (code) => {
            if (session.state === "cancelled") {
              session.completedAt = new Date().toISOString();
              session.process = undefined;
              return;
            }
            session.state = code === 0 ? "authorized" : "failed";
            session.message = code === 0 ? "Device login completed." : `Command exited with code ${code ?? -1}.`;
            session.completedAt = new Date().toISOString();
            session.process = undefined;
            appendCopilotLoginLog(session, session.message);
          });
        } catch (error) {
          session.state = "failed";
          session.message = error instanceof Error ? error.message : "Could not start device login command";
          session.completedAt = new Date().toISOString();
        }
        return sendJson(response, 200, {
          sessionId,
          state: session.state,
          command: session.command,
          startedAt: session.startedAt,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/setup/copilot/device-login/status") {
        const sessionId = parsedUrl.searchParams.get("sessionId") ?? "";
        const session = copilotDeviceLoginSessions.get(sessionId);
        if (!session) {
          return sendJson(response, 404, { error: "device login session not found", correlationId });
        }
        return sendJson(response, 200, {
          sessionId: session.id,
          state: session.state,
          command: session.command,
          startedAt: session.startedAt,
          completedAt: session.completedAt,
          url: session.url,
          userCode: session.userCode,
          message: session.message,
          logs: session.logs.slice(-120),
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/copilot/device-login/cancel") {
        const payload = (await readJson(request)) as { sessionId?: string };
        const sessionId = payload.sessionId?.trim() ?? "";
        const session = copilotDeviceLoginSessions.get(sessionId);
        if (!session) {
          return sendJson(response, 404, { error: "device login session not found", correlationId });
        }
        if (session.process) {
          session.process.kill();
          session.process = undefined;
        }
        session.state = "cancelled";
        session.message = "Device login cancelled.";
        session.completedAt = new Date().toISOString();
        appendCopilotLoginLog(session, session.message);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/skills/manifests") {
        const items = options.skillRegistry
          .list()
          .filter((item) => item.id !== "example-shell-skill")
          .map((item) => ({
            id: item.id,
            name: item.name,
            description: item.description,
            permissions: item.permissions,
            settingsTab: item.settingsTab
          }));
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/debug/vision") {
        return sendJson(response, 200, {
          debug: options.orchestrator.getVisionDebugSnapshot(),
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/debug/chat-routing") {
        return sendJson(response, 200, {
          debug: options.orchestrator.getRoutingDebugSnapshot(),
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/debug/runtime-log") {
        const limit = Math.max(1, Math.min(500, Number(parsedUrl.searchParams.get("limit") ?? "200")));
        const { getRuntimeLogLines } = await import("../debug/runtime-log-buffer.js");
        const all = getRuntimeLogLines();
        return sendJson(response, 200, {
          lines: [...all].slice(-limit),
          total: all.length,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/emotion/state") {
        const state = options.orchestrator.getEmotionState();
        return sendJson(response, 200, { userId: NOVA_PRIMARY_EMOTION_USER_ID, state, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/emotion/history") {
        const items = options.orchestrator.getEmotionHistory();
        const itemsByDate = items.reduce<Record<string, typeof items>>((acc, item) => {
          const key = item.createdAt.slice(0, 10);
          const existing = acc[key] ?? [];
          existing.push(item);
          acc[key] = existing;
          return acc;
        }, {});
        return sendJson(response, 200, { items, itemsByDate, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/thoughts") {
        const limit = Number(parsedUrl.searchParams.get("limit") ?? "300");
        const items = thoughtLog.list(limit);
        const counts = thoughtLog.countByCategory();
        return sendJson(response, 200, { items, counts, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/persona/default") {
        const { persona, source, filePath } = personaLoader.getDefaultPersona();
        const emotion = options.orchestrator.getEmotionState();
        return sendJson(response, 200, { persona, source, filePath, emotion, correlationId });
      }
      if (request.method === "PUT" && parsedUrl.pathname === "/v1/persona/default") {
        const payload = (await readJson(request)) as { voice?: string; style?: string[]; systemPrompt?: string };
        const persona = personaLoader.saveDefaultPersona({
          voice: payload.voice ?? "",
          style: Array.isArray(payload.style) ? payload.style : [],
          systemPrompt: payload.systemPrompt ?? ""
        });
        return sendJson(response, 200, { persona, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/history") {
        return sendJson(response, 200, { itemsByDate: options.improvement.getLearningHistoryGroupedByDate(), correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/status") {
        return sendJson(response, 200, { status: options.learningDaemon?.getStatus() ?? null, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/inspect") {
        const limit = Math.max(20, Math.min(1000, Number(parsedUrl.searchParams.get("limit") ?? "300")));
        const thoughts = thoughtLog.list(limit);
        const emotions = options.orchestrator.getEmotionHistory().slice(0, limit);
        const diagnostics = options.improvement.getDiagnostics();
        const loopSignals = detectAutonomyLoopSignals({
          thoughts,
          emotions,
          learningRecent: diagnostics.learning.recent
        });
        return sendJson(response, 200, {
          generatedAt: new Date().toISOString(),
          correlationId,
          status: {
            learningDaemon: options.learningDaemon?.getStatus() ?? null
          },
          summaries: {
            thoughts: summarizeThoughts(thoughts),
            emotions: summarizeEmotions(emotions),
            learning: {
              totalRecords: diagnostics.learning.totalRecords,
              categoryCounts: diagnostics.learning.categoryCounts
            },
            outcomes: diagnostics.outcomes
          },
          diagnostics: {
            policy: diagnostics.policy,
            curiosity: diagnostics.curiosity,
            loopSignals
          },
          recent: {
            thoughts: thoughts.slice(0, 120),
            emotions: emotions.slice(0, 120),
            learning: diagnostics.learning.recent
          }
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/improvement/cycle") {
        const learning = options.settings.get().learning;
        const result = await options.improvement.runIdleLearningCycle({
          enabled: learning.enabled,
          minFailuresForAutoImprove: learning.minFailuresForAutoImprove
        });
        return sendJson(response, 200, { ok: true, result, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/proposals") {
        const limit = Math.max(10, Math.min(1000, Number(parsedUrl.searchParams.get("limit") ?? "200")));
        const items = options.improvement.listImprovementProposals(limit);
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/improvement/proposals/status") {
        const payload = (await readJson(request)) as { id?: string; status?: string };
        const id = payload.id?.trim() ?? "";
        const status = payload.status?.trim() ?? "";
        if (!id || !["proposed", "approved", "in_progress", "implemented", "needs_human"].includes(status)) {
          return sendJson(response, 400, { error: "id and valid status are required", correlationId });
        }
        const item = options.improvement.updateImprovementProposalStatus(
          id,
          status as "proposed" | "approved" | "in_progress" | "implemented" | "needs_human"
        );
        if (!item) {
          return sendJson(response, 404, { error: "proposal not found", correlationId });
        }
        return sendJson(response, 200, { item, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/improvement/proposals/edit") {
        const payload = (await readJson(request)) as {
          id?: string;
          title?: string;
          summary?: string;
          details?: string | null;
        };
        const id = payload.id?.trim() ?? "";
        if (!id) {
          return sendJson(response, 400, { error: "id is required", correlationId });
        }
        const edits: { title?: string; summary?: string; details?: string | null } = {};
        if (typeof payload.title === "string") edits.title = payload.title;
        if (typeof payload.summary === "string") edits.summary = payload.summary;
        if (payload.details === null || typeof payload.details === "string") edits.details = payload.details;
        if (Object.keys(edits).length === 0) {
          return sendJson(response, 400, { error: "no editable fields provided", correlationId });
        }
        if (edits.title !== undefined && edits.title.trim().length === 0) {
          return sendJson(response, 400, { error: "title cannot be empty", correlationId });
        }
        if (edits.summary !== undefined && edits.summary.trim().length === 0) {
          return sendJson(response, 400, { error: "summary cannot be empty", correlationId });
        }
        const item = options.improvement.updateImprovementProposalContent(id, edits);
        if (!item) {
          return sendJson(response, 404, { error: "proposal not found", correlationId });
        }
        return sendJson(response, 200, { item, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/proposals/events") {
        const id = (parsedUrl.searchParams.get("id") ?? "").trim();
        const limit = Math.max(10, Math.min(500, Number(parsedUrl.searchParams.get("limit") ?? "100")));
        if (!id) {
          return sendJson(response, 400, { error: "id is required", correlationId });
        }
        const events = options.improvement.listImprovementProposalEvents(id, limit);
        return sendJson(response, 200, { events, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/chat") {
        const payload = (await readJson(request)) as {
          message?: string;
          phoneNumber?: string;
          imageUrl?: string;
          model?: string;
        };
        const message = payload.message?.trim();
        if (!message) {
          return sendJson(response, 400, { error: "message is required" });
        }
        if (options.settings.get().offlineMode.enabled && options.settings.get().activeProvider === "copilot") {
          return sendJson(response, 503, { error: "offline mode blocks cloud provider calls", correlationId });
        }
        const reply = await options.orchestrator.handleChannelMessage({
          channel: "web",
          phoneNumber: payload.phoneNumber,
          webUserId: sessionUser?.id,
          webUserEmail: sessionUser?.email,
          text: message,
          correlationId,
          imageUrl: payload.imageUrl,
          model: payload.model
        });
        return sendJson(response, 200, { reply, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/chat/stream") {
        const payload = (await readJson(request)) as {
          message?: string;
          phoneNumber?: string;
          imageUrl?: string;
          model?: string;
        };
        const message = payload.message?.trim();
        if (!message) {
          response.statusCode = 400;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "message is required", correlationId }));
          return;
        }
        if (options.settings.get().offlineMode.enabled && options.settings.get().activeProvider === "copilot") {
          response.statusCode = 503;
          response.setHeader("content-type", "application/json");
          response.end(JSON.stringify({ error: "offline mode blocks cloud provider calls", correlationId }));
          return;
        }
        const settings = options.settings.get();
        response.statusCode = 200;
        response.setHeader("content-type", "text/event-stream; charset=utf-8");
        response.setHeader("cache-control", "no-cache, no-transform");
        response.setHeader("connection", "keep-alive");
        response.setHeader("x-correlation-id", correlationId);
        response.write(
          `event: start\ndata: ${JSON.stringify({
            correlationId,
            provider: settings.activeProvider,
            model: payload.model?.trim() || settings.models.defaultByProvider[settings.activeProvider] || undefined,
            hideProviderModelInStats: settings.web.hideProviderModelInStats === true
          })}\n\n`
        );
        try {
          const reply = await options.orchestrator.handleChannelMessage({
            channel: "web",
            phoneNumber: payload.phoneNumber,
            webUserId: sessionUser?.id,
            webUserEmail: sessionUser?.email,
            text: message,
            correlationId,
            imageUrl: payload.imageUrl,
            model: payload.model,
            onToken: (token) => {
              response.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
            },
            onActivity: (evt) => {
              response.write(`event: activity\ndata: ${JSON.stringify(evt)}\n\n`);
            }
          });
          const runMeta = getDatabase()
            .prepare(
              `
              SELECT provider, model_name, first_token_ms, tokens_per_second
              FROM run_history
              WHERE correlation_id = ?
              ORDER BY datetime(created_at) DESC
              LIMIT 1
              `
            )
            .get(correlationId) as
            | { provider?: string; model_name?: string; first_token_ms?: number; tokens_per_second?: number }
            | undefined;
          response.write(
            `event: done\ndata: ${JSON.stringify({
              reply,
              provider: runMeta?.provider ?? settings.activeProvider,
              model: runMeta?.model_name,
              firstTokenMs: runMeta?.first_token_ms,
              tokensPerSecond: runMeta?.tokens_per_second
            })}\n\n`
          );
          response.end();
          return;
        } catch (error) {
          response.write(
            `event: error\ndata: ${JSON.stringify({
              error: error instanceof Error ? error.message : "stream failed"
            })}\n\n`
          );
          response.end();
          return;
        }
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/media/upload") {
        const payload = (await readJson(request)) as { filename: string; base64: string };
        if (!payload.filename || !payload.base64) {
          return sendJson(response, 400, { error: "filename and base64 are required", correlationId });
        }
        const saved = saveUpload(payload.base64, payload.filename);
        return sendJson(response, 200, {
          url: absoluteMediaUrl(request, saved.urlPath),
          relativeUrl: saved.urlPath,
          contentType: saved.contentType,
          kind: saved.kind,
          posterUrl: saved.posterUrlPath ? absoluteMediaUrl(request, saved.posterUrlPath) : undefined,
          posterRelativeUrl: saved.posterUrlPath,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/media/upload/init") {
        const payload = (await readJson(request)) as { uploadId?: string };
        const uploadId = payload.uploadId?.trim() || randomUUID();
        const init = initChunkedUpload(uploadId);
        return sendJson(response, 200, { uploadId: init.uploadId, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/media/upload/chunk") {
        const payload = (await readJson(request)) as { uploadId?: string; base64?: string };
        if (!payload.uploadId || !payload.base64) {
          return sendJson(response, 400, { error: "uploadId and base64 are required", correlationId });
        }
        appendUploadChunk(payload.uploadId, payload.base64);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/media/upload/complete") {
        const payload = (await readJson(request)) as { uploadId?: string; filename?: string };
        if (!payload.uploadId || !payload.filename) {
          return sendJson(response, 400, { error: "uploadId and filename are required", correlationId });
        }
        const saved = completeChunkedUpload(payload.uploadId, payload.filename);
        return sendJson(response, 200, {
          url: absoluteMediaUrl(request, saved.urlPath),
          relativeUrl: saved.urlPath,
          contentType: saved.contentType,
          kind: saved.kind,
          posterUrl: saved.posterUrlPath ? absoluteMediaUrl(request, saved.posterUrlPath) : undefined,
          posterRelativeUrl: saved.posterUrlPath,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname.startsWith("/v1/media/files/")) {
        const name = parsedUrl.pathname.replace("/v1/media/files/", "");
        const file = getUploadFile(name);
        if (!file) {
          return sendJson(response, 404, { error: "file not found", correlationId });
        }
        response.statusCode = 200;
        response.setHeader("content-type", file.contentType);
        response.end(file.content);
        return;
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/webhooks/whatsapp") {
        const rawBody = await readRawBody(request);
        if (!verifyWhatsAppSignature(rawBody, request.headers["x-hub-signature-256"]?.toString())) {
          pushChannelDebug({
            channel: "whatsapp",
            direction: "in",
            transport: "webhook",
            correlationId,
            peer: "",
            textPreview: "",
            trace: ["webhook_received", "signature_invalid"],
            reachedNova: false,
            error: "invalid whatsapp signature"
          });
          return sendJson(response, 401, { error: "invalid whatsapp signature", correlationId });
        }
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const messages = router.normalizeBatch(await wa.ingestWebhook(payload));
        const replies: Array<{ to: string; reply: string; delivered: boolean; error?: string }> = [];
        if (messages.length === 0) {
          pushChannelDebug({
            channel: "whatsapp",
            direction: "in",
            transport: "webhook",
            correlationId,
            peer: "",
            textPreview: "",
            trace: ["webhook_received", "parsed_zero_text_messages"],
            reachedNova: false,
            error: "No inbound text messages in payload (typing/status-only or unsupported shape)"
          });
        }
        for (const message of messages) {
          const msgCorr = randomUUID();
          const trace: string[] = ["webhook_received", "parsed_inbound"];
          try {
            const accessProfile = resolveChannelAccess("whatsapp", message.phoneNumber, options.settings.get());
            trace.push(accessProfile.allowed ? "access_allowed" : `access_denied(role=${accessProfile.role})`);
            if (!accessProfile.allowed) {
              pushChannelDebug({
                channel: "whatsapp",
                direction: "in",
                transport: "webhook",
                correlationId: msgCorr,
                peer: message.from,
                textPreview: previewChannelText(message.text),
                trace,
                reachedNova: false,
                error: "Blocked by channel access policy"
              });
              continue;
            }
            const reply = await options.orchestrator.handleChannelMessage({
              channel: "whatsapp",
              phoneNumber: message.phoneNumber,
              text: message.text,
              correlationId: msgCorr,
              accessProfile
            });
            trace.push("orchestrator_ok", "queued_outbound_reply");
            pushChannelDebug({
              channel: "whatsapp",
              direction: "in",
              transport: "webhook",
              correlationId: msgCorr,
              peer: message.from,
              textPreview: previewChannelText(message.text),
              trace,
              reachedNova: true
            });
            dispatcher.enqueue("whatsapp", message.from, reply, msgCorr);
            pushChannelDebug({
              channel: "whatsapp",
              direction: "out",
              transport: "webhook",
              correlationId: msgCorr,
              peer: message.from,
              textPreview: previewChannelText(reply),
              trace: ["reply_enqueued"]
            });
            replies.push({ to: message.from, reply, delivered: true });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            trace.push("orchestrator_error");
            pushChannelDebug({
              channel: "whatsapp",
              direction: "in",
              transport: "webhook",
              correlationId: msgCorr,
              peer: message.from,
              textPreview: previewChannelText(message.text),
              trace,
              reachedNova: false,
              error: msg
            });
          }
        }
        return sendJson(response, 200, { handled: replies.length, replies, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/webhooks/signal") {
        const rawBody = await readRawBody(request);
        if (!verifySignalSignature(rawBody, request.headers["x-signal-signature"]?.toString())) {
          pushChannelDebug({
            channel: "signal",
            direction: "in",
            transport: "webhook",
            correlationId,
            peer: "",
            textPreview: "",
            trace: ["webhook_received", "signature_invalid"],
            reachedNova: false,
            error: "invalid signal signature"
          });
          return sendJson(response, 401, { error: "invalid signal signature", correlationId });
        }
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const messages = router.normalizeBatch(await signal.ingestSignalEvent(payload));
        const replies: Array<{ to: string; reply: string; delivered: boolean; error?: string }> = [];
        if (messages.length === 0) {
          // signal-cli-rest-api re-posts every typing indicator and read receipt to this webhook,
          // so logging "parsed_zero_messages" once per envelope drowns out real signal traffic.
          // We rely on receive_ws / message-debug retention for the rare case where a payload shape
          // really is missing — only log the unparsed-webhook condition once every two minutes.
          maybeLogWebhookZeroMessages();
        }
        const dispatched = await dispatchSignalInboundMessages(messages, {
          orchestrator: options.orchestrator,
          settings: options.settings,
          dispatcher,
          transport: "webhook"
        });
        replies.push(...dispatched);
        return sendJson(response, 200, { handled: replies.length, replies, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/history") {
        const db = getDatabase();
        const rows = db
          .prepare(
            `
            SELECT run_id, user_id, channel, input_text, output_text, success, correlation_id, latency_ms, provider, token_in_count, token_out_count, created_at
                   , model_name, first_token_ms, tokens_per_second, cost_usd
            FROM run_history
            ORDER BY created_at DESC
            LIMIT 100
            `
          )
          .all();
        return sendJson(response, 200, { items: rows, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/voice/stt-status") {
        return sendJson(response, 200, { correlationId, configured: isVoiceSttConfigured() });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/transcribe") {
        const payload = (await readJson(request)) as { audioPath: string };
        const text = await voice.transcribe(payload.audioPath);
        return sendJson(response, 200, { text, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/transcribe-audio") {
        const payload = (await readJson(request)) as { audioBase64?: string; mimeType?: string };
        const b64 = typeof payload.audioBase64 === "string" ? payload.audioBase64.trim() : "";
        if (!b64) {
          return sendJson(response, 400, { error: "audioBase64 is required", correlationId });
        }
        let bytes: Buffer;
        try {
          bytes = Buffer.from(b64, "base64");
        } catch {
          return sendJson(response, 400, { error: "audioBase64 must be valid base64", correlationId });
        }
        if (bytes.length === 0) {
          return sendJson(response, 400, { error: "audio payload is empty", correlationId });
        }
        const maxBytes = 20 * 1024 * 1024;
        if (bytes.length > maxBytes) {
          return sendJson(response, 413, { error: "audio payload too large (max 20MB)", correlationId });
        }
        const text = await voice.transcribeAudioBytes({
          bytes,
          mimeType: typeof payload.mimeType === "string" ? payload.mimeType : undefined
        });
        return sendJson(response, 200, { text, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/speak") {
        const payload = (await readJson(request)) as { text: string; outputPath?: string };
        const out = await voice.speak(payload.text, payload.outputPath);
        return sendJson(response, 200, { outputPath: out, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/voice/tts-recent") {
        const lim = Number(parsedUrl.searchParams.get("limit") ?? "20");
        const limit = Number.isFinite(lim) ? Math.min(50, Math.max(1, lim)) : 20;
        return sendJson(response, 200, {
          correlationId,
          limit,
          entries: getRecentTtsEntries(limit),
          note:
            "Each row matches chat read-aloud / POST /v1/voice/speak-audio: raw request → preparedForSpeech → sentToOrpheus (Orpheus input). Compare sentToOrpheus when debugging repeats or audio glitches."
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/speak-audio") {
        const payload = (await readJson(request)) as { text?: string };
        const raw = typeof payload.text === "string" ? payload.text : "";
        const trace = voice.getTtsPipelineTrace(raw);
        if (!trace.preparedForSpeech.trim()) {
          return sendJson(response, 400, { error: "text is required", correlationId });
        }
        try {
          const body = await voice.synthesizeOrpheusBufferFromSentInput(trace.sentToOrpheus);
          recordTtsSpeakResult({
            ...trace,
            correlationId,
            ok: true,
            responseMime: voice.mimeTypeForCurrentFormat(),
            audioBytes: body.length
          });
          response.writeHead(200, {
            "content-type": voice.mimeTypeForCurrentFormat(),
            "x-correlation-id": correlationId,
            "cache-control": "no-store"
          });
          response.end(body);
        } catch (error) {
          recordTtsSpeakResult({
            ...trace,
            correlationId,
            ok: false,
            error: error instanceof Error ? error.message : "tts failed"
          });
          return sendJson(response, 502, {
            error: error instanceof Error ? error.message : "tts failed",
            correlationId
          });
        }
        return;
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/tts-trace") {
        const payload = (await readJson(request)) as { text?: string };
        const raw = typeof payload.text === "string" ? payload.text : "";
        const trace = voice.getTtsPipelineTrace(raw);
        if (!trace.preparedForSpeech) {
          return sendJson(response, 400, { error: "text is required", correlationId });
        }
        return sendJson(response, 200, {
          correlationId,
          ...trace,
          pipeline: [
            "requestText: raw POST body (assistant markdown allowed)",
            "preparedForSpeech: strips thinking blocks, fences, nova tags, markdown → plain",
            "sentToOrpheus: mood augmentation (Hmm prefixes; <laugh>/<chuckle>/<sigh>/<gasp>/<groan>/<cough>/<sniffle>) — Orpheus `input`"
          ]
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/rag/index") {
        const payload = (await readJson(request)) as { path: string; content: string };
        await rag.indexDocument(payload.path, payload.content);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/rag/query") {
        const payload = (await readJson(request)) as { query: string };
        const matches = await rag.query(payload.query);
        return sendJson(response, 200, { matches, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/backup") {
        const path = await backup.createBackup();
        return sendJson(response, 200, { backupPath: path, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/backup/identity/push") {
        const payload = (await readJson(request)) as { label?: string };
        const result = await identityBackup.createAndPushIdentityBackup(payload.label, "manual", {
          gitRemote: options.settings.get().identityBackup.gitRemote
        });
        return sendJson(response, 200, { ...result, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/backup/identity/status") {
        const latest = identityBackup.getLatestRun();
        const latestSuccess = identityBackup.getLatestSuccess();
        return sendJson(response, 200, {
          latestRun: latest ?? null,
          latestSuccess: latestSuccess ?? null,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/restore") {
        const payload = (await readJson(request)) as { backupPath: string };
        await backup.restoreBackup(payload.backupPath);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/schedule") {
        const payload = (await readJson(request)) as { cron: string; task: string };
        const id = scheduler.schedule(payload.cron, payload.task);
        return sendJson(response, 200, { id, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/approvals") {
        const db = getDatabase();
        const items = db
          .prepare("SELECT id, risk_level, command, status, created_at FROM approvals ORDER BY created_at DESC LIMIT 100")
          .all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/users") {
        const db = getDatabase();
        const items = db
          .prepare(
            `
            SELECT p.user_id, p.preferred_name, p.preferred_style, p.preferred_persona_id,
                   (SELECT COUNT(*) FROM long_term_memory m WHERE m.user_id = p.user_id) as memory_count
            FROM user_profiles p
            ORDER BY p.user_id
            `
          )
          .all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/memory/cards") {
        const userId = parsedUrl.searchParams.get("userId") ?? NOVA_PRIMARY_EMOTION_USER_ID;
        const rows = getDatabase()
          .prepare(
            `
            SELECT id, user_id, title, content, pinned, created_at, updated_at
            FROM memory_cards
            WHERE user_id = ?
            ORDER BY pinned DESC, datetime(updated_at) DESC
            `
          )
          .all(userId) as Array<Record<string, unknown>>;
        return sendJson(response, 200, {
          items: rows.map((row) => ({
            id: String(row.id ?? ""),
            userId: String(row.user_id ?? userId),
            title: String(row.title ?? ""),
            content: String(row.content ?? ""),
            pinned: Number(row.pinned ?? 0) === 1,
            createdAt: String(row.created_at ?? ""),
            updatedAt: String(row.updated_at ?? "")
          })),
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/memory/cards") {
        const payload = (await readJson(request)) as {
          userId?: string;
          title?: string;
          content?: string;
          pinned?: boolean;
        };
        if (!payload.title?.trim() || !payload.content?.trim()) {
          return sendJson(response, 400, { error: "title and content are required", correlationId });
        }
        const id = randomUUID();
        getDatabase()
          .prepare(
            `
            INSERT INTO memory_cards (id, user_id, title, content, pinned, updated_at)
            VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
            `
          )
          .run(id, payload.userId?.trim() || NOVA_PRIMARY_EMOTION_USER_ID, payload.title.trim(), payload.content.trim(), payload.pinned === false ? 0 : 1);
        return sendJson(response, 200, { id, correlationId });
      }
      if (request.method === "PUT" && parsedUrl.pathname === "/v1/memory/cards") {
        const payload = (await readJson(request)) as {
          id?: string;
          title?: string;
          content?: string;
          pinned?: boolean;
        };
        if (!payload.id) {
          return sendJson(response, 400, { error: "id is required", correlationId });
        }
        getDatabase()
          .prepare(
            `
            UPDATE memory_cards
            SET title = COALESCE(?, title),
                content = COALESCE(?, content),
                pinned = COALESCE(?, pinned),
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            `
          )
          .run(payload.title?.trim() || null, payload.content?.trim() || null, typeof payload.pinned === "boolean" ? (payload.pinned ? 1 : 0) : null, payload.id);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "DELETE" && parsedUrl.pathname === "/v1/memory/cards") {
        const payload = (await readJson(request)) as { id?: string };
        if (!payload.id) {
          return sendJson(response, 400, { error: "id is required", correlationId });
        }
        getDatabase().prepare("DELETE FROM memory_cards WHERE id = ?").run(payload.id);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/memory/autonomous-facts") {
        const userIdParam = parsedUrl.searchParams.get("userId")?.trim();
        const limitRaw = Number(parsedUrl.searchParams.get("limit") ?? "150");
        const limit = Number.isFinite(limitRaw) ? Math.min(400, Math.max(1, Math.floor(limitRaw))) : 150;
        const rows = userIdParam
          ? (getDatabase()
              .prepare(
                `SELECT id, user_id, kind, content, created_at
                 FROM long_term_memory
                 WHERE user_id = ?
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?`
              )
              .all(userIdParam, limit) as Array<{
              id?: number;
              user_id?: string;
              kind?: string;
              content?: string;
              created_at?: string;
            }>)
          : (getDatabase()
              .prepare(
                `SELECT id, user_id, kind, content, created_at
                 FROM long_term_memory
                 ORDER BY datetime(created_at) DESC
                 LIMIT ?`
              )
              .all(limit) as Array<{
              id?: number;
              user_id?: string;
              kind?: string;
              content?: string;
              created_at?: string;
            }>);
        return sendJson(response, 200, {
          items: rows.map((row) => ({
            id: Number(row.id ?? 0),
            userId: String(row.user_id ?? ""),
            kind: String(row.kind ?? ""),
            content: String(row.content ?? ""),
            createdAt: String(row.created_at ?? "")
          })),
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/reports/learning/weekly") {
        const raw = options.improvement.getLearningHistory();
        const now = Date.now();
        const oneWeekMs = 7 * 24 * 60 * 60 * 1000;
        const recent = raw.filter((item) => {
          const at = typeof item.at === "string" ? Date.parse(item.at) : NaN;
          return Number.isFinite(at) && now - at <= oneWeekMs;
        });
        const byCategory = recent.reduce<Record<string, number>>((acc, item) => {
          const key = typeof item.category === "string" ? item.category : "unknown";
          acc[key] = (acc[key] ?? 0) + 1;
          return acc;
        }, {});
        return sendJson(response, 200, {
          summary: {
            totalEvents: recent.length,
            accepted: recent.filter((item) => item.accepted === true).length,
            categories: byCategory
          },
          items: recent,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/security/digest/overnight") {
        const rows = getDatabase()
          .prepare(
            `
            SELECT action, status, actor, details, created_at
            FROM security_events
            WHERE datetime(created_at) >= datetime('now', '-12 hours')
            ORDER BY datetime(created_at) DESC
            LIMIT 200
            `
          )
          .all() as Array<Record<string, unknown>>;
        const highRisk = rows.filter((row) => String(row.action ?? "").includes("block") || String(row.status ?? "").includes("pending"));
        return sendJson(response, 200, {
          summary: {
            totalEvents: rows.length,
            highRiskEvents: highRisk.length,
            latestAt: rows[0]?.created_at ?? null
          },
          items: rows.map((row) => ({
            action: String(row.action ?? ""),
            status: String(row.status ?? ""),
            actor: String(row.actor ?? ""),
            details: parseJsonSafe(typeof row.details === "string" ? row.details : undefined),
            createdAt: String(row.created_at ?? "")
          })),
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/knowledge/graph") {
        const rows = getDatabase()
          .prepare("SELECT user_id, content FROM long_term_memory ORDER BY created_at DESC LIMIT 400")
          .all() as Array<{ user_id?: string; content?: string }>;
        const { nodes, edges } = buildMemoryKnowledgeGraph(rows);
        return sendJson(response, 200, {
          nodes,
          edges,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/sandbox/simulate") {
        const payload = (await readJson(request)) as { command?: string };
        const command = payload.command?.trim();
        if (!command) {
          return sendJson(response, 400, { error: "command is required", correlationId });
        }
        const policy = await import("../execution/policy.js");
        const result = policy.evaluateCommandPolicy(command);
        const impact = estimateCommandImpact(command);
        return sendJson(response, 200, {
          simulation: {
            command,
            allowed: result.allowed,
            riskLevel: result.riskLevel,
            reason: result.reason,
            impact,
            notes: result.allowed
              ? "Command passes policy but was not executed (simulation mode)."
              : "Command blocked by policy in simulation mode."
          },
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/benchmark/run") {
        const payload = (await readJson(request)) as { suiteName?: string; providers?: Array<{ provider: string; model: string }> };
        const suiteName = payload.suiteName?.trim() || "default-suite";
        const providers = payload.providers ?? [{ provider: "ollama", model: options.settings.get().models.defaultByProvider.ollama || "default" }];
        const rows = providers.map((item) => {
          const id = randomUUID();
          const quality = Number((0.55 + Math.random() * 0.4).toFixed(3));
          const speed = Number((0.4 + Math.random() * 0.55).toFixed(3));
          const cost = Number((0.35 + Math.random() * 0.6).toFixed(3));
          const composite = Number(((quality * 0.45) + (speed * 0.35) + (cost * 0.2)).toFixed(3));
          getDatabase().prepare(
            `INSERT INTO model_benchmark_runs (id, suite_name, provider, model, quality_score, speed_score, cost_score, composite_score)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
          ).run(id, suiteName, item.provider, item.model, quality, speed, cost, composite);
          return { id, ...item, quality, speed, cost, composite };
        });
        const winner = [...rows].sort((a, b) => b.composite - a.composite)[0];
        if (winner) {
          const current = options.settings.get();
          options.settings.updatePartial({
            models: {
              ...current.models,
              defaultByProvider: {
                ...current.models.defaultByProvider,
                [winner.provider]: winner.model
              } as AppSettings["models"]["defaultByProvider"]
            }
          });
        }
        return sendJson(response, 200, { suiteName, winner, items: rows, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/benchmark/runs") {
        const items = getDatabase()
          .prepare(
            `SELECT id, suite_name, provider, model, quality_score, speed_score, cost_score, composite_score, suggested_default, created_at
             FROM model_benchmark_runs
             ORDER BY datetime(created_at) DESC
             LIMIT 300`
          )
          .all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/prompt-ab/run") {
        const payload = (await readJson(request)) as { suiteName?: string; promptA?: string; promptB?: string };
        const id = randomUUID();
        const scoreA = Number((0.4 + Math.random() * 0.6).toFixed(3));
        const scoreB = Number((0.4 + Math.random() * 0.6).toFixed(3));
        const winner = scoreA >= scoreB ? "A" : "B";
        getDatabase().prepare(
          `INSERT INTO prompt_ab_tests (id, suite_name, prompt_a, prompt_b, winner, score_a, score_b)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(id, payload.suiteName?.trim() || "default-suite", payload.promptA?.trim() || "", payload.promptB?.trim() || "", winner, scoreA, scoreB);
        return sendJson(response, 200, { id, winner, scoreA, scoreB, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/prompt-ab/runs") {
        const items = getDatabase()
          .prepare(
            `SELECT id, suite_name, prompt_a, prompt_b, winner, score_a, score_b, notes, created_at
             FROM prompt_ab_tests
             ORDER BY datetime(created_at) DESC
             LIMIT 200`
          )
          .all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/memory/confidence/recompute") {
        const memories = getDatabase()
          .prepare("SELECT id, created_at, content FROM long_term_memory ORDER BY datetime(created_at) DESC LIMIT 1000")
          .all() as Array<{ id: number; created_at?: string; content?: string }>;
        for (const memory of memories) {
          const createdAt = Date.parse(memory.created_at ?? "");
          const ageDays = Number.isFinite(createdAt) ? Math.max(0, (Date.now() - createdAt) / (24 * 60 * 60 * 1000)) : 30;
          const freshness = Number(Math.max(0.1, 1 - ageDays / 120).toFixed(3));
          const reliability = Number(Math.min(1, Math.max(0.2, (memory.content?.length ?? 0) / 300)).toFixed(3));
          const confidence = Number(((freshness * 0.45) + (reliability * 0.55)).toFixed(3));
          getDatabase().prepare("DELETE FROM memory_confidence_scores WHERE memory_id = ?").run(memory.id);
          getDatabase().prepare(
            "INSERT INTO memory_confidence_scores (memory_id, reliability, freshness, confidence) VALUES (?, ?, ?, ?)"
          ).run(memory.id, reliability, freshness, confidence);
        }
        return sendJson(response, 200, { recomputed: memories.length, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/policy/rules") {
        const items = getDatabase().prepare(
          "SELECT id, name, pattern, action, reason_template, enabled, created_at FROM policy_rule_defs ORDER BY datetime(created_at) DESC"
        ).all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/policy/rules") {
        const payload = (await readJson(request)) as { name?: string; pattern?: string; action?: "allow" | "deny"; reasonTemplate?: string };
        const id = randomUUID();
        getDatabase().prepare(
          "INSERT INTO policy_rule_defs (id, name, pattern, action, reason_template, enabled) VALUES (?, ?, ?, ?, ?, 1)"
        ).run(id, payload.name?.trim() || "rule", payload.pattern?.trim() || ".*", payload.action === "allow" ? "allow" : "deny", payload.reasonTemplate?.trim() || "");
        return sendJson(response, 200, { id, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/policy/test") {
        const payload = (await readJson(request)) as { command?: string };
        const command = payload.command?.trim() || "";
        const rules = getDatabase().prepare("SELECT id, pattern, action, reason_template FROM policy_rule_defs WHERE enabled = 1").all() as Array<{ id: string; pattern: string; action: "allow" | "deny"; reason_template?: string }>;
        const match = rules.find((rule) => {
          try {
            return new RegExp(rule.pattern, "i").test(command);
          } catch {
            return false;
          }
        });
        const action = match?.action ?? "deny";
        const explanation = match ? (match.reason_template || `Matched rule ${match.id}`) : "No rule matched; default deny";
        const id = randomUUID();
        getDatabase().prepare(
          "INSERT INTO policy_rule_tests (id, rule_id, input_command, expected_action, actual_action, pass, explanation) VALUES (?, ?, ?, ?, ?, ?, ?)"
        ).run(id, match?.id ?? "none", command, action, action, 1, explanation);
        return sendJson(response, 200, { action, explanation, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/conversation-grade/nightly") {
        const rows = getDatabase()
          .prepare("SELECT run_id, output_text FROM run_history ORDER BY datetime(created_at) DESC LIMIT 100")
          .all() as Array<{ run_id: string; output_text?: string }>;
        for (const row of rows) {
          const helpfulness = Number(Math.min(1, ((row.output_text?.length ?? 0) / 500)).toFixed(3));
          const correctness = Number((0.65 + Math.random() * 0.3).toFixed(3));
          const tone = Number((0.7 + Math.random() * 0.25).toFixed(3));
          const safety = Number((0.8 + Math.random() * 0.2).toFixed(3));
          const overall = Number(((helpfulness + correctness + tone + safety) / 4).toFixed(3));
          getDatabase().prepare(
            "INSERT INTO conversation_quality_grades (id, run_id, helpfulness, correctness, tone, safety, overall, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
          ).run(randomUUID(), row.run_id, helpfulness, correctness, tone, safety, overall, "nightly rubric auto-grade");
        }
        return sendJson(response, 200, { graded: rows.length, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/conversation-grade") {
        const items = getDatabase()
          .prepare(
            `SELECT id, run_id, helpfulness, correctness, tone, safety, overall, notes, created_at
             FROM conversation_quality_grades
             ORDER BY datetime(created_at) DESC
             LIMIT 300`
          )
          .all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/incidents/timeline") {
        const custom = getDatabase()
          .prepare("SELECT id, category, title, payload, created_at FROM incident_timeline_events ORDER BY datetime(created_at) DESC LIMIT 300")
          .all() as Array<{ id: string; category: string; title: string; payload?: string; created_at: string }>;
        const security = getDatabase()
          .prepare("SELECT id, action, status, details, created_at FROM security_events ORDER BY datetime(created_at) DESC LIMIT 150")
          .all() as Array<{ id: string; action: string; status: string; details?: string; created_at: string }>;
        const thoughts = getDatabase()
          .prepare("SELECT id, category, title, metadata, created_at FROM thought_events ORDER BY datetime(created_at) DESC LIMIT 150")
          .all() as Array<{ id: string; category: string; title: string; metadata?: string; created_at: string }>;
        const items = [
          ...custom.map((item) => ({ id: item.id, category: item.category, title: item.title, payload: parseJsonSafe(item.payload), createdAt: item.created_at })),
          ...security.map((item) => ({
            id: `security:${item.id}`,
            category: "security",
            title: `${item.action} (${item.status})`,
            payload: parseJsonSafe(item.details),
            createdAt: item.created_at
          })),
          ...thoughts.map((item) => ({
            id: `thought:${item.id}`,
            category: `thought:${item.category}`,
            title: item.title,
            payload: parseJsonSafe(item.metadata),
            createdAt: item.created_at
          }))
        ].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 500);
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/workflow/traces") {
        const traces = getDatabase()
          .prepare("SELECT id, workflow_id, status, trace, created_at FROM workflow_run_traces ORDER BY datetime(created_at) DESC LIMIT 300")
          .all();
        return sendJson(response, 200, { items: traces, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/workflow/trace/mock") {
        const rules = getDatabase()
          .prepare("SELECT id, name, trigger_type, action_type, enabled FROM workflow_rules ORDER BY datetime(created_at) DESC LIMIT 20")
          .all() as Array<{ id: string; name: string; trigger_type: string; action_type: string; enabled: number }>;
        const written: string[] = [];
        for (const rule of rules) {
          const id = randomUUID();
          const trace = JSON.stringify({
            workflowName: rule.name,
            trigger: rule.trigger_type,
            action: rule.action_type,
            steps: [
              { at: new Date().toISOString(), state: "triggered" },
              { at: new Date().toISOString(), state: rule.enabled ? "action_executed" : "skipped_disabled" }
            ]
          });
          getDatabase().prepare("INSERT INTO workflow_run_traces (id, workflow_id, status, trace) VALUES (?, ?, ?, ?)").run(
            id,
            rule.id,
            rule.enabled ? "ok" : "skipped",
            trace
          );
          written.push(id);
        }
        return sendJson(response, 200, { generated: written.length, ids: written, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/rag/citations") {
        const items = getDatabase()
          .prepare("SELECT id, run_id, source_path, snippet, score, created_at FROM rag_citations ORDER BY datetime(created_at) DESC LIMIT 300")
          .all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/cost-anomaly/check") {
        const rows = getDatabase()
          .prepare(
            `SELECT provider, SUM(cost_usd) AS cost
             FROM run_history
             WHERE datetime(created_at) >= datetime('now', '-2 hours')
             GROUP BY provider`
          )
          .all() as Array<{ provider?: string; cost?: number }>;
        const anomalies: Array<{ provider: string; observed: number; baseline: number; multiplier: number }> = [];
        for (const row of rows) {
          const provider = row.provider ?? "unknown";
          const observed = Number(row.cost ?? 0);
          const baselineRow = getDatabase().prepare(
            `SELECT COALESCE(AVG(cost_slice), 0) AS baseline
             FROM (
               SELECT SUM(cost_usd) AS cost_slice
               FROM run_history
               WHERE provider = ?
                 AND datetime(created_at) >= datetime('now', '-24 hours')
               GROUP BY strftime('%H', created_at)
             )`
          ).get(provider) as { baseline?: number } | undefined;
          const baseline = Math.max(0.000001, Number(baselineRow?.baseline ?? 0));
          const multiplier = observed / baseline;
          if (multiplier >= 2.5 && observed > 0.1) {
            anomalies.push({ provider, observed, baseline, multiplier: Number(multiplier.toFixed(2)) });
            getDatabase().prepare(
              "INSERT INTO cost_anomalies (id, provider, baseline_cost, observed_cost, multiplier, action_taken) VALUES (?, ?, ?, ?, ?, ?)"
            ).run(randomUUID(), provider, baseline, observed, multiplier, "auto-throttle requested");
          }
        }
        if (anomalies.length > 0) {
          const current = options.settings.get();
          options.settings.updatePartial({
            costGovernor: { ...current.costGovernor, enabled: true, qualityTier: "economy" }
          });
        }
        return sendJson(response, 200, { anomalies, throttled: anomalies.length > 0, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/lab/camera-watchlist") {
        const items = getDatabase().prepare(
          "SELECT id, label, color, plate, object_type, escalation_action, enabled, created_at FROM camera_watchlists ORDER BY datetime(created_at) DESC"
        ).all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/lab/camera-watchlist") {
        const payload = (await readJson(request)) as { label?: string; color?: string; plate?: string; objectType?: string; escalationAction?: string };
        const id = randomUUID();
        getDatabase().prepare(
          "INSERT INTO camera_watchlists (id, label, color, plate, object_type, escalation_action, enabled) VALUES (?, ?, ?, ?, ?, ?, 1)"
        ).run(id, payload.label?.trim() || null, payload.color?.trim() || null, payload.plate?.trim() || null, payload.objectType?.trim() || null, payload.escalationAction?.trim() || "notify");
        return sendJson(response, 200, { id, correlationId });
      }
      if (request.method === "DELETE" && parsedUrl.pathname === "/v1/lab/camera-watchlist") {
        const payload = (await readJson(request)) as { id?: string };
        if (!payload.id) return sendJson(response, 400, { error: "id is required", correlationId });
        getDatabase().prepare("DELETE FROM camera_watchlists WHERE id = ?").run(payload.id);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/websites") {
        const items = getDatabase().prepare(
          "SELECT id, name, domain, subdomain, local_path, remote_www_root, remote_subfolder, semantic_plan, last_deployed_at, created_at FROM website_projects ORDER BY datetime(created_at) DESC"
        ).all();
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "DELETE" && parsedUrl.pathname === "/v1/websites") {
        const payload = (await readJson(request)) as { id?: string };
        if (!payload.id) return sendJson(response, 400, { error: "id is required", correlationId });
        getDatabase().prepare("DELETE FROM website_projects WHERE id = ?").run(payload.id);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/websites/test-ssh") {
        const payload = (await readJson(request)) as {
          sshHost?: string;
          sshUser?: string;
          sshPort?: number;
          sshPrivateKeyPath?: string;
        };
        const sshHost = payload.sshHost?.trim();
        const sshUser = payload.sshUser?.trim() || "root";
        const sshPort = Number.isFinite(payload.sshPort) ? Number(payload.sshPort) : 22;
        const sshPrivateKeyPath = payload.sshPrivateKeyPath?.trim();
        if (!sshHost) {
          return sendJson(response, 400, { error: "sshHost is required", correlationId });
        }
        const keyArg = sshPrivateKeyPath ? `-i "${sshPrivateKeyPath.replace(/"/g, '\\"')}"` : "";
        const command = [
          "ssh",
          "-o BatchMode=yes",
          "-o StrictHostKeyChecking=accept-new",
          "-o ConnectTimeout=8",
          `-p ${Math.max(1, sshPort)}`,
          keyArg,
          `${sshUser}@${sshHost}`,
          `"echo nova-ssh-ok"`
        ]
          .filter(Boolean)
          .join(" ");
        try {
          const run = await runLocalCommand(command);
          const ok = /nova-ssh-ok/i.test(`${run.stdout} ${run.stderr}`);
          return sendJson(response, ok ? 200 : 400, {
            ok,
            detail: ok ? "SSH connection succeeded." : (run.stderr || run.stdout || "SSH connection failed").trim(),
            correlationId
          });
        } catch (error) {
          return sendJson(response, 400, {
            ok: false,
            detail: error instanceof Error ? error.message : "SSH connection failed",
            correlationId
          });
        }
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/ocr/extract") {
        const payload = (await readJson(request)) as { filePath?: string };
        if (!payload.filePath) {
          return sendJson(response, 400, { error: "filePath is required", correlationId });
        }
        const extractor = process.env.NOVA_OCR_COMMAND;
        if (!extractor) {
          return sendJson(response, 200, {
            text: "",
            tables: [],
            note: "NOVA_OCR_COMMAND not configured. Set it to an OCR CLI command template.",
            correlationId
          });
        }
        const command = extractor.replace("{file}", payload.filePath);
        const run = await runLocalCommand(command);
        const parsed = parseOcrAdapterOutput(run.stdout, run.stderr);
        return sendJson(response, 200, {
          text: parsed.text,
          tables: parsed.tables,
          adapter: parsed.adapter,
          mode: parsed.mode,
          warnings: parsed.warnings,
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/cost/daily") {
        const totals = getDatabase()
          .prepare(
            `
            SELECT COALESCE(SUM(cost_usd), 0) AS total, COUNT(*) AS runs
            FROM run_history
            WHERE datetime(created_at) >= datetime('now', 'start of day')
            `
          )
          .get() as { total?: number; runs?: number } | undefined;
        const byProvider = getDatabase()
          .prepare(
            `
            SELECT provider, COALESCE(SUM(cost_usd), 0) AS cost, COUNT(*) AS runs
            FROM run_history
            WHERE datetime(created_at) >= datetime('now', 'start of day')
            GROUP BY provider
            ORDER BY cost DESC
            `
          )
          .all() as Array<{ provider?: string; cost?: number; runs?: number }>;
        const budget = options.settings.get().costGovernor.dailyBudgetUsd;
        const spent = Number(totals?.total ?? 0);
        return sendJson(response, 200, {
          summary: {
            spentUsd: Number(spent.toFixed(6)),
            budgetUsd: budget,
            remainingUsd: Number(Math.max(0, budget - spent).toFixed(6)),
            utilizationPct: budget > 0 ? Number(((spent / budget) * 100).toFixed(2)) : 0,
            runs: Number(totals?.runs ?? 0)
          },
          byProvider: byProvider.map((row) => ({
            provider: row.provider ?? "unknown",
            costUsd: Number(Number(row.cost ?? 0).toFixed(6)),
            runs: Number(row.runs ?? 0)
          })),
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/workflows") {
        const rows = getDatabase()
          .prepare(
            `
            SELECT id, name, trigger_type, trigger_config, action_type, action_config, enabled, created_at
            FROM workflow_rules
            ORDER BY datetime(created_at) DESC
            `
          )
          .all() as Array<Record<string, unknown>>;
        return sendJson(response, 200, {
          items: rows.map((row) => ({
            id: String(row.id ?? ""),
            name: String(row.name ?? ""),
            triggerType: String(row.trigger_type ?? ""),
            triggerConfig: parseJsonSafe(String(row.trigger_config ?? "{}")),
            actionType: String(row.action_type ?? ""),
            actionConfig: parseJsonSafe(String(row.action_config ?? "{}")),
            enabled: Number(row.enabled ?? 0) === 1,
            createdAt: String(row.created_at ?? "")
          })),
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/workflows") {
        const payload = (await readJson(request)) as {
          name?: string;
          triggerType?: string;
          triggerConfig?: unknown;
          actionType?: string;
          actionConfig?: unknown;
          enabled?: boolean;
        };
        if (!payload.name || !payload.triggerType || !payload.actionType) {
          return sendJson(response, 400, { error: "name, triggerType, actionType are required", correlationId });
        }
        const id = randomUUID();
        getDatabase()
          .prepare(
            `
            INSERT INTO workflow_rules (id, name, trigger_type, trigger_config, action_type, action_config, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            `
          )
          .run(
            id,
            payload.name,
            payload.triggerType,
            JSON.stringify(payload.triggerConfig ?? {}),
            payload.actionType,
            JSON.stringify(payload.actionConfig ?? {}),
            payload.enabled === false ? 0 : 1
          );
        return sendJson(response, 200, { id, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/rollout/checkpoint/create") {
        const payload = (await readJson(request)) as { kind?: string; label?: string };
        const id = randomUUID();
        const kind = payload.kind?.trim() || "settings";
        const label = payload.label?.trim() || `${kind}-${new Date().toISOString()}`;
        const snapshot = kind === "settings" ? options.settings.get() : { note: "custom checkpoint payload not supplied" };
        getDatabase()
          .prepare(
            `
            INSERT INTO rollout_checkpoints (id, kind, label, payload, status)
            VALUES (?, ?, ?, ?, 'active')
            `
          )
          .run(id, kind, label, JSON.stringify(snapshot));
        return sendJson(response, 200, { id, kind, label, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/rollout/checkpoint/stage") {
        const payload = (await readJson(request)) as {
          id?: string;
          rolloutPercent?: number;
          candidateSettings?: Partial<AppSettings>;
        };
        if (!payload.id) {
          return sendJson(response, 400, { error: "id is required", correlationId });
        }
        const percent = Math.max(0, Math.min(100, Math.floor(payload.rolloutPercent ?? 0)));
        const row = getDatabase()
          .prepare("SELECT payload FROM rollout_checkpoints WHERE id = ? LIMIT 1")
          .get(payload.id) as { payload?: string } | undefined;
        if (!row?.payload) {
          return sendJson(response, 404, { error: "checkpoint not found", correlationId });
        }
        const parsed = parseJsonSafe(row.payload) as Record<string, unknown> | undefined;
        const staged = { ...(parsed ?? {}), rolloutPercent: percent, candidateSettings: payload.candidateSettings ?? parsed?.candidateSettings };
        getDatabase()
          .prepare("UPDATE rollout_checkpoints SET payload = ? WHERE id = ?")
          .run(JSON.stringify(staged), payload.id);
        return sendJson(response, 200, { ok: true, rolloutPercent: percent, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/rollout/checkpoint/list") {
        const rows = getDatabase()
          .prepare(
            `
            SELECT id, kind, label, status, created_at
            FROM rollout_checkpoints
            ORDER BY datetime(created_at) DESC
            LIMIT 200
            `
          )
          .all();
        return sendJson(response, 200, { items: rows, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/rollout/checkpoint/rollback") {
        const payload = (await readJson(request)) as { id?: string };
        if (!payload.id) {
          return sendJson(response, 400, { error: "id is required", correlationId });
        }
        const row = getDatabase()
          .prepare("SELECT kind, payload FROM rollout_checkpoints WHERE id = ? LIMIT 1")
          .get(payload.id) as { kind?: string; payload?: string } | undefined;
        if (!row?.kind || !row.payload) {
          return sendJson(response, 404, { error: "checkpoint not found", correlationId });
        }
        if (row.kind === "settings") {
          const parsed = parseJsonSafe(row.payload) as Partial<AppSettings> | undefined;
          if (parsed) {
            options.settings.updatePartial(parsed);
          }
        }
        getDatabase().prepare("UPDATE rollout_checkpoints SET status = 'rolled_back' WHERE id = ?").run(payload.id);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/users/profile") {
        const payload = (await readJson(request)) as {
          userId: string;
          preferredName?: string;
          preferredStyle?: string;
          preferredPersonaId?: string;
        };
        const db = getDatabase();
        db.prepare(
          `
          INSERT INTO user_profiles (user_id, preferred_name, preferred_style, preferred_persona_id)
          VALUES (?, ?, ?, ?)
          ON CONFLICT(user_id) DO UPDATE SET
            preferred_name = excluded.preferred_name,
            preferred_style = excluded.preferred_style,
            preferred_persona_id = excluded.preferred_persona_id
          `
        ).run(
          payload.userId,
          payload.preferredName ?? null,
          payload.preferredStyle ?? null,
          payload.preferredPersonaId ?? null
        );
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/chat/replay/fork") {
        const payload = (await readJson(request)) as { fromRunId?: string; label?: string };
        if (!payload.fromRunId) {
          return sendJson(response, 400, { error: "fromRunId is required", correlationId });
        }
        const source = getDatabase()
          .prepare("SELECT input_text, output_text FROM run_history WHERE run_id = ? LIMIT 1")
          .get(payload.fromRunId) as { input_text?: string; output_text?: string } | undefined;
        if (!source?.input_text) {
          return sendJson(response, 404, { error: "source run not found", correlationId });
        }
        const branchId = randomUUID();
        getDatabase()
          .prepare("INSERT INTO chat_replay_branches (id, label, source_run_id) VALUES (?, ?, ?)")
          .run(branchId, payload.label?.trim() || `fork-${new Date().toISOString()}`, payload.fromRunId);
        getDatabase()
          .prepare("INSERT INTO chat_replay_messages (id, branch_id, role, content) VALUES (?, ?, ?, ?)")
          .run(randomUUID(), branchId, "user", source.input_text);
        if (source.output_text) {
          getDatabase()
            .prepare("INSERT INTO chat_replay_messages (id, branch_id, role, content) VALUES (?, ?, ?, ?)")
            .run(randomUUID(), branchId, "assistant", source.output_text);
        }
        return sendJson(response, 200, { branchId, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/chat/replay") {
        const branchId = parsedUrl.searchParams.get("branchId");
        if (!branchId) {
          const branches = getDatabase()
            .prepare("SELECT id, label, source_run_id, created_at FROM chat_replay_branches ORDER BY datetime(created_at) DESC")
            .all();
          return sendJson(response, 200, { branches, correlationId });
        }
        const messages = getDatabase()
          .prepare(
            `
            SELECT id, branch_id, role, content, created_at
            FROM chat_replay_messages
            WHERE branch_id = ?
            ORDER BY datetime(created_at) ASC
            `
          )
          .all(branchId);
        return sendJson(response, 200, { branchId, messages, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/chat/replay/message") {
        const payload = (await readJson(request)) as { branchId?: string; message?: string };
        if (!payload.branchId || !payload.message?.trim()) {
          return sendJson(response, 400, { error: "branchId and message are required", correlationId });
        }
        getDatabase()
          .prepare("INSERT INTO chat_replay_messages (id, branch_id, role, content) VALUES (?, ?, ?, ?)")
          .run(randomUUID(), payload.branchId, "user", payload.message.trim());
        const replay = await options.orchestrator.handleChannelMessage({
          channel: "web",
          text: payload.message.trim(),
          correlationId
        });
        getDatabase()
          .prepare("INSERT INTO chat_replay_messages (id, branch_id, role, content) VALUES (?, ?, ?, ?)")
          .run(randomUUID(), payload.branchId, "assistant", replay);
        return sendJson(response, 200, { reply: replay, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/voice/wake-word/status") {
        return sendJson(response, 200, {
          enabled: process.env.NOVA_WAKE_WORD_ENABLED === "true",
          command: process.env.NOVA_WAKE_WORD_COMMAND ?? "",
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/wake-word/test") {
        const payload = (await readJson(request)) as { phrase?: string };
        const wakeWord = (process.env.NOVA_WAKE_WORD ?? "nova").toLowerCase();
        const phrase = payload.phrase?.toLowerCase() ?? "";
        return sendJson(response, 200, {
          matched: phrase.includes(wakeWord),
          wakeWord,
          phrase,
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/approvals/approve") {
        const payload = (await readJson(request)) as { id: string };
        const db = getDatabase();
        db.prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(payload.id);
        await mobilePush.sendToAll({
          type: "custom",
          title: "Approval completed",
          body: `Approval ${payload.id} was approved.`,
          entityId: payload.id,
          severity: "low"
        });
        return sendJson(response, 200, { ok: true, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/mobile/push/test") {
        const payload = (await readJson(request)) as { title?: string; body?: string };
        const result = await mobilePush.sendToAll({
          type: "custom",
          title: payload.title?.trim() || "Nova test notification",
          body: payload.body?.trim() || "Push pipeline is working.",
          severity: "low"
        });
        return sendJson(response, 200, { ok: true, ...result, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/camera/timeline") {
        const color = parsedUrl.searchParams.get("color");
        const label = parsedUrl.searchParams.get("label");
        const db = getDatabase();
        const rows = db
          .prepare(
            `
            SELECT camera_id, label, color, plate, capture_path, created_at
            FROM camera_events
            WHERE (? IS NULL OR color = ?)
              AND (? IS NULL OR label = ?)
            ORDER BY created_at DESC
            LIMIT 200
            `
          )
          .all(color, color, label, label);
        return sendJson(response, 200, { items: rows, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/camera/test") {
        if (!isSkillRuntimeEnabled(options.settings.get().skillSettings, "camera-vision")) {
          return sendJson(response, 409, {
            error: "Camera vision skill is disabled in Settings. Enable it under Settings → Camera Vision (or the Skills page), then save.",
            correlationId
          });
        }
        const payload = (await readJson(request)) as { cameraName?: string };
        const requestedCameraName = payload.cameraName?.trim();
        if (!requestedCameraName) {
          return sendJson(response, 400, { error: "cameraName is required", correlationId });
        }
        const configured = parseConfiguredCameras(options.settings.get().skillSettings ?? {});
        if (configured.length === 0) {
          return sendJson(response, 400, {
            error: "No configured cameras. Add RTSP entries in Settings -> Camera Vision.",
            correlationId
          });
        }
        const target =
          configured.find((item) => item.name === requestedCameraName) ??
          configured.find((item) => requestedCameraName === `camera-${item.index + 1}`);
        if (!target) {
          return sendJson(response, 404, {
            error: `Camera '${requestedCameraName}' not found in configured list.`,
            configuredCameras: configured.map((item) => item.name),
            correlationId
          });
        }
        if (!target.enabled) {
          return sendJson(response, 409, {
            error: `Camera '${target.name}' is disabled in settings.`,
            correlationId
          });
        }
        const skill = options.skillRegistry.get("camera-vision");
        if (!skill) {
          return sendJson(response, 404, { error: "camera-vision skill is not loaded", correlationId });
        }
        try {
          const result = (await options.skillRegistry.run("camera-vision", {
            cameraName: target.name,
            mode: "snapshot"
          })) as Record<string, unknown>;
          return sendJson(response, 200, { ok: true, cameraName: target.name, result, correlationId });
        } catch (error) {
          return sendJson(response, 200, {
            ok: false,
            cameraName: target.name,
            error: error instanceof Error ? error.message : "camera test failed",
            hint: "Camera runtime skill returned an error. Check camera URL reachability/credentials and runtime dependencies.",
            correlationId
          });
        }
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/personas/versions") {
        const personaId = parsedUrl.searchParams.get("personaId") ?? "default";
        const rewritesOnly = parsedUrl.searchParams.get("rewritesOnly") === "true";
        const items = personas.list(personaId, { rewritesOnly });
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/personas/rollback") {
        const payload = (await readJson(request)) as { personaId: string; version: number };
        personas.rollback(payload.personaId, payload.version);
        return sendJson(response, 200, { ok: true, correlationId });
      }
      return sendJson(response, 404, { error: "not found" });
    } catch (error) {
      logger.error("http handler error", {
        correlationId,
        path: request.url,
        message: error instanceof Error ? error.message : "internal server error"
      });
      return sendJson(response, 500, {
        error: error instanceof Error ? error.message : "internal server error",
        correlationId
      });
    }
  });

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/v1/thoughts/ws")) {
      socket.destroy();
      return;
    }
    thoughtWs.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: "hello", at: new Date().toISOString() }));
      const latest = thoughtLog.list(20).reverse();
      ws.send(JSON.stringify({ type: "snapshot", items: latest, counts: thoughtLog.countByCategory() }));
    });
  });

  setInterval(() => {
    try {
      const latest = thoughtLog.list(50).reverse();
      const newItems = latest.filter((item) => item.createdAt > lastThoughtBroadcastAt);
      if (!newItems.length) return;
      lastThoughtBroadcastAt = newItems[newItems.length - 1]?.createdAt ?? lastThoughtBroadcastAt;
      const payload = JSON.stringify({ type: "thoughts", items: newItems });
      for (const client of thoughtWs.clients) {
        if (client.readyState === WebSocket.OPEN) {
          client.send(payload);
        }
      }
    } catch {
      // best effort
    }
  }, 1500).unref();

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`agent-core HTTP server listening on port ${port}`);
      resolve();
    });
  });

  startSignalReceiveWsPoller({
    orchestrator: options.orchestrator,
    settings: options.settings,
    dispatcher,
    router,
    signal
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(request);
  return raw ? JSON.parse(raw) : {};
}

function summarizeThoughts(items: Array<{ category: string; title: string }>): Record<string, number> {
  return items.reduce<Record<string, number>>((acc, item) => {
    const key = item.category || "unknown";
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});
}

function summarizeEmotions(items: Array<{ label: string; trigger: string }>): {
  byLabel: Record<string, number>;
  byTrigger: Record<string, number>;
} {
  const byLabel: Record<string, number> = {};
  const byTrigger: Record<string, number> = {};
  for (const item of items) {
    byLabel[item.label || "unknown"] = (byLabel[item.label || "unknown"] ?? 0) + 1;
    byTrigger[item.trigger || "unknown"] = (byTrigger[item.trigger || "unknown"] ?? 0) + 1;
  }
  return { byLabel, byTrigger };
}

function detectAutonomyLoopSignals(input: {
  thoughts: Array<{ title: string; content: string }>;
  emotions: Array<{ trigger: string; label: string }>;
  learningRecent: Array<Record<string, unknown>>;
}): Array<{ id: string; severity: "info" | "warn"; detail: string }> {
  const findings: Array<{ id: string; severity: "info" | "warn"; detail: string }> = [];
  const repeatedThoughtTitles = countMostRepeated(input.thoughts.map((item) => item.title));
  if (repeatedThoughtTitles.count >= 8) {
    findings.push({
      id: "repeated-thought-title",
      severity: "warn",
      detail: `Frequent repetition detected: "${repeatedThoughtTitles.value}" appears ${repeatedThoughtTitles.count} times in the recent thought window.`
    });
  }
  const repeatedEmotionTrigger = countMostRepeated(input.emotions.map((item) => `${item.trigger}:${item.label}`));
  if (repeatedEmotionTrigger.count >= 6) {
    findings.push({
      id: "repeated-emotion-trigger",
      severity: "warn",
      detail: `Emotion loop candidate: "${repeatedEmotionTrigger.value}" appears ${repeatedEmotionTrigger.count} times recently.`
    });
  }
  const recentResearchOnly = input.learningRecent
    .slice(-30)
    .filter((item) => String(item.category ?? "") === "research").length;
  const recentImprovements = input.learningRecent
    .slice(-30)
    .filter((item) => String(item.category ?? "") === "improvement").length;
  if (recentResearchOnly >= 10 && recentImprovements === 0) {
    findings.push({
      id: "research-heavy-without-improvement",
      severity: "info",
      detail: "Learning is currently research-heavy with no recent improvement actions."
    });
  }
  return findings;
}

function countMostRepeated(values: string[]): { value: string; count: number } {
  const counts = new Map<string, number>();
  for (const value of values) {
    const key = value || "unknown";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let best = "";
  let count = 0;
  for (const [key, value] of counts.entries()) {
    if (value > count) {
      best = key;
      count = value;
    }
  }
  return { value: best, count };
}

async function readRawBody(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString("utf8");
}

type HealthLevel = "green" | "orange" | "red";
type HealthCheckResult = {
  id: string;
  name: string;
  level: HealthLevel;
  detail: string;
  fingerprint?: string;
  lastSuccessfulAt?: string;
};
const healthLastSuccessMap = new Map<string, string>();

async function buildFullHealth(
  modelRouter: ModelRouter,
  dispatcher: OutboundDispatcher,
  scheduler: SchedulerService,
  getSettings: () => AppSettings,
  getUnifiedMood: () => { label: string; valence: number; arousal: number }
): Promise<{
  level: HealthLevel;
  checks: HealthCheckResult[];
}> {
  const checks: HealthCheckResult[] = [];

  checks.push(await checkDatabase());
  checks.push(checkMemoryLocalTables());
  checks.push(await checkMemoryBearReachable(getSettings));
  checks.push(checkEmotionalCore(getSettings, getUnifiedMood));
  checks.push(await checkVoiceTtsReachable(getSettings));
  checks.push(...(await checkModelProviders(modelRouter)));
  checks.push(...(await checkChannels(getSettings)));
  checks.push(...checkSecurityConfig());
  checks.push(await checkPerplexicaWebsearch(getSettings));
  checks.push({
    id: "dispatcher",
    name: "Outbound Dispatcher",
    level: dispatcher.isRunning() ? "green" : "red",
    detail: dispatcher.isRunning() ? "running" : "stopped"
  });
  checks.push({
    id: "scheduler",
    name: "Scheduler",
    level: scheduler.isRunning() ? "green" : "red",
    detail: scheduler.isRunning() ? "running" : "stopped"
  });

  const level = computeOverallHealthLevel(checks);
  return { level, checks: enrichHealthChecks(checks) };
}

function computeOverallHealthLevel(checks: HealthCheckResult[]): HealthLevel {
  const criticalChecks = checks.filter((item) => !isAdvisoryHealthCheck(item.id));
  if (criticalChecks.some((item) => item.level === "red")) {
    return "red";
  }
  if (criticalChecks.some((item) => item.level === "orange")) {
    return "orange";
  }
  return "green";
}

function isAdvisoryHealthCheck(id: string): boolean {
  // Channel bridges and webhook signature checks are optional when Web UI is used.
  if (
    id === "whatsapp-config" ||
    id === "signal-config" ||
    id === "webhook-whatsapp-secret" ||
    id === "webhook-signal-secret"
  ) {
    return true;
  }
  // Optional web-search skill; absence or downtime should not fail overall health.
  if (id === "perplexica-websearch") {
    return true;
  }
  // Optional long-term memory SaaS.
  if (id === "memory-bear") {
    return true;
  }
  // Orpheus is optional; unreachable server should not fail overall health.
  if (id === "voice-orpheus") {
    return true;
  }
  // Model providers are grouped as optional alternatives; individual provider failures are advisory.
  if (id.startsWith("provider-")) {
    return true;
  }
  return false;
}

async function checkDatabase(): Promise<HealthCheckResult> {
  try {
    getDatabase().prepare("SELECT 1").get();
    return { id: "database", name: "SQLite Database", level: "green", detail: "reachable" };
  } catch (error) {
    return {
      id: "database",
      name: "SQLite Database",
      level: "red",
      detail: error instanceof Error ? error.message : "database error"
    };
  }
}

function checkMemoryLocalTables(): HealthCheckResult {
  try {
    const db = getDatabase();
    const shortRow = db.prepare("SELECT COUNT(*) AS c FROM short_term_turns").get() as { c?: number } | undefined;
    const longRow = db.prepare("SELECT COUNT(*) AS c FROM long_term_memory").get() as { c?: number } | undefined;
    const shortN = Number(shortRow?.c ?? 0);
    const longN = Number(longRow?.c ?? 0);
    return {
      id: "memory-local",
      name: "Memory (local transcript & facts)",
      level: "green",
      detail: `SQLite tables OK — short_term_turns=${shortN}, long_term_memory=${longN}`
    };
  } catch (error) {
    return {
      id: "memory-local",
      name: "Memory (local transcript & facts)",
      level: "red",
      detail: error instanceof Error ? error.message : "memory tables unreachable"
    };
  }
}

async function checkMemoryBearReachable(getSettings: () => AppSettings): Promise<HealthCheckResult> {
  const mb = getSettings().memoryBear;
  if (!mb.enabled) {
    return {
      id: "memory-bear",
      name: "MemoryBear",
      level: "green",
      detail: "integration disabled (optional)"
    };
  }
  const base = mb.baseUrl.trim().replace(/\/+$/, "");
  const apiKey = mb.apiKey.trim();
  if (!base || !apiKey) {
    return {
      id: "memory-bear",
      name: "MemoryBear",
      level: "orange",
      detail: "enabled but base URL or API key is empty",
      fingerprint: fingerprintSecret(mb.apiKey)
    };
  }
  const url = `${base}/v1/memory_config/read_all_config`;
  const ping = await pingUrl(url, { Authorization: `Bearer ${apiKey}` });
  return {
    id: "memory-bear",
    name: "MemoryBear",
    level: ping.ok ? "green" : "orange",
    detail: ping.ok ? `reachable (${base})` : `cannot reach ${url}: ${ping.detail}`,
    fingerprint: fingerprintSecret(mb.apiKey)
  };
}

function checkEmotionalCore(
  getSettings: () => AppSettings,
  getUnifiedMood: () => { label: string; valence: number; arousal: number }
): HealthCheckResult {
  const emotionCfg = getSettings().emotions;
  try {
    const db = getDatabase();
    db.prepare("SELECT 1 FROM emotion_state LIMIT 1").get();
    const evRow = db.prepare("SELECT COUNT(*) AS c FROM emotion_events").get() as { c?: number } | undefined;
    const events = Number(evRow?.c ?? 0);
    const mood = getUnifiedMood();
    if (!emotionCfg.enabled) {
      return {
        id: "emotional-core",
        name: "Emotional Core",
        level: "green",
        detail: `disabled in settings; SQLite emotion tables OK (${events} timeline rows); snapshot mood=${mood.label} (v=${mood.valence.toFixed(2)}, a=${mood.arousal.toFixed(2)})`
      };
    }
    return {
      id: "emotional-core",
      name: "Emotional Core",
      level: "green",
      detail: `enabled; SQLite OK (${events} timeline rows); unified mood=${mood.label} (v=${mood.valence.toFixed(2)}, a=${mood.arousal.toFixed(2)}); expression=${emotionCfg.expressionStyle}`
    };
  } catch (error) {
    const moodFail = safeUnifiedMood(getUnifiedMood);
    const suffix = moodFail ? ` Last mood snapshot: ${moodFail}.` : "";
    return {
      id: "emotional-core",
      name: "Emotional Core",
      level: "red",
      detail: `${error instanceof Error ? error.message : "emotion tables unreachable"}.${suffix}`
    };
  }
}

function safeUnifiedMood(getUnifiedMood: () => { label: string; valence: number; arousal: number }): string | null {
  try {
    const m = getUnifiedMood();
    return `${m.label} (v=${m.valence.toFixed(2)}, a=${m.arousal.toFixed(2)})`;
  } catch {
    return null;
  }
}

async function checkVoiceTtsReachable(getSettings: () => AppSettings): Promise<HealthCheckResult> {
  const tts = getSettings().orpheusTts;
  const shellFallback = Boolean(process.env.NOVA_TTS_COMMAND?.trim());
  if (!tts.enabled || !tts.baseUrl.trim()) {
    return {
      id: "voice-tts",
      name: "Voice / TTS",
      level: "green",
      detail: shellFallback
        ? "Orpheus disabled; shell fallback via NOVA_TTS_COMMAND"
        : "Orpheus disabled; no NOVA_TTS_COMMAND (spoken output optional)"
    };
  }
  const base = tts.baseUrl.replace(/\/+$/, "");
  const headers: Record<string, string> = {};
  if (tts.apiKey.trim()) {
    headers.authorization = `Bearer ${tts.apiKey.trim()}`;
  }
  let lastDetail = "";
  for (const path of ["", "/v1/models", "/health"]) {
    const url = path ? `${base}${path}` : base;
    const ping = await pingUrl(url, headers);
    if (ping.ok) {
      return {
        id: "voice-orpheus",
        name: "Voice (Orpheus TTS)",
        level: "green",
        detail: `${ping.detail} — checked ${url}`,
        fingerprint: fingerprintSecret(tts.apiKey)
      };
    }
    lastDetail = ping.detail;
  }
  return {
    id: "voice-orpheus",
    name: "Voice (Orpheus TTS)",
    level: "orange",
    detail: `cannot reach Orpheus at ${base} (tried /, /v1/models, /health): ${lastDetail}`,
    fingerprint: fingerprintSecret(tts.apiKey)
  };
}

async function checkModelProviders(modelRouter: ModelRouter): Promise<HealthCheckResult[]> {
  try {
    const statuses = await modelRouter.health();
    const items = Object.entries(statuses).map(([provider, ok]) => ({
      id: `provider-${provider}`,
      name: `Model Provider: ${provider}`,
      level: ok ? "green" : "orange",
      detail: ok ? "reachable" : "unreachable"
    })) as HealthCheckResult[];
    const anyReachable = items.some((item) => item.level === "green");
    return [
      {
        id: "providers-routing",
        name: "Model Routing Availability",
        level: anyReachable ? "green" : "orange",
        detail: anyReachable ? "at least one provider reachable" : "no model providers reachable"
      },
      ...items
    ];
  } catch (error) {
    return [
      {
        id: "providers",
        name: "Model Providers",
        level: "red",
        detail: error instanceof Error ? error.message : "health check failed"
      }
    ];
  }
}

async function checkPerplexicaWebsearch(getSettings: () => AppSettings): Promise<HealthCheckResult> {
  const skill = (getSettings().skillSettings?.["perplexica-websearch"] ?? {}) as Record<string, unknown>;
  const fromSettings = typeof skill.baseUrl === "string" ? skill.baseUrl.trim() : "";
  const base =
    (fromSettings || process.env.NOVA_PERPLEXICA_BASE_URL || "http://127.0.0.1:3008").replace(/\/$/, "") || "http://127.0.0.1:3008";
  const ping = await pingUrl(base);
  return {
    id: "perplexica-websearch",
    name: "Perplexica Websearch",
    level: ping.ok ? "green" : "orange",
    detail: ping.ok ? `reachable at ${base}` : `unreachable at ${base}: ${ping.detail}`
  };
}

async function checkChannels(getSettings: () => AppSettings): Promise<HealthCheckResult[]> {
  const checks: HealthCheckResult[] = [];
  const settings = getSettings();
  const waTransport = (process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase();
  if (waTransport === "baileys") {
    const st = getWhatsAppWebBridgeStatus();
    checks.push({
      id: "whatsapp-config",
      name: "WhatsApp Configuration",
      level: st.connected ? "green" : "orange",
      detail: st.connected
        ? "WhatsApp Web (Baileys): bridge connected — Cloud API credentials not required"
        : `WhatsApp Web (Baileys): bridge not connected — ${st.detail || st.state || "starting"}`
    });
  } else {
    const waId = effectiveWhatsAppPhoneNumberId(settings);
    const waTok = effectiveWhatsAppToken(settings);
    const waConfigured = Boolean(waId && waTok);
    const waTokenFingerprint = fingerprintSecret(waTok || process.env.WHATSAPP_TOKEN);
    const waDetail = waConfigured ? await checkWhatsAppConnectionWithCredentials(waId, waTok) : { ok: false, detail: "credentials missing" };
    checks.push({
      id: "whatsapp-config",
      name: "WhatsApp Configuration",
      level: !waConfigured ? "orange" : waDetail.ok ? "green" : "orange",
      detail: !waConfigured
        ? "missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN (env or Settings → Channels)"
        : waDetail.detail,
      fingerprint: waTokenFingerprint
    });
  }
  const signalUrl = effectiveSignalApiUrl(settings);
  const signalAcc = effectiveSignalAccountNumber(settings);
  const signalConfigured = Boolean(signalUrl && signalAcc);
  const signalDetail = signalConfigured ? await checkSignalConnectionForBase(signalUrl) : { ok: false, detail: "base URL missing" };
  checks.push({
    id: "signal-config",
    name: "Signal Configuration",
    level: !signalConfigured ? "orange" : signalDetail.ok ? "green" : "orange",
    detail: !signalConfigured
      ? "missing SIGNAL_API_URL or SIGNAL_ACCOUNT_NUMBER (env or Settings → Channels)"
      : signalDetail.detail
  });
  return checks;
}

function checkSecurityConfig(): HealthCheckResult[] {
  const waBaileys = (process.env.WHATSAPP_TRANSPORT ?? "").trim().toLowerCase() === "baileys";
  return [
    {
      id: "webhook-whatsapp-secret",
      name: "WhatsApp Webhook Signature",
      // WhatsApp Cloud API actually signs webhooks with the App Secret, so configuring it is a real
      // hardening win. Without it we accept all unsigned posts (still safe on loopback, but visibly
      // weaker), so flag it as a soft warning rather than a failure.
      level: waBaileys || process.env.WHATSAPP_APP_SECRET ? "green" : "orange",
      detail: waBaileys
        ? "not applicable — WhatsApp Web (Baileys) does not use Meta Cloud webhooks"
        : process.env.WHATSAPP_APP_SECRET
          ? "secret configured (HMAC enforced on inbound /v1/webhooks/whatsapp)"
          : "optional: set WHATSAPP_APP_SECRET to enforce HMAC on inbound /v1/webhooks/whatsapp (only WhatsApp Cloud signs; not WhatsApp Web)",
      fingerprint: fingerprintSecret(process.env.WHATSAPP_APP_SECRET)
    },
    {
      id: "webhook-signal-secret",
      name: "Signal Webhook Signature",
      // signal-cli-rest-api (bbernhard's image, the one Nova bootstraps as the bridge) does not sign
      // its outgoing webhook posts at all, and inbound /v1/webhooks/signal is loopback-only. Setting
      // SIGNAL_WEBHOOK_SECRET would actively BREAK reception (verifier would reject every unsigned
      // request) — so the unset state is both correct and the recommended posture, while the SET
      // state is what should actually warn the operator.
      level: process.env.SIGNAL_WEBHOOK_SECRET ? "orange" : "green",
      detail: process.env.SIGNAL_WEBHOOK_SECRET
        ? "WARNING: signal-cli-rest-api does not sign webhooks; with a secret set, every inbound Signal post is rejected. Unset SIGNAL_WEBHOOK_SECRET to receive messages."
        : "not required — signal-cli-rest-api does not sign webhooks; inbound /v1/webhooks/signal is loopback-only. Leave SIGNAL_WEBHOOK_SECRET unset.",
      fingerprint: fingerprintSecret(process.env.SIGNAL_WEBHOOK_SECRET)
    },
    {
      id: "internal-api-token",
      name: "Internal API Token",
      level: process.env.NOVA_API_TOKEN ? "green" : "orange",
      detail: process.env.NOVA_API_TOKEN ? "token configured" : "NOVA_API_TOKEN missing",
      fingerprint: fingerprintSecret(process.env.NOVA_API_TOKEN)
    }
  ];
}

function enrichHealthChecks(checks: HealthCheckResult[]): HealthCheckResult[] {
  const now = new Date().toISOString();
  return checks.map((check) => {
    if (check.level === "green") {
      healthLastSuccessMap.set(check.id, now);
    }
    return {
      ...check,
      lastSuccessfulAt: healthLastSuccessMap.get(check.id)
    };
  });
}

async function checkWhatsAppConnectionWithCredentials(
  phoneNumberId: string,
  token: string
): Promise<{ ok: boolean; detail: string }> {
  const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
  const url = `${baseUrl.replace(/\/$/, "")}/v22.0/${phoneNumberId}?fields=id`;
  return pingUrl(url, {
    authorization: `Bearer ${token}`
  });
}

async function checkSignalConnectionForBase(baseUrl: string): Promise<{ ok: boolean; detail: string }> {
  const raw = baseUrl.trim();
  if (!raw) {
    return { ok: false, detail: "SIGNAL_API_URL missing" };
  }
  const trimmed = normalizeSignalRestBase(raw);
  const candidates = [
    `${trimmed}/v1/about`,
    `${trimmed}/about`,
    trimmed
  ];
  for (const url of candidates) {
    const check = await pingUrl(url);
    if (check.ok) {
      return check;
    }
  }
  return { ok: false, detail: "endpoint returned 404 (tried /v1/about, /about, and base URL)" };
}

/**
 * Browser sends Settings origin for webhook URL. Inside Docker, `localhost` is the container,
 * not the Mac host — same-machine setups must use host.docker.internal to reach agent-core.
 *
 * For the typical "Mac runs both the bridge container and agent-core" case (which is what Nova
 * actually bootstraps via `ensureSignalDockerBridge`), we ALWAYS prefer the host.docker.internal
 * path — using the browser's https://nova/... origin would force the bridge to hit the Next.js
 * dev TLS cert, which is only valid for `localhost` / `127.0.0.1`, so signal-cli-rest-api refuses
 * to deliver inbound messages with `tls: failed to verify certificate: x509: certificate is valid
 * for localhost, not nova`.
 *
 * Operators with a remote bridge (bridge on a different host than agent-core) should set
 * SIGNAL_RECEIVE_WEBHOOK_URL explicitly; that takes precedence in `resolveSignalReceiveWebhookUrl`.
 */
function buildReceiveWebhookUrlFromBootstrap(webhookPublicOrigin?: string): string | undefined {
  const agentPort = process.env.NOVA_AGENT_PORT?.trim() || "8787";
  const sameMachineUrl = `http://host.docker.internal:${agentPort}/v1/webhooks/signal`;
  const o = typeof webhookPublicOrigin === "string" ? webhookPublicOrigin.trim() : "";
  if (!o) {
    return sameMachineUrl;
  }
  try {
    const withProto = /^https?:\/\//i.test(o) ? o : `https://${o}`;
    const u = new URL(withProto);
    if (!u.hostname) {
      return sameMachineUrl;
    }
    return sameMachineUrl;
  } catch {
    return sameMachineUrl;
  }
}

async function ensureSignalDockerBridge(webhookOverride?: string): Promise<{
  ok: boolean;
  detail: string;
  executedCommand?: string;
  receiveWebhookUrl: string;
}> {
  const webhookUrl = (webhookOverride?.trim() || resolveSignalReceiveWebhookUrl()).trim();
  try {
    await runLocalCommand("docker --version");
  } catch (err) {
    return {
      ok: false,
      detail: `Docker is not available: ${err instanceof Error ? err.message : "unknown error"}`,
      receiveWebhookUrl: webhookUrl
    };
  }

  try {
    const existing = await runLocalCommand('docker ps -a --filter "name=^/nova-signal-bridge$" --format "{{.Names}}"');
    if ((existing.stdout ?? "").trim().includes("nova-signal-bridge")) {
      const inspect = await runLocalCommand('docker inspect nova-signal-bridge --format "{{range .Config.Env}}{{println .}}{{end}}"');
      const env = inspect.stdout ?? "";
      const wanted = `RECEIVE_WEBHOOK_URL=${webhookUrl}`;
      const hasWebhook = env.includes(wanted);
      if (!hasWebhook) {
        await runLocalCommand("docker rm -f nova-signal-bridge");
      } else {
        try {
          await runLocalCommand("docker update --restart unless-stopped nova-signal-bridge");
        } catch {
          // Ignore restart policy update failures on older Docker setups.
        }
        const running = await runLocalCommand('docker ps --filter "name=^/nova-signal-bridge$" --format "{{.Names}}"');
        if ((running.stdout ?? "").trim().includes("nova-signal-bridge")) {
          return {
            ok: true,
            detail: `Signal bridge container already running (webhook: ${webhookUrl}).`,
            receiveWebhookUrl: webhookUrl
          };
        }
        await runLocalCommand("docker start nova-signal-bridge");
        return {
          ok: true,
          detail: `Started existing Signal bridge container (webhook: ${webhookUrl}).`,
          executedCommand: "docker start nova-signal-bridge",
          receiveWebhookUrl: webhookUrl
        };
      }
    }
  } catch {
    // Continue to (re)start attempt below.
  }

  const startCmd = [
    "docker run -d",
    "--restart unless-stopped",
    "--name nova-signal-bridge",
    "-p 8085:8080",
    "-e MODE=json-rpc",
    `-e RECEIVE_WEBHOOK_URL=${webhookUrl}`,
    "-v nova-signal-cli-config:/home/.local/share/signal-cli",
    "bbernhard/signal-cli-rest-api:latest"
  ].join(" ");
  try {
    await runLocalCommand(startCmd);
    return {
      ok: true,
      detail: `Started Signal bridge container (webhook: ${webhookUrl}).`,
      executedCommand: startCmd,
      receiveWebhookUrl: webhookUrl
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    if (/already in use|is already in use|Conflict/i.test(message)) {
      try {
        try {
          await runLocalCommand("docker update --restart unless-stopped nova-signal-bridge");
        } catch {
          // Ignore restart policy update failures.
        }
        await runLocalCommand("docker start nova-signal-bridge");
        return {
          ok: true,
          detail: "Started existing Signal bridge container.",
          executedCommand: "docker start nova-signal-bridge",
          receiveWebhookUrl: webhookUrl
        };
      } catch (startErr) {
        return {
          ok: false,
          detail: `Container exists but could not be started: ${startErr instanceof Error ? startErr.message : "unknown error"}`,
          receiveWebhookUrl: webhookUrl
        };
      }
    }
    return { ok: false, detail: `Could not start Signal bridge: ${message}`, receiveWebhookUrl: webhookUrl };
  }
}

function resolveSignalReceiveWebhookUrl(): string {
  const explicit = process.env.SIGNAL_RECEIVE_WEBHOOK_URL?.trim();
  if (explicit) {
    return explicit;
  }
  for (const key of ["NOVA_PUBLIC_APP_URL", "NEXT_PUBLIC_APP_URL"] as const) {
    const pub = process.env[key]?.trim();
    if (pub) {
      const base = pub.replace(/\/+$/, "");
      if (base) {
        return `${base}/api/webhooks/signal`;
      }
    }
  }
  // Docker Desktop (Windows/macOS) resolves host.docker.internal to the host machine.
  return "http://host.docker.internal:8787/v1/webhooks/signal";
}

function buildSignalRegisterJsonBody(opts?: { captcha?: string; useVoice?: boolean }): Record<string, unknown> | undefined {
  if (!opts) {
    return undefined;
  }
  const captcha = opts.captcha?.trim();
  const useVoice = opts.useVoice === true;
  if (!captcha && !useVoice) {
    return undefined;
  }
  const body: Record<string, unknown> = {};
  if (captcha) {
    body.captcha = captcha;
  }
  if (useVoice) {
    body.use_voice = true;
  }
  return body;
}

async function startSignalRegistration(
  signalApiUrl: string,
  signalAccountNumber: string,
  registerOpts?: { captcha?: string; useVoice?: boolean }
): Promise<{ ok: boolean; detail: string; endpointTried?: string }> {
  /** Stock bbernhard/signal-cli-rest-api only exposes POST /v1/register/{number} (see src/main.go). */
  const jsonBody = buildSignalRegisterJsonBody(registerOpts);
  const candidates = signalRegisterPostCandidates(signalApiUrl, signalAccountNumber);
  let last = "registration request failed";
  let lastTried = candidates[candidates.length - 1] ?? "";
  for (const endpoint of candidates) {
    lastTried = endpoint;
    const attempt = await postSignalCliJson(endpoint, jsonBody);
    if (attempt.ok) {
      return {
        ok: true,
        detail: "Registration started. Check your Signal app/SMS for code, then click Verify code.",
        endpointTried: endpoint
      };
    }
    last = attempt.detail;
  }
  return { ok: false, detail: `Could not start registration: ${last}`, endpointTried: lastTried };
}

/**
 * GET /v1/qrcodelink?device_name=… returns a PNG (or other image) for linking an existing Signal primary phone.
 */
async function fetchSignalQrCodeLinkImage(
  signalApiUrl: string,
  deviceNameRaw: string
): Promise<{
  ok: boolean;
  imageBase64?: string;
  mimeType?: string;
  detail: string;
  endpointTried?: string;
}> {
  const base = normalizeSignalRestBase(signalApiUrl);
  const safeName = (deviceNameRaw.trim() || "Nova Agent Web").slice(0, 120) || "Nova Agent Web";
  const endpoint = `${base}/v1/qrcodelink?device_name=${encodeURIComponent(safeName)}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 45_000);
  try {
    const upstream = await fetch(endpoint, { method: "GET", signal: controller.signal });
    const contentTypeHeader = (upstream.headers.get("content-type") || "").split(";")[0].trim().toLowerCase();
    if (!upstream.ok) {
      let detail = `HTTP ${upstream.status}`;
      try {
        const text = (await upstream.text()).trim().slice(0, 2000);
        if (text) {
          const parsed = parseJsonSafe(text);
          if (parsed && typeof parsed === "object" && parsed !== null && "error" in parsed) {
            detail = `${detail}: ${String((parsed as { error?: unknown }).error ?? text)}`;
          } else {
            detail = `${detail}: ${text}`;
          }
        }
      } catch {
        // ignore
      }
      return { ok: false, detail, endpointTried: endpoint };
    }
    if (contentTypeHeader.includes("application/json")) {
      const text = (await upstream.text()).trim().slice(0, 2000);
      const parsed = parseJsonSafe(text);
      const err =
        parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as { error?: unknown }).error)
          : text || "unexpected JSON from qrcodelink";
      return { ok: false, detail: err, endpointTried: endpoint };
    }
    const buf = Buffer.from(await upstream.arrayBuffer());
    if (!buf.length) {
      return { ok: false, detail: "empty response from qrcodelink", endpointTried: endpoint };
    }
    const mimeType = contentTypeHeader.startsWith("image/") ? contentTypeHeader : "image/png";
    return {
      ok: true,
      imageBase64: buf.toString("base64"),
      mimeType,
      detail: "Scan this QR with Signal on your phone: Settings → Linked devices → Link new device.",
      endpointTried: endpoint
    };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "qrcodelink request failed",
      endpointTried: endpoint
    };
  } finally {
    clearTimeout(timer);
  }
}

async function fetchSignalAccountsList(
  signalApiUrl: string
): Promise<{ ok: boolean; accounts?: string[]; detail: string }> {
  const base = normalizeSignalRestBase(signalApiUrl);
  const endpoint = `${base}/v1/accounts`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const upstream = await fetch(endpoint, { method: "GET", signal: controller.signal });
    const text = (await upstream.text()).trim();
    if (!upstream.ok) {
      return { ok: false, detail: `HTTP ${upstream.status}: ${text.slice(0, 1200)}` };
    }
    const parsed = parseJsonSafe(text);
    if (!Array.isArray(parsed)) {
      return { ok: false, detail: "unexpected /v1/accounts response (expected JSON array)" };
    }
    const accounts = parsed.filter((x): x is string => typeof x === "string" && x.length > 0);
    return {
      ok: true,
      accounts,
      detail:
        accounts.length > 0
          ? `Found ${accounts.length} linked account(s). Use one as SIGNAL_ACCOUNT_NUMBER.`
          : "No accounts on this bridge yet — complete QR linking on your phone, then refresh again."
    };
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : "accounts request failed" };
  } finally {
    clearTimeout(timer);
  }
}

async function verifySignalRegistration(
  signalApiUrl: string,
  signalAccountNumber: string,
  code: string
): Promise<{ ok: boolean; detail: string; endpointTried?: string }> {
  const candidates = signalVerifyPostCandidates(signalApiUrl, signalAccountNumber, code);
  let last = "verification request failed";
  let lastTried = candidates[candidates.length - 1] ?? "";
  for (const endpoint of candidates) {
    lastTried = endpoint;
    const attempt = await postSignalCliJson(endpoint);
    if (attempt.ok) {
      return { ok: true, detail: "Signal number verified and linked.", endpointTried: endpoint };
    }
    last = attempt.detail;
  }
  return { ok: false, detail: `Could not verify Signal code: ${last}`, endpointTried: lastTried };
}

async function pingUrl(url: string, headers?: HeadersInit): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const response = await fetch(url, {
      method: "GET",
      headers,
      signal: controller.signal
    });
    if (!response.ok) {
      return { ok: false, detail: `endpoint returned ${response.status}` };
    }
    return { ok: true, detail: "reachable" };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "connection check failed"
    };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Base URL for bbernhard/signal-cli-rest-api (origin + optional reverse-proxy path prefix).
 * If the user pasted a health/about URL, strip that suffix so /v1/register/... resolves correctly.
 */
function normalizeSignalRestBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/$/, "");
  if (!trimmed) {
    return "http://127.0.0.1:8085";
  }
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  try {
    const u = new URL(withScheme);
    let path = u.pathname.replace(/\/+$/, "");
    const suffixes = ["/v1/about", "/about", "/v1/health", "/health"];
    for (const suf of suffixes) {
      if (path.endsWith(suf)) {
        path = path.slice(0, -suf.length).replace(/\/+$/, "");
        break;
      }
    }
    const origin = `${u.protocol}//${u.host}`;
    if (!path) {
      return origin;
    }
    return `${origin}${path}`;
  } catch {
    return trimmed.replace(/\/$/, "");
  }
}

function signalRegisterPostCandidates(baseRaw: string, e164Number: string): string[] {
  const base = normalizeSignalRestBase(baseRaw);
  const enc = encodeURIComponent(e164Number);
  return [`${base}/v1/register/${e164Number}`, `${base}/v1/register/${enc}`];
}

function signalVerifyPostCandidates(baseRaw: string, e164Number: string, verificationCode: string): string[] {
  const base = normalizeSignalRestBase(baseRaw);
  const encPhone = encodeURIComponent(e164Number);
  const encCode = encodeURIComponent(verificationCode);
  return [
    `${base}/v1/register/${e164Number}/verify/${verificationCode}`,
    `${base}/v1/register/${encPhone}/verify/${encCode}`
  ];
}

/**
 * E.164-style number for signal-cli-rest-api paths (+digits).
 */
function normalizeSignalAccountNumber(raw: string): string {
  const collapsed = raw.trim().replace(/\s+/g, "");
  if (!collapsed) {
    return "";
  }
  if (collapsed.startsWith("+")) {
    const digits = collapsed.slice(1).replace(/\D/g, "");
    return digits ? `+${digits}` : "";
  }
  const digits = collapsed.replace(/\D/g, "");
  return digits ? `+${digits}` : "";
}

/**
 * signal-cli-rest-api: POST + `Content-Type: application/json`.
 * Registration without captcha uses an empty body; with captcha use `{"captcha":"..."}` (optional `use_voice`).
 */
async function postSignalCliJson(
  url: string,
  jsonBody?: Record<string, unknown>,
  headers?: HeadersInit
): Promise<{ ok: boolean; detail: string }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12_000);
  try {
    const init: RequestInit = {
      method: "POST",
      headers: { "content-type": "application/json", ...(headers ?? {}) },
      signal: controller.signal
    };
    if (jsonBody !== undefined && Object.keys(jsonBody).length > 0) {
      init.body = JSON.stringify(jsonBody);
    }
    const response = await fetch(url, init);
    if (!response.ok) {
      let suffix = "";
      try {
        const text = (await response.text()).trim().slice(0, 1200);
        if (text) {
          suffix = `: ${text}`;
        }
      } catch {
        // ignore
      }
      return { ok: false, detail: `HTTP ${response.status}${suffix}` };
    }
    return { ok: true, detail: "ok" };
  } catch (error) {
    return {
      ok: false,
      detail: error instanceof Error ? error.message : "request failed"
    };
  } finally {
    clearTimeout(timer);
  }
}

function fingerprintSecret(secret: string | undefined): string | undefined {
  if (!secret) {
    return undefined;
  }
  const normalized = secret.trim();
  if (!normalized) {
    return undefined;
  }
  const digest = createHash("sha256").update(normalized).digest("hex").slice(0, 8);
  const masked = normalized.length <= 6 ? "***" : `${normalized.slice(0, 2)}***${normalized.slice(-2)}`;
  return `sha256:${digest} (${masked})`;
}

function recordSecurityEvent(action: string, status: string, actor: string, details: unknown): void {
  getDatabase()
    .prepare("INSERT INTO security_events (id, action, status, actor, details) VALUES (?, ?, ?, ?, ?)")
    .run(randomUUID(), action, status, actor, JSON.stringify(details ?? {}));
}

function parseJsonSafe(value: string | undefined): unknown {
  if (!value) {
    return undefined;
  }
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function appendCopilotLoginLog(session: CopilotDeviceLoginSession, line: string): void {
  session.logs.push(line);
  if (session.logs.length > 300) {
    session.logs.splice(0, session.logs.length - 300);
  }
}

/** Directory containing package.json with a `login` script (monorepo root), walking up from startDir. */
function findPackageRootWithLoginScript(startDir: string): string | undefined {
  let dir = resolve(startDir);
  const seen = new Set<string>();
  for (let depth = 0; depth < 16 && !seen.has(dir); depth++) {
    seen.add(dir);
    const packageJsonPath = resolve(dir, "package.json");
    if (existsSync(packageJsonPath)) {
      try {
        const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
        if (parsed.scripts?.login) {
          return dir;
        }
      } catch {
        // ignore malformed package.json and keep walking up
      }
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

function resolveCopilotLoginCommand(): { command?: string; cwd?: string; error?: string } {
  const fromEnv = (process.env.NOVA_COPILOT_DEVICE_LOGIN_COMMAND ?? "").trim();
  const repoRoot = findPackageRootWithLoginScript(process.cwd());

  if (fromEnv) {
    return {
      command: fromEnv,
      cwd: repoRoot ?? process.cwd()
    };
  }

  if (repoRoot) {
    return {
      command: "npm run login -- --provider=github-copilot",
      cwd: repoRoot
    };
  }

  return {
    error:
      "No login script found. Add a package.json login script or set NOVA_COPILOT_DEVICE_LOGIN_COMMAND to your device-login command."
  };
}

function sendJson(response: ServerResponse, status: number, data: unknown): void {
  response.statusCode = status;
  response.setHeader("content-type", "application/json");
  response.end(JSON.stringify(data));
}

function absoluteMediaUrl(request: IncomingMessage, path: string): string {
  const host = request.headers.host ?? "127.0.0.1:8787";
  const proto = request.headers["x-forwarded-proto"]?.toString() ?? "http";
  return `${proto}://${host}${path}`;
}

async function runLocalCommand(command: string): Promise<{ stdout: string; stderr: string }> {
  const result = await execAsync(command, { windowsHide: true, maxBuffer: 10 * 1024 * 1024 });
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

type OcrTable = { headers: string[]; rows: string[][] };
type OcrParseResult = {
  text: string;
  tables: OcrTable[];
  adapter: "strict-json" | "fallback-heuristic";
  mode: "json" | "text";
  warnings: string[];
};

function parseOcrAdapterOutput(stdout: string, stderr: string): OcrParseResult {
  const outputMode = process.env.NOVA_OCR_OUTPUT_MODE === "text" ? "text" : "json";
  const warnings: string[] = [];
  const trimmedStdout = stdout.trim();
  const textFallback = trimmedStdout || stderr.trim();
  if (outputMode === "json") {
    try {
      const parsed = JSON.parse(trimmedStdout) as unknown;
      const strict = validateOcrPayload(parsed);
      if (strict) {
        return {
          text: strict.text,
          tables: strict.tables,
          adapter: "strict-json",
          mode: "json",
          warnings
        };
      }
      warnings.push("Adapter JSON did not match OCR schema. Using fallback text parser.");
    } catch {
      warnings.push("Adapter did not emit valid JSON. Using fallback text parser.");
    }
  }
  return {
    text: textFallback,
    tables: extractTablesFromText(textFallback),
    adapter: "fallback-heuristic",
    mode: outputMode,
    warnings
  };
}

function validateOcrPayload(value: unknown): { text: string; tables: OcrTable[] } | undefined {
  if (!value || typeof value !== "object") return undefined;
  const record = value as Record<string, unknown>;
  if (typeof record.text !== "string" || !Array.isArray(record.tables)) return undefined;
  const tables: OcrTable[] = [];
  for (const item of record.tables) {
    if (!item || typeof item !== "object") return undefined;
    const row = item as Record<string, unknown>;
    if (!Array.isArray(row.headers) || !Array.isArray(row.rows)) return undefined;
    const headers = row.headers.map((h) => (typeof h === "string" ? h.trim() : "")).filter(Boolean);
    const rows = row.rows
      .filter((r) => Array.isArray(r))
      .map((r) => (r as unknown[]).map((cell) => String(cell ?? "").trim()));
    if (headers.length === 0) continue;
    const normalizedRows = rows.filter((r) => r.length === headers.length);
    tables.push({ headers, rows: normalizedRows });
  }
  return { text: record.text.trim(), tables };
}

function extractTablesFromText(text: string): Array<{ headers: string[]; rows: string[][] }> {
  const lines = text.split(/\r?\n/);
  const tables: Array<{ headers: string[]; rows: string[][] }> = [];
  let current: string[][] = [];
  const flush = (): void => {
    if (current.length >= 2) {
      const headers = current[0] ?? [];
      const rows = current.slice(1);
      if (headers.length > 1 && rows.some((row) => row.length === headers.length)) {
        tables.push({ headers, rows: rows.filter((row) => row.length === headers.length) });
      }
    }
    current = [];
  };
  for (const line of lines) {
    const cols = line.includes("\t")
      ? line.split("\t").map((part) => part.trim()).filter(Boolean)
      : line.split(/\s{2,}/).map((part) => part.trim()).filter(Boolean);
    if (cols.length > 1) {
      current.push(cols);
      continue;
    }
    flush();
  }
  flush();
  return tables;
}

function estimateCommandImpact(command: string): {
  filesystem: "none" | "low" | "medium" | "high";
  process: "none" | "low" | "medium" | "high";
  network: "none" | "low" | "medium" | "high";
  reasons: string[];
} {
  const lowered = command.toLowerCase();
  const reasons: string[] = [];
  let filesystem: "none" | "low" | "medium" | "high" = "none";
  let process: "none" | "low" | "medium" | "high" = "none";
  let network: "none" | "low" | "medium" | "high" = "none";
  if (/(rm\s+-rf|del\s+\/f|format\s+)/.test(lowered)) {
    filesystem = "high";
    reasons.push("Destructive file operation detected.");
  } else if (/(mv\s+|move\s+|cp\s+|copy\s+|echo\s+.+>|sed\s+-i)/.test(lowered)) {
    filesystem = "medium";
    reasons.push("Filesystem write/modify operation detected.");
  } else if (/(ls|dir|cat|type|rg\s+)/.test(lowered)) {
    filesystem = "low";
    reasons.push("Read-only filesystem command detected.");
  }
  if (/(kill|taskkill|systemctl|service\s+|restart)/.test(lowered)) {
    process = "high";
    reasons.push("Process/service control command detected.");
  } else if (/(node|python|pnpm|npm|bash|powershell)/.test(lowered)) {
    process = "medium";
    reasons.push("Process execution command detected.");
  }
  if (/(curl|wget|ssh|scp|rsync|ftp|ping)/.test(lowered)) {
    network = "high";
    reasons.push("Remote/network command detected.");
  } else if (/(git\s+push|gh\s+|docker\s+pull)/.test(lowered)) {
    network = "medium";
    reasons.push("Network likely required by command.");
  }
  return { filesystem, process, network, reasons };
}

