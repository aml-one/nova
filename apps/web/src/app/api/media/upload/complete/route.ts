import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { uploadId?: string; filename?: string };
  const baseUrl = getAgentBaseUrl(request);
  const response = await fetch(`${baseUrl}/v1/media/upload/complete`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as {
    url?: string;
    posterUrl?: string;
    contentType?: string;
    kind?: "image" | "video" | "other";
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "upload complete failed" }, { status: response.status });
  }
  return NextResponse.json({
    url: toWebReachableUrl(data.url, baseUrl),
    posterUrl: toWebReachableUrl(data.posterUrl, baseUrl),
    contentType: data.contentType,
    kind: data.kind
  });
}

function toWebReachableUrl(url: string | undefined, baseUrl: string): string {
  if (!url) return "";
  return url.replace(baseUrl, "");
}

