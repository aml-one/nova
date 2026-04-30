export type ChatMessage = {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
};

export type ChatRequest = {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  maxTokens?: number;
};

export type ModelResponse = {
  content: string;
  provider: string;
  model?: string;
  firstTokenMs?: number;
};

export type ProviderHealth = {
  name: string;
  ok: boolean;
  details?: string;
};

export interface ModelProvider {
  readonly name: string;
  health(): Promise<ProviderHealth>;
  chat(request: ChatRequest): Promise<ModelResponse>;
  streamChat(request: ChatRequest, onToken: (token: string) => void): Promise<ModelResponse>;
}
