import { randomUUID } from "node:crypto";
import type { ChatMessage, ModelResponse } from "@nova/sdk/provider";
import { ModelRouter } from "../providers/router.js";
import { MemoryService } from "../memory/memory-service.js";
import { PersonaLoader } from "../persona/persona-loader.js";
import { PhoneIdentityResolver } from "../identity/phone-identity.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { SelfImprovementLoop } from "../improvement/self-improvement-loop.js";
import { CommandExecutor } from "../execution/command-executor.js";
import { evaluateCommandPolicy } from "../execution/policy.js";
import {
  detectHostDiagnosticsIntent,
  implicitHostDiagnosticsShellAllowed,
  runHostDiagnosticsCollection
} from "../execution/host-diagnostics.js";
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
import { MediaGenerationRouter } from "../media/media-generation-router.js";
import { SettingsService } from "../settings/settings-service.js";
import type { ChannelAccessProfile } from "../security/phone-access.js";
import { EmotionService } from "../emotion/emotion-service.js";
import { ThoughtRepository } from "../storage/repositories/thought-repository.js";
import { getDatabase } from "../storage/sqlite.js";
import type { AppSettings } from "../storage/repositories/settings-repository.js";

const MAX_HOST_DIAG_APPENDIX_CHARS = 12_000;

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
  private inFlightCount = 0;
  private lastActivityAt = Date.now();

  constructor(private readonly deps: TaskOrchestratorDeps) {}

  async start(): Promise<void> {
    console.log("task orchestrator started");
    console.log(`registered skills: ${this.deps.skillRegistry.count()}`);
  }

  async handleChannelMessage(input: {
    channel: "web" | "whatsapp" | "signal";
    phoneNumber?: string;
    text: string;
    correlationId?: string;
    imageUrl?: string;
    accessProfile?: ChannelAccessProfile;
    model?: string;
    onToken?: (token: string) => void;
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
      phoneNumber: input.phoneNumber
    });
    const runtimeSettings = applyRolloutCohortSettings(userId, this.deps.settingsService.get());
    if (this.deps.modelRouter.getActiveProvider() !== runtimeSettings.activeProvider) {
      this.deps.modelRouter.setActiveProvider(runtimeSettings.activeProvider);
    }
    this.deps.visionRouter.setProviderPriority(runtimeSettings.visionProviderPriority);
    this.deps.mediaGeneration.setProviderPriority(runtimeSettings.mediaProviderPriority);

    const profile = this.deps.userProfiles.get(userId);
    const persona = this.deps.personaLoader.getPersonaForUser(userId, input.channel, profile);
    const emotionState = this.deps.emotionService.updateFromUserInput(userId, input.text, runtimeSettings.emotions);
    const emotionOverlay = this.deps.emotionService.buildSystemOverlay(emotionState, runtimeSettings.emotions);
    const memoryContext = this.deps.memoryService.buildPromptContext(userId, input.text);
    const pendingQuestionsForUser = this.deps.improvement.consumePendingQuestions(userId, 2);
    const runId = randomUUID();
    const correlationId = input.correlationId ?? runId;
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
      this.deps.memoryService.appendTurn(userId, input.text, reply);
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
      const multi = await this.runMultiAgent(userPrompt, persona.systemPrompt);
      this.deps.memoryService.appendTurn(userId, input.text, multi);
      return multi;
    }

    if (detectSkillAuthoringIntent(input.text)) {
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

    if (isWebsiteCommand(input.text) || mentionsKnownWebsite(input.text)) {
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
      this.deps.memoryService.appendTurn(userId, input.text, generation);
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
    const userMessageForModel =
      truncatedDiag.length > 0
        ? `${input.text}\n\n---\nHost diagnostics (read-only, collected automatically by Nova):\n${truncatedDiag}`
        : input.text;
    const visionExtras = await this.buildVisionContextIfNeeded(input.text, input.imageUrl, input.accessProfile);
    const buildPromptMessages = (userContent: string): ChatMessage[] => [
      { role: "system", content: persona.systemPrompt },
      ...(emotionOverlay ? [{ role: "system" as const, content: emotionOverlay }] : []),
      ...(pendingQuestionsForUser.length > 0
        ? [{
            role: "system" as const,
            content: `You have follow-up questions for this user. Ask naturally near the end if still relevant:\n${pendingQuestionsForUser.map((item, index) => `${index + 1}. ${item}`).join("\n")}`
          }]
        : []),
      ...memoryContext,
      ...visionExtras,
      { role: "user", content: userContent }
    ];
    const promptMessages = buildPromptMessages(userMessageForModel);
    const promptMessagesSlim = buildPromptMessages(input.text);

    const runChat = async (messages: ChatMessage[], model: string | undefined): Promise<ModelResponse> =>
      input.onToken
        ? await this.deps.modelRouter.chatStream(messages, input.onToken, model)
        : await this.deps.modelRouter.chat(messages, model);

    const runLocalFirst = async (messages: ChatMessage[], model: string | undefined): Promise<ModelResponse> =>
      input.onToken
        ? await this.deps.modelRouter.chatStreamLocalFirst(messages, input.onToken, model)
        : await this.deps.modelRouter.chatLocalFirst(messages, model);

    let result: ModelResponse | undefined;
    try {
      try {
        result = await runChat(promptMessages, selectedModel);
      } catch (error) {
        if (truncatedDiag.length > 0 && isLikelyContextLimitError(error)) {
          result = await runChat(promptMessagesSlim, selectedModel);
        } else {
          const message = error instanceof Error ? error.message : "model request failed";
          if (shouldTryLocalModelAfterChatError(message)) {
            try {
              result = await runLocalFirst(promptMessages, undefined);
            } catch (localErr) {
              if (truncatedDiag.length > 0 && isLikelyContextLimitError(localErr)) {
                result = await runLocalFirst(promptMessagesSlim, undefined);
              } else {
                throw localErr;
              }
            }
          } else {
            throw error;
          }
        }
      }
    } catch {
      result = undefined;
    }

    if (!result) {
      const fallback =
        "I can still help without Copilot, but right now I cannot reach a working local model for this task. " +
        "Please configure Copilot in Settings -> Models -> Copilot quick setup, or enable Ollama/LM Studio and try again.";
      this.deps.memoryService.appendTurn(userId, input.text, fallback);
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
        toolTimingsMs: hostDiagnosticsMs > 0 ? { hostDiagnosticsMs } : {}
      });
      this.deps.improvement.recordOutcome({ runId, userId, task: input.text, success: false });
      this.thoughtLog.append({
        category: "chat",
        title: "Model providers unavailable",
        content: fallback.slice(0, 200)
      });
      return fallback;
    }

    this.deps.memoryService.appendTurn(userId, input.text, result.content);
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
      toolTimingsMs: hostDiagnosticsMs > 0 ? { hostDiagnosticsMs } : {}
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

  getEmotionState(userId: string): { valence: number; arousal: number; label: string } {
    return this.deps.emotionService.getState(userId);
  }

  getEmotionHistory(userId?: string): Array<{
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
    return this.deps.emotionService.getHistory(userId);
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
    return runtimeSettings.costGovernor.enabled &&
      budgetExceeded &&
      runtimeSettings.costGovernor.qualityTier === "economy"
      ? runtimeSettings.models.defaultByProvider.ollama || undefined
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
      onToken: input.onToken
    });
    this.deps.memoryService.appendTurn(userId, input.text, result.reply);
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

  private async runMultiAgent(prompt: string, systemPrompt: string): Promise<string> {
    const planner = await this.deps.modelRouter.chat([
      { role: "system", content: `${systemPrompt}\nYou are the planner agent.` },
      { role: "user", content: prompt }
    ], undefined);
    const executor = await this.deps.modelRouter.chat([
      { role: "system", content: `${systemPrompt}\nYou are the executor agent.` },
      { role: "user", content: planner.content }
    ], undefined);
    const reviewer = await this.deps.modelRouter.chat([
      { role: "system", content: `${systemPrompt}\nYou are the reviewer agent.` },
      { role: "user", content: executor.content }
    ], undefined);
    return reviewer.content;
  }

  private async buildVisionContextIfNeeded(
    userText: string,
    imageUrl?: string,
    accessProfile?: ChannelAccessProfile
  ): Promise<Array<{ role: "system"; content: string }>> {
    const needsVision = isVisionIntent(userText, imageUrl);
    if (!needsVision || !this.deps.visionRouter.hasConfiguredProvider()) {
      return [];
    }
    const skillVision = await this.tryCameraSkillVision(userText, accessProfile);
    const effectivePrompt = skillVision ? `${userText}\nCamera observations: ${skillVision}` : userText;
    const vision = await this.deps.visionRouter.analyze({
      userPrompt: effectivePrompt,
      imageUrl
    });
    if (!vision.used || !vision.summary) {
      return skillVision ? [{ role: "system", content: `Vision context (auto): ${skillVision}` }] : [];
    }
    return [
      {
        role: "system",
        content: `Vision context (auto): ${skillVision ? `${skillVision}\n` : ""}${vision.summary}`
      }
    ];
  }

  private async tryCameraSkillVision(userText: string, accessProfile?: ChannelAccessProfile): Promise<string | undefined> {
    if (!userText.toLowerCase().includes("camera")) {
      return undefined;
    }
    if (accessProfile && !accessProfile.capabilities.cameraAccess) {
      return "Camera access denied by policy.";
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
  if (imageUrl) {
    return true;
  }
  const lower = text.toLowerCase();
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
    costGovernor: {
      ...base.costGovernor,
      ...(candidateSettings.costGovernor ?? {}),
      providerPricing: {
        ...base.costGovernor.providerPricing,
        ...(candidateSettings.costGovernor?.providerPricing ?? {})
      }
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
