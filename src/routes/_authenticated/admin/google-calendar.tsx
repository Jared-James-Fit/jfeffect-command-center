import { createFileRoute, redirect, useSearch } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
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
import { CheckCircle2, RefreshCw, AlertCircle } from "lucide-react";
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
  const { data: calendars } = useQuery({
    queryKey: ["gcal-calendars", status?.connected],
    queryFn: () => calsFn(),
    enabled: !!status?.connected,
  });

  useEffect(() => {
    if (search.connected) { toast.success("Google Calendar connected"); refetch(); }
    if (search.error) toast.error(`Google: ${search.error}`);
  }, [search.connected, search.error, refetch]);

  const choose = useMutation({
    mutationFn: (cal: { id: string; name: string }) => setCalFn({ data: { calendar_id: cal.id, calendar_name: cal.name } as any }),
    onSuccess: () => { toast.success("Calendar selected"); qc.invalidateQueries({ queryKey: ["gcal-status"] }); },
  });

  if (!status) return <div className="p-8">Loading…</div>;
  if (!status.isCoach) {
    return <div className="p-8 text-sm text-muted-foreground">Only coaches and admins can connect Google Calendar.</div>;
  }

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
                <Button size="sm" variant="outline" onClick={() => qc.invalidateQueries({ queryKey: ["gcal-calendars"] })}>
                  <RefreshCw className="mr-2 h-3 w-3" /> Refresh
                </Button>
              )}
            </div>
          </div>
        </Card>

        {status.connected && (
          <Card className="border-border bg-card p-5">
            <div className="font-semibold mb-2">Calendar used for sync</div>
            <Select
              value={status.calendarId || "primary"}
              onValueChange={(v) => {
                const cal = (calendars ?? []).find((c: any) => c.id === v);
                choose.mutate({ id: v, name: cal?.summary ?? v });
              }}
            >
              <SelectTrigger><SelectValue placeholder="Choose…" /></SelectTrigger>
              <SelectContent>
                {(calendars ?? []).map((c: any) => (
                  <SelectItem key={c.id} value={c.id}>{c.summary}{c.primary ? " (primary)" : ""}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">All new appointments will be created on the selected calendar.</p>
          </Card>
        )}
      </div>
    </>
  );
}