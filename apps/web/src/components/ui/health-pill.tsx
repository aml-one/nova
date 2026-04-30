import { cn } from "../../lib/cn";

export function HealthPill({ level }: { level: "green" | "orange" | "red" }) {
  const map = {
    green: "bg-pastelGreen border-emerald-500/70",
    orange: "bg-pastelOrange border-orange-500/70",
    red: "bg-pastelRed border-rose-500/70"
  } as const;
  return <span className={cn("inline-flex rounded-ui border px-2 py-1 text-xs font-semibold text-slate-900", map[level])}>{level}</span>;
}
