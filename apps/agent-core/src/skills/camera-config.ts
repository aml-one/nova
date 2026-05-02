/** Parse RTSP lines from persisted skill settings (same shape as web Settings → Camera Vision). */
export function parseConfiguredCameras(
  skillSettings: Record<string, Record<string, unknown>>
): Array<{ name: string; rtspUrl: string; enabled: boolean; index: number }> {
  const config = (skillSettings["camera-vision"] ?? skillSettings["cameraVision"] ?? {}) as Record<string, unknown>;
  const rtspRaw = String(config.rtspUrls ?? config.rtsp_urls ?? "");
  const disabled = new Set(
    Array.isArray(config.disabledCameraNames) ? (config.disabledCameraNames as unknown[]).map((item) => String(item)) : []
  );
  return rtspRaw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const pipeIndex = line.indexOf("|");
      const named = pipeIndex > 0;
      const name = named ? line.slice(0, pipeIndex).trim() : `camera-${index + 1}`;
      const rtspUrl = named ? line.slice(pipeIndex + 1).trim() : line;
      return {
        name,
        rtspUrl,
        enabled: !disabled.has(name),
        index
      };
    });
}

export function resolveRtspForCameraName(
  skillSettings: Record<string, Record<string, unknown>>,
  requestedCameraName: string
): { rtspUrl: string; name: string } | undefined {
  const trimmed = requestedCameraName.trim();
  if (!trimmed) return undefined;
  const configured = parseConfiguredCameras(skillSettings);
  const target =
    configured.find((item) => item.name === trimmed) ??
    configured.find((item) => trimmed === `camera-${item.index + 1}`);
  if (!target?.enabled || !target.rtspUrl) return undefined;
  return { rtspUrl: target.rtspUrl, name: target.name };
}
