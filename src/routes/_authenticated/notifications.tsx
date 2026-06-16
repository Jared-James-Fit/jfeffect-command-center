import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { NotificationPanel } from "@/components/notification-bell";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications" }] }),
  component: NotificationsPage,
});

function NotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center gap-2">
        <Button asChild variant="ghost" size="icon" className="h-8 w-8">
          <Link to="/">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <h1 className="text-xl font-semibold">Notifications</h1>
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        <NotificationPanel />
      </div>
    </div>
  );
}