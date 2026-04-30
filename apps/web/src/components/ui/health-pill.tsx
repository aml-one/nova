import { cn } from "../../lib/cn";

export function HealthPill({ level, label }: { level: "green" | "orange" | "red"; label?: string }) {
  const map = {
    green: "bg-pastelGreen border-emerald-500/70",
    orange: "bg-pastelOrange border-orange-500/70",
    red: "bg-pastelRed border-rose-500/70"
  } as const;
  const labelMap = {
    green: "Healthy / Connected",
    orange: "Not Connected",
    red: "Failed / Not Configured"
  } as const;
  return (
    <span className={cn("inline-flex rounded-ui border px-2 py-1 text-xs font-semibold text-slate-900", map[level])}>
      {label ?? labelMap[level]}
    </span>
  );
}
