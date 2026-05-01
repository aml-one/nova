export type ParsedCameraConfig = {
  name: string;
  rtspUrl: string;
  enabled: boolean;
};

export function parseCameraConfig(input: Record<string, unknown> | undefined): ParsedCameraConfig[] {
  const cfg = input ?? {};
  const rtspRaw = String(cfg.rtspUrls ?? cfg.rtsp_urls ?? "");
  const disabled = new Set(
    Array.isArray(cfg.disabledCameraNames) ? (cfg.disabledCameraNames as unknown[]).map((item) => String(item)) : []
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
        enabled: !disabled.has(name)
      } satisfies ParsedCameraConfig;
    });
}
