import { ArrowUpRight } from "lucide-react";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/auth-forms";
import { AuthFooterLink, AuthPageShell } from "@/components/auth/auth-page-shell";

// SEC-002: see app/page.tsx — strict nonce CSP needs dynamic rendering.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthPageShell
      title="Sign in to Your account"
      footer={
        <>
          <AuthFooterLink href="/register">Create an account</AuthFooterLink>
          <AuthFooterLink href="/forgot-password" icon={ArrowUpRight}>
            Forgot email or password
          </AuthFooterLink>
        </>
      }
    >
      <Suspense>
        <LoginForm />
      </Suspense>
    </AuthPageShell>
  );
}
