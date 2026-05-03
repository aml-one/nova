import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/backup/identity/status`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as {
    latestRun?: Record<string, unknown> | null;
    latestSuccess?: Record<string, unknown> | null;
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "identity backup status failed" }, { status: response.status });
  }
  return NextResponse.json({
    latestRun: data.latestRun ?? null,
    latestSuccess: data.latestSuccess ?? null
  });
}

