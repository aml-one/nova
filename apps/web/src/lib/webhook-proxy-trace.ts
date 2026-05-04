import { getAgentBaseUrl, getAgentHeaders } from "./agent-core";

export async function reportWebhookProxyTrace(
  request: Request,
  channel: "signal" | "whatsapp",
  stage: string,
  opts: { httpStatus?: number; detail: string; bodyPreview?: string }
): Promise<void> {
  try {
    await fetch(`${getAgentBaseUrl(request)}/v1/setup/channels/webhook-proxy-trace`, {
      method: "POST",
      headers: { ...getAgentHeaders(request, true) },
      body: JSON.stringify({
        channel,
        stage,
        httpStatus: opts.httpStatus,
        detail: opts.detail,
        bodyPreview: opts.bodyPreview?.slice(0, 800)
      })
    });
  } catch {
    // best-effort; do not break webhook delivery
  }
}
