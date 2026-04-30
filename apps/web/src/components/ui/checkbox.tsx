import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Checkbox({ className, ...props }: Omit<InputHTMLAttributes<HTMLInputElement>, "type">) {
  return (
    <input
      type="checkbox"
      {...props}
      className={cn(
        "h-4 w-4 rounded-[4px] border border-purple-500/70 bg-surface accent-purple-500",
        className
      )}
    />
  );
}
