/**
 * The client's cardio for a date, shown once.
 *
 * One place per day: on a training day the cardio plan's session is the last
 * exercise of that day's workout (program_cardio_sync), so it's logged there
 * and nothing else shows it as a card. Otherwise the Workouts tab shows it in
 * the day itself (`useDayCardio`: a day off leads with it, a workout without
 * the plan's row carries it under its buttons), and the workout page shows it
 * under the lifting (`ClientCardioSection`). `variant="line"` (Nutrition) is a
 * one-line status that opens where it's logged.
 *
 * The read is one week at a time (the day types and the plan's sessions are
 * worked out for the week anyway), so stepping through the week strip never
 * asks again.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Activity, Check, ChevronRight } from "lucide-react";
import { cardioStatus } from "@/lib/cardio-plan";
import { supabase } from "@/integrations/supabase/client";
import { CardioCompletionCard } from "./CardioCompletionCard";
import { clientWorkoutsQuery, primaryWorkouts } from "@/lib/client-workouts-query";
import type { WorkoutItem } from "@/lib/workout-today";
import { mondayWeekDates, resolveClientWeekDays, resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { parseLocalDate, todayLocalISO, toLocalISO } from "@/lib/today";

export type DayCardio = {
  /** The plan's session for the day, null when there's none. */
  target: any | null;
  /** The day's workout that holds the plan's cardio as its last exercise (logged there). */
  inWorkout: { dayId: string } | null;
  /** The cardio day type ("training", "non_training", "high", "rest"). */
  dayType: string | null;
};

/** Monday of the date's week, yyyy-mm-dd. */
function mondayOf(dateStr: string): string {
  const d = parseLocalDate(dateStr) ?? new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toLocalISO(monday);
}

/**
 * The day's cardio: the plan's session for that date and whether a workout
 * that day already holds it. `workoutDayId` is the workout it's shown inside
 * (the workout page), wherever that workout's date is.
 */
export function useDayCardio(clientId: string, date?: Date | null, workoutDayId?: string | null) {
  const dateStr = date ? toLocalISO(date) : todayLocalISO();
  const weekStart = mondayOf(dateStr);
  const qc = useQueryClient();
  const query = useQuery({
    queryKey: ["client-cardio-resolved", clientId, weekStart, workoutDayId ?? null],
    enabled: !!clientId,
    queryFn: async () => {
      const [targetsRes, clientRes, overridesRes, workouts] = await Promise.all([
        supabase
          .from("cardio_targets")
          .select(
            "id,cardio_type,custom_type,day_type,custom_day_type,scheduled_weekdays,frequency_per_week,duration_minutes,intensity,heart_rate_zone,machine_preference,goal,step_target,step_target_mode,calorie_target_min,calorie_target_max,calorie_target_mode,show_calories_to_client,incline,speed_min_mph,speed_max_mph,completion_rule,client_notes,program_name,start_date,end_date,status,enabled,visible_to_client",
          )
          .eq("client_id", clientId)
          .eq("visible_to_client", true)
          .eq("enabled", true)
          .eq("status", "Active")
          .is("program_name", null)
          .order("start_date", { ascending: false }),
        supabase
          .from("clients")
          .select("committed_training_days,preferred_high_days,full_cardio_rest_days")
          .eq("id", clientId)
          .maybeSingle(),
        (supabase.from("nutrition_day_overrides") as any)
          .select("override_date,day_label")
          .eq("client_id", clientId),
        // The Workouts screen's own list (same key and loader): a cached copy is
        // reused instead of re-running the whole program chain for every week.
        qc.fetchQuery(clientWorkoutsQuery(clientId)).then((items) => primaryWorkouts(items as WorkoutItem[])),
      ]);
      if (targetsRes.error) throw targetsRes.error;
      const weekDates = mondayWeekDates(weekStart);
      const client = clientRes.data as any;
      const workoutDates = resolveWorkoutDatesFromItems(workouts as any[], client?.committed_training_days ?? null)
        .filter((w) => weekDates.includes(w.date));
      const days = resolveClientWeekDays({
        clientId,
        weekDates,
        workouts: workoutDates,
        recurringHighDays: client?.preferred_high_days ?? null,
        highDayOverrides: (overridesRes.data ?? []) as any[],
        fullCardioRestDays: client?.full_cardio_rest_days ?? null,
        cardioTargets: (targetsRes.data ?? []) as any[],
      });
      // On a training day the plan's cardio is the last exercise of that day's workout
      // (program_cardio_sync): it's logged there, and that log is this card's too.
      const dayIds = [...new Set([...workoutDates.map((w) => w.workoutId), ...(workoutDayId ? [workoutDayId] : [])])];
      let linked: string[] = [];
      if (dayIds.length) {
        const { data } = await (supabase as any)
          .from("pl_exercise_rows")
          .select("day_id")
          .in("day_id", dayIds)
          .not("cardio_target_id", "is", null)
          .limit(500);
        linked = [...new Set(((data ?? []) as any[]).map((r) => r.day_id as string))];
      }
      return {
        days: days.map((d) => ({ date: d.date, cardioTargetId: d.cardioTargetId ?? null, cardioDayType: d.cardioDayType })),
        targets: (targetsRes.data ?? []) as any[],
        workoutsByDate: workoutDates.map((w) => ({ date: w.date, dayId: w.workoutId })),
        linked,
      };
    },
    // every cardio / schedule edit invalidates this key, so a minute is safe
    staleTime: 60_000,
  });

  let data: DayCardio | null = null;
  if (query.data) {
    const { days, targets, workoutsByDate, linked } = query.data;
    const day = days.find((d) => d.date === dateStr) ?? null;
    const target = day?.cardioTargetId ? targets.find((t) => t.id === day.cardioTargetId) ?? null : null;
    const linkedSet = new Set(linked);
    // the day's workouts, plus the workout this is shown inside (whatever date it's on)
    const candidates = [
      ...(workoutDayId ? [workoutDayId] : []),
      ...workoutsByDate.filter((w) => w.date === dateStr).map((w) => w.dayId),
    ];
    const hit = candidates.find((id) => linkedSet.has(id)) ?? null;
    data = { target, inWorkout: hit ? { dayId: hit } : null, dayType: day?.cardioDayType ?? null };
  }
  return { data, isLoading: query.isLoading, dateStr };
}

