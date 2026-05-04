import { NextResponse } from "next/server";
import { fetchAgentAuthState } from "../../../../lib/auth-login-policy";

export async function GET(request: Request) {
  const state = await fetchAgentAuthState(request);
  if (!state) {
    return NextResponse.json({
      needsSetup: false,
      loginEnabled: true,
      agentUnreachable: true
    });
  }
  return NextResponse.json({
    needsSetup: state.needsSetup,
    loginEnabled: state.loginEnabled
  });
}

