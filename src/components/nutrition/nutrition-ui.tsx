/**
 * The pieces every card on the coach's Nutrition tab is built from, so the
 * three cards (Nutrition update, Current plan, Cardio) read as one screen:
 * a 16px sentence-case title with its icon, a status chip only when it's news,
 * day rows that fit a phone, and sections that open in place.
 */
import {
  forwardRef,
  useState,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { ChevronDown, MoreHorizontal, Target, Utensils, Zap } from "lucide-react";
import { structureMealPlanDay, type PlanMacros } from "@/lib/nutrition-targets/meal-plan-structure";
import { MEAL_TIMING_LABEL } from "@/lib/nutrition-targets/meal-timing";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { MacroTargetsChart, type TargetExtra } from "@/components/nutrition/MacroTargetsChart";
import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "done" | "attention" | "error";

const CHIP: Record<ChipTone, string> = {
  neutral: "border-border text-muted-foreground",
  done: "border-success/40 text-success",
  attention: "border-warning/40 text-warning",
  error: "border-destructive/40 text-destructive",
};

/** A status in words. Green = done, amber = needs you, red = failed; anything else is plain. */
export function StatusChip({
  tone = "neutral",
  children,
}: {
  tone?: ChipTone;
  children: ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex h-6 shrink-0 items-center rounded-full border px-2.5 text-xs font-medium",
        CHIP[tone],
      )}
    >
      {children}
    </span>
  );
}

/** A card's title row: icon, title, an optional chip, and its actions on the right. */
export function CardHeader({
  icon: Icon,
  title,
  chip,
  actions,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  chip?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex min-h-10 items-center gap-2">
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      {/* The chip drops under the title when a phone hasn't room for both. */}
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="text-base font-semibold">{title}</h3>
        {chip}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-1">{actions}</div> : null}
    </div>
  );
}

/** The ⋯ button that opens a card's menu (inside a DropdownMenuTrigger asChild, so it forwards its ref). */
export const MoreButton = forwardRef<
  HTMLButtonElement,
  { label: string } & ComponentProps<typeof Button>
>(({ label, ...props }, ref) => (
  <Button ref={ref} variant="ghost" size="icon" className="h-10 w-10" aria-label={label} {...props}>
    <MoreHorizontal className="h-5 w-5" />
  </Button>
));
MoreButton.displayName = "MoreButton";

export type DayRow = {
  label: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  /** More for the line under the macros, e.g. "10,000 steps · 15 min cardio". */
  extra?: string | null;
  /** The day's meal text: when there is one, tapping the row opens its meals. */
  meals?: string | null;
};

const n = (v: number | null | undefined) => (v == null ? "—" : Math.round(v));

