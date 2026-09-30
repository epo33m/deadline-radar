import Link from "next/link";
import { RegisterForm } from "@/components/auth/auth-forms";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

// SEC-002: see app/page.tsx — strict nonce CSP needs dynamic rendering.
export const dynamic = "force-dynamic";

export default function RegisterPage() {
  return (
    <AuthPageShell
      title="Create Your account"
      subtitle={
        <p>
          Already have an account?{" "}
          <Link
            href="/login"
            className="text-primary hover:underline focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-focus"
          >
            Sign in
          </Link>
        </p>
      }
    >
      <RegisterForm />
    </AuthPageShell>
  );
}
