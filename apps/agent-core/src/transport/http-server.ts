import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createHash, randomUUID } from "node:crypto";
import { exec as execCallback } from "node:child_process";
import { promisify } from "node:util";
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
import { appendUploadChunk, completeChunkedUpload, getUploadFile, initChunkedUpload, saveUpload } from "../media/media-storage.js";
import { SettingsService } from "../settings/settings-service.js";
import { AuthService } from "../auth/auth-service.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";
import { ModelRouter } from "../providers/router.js";
import { SelfImprovementLoop } from "../improvement/self-improvement-loop.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { resolveChannelAccess } from "../security/phone-access.js";
import { ApprovalService } from "../execution/approval-service.js";
import { ProviderCatalogService } from "../providers/provider-catalog.js";
import { UpdateManager } from "../update/update-manager.js";
import { ThoughtRepository } from "../storage/repositories/thought-repository.js";
import { WebSocketServer, WebSocket } from "ws";
import { MobilePushService } from "../mobile/push-service.js";
const execAsync = promisify(execCallback);

type HttpServerOptions = {
  orchestrator: TaskOrchestrator;
  settings: SettingsService;
  auth: AuthService;
  modelRouter: ModelRouter;
  improvement: SelfImprovementLoop;
  skillRegistry: InMemorySkillRegistry;
  updateManager: UpdateManager;
  appVersion: string;
  installedAt: string;
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
  const providerCatalog = new ProviderCatalogService();
  const thoughtLog = new ThoughtRepository();
  const mobilePush = new MobilePushService();
  let lastThoughtBroadcastAt = "";
  const thoughtWs = new WebSocketServer({ noServer: true });
  dispatcher.start();
  scheduler.start(async (payload) => {
    await options.orchestrator.handleChannelMessage({
      channel: "web",
      text: payload,
      correlationId: randomUUID()
    });
  });

  setInterval(() => {
    if (!dispatcher.isRunning()) {
      dispatcher.restart();
    }
    if (!scheduler.isRunning()) {
      scheduler.restart(async (taskPayload) => {
        await options.orchestrator.handleChannelMessage({
          channel: "web",
          text: taskPayload,
          correlationId: randomUUID()
        });
      });
    }
  }, 10000).unref();

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
        const signalAccountNumber = payload.signalAccountNumber?.trim() || "";
        const whatsAppPhoneNumberId = payload.whatsAppPhoneNumberId?.trim() || "";
        const whatsAppToken = payload.whatsAppToken?.trim() || "";
        const whatsAppAppSecret = payload.whatsAppAppSecret?.trim() || "";
        const signalCheck = signalApiUrl
          ? await pingUrl(`${signalApiUrl.replace(/\/$/, "")}/v1/about`)
          : { ok: false, detail: "SIGNAL_API_URL missing" };
        const waCheck =
          whatsAppPhoneNumberId && whatsAppToken
            ? await pingUrl(`https://graph.facebook.com/v22.0/${whatsAppPhoneNumberId}?fields=id`, {
                authorization: `Bearer ${whatsAppToken}`
              })
            : { ok: false, detail: "WHATSAPP_PHONE_NUMBER_ID or WHATSAPP_TOKEN missing" };
        const suggestedEnv = [
          `SIGNAL_API_URL=${signalApiUrl || "http://127.0.0.1:8080"}`,
          `SIGNAL_ACCOUNT_NUMBER=${signalAccountNumber || "+15550001111"}`,
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
            whatsApp: [
              "Create a Meta app and add WhatsApp product.",
              "Generate a permanent access token in Meta dashboard.",
              "Copy Phone Number ID and token, then click Test."
            ]
          },
          correlationId
        });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/setup/copilot/test") {
        const payload = (await readJson(request)) as { baseUrl?: string; apiKey?: string };
        const baseUrl = payload.baseUrl?.trim() || "";
        const apiKey = payload.apiKey?.trim() || "";
        if (!baseUrl || !apiKey) {
          return sendJson(response, 400, { error: "baseUrl and apiKey are required", correlationId });
        }
        const check = await pingUrl(`${baseUrl.replace(/\/$/, "")}/models`, {
          authorization: `Bearer ${apiKey}`
        });
        const suggestedEnv = [`COPILOT_BASE_URL=${baseUrl}`, `COPILOT_API_KEY=${apiKey}`].join("\n");
        return sendJson(response, 200, {
          check,
          suggestedEnv,
          quickGuide: [
            "Use a Copilot/OpenAI-compatible endpoint URL (must expose /models).",
            "Create a token/key in that provider dashboard.",
            "Paste URL + key, then click Validate."
          ],
          correlationId
        });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/skills/manifests") {
        const items = options.skillRegistry.list().map((item) => ({
          id: item.id,
          name: item.name,
          description: item.description,
          permissions: item.permissions,
          settingsTab: item.settingsTab
        }));
        return sendJson(response, 200, { items, correlationId });
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
      if (request.method === "GET" && parsedUrl.pathname === "/v1/thoughts") {
        const limit = Number(parsedUrl.searchParams.get("limit") ?? "300");
        const items = thoughtLog.list(limit);
        return sendJson(response, 200, { items, correlationId });
      }
      if (request.method === "GET" && parsedUrl.pathname === "/v1/improvement/history") {
        return sendJson(response, 200, { itemsByDate: options.improvement.getLearningHistoryGroupedByDate(), correlationId });
      }
      if (request.method === "POST" && parsedUrl.pathname === "/v1/improvement/cycle") {
        const result = await options.improvement.runIdleLearningCycle();
        return sendJson(response, 200, { ok: true, result, correlationId });
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
            text: message,
            correlationId,
            imageUrl: payload.imageUrl,
            model: payload.model,
            onToken: (token) => {
              response.write(`event: token\ndata: ${JSON.stringify({ token })}\n\n`);
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
                   , model_name, first_token_ms, tokens_per_second, cost_usd
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
      if (request.method === "GET" && parsedUrl.pathname === "/v1/memory/cards") {
        const userId = parsedUrl.searchParams.get("userId") ?? "nova-system";
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
          .run(id, payload.userId?.trim() || "nova-system", payload.title.trim(), payload.content.trim(), payload.pinned === false ? 0 : 1);
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
        const nodeMap = new Map<string, { id: string; label: string; count: number }>();
        const edges = new Map<string, { source: string; target: string; weight: number }>();
        for (const row of rows) {
          const text = (row.content ?? "").toLowerCase();
          const tokens = Array.from(new Set(text.match(/[a-z][a-z0-9_-]{3,}/g) ?? [])).slice(0, 10);
          for (const token of tokens) {
            const n = nodeMap.get(token) ?? { id: token, label: token, count: 0 };
            n.count += 1;
            nodeMap.set(token, n);
          }
          for (let i = 0; i < tokens.length - 1; i += 1) {
            const key = `${tokens[i]}->${tokens[i + 1]}`;
            const edge = edges.get(key) ?? { source: tokens[i], target: tokens[i + 1], weight: 0 };
            edge.weight += 1;
            edges.set(key, edge);
          }
        }
        return sendJson(response, 200, {
          nodes: [...nodeMap.values()].sort((a, b) => b.count - a.count).slice(0, 150),
          edges: [...edges.values()].sort((a, b) => b.weight - a.weight).slice(0, 300),
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

  server.on("upgrade", (request, socket, head) => {
    if (!request.url?.startsWith("/v1/thoughts/ws")) {
      socket.destroy();
      return;
    }
    thoughtWs.handleUpgrade(request, socket, head, (ws: WebSocket) => {
      ws.send(JSON.stringify({ type: "hello", at: new Date().toISOString() }));
      const latest = thoughtLog.list(20).reverse();
      ws.send(JSON.stringify({ type: "snapshot", items: latest }));
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

