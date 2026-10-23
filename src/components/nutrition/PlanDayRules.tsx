/**
 * When each saved plan day is used, in the coach's targets editor: a "Used
 * on" pick and the weekdays it's limited to (both read from the day's name
 * until the coach changes them), and this week as the client will see it,
 * date by date, through the same rule the client's Nutrition page uses
 * (`pickPlanDayForDate`). A date with no plan day shows up here first.
 */

import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { getClientWorkouts } from "@/lib/pl-programs";
import { mondayWeekDates, resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { parseLocalDate, todayLocalISO, toLocalISO } from "@/lib/today";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";
import {
  PLAN_DAY_USES,
  PLAN_DAY_USE_LABEL,
  pickPlanDayForDate,
  planDayRule,
  resolveClientNutritionDay,
  weekdayForISO,
  type PlanDayLike,
  type PlanDayUse,
} from "@/lib/client-nutrition-day";

/** "Used on" + "Only on" for one plan day. */
export function PlanDayUseEditor({
  day,
  planSize,
  onChange,
}: {
  day: PlanDayLike;
  planSize: number;
  onChange: (rule: { use_on: PlanDayUse; weekdays: WeekDay[] }) => void;
}) {
  const rule = planDayRule(day, planSize);
  const use = rule.use ?? "manual";
  // once the coach sets either, both are theirs: a rename never half-changes it
  const toggle = (d: WeekDay) => {
    const on = rule.weekdays.includes(d);
    onChange({
      use_on: use,
      weekdays: WEEK_DAYS.filter((w) => (w === d ? !on : rule.weekdays.includes(w))),
    });
  };
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2" data-plan-day-rule>
      <div className="flex items-center gap-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
          Used on
        </span>
        <Select
          value={use}
          onValueChange={(v) => onChange({ use_on: v as PlanDayUse, weekdays: rule.weekdays })}
        >
          <SelectTrigger className="h-8 w-[150px] text-xs font-semibold">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAN_DAY_USES.map((u) => (
              <SelectItem key={u} value={u} className="text-xs">
                {PLAN_DAY_USE_LABEL[u]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      {use !== "manual" && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
            {rule.weekdays.length ? "Only on" : "Any day · or only on"}
          </span>
          <div className="flex gap-1" role="group" aria-label="Only on these weekdays">
            {WEEK_DAYS.map((d) => {
              const on = rule.weekdays.includes(d);
              return (
                <button
                  key={d}
                  type="button"
                  aria-pressed={on}
                  aria-label={d}
                  title={d}
                  onClick={() => toggle(d)}
                  className={cn(
                    "grid h-7 w-7 place-items-center rounded-full text-[11px] font-bold transition-colors",
                    on
                      ? "bg-primary text-primary-foreground"
                      : "border border-border bg-card text-muted-foreground hover:bg-muted",
                  )}
                >
                  {d.slice(0, 2)}
                </button>
              );
            })}
          </div>
        </div>
      )}
      {rule.useFromName && rule.weekdaysFromName && (
        <span className="text-[10px] text-muted-foreground">
          Read from the name · change it anytime
        </span>
      )}
    </div>
  );
}

const KIND_LABEL: Record<string, string> = {
  training: "Training",
  non_training: "Rest",
  high: "High Day",
};

const KIND_TONE: Record<string, string> = {
  training: "text-primary",
  non_training: "text-muted-foreground",
  high: "text-amber-500",
};

/** This week, date by date, as the client's Nutrition page will pick it. */
export function PlanDayWeekPreview({
  clientId,
  days,
}: {
  clientId?: string | null;
  days: PlanDayLike[];
}) {
  const today = todayLocalISO();
  const q = useQuery({
    queryKey: ["plan-day-week-preview", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const [clientRes, overridesRes, workouts] = await Promise.all([
        supabase
          .from("clients")
          .select("committed_training_days, preferred_high_days")
          .eq("id", clientId!)
          .maybeSingle(),
        (supabase.from("nutrition_day_overrides") as any)
          .select("override_date,day_label")
          .eq("client_id", clientId!),
        getClientWorkouts(clientId!),
      ]);
      const c = clientRes.data as any;
      return {
        preferredHighDays: (c?.preferred_high_days as string[] | null) ?? null,
        overrides: (overridesRes.data ?? []) as { override_date: string; day_label: string }[],
        workoutDates: resolveWorkoutDatesFromItems(
          workouts as any[],
          c?.committed_training_days ?? null,
        ).map((w) => w.date),
      };
    },
  });
  if (!clientId || days.length === 0) return null;

  const now = parseLocalDate(today)!;
  const monday = new Date(now);
  monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  const week = mondayWeekDates(toLocalISO(monday));
  const rows = week.map((dateISO) => {
    const r = resolveClientNutritionDay({
      dateISO,
      overrides: q.data?.overrides ?? null,
      preferredHighDays: q.data?.preferredHighDays ?? null,
      workoutDates: q.data?.workoutDates ?? null,
      scheduleKnown: !!q.data,
    });
    const pick = pickPlanDayForDate(days, {
      dayType: r.dayType,
      baseType: r.baseType,
      weekday: weekdayForISO(dateISO),
    });
    return { dateISO, kind: pick.dayType, day: pick.index >= 0 ? days[pick.index] : null };
  });

  return (
    <div className="rounded-md border border-border bg-card p-3" data-plan-week-preview>
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-xs uppercase tracking-widest text-muted-foreground">
          This week for the client
        </h4>
        <span className="text-[10px] text-muted-foreground">
          {q.isLoading
            ? "Reading their schedule…"
            : "From their workouts, High Day and day overrides"}
        </span>
      </div>
      <ul className="grid gap-x-4 gap-y-1 md:grid-cols-2">
        {rows.map(({ dateISO, kind, day }) => (
          <li
            key={dateISO}
            className={cn(
              "flex min-w-0 items-center gap-2 rounded px-1.5 py-1 text-xs",
              dateISO === today && "bg-primary/10",
            )}
          >
            <span className="w-[84px] shrink-0 whitespace-nowrap font-semibold">
              {format(parseLocalDate(dateISO)!, "EEE MMM d")}
            </span>
            <span className={cn("w-[58px] shrink-0 text-[11px] font-bold", KIND_TONE[kind])}>
              {KIND_LABEL[kind]}
            </span>
            {day ? (
              <span className="min-w-0 truncate">
                {String(day.day_label ?? "").trim() || "Untitled day"}
              </span>
            ) : (
              <span className="min-w-0 truncate font-semibold text-amber-500">
                No plan for this day
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
