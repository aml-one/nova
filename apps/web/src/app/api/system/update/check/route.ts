import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/system/update/check`, {
    method: "POST",
    headers: getAgentHeaders(request, true)
  });
  const data = (await response.json()) as { status?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "update check failed" }, { status: response.status });
  }
  return NextResponse.json({ status: data.status ?? null });
}

