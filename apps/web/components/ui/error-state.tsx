import Link from "next/link";
import { AlertCircle, ArrowLeft, RefreshCw, RotateCcw } from "lucide-react";
import type { ReactNode } from "react";
import {
  type CtaAction,
  type ErrorCopyItem,
  formatReferenceId,
} from "@deadline-radar/validation";

import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export type ErrorStateProps = {
  title?: string;
  message?: string;
  copy?: ErrorCopyItem;
  refId?: string | null;
  cta?: CtaAction | CtaAction[];
  onAction?: (action: CtaAction) => void;
  actionHref?: string;
  secondaryAction?: ReactNode;
  className?: string;
  card?: boolean;
};

function renderCtaButton(
  action: CtaAction,
  props: {
    onAction?: (action: CtaAction) => void;
    actionHref?: string;
  },
) {
  const icon =
    action === "Try Again" || action === "Retry" ? (
      <RotateCcw className="size-4" strokeWidth={2} aria-hidden="true" />
    ) : action === "Refresh" ? (
      <RefreshCw className="size-4" strokeWidth={2} aria-hidden="true" />
    ) : action === "Go Back" || action === "Go Home" ? (
      <ArrowLeft className="size-4" strokeWidth={2} aria-hidden="true" />
    ) : null;

  if (props.actionHref) {
    return (
      <Link
        key={action}
        href={props.actionHref}
        className={cn(buttonVariants(), "min-h-11 rounded-full px-5")}
      >
        {icon}
        {action}
      </Link>
    );
  }

  return (
    <Button
      type="button"
      key={action}
      onClick={() => props.onAction?.(action)}
      className="min-h-11 rounded-full px-5"
    >
      {icon}
      {action}
    </Button>
  );
}

export function ErrorState({
  title,
  message,
  copy,
  refId,
  cta,
  onAction,
  actionHref,
  secondaryAction,
  className,
  card = false,
}: ErrorStateProps) {
  const effectiveTitle = title ?? copy?.title ?? "Something went wrong";
  const effectiveMessage =
    message ?? copy?.message ?? "We couldn't complete this action. Please try again.";
  const rawCta = cta ?? copy?.cta ?? "Try Again";
  const ctaActions: CtaAction[] = Array.isArray(rawCta) ? rawCta : [rawCta];
  const formattedRef = refId ? formatReferenceId(refId) : null;

  return (
    <div
      role="alert"
      aria-live="assertive"
      className={cn(
        "flex flex-col items-center justify-center text-center",
        card
          ? "rounded-2xl border border-hairline/80 bg-canvas p-6 sm:p-8"
          : "px-4 py-12 sm:py-16",
        className,
      )}
    >
      <div className="mb-4 flex size-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertCircle className="size-6" strokeWidth={2} aria-hidden="true" />
      </div>

      <h2 className="font-display text-2xl font-semibold tracking-[-0.28px] text-ink sm:text-3xl">
        {effectiveTitle}
      </h2>

      <p className="mt-2 max-w-md text-[15px] leading-relaxed text-ink-muted-64 sm:text-base">
        {effectiveMessage}
      </p>

      {formattedRef ? (
        <p className="mt-3 font-mono text-xs text-ink-muted-48">
          Technical reference: {formattedRef}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        {ctaActions.map((action) =>
          renderCtaButton(action, { onAction, actionHref }),
        )}
        {secondaryAction}
      </div>
    </div>
  );
}

export type EmptyStateViewProps = {
  title: string;
  message: string;
  cta?: CtaAction;
  actionHref?: string;
  onAction?: () => void;
  icon?: ReactNode;
  className?: string;
};

export function EmptyStateView({
  title,
  message,
  cta,
  actionHref,
  onAction,
  icon,
  className,
}: EmptyStateViewProps) {
  return (
    <div
      role="status"
      className={cn(
        "flex flex-col items-center justify-center px-4 py-12 text-center sm:py-16",
        className,
      )}
    >
      {icon ? <div className="mb-4">{icon}</div> : null}
      <h3 className="font-display text-xl font-semibold text-ink sm:text-2xl">
        {title}
      </h3>
      <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-ink-muted-48">
        {message}
      </p>
      {cta ? (
        <div className="mt-6">
          {actionHref ? (
            <Link
              href={actionHref}
              className={cn(buttonVariants(), "min-h-11 rounded-full px-5")}
            >
              {cta}
            </Link>
          ) : (
            <Button
              type="button"
              onClick={onAction}
              className="min-h-11 rounded-full px-5"
            >
              {cta}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
