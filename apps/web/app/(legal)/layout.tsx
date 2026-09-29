import type { ReactNode } from "react";

import { LandingFooter } from "@/components/landing/landing-footer";
import { LandingNav } from "@/components/landing/landing-nav";

// SEC-002: see app/page.tsx — strict nonce CSP needs dynamic rendering.
export const dynamic = "force-dynamic";

/**
 * Chrome for the public legal surface (`/privacy`, `/terms`).
 *
 * The route group keeps the URLs flat while sharing the same `LandingNav` +
 * `LandingFooter` sandwich the marketing pages use. `/privacy` and `/terms` are
 * the only legal targets the footer links to, so this group exists to give them
 * one layout instead of two copies of it.
 */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-canvas-parchment font-sans text-ink">
      <LandingNav />

      <main id="main-content" tabIndex={-1} className="flex-1">
        {children}
      </main>

      <LandingFooter />
    </div>
  );
}
