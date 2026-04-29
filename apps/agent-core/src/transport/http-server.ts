import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { TaskOrchestrator } from "../orchestrator/task-orchestrator.js";
import { WhatsAppChannelAdapter } from "../channels/whatsapp.js";
import { SignalChannelAdapter } from "../channels/signal.js";
import { ChannelRouter } from "../channels/channel-router.js";
import {
  verifyInternalAuthHeader,
  verifySignalSignature,
  verifyWhatsAppSignature
} from "../security/webhook-verifier.js";
import { OutboundDispatcher } from "../messaging/outbound-dispatcher.js";
import { Logger } from "../observability/logger.js";
import { VoiceService } from "../voice/voice-service.js";
import { getDatabase } from "../storage/sqlite.js";
import { RagService } from "../rag/rag-service.js";
import { BackupService } from "../backup/backup-service.js";
import { IdentityBackupService } from "../backup/identity-backup-service.js";
import { SchedulerService } from "../scheduler/scheduler-service.js";
import { PersonaVersionService } from "../persona/persona-version-service.js";
import { getUploadFile, saveUpload } from "../media/media-storage.js";
import { SettingsService } from "../settings/settings-service.js";
import { AuthService } from "../auth/auth-service.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { ModelRouter } from "../providers/router.js";
import { SelfImprovementLoop } from "../improvement/self-improvement-loop.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { resolveChannelAccess } from "../security/phone-access.js";
import { ApprovalService } from "../execution/approval-service.js";

type HttpServerOptions = {
  orchestrator: TaskOrchestrator;
  settings: SettingsService;
  auth: AuthService;
  modelRouter: ModelRouter;
  improvement: SelfImprovementLoop;
  skillRegistry: InMemorySkillRegistry;
  port?: number;
};

