import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAY_TYPE_COPY,
  DAY_TYPE_INFO,
  DAY_TYPE_LABEL,
  type ClientNutritionDayType,
  type DayResolution,
} from "@/lib/client-nutrition-day";

type PlanChoice = {
  id: string;
  title: string;
};

/**
 * Read-only client nutrition guidance plus a selector for the exact plan-day
 * records returned by the active nutrition plan. The selector is ID-driven;
 * a coach-created title is display data only and is never used as a key.
 */
export function TodaysPlanHero({
  planChoices,
  selectedPlanId,
  automaticDayType,
  onSelectPlan,
  resolution,
  isManual,
  dateLabel,
}: {
  planChoices: PlanChoice[];
  selectedPlanId: string | null;
  automaticDayType: ClientNutritionDayType;
  onSelectPlan: (planDayId: string) => void;
  resolution: DayResolution | null;
  /** True when the client selected a different uploaded meal-plan record. */
  isManual: boolean;
  dateLabel: string;
}) {
  const selected = planChoices.find((choice) => choice.id === selectedPlanId) ?? null;
  const suggested = !!resolution?.suggested && !isManual;
  const highWeekday = resolution?.highWeekday ?? "Saturday";
  const automaticLabel =
    automaticDayType === "high" ? `High Day · ${highWeekday}` : DAY_TYPE_LABEL[automaticDayType];
  const headline = selected?.title ?? automaticLabel;

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">
          Today's Plan
        </h2>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarDays className="h-3 w-3" /> {dateLabel}
        </span>
        {isManual && selected && (
          <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Viewing saved plan
          </span>
        )}
        {suggested && (
          <span className="rounded-full border border-amber-500/50 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
            Suggested
          </span>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label="About nutrition day types"
              className="ml-auto grid h-8 w-8 place-items-center rounded-full border border-border text-muted-foreground transition hover:text-foreground"
            >
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-72 text-xs leading-relaxed">
            <p className="font-semibold">How your nutrition guidance works</p>
            <p className="mt-1 text-muted-foreground">{DAY_TYPE_INFO}</p>
            {resolution?.highWeekdayIsFallback && (
              <p className="mt-2 text-muted-foreground">
                Your coach hasn't picked a High Day yet, so {highWeekday} is shown as a suggestion
                only.
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="mt-3 text-2xl font-black leading-tight sm:text-3xl">{headline}</div>
      <p className="mt-1 text-sm text-muted-foreground">
        {selected
          ? "Choose any saved plan below to review its exact meals and targets."
          : DAY_TYPE_COPY[automaticDayType]}
      </p>

      {planChoices.length > 0 && (
        <div
          className="mt-4 flex flex-wrap gap-2"
          role="group"
          aria-label="Select an uploaded meal plan"
        >
          {planChoices.map((choice) => (
            <Button
              key={choice.id}
              type="button"
              variant={choice.id === selectedPlanId ? "default" : "outline"}
              className={cn(
                "min-h-11 text-left text-[12px] font-bold",
                choice.id === selectedPlanId && "shadow-sm",
              )}
              aria-pressed={choice.id === selectedPlanId}
              onClick={() => onSelectPlan(choice.id)}
            >
              {choice.title}
            </Button>
          ))}
        </div>
      )}
    </Card>
  );
}
