import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const response = await fetch(`${getAgentBaseUrl()}/v1/system/version`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { version?: string; installedAt?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "version fetch failed" }, { status: response.status });
  }
  return NextResponse.json({ version: data.version ?? "0.0.0", installedAt: data.installedAt });
}
