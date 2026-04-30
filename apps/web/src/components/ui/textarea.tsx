import type { TextareaHTMLAttributes } from "react";
import { cn } from "../../lib/cn";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "w-full rounded-ui border bg-surface px-3 py-2 text-sm text-text outline-none ring-pastelPurple/60 placeholder:text-muted focus:ring-2",
        className
      )}
    />
  );
}
