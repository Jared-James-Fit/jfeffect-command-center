import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Droplets, Dumbbell, GalleryHorizontalEnd, Rows3, Zap } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import {
  MealTimingBadge,
  TOTAL_HEADING,
  MEAL_HEADING,
  parseMealPlanText,
  type MealPlanSection,
} from "@/components/meal-plan-display";
import { WorkoutMealInfo } from "@/components/nutrition/WorkoutMealInfo";
import {
  MEAL_TIMING_HINT,
  MEAL_TIMING_LABEL,
  type MealTiming,
} from "@/lib/nutrition-targets/meal-timing";
import { useMealPlanView, type MealPlanView } from "@/lib/nutrition-targets/meal-plan-view";
import { KCAL_PER_GRAM, MACRO_COLOR, formatKcal } from "./macro-palette";
import { mealMacroNumbers, splitFoodLine } from "@/lib/nutrition-targets/meal-plan-reader";
import {
  formatDayWater,
  formatMealWater,
  parseWaterTarget,
  splitWaterAcrossMeals,
  type WaterUnit,
} from "@/lib/nutrition-targets/meal-water";

type MealWater = { amounts: number[]; unit: WaterUnit } | null;

type MealSection = Extract<MealPlanSection, { kind: "meal" }>;
type NonMealSection = Exclude<MealPlanSection, { kind: "meal" }>;

/**
 * Client-facing meal plan reader. Same coach text and parser as everywhere
 * else; only the presentation changes. Swipe shows one meal at a time
 * (default), Scroll shows the whole day. The choice sticks per person.
 */
