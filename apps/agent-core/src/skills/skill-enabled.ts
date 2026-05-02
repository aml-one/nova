/**
 * Whether a skill may run, based on `settings.skillSettings[skillId].enabled`
 * and optional `authoredByNova` (Nova-authored skills default off until enabled).
 */
export function isSkillRuntimeEnabled(
  skillSettings: Record<string, Record<string, unknown>>,
  skillId: string
): boolean {
  if (skillId === "camera-vision" || skillId === "cameraVision") {
    const a = skillSettings["camera-vision"]?.["enabled"];
    const b = skillSettings["cameraVision"]?.["enabled"];
    if (typeof a === "boolean") return a;
    if (typeof b === "boolean") return b;
    return false;
  }

  const entry = skillSettings[skillId] as Record<string, unknown> | undefined;
  if (entry?.authoredByNova === true) {
    return entry.enabled === true;
  }

  const v = entry?.enabled;
  if (typeof v === "boolean") {
    return v;
  }
  return true;
}
