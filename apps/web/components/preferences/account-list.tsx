"use client";

import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { ChangeEmailForm } from "@/components/preferences/change-email-form";
import { ChangePasswordForm } from "@/components/preferences/change-password-form";
import { Dialog } from "@/components/ui/dialog";

type AccountListProps = {
  email: string;
  pendingEmail?: string | null;
};

export function AccountList({ email, pendingEmail }: AccountListProps) {
  const [emailOpen, setEmailOpen] = useState(false);
  const [passwordOpen, setPasswordOpen] = useState(false);

  return (
    <>
      <ul className="list-none overflow-hidden rounded-xl border border-hairline bg-canvas">
        <li>
          <button
            type="button"
            onClick={() => setEmailOpen(true)}
            className="flex min-h-12 w-full items-center justify-between gap-4 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4 sm:py-3.5"
          >
            <span className="shrink-0 text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink">
              Email
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[15px] text-ink-muted-80 sm:text-[17px]">
              {pendingEmail ? (
                <span className="truncate">
                  {email}
                  <span className="ml-1.5 text-[13px] text-primary">
                    (confirmation sent to {pendingEmail})
                  </span>
                </span>
              ) : (
                <span className="truncate">{email}</span>
              )}
              <ChevronRight
                className="size-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            </span>
          </button>
        </li>
        <li>
          <button
            type="button"
            onClick={() => setPasswordOpen(true)}
            className="flex min-h-12 w-full items-center justify-between gap-4 px-3 py-3 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:ring-inset sm:px-4 sm:py-3.5"
          >
            <span className="shrink-0 text-[17px] font-medium leading-snug tracking-[-0.2px] text-ink">
              Password
            </span>
            <span className="flex min-w-0 items-center gap-1 text-[15px] text-ink-muted-80 sm:text-[17px]">
              <span className="select-none tracking-[0.2em]">••••••••</span>
              <ChevronRight
                className="size-4 shrink-0 text-ink-muted-48"
                aria-hidden="true"
                strokeWidth={1.75}
              />
            </span>
          </button>
        </li>
      </ul>

      <Dialog
        open={emailOpen}
        onOpenChange={setEmailOpen}
        title="Change email"
      >
        <ChangeEmailForm onEmailChanged={() => setEmailOpen(false)} />
      </Dialog>

      <Dialog
        open={passwordOpen}
        onOpenChange={setPasswordOpen}
        title="Change password"
      >
        <ChangePasswordForm onPasswordChanged={() => setPasswordOpen(false)} />
      </Dialog>
    </>
  );
}