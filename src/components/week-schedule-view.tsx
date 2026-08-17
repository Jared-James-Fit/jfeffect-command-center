import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { addDays, format, parseISO, startOfWeek } from "date-fns";
import { ChevronLeft, ChevronRight, Calendar, Lock, Dumbbell, Activity, CheckCircle2, AlertTriangle, Moon, CalendarClock } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { WEEK_DAYS, SHORT_DAY, formatDays, type WeekDay } from "@/lib/training-schedule";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  setRecurringHighDays,
  upsertNutritionDayOverride,
  deleteNutritionDayOverride,
} from "@/lib/high-day-schedule";
import { toast } from "sonner";
import { detectAvailabilityChange } from "@/lib/auto-scheduler";
import {
  mondayWeekDates,
  resolveClientWeekDays,
  resolveWorkoutDatesFromSchedule,
  type CardioDayType,
} from "@/lib/resolved-client-days";
import { cn } from "@/lib/utils";
import { cardioActivityLabel } from "@/lib/cardio-activity";

const sb = supabase as any;

type DayCell = {
  weekday: WeekDay;
  dateISO: string;
  isToday: boolean;
  isPast: boolean;
  workout: {
    dayId: string;
    title: string;
    focus: string | null;
    manualOverride: boolean;
  } | null;
  cardio: Array<{
    id: string;
    label: string;
    dayType: string;
    duration: number | null;
    intensity: string | null;
    zone: string | null;
    notes: string | null;
  }>;
  dayType: "Training" | "Rest" | "High";
  cardioDayType: CardioDayType;
  completion: { completed_at: string | null; completed_date: string | null } | null;
};

function todayISO(): string {
  return format(new Date(), "yyyy-MM-dd");
}

async function loadBlockData(blockId: string, clientId: string) {
  const [{ data: block }, { data: weeks }, { data: cardio }, { data: clientRow }, { data: overrides }] = await Promise.all([
    sb.from("pl_blocks").select("id, start_date, end_date, last_scheduled_at, last_scheduled_availability").eq("id", blockId).maybeSingle(),
    sb.from("pl_weeks").select("id, week_index, training_days, start_date, end_date").eq("block_id", blockId),
    sb.from("cardio_targets")
      .select("id, day_type, frequency_per_week, cardio_type, custom_type, duration_minutes, intensity, heart_rate_zone, client_notes, status, visible_to_client, enabled, start_date, end_date")
      .eq("client_id", clientId),
    sb.from("clients").select("committed_training_days, preferred_high_days, full_cardio_rest_days").eq("id", clientId).maybeSingle(),
    sb.from("nutrition_day_overrides").select("override_date, day_label").eq("client_id", clientId),
  ]);
  const weekIds = (weeks ?? []).map((w: any) => w.id);
  const { data: days } = weekIds.length
    ? await sb.from("pl_days").select("id, week_id, day_index, title, focus, scheduled_date, schedule_locked").in("week_id", weekIds)
    : { data: [] };
  const dayIds = (days ?? []).map((d: any) => d.id);
  const { data: completions } = dayIds.length
    ? await sb.from("pl_day_completions").select("day_id, completed_at, completed_date").in("day_id", dayIds)
    : { data: [] };
  return {
    block,
    weeks: weeks ?? [],
    days: days ?? [],
    cardio: cardio ?? [],
    completions: completions ?? [],
    clientPrefs: clientRow ?? null,
    overrides: (overrides ?? []) as Array<{ override_date: string; day_label: string }>,
  };
}

