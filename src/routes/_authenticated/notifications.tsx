import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, CheckCheck, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  useNotificationFeed,
  NotificationPanel,
  markItem,
  markAllRead,
  type BellItem,
} from "@/components/notification-bell";

export const Route = createFileRoute("/_authenticated/notifications")({
  head: () => ({ meta: [{ title: "Notifications" }] }),
  component: NotificationsPage,
});

const PAGE_SIZE = 20;

function NotificationsPage() {
  const { query, role, user } = useNotificationFeed();
  const qc = useQueryClient();
  const data = query.data;
  const all: BellItem[] = useMemo(() => data?.items ?? [], [data]);
  const count = data?.count ?? 0;

  const [limit, setLimit] = useState(PAGE_SIZE);
  const visible = useMemo(() => all.slice(0, limit), [all, limit]);
  const hasMore = all.length > limit;

  const [marking, setMarking] = useState(false);

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6">
      <div className="mb-4 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Button asChild variant="ghost" size="icon" className="h-8 w-8">
            <Link to="/">
              <ArrowLeft className="h-4 w-4" />
            </Link>
          </Button>
          <div>
            <h1 className="text-xl font-semibold">Notifications</h1>
            <p className="text-xs text-muted-foreground">
              {count > 0 ? `${count} unread` : "All caught up"}
            </p>
          </div>
        </div>
        {count > 0 && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            disabled={marking}
            onClick={async () => {
              setMarking(true);
              try {
                await markAllRead(all, role, user?.id);
                qc.invalidateQueries({ queryKey: ["unread-counts"] });
              } finally {
                setMarking(false);
              }
            }}
          >
            {marking ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
            Mark all read
          </Button>
        )}
      </div>

      <div className="overflow-hidden rounded-lg border bg-card">
        {query.isLoading ? (
          <div className="flex items-center justify-center px-6 py-16">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : query.isError ? (
          <div className="px-6 py-16 text-center">
            <p className="text-sm font-medium">Couldn't load notifications</p>
            <Button variant="link" size="sm" onClick={() => query.refetch()}>Try again</Button>
          </div>
        ) : (
          <NotificationPanel
            items={visible}
            role={role}
            count={count}
            onItemClick={(it) => { markItem(it, role); qc.invalidateQueries({ queryKey: ["unread-counts"] }); }}
            onMarkAllRead={async () => {
              await markAllRead(all, role, user?.id);
              qc.invalidateQueries({ queryKey: ["unread-counts"] });
            }}
            onViewAll={() => {}}
          />
        )}
      </div>

      {hasMore && (
        <div className="mt-3 flex justify-center">
          <Button variant="ghost" size="sm" onClick={() => setLimit((n) => n + PAGE_SIZE)}>
            Show more
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
              {all.length - limit}
            </Badge>
          </Button>
        </div>
      )}
    </div>
  );
}