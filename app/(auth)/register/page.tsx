import Link from "next/link";

export default function RegisterPage() {
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-4 px-6">
      <h1 className="font-display text-3xl font-semibold text-ink">Register</h1>
      <p className="text-ink-muted-48">
        Placeholder for auth (issue #4). Account creation will land here.
      </p>
      <Link href="/" className="text-primary underline-offset-4 hover:underline">
        Back home
      </Link>
    </main>
  );
}
