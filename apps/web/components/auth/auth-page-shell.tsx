import Link from "next/link";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { BrandLogo } from "@/components/brand/logo";
import { LandingFooter } from "@/components/landing/landing-footer";

const authLinkClassName =
  "text-sm leading-[1.43] tracking-[-0.224px] text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus";

type AuthPageShellProps = {
  title: string;
  subtitle?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
};

export function AuthPageShell({
  title,
  subtitle,
  footer,
  children,
}: AuthPageShellProps) {
  return (
    <div className="flex min-h-svh flex-col justify-between bg-canvas-parchment font-sans text-ink">
      <main className="relative flex flex-1 items-center justify-center px-6 py-16 text-center sm:px-8 sm:py-20">
        <Link
          href="/"
          className="absolute top-4 left-4 inline-flex items-center rounded-sm font-sans text-[17px] font-semibold leading-tight tracking-[-0.374px] text-ink transition-opacity [@media(hover:hover)]:hover:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus sm:top-6 sm:left-6"
        >
          Deadline&nbsp;<span className="text-primary">Radar</span>
        </Link>

        <div className="flex w-full max-w-[400px] flex-col items-center">
          <div className="flex w-full flex-col items-center">
            <div className="relative mb-5 flex size-[68px] items-center justify-center rounded-[20px] border border-hairline bg-white sm:mb-6 sm:size-[76px] sm:rounded-[22px]">
              <BrandLogo size={40} className="text-ink" strokeWidth={1.85} />
            </div>
            <h1 className="font-display text-[28px] font-semibold leading-[1.14] tracking-[-0.28px] text-balance text-ink sm:text-[34px]">
              {title}
            </h1>
            {subtitle ? (
              <div className="mt-2.5 text-[16px] leading-[1.4] tracking-[-0.25px] text-ink sm:text-[17px]">
                {subtitle}
              </div>
            ) : null}
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

      <LandingFooter />
    </div>
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
