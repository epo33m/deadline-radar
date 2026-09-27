import { RegisterForm } from "@/components/auth/auth-forms";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

// SEC-002: see (auth)/login/page.tsx — interactive auth forms stay dynamic;
// hash-CSP is only safe for pages with zero request-time dynamic boundaries.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <AuthPageShell title="Create account">
      <RegisterForm />
    </AuthPageShell>
  );
}
