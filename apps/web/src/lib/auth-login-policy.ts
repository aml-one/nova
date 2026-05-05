import { getAgentBaseUrl } from "./agent-core";

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
 * Reads `/v1/auth/state` from agent-core (public, no session).
 * Returns `undefined` when the agent cannot be reached or returns non-OK.
 */
export async function fetchAgentAuthState(request: Request): Promise<AgentAuthStateSnapshot | undefined> {
  const envLogin = loginEnabledEnvOverride();
  const fromEnv = (needsSetup: boolean): AgentAuthStateSnapshot => ({
    needsSetup,
    loginEnabled: envLogin!
  });
  try {
    const res = await fetch(`${getAgentBaseUrl(request)}/v1/auth/state`, {
      headers: { accept: "application/json" },
      cache: "no-store"
    });
    if (!res.ok) {
      if (envLogin !== undefined) {
        return fromEnv(false);
      }
      return undefined;
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
    return undefined;
  }
}
