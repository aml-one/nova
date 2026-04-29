import { TaskOrchestrator } from "./orchestrator/task-orchestrator.js";
import { InMemorySkillRegistry } from "./skills/skill-registry.js";
import { ModelRouter } from "./providers/router.js";
import { MemoryService } from "./memory/memory-service.js";
import { PersonaLoader } from "./persona/persona-loader.js";
import { PhoneIdentityResolver } from "./identity/phone-identity.js";
import { SelfImprovementLoop } from "./improvement/self-improvement-loop.js";
import { GitOpsManager } from "./git/gitops-manager.js";
import { CommandExecutor } from "./execution/command-executor.js";
import { JobSupervisor } from "./execution/job-supervisor.js";
import { ExecutionAuditLog } from "./execution/audit-log.js";
import { loadWorkspaceSkills } from "./skills/dynamic-skill-loader.js";
import { startHttpServer } from "./transport/http-server.js";
import { UserProfileStore } from "./identity/user-profile-store.js";
import { VisionRouter } from "./providers/vision-router.js";
import { MediaGenerationRouter } from "./media/media-generation-router.js";
import { SettingsService } from "./settings/settings-service.js";
import { AuthService } from "./auth/auth-service.js";
import { LearningDaemon } from "./improvement/learning-daemon.js";
import { EmotionService } from "./emotion/emotion-service.js";
import { IdentityBackupService } from "./backup/identity-backup-service.js";
import { IdentityBackupDaemon } from "./backup/identity-backup-daemon.js";

async function bootstrap(): Promise<void> {
  const settings = new SettingsService();
  const skillRegistry = new InMemorySkillRegistry(() => settings.get().skills);
  const router = new ModelRouter();
  const memory = new MemoryService();
  const personas = new PersonaLoader();
  const identities = new PhoneIdentityResolver();
  const userProfiles = new UserProfileStore();
  const gitOps = new GitOpsManager();
  const auth = new AuthService();
  const commandExecutor = new CommandExecutor(() => settings.get().delegatedFolders);
  const jobSupervisor = new JobSupervisor();
  const auditLog = new ExecutionAuditLog();
  const visionRouter = new VisionRouter();
  const mediaGeneration = new MediaGenerationRouter();
  const emotionService = new EmotionService();
  const identityBackupService = new IdentityBackupService();
  const improvement = new SelfImprovementLoop(gitOps, skillRegistry, emotionService);
  await loadWorkspaceSkills(skillRegistry);

  const orchestrator = new TaskOrchestrator({
    modelRouter: router,
    memoryService: memory,
    personaLoader: personas,
    identityResolver: identities,
    skillRegistry,
    improvement,
    commandExecutor,
    jobSupervisor,
    auditLog,
    userProfiles,
    visionRouter,
    mediaGeneration,
    settingsService: settings,
    emotionService
  });

  const learningDaemon = new LearningDaemon(improvement, orchestrator, {
    getLearningSettings: () => settings.get().learning
  });
  learningDaemon.start();
  const identityBackupDaemon = new IdentityBackupDaemon(identityBackupService, {
    getSettings: () => settings.get().identityBackup
  });
  identityBackupDaemon.start();
  await orchestrator.start();
  await startHttpServer({ orchestrator, settings, auth, modelRouter: router, improvement, skillRegistry });
}

bootstrap().catch((error) => {
  console.error("agent-core startup failed", error);
  process.exitCode = 1;
});
