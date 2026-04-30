import type { InputHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Input({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={cn(
        "w-full rounded-ui border bg-surface px-3 py-2 text-sm text-text outline-none ring-pastelBlue/60 placeholder:text-muted focus:ring-2",
        className
      )}
    />
  );
}
