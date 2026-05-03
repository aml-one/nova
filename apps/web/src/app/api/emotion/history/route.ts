import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";
import { WEB_CHAT_EMOTION_USER_ID } from "../../../../lib/emotion-user";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const userId = url.searchParams.get("userId") ?? WEB_CHAT_EMOTION_USER_ID;
  const target = `${getAgentBaseUrl(request)}/v1/emotion/history?userId=${encodeURIComponent(userId)}`;
  const response = await fetch(target, {
    headers: getAgentHeaders(request)
  });
  const data = (await response.json()) as {
    items?: Array<Record<string, unknown>>;
    itemsByDate?: Record<string, Array<Record<string, unknown>>>;
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "emotion history fetch failed" }, { status: response.status });
  }
  return NextResponse.json({
    items: data.items ?? [],
    itemsByDate: data.itemsByDate ?? {}
  });
}

