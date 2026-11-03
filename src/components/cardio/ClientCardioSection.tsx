/**
 * ClientCardioSection — the client's cardio for a date, shown once.
 *
 * One place per day: on a training day the cardio plan's session is the last
 * exercise of that day's workout (program_cardio_sync), so it's logged there and
 * nothing else shows it as a card (the Workouts tab and the workout page step
 * aside); on a day off this card is where it's logged (the Workouts tab).
 * `variant="line"` (Nutrition) is a one-line status that opens where it's logged.
 *
 * Day-type filtering:
 *   - "training" → shows "Training Day" and "General" targets
 *   - "rest"     → shows "Rest Day" and "General" targets
 *   - "unknown"  → shows all targets (no filter)
 *
 * Each target shows a CardioCompletionCard with a one-tap complete toggle
 * and an expandable log form (duration, type, RPE, notes).
 *
 * Admin/coach view is read-only.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Loader2, Heart, Check, ChevronRight } from "lucide-react";
import { cardioStatus } from "@/lib/cardio-plan";
import { supabase } from "@/integrations/supabase/client";
import { CardioCompletionCard } from "./CardioCompletionCard";
import { clientWorkoutsQuery, primaryWorkouts } from "@/lib/client-workouts-query";
import type { WorkoutItem } from "@/lib/workout-today";
import { mondayWeekDates, resolveClientWeekDays, resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { parseLocalDate, todayLocalISO, toLocalISO } from "@/lib/today";

type DayContext = "training" | "rest" | "unknown";

export function ClientCardioSection({
  clientId,
  hideWhenEmpty = false,
  dayContext = "unknown",
  date,
  readonly = false,
  workoutDayId,
  variant = "card",
}: {
  clientId: string;
  hideWhenEmpty?: boolean;
  /** Whether today is a training day, rest day, or unknown */
  dayContext?: DayContext;
  date?: Date;
  readonly?: boolean;
  /** Shown inside this workout: when the workout holds the plan's cardio as its last exercise, the card steps aside. */
  workoutDayId?: string;
  /** "line": a one-line status (Nutrition) that opens where the cardio is logged; never a second card. */
  variant?: "card" | "line";
}) {
  const dateStr = date ? toLocalISO(date) : todayLocalISO();
  const qc = useQueryClient();
  const { data: resolved, isLoading } = useQuery({
    queryKey: ["client-cardio-resolved", clientId, dateStr],
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
        // reused instead of re-running the whole program chain for every date.
        qc.fetchQuery(clientWorkoutsQuery(clientId)).then((items) => primaryWorkouts(items as WorkoutItem[])),
      ]);
      if (targetsRes.error) throw targetsRes.error;
      const targetDate = parseLocalDate(dateStr) ?? new Date();
      const monday = new Date(targetDate);
      monday.setDate(targetDate.getDate() - ((targetDate.getDay() + 6) % 7));
      const weekDates = mondayWeekDates(monday);
      const client = clientRes.data as any;
      const workoutDates = resolveWorkoutDatesFromItems(workouts as any[], client?.committed_training_days ?? null);
      const day = resolveClientWeekDays({
        clientId,
        weekDates,
        workouts: workoutDates,
        recurringHighDays: client?.preferred_high_days ?? null,
        highDayOverrides: (overridesRes.data ?? []) as any[],
        fullCardioRestDays: client?.full_cardio_rest_days ?? null,
        cardioTargets: (targetsRes.data ?? []) as any[],
      }).find((d) => d.date === dateStr) ?? null;
      const target = day?.cardioTargetId
        ? ((targetsRes.data ?? []) as any[]).find((t) => t.id === day.cardioTargetId) ?? null
        : null;
      // On a training day the plan's cardio is the last exercise of that day's workout
      // (program_cardio_sync): it's logged there, and that log is this card's too.
      let inWorkout: { dayId: string } | null = null;
      // the day's workouts, plus the workout this is shown inside (whatever date it's on)
      const dayIds = [...new Set([...workoutDates.filter((w) => w.date === dateStr).map((w) => w.workoutId), ...(workoutDayId ? [workoutDayId] : [])])];
      if (dayIds.length) {
        const { data: linked } = await (supabase as any)
          .from("pl_exercise_rows")
          .select("day_id")
          .in("day_id", dayIds)
          .not("cardio_target_id", "is", null)
          .limit(1);
        inWorkout = linked?.[0]?.day_id ? { dayId: linked[0].day_id as string } : null;
      }
      return { day, target, inWorkout };
    },
    // every cardio / schedule edit invalidates this key, so a minute is safe
    staleTime: 60_000,
  });

  const filteredTargets = resolved?.target ? [resolved.target] : [];
  const inWorkout = resolved?.inWorkout ?? null;
  // In the workout itself the cardio is its last exercise: never a second card under it.
  if (workoutDayId && inWorkout?.dayId === workoutDayId) return null;
  // On the Workouts tab a training day's cardio is inside that day's workout: shown and logged there only.
  if (variant === "card" && inWorkout) return null;
  if (variant === "line") {
    if (isLoading || !resolved?.target) return null;
    return <CardioStatusLine clientId={clientId} target={resolved.target} dateStr={dateStr} inWorkoutDayId={inWorkout?.dayId ?? null} />;
  }
  // Day classification is nutrition/day context — it is never part of the
  // cardio activity name, so it renders as subtle secondary text only.
  const resolvedLabel = resolved?.day?.cardioDayType === "high"
    ? "High Day"
    : resolved?.day?.cardioDayType === "training"
      ? "Training Day"
      : resolved?.day?.cardioDayType === "rest"
        ? "Full Cardio Rest"
        : "Non-Training Day";

  if (isLoading) {
    return (
      <Card className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading cardio…
      </Card>
    );
  }

  if (!filteredTargets.length) {
    if (hideWhenEmpty) return null;
    return (
      <Card className="p-4 sm:p-6">
        <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4 shrink-0" /> Cardio
        </h2>
        {resolved?.day?.cardioDayType === "rest" ? (
          <p className="mt-3 text-sm text-muted-foreground">Full Cardio Rest — no cardio scheduled.</p>
        ) : dayContext === "rest" ? (
          <p className="mt-3 text-sm text-muted-foreground">No cardio scheduled for this date.</p>
        ) : (
          <p className="mt-3 text-sm text-muted-foreground">No cardio assigned.</p>
        )}
      </Card>
    );
  }

  return (
    <div className="space-y-3">
      <div className="px-0.5">
        <h2 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <Heart className="h-4 w-4 shrink-0" /> Cardio
        </h2>
        <p className="mt-0.5 text-[11px] text-muted-foreground/80">Today's plan: {resolvedLabel}</p>
      </div>
      {filteredTargets.map((t: any) => (
        <CardioCompletionCard
          key={t.id}
          target={t}
          clientId={clientId}
          date={date}
          readonly={readonly}
        />
      ))}
    </div>
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
      <Heart className={status === "logged" ? "h-4 w-4 shrink-0 text-emerald-500" : "h-4 w-4 shrink-0 text-muted-foreground"} />
      <span className="min-w-0 flex-1 text-[13px] leading-snug">
        <span className="block truncate font-semibold">Cardio today · {what}</span>
        <span className="block text-muted-foreground">{status === "logged" ? "Done" : status === "skipped" ? "Skipped" : where}</span>
      </span>
      {status === "logged" ? <Check className="h-4 w-4 shrink-0 text-emerald-500" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />}
    </>
  );
  const cls = "flex items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition active:scale-[0.99]";
  return inWorkoutDayId ? (
    <Link to="/portal/workouts/$dayId" params={{ dayId: inWorkoutDayId }} className={cls} data-cardio-line>{body}</Link>
  ) : (
    <Link to="/portal/workouts" className={cls} data-cardio-line>{body}</Link>
  );
}
