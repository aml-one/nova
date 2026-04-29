import type { ChatMessage, ModelResponse } from "@nova/sdk/provider";

type OpenAICompatibleOptions = {
  provider: string;
  endpoint: string;
  model: string;
  apiKey?: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
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
      ...(options.apiKey ? { authorization: `Bearer ${options.apiKey}` } : {})
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
