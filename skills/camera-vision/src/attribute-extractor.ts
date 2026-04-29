import type { Detection } from "./detector.js";

export type EnrichedDetection = Detection & {
  color: string;
  carMake?: string;
  licensePlate?: string;
};

export function enrichDetections(
  detections: Detection[],
  opts: { plateRecognitionEnabled: boolean }
): EnrichedDetection[] {
  return detections.map((item) => {
    const color = item.color ?? inferColorFromLabel(item.label);
    const plate = opts.plateRecognitionEnabled && item.label === "car" ? item.licensePlate ?? "unreadable" : undefined;
    return {
      ...item,
      color,
      carMake: item.label === "car" ? item.carMake ?? "unknown" : undefined,
      licensePlate: plate
    };
  });
}

function inferColorFromLabel(label: Detection["label"]): string {
  if (label === "cat") {
    return "multi";
  }
  if (label === "car") {
    return "unknown";
  }
  return "unknown";
}
