import { cn } from "../../lib/cn";

export function HealthPill({
  level,
  label,
  className
}: {
  level: "green" | "orange" | "red";
  label?: string;
  className?: string;
}) {
  const map = {
    green: "bg-pastelGreen border-emerald-600/55 dark:border-emerald-500/70",
    orange: "bg-pastelOrange border-orange-600/55 dark:border-orange-500/70",
    red: "bg-pastelRed border-rose-600/55 dark:border-rose-500/70"
  } as const;
  const labelMap = {
    green: "Healthy / Connected",
    orange: "Not Connected",
    red: "Failed / Not Configured"
  } as const;
  return (
    <span
      className={cn(
        "inline-flex rounded-ui border px-2 py-1 text-xs font-semibold text-slate-900 dark:text-slate-100",
        level === "orange" && "text-orange-950 dark:text-orange-50",
        level === "green" && "text-emerald-950 dark:text-emerald-50",
        level === "red" && "text-rose-950 dark:text-rose-50",
        map[level],
        className
      )}
    >
      {label ?? labelMap[level]}
    </span>
  );
}
