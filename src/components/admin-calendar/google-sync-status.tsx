import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getScheduleSyncStatus, kickScheduleSync, retryFailedScheduleSync } from "@/lib/schedule.functions";

function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.round(mins / 60);
  return h < 24 ? `${h} h ago` : new Date(iso).toLocaleDateString();
}

/** How the session -> Google mirror is doing, and a button to push now. */
export function GoogleSyncStatusCard() {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ["schedule-sync-status"],
    queryFn: () => getScheduleSyncStatus(),
    refetchInterval: 60_000,
  });

  const run = async (fn: () => Promise<any>) => {
    setBusy(true);
    try {
      const r = await fn();
      if (r?.skipped === "google_not_configured") toast.error("Google Calendar isn't connected.");
      else toast.success(`Synced: ${r?.created ?? 0} added, ${r?.updated ?? 0} updated, ${r?.removed ?? 0} removed${r?.failed ? `, ${r.failed} failed` : ""}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Sync failed");
    } finally {
      setBusy(false);
      qc.invalidateQueries({ queryKey: ["schedule-sync-status"] });
    }
  };

  return (
    <Card className="mb-4 space-y-3 border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-semibold">Session sync</div>
          <p className="mt-1 text-xs text-muted-foreground">
            Every 1:1 session you book, move or cancel in the app shows up on the calendar above within a few
            minutes (usually seconds). Before you book or move a session, the app checks that calendar and your
            main Google calendar so you can't double-book. Events marked "Free" and all-day events don't count.
          </p>
        </div>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => kickScheduleSync())}>
          <RefreshCw className={`mr-2 h-3 w-3 ${busy ? "animate-spin" : ""}`} /> Sync now
        </Button>
      </div>
      {data && (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-md border border-border bg-secondary/20 p-2">
            <div className="text-lg font-black tabular-nums">{data.upcomingSynced}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Upcoming in Google</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/20 p-2">
            <div className="text-lg font-black tabular-nums">{data.waiting}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Waiting</div>
          </div>
          <div className="rounded-md border border-border bg-secondary/20 p-2">
            <div className="text-sm font-bold">{ago(data.lastSyncedAt)}</div>
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Last sync</div>
          </div>
        </div>
      )}
      {!!data?.failing.length && (
        <div className="space-y-2 rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs">
          <div className="font-semibold text-destructive">{data.failing.length} session{data.failing.length === 1 ? "" : "s"} stopped syncing</div>
          {data.failing[0] && <div className="text-muted-foreground">Last error: {data.failing[0]}</div>}
          <Button size="sm" variant="outline" disabled={busy} onClick={() => run(() => retryFailedScheduleSync())}>Retry</Button>
        </div>
      )}
    </Card>
  );
}
