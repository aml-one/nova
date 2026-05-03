import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../lib/agent-core";

type AppSettingsPayload = {
  delegatedFolders?: string[];
  requireApprovals?: boolean;
  activeProvider?: "ollama" | "lmstudio" | "copilot";
  ollama?: { disabled?: boolean; numPredict?: number; keepAlive?: string };
  lmstudio?: { disabled?: boolean };
  visionProviderPriority?: Array<"lmstudio" | "ollama" | "cloud">;
  vision?: {
    ollamaModel?: string;
    ollamaBaseUrl?: string;
    lmstudioModel?: string;
    lmstudioBaseUrl?: string;
    cloudModel?: string;
    cloudBaseUrl?: string;
    cloudApiKey?: string;
    swapLocalModelsForVision?: boolean;
  };
  mediaProviderPriority?: Array<"comfyui" | "cloud">;
  shell?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
  };
  skills?: {
    isolationEnabled?: boolean;
    timeoutMs?: number;
    maxMemoryMb?: number;
    skillAuthoringDisabled?: boolean;
  };
  web?: {
    loginEnabled?: boolean;
    hideProviderModelInStats?: boolean;
    sendOnEnter?: boolean;
    voiceDictationAutoSend?: boolean;
    voiceDictationSilenceSec?: number;
    voiceContinuousConversation?: boolean;
    readAloudMessages?: boolean;
    showThinkingInChat?: boolean;
    textScale?: "normal" | "medium" | "big";
    chatStyle?: {
      userBubbleColor?: string;
      assistantBubbleColor?: string;
      userTextColor?: string;
      assistantTextColor?: string;
      userActionIconColor?: string;
      assistantActionIconColor?: string;
      statsTextColor?: string;
      userBubbleColorLight?: string;
      assistantBubbleColorLight?: string;
      userTextColorLight?: string;
      assistantTextColorLight?: string;
      userActionIconColorLight?: string;
      assistantActionIconColorLight?: string;
      statsTextColorLight?: string;
      bubbleBackgroundEnabled?: boolean;
      borderColor?: string;
      borderThicknessPx?: number;
      userBorderThicknessPx?: number;
      assistantBorderThicknessPx?: number;
      userBackgroundOpacityPct?: number;
      assistantBackgroundOpacityPct?: number;
    };
  };
  learning?: {
    enabled?: boolean;
    idleMinutes?: number;
    intervalMs?: number;
    minFailuresForAutoImprove?: number;
  };
  costGovernor?: {
    enabled?: boolean;
    dailyBudgetUsd?: number;
    qualityTier?: "high" | "balanced" | "economy";
    providerPricing?: {
      ollamaPer1k?: number;
      lmstudioPer1k?: number;
      copilotPer1k?: number;
    };
  };
  messagingAccess?: {
    novaPhoneNumber?: string;
    denyUnknownNumbers?: boolean;
    systemAdmins?: string[];
    guests?: string[];
    importantPeople?: Array<{
      phone: string;
      permissions: {
        cameraAccess?: boolean;
        shellAccess?: boolean;
        securityCenterAccess?: boolean;
        schedulerAccess?: boolean;
      };
    }>;
  };
  emotions?: {
    enabled?: boolean;
    expressionStyle?: "subtle" | "balanced" | "expressive";
    mirrorUserValence?: boolean;
  };
  memoryBear?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    searchSwitch?: "0" | "1" | "2";
    storageType?: "neo4j" | "rag";
    syncWrites?: boolean;
  };
  sentiCore?: {
    enabled?: boolean;
    orchestrationMarkdownPath?: string;
  };
  orpheusTts?: {
    enabled?: boolean;
    baseUrl?: string;
    apiKey?: string;
    voice?: string;
    model?: string;
    responseFormat?: "mp3" | "wav" | "opus" | "pcm" | "flac";
  };
  identityBackup?: {
    enabled?: boolean;
    intervalDays?: number;
    labelPrefix?: string;
  };
  models?: {
    defaultByProvider?: {
      ollama?: string;
      lmstudio?: string;
      copilot?: string;
    };
    ollamaThinkingEnabled?: boolean;
  };
  copilot?: {
    baseUrl?: string;
    apiKey?: string;
    defaultModel?: string;
  };
  updates?: {
    enabled?: boolean;
    checkIntervalMs?: number;
    repoOwner?: string;
    repoName?: string;
    channel?: "stable" | "beta";
    autoApply?: boolean;
  };
  offlineMode?: {
    enabled?: boolean;
  };
  skillSettings?: Record<string, Record<string, unknown>>;
};

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/settings`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { settings?: AppSettingsPayload; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "settings fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ settings: data.settings ?? {} });
}

export async function PUT(request: Request) {
  const payload = (await request.json()) as AppSettingsPayload;
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/settings`, {
    method: "PUT",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { settings?: AppSettingsPayload; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "settings update failed" }, { status: response.status });
  }
  return NextResponse.json({ settings: data.settings ?? {} });
}

