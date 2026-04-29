import { randomUUID } from "node:crypto";

export type GeneratedMedia = {
  kind: "image" | "video";
  url: string;
  provider: string;
};

export class MediaGenerationRouter {
  private providerPriorityOverride: Array<"comfyui" | "cloud"> | undefined;

  setProviderPriority(priority: Array<"comfyui" | "cloud">): void {
    this.providerPriorityOverride = [...priority];
  }

  async generateFromPrompt(prompt: string, kind: "image" | "video"): Promise<GeneratedMedia | undefined> {
    const providers = this.getProviderOrder();
    for (const provider of providers) {
      try {
        if (provider === "comfyui") {
          const media = await this.generateViaComfyUI(prompt, kind);
          if (media) return media;
        }
        if (provider === "cloud") {
          const media = await this.generateViaCloud(prompt, kind);
          if (media) return media;
        }
      } catch {
        // fallback to next provider
      }
    }
    return undefined;
  }

  private getProviderOrder(): Array<"comfyui" | "cloud"> {
    if (this.providerPriorityOverride) {
      return [...this.providerPriorityOverride];
    }
    const raw = process.env.NOVA_MEDIA_PROVIDER_PRIORITY ?? "comfyui,cloud";
    return raw
      .split(",")
      .map((item) => item.trim().toLowerCase())
      .filter((item): item is "comfyui" | "cloud" => item === "comfyui" || item === "cloud");
  }

  private async generateViaComfyUI(prompt: string, kind: "image" | "video"): Promise<GeneratedMedia | undefined> {
    const baseUrl = process.env.COMFYUI_BASE_URL;
    if (!baseUrl) {
      return undefined;
    }
    if (kind === "video") {
      const videoEndpoint = process.env.COMFYUI_VIDEO_ENDPOINT;
      if (!videoEndpoint) {
        return undefined;
      }
      const response = await fetch(resolveUrl(baseUrl, videoEndpoint), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ prompt })
      });
      if (!response.ok) {
        throw new Error(`comfyui video failed (${response.status})`);
      }
      const payload = (await response.json()) as { url?: string };
      if (!payload.url) {
        return undefined;
      }
      return { kind, url: payload.url, provider: "comfyui" };
    }

    const workflowRaw = process.env.COMFYUI_WORKFLOW_JSON;
    if (!workflowRaw) {
      return undefined;
    }
    const workflow = JSON.parse(workflowRaw) as Record<string, { inputs?: Record<string, unknown> }>;
    injectPromptIntoWorkflow(workflow, prompt);
    const clientId = randomUUID();
    const submit = await fetch(resolveUrl(baseUrl, "/prompt"), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: workflow, client_id: clientId })
    });
    if (!submit.ok) {
      throw new Error(`comfyui prompt failed (${submit.status})`);
    }
    const submitPayload = (await submit.json()) as { prompt_id?: string };
    const promptId = submitPayload.prompt_id;
    if (!promptId) {
      return undefined;
    }
    const outputUrl = await pollComfyUIImage(baseUrl, promptId);
    if (!outputUrl) {
      return undefined;
    }
    return {
      kind: "image",
      url: outputUrl,
      provider: "comfyui"
    };
  }

  private async generateViaCloud(prompt: string, kind: "image" | "video"): Promise<GeneratedMedia | undefined> {
    if (kind === "image") {
      const endpoint = process.env.CLOUD_IMAGE_API_URL;
      const apiKey = process.env.CLOUD_IMAGE_API_KEY;
      const model = process.env.CLOUD_IMAGE_MODEL ?? "gpt-image-1";
      if (!endpoint || !apiKey) {
        return undefined;
      }
      const response = await fetch(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model,
          prompt
        })
      });
      if (!response.ok) {
        throw new Error(`cloud image failed (${response.status})`);
      }
      const payload = (await response.json()) as { url?: string; data?: Array<{ url?: string }> };
      const url = payload.url ?? payload.data?.[0]?.url;
      if (!url) {
        return undefined;
      }
      return { kind, url, provider: "cloud" };
    }

    const endpoint = process.env.CLOUD_VIDEO_API_URL;
    const apiKey = process.env.CLOUD_VIDEO_API_KEY;
    if (!endpoint || !apiKey) {
      return undefined;
    }
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({ prompt })
    });
    if (!response.ok) {
      throw new Error(`cloud video failed (${response.status})`);
    }
    const payload = (await response.json()) as { url?: string };
    if (!payload.url) {
      return undefined;
    }
    return { kind: "video", url: payload.url, provider: "cloud" };
  }
}

function resolveUrl(base: string, path: string): string {
  return `${base.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
}

function injectPromptIntoWorkflow(workflow: Record<string, { inputs?: Record<string, unknown> }>, prompt: string): void {
  for (const node of Object.values(workflow)) {
    if (!node.inputs) continue;
    if (typeof node.inputs.text === "string") {
      node.inputs.text = prompt;
      return;
    }
    if (typeof node.inputs.prompt === "string") {
      node.inputs.prompt = prompt;
      return;
    }
  }
}

async function pollComfyUIImage(baseUrl: string, promptId: string): Promise<string | undefined> {
  const timeoutAt = Date.now() + 45_000;
  while (Date.now() < timeoutAt) {
    const response = await fetch(resolveUrl(baseUrl, `/history/${promptId}`));
    if (response.ok) {
      const payload = (await response.json()) as Record<
        string,
        {
          outputs?: Record<string, { images?: Array<{ filename: string; subfolder?: string; type?: string }> }>;
        }
      >;
      const item = payload[promptId];
      const outputs = item?.outputs ?? {};
      for (const output of Object.values(outputs)) {
        const image = output.images?.[0];
        if (image?.filename) {
          const view = `${resolveUrl(baseUrl, "/view")}?filename=${encodeURIComponent(image.filename)}&subfolder=${encodeURIComponent(
            image.subfolder ?? ""
          )}&type=${encodeURIComponent(image.type ?? "output")}`;
          return view;
        }
      }
    }
    await sleep(1200);
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
