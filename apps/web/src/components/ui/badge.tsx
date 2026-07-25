import * as React from "react";
import { cn } from "@/lib/cn";

type Tone = "neutral" | "success" | "warning" | "danger" | "info" | "evergreen";

const tones: Record<Tone, string> = {
  neutral: "bg-sage-light text-evergreen-deep",
  success: "bg-ok-bg text-ok",
  warning: "bg-warn-bg text-warn",
  danger: "bg-danger-bg text-danger",
  info: "bg-note-bg text-note",
  evergreen: "bg-evergreen text-white",
};

export function Badge({
  tone = "neutral",
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 whitespace-nowrap rounded-sm px-1.5 py-0.5 text-[11px] font-medium",
        tones[tone],
        className,
      )}
      {...props}
    />
  );
}
