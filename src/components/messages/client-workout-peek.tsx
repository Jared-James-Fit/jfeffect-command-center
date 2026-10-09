// The client's training, one tap from the conversation (coach/admin only).
//
// A slim bar under the chat header says what the client did last ("Last
// workout · Tue, Oct 7 · Upper A · 18/18 sets") so a coach can answer with
// context without leaving the chat. Tapping it opens the full view: the week
// strip (or a month calendar) to jump to any past or future date, previous /
// next workout, and the day itself: every exercise with what was prescribed
// and every set logged, plus the client's session notes and review.
//
// Nothing here is new data plumbing: it reads the same workouts list, date
// placement (buildWorkoutDateMap), week strip and read-only day card as the
// client's own Workouts screen, so coach and client always see the same day.
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { format, isToday, isYesterday } from "date-fns";
import {
  CalendarDays, ChevronLeft, ChevronRight, Dumbbell, ExternalLink, MessageSquareReply, RotateCcw,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";
import { getClientWorkouts } from "@/lib/pl-programs";
import { isAtHomeBackupClient } from "@/lib/at-home-backup";
import { buildWorkoutDateMap } from "@/lib/workout-calendar";
import { cleanDayTitle, type WorkoutItem } from "@/lib/workout-today";
import { getWorkoutStatus } from "@/lib/workout-status";
import { localStartOfToday, parseLocalDate, toLocalISO } from "@/lib/today";
import { WeekStrip } from "@/components/workouts/week-strip";
import { InlineWorkoutPreview } from "@/components/workout/shared/inline-workout-preview";
import { insertIntoComposer } from "@/lib/composer-insert";

/* ------------------------------ pure helpers ------------------------------ */

/** The date (yyyy-MM-dd) holding the most recently completed workout. */
export function lastCompletedDate(byDate: Map<string, WorkoutItem[]>): string | null {
  let best: { iso: string; at: number } | null = null;
  for (const [iso, list] of byDate) {
    for (const it of list) {
      const at = it.completion?.completed_at ? Date.parse(it.completion.completed_at) : NaN;
      if (Number.isFinite(at) && (!best || at > best.at)) best = { iso, at };
    }
  }
  return best?.iso ?? null;
}

/** Where the view opens: last completed workout, else the next one coming, else the latest. */
export function initialWorkoutDate(byDate: Map<string, WorkoutItem[]>, todayIso: string): string | null {
  const done = lastCompletedDate(byDate);
  if (done) return done;
  const dates = [...byDate.keys()].sort();
  return dates.find((d) => d >= todayIso) ?? dates[dates.length - 1] ?? null;
}

/** The workout dates just before and after `iso` (rest days skipped). */
export function neighbourWorkoutDates(dates: string[], iso: string): { prev: string | null; next: string | null } {
  let prev: string | null = null;
  let next: string | null = null;
  for (const d of dates) {
    if (d < iso) prev = d;
    else if (d > iso && next == null) next = d;
  }
  return { prev, next };
}

function dayLabel(iso: string): string {
  const d = parseLocalDate(iso);
  if (!d) return iso;
  if (isToday(d)) return "Today";
  if (isYesterday(d)) return "Yesterday";
  return format(d, "EEE, MMM d");
}

function titleOf(item: WorkoutItem): string {
  return cleanDayTitle(item.day?.title, item.day?.day_index);
}

/* ------------------------------ the bar ------------------------------ */

type LastCompletion = {
  completed_at: string;
  logged_sets_count: number | null;
  required_sets_count: number | null;
  pl_days: { title: string | null; day_index: number | null } | null;
};

/**
 * Mount under the chat header (coach/admin). Renders nothing for clients
 * without a training program.
 */
export function ClientWorkoutPeek({ clientId, clientName }: { clientId: string; clientName?: string | null }) {
  const [open, setOpen] = useState(false);
  const isMobile = useIsMobile();

  const { data } = useQuery({
    queryKey: ["workout-peek-last", clientId],
    staleTime: 60_000,
    queryFn: async () => {
      const [last, blocks] = await Promise.all([
        supabase
          .from("pl_day_completions")
          .select("completed_at, logged_sets_count, required_sets_count, pl_days(title, day_index)")
          .eq("client_id", clientId)
          .not("completed_at", "is", null)
          .order("completed_at", { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from("pl_blocks").select("id", { count: "exact", head: true }).eq("client_id", clientId),
      ]);
      return {
        last: (last.data ?? null) as LastCompletion | null,
        hasProgram: (blocks.count ?? 0) > 0,
      };
    },
  });

  // Switching conversations closes the view.
  useEffect(() => { setOpen(false); }, [clientId]);

  if (!data || (!data.last && !data.hasProgram)) return null;
  const last = data.last;
  const when = last ? dayLabel(toLocalISO(new Date(last.completed_at))) : null;
  const sets = last?.logged_sets_count != null
    ? last.required_sets_count ? `${last.logged_sets_count}/${last.required_sets_count} sets` : `${last.logged_sets_count} sets`
    : null;
  const title = last ? cleanDayTitle(last.pl_days?.title, last.pl_days?.day_index) : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex w-full shrink-0 items-center gap-2 border-b border-border bg-card/60 px-3 py-1.5 text-left text-xs transition hover:bg-secondary/60 active:bg-secondary sm:px-4"
        aria-label={`Open ${clientName ?? "client"}'s workouts`}
      >
        <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
          <Dumbbell className="h-3.5 w-3.5" />
        </span>
        {last ? (
          <>
            {/* The workout name and day truncate; the set count never does. */}
            <span className="min-w-0 flex-1 truncate">
              <span className="text-muted-foreground">Last: </span>
              <span className="font-semibold text-foreground">{title}</span>
              <span className="text-muted-foreground"> · {when}</span>
            </span>
            {sets && (
              <span className="shrink-0 rounded-full bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {sets}
              </span>
            )}
          </>
        ) : (
          <span className="min-w-0 flex-1 truncate">
            <span className="font-semibold text-foreground">Workouts</span>
            <span className="text-muted-foreground"> · nothing completed yet</span>
          </span>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          // Back to the chat, not to the bar (that would pop the keyboard on reply).
          onCloseAutoFocus={(e) => e.preventDefault()}
          className={cn(
            "flex flex-col gap-0 p-0",
            isMobile ? "h-[92dvh] rounded-t-2xl" : "w-full sm:max-w-lg",
          )}
        >
          {open && (
            <WorkoutPeekBody
              clientId={clientId}
              clientName={clientName ?? null}
              onReply={(text) => {
                setOpen(false);
                insertIntoComposer(clientId, text);
              }}
            />
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

/* ------------------------------ the full view ------------------------------ */

function WorkoutPeekBody({
  clientId, clientName, onReply,
}: {
  clientId: string;
  clientName: string | null;
  onReply: (text: string) => void;
}) {
  // Same queries (and cache) as the client's own Workouts screen.
  const { data: client } = useQuery({
    queryKey: ["workouts-experience-client", clientId],
    queryFn: async () => (await supabase.from("clients").select("*").eq("id", clientId).maybeSingle()).data,
  });
  const { data: items = [], isPending } = useQuery({
    queryKey: ["my-workouts", clientId],
    queryFn: () => getClientWorkouts(
      clientId,
      { includeAtHomeBackupSessions: isAtHomeBackupClient(clientId) },
    ) as Promise<WorkoutItem[]>,
  });

  const committedDays = (client as any)?.committed_training_days ?? null;
  const byDate = useMemo(() => buildWorkoutDateMap(items as WorkoutItem[], committedDays), [items, committedDays]);
  const dates = useMemo(() => [...byDate.keys()].sort(), [byDate]);
  const todayIso = toLocalISO(localStartOfToday());
  const lastDone = useMemo(() => lastCompletedDate(byDate), [byDate]);

  const [selected, setSelected] = useState<string | null>(null);
  const [view, setView] = useState<"week" | "month">("week");
  useEffect(() => {
    if (selected == null && !isPending) setSelected(initialWorkoutDate(byDate, todayIso) ?? todayIso);
  }, [selected, isPending, byDate, todayIso]);

  const first = (clientName ?? "").trim().split(/\s+/)[0] || "Client";
  const selectedIso = selected ?? todayIso;
  const selectedDate = parseLocalDate(selectedIso) ?? localStartOfToday();
  const { prev, next } = neighbourWorkoutDates(dates, selectedIso);
  const dayItems = byDate.get(selectedIso) ?? [];

  // Month view: mark training days by how they went.
  const modifiers = useMemo(() => {
    const done: Date[] = [];
    const missed: Date[] = [];
    const planned: Date[] = [];
    for (const [iso, list] of byDate) {
      const d = parseLocalDate(iso);
      if (!d) continue;
      if (list.some((it) => it.completion?.completed_at)) done.push(d);
      else if (list.some((it) => getWorkoutStatus(it).status === "missed")) missed.push(d);
      else planned.push(d);
    }
    return { done, missed, planned };
  }, [byDate]);

  return (
    <>
      <SheetHeader className="shrink-0 border-b border-border pb-3 pr-4 pt-3">
        <SheetTitle className="text-base">{first}'s training</SheetTitle>
        <SheetDescription className="text-xs">
          {lastDone ? `Last workout: ${dayLabel(lastDone)}` : "No workout completed yet"}
        </SheetDescription>
      </SheetHeader>

      <div className="shrink-0 space-y-2 border-b border-border px-3 py-2">
        <div className="flex items-center gap-1.5">
          <Button
            type="button" variant="outline" size="sm" className="h-8 gap-1 rounded-full px-2.5 text-xs"
            disabled={!prev} onClick={() => prev && setSelected(prev)}
            aria-label="Previous workout"
          >
            <ChevronLeft className="h-3.5 w-3.5" /> Prev
          </Button>
          <div className="min-w-0 flex-1 truncate text-center text-sm font-bold">
            {format(selectedDate, "EEE, MMM d")}
          </div>
          <Button
            type="button" variant="outline" size="sm" className="h-8 gap-1 rounded-full px-2.5 text-xs"
            disabled={!next} onClick={() => next && setSelected(next)}
            aria-label="Next workout"
          >
            Next <ChevronRight className="h-3.5 w-3.5" />
          </Button>
        </div>
        <div className="flex items-center gap-1.5 overflow-x-auto">
          {lastDone && (
            <Chip active={selectedIso === lastDone} onClick={() => setSelected(lastDone)}>
              <RotateCcw className="h-3 w-3" /> Last done
            </Chip>
          )}
          <Chip active={selectedIso === todayIso} onClick={() => setSelected(todayIso)}>Today</Chip>
          {(() => {
            const upcoming = dates.find((d) => d > todayIso);
            return upcoming ? (
              <Chip active={selectedIso === upcoming} onClick={() => setSelected(upcoming)}>Next up</Chip>
            ) : null;
          })()}
          <div className="flex-1" />
          <Chip active={view === "month"} onClick={() => setView(view === "month" ? "week" : "month")}>
            <CalendarDays className="h-3 w-3" /> {view === "month" ? "Week" : "Month"}
          </Chip>
        </div>
        {view === "week" ? (
          <WeekStrip
            selectedDate={selectedDate}
            onSelectDate={(d) => setSelected(toLocalISO(d))}
            byDate={byDate}
          />
        ) : (
          <div className="rounded-xl border border-border bg-card">
            <Calendar
              key={selectedIso.slice(0, 7)}
              mode="single"
              selected={selectedDate}
              defaultMonth={selectedDate}
              onSelect={(d) => { if (d) { setSelected(toLocalISO(d)); setView("week"); } }}
              modifiers={modifiers}
              modifiersClassNames={{
                done: "font-black text-emerald-500 underline decoration-emerald-500 decoration-2 underline-offset-4",
                missed: "font-bold text-rose-500 underline decoration-rose-500 decoration-2 underline-offset-4",
                planned: "font-bold underline decoration-muted-foreground/60 decoration-2 underline-offset-4",
              }}
              className="mx-auto"
            />
          </div>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-3 py-3 pb-[calc(env(safe-area-inset-bottom)+1rem)]">
        {isPending ? (
          <div className="space-y-2">
            <div className="h-5 w-40 animate-pulse rounded bg-muted" />
            <div className="h-40 animate-pulse rounded-lg bg-muted/60" />
          </div>
        ) : dayItems.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">
            <div className="font-semibold text-foreground">Rest day</div>
            <div className="mt-0.5 text-xs">No workout on {format(selectedDate, "EEEE, MMM d")}.</div>
            <div className="mt-3 flex justify-center gap-2">
              {prev && (
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelected(prev)}>
                  <ChevronLeft className="mr-1 h-3.5 w-3.5" /> {dayLabel(prev)}
                </Button>
              )}
              {next && (
                <Button type="button" size="sm" variant="outline" className="h-8 text-xs" onClick={() => setSelected(next)}>
                  {dayLabel(next)} <ChevronRight className="ml-1 h-3.5 w-3.5" />
                </Button>
              )}
            </div>
          </div>
        ) : (
          dayItems.map((item) => (
            <WorkoutPeekCard
              key={`${item.day?.id}-${item.scheduledWorkoutId ?? "legacy"}`}
              item={item}
              clientId={clientId}
              dateIso={selectedIso}
              onReply={onReply}
            />
          ))
        )}
        <Link
          to="/admin/client-programs/$clientId"
          params={{ clientId }}
          className="flex items-center justify-center gap-1.5 py-2 text-xs font-semibold text-muted-foreground hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" /> Open full program
        </Link>
      </div>
    </>
  );
}

function Chip({ active, onClick, children }: { active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-7 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[11px] font-semibold transition",
        active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:bg-secondary",
      )}
    >
      {children}
    </button>
  );
}

type Feedback = {
  overall_rating: number | null;
  session_rpe: number | null;
  client_note: string | null;
  pain: boolean | null;
  pain_area: string | null;
  pain_level: number | null;
  pain_note: string | null;
};

function WorkoutPeekCard({
  item, clientId, dateIso, onReply,
}: {
  item: WorkoutItem;
  clientId: string;
  dateIso: string;
  onReply: (text: string) => void;
}) {
  const status = getWorkoutStatus(item);
  const completion = item.completion ?? null;
  const title = titleOf(item);
  const { data: feedback } = useQuery({
    queryKey: ["workout-peek-feedback", completion?.id],
    enabled: !!completion?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_workout_feedback")
        .select("overall_rating, session_rpe, client_note, pain, pain_area, pain_level, pain_note")
        .eq("completion_id", completion.id)
        .maybeSingle();
      return (data ?? null) as Feedback | null;
    },
  });

  const stats: string[] = [];
  if (completion?.completed_at) stats.push(`Done ${format(new Date(completion.completed_at), "h:mm a")}`);
  if (completion?.actual_duration_min) stats.push(`${Math.round(completion.actual_duration_min)} min`);
  if (feedback?.session_rpe != null) stats.push(`Session RPE ${feedback.session_rpe}`);
  const rating = feedback?.overall_rating ?? completion?.session_rating ?? null;
  if (rating != null) stats.push(`Rated ${rating}/5`);
  const notes = [completion?.client_notes, feedback?.client_note].filter((n): n is string => !!n && !!n.trim());
  const pain = feedback?.pain
    ? [feedback.pain_area, feedback.pain_level != null ? `${feedback.pain_level}/10` : null, feedback.pain_note].filter(Boolean).join(" · ")
    : null;
  const blockName = item.block?.name ? String(item.block.name) : null;
  const week = item.week?.week_index ? `Week ${item.week.week_index}` : null;

  return (
    <section className="space-y-2 rounded-xl border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-bold">{title}</div>
          {(blockName || week) && (
            <div className="truncate text-[11px] text-muted-foreground">{[blockName, week].filter(Boolean).join(" · ")}</div>
          )}
        </div>
        <span className={cn("shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold", status.tone)}>{status.label}</span>
      </div>
      {stats.length > 0 && <div className="text-[11px] font-medium text-muted-foreground">{stats.join(" · ")}</div>}
      {pain && (
        <div className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-2.5 py-1.5 text-xs text-rose-600 dark:text-rose-300">
          <span className="font-bold">Pain</span> · {pain}
        </div>
      )}
      {notes.map((n, i) => (
        <div key={i} className="rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs">
          <span className="font-semibold">Client note</span> · {n}
        </div>
      ))}
      {item.day?.id && (
        <InlineWorkoutPreview
          dayId={item.day.id}
          clientId={clientId}
          scheduledWorkoutId={item.scheduledWorkoutId ?? null}
          estimatedMinutes={item.estimated_minutes ?? null}
          maxSetsShown={50}
        />
      )}
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="h-9 w-full gap-1.5 text-xs font-semibold"
        onClick={() => onReply(`Re: ${title} (${format(parseLocalDate(dateIso) ?? new Date(), "EEE, MMM d")}): `)}
      >
        <MessageSquareReply className="h-3.5 w-3.5" /> Reply about this workout
      </Button>
    </section>
  );
}
