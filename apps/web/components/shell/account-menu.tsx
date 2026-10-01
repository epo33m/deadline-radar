"use client";

import Link from "next/link";
import { Bell, ChevronRight, LogOut, User } from "lucide-react";
import { useId, useRef, useState } from "react";

import { logout } from "@/app/actions/auth";
import { useNotifications } from "@/components/notifications/notifications-provider";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  dialogActionsClassName,
  dialogPrimaryActionClassName,
  dialogSecondaryActionClassName,
} from "@/components/ui/dialog";
import { LoadingDialog } from "@/components/ui/loading-dialog";
import { PortalMenu } from "@/components/ui/portal-menu";
import { cn } from "@/lib/utils";

type AccountMenuProps = {
  accountLabel: string;
  userEmail: string;
};

function SignOutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  pending,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
  pending: boolean;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign out"
      dismissible={!pending}
    >
      <div className="flex w-full flex-col">
        <p className="text-[15px] leading-relaxed text-ink">
          Are you sure you want to sign out?
        </p>
        <p className="pt-2 text-sm leading-relaxed text-ink-muted-48">
          You will need to sign in again to access your tasks and courses.
        </p>

        <div className={dialogActionsClassName}>
          <Button
            type="button"
            disabled={pending}
            onClick={onConfirm}
            className={cn(
              dialogPrimaryActionClassName,
              "bg-destructive text-white hover:bg-destructive/90",
            )}
          >
            {pending ? "Signing out…" : "Sign out"}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={pending}
            onClick={() => onOpenChange(false)}
            className={dialogSecondaryActionClassName}
          >
            Cancel
          </Button>
        </div>
      </div>
    </Dialog>
  );
}

export function AccountMenu({ accountLabel, userEmail }: AccountMenuProps) {
  const menuId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const { unread } = useNotifications();
  const initial = accountLabel.charAt(0).toUpperCase() || "A";

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await logout();
    } catch {
      setLoggingOut(false);
      setConfirmOpen(false);
    }
  };

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
          <span className="flex min-w-0 items-center gap-2.5">
            <User
              className="size-4 shrink-0 text-ink-muted-48"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            <span className="shrink-0 text-sm font-medium leading-snug tracking-[-0.2px] text-ink">
              Account
            </span>
          </span>
          {userEmail ? (
            <span className="min-w-0 truncate text-right text-[13px] text-ink-muted-80">
              {userEmail}
            </span>
          ) : null}
        </div>
        <Link
          href="/settings/notifications"
          onClick={() => setOpen(false)}
          className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:py-3.5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <Bell
              className="size-4 shrink-0 text-ink-muted-48"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            <span className="shrink-0 text-sm font-medium leading-snug tracking-[-0.2px] text-ink">
              Notifications
            </span>
            {unread > 0 ? (
              <span className="flex h-4 min-w-4 items-center justify-center rounded-md bg-primary px-1 text-[10px] font-semibold text-primary-foreground">
                {unread > 99 ? "99+" : unread}
              </span>
            ) : null}
          </span>
          <ChevronRight
            className="size-4 shrink-0 text-ink-muted-48"
            aria-hidden="true"
            strokeWidth={1.75}
          />
        </Link>
        <button
          type="button"
          onClick={() => {
            setOpen(false);
            setConfirmOpen(true);
          }}
          className="flex min-h-12 w-full items-center justify-between gap-4 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:py-3.5"
        >
          <span className="flex min-w-0 items-center gap-2.5">
            <LogOut
              className="size-4 shrink-0 text-destructive/70"
              aria-hidden="true"
              strokeWidth={1.75}
            />
            <span className="shrink-0 text-sm font-medium leading-snug tracking-[-0.2px] text-destructive">
              Sign out
            </span>
          </span>
        </button>
      </PortalMenu>

      <SignOutConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        onConfirm={handleLogout}
        pending={loggingOut}
      />

      <LoadingDialog
        open={loggingOut}
        title="Signing out"
        description="Please wait while your session is cleared…"
      />
    </div>
  );
}