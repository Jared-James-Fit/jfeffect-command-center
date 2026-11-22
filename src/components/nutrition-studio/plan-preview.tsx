/**
 * What came in, before anyone edits it: the days found (name, numbers, how
 * many meals, each opening to its meals), what's worth a look (the checks'
 * flags, `check` ones first), and the text it was read from a tap away.
 * Shared by the member's import and Cleo draft and the coach's file import.
 */
import { useState, type ReactNode } from "react";
import { AlertTriangle, ChevronDown, FileText, Info } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { structureMealPlanDay } from "@/lib/nutrition-targets/meal-plan-structure";
import { mealCount } from "@/lib/nutrition-import/read";
import type { MealFlag } from "@/lib/nutrition-import/types";

export type PreviewDay = {
  label: string;
  calories: number | null;
  protein: number | null;
  carbs: number | null;
  fats: number | null;
  notes: string;
};

const num = (n: number | null | undefined) => (n == null ? "—" : Math.round(n).toLocaleString("en-CA"));

/** "2,200 kcal · P 160 · C 230 · F 70", or that the plan doesn't say. */
export function dayNumbers(d: Pick<PreviewDay, "calories" | "protein" | "carbs" | "fats">): string {
  if (d.calories == null && d.protein == null && d.carbs == null && d.fats == null) return "No macros given";
  return `${num(d.calories)} kcal · P ${num(d.protein)} · C ${num(d.carbs)} · F ${num(d.fats)}`;
}

const FLAGS_SHOWN = 6;

export function PlanPreview({
  days,
  flags,
  sourceText,
  sourceLabel = "What was read",
  note,
  actions,
}: {
  days: PreviewDay[];
  flags: MealFlag[];
  sourceText?: string | null;
  sourceLabel?: string;
  /** A line above the days ("A draft to check…"). */
  note?: ReactNode;
  actions: ReactNode;
}) {
  const [sourceOpen, setSourceOpen] = useState(false);
  const [allFlags, setAllFlags] = useState(false);
  const ordered = [...flags.filter((f) => f.level === "check"), ...flags.filter((f) => f.level === "info")];
  const shown = allFlags ? ordered : ordered.slice(0, FLAGS_SHOWN);
  const checks = flags.filter((f) => f.level === "check").length;

  return (
    <div className="space-y-4" data-meal-import-preview>
      {note}

      <section className="rounded-2xl border border-border" aria-label="Days">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <h2 className="text-base font-semibold">
            {days.length} {days.length === 1 ? "day" : "days"} found
          </h2>
        </div>
        <ul className="divide-y divide-border">
          {days.map((d, i) => {
            const meals = structureMealPlanDay(d.notes).meals;
            return (
              <li key={i}>
                <details className="group px-4 py-3" data-meal-import-day>
                  <summary className="flex cursor-pointer list-none items-center gap-3">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px] font-medium">{d.label}</span>
                      <span className="block text-[13px] tabular-nums text-muted-foreground">
                        {dayNumbers(d)} · {mealCount(d.notes)} {mealCount(d.notes) === 1 ? "meal" : "meals"}
                      </span>
                    </span>
                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition group-open:rotate-180" aria-hidden />
                  </summary>
                  <div className="mt-3 space-y-3">
                    {meals.map((m, j) => (
                      <div key={j}>
                        <div className="text-[14px] font-medium">{m.title}</div>
                        {m.foods.length ? (
                          <ul className="mt-1 space-y-0.5">
                            {m.foods.map((f, k) => (
                              <li key={k} className="flex justify-between gap-3 text-[14px]">
                                <span className="min-w-0">{f.name}</span>
                                <span className="shrink-0 tabular-nums text-muted-foreground">{f.amount}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {m.notes.map((n, k) => (
                          <p key={k} className="text-[13px] text-muted-foreground">
                            {n}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </details>
              </li>
            );
          })}
        </ul>
      </section>

      {ordered.length > 0 && (
        <section className="rounded-2xl border border-border p-4" aria-label="Worth a look" data-meal-import-flags>
          <h2 className="text-base font-semibold">{checks ? `Worth a look (${checks})` : "Good to know"}</h2>
          <ul className="mt-2 space-y-2">
            {shown.map((f, i) => (
              <li key={i} className="flex gap-2 text-[14px] leading-snug" data-flag={f.code}>
                {f.level === "check" ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
                ) : (
                  <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                )}
                <span>{f.text}</span>
              </li>
            ))}
          </ul>
          {ordered.length > FLAGS_SHOWN && (
            <button type="button" className="mt-2 text-[13px] font-medium underline-offset-2 hover:underline" onClick={() => setAllFlags((v) => !v)}>
              {allFlags ? "Show fewer" : `Show all ${ordered.length}`}
            </button>
          )}
        </section>
      )}

      {sourceText?.trim() ? (
        <button
          type="button"
          onClick={() => setSourceOpen(true)}
          className="flex w-full items-center gap-3 rounded-2xl border border-border px-4 py-3 text-left hover:bg-muted/40"
          data-meal-import-source
        >
          <FileText className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="flex-1 text-[15px]">{sourceLabel}</span>
        </button>
      ) : null}

      {actions}

      <Sheet open={sourceOpen} onOpenChange={setSourceOpen}>
        <SheetContent side="bottom" swipeToClose className="max-h-[85vh] overflow-y-auto rounded-t-2xl">
          <SheetHeader>
            <SheetTitle>{sourceLabel}</SheetTitle>
            <SheetDescription>Compare the plan with this before you save it.</SheetDescription>
          </SheetHeader>
          <pre className="mt-3 whitespace-pre-wrap break-words font-mono text-[13px] leading-relaxed">{sourceText}</pre>
        </SheetContent>
      </Sheet>
    </div>
  );
}
