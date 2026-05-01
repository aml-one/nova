import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as { cameraName?: string };
  const response = await fetch(`${getAgentBaseUrl()}/v1/camera/test`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as Record<string, unknown> & { error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "camera test failed" }, { status: response.status });
  }
  // camera test can return ok:false with diagnostics while still being a successful API call
  return NextResponse.json(data);
}
