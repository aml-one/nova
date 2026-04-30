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
  private readonly keepAlive = process.env.NOVA_OLLAMA_KEEP_ALIVE?.trim() || "30m";

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
        keep_alive: this.keepAlive,
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

  async streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<ModelResponse> {
    const startedAt = Date.now();
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify({
        model: request.model ?? this.model,
        messages: request.messages,
        stream: true,
        keep_alive: this.keepAlive,
        options: {
          temperature: request.temperature ?? 0.2,
          num_predict: request.maxTokens ?? 700
        }
      })
    });
    if (!response.ok || !response.body) {
      throw new Error(`ollama chat stream failed with status ${response.status}`);
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let full = "";
    let firstTokenMs: number | undefined;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const payload = JSON.parse(trimmed) as { message?: { content?: string }; done?: boolean };
          const token = payload.message?.content ?? "";
          if (!token) continue;
          if (firstTokenMs === undefined) {
            firstTokenMs = Date.now() - startedAt;
          }
          full += token;
          onToken(token);
        } catch {
          // ignore malformed line
        }
      }
    }
    if (!full.trim()) {
      throw new Error("ollama returned empty streamed content");
    }
    return {
      provider: this.name,
      content: full.trim(),
      model: request.model ?? this.model,
      firstTokenMs
    };
  }
}
