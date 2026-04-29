import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? "nova-system";
  const response = await fetch(`${getAgentBaseUrl()}/v1/emotion/state?userId=${encodeURIComponent(userId)}`, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as { userId?: string; state?: unknown; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "emotion state failed" }, { status: response.status });
  }
  return NextResponse.json({ userId: data.userId ?? userId, state: data.state ?? null });
}
