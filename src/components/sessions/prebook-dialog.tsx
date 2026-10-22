/**
 * "Book the rest" on a client's Sessions tab: the sessions they still have
 * credits for, on the days and times they've been training lately, after
 * their last booking. Days already in the coach's Google Calendar are linked,
 * the rest are added; holidays are skipped. See session-prebook.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { fmtWallClock, minutesBetweenHM } from "@/lib/schedule-time";
import { shortDay } from "@/lib/session-credit";
import { patternDays } from "@/lib/session-prebook";
import { applySessionPrebook, previewSessionPrebook } from "@/lib/session-prebook.functions";
import { kickGoogleSync } from "@/components/schedule/session-actions-sheet";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

function lengthLabel(start: string, end: string): string {
  const m = minutesBetweenHM(start, end);
  return m % 60 === 0 ? `${m / 60} hr` : `${m} min`;
}

export function PrebookDialog({ open, onOpenChange, clientId, clientName, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clientId: string;
  clientName?: string | null;
  onDone: () => void;
}) {
  const previewFn = useServerFn(previewSessionPrebook);
  const applyFn = useServerFn(applySessionPrebook);
  const [off, setOff] = useState<Set<string>>(new Set());
  const first = (clientName ?? "").split(" ")[0] || "this client";

  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["session-prebook", clientId],
    enabled: open,
    staleTime: 0,
    queryFn: () => previewFn({ data: { client_id: clientId } }),
  });
  useEffect(() => {
    if (open) setOff(new Set());
  }, [open, data]);

  const slots = data?.slots ?? [];
  const chosen = useMemo(() => slots.filter((s) => !off.has(s.date)), [slots, off]);
  const inGoogle = chosen.filter((s) => s.google).length;

  const run = useMutation({
    mutationFn: () => applyFn({ data: { client_id: clientId, dates: chosen.map((s) => s.date) } }),
    onSuccess: (r: any) => {
      toast.success(`${plural(r.booked ?? 0, "session")} booked for ${first}`, {
        description: r.errors?.length ? `${r.errors.length} couldn't be finished: ${r.errors[0]}` : chosen.length ? `Through ${shortDay(chosen[chosen.length - 1].date)}` : undefined,
      });
      kickGoogleSync();
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't book them"),
  });

  const toggle = (date: string) => setOff((s) => { const n = new Set(s); n.has(date) ? n.delete(date) : n.add(date); return n; });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] max-w-lg flex-col">
        <DialogHeader>
          <DialogTitle>Book the rest</DialogTitle>
          <DialogDescription>
            {data
              ? data.available
                ? `${first} has ${plural(data.available, "session")} left to book. These follow ${first}'s usual days and times, after ${data.bookedThrough ? shortDay(data.bookedThrough) : "today"}.`
                : `Every session ${first} has is booked.`
              : `${first}'s sessions left to book, on their usual days and times.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto">
          {isFetching && <p className="py-6 text-center text-sm text-muted-foreground">Working out {first}'s schedule…</p>}
          {!isFetching && error && (
            <div className="space-y-2 py-4 text-center">
              <p className="text-sm text-destructive">{(error as any)?.message ?? "Couldn't work it out"}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
            </div>
          )}
          {!isFetching && data && data.available > 0 && data.pattern.length === 0 && (
            <p className="py-6 text-center text-sm text-muted-foreground">
              No regular days to follow yet. Book a few weeks of sessions first, then this fills in the rest.
            </p>
          )}
          {!isFetching && data && data.pattern.length > 0 && slots.length > 0 && (
            <>
              <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2 text-sm">
                <span className="font-semibold">{patternDays(data.pattern)}</span>
                <span className="text-muted-foreground">
                  {" · "}
                  {Array.from(new Set(data.pattern.map((p) => fmtWallClock(p.start)))).join(" / ")}
                  {" · "}
                  {lengthLabel(data.pattern[0].start, data.pattern[0].end)}
                  {data.pattern[0].location ? ` · ${data.pattern[0].location.split(",")[0]}` : ""}
                </span>
              </div>
              <ul className="divide-y divide-border rounded-lg border border-border">
                {slots.map((s) => (
                  <li key={s.date}>
                    <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5">
                      <Checkbox checked={!off.has(s.date)} onCheckedChange={() => toggle(s.date)} />
                      <span className="min-w-0 flex-1 whitespace-nowrap text-sm font-medium">{shortDay(s.date)} · {fmtWallClock(s.start)}</span>
                      <span className={`shrink-0 text-[11px] ${s.google ? "text-muted-foreground" : "text-primary"}`}>
                        {s.google ? "In your Google" : "New"}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          {!isFetching && (data?.skipped?.length ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground">
              Skipped: {data!.skipped.map((h) => `${shortDay(h.date)} (${h.reason})`).join(", ")}. Book one anyway with Book Session.
            </p>
          )}
          {!isFetching && data?.googleNote && <p className="text-xs text-warning">{data.googleNote}</p>}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {chosen.length > 0 && (
            <p className="text-xs text-muted-foreground">
              Each holds 1 credit and counts as used once its day is over. {inGoogle > 0 ? `${inGoogle} already in your Google Calendar, ` : ""}{chosen.length - inGoogle} added to it.
            </p>
          )}
          <Button className="h-11 w-full" disabled={chosen.length === 0 || isFetching || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Booking…" : chosen.length ? `Book ${plural(chosen.length, "session")}` : "Nothing to book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
