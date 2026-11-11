/**
 * "Book ahead" on a client's Sessions tab: their next sessions on the days
 * and times they've trained on lately (read from their last package's worth
 * of sessions), after their last booking. The coach can change the days, the
 * times and how many before booking; past what's left on their packages the
 * sessions go on the next package (a renewal paid later). Days already in the
 * coach's Google Calendar are linked, the rest are added; holidays are skipped,
 * and a time that clashes with another booking starts unticked.
 * See session-prebook.ts.
 */
import { useEffect, useMemo, useState } from "react";
import { keepPreviousData, useMutation, useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { DEFAULT_TZ, addMinutesHM, fmtWallClock, minutesBetweenHM } from "@/lib/schedule-time";
import { shortDay } from "@/lib/session-credit";
import { prebookCountNote, type PatternOverride } from "@/lib/session-prebook";
import { applySessionPrebook, previewSessionPrebook } from "@/lib/session-prebook.functions";
import { kickGoogleSync } from "@/components/schedule/session-actions-sheet";
import { useConflictCheck } from "@/components/schedule/use-conflict-check";
import { dayRange } from "@/lib/session-packages";
import { cn } from "@/lib/utils";

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
/** Monday first, the way a training week reads. */
const WEEK: Array<{ weekday: number; letter: string; name: string }> = [
  { weekday: 1, letter: "M", name: "Mon" },
  { weekday: 2, letter: "T", name: "Tue" },
  { weekday: 3, letter: "W", name: "Wed" },
  { weekday: 4, letter: "T", name: "Thu" },
  { weekday: 5, letter: "F", name: "Fri" },
  { weekday: 6, letter: "S", name: "Sat" },
  { weekday: 0, letter: "S", name: "Sun" },
];
const order = (w: number) => (w + 6) % 7;

function lengthLabel(start: string, end: string): string {
  const m = minutesBetweenHM(start, end);
  return m % 60 === 0 ? `${m / 60} hr` : `${m} min`;
}

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
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
  const first = (clientName ?? "").split(" ")[0] || "this client";
  // null = their usual days and the default count.
  const [days, setDays] = useState<PatternOverride | null>(null);
  const [countDraft, setCountDraft] = useState<number | null>(null);
  const [off, setOff] = useState<Set<string>>(new Set());
  const [touched, setTouched] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!open) return;
    setDays(null);
    setCountDraft(null);
    setOff(new Set());
    setTouched(new Set());
  }, [open]);

  // Typing a time or tapping + several times asks once, after the last change.
  const wantKey = JSON.stringify({ days, count: countDraft });
  const askKey = useDebounced(wantKey, 350);
  const ask = useMemo(() => JSON.parse(askKey) as { days: PatternOverride | null; count: number | null }, [askKey]);
  const { data, isFetching, error, refetch } = useQuery({
    queryKey: ["session-prebook", clientId, askKey],
    enabled: open && !(ask.days && ask.days.length === 0),
    staleTime: 0,
    placeholderData: keepPreviousData,
    queryFn: () => previewFn({ data: { client_id: clientId, count: ask.count, pattern: ask.days } }),
  });

  const shownDays: PatternOverride = days ?? (data?.pattern ?? []).map((p) => ({ weekday: p.weekday, start: p.start, end: p.end }));
  const count = countDraft ?? data?.count ?? 0;
  const slots = useMemo(() => data?.slots ?? [], [data]);
  const chosen = useMemo(() => slots.filter((s) => !off.has(s.date)), [slots, off]);
  const inGoogle = chosen.filter((s) => s.google).length;
  const loading = isFetching && !data;
  const stale = isFetching || askKey !== wantKey;

  // Double-booking: other clients, appointments and the coach's Google (not the appointment being linked).
  const conflictCheck = useConflictCheck({
    slots: slots.map((s) => ({ key: s.date, date: s.date, start: s.start, end: s.end })),
    timezone: slots[0]?.timezone || DEFAULT_TZ,
    enabled: open && slots.length > 0,
  });
  const clashes = useMemo(() => {
    const out = new Map<string, string>();
    for (const c of conflictCheck.conflicts) {
      const slot = slots.find((s) => s.date === c.key);
      const items = c.items.filter((i) => !(slot?.google && i.source === "google" && (i.id === slot.google.eventId || i.title === slot.google.summary)));
      if (items.length) out.set(c.key, items[0].title);
    }
    return out;
  }, [conflictCheck.conflicts, slots]);
  useEffect(() => {
    if (!clashes.size) return;
    setOff((prev) => {
      const next = new Set(prev);
      for (const date of clashes.keys()) if (!touched.has(date)) next.add(date);
      return next;
    });
  }, [clashes, touched]);

  const run = useMutation({
    mutationFn: () => applyFn({ data: { client_id: clientId, count: data?.count ?? null, pattern: days, dates: chosen.map((s) => s.date) } }),
    onSuccess: (r: any) => {
      toast.success(`${plural(r.booked ?? 0, "session")} booked for ${first}`, {
        description: r.errors?.length ? `${r.errors.length} couldn't be booked: ${r.errors[0]}` : chosen.length ? `Through ${shortDay(chosen[chosen.length - 1].date)}` : undefined,
      });
      kickGoogleSync();
      onOpenChange(false);
      onDone();
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't book them"),
  });

  const toggleDate = (date: string) => {
    setTouched((t) => new Set(t).add(date));
    setOff((s) => {
      const n = new Set(s);
      if (n.has(date)) n.delete(date);
      else n.add(date);
      return n;
    });
  };
  const toggleDay = (weekday: number) => {
    const base = shownDays;
    if (base.some((d) => d.weekday === weekday)) {
      setDays(base.filter((d) => d.weekday !== weekday));
      return;
    }
    // A new day starts at their most common time and length.
    const like = base[0];
    const start = like?.start ?? "17:00";
    const len = like ? minutesBetweenHM(like.start, like.end) : 60;
    setDays([...base, { weekday, start, end: addMinutesHM(start, len) }].sort((a, b) => order(a.weekday) - order(b.weekday)));
  };
  const setTime = (weekday: number, start: string) => {
    if (!/^\d{2}:\d{2}$/.test(start)) return;
    setDays(shownDays.map((d) => (d.weekday === weekday ? { ...d, start, end: addMinutesHM(start, minutesBetweenHM(d.start, d.end) || 60) } : d)));
  };
  const max = data?.maxCount ?? 0;
  const step = (by: number) => setCountDraft(Math.max(1, Math.min(max || 1, count + by)));
  const basis = data?.basis;
  const noHistory = !!data && data.read.length === 0;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-lg flex-col gap-3">
        <DialogHeader>
          <DialogTitle>Book ahead</DialogTitle>
          <DialogDescription>
            {data?.bookedThrough
              ? `${first}'s next sessions, after ${shortDay(data.bookedThrough)}. Change any day or time, then book them all.`
              : `${first}'s next sessions. Pick the days and times, then book them all.`}
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-0.5">
          {loading && <p className="py-6 text-center text-sm text-muted-foreground">Working out {first}'s schedule…</p>}
          {!isFetching && error && (
            <div className="space-y-2 py-4 text-center">
              <p className="text-sm text-destructive">{(error as any)?.message ?? "Couldn't work it out"}</p>
              <Button size="sm" variant="outline" onClick={() => refetch()}>Try again</Button>
            </div>
          )}

          {data && (
            <>
              {/* Days and times */}
              <section className="space-y-2" aria-label="Days and times">
                <div className="flex items-center justify-between gap-2">
                  <h4 className="text-[15px] font-semibold">Days and times</h4>
                  {days && data.read.length > 0 && (
                    <button type="button" className="inline-flex min-h-10 items-center gap-1 text-[13px] text-muted-foreground hover:text-foreground" onClick={() => setDays(null)}>
                      <RotateCcw className="h-3.5 w-3.5" /> Back to {first}'s usual
                    </button>
                  )}
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {noHistory
                    ? `No sessions to learn ${first}'s days from yet: pick them here.`
                    : basis && basis.sessions > 0
                      ? `From ${first}'s last ${basis.sessions} sessions (${dayRange(basis.from, basis.to)}): ${data.perWeek} a week.`
                      : null}
                </p>
                <div className="grid grid-cols-7 gap-1">
                  {WEEK.map((d) => {
                    const on = shownDays.some((x) => x.weekday === d.weekday);
                    return (
                      <button
                        key={d.weekday}
                        type="button"
                        aria-pressed={on}
                        aria-label={d.name}
                        onClick={() => toggleDay(d.weekday)}
                        className={cn("h-10 rounded-lg text-[14px] font-medium transition-colors", on ? "bg-foreground text-background" : "bg-muted text-muted-foreground hover:text-foreground")}
                      >
                        {d.letter}
                      </button>
                    );
                  })}
                </div>
                {shownDays.length > 0 && (
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {shownDays.map((d) => (
                      <li key={d.weekday} className="flex items-center gap-3 px-3 py-1.5">
                        <span className="w-10 text-[14px] font-medium">{WEEK.find((w) => w.weekday === d.weekday)?.name}</span>
                        <Input
                          type="time"
                          step={900}
                          value={d.start}
                          onChange={(e) => setTime(d.weekday, e.target.value.slice(0, 5))}
                          className="h-10 w-[8.5rem] text-[16px]"
                          aria-label={`${WEEK.find((w) => w.weekday === d.weekday)?.name} start time`}
                        />
                        <span className="ml-auto text-[13px] text-muted-foreground">{lengthLabel(d.start, d.end)}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              {/* How many */}
              <section className="space-y-2" aria-label="How many">
                <div className="flex items-center justify-between gap-3">
                  <h4 className="text-[15px] font-semibold">How many</h4>
                  <div className="flex items-center gap-1">
                    <Button type="button" variant="outline" size="icon" className="h-10 w-10" aria-label="One fewer" disabled={count <= 1} onClick={() => step(-1)}>
                      <Minus className="h-4 w-4" />
                    </Button>
                    <span className="w-10 text-center text-lg font-semibold tabular-nums" aria-live="polite">{count}</span>
                    <Button type="button" variant="outline" size="icon" className="h-10 w-10" aria-label="One more" disabled={count >= max} onClick={() => step(1)}>
                      <Plus className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
                <p className="text-[13px] text-muted-foreground">
                  {max === 0
                    ? `${first} has no sessions left and no package to renew. Sell a package first.`
                    : prebookCountNote({ count, available: data.available, size: data.renewal?.size ?? null, first })}
                </p>
              </section>

              {/* The dates */}
              {shownDays.length > 0 && slots.length > 0 && (
                <section className={cn("space-y-2 transition-opacity", stale && "opacity-60")} aria-label="Dates">
                  <h4 className="text-[15px] font-semibold">Dates</h4>
                  <ul className="divide-y divide-border rounded-lg border border-border">
                    {slots.map((s) => {
                      const clash = clashes.get(s.date);
                      return (
                        <li key={s.date}>
                          <label className="flex min-h-12 cursor-pointer items-center gap-3 px-3 py-2">
                            <Checkbox checked={!off.has(s.date)} onCheckedChange={() => toggleDate(s.date)} />
                            <span className="min-w-0 flex-1">
                              <span className="block whitespace-nowrap text-[14px] font-medium tabular-nums">{shortDay(s.date)} · {fmtWallClock(s.start)}</span>
                              {clash && <span className="block truncate text-[12px] text-warning">Clashes with {clash}</span>}
                            </span>
                            <span className="shrink-0 text-[12px] text-muted-foreground">{s.google ? "In your Google" : "New"}</span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                  {!conflictCheck.googleChecked && <p className="text-[12px] text-muted-foreground">Google Calendar couldn't be checked for clashes.</p>}
                </section>
              )}
              {shownDays.length === 0 && <p className="text-[13px] text-muted-foreground">Pick at least one day.</p>}
              {(data.skipped?.length ?? 0) > 0 && (
                <p className="text-[12px] text-muted-foreground">
                  Skipped: {data.skipped.map((h) => `${shortDay(h.date)} (${h.reason})`).join(", ")}. Book one anyway with Book.
                </p>
              )}
              {data.googleNote && <p className="text-[12px] text-warning">{data.googleNote}</p>}
            </>
          )}
        </div>

        <DialogFooter className="flex-col gap-2 sm:flex-col">
          {chosen.length > 0 && (
            <p className="text-[12px] text-muted-foreground">
              Each counts as done once its day is over, and you can move or cancel any of them later.
              {" "}{inGoogle > 0 ? `${inGoogle} already in your Google Calendar, the rest added to it.` : "They're added to your Google Calendar."}
            </p>
          )}
          <Button className="h-11 w-full" disabled={chosen.length === 0 || stale || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? "Booking…" : chosen.length ? `Book ${plural(chosen.length, "session")}` : "Nothing to book"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