function buildCells(
  clientId: string,
  weekStart: Date,
  allDays: any[],
  cardioTargets: any[],
  completions: any[],
  weeks: any[],
  block: any,
  clientPrefs: { committed_training_days?: string[] | null; preferred_high_days?: string[] | null; full_cardio_rest_days?: string[] | null } | null,
  overrides: Array<{ override_date: string; day_label: string }>,
): DayCell[] {
  const weekDates: string[] = mondayWeekDates(weekStart);
  const today = todayISO();

  const activeCardio = cardioTargets.filter((c) =>
    c.enabled !== false && c.visible_to_client !== false && (c.status ?? "Active") === "Active",
  );
  const cardioById = new Map(activeCardio.map((c) => [c.id, c]));
  const workoutDates = resolveWorkoutDatesFromSchedule(allDays, weeks, block, clientPrefs?.committed_training_days ?? null);
  const workoutsByDate = new Map(workoutDates.map((w) => [w.date, w]));
  const resolvedDays = resolveClientWeekDays({
    clientId,
    weekDates,
    workouts: workoutDates,
    recurringHighDays: clientPrefs?.preferred_high_days ?? null,
    highDayOverrides: overrides,
    fullCardioRestDays: clientPrefs?.full_cardio_rest_days ?? null,
    cardioTargets: activeCardio,
  });

  const dayTypeLabel = (type: CardioDayType) => {
    if (type === "training") return "Training Day";
    if (type === "high") return "High Day";
    if (type === "rest") return "Full Cardio Rest";
    return "Non-Training Day";
  };

  const completionByDay = new Map<string, any>();
  for (const c of completions) completionByDay.set(c.day_id, c);

  return WEEK_DAYS.map((wd, i) => {
    const dateISO = weekDates[i];
    const resolved = resolvedDays[i];
    const workoutDate = workoutsByDate.get(dateISO) ?? null;
    const workout = workoutDate?.workout ?? null;
    const target = resolved?.cardioTargetId ? cardioById.get(resolved.cardioTargetId) : null;
    const label = target ? cardioActivityLabel(target as any) : null;
    const dayType: DayCell["dayType"] = resolved?.nutritionDayType === "high"
      ? "High"
      : workout
        ? "Training"
        : "Rest";
    const completion = workout ? (completionByDay.get(workout.id) ?? null) : null;
    return {
      weekday: wd,
      dateISO,
      isToday: dateISO === today,
      isPast: dateISO < today,
      workout: workout
        ? {
            dayId: workout.id,
            title: workout.title ?? `Day ${workout.day_index}`,
            focus: workout.focus ?? null,
            manualOverride: !!resolved?.isWorkoutOverride,
          }
        : null,
      cardio: target && resolved?.cardioDayType !== "rest" ? [{
        id: `${target.id}:${dateISO}`,
        label: label ?? "Cardio",
        dayType: dayTypeLabel(resolved.cardioDayType),
        duration: target.duration_minutes ?? null,
        intensity: target.intensity ?? null,
        zone: target.heart_rate_zone ?? null,
        notes: target.client_notes ?? null,
      }] : [],
      dayType,
      cardioDayType: resolved?.cardioDayType ?? "non_training",
      completion,
    } as DayCell;
  });
}

