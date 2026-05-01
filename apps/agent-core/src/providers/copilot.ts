import type { ChatRequest, ModelProvider, ModelResponse, ProviderHealth } from "@nova/sdk/provider";
import { resolveCopilotDefaultModelId, resolveCopilotRuntime } from "./copilot-credentials.js";
import { chatViaOpenAICompatible, streamViaOpenAICompatible } from "./openai-compatible.js";

export class CopilotProvider implements ModelProvider {
  readonly name = "copilot";

  async health(): Promise<ProviderHealth> {
    const { baseUrl, apiKey } = await resolveCopilotRuntime();
    if (!baseUrl || !apiKey) {
      return {
        name: this.name,
        ok: false,
        details:
          "Configure COPILOT_BASE_URL + COPILOT_API_KEY, save Copilot URL/key in Settings, or complete GitHub device login (~/.nova/copilot-auth.json)."
      };
    }
    try {
      const response = await fetch(`${baseUrl.replace(/\/$/, "")}/models`, {
        headers: {
          authorization: `Bearer ${apiKey}`
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
    const { baseUrl, apiKey } = await resolveCopilotRuntime();
    if (!baseUrl || !apiKey) {
      throw new Error("copilot provider is not configured");
    }
    const model = request.model ?? resolveCopilotDefaultModelId();
    return chatViaOpenAICompatible({
      provider: this.name,
      endpoint: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
      model,
      apiKey,
      messages: request.messages,
      temperature: request.temperature,
      maxTokens: request.maxTokens
    });
  }

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<ModelResponse> {
    const { baseUrl, apiKey } = await resolveCopilotRuntime();
    if (!baseUrl || !apiKey) {
      throw new Error("copilot provider is not configured");
    }
    const model = request.model ?? resolveCopilotDefaultModelId();
    return streamViaOpenAICompatible(
      {
        provider: this.name,
        endpoint: `${baseUrl.replace(/\/$/, "")}/chat/completions`,
        model,
        apiKey,
        messages: request.messages,
        temperature: request.temperature,
        maxTokens: request.maxTokens
      },
      onToken
    );
  }
}