/** Each day type's calories and macros, one row each: label and calories, the macros under it; a day with meals opens to show them. */
export function DayRows({ rows }: { rows: DayRow[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (!rows.length) return null;
  return (
    <div className="divide-y divide-border rounded-xl border border-border" data-day-rows>
      {rows.map((r, i) => {
        const key = `${i}-${r.label}`;
        const hasMeals = !!r.meals?.trim();
        const isOpen = open === key;
        const line = (
          <>
            <div className="min-w-0">
              <div className="text-[15px] font-medium">{r.label}</div>
              <div className="mt-0.5 text-[13px] tabular-nums text-muted-foreground">
                P {n(r.protein)} · C {n(r.carbs)} · F {n(r.fat)}
                {r.extra ? (
                  <span className="block sm:inline">
                    <span className="hidden sm:inline"> · </span>
                    {r.extra}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <div className="text-right text-[15px] font-semibold tabular-nums">
                {n(r.kcal)}{" "}
                <span className="text-[13px] font-normal text-muted-foreground">kcal</span>
              </div>
              {hasMeals ? (
                <ChevronDown
                  className={cn(
                    "h-4 w-4 text-muted-foreground transition-transform",
                    isOpen && "rotate-180",
                  )}
                  aria-hidden
                />
              ) : null}
            </div>
          </>
        );
        return (
          <div key={key}>
            {hasMeals ? (
              <button
                type="button"
                className="flex w-full items-start justify-between gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
                aria-expanded={isOpen}
                onClick={() => setOpen(isOpen ? null : key)}
              >
                {line}
              </button>
            ) : (
              <div className="flex items-start justify-between gap-3 px-3 py-2.5">{line}</div>
            )}
            {hasMeals && isOpen ? (
              <div className="px-3 pb-3">
                <DayMeals text={r.meals!} />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/** A meal's calories from its macros (4 / 4 / 9), when all three are written. */
export function mealKcal(m: PlanMacros | null): number | null {
  if (!m || m.protein == null || m.carbs == null || m.fat == null) return null;
  return Math.round(m.protein * 4 + m.carbs * 4 + m.fat * 9);
}

/** A day's meals as the client reads them: each meal a card with its calories, its foods (name left, amount right) and its macros. */
export function DayMeals({ text }: { text: string }) {
  const day = structureMealPlanDay(text);
  if (!day.meals.length)
    return <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{text.trim()}</p>;
  return (
    <div className="space-y-2" data-day-meals>
      {day.meals.map((m, i) => {
        const kcal = mealKcal(m.macros);
        return (
          <div key={i} className="rounded-xl border border-border px-3 py-2.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="min-w-0 truncate text-[15px] font-medium">{m.title}</span>
              {kcal != null ? (
                <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">
                  {kcal.toLocaleString("en-US")} kcal
                </span>
              ) : null}
            </div>
            {m.timing ? (
              <div className="mt-0.5 inline-flex items-center gap-1 text-xs text-muted-foreground">
                <Zap className="h-3 w-3" aria-hidden />
                {MEAL_TIMING_LABEL[m.timing]}
              </div>
            ) : null}
            <ul className="mt-1.5 space-y-1">
              {m.foods.map((f, k) => (
                <li key={k} className="flex justify-between gap-3 text-[14px]">
                  <span className="min-w-0">{f.name}</span>
                  <span className="shrink-0 whitespace-nowrap tabular-nums text-muted-foreground">
                    {f.amount}
                  </span>
                </li>
              ))}
              {m.notes.map((t, k) => (
                <li key={`n${k}`} className="text-[13px] text-muted-foreground">
                  {t}
                </li>
              ))}
            </ul>
            {m.macros ? (
              <div className="mt-2 border-t border-border pt-1.5 text-xs tabular-nums text-muted-foreground">
                P {n(m.macros.protein)} · C {n(m.macros.carbs)} · F {n(m.macros.fat)}
              </div>
            ) : null}
          </div>
        );
      })}
      {day.notes.length ? (
        <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
          {day.notes.join("\n")}
        </p>
      ) : null}
    </div>
  );
}

/** A plan day for `PlanDaysView`. */
export type PlanViewDay = {
  label: string;
  kcal: number | null;
  protein: number | null;
  carbs: number | null;
  fat: number | null;
  fibre?: number | null;
  /** The day's total steps. */
  steps?: number | null;
  /** The day's cardio, in words ("15 min walk", "none"). */
  cardio?: string | null;
  /** The day's meal text (the paste format). */
  meals?: string | null;
  /** The same day on the plan they're on now, to compare a new plan against. */
  was?: { kcal: number | null; protein: number | null; carbs: number | null; fat: number | null } | null;
};

const fmt = (v: number | null | undefined) => (v == null ? "—" : Math.round(v).toLocaleString("en-US"));

/**
 * A plan, a day at a time, so its numbers and its food never blur together:
 * the day types as chips (each with its calories, so the days compare at a
 * glance), then the day's **Targets** as the client sees them (the calorie
 * ring split by protein / carbs / fat, the grams, steps, cardio, water), then
 * its **Meal plan** as meal cards. Used by the coach's Current plan and the
 * AI plan's review.
 */
export function PlanDaysView({
  days,
  water,
  waterNote,
  onWater,
  compareLabel = "Now",
}: {
  days: PlanViewDay[];
  /** The plan's water, in words ("3.5 L"). */
  water?: string | null;
  /** A small line under it ("automatic"). */
  waterNote?: string | null;
  /** Tapping water edits it. */
  onWater?: () => void;
  /** What `was` is called ("Now": their current plan). */
  compareLabel?: string;
}) {
  const [picked, setPicked] = useState(0);
  if (!days.length) return null;
  const i = Math.min(picked, days.length - 1);
  const d = days[i];
  const extras: TargetExtra[] = [
    d.steps != null ? { label: "Steps", value: Math.round(d.steps).toLocaleString("en-US") } : null,
    d.cardio ? { label: "Cardio", value: d.cardio } : null,
    water ? { label: "Water", value: water, note: waterNote ?? undefined, onClick: onWater } : null,
    d.fibre != null ? { label: "Fibre", value: `${Math.round(d.fibre)} g` } : null,
  ].filter(Boolean) as TargetExtra[];
  const mealCount = d.meals ? structureMealPlanDay(d.meals).meals.length : 0;
  const delta = d.was?.kcal != null && d.kcal != null ? Math.round(d.kcal - d.was.kcal) : null;
  return (
    <div className="space-y-4" data-plan-days>
      {days.length > 1 ? (
        <div
          className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none] md:-mx-6 md:px-6 [&::-webkit-scrollbar]:hidden"
          role="group"
          aria-label="Day type"
        >
          {days.map((x, k) => {
            const on = k === i;
            return (
              <button
                key={`${k}-${x.label}`}
                type="button"
                aria-pressed={on}
                onClick={() => setPicked(k)}
                className={cn(
                  "flex min-h-12 shrink-0 flex-col items-start justify-center rounded-xl px-3 py-1.5 text-left transition-colors",
                  on ? "bg-foreground text-background" : "border border-border bg-card hover:bg-muted/60",
                )}
              >
                <span className="whitespace-nowrap text-[13px] font-medium">{x.label}</span>
                <span className={cn("whitespace-nowrap text-[13px] tabular-nums", on ? "text-background/75" : "text-muted-foreground")}>
                  {fmt(x.kcal)} kcal
                </span>
              </button>
            );
          })}
        </div>
      ) : null}

      <section className="space-y-3" data-plan-targets aria-label={`${d.label} targets`}>
        <h4 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Target className="h-4 w-4 text-muted-foreground" aria-hidden /> Targets
          {days.length === 1 ? <span className="font-normal text-muted-foreground">· {d.label}</span> : null}
        </h4>
        {/* the client's ring, at the width it reads best */}
        <div className="max-w-md">
          <MacroTargetsChart
            calories={d.kcal}
            protein={d.protein}
            carbs={d.carbs}
            fats={d.fat}
            extras={extras}
            voice="coach"
          />
        </div>
        {d.was ? (
          <p className="text-[13px] tabular-nums text-muted-foreground" data-plan-compare>
            {compareLabel}: {fmt(d.was.kcal)} kcal · P {fmt(d.was.protein)} · C {fmt(d.was.carbs)} · F {fmt(d.was.fat)}
            {delta ? (
              <span className="font-medium text-foreground"> ({delta > 0 ? "+" : "−"}{Math.abs(delta).toLocaleString("en-US")} kcal)</span>
            ) : null}
          </p>
        ) : null}
      </section>

      <section className="space-y-2 border-t border-border pt-4" data-plan-meals aria-label={`${d.label} meal plan`}>
        <h4 className="flex items-center gap-1.5 text-[15px] font-semibold">
          <Utensils className="h-4 w-4 text-muted-foreground" aria-hidden /> Meal plan
          {mealCount ? <span className="font-normal text-muted-foreground">· {mealCount} {mealCount === 1 ? "meal" : "meals"}</span> : null}
        </h4>
        {d.meals?.trim() ? (
          <DayMeals text={d.meals} />
        ) : (
          <p className="text-[13px] text-muted-foreground">No meals written for this day.</p>
        )}
      </section>
    </div>
  );
}

/** A row that opens in place (inside an `<Accordion type="multiple">`). */
export function Section({
  value,
  title,
  meta,
  sub,
  icon: Icon,
  children,
}: {
  value: string;
  title: string;
  /** Short, on the right of the title. */
  meta?: ReactNode;
  /** A line under the title, for what's too long to sit beside it (a day's macros). */
  sub?: ReactNode;
  icon?: ComponentType<{ className?: string }>;
  children: ReactNode;
}) {
  return (
    <AccordionItem value={value} className="border-b border-border last:border-b-0">
      <AccordionTrigger className="min-h-12 gap-3 px-3 py-3 font-normal hover:no-underline">
        <span className="flex min-w-0 flex-1 items-center gap-3">
          {Icon ? <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden /> : null}
          {sub ? (
            <span className="min-w-0 text-left">
              <span className="block truncate text-[15px] font-medium">{title}</span>
              <span className="mt-0.5 block truncate text-[13px] tabular-nums text-muted-foreground">
                {sub}
              </span>
            </span>
          ) : (
            <span className="shrink-0 text-[15px] font-medium">{title}</span>
          )}
          {meta ? (
            <span className="ml-auto min-w-0 truncate text-right text-[13px] text-muted-foreground">
              {meta}
            </span>
          ) : null}
        </span>
      </AccordionTrigger>
      <AccordionContent className="px-3 pb-4 pt-0">{children}</AccordionContent>
    </AccordionItem>
  );
}

/** A row that does something when tapped (Water, Grocery list): title, what it says now, and a chevron or action. */
export function ActionRow({
  icon: Icon,
  title,
  value,
  onClick,
  disabled,
  trailing,
}: {
  icon: ComponentType<{ className?: string }>;
  title: string;
  value?: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  trailing?: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex min-h-12 w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/40 active:bg-muted/60 disabled:pointer-events-none disabled:opacity-50"
    >
      <Icon className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
      <span className="shrink-0 text-[15px] font-medium">{title}</span>
      {value ? (
        <span className="ml-auto min-w-0 truncate text-right text-[13px] text-muted-foreground">
          {value}
        </span>
      ) : (
        <span className="ml-auto" />
      )}
      {trailing}
    </button>
  );
}
