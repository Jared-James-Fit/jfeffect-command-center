/**
 * Compact "Today's Intake" card. Only renders when the client actually uses
 * food logging today; otherwise the section is hidden. Log Food itself is the
 * Nutrition Tools tile (one way in); this card is today's totals, and tapping
 * it opens the same food log. Read/writes only existing food-log data via the
 * untouched DailyNutritionPanel.
 */

import { Suspense, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { usePovArgs, usePovFn } from "@/lib/client-pov-args";
import { Card } from "@/components/ui/card";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { ChevronRight, Loader2, UtensilsCrossed } from "lucide-react";
import { getNutritionDashboard } from "@/lib/nutrition-dashboard.functions";
import { ToolTile } from "./tool-tile";

const Panel = lazyWithRetry(() => import("./DailyNutritionPanelLazy"));

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function LogSheet({ open, onOpenChange }: { open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        className="h-[100dvh] max-w-3xl overflow-y-auto pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:h-[92vh] sm:mx-auto sm:rounded-t-2xl"
      >
        <SheetHeader className="text-left">
          <SheetTitle>Food log</SheetTitle>
        </SheetHeader>
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
  const getDashboard = usePovFn(useServerFn(getNutritionDashboard));
  const povUserId = usePovArgs().viewAsUserId;
  const date = todayISO();
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["nutrition-dashboard", date, povUserId ?? null],
    queryFn: () => getDashboard({ data: { date } }),
    retry: false,
    staleTime: 30_000,
  });

  const meals: any[] = Array.isArray(q.data?.meals) ? (q.data as any).meals : [];
  if (q.isLoading || q.isError || meals.length === 0) return null;

  const totals = meals.reduce(
    (acc, m) => ({
      calories: acc.calories + Number(m.calories || 0),
      protein: acc.protein + Number(m.protein_g || 0),
      carbs: acc.carbs + Number(m.carbs_g || 0),
      fat: acc.fat + Number(m.fat_g || 0),
    }),
    { calories: 0, protein: 0, carbs: 0, fat: 0 },
  );

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
            {Math.round(totals.calories)} kcal · {Math.round(totals.protein)}P · {Math.round(totals.carbs)}C ·{" "}
            {Math.round(totals.fat)}F · {meals.length} meal{meals.length === 1 ? "" : "s"}
          </span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      <LogSheet open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** "Log Food" tile inside Nutrition Tools. */
export function LogFoodToolButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ToolTile icon={UtensilsCrossed} title="Log Food" onClick={() => setOpen(true)} />
      <LogSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
