import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { filename?: string; base64?: string };
  if (!payload.filename || !payload.base64) {
    return NextResponse.json({ error: "filename and base64 are required" }, { status: 400 });
  }
  const baseUrl = getAgentBaseUrl();
  const response = await fetch(`${baseUrl}/v1/media/upload`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify({
      filename: payload.filename,
      base64: payload.base64
    })
  });
  const data = (await response.json()) as {
    url?: string;
    relativeUrl?: string;
    posterUrl?: string;
    posterRelativeUrl?: string;
    contentType?: string;
    kind?: "image" | "video" | "other";
    error?: string;
  };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "upload failed" }, { status: response.status });
  }
  return NextResponse.json({
    url: toWebReachableUrl(data.url, baseUrl),
    posterUrl: toWebReachableUrl(data.posterUrl, baseUrl),
    contentType: data.contentType,
    kind: data.kind
  });
}

function toWebReachableUrl(url: string | undefined, baseUrl: string): string {
  if (!url) {
    return "";
  }
  return url.replace(baseUrl, "");
}
