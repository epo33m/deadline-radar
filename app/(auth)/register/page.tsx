import { RegisterForm } from "@/components/auth/auth-forms";
import { AuthPageShell } from "@/components/auth/auth-page-shell";

export default function RegisterPage() {
  return (
    <AuthPageShell title="Create account">
      <RegisterForm />
    </AuthPageShell>
  );
}
