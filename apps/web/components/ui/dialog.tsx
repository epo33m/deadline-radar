"use client";

import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";

import { formActionGapClassName } from "@/components/ui/dialog-form";
import { cn } from "@/lib/utils";

type DialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  children: ReactNode;
  className?: string;
  dismissible?: boolean;
};

const dialogPanelClassName =
  "relative z-10 flex max-h-[min(90dvh,640px)] w-full flex-col overflow-hidden rounded-t-2xl border border-hairline border-b-0 bg-canvas shadow-lg sm:max-h-[min(90vh,640px)] sm:max-w-[400px] sm:rounded-xl sm:border-b";

const dialogTitleClassName =
  "font-display text-[21px] font-semibold leading-[1.07] tracking-[-0.2px] text-ink";

const dialogBodyClassName =
  "flex w-full flex-col items-center px-6 pt-2 pb-[max(1.5rem,env(safe-area-inset-bottom))] text-center";

export const dialogActionsClassName = cn(
  "flex w-full flex-col pt-3",
  formActionGapClassName,
);

const dialogActionBaseClassName =
  "min-h-11 w-full rounded-lg px-5 font-sans text-[17px] font-normal leading-[1.47] tracking-[-0.374px]";

export const dialogPrimaryActionClassName = dialogActionBaseClassName;

export const dialogSecondaryActionClassName = dialogActionBaseClassName;

export function getFocusableElements(container: HTMLElement) {
  return Array.from(
    container.querySelectorAll<HTMLElement>(
      "a[href], button:not([disabled]), input:not([type='hidden']):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex='-1'])",
    ),
  ).filter((element) => element.offsetParent !== null);
}

function isDialogOverlayMenuOpen() {
  return Boolean(document.querySelector("[data-portal-menu]"));
}

export function Dialog({
  open,
  onOpenChange,
  title,
  children,
  className,
  dismissible = true,
}: DialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open || !panelRef.current) return;

    const panel = panelRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;

    const frame = requestAnimationFrame(() => {
      getFocusableElements(panel)[0]?.focus();
    });

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && dismissible) {
        if (isDialogOverlayMenuOpen()) return;
        event.preventDefault();
        onOpenChange(false);
        return;
      }

      if (event.key !== "Tab" || isDialogOverlayMenuOpen()) return;

      const focusable = getFocusableElements(panel);
      if (focusable.length === 0) return;

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;

      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus();
    };
  }, [open, dismissible, onOpenChange]);

  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center sm:p-4">
      <button
        type="button"
        tabIndex={-1}
        aria-label="Close dialog"
        className="absolute inset-0 bg-black/40"
        onClick={() => dismissible && !isDialogOverlayMenuOpen() && onOpenChange(false)}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cn(dialogPanelClassName, className)}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <div className="w-full shrink-0 px-5 pt-5 pb-2 text-center sm:px-8">
          <h2 id={titleId} className={dialogTitleClassName}>
            {title}
          </h2>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className={dialogBodyClassName}>{children}</div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
