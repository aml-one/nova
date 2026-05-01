import type { ChatMessage, ModelResponse } from "@nova/sdk/provider";

type OpenAICompatibleOptions = {
  provider: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /** e.g. GitHub Copilot requires Copilot-Integration-Id on api.githubcopilot.com */
  extraHeaders?: Record<string, string>;
};

type OpenAIResponse = {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
};

export async function chatViaOpenAICompatible(
  options: OpenAICompatibleOptions
): Promise<ModelResponse> {
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      ...(options.extraHeaders ?? {})
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 700
    })
  });

  if (!response.ok) {
    throw new Error(`${options.provider} request failed with status ${response.status}`);
  }

  const payload = (await response.json()) as OpenAIResponse;
  const content = payload.choices?.[0]?.message?.content?.trim();
  if (!content) {
    throw new Error(`${options.provider} returned empty content`);
  }
  return {
    provider: options.provider,
    content,
    model: options.model
  };
}

export async function streamViaOpenAICompatible(
  options: OpenAICompatibleOptions,
  onToken: (token: string) => void
): Promise<ModelResponse> {
  const startedAt = Date.now();
  const response = await fetch(options.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {}),
      ...(options.extraHeaders ?? {})
    },
    body: JSON.stringify({
      model: options.model,
      messages: options.messages,
      temperature: options.temperature ?? 0.2,
      max_tokens: options.maxTokens ?? 700,
      stream: true
    })
  });
  if (!response.ok || !response.body) {
    throw new Error(`${options.provider} stream failed with status ${response.status}`);
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
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      const token = extractOpenAiStreamToken(data);
      if (!token) continue;
      if (firstTokenMs === undefined) {
        firstTokenMs = Date.now() - startedAt;
      }
      full += token;
      onToken(token);
    }
  }
  if (!full.trim()) {
    throw new Error(`${options.provider} returned empty streamed content`);
  }
  return {
    provider: options.provider,
    content: full.trim(),
    model: options.model,
    firstTokenMs
  };
}

export function extractOpenAiStreamToken(dataLine: string): string | undefined {
  if (!dataLine || dataLine === "[DONE]") return undefined;
  try {
    const payload = JSON.parse(dataLine) as { choices?: Array<{ delta?: { content?: string } }> };
    const token = payload.choices?.[0]?.delta?.content;
    return token || undefined;
  } catch {
    return undefined;
  }
}
