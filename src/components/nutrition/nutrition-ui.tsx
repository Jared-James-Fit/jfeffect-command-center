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
import { ChevronDown, MoreHorizontal, Zap } from "lucide-react";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { MEAL_TIMING_LABEL } from "@/lib/nutrition-targets/meal-timing";
import { AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
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

/** A day's meals as the client reads them: each meal's foods (name left, amount right) and its macros. */
export function DayMeals({ text }: { text: string }) {
  const day = structureMealPlanDay(text);
  if (!day.meals.length)
    return <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{text.trim()}</p>;
  return (
    <div className="space-y-2" data-day-meals>
      {day.meals.map((m, i) => (
        <div key={i} className="rounded-lg bg-muted/50 px-3 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="flex min-w-0 items-center gap-1.5 text-sm font-medium">
              <span className="truncate">{m.title}</span>
              {m.timing ? (
                <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-normal text-muted-foreground">
                  <Zap className="h-3 w-3" aria-hidden />
                  {MEAL_TIMING_LABEL[m.timing]}
                </span>
              ) : null}
            </span>
            {m.macros ? (
              <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                P {n(m.macros.protein)} · C {n(m.macros.carbs)} · F {n(m.macros.fat)}
              </span>
            ) : null}
          </div>
          <ul className="mt-1 space-y-0.5">
            {m.foods.map((f, k) => (
              <li key={k} className="flex justify-between gap-3 text-[13px]">
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
        </div>
      ))}
      {day.notes.length ? (
        <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">
          {day.notes.join("\n")}
        </p>
      ) : null}
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
