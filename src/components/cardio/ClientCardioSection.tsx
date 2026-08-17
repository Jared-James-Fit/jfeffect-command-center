/**
 * ClientCardioSection — shows cardio targets for the client/member workout page.
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

import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Loader2, Heart } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { CardioCompletionCard } from "./CardioCompletionCard";
import { getClientWorkouts } from "@/lib/pl-programs";
import { mondayWeekDates, resolveClientWeekDays, resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { parseLocalDate, todayLocalISO, toLocalISO } from "@/lib/today";

type DayContext = "training" | "rest" | "unknown";

export function ClientCardioSection({
  clientId,
  hideWhenEmpty = false,
  dayContext = "unknown",
  date,
  readonly = false,
}: {
  clientId: string;
  hideWhenEmpty?: boolean;
  /** Whether today is a training day, rest day, or unknown */
  dayContext?: DayContext;
  date?: Date;
  readonly?: boolean;
}) {
  const dateStr = date ? toLocalISO(date) : todayLocalISO();
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
        getClientWorkouts(clientId),
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
      return { day, target };
    },
    staleTime: 0,
    refetchOnMount: "always",
  });

  const filteredTargets = resolved?.target ? [resolved.target] : [];
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
