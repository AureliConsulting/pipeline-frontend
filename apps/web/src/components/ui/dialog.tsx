"use client";
import * as React from "react";
import { cn } from "@/lib/cn";
import { Button } from "./button";

/** Accessible modal built on the native <dialog> element. */
export function Dialog({
  open,
  onClose,
  title,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = React.useRef<HTMLDialogElement>(null);

  React.useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onCancel={onClose}
      aria-label={title}
      className={cn(
        "m-auto w-full max-w-lg rounded-md border border-sage bg-white p-0 text-charcoal shadow-xl",
        "backdrop:bg-charcoal/40",
        className,
      )}
    >
      <div className="flex items-center justify-between border-b border-sage-light px-4 py-3">
        <h2 className="text-sm font-semibold text-evergreen-deep">{title}</h2>
        <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close dialog">
          ✕
        </Button>
      </div>
      <div className="px-4 py-4">{children}</div>
    </dialog>
  );
}