export async function startHttpServer(options: HttpServerOptions): Promise<void> {
  const port = options.port ?? Number(process.env.NOVA_AGENT_PORT ?? "8787");
  const wa = new WhatsAppChannelAdapter();
  const signal = new SignalChannelAdapter();
  const router = new ChannelRouter();
  const dispatcher = new OutboundDispatcher();
  const logger = new Logger();
  const voice = new VoiceService();
  const rag = new RagService();
  const backup = new BackupService();
  const identityBackup = new IdentityBackupService();
  const scheduler = new SchedulerService();
  const personas = new PersonaVersionService();
  const approvals = new ApprovalService();
  dispatcher.start();
  scheduler.start(async (payload) => {
    await options.orchestrator.handleChannelMessage({
      channel: "web",
      text: payload,
      correlationId: randomUUID()
    });
  });

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
        parsedUrl.pathname === "/v1/auth/state" ||
        parsedUrl.pathname === "/v1/auth/login" ||
        parsedUrl.pathname === "/v1/auth/setup";
      const sessionToken = request.headers["x-session-token"]?.toString();
      const sessionUser = options.auth.verifySession(sessionToken);
      const hasInternalAuth = verifyInternalAuthHeader(request.headers.authorization?.toString());
      const hasSessionAuth = Boolean(sessionUser);
      if (!hasInternalAuth && !hasSessionAuth && !isPublicPath && loginEnabled) {
        return sendJson(response, 401, { error: "unauthorized" });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/health") {
        return sendJson(response, 200, { ok: true, correlationId });
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
      if (request.method === "GET" && parsedUrl.pathname === "/v1/settings") {
        return sendJson(response, 200, { settings: options.settings.get(), correlationId });
      }
      if (request.method === "PUT" && parsedUrl.pathname === "/v1/settings") {
        const payload = (await readJson(request)) as Partial<AppSettings>;
        const updated = options.settings.updatePartial(payload);
        return sendJson(response, 200, { settings: updated, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/system/health/full") {
        const full = await buildFullHealth(options.modelRouter, dispatcher, scheduler);
        return sendJson(response, 200, { health: full, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/system/restart") {
        const payload = (await readJson(request)) as { service?: string };
        const service = payload.service ?? "";
        if (service === "dispatcher") {
          dispatcher.restart();
          return sendJson(response, 200, { ok: true, restarted: service, correlationId });
        }
        if (service === "scheduler") {
          scheduler.restart(async (taskPayload) => {
            await options.orchestrator.handleChannelMessage({
              channel: "web",
              text: taskPayload,
              correlationId: randomUUID()
            });
          });
          return sendJson(response, 200, { ok: true, restarted: service, correlationId });
        }
        if (service === "agent-core") {
          setTimeout(() => process.exit(0), 150);
          return sendJson(response, 200, { ok: true, restarted: service, correlationId });
        }
        return sendJson(response, 400, { error: "service must be dispatcher|scheduler|agent-core", correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/security/analyze") {
        const threshold = Number(parsedUrl.searchParams.get("thresholdPerIp") ?? "40");
        const result = await options.skillRegistry.run("network-defense", {
          mode: "detect",
          thresholdPerIp: Number.isFinite(threshold) ? Math.max(5, threshold) : 40
        });
        recordSecurityEvent("analyze", "completed", sessionUser?.email ?? "system", result);
        return sendJson(response, 200, { result, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/security/action") {
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
        const accessProfile = resolveChannelAccess(payload.phoneNumber, options.settings.get());
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
      if (request.method === "GET" && parsedUrl.pathname === "/v1/emotion/state") {
        const userId = parsedUrl.searchParams.get("userId") ?? "nova-system";
        const state = options.orchestrator.getEmotionState(userId);
        return sendJson(response, 200, { userId, state, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/emotion/history") {
        const userId = parsedUrl.searchParams.get("userId") ?? undefined;
        const items = options.orchestrator.getEmotionHistory(userId);
        const itemsByDate = items.reduce<Record<string, typeof items>>((acc, item) => {
          const key = item.createdAt.slice(0, 10);
          const existing = acc[key] ?? [];
          existing.push(item);
          acc[key] = existing;
          return acc;
        }, {});
        return sendJson(response, 200, { items, itemsByDate, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/history") {
        return sendJson(response, 200, { itemsByDate: options.improvement.getLearningHistoryGroupedByDate(), correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/improvement/cycle") {
        const result = await options.improvement.runIdleLearningCycle();
        return sendJson(response, 200, { ok: true, result, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/chat") {
        const payload = (await readJson(request)) as { message?: string; phoneNumber?: string; imageUrl?: string };
        const message = payload.message?.trim();
        if (!message) {
          return sendJson(response, 400, { error: "message is required" });
        }
        const reply = await options.orchestrator.handleChannelMessage({
          channel: "web",
          phoneNumber: payload.phoneNumber,
          text: message,
          correlationId,
          imageUrl: payload.imageUrl
        });
        return sendJson(response, 200, { reply, correlationId });
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
          return sendJson(response, 401, { error: "invalid whatsapp signature", correlationId });
        }
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const messages = router.normalizeBatch(await wa.ingestWebhook(payload));
        const replies: Array<{ to: string; reply: string; delivered: boolean; error?: string }> = [];
        for (const message of messages) {
          const accessProfile = resolveChannelAccess(message.phoneNumber, options.settings.get());
          if (!accessProfile.allowed) {
            continue;
          }
          const reply = await options.orchestrator.handleChannelMessage({
            channel: "whatsapp",
            phoneNumber: message.phoneNumber,
            text: message.text,
            correlationId,
            accessProfile
          });
          dispatcher.enqueue("whatsapp", message.from, reply, correlationId);
          replies.push({ to: message.from, reply, delivered: true });
        }
        return sendJson(response, 200, { handled: replies.length, replies, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/webhooks/signal") {
        const rawBody = await readRawBody(request);
        if (!verifySignalSignature(rawBody, request.headers["x-signal-signature"]?.toString())) {
          return sendJson(response, 401, { error: "invalid signal signature", correlationId });
        }
        const payload = rawBody ? JSON.parse(rawBody) : {};
        const messages = router.normalizeBatch(await signal.ingestSignalEvent(payload));
        const replies: Array<{ to: string; reply: string; delivered: boolean; error?: string }> = [];
        for (const message of messages) {
          const accessProfile = resolveChannelAccess(message.phoneNumber, options.settings.get());
          if (!accessProfile.allowed) {
            continue;
          }
          const reply = await options.orchestrator.handleChannelMessage({
            channel: "signal",
            phoneNumber: message.phoneNumber,
            text: message.text,
            correlationId,
            accessProfile
          });
          dispatcher.enqueue("signal", message.from, reply, correlationId);
          replies.push({ to: message.from, reply, delivered: true });
        }
        return sendJson(response, 200, { handled: replies.length, replies, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/history") {
        const db = getDatabase();
        const rows = db
          .prepare(
            `
            SELECT run_id, user_id, channel, input_text, output_text, success, correlation_id, latency_ms, provider, token_in_count, token_out_count, created_at
            FROM run_history
            ORDER BY created_at DESC
            LIMIT 100
            `
          )
          .all();
        return sendJson(response, 200, { items: rows, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/transcribe") {
        const payload = (await readJson(request)) as { audioPath: string };
        const text = await voice.transcribe(payload.audioPath);
        return sendJson(response, 200, { text, correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/voice/speak") {
        const payload = (await readJson(request)) as { text: string; outputPath?: string };
        const out = await voice.speak(payload.text, payload.outputPath);
        return sendJson(response, 200, { outputPath: out, correlationId });
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
        const result = await identityBackup.createAndPushIdentityBackup(payload.label);
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
      if (request.method === "POST" && parsedUrl.pathname === "/v1/approvals/approve") {
        const payload = (await readJson(request)) as { id: string };
        const db = getDatabase();
        db.prepare("UPDATE approvals SET status = 'approved' WHERE id = ?").run(payload.id);
        return sendJson(response, 200, { ok: true, correlationId });
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
      if (request.method === "GET" && parsedUrl.pathname === "/v1/personas/versions") {
        const personaId = parsedUrl.searchParams.get("personaId") ?? "default";
        const items = personas.list(personaId);
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

  await new Promise<void>((resolve) => {
    server.listen(port, () => {
      console.log(`agent-core HTTP server listening on port ${port}`);
      resolve();
    });
  });
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const raw = await readRawBody(request);
  return raw ? JSON.parse(raw) : {};
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
  scheduler: SchedulerService
): Promise<{
  level: HealthLevel;
  checks: HealthCheckResult[];
}> {
  const checks: HealthCheckResult[] = [];

  checks.push(await checkDatabase());
  checks.push(...(await checkModelProviders(modelRouter)));
  checks.push(...(await checkChannels()));
  checks.push(...checkSecurityConfig());
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

  const level = checks.some((item) => item.level === "red")
    ? "red"
    : checks.some((item) => item.level === "orange")
      ? "orange"
      : "green";
  return { level, checks: enrichHealthChecks(checks) };
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

async function checkModelProviders(modelRouter: ModelRouter): Promise<HealthCheckResult[]> {
  try {
    const statuses = await modelRouter.health();
    return Object.entries(statuses).map(([provider, ok]) => ({
      id: `provider-${provider}`,
      name: `Model Provider: ${provider}`,
      level: ok ? "green" : "orange",
      detail: ok ? "reachable" : "unreachable"
    }));
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

async function checkChannels(): Promise<HealthCheckResult[]> {
  const checks: HealthCheckResult[] = [];
  const waConfigured = Boolean(process.env.WHATSAPP_PHONE_NUMBER_ID && process.env.WHATSAPP_TOKEN);
  const waTokenFingerprint = fingerprintSecret(process.env.WHATSAPP_TOKEN);
  const waDetail = await checkWhatsAppConnection();
  checks.push({
    id: "whatsapp-config",
    name: "WhatsApp Configuration",
    level: !waConfigured ? "orange" : waDetail.ok ? "green" : "orange",
    detail: !waConfigured ? "missing WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN" : waDetail.detail,
    fingerprint: waTokenFingerprint
  });
  const signalConfigured = Boolean(process.env.SIGNAL_API_URL && process.env.SIGNAL_ACCOUNT_NUMBER);
  const signalDetail = await checkSignalConnection();
  checks.push({
    id: "signal-config",
    name: "Signal Configuration",
    level: !signalConfigured ? "orange" : signalDetail.ok ? "green" : "orange",
    detail: !signalConfigured ? "missing SIGNAL_API_URL or SIGNAL_ACCOUNT_NUMBER" : signalDetail.detail
  });
  return checks;
}

function checkSecurityConfig(): HealthCheckResult[] {
  return [
    {
      id: "webhook-whatsapp-secret",
      name: "WhatsApp Webhook Signature",
      level: process.env.WHATSAPP_APP_SECRET ? "green" : "orange",
      detail: process.env.WHATSAPP_APP_SECRET ? "secret configured" : "signature secret missing",
      fingerprint: fingerprintSecret(process.env.WHATSAPP_APP_SECRET)
    },
    {
      id: "webhook-signal-secret",
      name: "Signal Webhook Signature",
      level: process.env.SIGNAL_WEBHOOK_SECRET ? "green" : "orange",
      detail: process.env.SIGNAL_WEBHOOK_SECRET ? "secret configured" : "signature secret missing",
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

async function checkWhatsAppConnection(): Promise<{ ok: boolean; detail: string }> {
  const phoneNumberId = process.env.WHATSAPP_PHONE_NUMBER_ID;
  const token = process.env.WHATSAPP_TOKEN;
  if (!phoneNumberId || !token) {
    return { ok: false, detail: "credentials missing" };
  }
  const baseUrl = process.env.WHATSAPP_API_BASE_URL ?? "https://graph.facebook.com";
  const url = `${baseUrl.replace(/\/$/, "")}/v22.0/${phoneNumberId}?fields=id`;
  return pingUrl(url, {
    authorization: `Bearer ${token}`
  });
}

async function checkSignalConnection(): Promise<{ ok: boolean; detail: string }> {
  const baseUrl = process.env.SIGNAL_API_URL;
  if (!baseUrl) {
    return { ok: false, detail: "SIGNAL_API_URL missing" };
  }
  const url = `${baseUrl.replace(/\/$/, "")}/v1/about`;
  return pingUrl(url);
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
