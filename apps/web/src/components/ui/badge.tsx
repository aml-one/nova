import type { ReactNode } from "react";
import { cn } from "../../lib/cn";

export function Badge({
  children,
  tone = "blue"
}: {
  children: ReactNode;
  tone?: "blue" | "orange" | "pink" | "green" | "red" | "yellow" | "purple" | "neutral";
}) {
  const map = {
    blue: "bg-pastelBlue border-blue-500/70",
    orange: "bg-pastelOrange border-orange-500/70",
    pink: "bg-pastelPink border-pink-500/70",
    green: "bg-pastelGreen border-emerald-500/70",
    red: "bg-pastelRed border-rose-500/70",
    yellow: "bg-pastelYellow border-amber-500/70",
    purple: "bg-pastelPurple border-purple-500/70",
    neutral: "bg-surface border-border"
  } as const;
  return <span className={cn("inline-flex rounded-ui border px-2 py-1 text-xs font-semibold text-slate-900", map[tone])}>{children}</span>;
}
