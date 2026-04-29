import { randomUUID } from "node:crypto";
import { ModelRouter } from "../providers/router.js";
import { MemoryService } from "../memory/memory-service.js";
import { PersonaLoader } from "../persona/persona-loader.js";
import { PhoneIdentityResolver } from "../identity/phone-identity.js";
import { InMemorySkillRegistry } from "../skills/skill-registry.js";
import { SelfImprovementLoop } from "../improvement/self-improvement-loop.js";
import { CommandExecutor } from "../execution/command-executor.js";
import { evaluateCommandPolicy } from "../execution/policy.js";
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
  }): Promise<string> {
    this.inFlightCount += 1;
    this.lastActivityAt = Date.now();
    try {
    const startedAt = Date.now();
    const runtimeSettings = this.deps.settingsService.get();
    if (this.deps.modelRouter.getActiveProvider() !== runtimeSettings.activeProvider) {
      this.deps.modelRouter.setActiveProvider(runtimeSettings.activeProvider);
    }
    this.deps.visionRouter.setProviderPriority(runtimeSettings.visionProviderPriority);
    this.deps.mediaGeneration.setProviderPriority(runtimeSettings.mediaProviderPriority);
    const userId = this.deps.identityResolver.resolve({
      channel: input.channel,
      phoneNumber: input.phoneNumber
    });

    const profile = this.deps.userProfiles.get(userId);
    const persona = this.deps.personaLoader.getPersonaForUser(userId, input.channel, profile);
    const emotionState = this.deps.emotionService.updateFromUserInput(userId, input.text, runtimeSettings.emotions);
    const emotionOverlay = this.deps.emotionService.buildSystemOverlay(emotionState, runtimeSettings.emotions);
    const memoryContext = this.deps.memoryService.buildPromptContext(userId, input.text);
    const runId = randomUUID();
    const correlationId = input.correlationId ?? runId;

    if (input.text.startsWith("/run ")) {
      if (input.accessProfile && !input.accessProfile.capabilities.shellAccess) {
        return "You do not have permission to run shell commands.";
      }
      const command = input.text.replace("/run ", "").trim();
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
      const multi = await this.runMultiAgent(userPrompt, persona.systemPrompt);
      this.deps.memoryService.appendTurn(userId, input.text, multi);
      return multi;
    }

    const generation = await this.tryAutoMediaGeneration(input.text);
    if (generation) {
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

    const result = await this.deps.modelRouter.chat([
      { role: "system", content: persona.systemPrompt },
      ...(emotionOverlay ? [{ role: "system" as const, content: emotionOverlay }] : []),
      ...memoryContext,
      ...(await this.buildVisionContextIfNeeded(input.text, input.imageUrl, input.accessProfile)),
      { role: "user", content: input.text }
    ]);

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
      tokenInCount: estimateTokens([persona.systemPrompt, ...memoryContext.map((m) => m.content), input.text].join(" ")),
      tokenOutCount: estimateTokens(result.content),
      toolTimingsMs: {}
    });
    this.deps.improvement.recordOutcome({
      runId,
      userId,
      task: input.text,
      success: true
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
    toolTimingsMs?: Record<string, number>;
  }): void {
    this.runHistory.save(input);
  }

  private async runMultiAgent(prompt: string, systemPrompt: string): Promise<string> {
    const planner = await this.deps.modelRouter.chat([
      { role: "system", content: `${systemPrompt}\nYou are the planner agent.` },
      { role: "user", content: prompt }
    ]);
    const executor = await this.deps.modelRouter.chat([
      { role: "system", content: `${systemPrompt}\nYou are the executor agent.` },
      { role: "user", content: planner.content }
    ]);
    const reviewer = await this.deps.modelRouter.chat([
      { role: "system", content: `${systemPrompt}\nYou are the reviewer agent.` },
      { role: "user", content: executor.content }
    ]);
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
