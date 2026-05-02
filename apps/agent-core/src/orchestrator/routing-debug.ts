import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { ModelRouter } from "../providers/router.js";
import {
  isCopilotIntegrationDisabled,
  isLmStudioIntegrationDisabled,
  isOllamaIntegrationDisabled
} from "../providers/provider-integration.js";
import { buildVisionDebugSnapshot } from "../providers/vision-router.js";

/** Read-only: vision lanes + chat routing flags (no upstream model calls). */
export function buildRoutingDebugSnapshot(
  settings: AppSettings,
  modelRouter: Pick<ModelRouter, "getActiveProvider">
): Record<string, unknown> {
  return {
    explain: {
      runHistoryProvider:
        "Run history / chat stats show the provider that produced the assistant reply (chat completion). Image analysis uses Settings → Vision priority (see vision.* below) and is separate.",
      localFirstChat:
        "With an image attached (or certain host-time intents), chat uses local-first order: Ollama → LM Studio → Copilot. If Ollama/LM Studio error or are disabled, Copilot is used for the reply even when vision used Ollama."
    },
    vision: buildVisionDebugSnapshot(settings),
    chat: {
      settingsActiveProvider: settings.activeProvider,
      modelRouterActiveProvider: modelRouter.getActiveProvider(),
      defaultModelsByProvider: settings.models.defaultByProvider,
      localFirstTryOrder: ["ollama", "lmstudio", "copilot"],
      integrationSkipsProvider: {
        ollama: isOllamaIntegrationDisabled(),
        lmstudio: isLmStudioIntegrationDisabled(),
        copilot: isCopilotIntegrationDisabled()
      },
      settingsDisabledFlags: {
        ollama: settings.ollama.disabled === true,
        lmstudio: settings.lmstudio.disabled === true,
        copilot: settings.copilot.disabled === true
      }
    }
  };
}
