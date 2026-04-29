type VisionRequest = {
  userPrompt: string;
  imageUrl?: string;
};

type VisionResult = {
  used: boolean;
  provider?: string;
  summary?: string;
};

type VisionProvider = {
  name: "lmstudio" | "ollama" | "cloud";
  analyze: (request: VisionRequest) => Promise<string>;
  isConfigured: () => boolean;
};

export class VisionRouter {
  private readonly providers: VisionProvider[];
  private providerPriorityOverride: Array<"lmstudio" | "ollama" | "cloud"> | undefined;

  constructor() {
    this.providers = [
      {
        name: "lmstudio",
        analyze: (request) =>
          analyzeViaOpenAICompatible({
            endpoint: `${process.env.LMSTUDIO_VISION_BASE_URL ?? "http://127.0.0.1:1234/v1"}/chat/completions`,
            model: process.env.LMSTUDIO_VISION_MODEL ?? "local-vision-model",
            userPrompt: request.userPrompt,
            imageUrl: request.imageUrl
          }),
        isConfigured: () => Boolean(process.env.LMSTUDIO_VISION_MODEL || process.env.LMSTUDIO_VISION_BASE_URL)
      },
      {
        name: "ollama",
        analyze: (request) =>
          analyzeViaOllama({
            baseUrl: process.env.OLLAMA_VISION_BASE_URL ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434",
            model: process.env.OLLAMA_VISION_MODEL ?? "llava",
            userPrompt: request.userPrompt,
            imageUrl: request.imageUrl
          }),
        isConfigured: () => Boolean(process.env.OLLAMA_VISION_MODEL || process.env.OLLAMA_VISION_BASE_URL)
      },
      {
        name: "cloud",
        analyze: (request) =>
          analyzeViaOpenAICompatible({
            endpoint: `${process.env.CLOUD_VISION_BASE_URL ?? ""}/chat/completions`,
            model: process.env.CLOUD_VISION_MODEL ?? "gpt-4o-mini",
            apiKey: process.env.CLOUD_VISION_API_KEY,
            userPrompt: request.userPrompt,
            imageUrl: request.imageUrl
          }),
        isConfigured: () =>
          Boolean(process.env.CLOUD_VISION_BASE_URL && process.env.CLOUD_VISION_MODEL && process.env.CLOUD_VISION_API_KEY)
      }
    ];
  }

  hasConfiguredProvider(): boolean {
    return this.providers.some((provider) => provider.isConfigured());
  }

  setProviderPriority(priority: Array<"lmstudio" | "ollama" | "cloud">): void {
    this.providerPriorityOverride = [...priority];
  }

  async analyze(request: VisionRequest): Promise<VisionResult> {
    const ordered = this.getOrderedProviders().filter((provider) => provider.isConfigured());
    for (const provider of ordered) {
      try {
        const summary = await provider.analyze(request);
        if (summary.trim()) {
          return { used: true, provider: provider.name, summary: summary.trim() };
        }
      } catch {
        // try next provider
      }
    }
    return { used: false };
  }

  private getOrderedProviders(): VisionProvider[] {
    const priorities =
      this.providerPriorityOverride ??
      ((process.env.NOVA_VISION_PROVIDER_PRIORITY ?? "lmstudio,ollama,cloud")
        .split(",")
        .map((item) => item.trim().toLowerCase())
        .filter((item): item is "lmstudio" | "ollama" | "cloud" => item === "lmstudio" || item === "ollama" || item === "cloud"));
    return [...this.providers].sort((a, b) => priorities.indexOf(a.name) - priorities.indexOf(b.name));
  }
}

async function analyzeViaOpenAICompatible(input: {
  endpoint: string;
  model: string;
  userPrompt: string;
  imageUrl?: string;
  apiKey?: string;
}): Promise<string> {
  if (!input.endpoint.startsWith("http")) {
    throw new Error("vision endpoint not configured");
  }
  const content: Array<{ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } }> = [
    { type: "text", text: input.userPrompt }
  ];
  if (input.imageUrl) {
    content.push({ type: "image_url", image_url: { url: input.imageUrl } });
  }
  const response = await fetch(input.endpoint, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(input.apiKey ? { authorization: `Bearer ${input.apiKey}` } : {})
    },
    body: JSON.stringify({
      model: input.model,
      messages: [{ role: "user", content }],
      temperature: 0.2
    })
  });
  if (!response.ok) {
    throw new Error(`vision provider failed (${response.status})`);
  }
  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  return payload.choices?.[0]?.message?.content ?? "";
}

async function analyzeViaOllama(input: {
  baseUrl: string;
  model: string;
  userPrompt: string;
  imageUrl?: string;
}): Promise<string> {
  const response = await fetch(`${input.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: input.model,
      stream: false,
      messages: [
        {
          role: "user",
          content: input.userPrompt,
          images: input.imageUrl ? [input.imageUrl] : []
        }
      ]
    })
  });
  if (!response.ok) {
    throw new Error(`ollama vision failed (${response.status})`);
  }
  const payload = (await response.json()) as { message?: { content?: string } };
  return payload.message?.content ?? "";
}
