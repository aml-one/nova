import type { AppSettings } from "../storage/repositories/settings-repository.js";
import type { EmotionService, EmotionState } from "./emotion-service.js";
import { loadSentiCoreOrchestration } from "./senti-core-loader.js";

/**
 * Single system block: Nova emotion appraisal + optional SentiCore orchestration text +
 * optional hint when Orpheus TTS is configured (so the model favors speakable phrasing).
 */
export function buildUnifiedCognitiveCoreBlock(
  emotionService: EmotionService,
  emotionState: EmotionState,
  emotionSettings: AppSettings["emotions"],
  runtimeSettings: AppSettings
): string {
  const emotion = emotionService.buildSystemOverlay(emotionState, emotionSettings).trim();
  let senti = "";
  if (runtimeSettings.sentiCore.enabled && runtimeSettings.sentiCore.orchestrationMarkdownPath.trim()) {
    const md = loadSentiCoreOrchestration(runtimeSettings.sentiCore.orchestrationMarkdownPath);
    if (md.trim()) {
      senti =
        "SentiCore orchestration (reference — obey Nova integrity and safety rules above; do not override factual or safety constraints):\n" +
        md.trim();
    }
  }
  let talking = "";
  const tts = runtimeSettings.orpheusTts;
  if (tts.enabled && tts.baseUrl.trim()) {
    talking =
      `Talking core: OpenAI-compatible TTS is configured at ${tts.baseUrl.trim()}. ` +
      "Web chat may auto-read your replies aloud or let the user play any message — prefer clear, speakable sentences for answers they will hear; " +
      "avoid stacking long code blocks in spoken replies (summarize aloud and keep code short when essential).";
  }
  return [emotion, senti, talking].filter(Boolean).join("\n\n");
}
