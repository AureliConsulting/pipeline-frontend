import * as React from "react";
import { cn } from "@/lib/cn";

export function Alert({
  tone = "info",
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: "info" | "success" | "warning" | "danger" }) {
  const tones = {
    info: "border-note/30 bg-note-bg text-note",
    success: "border-ok/30 bg-ok-bg text-ok",
    warning: "border-warn/30 bg-warn-bg text-warn",
    danger: "border-danger/30 bg-danger-bg text-danger",
  } as const;
  return (
    <div
      role={tone === "danger" ? "alert" : "status"}
      className={cn("rounded border px-3 py-2 text-sm", tones[tone], className)}
      {...props}
    />
  );
}

export function ProgressBar({
  value,
  max = 100,
  label,
}: {
  value: number;
  max?: number;
  label?: string;
}) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div
      role="progressbar"
      aria-valuenow={value}
      aria-valuemax={max}
      aria-label={label ?? "Progress"}
      className="h-2 w-full overflow-hidden rounded-full bg-sage-light"
    >
      <div className="h-full bg-evergreen transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block h-4 w-4 animate-spin rounded-full border-2 border-sage border-t-evergreen",
        className,
      )}
    />
  );
}

export function StatTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-md border border-sage-light bg-white px-3 py-2.5">
      <div className="text-[11px] font-medium uppercase tracking-wide text-charcoal/55">{label}</div>
      <div className="mt-0.5 font-[family-name:var(--font-heading)] text-xl font-semibold text-evergreen-deep">
        {value}
      </div>
      {hint ? <div className="mt-0.5 text-xs text-charcoal/50">{hint}</div> : null}
    </div>
  );
}

export function EmptyState({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="rounded-md border border-dashed border-sage px-6 py-10 text-center">
      <p className="text-sm font-medium text-charcoal/70">{title}</p>
      {hint ? <p className="mt-1 text-xs text-charcoal/50">{hint}</p> : null}
    </div>
  );
}
