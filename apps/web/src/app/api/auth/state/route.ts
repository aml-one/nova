import { NextResponse } from "next/server";
import { getAgentBaseUrl } from "../../../../lib/agent-core";

export async function GET() {
  const response = await fetch(`${getAgentBaseUrl()}/v1/auth/state`);
  const data = (await response.json()) as { needsSetup?: boolean; loginEnabled?: boolean; error?: string };
  if (!response.ok) {
    return NextResponse.json({ error: data.error ?? "auth state failed" }, { status: response.status });
  }
  return NextResponse.json({
    needsSetup: data.needsSetup === true,
    loginEnabled: data.loginEnabled !== false
  });
}