function statusFor(cell: DayCell): { label: string; tone: string } | null {
  if (cell.completion?.completed_at) {
    const completedDate = cell.completion.completed_date ?? cell.completion.completed_at.slice(0, 10);
    if (completedDate !== cell.dateISO) {
      return { label: `Completed ${format(parseISO(completedDate), "MMM d")}`, tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" };
    }
    return { label: "Completed", tone: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600" };
  }
  if (cell.isToday) return { label: "Today", tone: "border-primary/60 bg-primary/15 text-primary" };
  if (cell.workout && cell.isPast) return { label: "Missed", tone: "border-destructive/40 bg-destructive/10 text-destructive" };
  if (cell.workout) return { label: "Upcoming", tone: "border-border bg-secondary/40 text-muted-foreground" };
  if (cell.cardio.length > 0) return { label: "Cardio Day", tone: "border-border bg-secondary/40 text-muted-foreground" };
  if (cell.cardioDayType === "rest") return { label: "Full Rest", tone: "border-border bg-secondary/30 text-muted-foreground" };
  return { label: "Rest Day", tone: "border-border bg-secondary/30 text-muted-foreground" };
}

export function WeekScheduleView({
  clientId,
  blockId,
  mode = "client",
}: {
  clientId: string;
  blockId: string | null;
  mode?: "client" | "admin";
}) {
  const [weekStart, setWeekStart] = useState<Date>(() => startOfWeek(new Date(), { weekStartsOn: 1 }));

  const { data, isLoading } = useQuery({
    queryKey: ["week-sched-data", blockId, clientId],
    enabled: !!blockId && !!clientId,
    queryFn: () => loadBlockData(blockId!, clientId),
  });

  const { data: change } = useQuery({
    queryKey: ["week-sched-change", blockId],
    enabled: !!blockId && mode === "admin",
    queryFn: () => detectAvailabilityChange(blockId!),
  });

  const cells = useMemo(() => {
    if (!data) return [] as DayCell[];
    return buildCells(clientId, weekStart, data.days, data.cardio, data.completions, data.weeks, data.block, data.clientPrefs, data.overrides);
  }, [clientId, data, weekStart]);

  const goPrev = () => setWeekStart((d) => addDays(d, -7));
  const goNext = () => setWeekStart((d) => addDays(d, 7));
  const goToday = () => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }));

  if (!blockId) {
    return (
      <Card className="border-dashed border-border bg-card p-6 text-center text-sm text-muted-foreground">
        <Calendar className="mx-auto mb-2 h-6 w-6" />
        {mode === "admin"
          ? "No schedule built yet. Use Build Schedule From Availability in the block editor."
          : "Your workout schedule has not been set yet. You can still access your workouts from All Workouts."}
      </Card>
    );
  }

  if (isLoading) {
    return <Card className="p-6 text-sm text-muted-foreground">Loading week…</Card>;
  }

  const weekEnd = addDays(weekStart, 6);
  const todaysCell = cells.find((c) => c.isToday) ?? null;

  return (
    <div className="space-y-3">
      {/* Admin: availability change notice */}
      {mode === "admin" && change?.changed && (
        <div className="flex flex-wrap items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Client availability changed. Review schedule.</div>
            <div className="text-muted-foreground">
              Before: {formatDays(change.before)} → After: {formatDays(change.after)}
            </div>
          </div>
        </div>
      )}

      {/* Week nav */}
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 sm:flex sm:flex-wrap sm:justify-between">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">
            {format(weekStart, "MMM d")} – {format(weekEnd, "MMM d, yyyy")}
          </div>
          <div className="text-[11px] text-muted-foreground">Week view</div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={goPrev} aria-label="Previous week"><ChevronLeft className="h-4 w-4" /></Button>
          <Button size="sm" variant="outline" className="h-8" onClick={goToday}>Today</Button>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={goNext} aria-label="Next week"><ChevronRight className="h-4 w-4" /></Button>
        </div>
      </div>

      {/* Today highlight strip */}
      {todaysCell && (
        <Card className="border-primary/40 bg-primary/5 p-3">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-primary/20 text-primary font-black">
              {format(parseISO(todaysCell.dateISO), "d")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Today's Plan</div>
              {todaysCell.workout || todaysCell.cardio.length > 0 ? (
                <div className="mt-0.5 text-sm font-semibold truncate">
                  {todaysCell.workout?.title ?? "Cardio Day"}
                  {todaysCell.cardio.length > 0 && todaysCell.workout && (
                    <span className="text-muted-foreground"> · +{todaysCell.cardio.length} cardio</span>
                  )}
                </div>
              ) : (
                <div className="mt-0.5 text-sm text-muted-foreground">No workout scheduled today</div>
              )}
            </div>
            {todaysCell.workout && mode === "client" && (
              <Button asChild size="sm" className="shrink-0">
                <Link to="/portal/workouts/$dayId" params={{ dayId: todaysCell.workout.dayId }} search={{}}>Open</Link>
              </Button>
            )}
          </div>
        </Card>
      )}

      {/* Week grid */}
      <div className="grid grid-cols-1 gap-2 md:grid-cols-2 xl:grid-cols-7">
        {cells.map((cell) => (
          <DayCard
            key={cell.dateISO}
            cell={cell}
            mode={mode}
            clientId={clientId}
            recurringHighDays={data?.clientPrefs?.preferred_high_days ?? []}
            hasOverride={!!(data?.overrides ?? []).find((o) => o.override_date === cell.dateISO)}
          />
        ))}
      </div>
    </div>
  );
}

