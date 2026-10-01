import { ForgotPasswordForm } from "@/components/auth/auth-forms";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

// SEC-002: see (auth)/login/page.tsx — interactive auth forms stay dynamic;
// hash-CSP is only safe for pages with zero request-time dynamic boundaries.
export const dynamic = "force-dynamic";

export default function ForgotPasswordPage() {
  return (
    <AuthPageShell
      title="Recover Your account"
      subtitle="We’ll send you a link to get back in."
    >
      <ForgotPasswordForm />
    </AuthPageShell>
  );
}
