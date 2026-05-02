/** UI + client mirror of agent-core `isSkillRuntimeEnabled` (same rules). */
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
