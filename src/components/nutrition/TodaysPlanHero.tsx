/**
 * TODAY'S PLAN hero — the single, prominent day-type surface on the client
 * Nutrition page. Purely presentational: it renders the day type owned by the
 * Nutrition container and reports manual VIEW switches back up. It never
 * writes to coach data or persists a selection.
 */

import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Info, CalendarDays } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DAY_TYPE_COPY,
  DAY_TYPE_INFO,
  DAY_TYPE_LABEL,
  type ClientNutritionDayType,
  type DayResolution,
} from "@/lib/client-nutrition-day";

const ORDER: ClientNutritionDayType[] = ["training", "non_training", "high"];

export function TodaysPlanHero({
  selected,
  onSelect,
  resolution,
  isManual,
  dateLabel,
}: {
  selected: ClientNutritionDayType;
  onSelect: (t: ClientNutritionDayType) => void;
  resolution: DayResolution | null;
  /** True when the client manually switched away from the detected day. */
  isManual: boolean;
  dateLabel: string;
}) {
  const suggested = !!resolution?.suggested && !isManual;
  const highWeekday = resolution?.highWeekday ?? "Saturday";

  const headline =
    selected === "high"
      ? `High Day · ${highWeekday}`
      : DAY_TYPE_LABEL[selected];

  const copy = DAY_TYPE_COPY[selected];

  return (
    <Card className="border-primary/30 bg-gradient-to-br from-primary/15 via-card to-card p-5 md:p-6">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-[11px] font-black uppercase tracking-[0.2em] text-primary">Today's Plan</h2>
        <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
          <CalendarDays className="h-3 w-3" /> {dateLabel}
        </span>
        {isManual && (
          <span className="rounded-full border border-border bg-secondary/50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
            Viewing {DAY_TYPE_LABEL[selected]}
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
            <p className="font-semibold">How your day types work</p>
            <p className="mt-1 text-muted-foreground">{DAY_TYPE_INFO}</p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><span className="font-semibold text-foreground">Training</span> — {DAY_TYPE_COPY.training}</li>
              <li><span className="font-semibold text-foreground">Rest Day</span> — {DAY_TYPE_COPY.non_training}</li>
              <li><span className="font-semibold text-foreground">High Day</span> — {DAY_TYPE_COPY.high}</li>
            </ul>
            {resolution?.highWeekdayIsFallback && (
              <p className="mt-2 text-muted-foreground">
                Your coach hasn't picked a High Day yet, so {highWeekday} is shown as a suggestion.
              </p>
            )}
          </PopoverContent>
        </Popover>
      </div>

      <div className="mt-3 text-2xl font-black leading-tight sm:text-3xl">{headline}</div>
      <p className="mt-1 text-sm text-muted-foreground">{copy}</p>
      <p className="mt-2 text-[11px] text-muted-foreground">{DAY_TYPE_INFO}</p>

      <div
        className="mt-4 grid grid-cols-3 gap-2"
        role="group"
        aria-label="Select which nutrition day to view"
      >
        {ORDER.map((t) => (
          <Button
            key={t}
            type="button"
            variant={t === selected ? "default" : "outline"}
            className={cn("h-11 text-[12px] font-bold", t === selected && "shadow-sm")}
            aria-pressed={t === selected}
            onClick={() => onSelect(t)}
          >
            {DAY_TYPE_LABEL[t]}
          </Button>
        ))}
      </div>
    </Card>
  );
}
