/**
 * "From Google Calendar" on a client's Sessions tab: the appointments in the
 * coach's Google Calendar that name this client and aren't in the app yet.
 * Importing puts them on the client's calendar and makes their credits follow
 * what was booked: past ones are done (a day already counted by hand hands
 * its credit over, never twice), upcoming ones hold a credit.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { DateField } from "@/components/ui/date-field";
import { todayLocalISO } from "@/lib/today";
import { addDaysISO, fmtWallClock } from "@/lib/schedule-time";
import { applyGoogleSessionImport, previewGoogleSessionImport } from "@/lib/gcal-session-import.functions";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00`);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-CA", { weekday: "short", month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

const SKIP_REASON: Record<string, string> = {
  cancelled: "Cancelled in its title",
  all_day: "All-day, no time",
  two_clients: "Names another client too",
};

export function GoogleImportDialog({ open, onOpenChange, clientId, clientName, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string | null;
  onDone: () => void;
}) {
  const previewFn = useServerFn(previewGoogleSessionImport);
  const applyFn = useServerFn(applyGoogleSessionImport);
  const [from, setFrom] = useState(() => addDaysISO(todayLocalISO(), -180));
  const [to, setTo] = useState(() => addDaysISO(todayLocalISO(), 60));
  const [off, setOff] = useState<Set<string>>(new Set());

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["gcal-import-preview", clientId, from, to],
    enabled: open,
    staleTime: 0,
    queryFn: () => previewFn({ data: { client_id: clientId, from, to } }),
  });
  useEffect(() => { if (open) setOff(new Set()); }, [open, from, to]);

  const rows = data?.candidates ?? [];
  const chosen = useMemo(() => rows.filter((r) => !off.has(r.eventId)), [rows, off]);
  const past = chosen.filter((r) => r.past);
  const handed = past.filter((r) => r.countedByHand).length;
  const upcoming = chosen.length - past.length;

  const run = useMutation({
    mutationFn: () => applyFn({ data: { client_id: clientId, from, to, event_ids: chosen.map((r) => r.eventId) } }),
    onSuccess: (r: any) => {
      const added = (r.created ?? 0) + (r.linked ?? 0);
      toast.success(`${plural(added, "session")} added from Google Calendar`, {
        description: r.errors?.length ? `${r.errors.length} couldn't be finished: ${r.errors[0]}` : undefined,
      });
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Import failed"),
  });

  const toggle = (id: string) => setOff((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const first = (clientName ?? "").split(" ")[0] || "this client";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>From Google Calendar</DialogTitle>
          <DialogDescription>
            Appointments in your Google Calendar that name {first} and aren't in the app yet. Past ones come in as done and use a credit
            (a day you already counted by hand keeps its one credit); upcoming ones come in booked and hold one. Your Google events stay as they are.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2">
          <div className="space-y-1"><Label>From</Label><DateField value={from} onChange={setFrom} max={to} /></div>
          <div className="space-y-1"><Label>To</Label><DateField value={to} onChange={setTo} min={from} /></div>
        </div>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {isFetching && <p className="py-6 text-center text-sm text-muted-foreground">Reading your Google Calendar…</p>}
          {!isFetching && error && (
            <div className="space-y-2 py-4 text-center">
              <p className="text-sm text-destructive">{(error as any)?.message ?? "Couldn't read Google Calendar"}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
            </div>
          )}
          {!isFetching && data && rows.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              Nothing to import: every appointment naming {first} in these dates is already in the app{data.alreadyInApp ? ` (${data.alreadyInApp})` : ""}.
            </p>
          )}
          {!isFetching && rows.length > 0 && (
            <ul className="divide-y divide-border rounded-lg border border-border">
              {rows.map((r) => (
                <li key={r.eventId}>
                  <label className="flex cursor-pointer items-start gap-3 px-3 py-2.5">
                    <Checkbox className="mt-0.5" checked={!off.has(r.eventId)} onCheckedChange={() => toggle(r.eventId)} />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{dayLabel(r.date)} · {fmtWallClock(r.start)}</span>
                      <span className="block truncate text-xs text-muted-foreground">{r.summary}</span>
                    </span>
                    <span className={`shrink-0 text-right text-[11px] ${r.past ? "text-muted-foreground" : "text-primary"}`}>
                      {r.past ? (r.countedByHand ? "Done · counted by hand" : "Done · uses a credit") : "Booked · holds a credit"}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          )}
          {!isFetching && (data?.skipped?.length ?? 0) > 0 && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">{plural(data!.skipped.length, "appointment")} left out</summary>
              <ul className="mt-1 space-y-0.5">
                {data!.skipped.map((s) => <li key={s.eventId}>{dayLabel(s.date)} · {s.summary} ({SKIP_REASON[s.reason] ?? s.reason})</li>)}
              </ul>
            </details>
          )}
          {!isFetching && (data?.handCountedOnly?.length ?? 0) > 0 && (
            <p className="rounded-md border border-border bg-secondary/20 p-2 text-xs text-muted-foreground">
              Counted by hand with no Google appointment: {data!.handCountedOnly.map(dayLabel).join(", ")}. Those credits stay as they are.
            </p>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {chosen.length > 0 && (
            <p className="text-xs text-muted-foreground">
              {plural(past.length, "done session")} ({handed} already counted by hand, {past.length - handed} new credit{past.length - handed === 1 ? "" : "s"} used) · {plural(upcoming, "booked session")}
            </p>
          )}
          <Button className="h-11 w-full" disabled={chosen.length === 0 || isFetching || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Importing…" : chosen.length ? `Import ${plural(chosen.length, "session")}` : "Nothing to import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
