import { ArrowUpRight } from "lucide-react";
import { Suspense } from "react";

import { LoginForm } from "@/components/auth/auth-forms";
import { AuthFooterLink, AuthPageShell } from "@/components/auth/auth-page-shell";

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
