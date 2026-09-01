import Link from "next/link";

const nav = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/courses", label: "Courses" },
  { href: "/tasks", label: "Tasks" },
  { href: "/calendar", label: "Calendar" },
  { href: "/notifications", label: "Notifications" },
  { href: "/settings", label: "Settings" },
] as const;

export default function DashboardShellLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="border-b border-hairline bg-canvas">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-4 px-6 py-4">
          <Link href="/" className="font-display text-sm font-semibold text-primary">
            Deadline Radar
          </Link>
          <nav className="flex flex-wrap gap-3 text-sm text-ink-muted-48">
            {nav.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      </header>
      <div className="mx-auto max-w-5xl px-6 py-8">{children}</div>
    </div>
  );
}
