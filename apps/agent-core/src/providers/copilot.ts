import type { ChatRequest, ModelProvider, ModelResponse, ProviderHealth } from "@nova/sdk/provider";
import { chatViaOpenAICompatible, streamViaOpenAICompatible } from "./openai-compatible.js";

export class CopilotProvider implements ModelProvider {
  readonly name = "copilot";
  private readonly baseUrl = process.env.COPILOT_BASE_URL ?? "";
  private readonly model = process.env.COPILOT_MODEL ?? "gpt-4o-mini";
  private readonly apiKey = process.env.COPILOT_API_KEY;

  async health(): Promise<ProviderHealth> {
    if (!this.baseUrl || !this.apiKey) {
      return {
        name: this.name,
        ok: false,
        details: "set COPILOT_BASE_URL and COPILOT_API_KEY for provider access"
      };
    }
    try {
      const response = await fetch(`${this.baseUrl}/models`, {
        headers: {
          authorization: `Bearer ${this.apiKey}`
        }
      });
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
    if (!this.baseUrl || !this.apiKey) {
      throw new Error("copilot provider is not configured");
    }
    return chatViaOpenAICompatible({
      provider: this.name,
      endpoint: `${this.baseUrl}/chat/completions`,
      model: request.model ?? this.model,
      apiKey: this.apiKey,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens
    });
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<ModelResponse> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error("copilot provider is not configured");
    }
    return streamViaOpenAICompatible(
      {
        provider: this.name,
        endpoint: `${this.baseUrl}/chat/completions`,
        model: request.model ?? this.model,
        apiKey: this.apiKey,
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      },
      onToken
    );
  }
}
