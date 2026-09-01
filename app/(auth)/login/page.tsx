import Link from "next/link";

import { LoginForm } from "@/components/auth/auth-forms";

export default function LoginPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6">
      <div className="space-y-2">
        <p className="font-display text-sm font-semibold text-primary">
          Deadline Radar
        </p>
        <h1 className="font-display text-3xl font-semibold text-ink">
          Sign in
        </h1>
        <p className="text-ink-muted-48">
          Access your courses, tasks, and deadline reminders.
        </p>
      </div>
      <LoginForm />
      <Link href="/" className="text-sm text-primary hover:underline">
        Back home
      </Link>
    </main>
  );
}
