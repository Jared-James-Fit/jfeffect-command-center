import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { GalleryHorizontalEnd, Rows3 } from "lucide-react";
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
import { MEAL_TIMING_HINT } from "@/lib/nutrition-targets/meal-timing";
import { useMealPlanView, type MealPlanView } from "@/lib/nutrition-targets/meal-plan-view";
import { KCAL_PER_GRAM, MACRO_COLOR, formatKcal } from "./macro-palette";
import { mealMacroNumbers, splitFoodLine } from "@/lib/nutrition-targets/meal-plan-reader";

type MealSection = Extract<MealPlanSection, { kind: "meal" }>;
type NonMealSection = Exclude<MealPlanSection, { kind: "meal" }>;

/**
 * Client-facing meal plan reader. Same coach text and parser as everywhere
 * else; only the presentation changes. Swipe shows one meal at a time
 * (default), Scroll shows the whole day. The choice sticks per person.
 */
export function MealPlanReader({ text }: { text: string }) {
  const { user } = useAuth();
  const [view, setView] = useMealPlanView(user?.id ?? null);
  const sections = useMemo(() => parseMealPlanText(text), [text]);

  const meals = sections.filter((s): s is MealSection => s.kind === "meal");
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
            <span className="text-sm text-muted-foreground">
              {meals.length} {meals.length === 1 ? "meal" : "meals"}
            </span>
            {canSwipe && <ViewToggle value={view} onChange={setView} />}
          </div>

          {mode === "swipe" ? (
            <MealSwiper key={text} meals={meals} />
          ) : (
            <div className="space-y-3">
              {meals.map((m, i) => (
                <MealCard key={i} meal={m} />
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
              "inline-flex h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
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

function MealSwiper({ meals }: { meals: MealSection[] }) {
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
    <div className="space-y-3">
      <div
        ref={trackRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        aria-roledescription="carousel"
        aria-label="Meals"
        className={cn(
          "relative -mx-4 flex snap-x snap-mandatory gap-3 overflow-x-auto overscroll-x-contain px-4 pb-1 md:-mx-5 md:px-5",
          "scroll-px-4 md:scroll-px-5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
        )}
      >
        {meals.map((m, i) => (
          <div
            key={i}
            role="group"
            aria-roledescription="slide"
            aria-label={`${m.title}, ${i + 1} of ${meals.length}`}
            className="w-[86%] shrink-0 snap-start sm:w-[calc(50%-0.375rem)]"
          >
            <MealCard meal={m} />
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center justify-center gap-1.5">
        {meals.map((m, i) => (
          <button
            key={i}
            type="button"
            onClick={() => goTo(i)}
            aria-label={`Show ${m.title}`}
            aria-current={i === active ? "true" : undefined}
            className={cn(
              "grid h-9 min-w-9 place-items-center rounded-full px-2 text-sm font-bold tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              i === active
                ? "bg-primary text-primary-foreground"
                : "bg-secondary/70 text-muted-foreground hover:text-foreground",
            )}
          >
            {i + 1}
          </button>
        ))}
      </div>
    </div>
  );
}

/* ---------- Meal card ---------- */

function MealCard({ meal }: { meal: MealSection }) {
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
      className={cn(
        "flex h-full flex-col rounded-2xl border bg-secondary/35 p-4",
        meal.timing === "pre"
          ? "border-amber-500/50"
          : meal.timing === "post"
            ? "border-emerald-500/50"
            : meal.timing
              ? "border-sky-500/50"
              : "border-border/80",
      )}
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="text-lg font-black leading-tight">
            {meal.title.replace(/\s+/g, " ").trim()}
          </h3>
          {meal.subtitle && <p className="mt-0.5 text-sm text-muted-foreground">{meal.subtitle}</p>}
        </div>
        {kcal != null && kcal > 0 && (
          <span className="shrink-0 pt-0.5 text-sm font-semibold tabular-nums text-muted-foreground">
            {formatKcal(kcal)} kcal
          </span>
        )}
      </header>

      {meal.timing && (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <MealTimingBadge timing={meal.timing} />
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            {MEAL_TIMING_HINT[meal.timing]}
            <WorkoutMealInfo />
          </span>
        </div>
      )}

      {foods.length > 0 && (
        <ul className="mt-3 divide-y divide-border/60">
          {foods.map((f, j) =>
            f.amount ? (
              <li key={j} className="grid grid-cols-[3.75rem_1fr] items-baseline gap-3 py-2.5">
                <span className="text-right text-[15px] font-bold tabular-nums">{f.amount}</span>
                <span className="text-base leading-snug text-foreground/90">{f.name}</span>
              </li>
            ) : (
              <li key={j} className="py-2.5 text-[15px] leading-snug text-muted-foreground">
                {f.name}
              </li>
            ),
          )}
        </ul>
      )}

      {macros ? (
        <div className="mt-auto pt-4">
          <dl className="grid grid-cols-4 gap-2 rounded-xl bg-card px-3 py-3">
            {(
              [
                ["Protein", macros.protein, MACRO_COLOR.protein],
                ["Carbs", macros.carbs, MACRO_COLOR.carbs],
                ["Fat", macros.fats, MACRO_COLOR.fats],
                ["Fibre", macros.fibre, MACRO_COLOR.fibre],
              ] as const
            ).map(([label, value, color]) => (
              <div key={label} className="min-w-0">
                <span
                  aria-hidden
                  className="block h-1 w-5 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <dt className="mt-1.5 truncate text-[11px] text-muted-foreground">{label}</dt>
                <dd className="text-base font-bold leading-tight tabular-nums">
                  {value != null ? (
                    <>
                      {value}
                      <span className="ml-0.5 text-xs font-semibold text-muted-foreground">g</span>
                    </>
                  ) : (
                    "—"
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </div>
      ) : meal.approx ? (
        <div className="mt-auto pt-4 text-sm font-semibold text-muted-foreground">
          Approx {meal.approx}
        </div>
      ) : null}
    </article>
  );
}

/* ---------- Non-meal blocks (notes, daily total, high-day changes) ---------- */

function PlanNote({ section }: { section: NonMealSection }) {
  if (
    section.kind === "total" ||
    (section.kind === "other" && TOTAL_HEADING.test(section.items[0] ?? ""))
  ) {
    const title = section.kind === "total" ? section.title : section.items[0];
    const body =
      section.kind === "total" ? (section.macros ? [section.macros] : []) : section.items.slice(1);
    return (
      <div className="rounded-2xl border border-primary/30 bg-primary/5 p-4">
        <div className="text-sm font-bold text-primary">{title.replace(/\s+/g, " ").trim()}</div>
        {body.map((line, i) => (
          <p key={i} className="mt-1 text-[15px] font-semibold leading-snug">
            {line}
          </p>
        ))}
      </div>
    );
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
