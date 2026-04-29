import type { ChatRequest, ModelProvider, ModelResponse, ProviderHealth } from "@nova/sdk/provider";
import { chatViaOpenAICompatible } from "./openai-compatible.js";

export class LMStudioProvider implements ModelProvider {
  readonly name = "lmstudio";
  private readonly baseUrl = process.env.LMSTUDIO_BASE_URL ?? "http://127.0.0.1:1234/v1";
  private readonly model = process.env.LMSTUDIO_MODEL ?? "local-model";

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/models`);
      return {
        name: this.name,
        ok: response.ok,
        details: response.ok ? "reachable" : `status ${response.status}`
      };
    } catch (error) {
      return {
        name: this.name,
        ok: false,
        details: error instanceof Error ? error.message : "health check failed"
      };
    }
  }

  async chat(request: ChatRequest): Promise<ModelResponse> {
    return chatViaOpenAICompatible({
      provider: this.name,
      endpoint: `${this.baseUrl}/chat/completions`,
      model: request.model ?? this.model,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens
    });
  }
}
