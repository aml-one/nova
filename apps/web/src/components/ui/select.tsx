import type { SelectHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Select({ className, ...props }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={cn(
        "w-full rounded-ui border bg-surface px-3 py-2 text-sm text-text outline-none ring-pastelGreen/60 focus:ring-2",
        className
      )}
    />
  );
}
