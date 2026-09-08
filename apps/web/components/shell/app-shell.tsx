import { NotificationsProvider } from "@/components/notifications/notifications-provider";
import { TopNavigation } from "@/components/shell/top-navigation";
import { shellContainerClassName } from "@/components/ui/shell-layout";
import { cn } from "@/lib/utils";

type AppShellProps = {
  accountLabel: string;
  userEmail: string;
  children: React.ReactNode;
};

export function AppShell({
  accountLabel,
  userEmail,
  children,
}: AppShellProps) {
  return (
    <NotificationsProvider>
      <div className="min-h-svh bg-canvas text-ink">
        <TopNavigation accountLabel={accountLabel} userEmail={userEmail} />

        <main
          id="main-content"
          tabIndex={-1}
          className={cn(shellContainerClassName, "py-5 sm:py-6 lg:py-8")}
        >
          {children}
        </main>
      </div>
    </NotificationsProvider>
  );
}
