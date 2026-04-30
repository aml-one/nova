import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json().catch(() => ({}))) as { uploadId?: string };
  const response = await fetch(`${getAgentBaseUrl()}/v1/media/upload/init`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as { uploadId?: string; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "upload init failed" }, { status: response.status });
  }
  return NextResponse.json({ uploadId: data.uploadId });
}
