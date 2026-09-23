import { RegisterForm } from "@/components/auth/auth-forms";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

// SEC-002: see app/page.tsx — strict nonce CSP needs dynamic rendering.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <AuthPageShell title="Create account">
      <RegisterForm />
    </AuthPageShell>
  );
}