/**
 * The day's cardio as a card under a workout's lifting (the workout page), or a
 * one-line status (Nutrition). On the Workouts tab the day card holds it
 * instead (`useDayCardio`).
 */
export function ClientCardioSection({
  clientId,
  date,
  readonly = false,
  workoutDayId,
  variant = "card",
}: {
  clientId: string;
  /** Kept for older callers: nothing planned is never an empty card. */
  hideWhenEmpty?: boolean;
  /** Kept for older callers; the day type comes from the schedule. */
  dayContext?: "training" | "rest" | "unknown";
  date?: Date;
  readonly?: boolean;
  /** Shown inside this workout: when the workout holds the plan's cardio as its last exercise, the card steps aside. */
  workoutDayId?: string;
  /** "line": a one-line status (Nutrition) that opens where the cardio is logged; never a second card. */
  variant?: "card" | "line";
}) {
  const { data, isLoading, dateStr } = useDayCardio(clientId, date, workoutDayId);
  const inWorkout = data?.inWorkout ?? null;
  // In the workout itself the cardio is its last exercise: never a second card under it.
  if (workoutDayId && inWorkout?.dayId === workoutDayId) return null;
  if (variant === "line") {
    if (isLoading || !data?.target) return null;
    return <CardioStatusLine clientId={clientId} target={data.target} dateStr={dateStr} inWorkoutDayId={inWorkout?.dayId ?? null} />;
  }
  // A workout that day already holds it: shown and logged there only.
  if (inWorkout) return null;
  // nothing planned (or still loading): nothing to show, never an empty card
  if (isLoading || !data?.target) return null;

  return (
    <section className="space-y-2" aria-label="Cardio" data-cardio-fallback>
      {/* The same heading as the logger's own cardio part */}
      <div className="flex items-center gap-2 px-1 pt-3">
        <Activity className="h-4 w-4 text-muted-foreground" aria-hidden />
        <h2 className="text-base font-semibold">Cardio</h2>
        <span className="text-xs text-muted-foreground">Before, after or later in the day</span>
      </div>
      <CardioCompletionCard
        target={data.target}
        clientId={clientId}
        date={date}
        readonly={readonly}
      />
    </section>
  );
}

/**
 * One line for a page that isn't where cardio is logged (Nutrition): what today's session is and
 * whether it's done, opening the workout (a training day) or the Workouts tab (a day off). It
 * reads the same log as the card and the workout, so it's never out of step.
 */
function CardioStatusLine({ clientId, target, dateStr, inWorkoutDayId }: { clientId: string; target: any; dateStr: string; inWorkoutDayId: string | null }) {
  const { data: completion } = useQuery({
    queryKey: ["cardio-completion", clientId, target.id, dateStr],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("cardio_completions")
        .select("*")
        .eq("client_id", clientId)
        .eq("cardio_target_id", target.id)
        .eq("completed_date", dateStr)
        .limit(1);
      if (error) throw error;
      return ((data ?? []) as any[])[0] ?? null;
    },
    staleTime: 5_000,
  });
  const status = cardioStatus(completion as any);
  const what = `${(target.custom_type || target.cardio_type || "Cardio").trim()}${target.duration_minutes ? ` · ${target.duration_minutes} min` : ""}`;
  const where = inWorkoutDayId ? "Last exercise of today's workout" : "Log it in Workouts";
  const body = (
    <>
      <Activity className={status === "logged" ? "h-4 w-4 shrink-0 text-success" : "h-4 w-4 shrink-0 text-muted-foreground"} aria-hidden />
      <span className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="block truncate font-semibold">Cardio today · {what}</span>
        <span className="block text-muted-foreground">{status === "logged" ? "Done" : status === "skipped" ? "Skipped" : where}</span>
      </span>
      {status === "logged" ? <Check className="h-4 w-4 shrink-0 text-success" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const cls = "flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition active:scale-[0.99]";
  return inWorkoutDayId ? (
    <Link to="/portal/workouts/$dayId" params={{ dayId: inWorkoutDayId }} className={cls} data-cardio-line>{body}</Link>
  ) : (
    <Link to="/portal/workouts" className={cls} data-cardio-line>{body}</Link>
  );
}
