import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

const authLinkClassName =
  "text-sm leading-[1.43] tracking-[-0.224px] text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus";

type AuthPageShellProps = {
  title: string;
  footer?: ReactNode;
  children: ReactNode;
};

export function AuthPageShell({
  title,
  footer,
  children,
}: AuthPageShellProps) {
  return (
    <main className="relative flex min-h-screen items-center justify-center bg-canvas-parchment px-6 text-center font-sans text-ink sm:px-8">
      <Link
        href="/"
        className="absolute top-6 left-6 text-sm leading-[1.43] tracking-[-0.224px] text-ink-muted-48 no-underline transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus sm:left-8"
      >
        ← Back to home
      </Link>

      <div className="flex w-full max-w-[400px] flex-col items-center">
        <div className="flex min-h-[4.75rem] w-full flex-col items-center justify-end sm:min-h-[5.75rem]">
          <h1 className="font-display text-[36px] font-semibold leading-[1.07] tracking-[-0.28px] text-ink sm:text-[44px]">
            {title}
          </h1>
        </div>

        <div className="mt-6 flex min-h-[17rem] w-full flex-col">
          <div className="w-full">{children}</div>

          {footer ? (
            <div className="mt-auto flex w-full flex-col items-center gap-3 pt-8 text-sm leading-[1.43] tracking-[-0.224px] text-ink-muted-48">
              {footer}
            </div>
          ) : null}
        </div>
      </div>
    </main>
  );
}

export function AuthFooterLink({
  href,
  children,
  icon: Icon,
}: {
  href: string;
  children: ReactNode;
  icon?: LucideIcon;
}) {
  return (
    <Link
      href={href}
      className={`inline-flex items-center gap-1 ${authLinkClassName}`}
    >
      {children}
      {Icon ? <Icon className="size-3.5" aria-hidden="true" /> : null}
    </Link>
  );
}
