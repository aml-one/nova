import type { ButtonHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

const tones = {
  blue: "bg-pastelBlue border-blue-500/70 text-slate-900",
  orange: "bg-pastelOrange border-orange-500/70 text-slate-900",
  pink: "bg-pastelPink border-pink-500/70 text-slate-900",
  green: "bg-pastelGreen border-emerald-500/70 text-slate-900",
  red: "bg-pastelRed border-rose-500/70 text-slate-900",
  yellow: "bg-pastelYellow border-amber-500/70 text-slate-900",
  purple: "bg-pastelPurple border-purple-500/70 text-slate-900",
  neutral: "bg-surface2 border-border text-text"
} as const;

type Props = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: keyof typeof tones;
};

export function Button({ className, tone = "blue", ...props }: Props) {
  return (
    <button
      {...props}
      className={cn(
        "rounded-ui border px-2.5 py-1.5 text-xs font-medium shadow-sm transition hover:brightness-95 disabled:cursor-not-allowed disabled:opacity-50",
        tones[tone],
        className
      )}
    />
  );
}
