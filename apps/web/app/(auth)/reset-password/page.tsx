import { redirect } from "next/navigation";

import { ResetPasswordForm } from "@/components/auth/auth-forms";
import { AuthPageShell } from "@/components/auth/auth-page-shell";
import { getSession } from "@/lib/api/session";

export default async function ResetPasswordPage() {
  const session = await getSession();
  if (!session.authenticated) {
    redirect("/forgot-password");
  }

  return (
    <AuthPageShell title="New password">
      <ResetPasswordForm />
    </AuthPageShell>
  );
}
