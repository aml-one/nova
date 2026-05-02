/**
 * LM Studio exposes model unload on the REST root (not under /v1):
 * POST /api/v1/models/unload  body: { "instance_id": "<model id>" }
 * @see https://lmstudio.ai/docs/developer/rest/unload
 */

function lmstudioAuthHeaders(): Record<string, string> {
  const t = process.env.LMSTUDIO_API_KEY?.trim() || process.env.LM_API_TOKEN?.trim();
  return t ? { authorization: `Bearer ${t}` } : {};
}

/** OpenAI-compatible base (…/v1) → server root for /api/v1/… calls. */
export function lmstudioOpenAiBaseToRestRoot(openAiBase: string): string {
  let u = openAiBase.trim().replace(/\/+$/, "");
  if (u.endsWith("/v1")) {
    u = u.slice(0, -3);
  }
  return u.replace(/\/+$/, "");
}

export async function lmstudioUnloadModel(restRoot: string, instanceId: string): Promise<void> {
  const root = restRoot.replace(/\/+$/, "");
  const id = instanceId.trim();
  if (!id || !root.startsWith("http")) return;
  try {
    await fetch(`${root}/api/v1/models/unload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...lmstudioAuthHeaders()
      },
      body: JSON.stringify({ instance_id: id })
    });
  } catch {
    // best-effort; older servers may not expose unload
  }
}
