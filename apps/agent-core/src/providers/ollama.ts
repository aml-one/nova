import type { ChatRequest, ModelProvider, ModelResponse, ProviderHealth } from "@nova/sdk/provider";

type OllamaChatResponse = {
  message?: {
    content?: string;
  };
};

export class OllamaProvider implements ModelProvider {
  readonly name = "ollama";
  private readonly baseUrl = process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434";
  private readonly model = process.env.OLLAMA_MODEL ?? "llama3.1";

  async health(): Promise<ProviderHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`);
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
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        stream: false,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 700
        }
      })
    });

    if (!response.ok) {
      throw new Error(`ollama chat failed with status ${response.status}`);
    }
    const payload = (await response.json()) as OllamaChatResponse;
    const content = payload.message?.content?.trim();
    if (!content) {
      throw new Error("ollama returned empty content");
    }
    return {
      provider: this.name,
      content,
      model: request.model ?? this.model
    };
  }
}
