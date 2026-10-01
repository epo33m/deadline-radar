"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { createPortal } from "react-dom";

import { cn } from "@/lib/utils";

export type LoadingDialogProps = {
  open: boolean;
  title?: string;
  description?: string;
  className?: string;
};

export function LoadingDialog({
  open,
  title = "Loading…",
  description,
  className,
}: LoadingDialogProps) {
  const titleId = useId();
  const descId = useId();
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  if (!mounted || !open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px] animate-in fade-in duration-150"
      aria-hidden={!open}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-busy="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        className={cn(
          "relative z-10 flex min-w-[220px] max-w-[320px] flex-col items-center justify-center rounded-2xl border border-hairline bg-canvas/95 p-6 text-center shadow-2xl backdrop-blur-md",
          className,
        )}
      >
        <Loader2
          className="size-8 animate-spin text-primary"
          aria-hidden="true"
        />
        <h2
          id={titleId}
          className="mt-3.5 font-display text-[17px] font-semibold leading-snug tracking-[-0.2px] text-ink"
        >
          {title}
        </h2>
        {description ? (
          <p
            id={descId}
            className="mt-1 text-sm leading-normal text-ink-muted-64"
          >
            {description}
          </p>
        ) : null}
      </div>
    </div>,
    document.body,
  );
}