function DayCard({
  cell,
  mode,
  clientId,
  recurringHighDays,
  hasOverride,
}: {
  cell: DayCell;
  mode: "client" | "admin";
  clientId: string;
  recurringHighDays: string[];
  hasOverride: boolean;
}) {
  const status = statusFor(cell);
  return (
    <Card
      className={cn(
        "flex flex-col gap-2 p-3 transition-colors",
        cell.isToday && "border-primary/60 bg-primary/5",
        cell.dayType === "High" && "border-amber-500/50",
        !cell.workout && cell.cardio.length === 0 && "bg-secondary/20",
      )}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0">
          <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
            {SHORT_DAY[cell.weekday]}
          </div>
          <div className="text-sm font-black">{format(parseISO(cell.dateISO), "MMM d")}</div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {cell.isToday && <Badge className="bg-primary text-primary-foreground text-[10px]">Today</Badge>}
          {status && !cell.isToday && (
            <Badge variant="outline" className={cn("text-[10px]", status.tone)}>{status.label}</Badge>
          )}
          {mode === "admin" && cell.workout?.manualOverride && (
            <Badge variant="outline" className="gap-1 text-[10px]">
              <Lock className="h-3 w-3" /> Manual
            </Badge>
          )}
          {cell.dayType === "High" && (
            <Badge variant="outline" className="gap-1 border-amber-500/50 text-[10px] text-amber-600 dark:text-amber-500">
              High Day
            </Badge>
          )}
        </div>
      </div>

      {/* High Day reschedule popover (admin only) */}
      {mode === "admin" && cell.dayType === "High" && (
        <HighDayRescheduleMenu
          clientId={clientId}
          dateISO={cell.dateISO}
          weekday={cell.weekday}
          recurringHighDays={recurringHighDays}
          hasOverride={hasOverride}
        />
      )}

      {/* Workout */}
      {cell.workout ? (
        <div className="rounded-md border border-border bg-secondary/30 p-2">
          <div className="flex items-start gap-2">
            <Dumbbell className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-bold">{cell.workout.title}</div>
              {cell.workout.focus && (
                <div className="truncate text-[10px] text-muted-foreground">
                  {cell.dayType === "High" ? "High Day · " : ""}{cell.workout.focus}
                </div>
              )}
            </div>
          </div>
          {cell.completion?.completed_at ? (
            <div className="mt-1.5 flex items-center gap-1 text-[10px] text-emerald-600">
              <CheckCircle2 className="h-3 w-3" /> Logged
            </div>
          ) : (
            <Button asChild size="sm" variant="outline" className="mt-1.5 h-7 w-full text-[11px]" disabled={mode === "admin"}>
              {mode === "admin" ? (
                <span>Open Workout</span>
              ) : (
                <Link to="/portal/workouts/$dayId" params={{ dayId: cell.workout.dayId }} search={{}}>Open Workout</Link>
              )}
            </Button>
          )}
        </div>
      ) : cell.cardio.length === 0 ? (
        <div className="flex items-center gap-2 rounded-md border border-dashed border-border p-2 text-[11px] text-muted-foreground">
          <Moon className="h-3 w-3" /> {cell.cardioDayType === "rest" ? "Full Cardio Rest — no cardio scheduled" : "Rest Day"}
        </div>
      ) : null}

      {/* Cardio */}
      {cell.cardio.map((c) => (
        <div key={c.id} className="rounded-md border border-border bg-card p-2">
          <div className="flex items-start gap-2">
            <Activity className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <div className="min-w-0 flex-1">
              <div className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                {c.dayType} Cardio
              </div>
              <div className="truncate text-xs font-semibold">{c.label}</div>
              <div className="text-[10px] text-muted-foreground">
                {[
                  c.duration ? `${c.duration} min` : null,
                  c.zone || c.intensity || null,
                ].filter(Boolean).join(" · ")}
              </div>
              {c.notes && <div className="mt-0.5 line-clamp-2 text-[10px] text-foreground/80">{c.notes}</div>}
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

function HighDayRescheduleMenu({
  clientId,
  dateISO,
  weekday,
  recurringHighDays,
  hasOverride,
}: {
  clientId: string;
  dateISO: string;
  weekday: WeekDay;
  recurringHighDays: string[];
  hasOverride: boolean;
}) {
  const qc = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["week-sched-data"] });
    qc.invalidateQueries({ queryKey: ["cal-client-cardio", clientId] });
    qc.invalidateQueries({ queryKey: ["client-cardio-resolved", clientId] });
  };
  const changeRecurring = async (d: WeekDay) => {
    try {
      setBusy(true);
      await setRecurringHighDays(clientId, [d]);
      toast.success(`Recurring High Day moved to ${d}`);
      invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update recurring High Day");
    } finally { setBusy(false); }
  };
  const moveThisWeekTo = async (targetISO: string) => {
    try {
      setBusy(true);
      // Move: mark this date as its normal weekday label and target date as High Day.
      // Simplest: just add an override at target date = High Day.
      await upsertNutritionDayOverride(clientId, targetISO, "High Day", "Rescheduled from " + dateISO);
      // And blank this date to Non-Training so we don't emit two High Days.
      await upsertNutritionDayOverride(clientId, dateISO, "Non-Training Day", "Moved High Day away");
      toast.success("Moved High Day for this week only");
      invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to move High Day");
    } finally { setBusy(false); }
  };
  const clearOverride = async () => {
    try {
      setBusy(true);
      await deleteNutritionDayOverride(clientId, dateISO);
      toast.success("Cleared exception");
      invalidate();
      setOpen(false);
    } catch (e: any) {
      toast.error(e.message ?? "Failed to clear override");
    } finally { setBusy(false); }
  };
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 w-full gap-1 text-[11px]">
          <CalendarClock className="h-3 w-3" />
          Reschedule High Day
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 space-y-3 p-3 pointer-events-auto">
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Change recurring weekday
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(WEEK_DAYS as readonly WeekDay[]).map((d) => (
              <button
                key={d}
                type="button"
                disabled={busy}
                onClick={() => changeRecurring(d)}
                className={cn(
                  "h-7 rounded px-1 text-[10px] font-bold uppercase tracking-wider transition-colors",
                  recurringHighDays.includes(d)
                    ? "bg-amber-500 text-white"
                    : "border border-border bg-background hover:bg-secondary",
                )}
              >
                {SHORT_DAY[d]}
              </button>
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            Move this week only (from {SHORT_DAY[weekday]})
          </div>
          <div className="grid grid-cols-4 gap-1">
            {(WEEK_DAYS as readonly WeekDay[]).map((d, i) => {
              // Compute the ISO date within the same Monday-start week as dateISO
              const base = parseISO(dateISO);
              const monday = addDays(base, -(((base.getDay() + 6) % 7)));
              const targetDate = addDays(monday, i);
              const targetISO = format(targetDate, "yyyy-MM-dd");
              const disabled = busy || targetISO === dateISO;
              return (
                <button
                  key={d}
                  type="button"
                  disabled={disabled}
                  onClick={() => moveThisWeekTo(targetISO)}
                  className="h-7 rounded border border-border bg-background px-1 text-[10px] font-bold uppercase tracking-wider transition-colors hover:bg-secondary disabled:opacity-40"
                >
                  {SHORT_DAY[d]}
                </button>
              );
            })}
          </div>
        </div>
        {hasOverride && (
          <Button size="sm" variant="outline" className="h-7 w-full text-[11px]" disabled={busy} onClick={clearOverride}>
            Clear this-week exception
          </Button>
        )}
      </PopoverContent>
    </Popover>
  );
}
