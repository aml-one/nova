import { NextResponse } from "next/server";
import { getAgentBaseUrl, getAgentHeaders } from "../../../../lib/agent-core";

export async function POST(request: Request) {
  const payload = (await request.json()) as {
    action?: "block_ip" | "harden";
    ipToBlock?: string;
    allowlistPorts?: number[];
    apply?: boolean;
    approvalId?: string;
  };
  const response = await fetch(`${getAgentBaseUrl(request)}/v1/security/action`, {
    method: "POST",
    headers: getAgentHeaders(request, true),
    body: JSON.stringify(payload)
  });
  const data = (await response.json()) as {
    result?: unknown;
    error?: string;
    approvalRequired?: boolean;
    approvalId?: string;
  };
  if (!response.ok && response.status !== 202) {
    return NextResponse.json({ error: data.error ?? "security action failed" }, { status: response.status });
  }
  return NextResponse.json({
    result: data.result ?? null,
    approvalRequired: data.approvalRequired === true,
    approvalId: data.approvalId
  });
}

