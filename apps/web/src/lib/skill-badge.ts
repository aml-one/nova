import { isSkillRuntimeEnabled } from "./skill-enabled";

export type SkillBadgeState = "active" | "degraded" | "inactive" | "off" | "ready";

type HealthCheck = { id: string; name: string; level: "green" | "orange" | "red"; detail: string };
type SkillItem = { id: string; name: string };

export function resolveSkillBadgeState(
  item: SkillItem,
  checks: HealthCheck[],
  skillSettings: Record<string, Record<string, unknown>>
): SkillBadgeState {
  if (!isSkillRuntimeEnabled(skillSettings, item.id)) {
    return "off";
  }
  const matched = checks.find((check) => {
    const raw = `${check.id} ${check.name} ${check.detail}`.toLowerCase();
    return raw.includes(item.id.toLowerCase()) || raw.includes(item.name.toLowerCase());
  });
  if (!matched) {
    return "ready";
  }
  if (matched.level === "green") return "active";
  if (matched.level === "orange") return "degraded";
  return "inactive";
}

export function labelForSkillBadgeState(status: SkillBadgeState): string {
  if (status === "active") return "active";
  if (status === "degraded") return "degraded";
  if (status === "inactive") return "inactive";
  if (status === "off") return "off";
  return "ready";
}

export function badgeClassForSkillBadgeState(status: SkillBadgeState): string {
  if (status === "active") return "rounded-ui border border-emerald-500/40 bg-emerald-500/15 px-2 py-0.5 text-[10px] text-emerald-300";
  if (status === "degraded") return "rounded-ui border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] text-amber-300";
  if (status === "ready") return "rounded-ui border border-sky-500/40 bg-sky-500/15 px-2 py-0.5 text-[10px] text-sky-300";
  if (status === "off") return "rounded-ui border border-slate-500/50 bg-slate-500/15 px-2 py-0.5 text-[10px] text-slate-400";
  return "rounded-ui border border-rose-500/40 bg-rose-500/15 px-2 py-0.5 text-[10px] text-rose-300";
}

export function buildSkillBadgeMap(
  manifests: SkillItem[],
  checks: HealthCheck[],
  skillSettings: Record<string, Record<string, unknown>>
): Record<string, SkillBadgeState> {
  const byId: Record<string, SkillBadgeState> = {};
  for (const item of manifests) {
    const key = item.id;
    byId[key] = resolveSkillBadgeState(item, checks, skillSettings);
  }
  return byId;
}
