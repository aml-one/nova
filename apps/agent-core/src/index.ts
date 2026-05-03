import "./env-dotenv.js";
import { TaskOrchestrator } from "./orchestrator/task-orchestrator.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
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
import { registerCopilotSettingsSource } from "./providers/copilot-credentials.js";
import { registerOllamaSettingsSource } from "./providers/ollama.js";
import { SettingsService } from "./settings/settings-service.js";
import { AuthService } from "./auth/auth-service.js";
import { LearningDaemon } from "./improvement/learning-daemon.js";
import { EmotionService } from "./emotion/emotion-service.js";
import { IdentityBackupService } from "./backup/identity-backup-service.js";
import { IdentityBackupDaemon } from "./backup/identity-backup-daemon.js";
import { UpdateManager } from "./update/update-manager.js";
import { InstallStateService } from "./update/install-state.js";

async function bootstrap(): Promise<void> {
  runMobileSetupDiagnostics();
  const settings = new SettingsService();
  registerCopilotSettingsSource(() => settings.get());
  registerOllamaSettingsSource(() => settings.get());
  const skillRegistry = new InMemorySkillRegistry(
    () => settings.get().skills,
    () => settings.get().skillSettings
  );
  const router = new ModelRouter();
  const memory = new MemoryService(() => settings.get());
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
  const installState = new InstallStateService();
  installState.ensureInitialized();
  const currentVersion = process.env.NOVA_APP_VERSION ?? "0.1.0";
  const improvement = new SelfImprovementLoop(gitOps, skillRegistry, emotionService, router, () => settings.get());
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
  const updateManager = new UpdateManager(
    () => settings.get().updates,
    () => installState.getInstalledAt(),
    (isoTime) => installState.setInstalledAt(isoTime),
    () => setTimeout(() => process.exit(0), 200)
  );
  updateManager.start();
  await orchestrator.start();
  await startHttpServer({
    orchestrator,
    settings,
    auth,
    modelRouter: router,
    improvement,
    skillRegistry,
    updateManager,
    learningDaemon,
    appVersion: currentVersion,
    installedAt: installState.getInstalledAt()
  });
}

function runMobileSetupDiagnostics(): void {
  const credentialPath = process.env.NOVA_FIREBASE_ADMIN_CREDENTIALS_PATH?.trim();
  if (!credentialPath) {
    console.warn(
      "[mobile-setup] NOVA_FIREBASE_ADMIN_CREDENTIALS_PATH is not set. Push delivery is disabled until this is configured."
    );
  } else {
    const resolved = resolve(process.cwd(), credentialPath);
    if (!existsSync(resolved)) {
      console.warn(`[mobile-setup] Firebase Admin credentials file not found: ${resolved}`);
    }
  }

  const androidConfig = resolve(process.cwd(), "../mobile_flutter/android/app/google-services.json");
  const iosConfig = resolve(process.cwd(), "../mobile_flutter/ios/Runner/GoogleService-Info.plist");
  if (!existsSync(androidConfig)) {
    console.warn(
      `[mobile-setup] Missing Android Firebase config: ${androidConfig}. Copy it from api_keys/google-services.json`
    );
  }
  if (!existsSync(iosConfig)) {
    console.warn(
      `[mobile-setup] Missing iOS Firebase config: ${iosConfig}. Copy it from api_keys/GoogleService-Info.plist`
    );
  }
}

bootstrap().catch((error) => {
  console.error("agent-core startup failed", error);
  process.exitCode = 1;
});
