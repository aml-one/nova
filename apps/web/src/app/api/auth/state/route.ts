import { NextResponse } from "next/server";
import { fetchAgentAuthState } from "../../../../lib/auth-login-policy";
import { agentUrlDebugForRequest } from "../../../../lib/auth-login-policy";

export async function GET(request: Request) {
  const state = await fetchAgentAuthState(request);
  if (!state) {
    const debug = agentUrlDebugForRequest(request);
    return NextResponse.json({
      needsSetup: false,
      loginEnabled: true,
      agentUnreachable: true,
      agentUrl: debug.baseUrl,
      agentUrlSource: debug.source,
      agentUrlUsedHeader: debug.usedHeader ?? null,
      agentForwardedHost: debug.forwardedHost ?? null,
      agentHost: debug.host ?? null,
      agentPort: debug.port
    });
  }
  return NextResponse.json({
    needsSetup: state.needsSetup,
    loginEnabled: state.loginEnabled
  });
}

