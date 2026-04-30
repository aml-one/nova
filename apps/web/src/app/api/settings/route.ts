import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../lib/agent-core";

type AppSettingsPayload = {
  delegatedFolders?: string[];
  requireApprovals?: boolean;
  activeProvider?: "ollama" | "lmstudio" | "copilot";
  visionProviderPriority?: Array<"lmstudio" | "ollama" | "cloud">;
  mediaProviderPriority?: Array<"comfyui" | "cloud">;
  shell?: {
    timeoutMs?: number;
    maxOutputBytes?: number;
  };
  skills?: {
    isolationEnabled?: boolean;
    timeoutMs?: number;
    maxMemoryMb?: number;
  };
  web?: {
    loginEnabled?: boolean;
    hideProviderModelInStats?: boolean;
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
  const response = await fetch(`${getAgentBaseUrl()}/v1/settings`, {
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
  const response = await fetch(`${getAgentBaseUrl()}/v1/settings`, {
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
