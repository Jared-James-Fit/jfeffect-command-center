import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationPanel } from "@/components/notification-bell";
import { NOTIFICATIONS_PAGE_SHELL_CLASS } from "@/lib/notifications-page-layout";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications" },
      { name: "description", content: "Your JF Effect notification center — messages, lift videos, agreements, appointments, and check-in reviews in one place." },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <div className={NOTIFICATIONS_PAGE_SHELL_CLASS}>
      <header className="mb-3 flex min-w-0 items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-10 w-10 shrink-0 rounded-full" aria-label="Back">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="min-w-0 truncate text-lg font-semibold tracking-tight sm:text-xl">Notifications</h1>
      </header>

      <div className="min-w-0 flex-1 overflow-visible rounded-xl border bg-card shadow-sm">
        <NotificationPanel fullPage />
      </div>
    </div>
  );
}
