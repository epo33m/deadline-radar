"use client";

import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { useId, useRef, useState } from "react";

import { logout } from "@/app/actions/auth";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { PortalMenu } from "@/components/ui/portal-menu";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  accountLabel: string;
  userEmail: string;
};

export function AccountMenu({ accountLabel, userEmail }: AccountMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const initial = accountLabel.charAt(0).toUpperCase() || "A";

  return (
    <div className="relative shrink-0">
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={menuId}
        aria-label={`Account menu for ${accountLabel}`}
        onClick={() => setOpen((current) => !current)}
        className="group rounded-full transition-transform active:scale-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
      >
        <Avatar className="size-8">
          <AvatarFallback className="bg-muted text-sm font-semibold text-ink transition-colors group-hover:bg-muted/70">
            {initial}
          </AvatarFallback>
        </Avatar>
      </button>

      <PortalMenu
        open={open}
        onClose={() => setOpen(false)}
        triggerRef={triggerRef}
        menuId={menuId}
        label="Account"
        role="group"
        focusFirstOnOpen
        measureOptions={{ minWidth: 240, align: "end", disableSheet: true }}
        className={cn(
          "bg-surface-pearl px-3 pt-0 pb-1 text-left border-divider-soft",
          "divide-y divide-divider-soft",
        )}
      >
        <div className="flex min-h-12 w-full items-center justify-between gap-4 py-3 sm:py-3.5">
          <span className="shrink-0 text-sm font-medium leading-snug tracking-[-0.2px] text-ink">
            Account
          </span>
          {userEmail ? (
            <span className="min-w-0 truncate text-right text-[13px] text-ink-muted-80">
              {userEmail}
            </span>
          ) : null}
        </div>
        <Link
          href="/preferences"
          onClick={() => setOpen(false)}
          className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:py-3.5"
        >
          <span className="shrink-0 text-sm font-medium leading-snug tracking-[-0.2px] text-ink">
            Preferences
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </Link>
        <form action={logout}>
          <button
            type="submit"
            className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:py-3.5"
          >
            <span className="shrink-0 text-sm font-medium leading-snug tracking-[-0.2px] text-destructive">
              Sign out
            </span>
          </button>
        </form>
      </PortalMenu>
    </div>
  );
}