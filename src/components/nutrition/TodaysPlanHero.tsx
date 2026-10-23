import { useLayoutEffect, useRef } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
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
 * Which day's plan the page shows: one line (today's date, the ⓘ), then the
 * coach's saved plan days as one row of chips, today's marked with a dot.
 * The targets and meal plan under it follow the chip that's on, and "Back to
 * today" shows only while another one is. Slim on purpose: the targets card
 * right under it already names the day, so this is a switch, not a hero.
 * The selector is ID-driven; a coach-created title is display data only and
 * is never used as a key.
 */
export function TodaysPlanHero({
  planChoices,
  selectedPlanId,
  todayPlanId,
  automaticDayType,
  onSelectPlan,
  resolution,
  isManual,
  dateLabel,
}: {
  planChoices: PlanChoice[];
  selectedPlanId: string | null;
  /** The plan day that matches today (what "Back to today" returns to). */
  todayPlanId: string | null;
  automaticDayType: ClientNutritionDayType;
  onSelectPlan: (planDayId: string) => void;
  resolution: DayResolution | null;
  /** True when the client selected a different uploaded meal-plan record. */
  isManual: boolean;
  dateLabel: string;
}) {
  const suggested = !!resolution?.suggested && !isManual;
  const highWeekday = resolution?.highWeekday ?? "Saturday";
  const automaticLabel =
    automaticDayType === "high" ? `High Day · ${highWeekday}` : DAY_TYPE_LABEL[automaticDayType];
  // one saved day (or none): nothing to pick, so the line just says what today is
  const picking = planChoices.length > 1;
  const todayTitle = planChoices.find((c) => c.id === todayPlanId)?.title ?? automaticLabel;

  // the chip that's on is always in view (the row scrolls sideways on a phone)
  const row = useRef<HTMLDivElement | null>(null);
  const placed = useRef(false);
  useLayoutEffect(() => {
    const el = row.current;
    const chip = el?.querySelector<HTMLElement>('[aria-pressed="true"]');
    if (!el || !chip) return;
    const left = chip.offsetLeft - el.offsetLeft;
    const fits = left >= el.scrollLeft && left + chip.offsetWidth <= el.scrollLeft + el.clientWidth;
    if (!fits) el.scrollTo({ left: left - (el.clientWidth - chip.offsetWidth) / 2, behavior: placed.current ? "smooth" : "auto" });
    placed.current = true;
  }, [selectedPlanId, picking]);

  return (
    <section aria-label="Today's plan" className="space-y-2" data-todays-plan>
      <div className="flex min-h-8 items-center gap-2 px-0.5">
        <h2 className="min-w-0 truncate text-[13px] font-bold text-muted-foreground">
          <span className="text-foreground">Today</span> · {dateLabel}
          {!picking && <> · <span className="text-foreground">{todayTitle}</span></>}
        </h2>
        {suggested && (
          <span className="shrink-0 rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-amber-500">
            Suggested
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {isManual && todayPlanId && (
            <button
              type="button"
              onClick={() => onSelectPlan(todayPlanId)}
              className="h-8 rounded-full px-2.5 text-[12px] font-bold text-primary active:bg-primary/10"
              data-plan-back-to-today
            >
              Back to today
            </button>
          )}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                aria-label="About nutrition day types"
                className="grid h-8 w-8 place-items-center rounded-full text-muted-foreground transition hover:text-foreground active:bg-muted"
              >
                <Info className="h-[18px] w-[18px]" />
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
      </div>

      {picking && (
        <div
          ref={row}
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0 [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Select an uploaded meal plan"
        >
          {planChoices.map((choice) => {
            const on = choice.id === selectedPlanId;
            const today = choice.id === todayPlanId;
            return (
              <button
                key={choice.id}
                type="button"
                aria-pressed={on}
                onClick={() => onSelectPlan(choice.id)}
                className={cn(
                  "inline-flex h-10 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-4 text-[13px] font-bold transition-colors active:scale-[0.97]",
                  on
                    ? "bg-primary text-primary-foreground shadow-sm"
                    : "border border-border bg-card text-foreground active:bg-muted",
                )}
              >
                {/* today's plan, when it isn't the one on */}
                {today && !on && <span aria-label="Today" className="h-1.5 w-1.5 rounded-full bg-primary" />}
                {choice.title}
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
}
