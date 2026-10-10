import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";
import { CalendarCheck2, CalendarX2, Copy, Link2, Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getClientCalendarSyncStatus, getClientFeedLink } from "@/lib/schedule.functions";
import { timeAgo } from "@/lib/calendar-sync";

async function copy(text: string, msg: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(msg);
  } catch {
    window.prompt("Copy this link:", text);
  }
}

/** Admin client overview: is this client's calendar syncing, and links to help them. */
export function ClientCalendarSyncStatus({ clientId }: { clientId: string }) {
  const statusFn = useServerFn(getClientCalendarSyncStatus);
  const feedFn = useServerFn(getClientFeedLink);
  const [copyingFeed, setCopyingFeed] = useState(false);
  const { data, isLoading, isError } = useQuery({
    queryKey: ["client-calendar-sync-status", clientId],
    queryFn: () => statusFn({ data: { clientId } }),
    staleTime: 60_000,
  });

  const g = data?.google;
  let tone: "ok" | "warn" | "off" = "off";
  let line = "Not set up";
  if (isLoading) line = "Checking…";
  else if (isError) line = "Couldn't load calendar sync status";
  else if (g?.revoked) {
    tone = "warn";
    line = `Google Calendar needs reconnect${g.email ? ` · ${g.email}` : ""}`;
  } else if (g?.connected && g.error) {
    tone = "warn";
    line = `Google Calendar connected${g.email ? ` · ${g.email}` : ""} · error: ${g.error}`;
  } else if (g?.connected) {
    tone = "ok";
    line = `Google Calendar connected${g.email ? ` · ${g.email}` : ""} · last synced ${g.lastSyncedAt ? timeAgo(g.lastSyncedAt) : "not yet"}`;
  } else if (data?.feed?.lastFetchAt) {
    tone = "ok";
    line = `Calendar feed subscribed (${data.feed.app ?? "calendar app"}) · last fetched ${timeAgo(data.feed.lastFetchAt)}`;
  }

  const copyFeed = async () => {
    setCopyingFeed(true);
    try {
      const { url } = await feedFn({ data: { clientId } });
      await copy(url, "Client's feed link copied.");
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't get the feed link.");
    } finally {
      setCopyingFeed(false);
    }
  };

  return (
    <Card className="flex flex-col gap-3 border-border bg-card p-4 sm:flex-row sm:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span
          className={
            "grid h-9 w-9 shrink-0 place-items-center rounded-full " +
            (tone === "ok" ? "bg-emerald-500/15 text-emerald-500" : tone === "warn" ? "bg-amber-500/15 text-amber-500" : "bg-muted text-muted-foreground")
          }
        >
          {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : tone === "off" ? <CalendarX2 className="h-4 w-4" /> : <CalendarCheck2 className="h-4 w-4" />}
        </span>
        <div className="min-w-0">
          <div className="text-sm font-semibold">Calendar sync</div>
          <div className="break-words text-xs leading-snug text-muted-foreground">{line}</div>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          className="h-9"
          onClick={() => copy(`${window.location.origin}/portal/calendar?sync=1`, "Setup link copied. Send it to the client.")}
        >
          <Link2 className="mr-1.5 h-3.5 w-3.5" /> Copy setup link
        </Button>
        {data?.hasFeedToken && (
          <Button size="sm" variant="ghost" className="h-9" disabled={copyingFeed} onClick={copyFeed}>
            <Copy className="mr-1.5 h-3.5 w-3.5" /> Copy client's feed link
          </Button>
        )}
      </div>
    </Card>
  );
}