export function MealPlanReader({ text, water }: { text: string; water?: string | null }) {
  const { user } = useAuth();
  const [view, setView] = useMealPlanView(user?.id ?? null);
  const sections = useMemo(() => parseMealPlanText(text), [text]);

  const meals = sections.filter((s): s is MealSection => s.kind === "meal");
  // The day's water split across the meals (a little more around training).
  const dayWater = useMemo(() => parseWaterTarget(water), [water]);
  const mealWater: MealWater = useMemo(
    () =>
      dayWater && meals.length
        ? {
            amounts: splitWaterAcrossMeals(
              dayWater.ml,
              meals.map((m) => m.timing ?? null),
              dayWater.unit,
            ),
            unit: dayWater.unit,
          }
        : null,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [dayWater, sections],
  );
  const firstMeal = sections.findIndex((s) => s.kind === "meal");
  const before = (firstMeal < 0 ? sections : sections.slice(0, firstMeal)) as NonMealSection[];
  const after = (
    firstMeal < 0 ? [] : sections.slice(firstMeal).filter((s) => s.kind !== "meal")
  ) as NonMealSection[];

  const canSwipe = meals.length > 1;
  const mode: MealPlanView = canSwipe ? view : "scroll";

  return (
    <div className="space-y-4">
      {before.map((s, i) => (
        <PlanNote key={`b${i}`} section={s} />
      ))}

      {meals.length > 0 && (
        <>
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap text-sm text-muted-foreground">
              {meals.length} {meals.length === 1 ? "meal" : "meals"}
              {dayWater && (
                <>
                  <span aria-hidden>·</span>
                  <Droplets aria-hidden className="h-3.5 w-3.5 shrink-0 text-sky-500" />
                  <span className="truncate" aria-label={`${formatDayWater(dayWater.ml, dayWater.unit)} water`}>
                    {formatDayWater(dayWater.ml, dayWater.unit)}
                  </span>
                </>
              )}
            </span>
            {canSwipe && <ViewToggle value={view} onChange={setView} />}
          </div>

          {mode === "swipe" ? (
            <MealSwiper key={text} meals={meals} water={mealWater} />
          ) : (
            <div className="space-y-2.5">
              {meals.map((m, i) => (
                <MealCard
                  key={i}
                  meal={m}
                  water={mealWater ? { amount: mealWater.amounts[i], unit: mealWater.unit } : null}
                />
              ))}
            </div>
          )}
        </>
      )}

      {after.map((s, i) => (
        <PlanNote key={`a${i}`} section={s} />
      ))}
    </div>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: MealPlanView;
  onChange: (v: MealPlanView) => void;
}) {
  const options: { value: MealPlanView; label: string; icon: typeof Rows3 }[] = [
    { value: "swipe", label: "Swipe", icon: GalleryHorizontalEnd },
    { value: "scroll", label: "Scroll", icon: Rows3 },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="How to view meals"
      className="inline-flex shrink-0 rounded-lg border border-border bg-secondary/50 p-0.5"
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <o.icon className="h-3.5 w-3.5" aria-hidden />
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function prefersReducedMotion() {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

function MealSwiper({ meals, water }: { meals: MealSection[]; water: MealWater }) {
  const trackRef = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);

  const slideAt = (el: HTMLDivElement, i: number) => el.children[i] as HTMLElement | undefined;
  const padLeft = (el: HTMLDivElement) => parseFloat(getComputedStyle(el).paddingLeft) || 0;

  useEffect(() => {
    const el = trackRef.current;
    if (!el) return;
    let raf = 0;
    const measure = () => {
      const max = el.scrollWidth - el.clientWidth;
      if (el.scrollLeft >= max - 2) {
        setActive(meals.length - 1);
        return;
      }
      const pad = padLeft(el);
      let best = 0;
      let bestDist = Infinity;
      for (let i = 0; i < el.children.length; i++) {
        const d = Math.abs((el.children[i] as HTMLElement).offsetLeft - pad - el.scrollLeft);
        if (d < bestDist) {
          bestDist = d;
          best = i;
        }
      }
      setActive(best);
    };
    const onScroll = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(measure);
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [meals.length]);

  const goTo = useCallback(
    (i: number) => {
      const el = trackRef.current;
      if (!el) return;
      const idx = Math.max(0, Math.min(meals.length - 1, i));
      const slide = slideAt(el, idx);
      if (!slide) return;
      setActive(idx);
      el.scrollTo({
        left: slide.offsetLeft - padLeft(el),
        behavior: prefersReducedMotion() ? "auto" : "smooth",
      });
    },
    [meals.length],
  );

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight") {
      e.preventDefault();
      goTo(active + 1);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      goTo(active - 1);
    }
  };

  return (
    <div className="space-y-2.5">
      {/* Meal tabs sit above the cards, where the tab bar can never cover them. */}
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" data-meal-pager>
        {meals.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${m.title}${m.timing ? `, ${MEAL_TIMING_LABEL[m.timing]}` : ""}`}
            aria-current={i === active ? "true" : undefined}
            title={m.timing ? MEAL_TIMING_LABEL[m.timing] : undefined}
            className={cn(
              "inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1 rounded-full px-2.5 text-[13px] font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              i === active
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {i + 1}
            {m.timing && <TimingIcon timing={m.timing} active={i === active} />}
          </button>
        ))}
      </div>

      <div
        ref={trackRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-roledescription="carousel"
        aria-label="Meals"
        className={cn(
          "relative -mx-4 flex snap-x snap-mandatory items-start gap-2.5 overflow-x-auto overscroll-x-contain px-4 pb-1 md:-mx-5 md:px-5",
          "scroll-px-4 md:scroll-px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "touch-pan-x touch-pan-y [-webkit-overflow-scrolling:touch]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        )}
      >
        {meals.map((m, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${m.title}, ${i + 1} of ${meals.length}`}
            className="w-[88%] shrink-0 snap-start [scroll-snap-stop:always] sm:w-[calc(50%-0.3125rem)]"
          >
            <MealCard
              meal={m}
              water={water ? { amount: water.amounts[i], unit: water.unit } : null}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

const TIMING_TEXT: Record<Exclude<MealTiming, null>, string> = {
  pre: "text-amber-500",
  post: "text-emerald-500",
  pre_post: "text-sky-500",
};

/** The meal tab's pre / post mark: the same icon as the card's badge. */
function TimingIcon({ timing, active }: { timing: Exclude<MealTiming, null>; active: boolean }) {
  const Icon = timing === "post" ? Dumbbell : Zap;
  return <Icon aria-hidden className={cn("h-3 w-3", active ? "text-primary-foreground" : TIMING_TEXT[timing])} />;
}

/* ---------- Meal card ---------- */

function MealCard({
  meal,
  water,
}: {
  meal: MealSection;
  water?: { amount: number; unit: WaterUnit } | null;
}) {
  const foods = meal.items.map(splitFoodLine);
  const macros = mealMacroNumbers(meal);
  const kcal =
    macros && macros.protein != null && macros.carbs != null && macros.fats != null
      ? macros.protein * KCAL_PER_GRAM.protein +
        macros.carbs * KCAL_PER_GRAM.carbs +
        macros.fats * KCAL_PER_GRAM.fats
      : null;

  return (
    <article
      data-meal-card
      className={cn(
        "rounded-2xl border bg-secondary/30 px-3.5 pb-3 pt-3",
        meal.timing ? TIMING_BORDER[meal.timing] : "border-border/70",
      )}
    >
      <header className="flex items-baseline justify-between gap-3">
        <h3 className="min-w-0 truncate text-[17px] font-bold leading-tight">
          {meal.title.replace(/\s+/g, " ").trim()}
        </h3>
        {kcal != null && kcal > 0 && (
          <span className="shrink-0 whitespace-nowrap text-[13px] font-semibold tabular-nums text-muted-foreground">
            {formatKcal(kcal)} kcal
          </span>
        )}
      </header>
      {meal.subtitle && (
        <p className="mt-0.5 text-[13px] leading-snug text-muted-foreground">{meal.subtitle}</p>
      )}

      {meal.timing && (
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
          <MealTimingBadge
            timing={meal.timing}
            className="gap-1 px-2 py-0.5 text-[11px] font-semibold normal-case tracking-normal"
          />
          <span className="inline-flex min-w-0 items-center gap-1 text-xs leading-snug text-muted-foreground">
            {MEAL_TIMING_HINT[meal.timing]}
            <WorkoutMealInfo />
          </span>
        </div>
      )}

      {macros ? (
        <MacroSummary macros={macros} />
      ) : meal.approx ? (
        <p className="mt-2.5 text-[13px] font-semibold text-muted-foreground">Approx {meal.approx}</p>
      ) : null}

      {foods.length > 0 && (
        <ul className="mt-2 divide-y divide-border/50" data-meal-foods>
          {foods.map((f, j) =>
            f.amount ? (
              <li key={j} className="flex items-baseline justify-between gap-3 py-[7px]">
                <span className="min-w-0 text-[15px] leading-snug text-foreground/90">{f.name}</span>
                <span className="shrink-0 whitespace-nowrap text-[15px] font-semibold tabular-nums">
                  {f.amount}
                </span>
              </li>
            ) : (
              <li key={j} className="py-[7px] text-[14px] leading-snug text-muted-foreground">
                {f.name}
              </li>
            ),
          )}
        </ul>
      )}

      {water && water.amount > 0 && (
        <div
          className="mt-2 flex items-center justify-between gap-3 border-t border-border/60 pt-2 text-[13px] text-muted-foreground"
          data-meal-water
        >
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Droplets aria-hidden className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">Water with this meal</span>
          </span>
          <span className="shrink-0 whitespace-nowrap font-semibold tabular-nums text-foreground">
            {formatMealWater(water.amount, water.unit)}
          </span>
        </div>
      )}
    </article>
  );
}

const TIMING_BORDER: Record<Exclude<MealTiming, null>, string> = {
  pre: "border-amber-500/45",
  post: "border-emerald-500/45",
  pre_post: "border-sky-500/45",
};

/** The meal's macros in one compact row: number first, the macro's colour by its name. */
function MacroSummary({ macros }: { macros: NonNullable<ReturnType<typeof mealMacroNumbers>> }) {
  const cells = (
    [
      ["Protein", macros.protein, MACRO_COLOR.protein],
      ["Carbs", macros.carbs, MACRO_COLOR.carbs],
      ["Fat", macros.fats, MACRO_COLOR.fats],
      ["Fibre", macros.fibre, null],
    ] as const
  ).filter(([label, value]) => label !== "Fibre" || value != null);
  return (
    <dl
      className="mt-2.5 grid divide-x divide-border/50 rounded-xl bg-card/80 py-1.5"
      style={{ gridTemplateColumns: `repeat(${cells.length}, minmax(0, 1fr))` }}
      data-meal-macros
    >
      {cells.map(([label, value, color]) => (
        <div key={label} className="flex min-w-0 flex-col-reverse items-center px-0.5">
          <dt className="mt-0.5 flex min-w-0 items-center gap-[3px] text-[11px] text-muted-foreground">
            {color && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />}
            <span className="truncate">{label}</span>
          </dt>
          <dd className="text-[15px] font-bold leading-tight tabular-nums">
            {value != null ? (
              <>
                {value}
                <span className="ml-px text-[11px] font-semibold text-muted-foreground">g</span>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ---------- Non-meal blocks (notes, daily total, high-day changes) ---------- */

function PlanNote({ section }: { section: NonMealSection }) {
  // The day's total is the targets card's job: never repeated under the meals.
  if (
    section.kind === "total" ||
    (section.kind === "other" && TOTAL_HEADING.test(section.items[0] ?? ""))
  ) {
    return null;
  }
  if (section.kind === "highday") {
    return (
      <div className="rounded-2xl border border-warning/40 bg-warning/5 p-4">
        <div className="text-sm font-bold text-warning">
          {section.title.replace(/\s+/g, " ").trim()}
        </div>
        {section.items.length > 0 && (
          <ul className="mt-2 space-y-1.5">
            {section.items.map((it, j) =>
              MEAL_HEADING.test(it) ? (
                <li key={j} className="pt-1.5 text-sm font-bold">
                  {it}
                </li>
              ) : (
                <li key={j} className="text-[15px] leading-snug text-foreground/90">
                  {it}
                </li>
              ),
            )}
          </ul>
        )}
      </div>
    );
  }
  return (
    <div className="rounded-2xl bg-secondary/35 p-4 text-[15px] leading-relaxed text-foreground/90">
      {section.items.map((it, j) => (
        <p key={j}>{it}</p>
      ))}
    </div>
  );
}
