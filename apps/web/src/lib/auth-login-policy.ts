import { fetchFromAgent, getAgentBaseUrlDebug, type AgentBaseUrlDebug } from "./agent-core";

/**
 * Interpret agent `/v1/auth/state` loginEnabled (handles occasional stringly JSON).
 * Default when missing: login required (`true`).
 */
export function coerceLoginEnabledFlag(value: unknown): boolean {
  if (value === false || value === "false" || value === 0 || value === "0") {
    return false;
  }
  return true;
}

/**
 * Optional operator overrides (e.g. recovery when agent auth state cannot be read).
 * - NOVA_WEB_LOGIN_ENABLED=false → treat web login as off (open UI).
 * - NOVA_WEB_LOGIN_ENABLED=true → force login gate on.
 * When unset, agent response is authoritative.
 */
export function loginEnabledEnvOverride(): boolean | undefined {
  const raw = process.env.NOVA_WEB_LOGIN_ENABLED?.trim().toLowerCase();
  if (raw === "0" || raw === "false" || raw === "off") return false;
  if (raw === "1" || raw === "true" || raw === "on") return true;
  return undefined;
}

export type AgentAuthStateSnapshot = {
  needsSetup: boolean;
  loginEnabled: boolean;
};

/**
 * When the agent is down, Edge middleware may not see `process.env` the same way as Node.
 * Optional static file at `/nova-login-fallback.json` (copy from `nova-login-fallback.json.example`)
 * lets you set `"loginEnabled": false` at **runtime** without rebuilding.
 */
export async function loginPolicyFromPublicFallback(request: Request): Promise<boolean | undefined> {
  try {
    const u = new URL(request.url);
    u.pathname = "/nova-login-fallback.json";
    u.hash = "";
    u.search = "";
    const res = await fetch(u.toString(), { cache: "no-store" });
    if (!res.ok) {
      return undefined;
    }
    const data = (await res.json()) as { loginEnabled?: unknown };
    if (data.loginEnabled === false || data.loginEnabled === "false" || data.loginEnabled === 0 || data.loginEnabled === "0") {
      return false;
    }
    if (data.loginEnabled === true || data.loginEnabled === "true" || data.loginEnabled === 1 || data.loginEnabled === "1") {
      return true;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

/**
 * Reads `/v1/auth/state` from agent-core (public, no session).
 * Returns `undefined` when the agent cannot be reached or returns non-OK and no env/fallback applies.
 */
export async function fetchAgentAuthState(request: Request): Promise<AgentAuthStateSnapshot | undefined> {
  const envLogin = loginEnabledEnvOverride();
  const fromEnv = (needsSetup: boolean): AgentAuthStateSnapshot => ({
    needsSetup,
    loginEnabled: envLogin!
  });
  const fromFallback = async (): Promise<AgentAuthStateSnapshot | undefined> => {
    const fb = await loginPolicyFromPublicFallback(request);
    if (fb === undefined) {
      return undefined;
    }
    return { needsSetup: false, loginEnabled: fb };
  };
  try {
    const debug = getAgentBaseUrlDebug(request);
    const res = await fetchFromAgent(request, "/v1/auth/state", {
      headers: { accept: "application/json" }
    });
    if (!res.ok) {
      if (envLogin !== undefined) {
        return fromEnv(false);
      }
      return (await fromFallback()) ?? undefined;
    }
    const data = (await res.json()) as { needsSetup?: unknown; loginEnabled?: unknown };
    return {
      needsSetup: data.needsSetup === true,
      loginEnabled: envLogin !== undefined ? envLogin : coerceLoginEnabledFlag(data.loginEnabled)
    };
  } catch {
    if (envLogin !== undefined) {
      return fromEnv(false);
    }
    return (await fromFallback()) ?? undefined;
  }
}

export function agentUrlDebugForRequest(request: Request): AgentBaseUrlDebug {
  return getAgentBaseUrlDebug(request);
}
