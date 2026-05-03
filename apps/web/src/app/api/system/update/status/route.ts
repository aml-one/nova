import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/system/update/status`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { status?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "update status failed" }, { status: response.status });
  }
  return NextResponse.json({ status: data.status ?? null });
}

