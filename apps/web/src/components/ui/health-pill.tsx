import { cn } from "../../lib/cn";

export function HealthPill({
  level,
  label,
  className
}: {
  level: "green" | "orange" | "red" | "gray";
  label?: string;
  className?: string;
}) {
  const map = {
    green: "bg-pastelGreen border-emerald-600/55 dark:border-emerald-500/70",
    orange: "bg-pastelOrange border-orange-600/55 dark:border-orange-500/70",
    red: "bg-pastelRed border-rose-600/55 dark:border-rose-500/70",
    gray: "bg-slate-200 border-slate-500/55 dark:bg-slate-700/60 dark:border-slate-400/70"
  } as const;
  const labelMap = {
    green: "Healthy / Connected",
    orange: "Not Connected",
    red: "Failed / Not Configured",
    gray: "Not Configured"
  } as const;
  const isNotConfigured = (label ?? "").toLowerCase().includes("not configured");
  const effectiveLevel = isNotConfigured && level === "orange" ? "gray" : level;
  return (
    <span
      className={cn(
        "inline-flex rounded-ui border px-2 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100",
        effectiveLevel === "orange" && "text-orange-950 dark:text-orange-50",
        effectiveLevel === "green" && "text-emerald-950 dark:text-emerald-50",
        effectiveLevel === "red" && "text-rose-950 dark:text-rose-50",
        effectiveLevel === "gray" && "text-slate-800 dark:text-slate-100",
        map[effectiveLevel],
        className
      )}
    >
      {label ?? labelMap[effectiveLevel]}
    </span>
  );
}
