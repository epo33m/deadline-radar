import { ArrowUpRight } from "lucide-react";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/auth-forms";
import { AuthFooterLink, AuthPageShell } from "@/components/auth/auth-page-shell";

// SEC-002: strict nonce CSP needs dynamic rendering. The form reads
// useSearchParams inside Suspense: statically prerendered, the boundary
// bails to an empty fallback and the streamed flight chunks that carry the
// form have no build-time hash — hash-CSP would block them and the form
// would never appear. Dynamic + nonce is the only correct mode here.
export const dynamic = "force-dynamic";

export default function LoginPage() {
  return (
    <AuthPageShell
      title="Sign in"
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
