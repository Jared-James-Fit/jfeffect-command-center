import { createFileRoute, redirect, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import {
  getGoogleConnectionStatus, listMyCalendars, setSelectedCalendar,
} from "@/lib/google-cal.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, RefreshCw, AlertCircle, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/admin/google-calendar")({
  validateSearch: z.object({ connected: z.string().optional(), error: z.string().optional() }).parse,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/admin/calendar",
      search: { tab: "google-calendar", connected: search.connected, error: search.error } as any,
    });
  },
});

export function GoogleCalendarPage() {
  const search = useSearch({ strict: false }) as { connected?: string; error?: string };
  const qc = useQueryClient();
  const statusFn = useServerFn(getGoogleConnectionStatus);
  const calsFn = useServerFn(listMyCalendars);
  const setCalFn = useServerFn(setSelectedCalendar);

  const { data: status, refetch } = useQuery({ queryKey: ["gcal-status"], queryFn: () => statusFn() });
  const { data: calendars, isLoading: calsLoading, isError: calsError, isFetching: calsFetching } = useQuery({
    queryKey: ["gcal-calendars", status?.connected],
    queryFn: () => calsFn(),
    enabled: !!status?.connected,
  });

  // Optimistic override so the picked calendar displays immediately,
  // before the status refetch round-trips.
  const [pickedId, setPickedId] = useState<string | null>(null);

  const savedId: string | null = status?.calendarId ?? null;
  const effectiveId = pickedId ?? savedId ?? "";

  // Drop the optimistic override once the saved value catches up.
  useEffect(() => {
    if (pickedId && savedId === pickedId) setPickedId(null);
  }, [pickedId, savedId]);

  useEffect(() => {
    if (search.connected) { toast.success("Google Calendar connected"); refetch(); }
    if (search.error) toast.error(`Google: ${search.error}`);
  }, [search.connected, search.error, refetch]);

  const choose = useMutation({
    mutationFn: (cal: { id: string; name: string }) => setCalFn({ data: { calendar_id: cal.id, calendar_name: cal.name } as any }),
    onSuccess: (_d, vars) => {
      // Seed the status cache so the selection stays visible instantly,
      // then refetch to confirm the server value.
      qc.setQueryData(["gcal-status"], (prev: any) =>
        prev ? { ...prev, calendarId: vars.id, calendarName: vars.name } : prev,
      );
      toast.success("Calendar sync target updated");
      qc.invalidateQueries({ queryKey: ["gcal-status"] });
    },
    onError: (e: any) => {
      setPickedId(null);
      toast.error(e?.message ?? "Could not save calendar selection");
    },
  });

  if (!status) return <div className="p-8">Loading…</div>;
  if (!status.isCoach) {
    return <div className="p-8 text-sm text-muted-foreground">Only coaches and admins can connect Google Calendar.</div>;
  }

  const list: Array<{ id: string; summary: string; primary?: boolean }> = calendars ?? [];
  const matched = effectiveId ? list.find((c) => c.id === effectiveId) : undefined;
  const listResolved = !calsLoading && !calsFetching && !calsError && calendars !== undefined;
  // Saved/picked calendar is confirmed absent from the Google account's list.
  const savedMissing = !!effectiveId && listResolved && !matched;
  const selectedLabel = matched
    ? `${matched.summary}${matched.primary ? " (primary)" : ""}`
    : !listResolved
      ? "Loading selected calendar…"
      : `${status?.calendarName ?? "Selected calendar"} (no longer available)`;

  const refreshAll = () => {
    qc.invalidateQueries({ queryKey: ["gcal-status"] });
    qc.invalidateQueries({ queryKey: ["gcal-calendars"] });
  };

  return (
    <>
      <PageHeader title="Google Calendar" subtitle="Connect your calendar to sync appointments and Meet links." />
      <div className="p-6 md:p-8 space-y-4 max-w-3xl">
        <Card className="border-border bg-card p-5">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                {status.connected ? (
                  <Badge className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 border"><CheckCircle2 className="mr-1 h-3 w-3" /> Connected (workspace)</Badge>
                ) : (
                  <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/30 border"><AlertCircle className="mr-1 h-3 w-3" /> Not configured</Badge>
                )}
                {status.email && <span className="text-sm text-muted-foreground">{status.email}</span>}
              </div>
              {status.calendarName && <div className="text-xs text-muted-foreground">Calendar: {status.calendarName}</div>}
              {!status.connected && (
                <div className="text-xs text-muted-foreground mt-1">
                  Connect the Google Calendar app in Project Settings → Connectors. All coaches share this calendar.
                </div>
              )}
            </div>
            <div className="flex gap-2">
              {status.connected && (
                <Button size="sm" variant="outline" onClick={refreshAll} disabled={calsFetching}>
                  <RefreshCw className={`mr-2 h-3 w-3 ${calsFetching ? "animate-spin" : ""}`} /> Refresh
                </Button>
              )}
            </div>
          </div>
        </Card>

        {status.connected && (
          <Card className="border-border bg-card p-5">
            <div className="font-semibold mb-2">Calendar used for sync</div>
            <Select
              value={effectiveId}
              disabled={choose.isPending}
              onValueChange={(v) => {
                const cal = list.find((c) => c.id === v);
                if (!cal) return; // the fallback item is display-only
                setPickedId(v);
                choose.mutate({ id: v, name: cal.summary ?? v });
              }}
            >
              <SelectTrigger className={savedMissing ? "border-amber-500/50" : ""}>
                <SelectValue placeholder="Choose calendar" />
              </SelectTrigger>
              <SelectContent>
                {list.map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.summary}{c.primary ? " (primary)" : ""}</SelectItem>
                ))}
                {effectiveId && !matched && (
                  // Keeps the trigger readable while the list loads, or shows the
                  // stale saved selection instead of going silently blank.
                  <SelectItem value={effectiveId}>{selectedLabel}</SelectItem>
                )}
              </SelectContent>
            </Select>
            {savedMissing && (
              <p className="text-xs text-amber-300 mt-2 flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" /> Selected calendar no longer available. Choose another calendar.
              </p>
            )}
            {!effectiveId && (
              <p className="text-xs text-muted-foreground mt-2">Using primary calendar by default.</p>
            )}
            <p className="text-xs text-muted-foreground mt-2">All new appointments will be created on the selected calendar.</p>
          </Card>
        )}
      </div>
    </>
  );
}