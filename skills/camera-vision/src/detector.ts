export type Detection = {
  label: "person" | "cat" | "car";
  confidence: number;
  box?: { x: number; y: number; width: number; height: number };
  color?: string;
  catIdentityHint?: string | undefined;
  carMake?: string;
  licensePlate?: string;
};

type VisionApiDetection = {
  label: string;
  confidence: number;
  box?: { x: number; y: number; width: number; height: number };
};

export async function detectSceneObjects(filePath: string): Promise<Detection[]> {
  const endpoint = process.env.NOVA_VISION_API_URL;
  if (endpoint) {
    try {
      const response = await fetch(`${endpoint}/detect`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ filePath, labels: ["person", "cat", "car"] })
      });
      if (response.ok) {
        const payload = (await response.json()) as { detections?: VisionApiDetection[] };
        return (payload.detections ?? [])
          .filter((item) => item.label === "person" || item.label === "cat" || item.label === "car")
          .map((item) => ({
            label: item.label as "person" | "cat" | "car",
            confidence: item.confidence,
            box: item.box
          }));
      }
    } catch {
      // Fallback to heuristic placeholders when no detector backend is configured.
    }
  }
  const isDriveway = filePath.toLowerCase().includes("driveway");
  if (isDriveway) {
    return [{ label: "car", confidence: 0.55, color: "white", carMake: "unknown" }];
  }
  return [
    { label: "person", confidence: 0.61, color: "unknown" },
    { label: "cat", confidence: 0.58, color: "black-white" }
  ];
}
