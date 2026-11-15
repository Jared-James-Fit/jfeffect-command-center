/**
 * Compact "Today's intake" card. Only renders when the client actually logged
 * food today; otherwise the section is hidden. Log Food itself is the
 * Nutrition Tools tile (one way in); this card is today's totals against the
 * coach's targets for today, and tapping it opens the same food log. Both
 * read the same day query (useFoodLogDay), the person's own calendar day.
 */

import { Suspense, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { Card } from "@/components/ui/card";
import { Sheet, SheetClose, SheetContent, SheetTitle } from "@/components/ui/sheet";
import { ChevronLeft, ChevronRight, Loader2, UtensilsCrossed } from "lucide-react";
import { todayLocalISO } from "@/lib/today";
import { sumMacros } from "@/lib/food-log";
import { targetFromDashboard, useFoodLogDay, useFoodLogPlan } from "./food-log-context";
import { ToolTile } from "./tool-tile";

const Panel = lazyWithRetry(() => import("./DailyNutritionPanelLazy"));

export function FoodLogSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="h-[100dvh] max-w-3xl overflow-y-auto px-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-0 sm:mx-auto sm:h-[92vh] sm:rounded-t-2xl sm:px-6"
      >
        {/* one row under the status bar: Back and the title (the Cookbook's header) */}
        <div className="sticky top-0 z-10 -mx-4 mb-3 flex items-center gap-3 border-b border-border bg-background px-4 pb-2.5 pt-[calc(env(safe-area-inset-top)+0.75rem)] dark:bg-card sm:-mx-6 sm:px-6 sm:pt-4">
          <SheetClose
            aria-label="Back to nutrition"
            className="inline-flex h-10 shrink-0 items-center justify-center gap-1 rounded-lg border border-border bg-background px-3 text-sm font-semibold transition hover:bg-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring active:scale-[0.98]"
          >
            <ChevronLeft className="h-4 w-4" />
            Back
          </SheetClose>
          <SheetTitle className="min-w-0 flex-1 truncate text-lg font-semibold">Food log</SheetTitle>
        </div>
        <Suspense
          fallback={
            <div className="flex items-center justify-center py-16 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          }
        >
          {open && <Panel />}
        </Suspense>
      </SheetContent>
    </Sheet>
  );
}

export function TodaysIntakeCard() {
  const date = todayLocalISO();
  const [open, setOpen] = useState(false);
  const plan = useFoodLogPlan();
  const q = useFoodLogDay(date);

  const meals: any[] = Array.isArray((q.data as any)?.meals) ? (q.data as any).meals : [];
  if (q.isLoading || q.isError || meals.length === 0) return null;

  const totals = sumMacros(meals);
  const target = plan?.targetFor(date) ?? targetFromDashboard((q.data as any)?.target);
  const kcal = Math.round(totals.calories).toLocaleString("en-CA");

  return (
    <Card className="p-0">
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open today's food log"
        className="flex w-full items-center gap-3 rounded-2xl p-4 text-left transition hover:bg-muted/40 active:bg-muted/60 md:p-5"
      >
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground" aria-hidden>
          <UtensilsCrossed className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Today's intake</span>
          <span className="block text-xs text-muted-foreground tabular-nums">
            {target?.calories ? `${kcal} of ${Math.round(target.calories).toLocaleString("en-CA")} kcal` : `${kcal} kcal`}
            {" · "}
            {Math.round(totals.protein)}
            {target?.protein ? ` of ${Math.round(target.protein)}` : ""} g protein · {meals.length} meal{meals.length === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <FoodLogSheet open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** "Log Food" tile inside Nutrition Tools. */
export function LogFoodToolButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToolTile icon={UtensilsCrossed} title="Log Food" onClick={() => setOpen(true)} />
      <FoodLogSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
