/**
 * Compact "Today's Intake" card. Only renders when the client actually uses
 * food logging today; otherwise the section is hidden and logging stays
 * reachable from Nutrition Tools. Read/writes only existing food-log data via
 * the untouched DailyNutritionPanel.
 */

import { lazy, Suspense, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Loader2, UtensilsCrossed } from "lucide-react";
import { getNutritionDashboard } from "@/lib/nutrition-dashboard.functions";

const Panel = lazy(() => import("./DailyNutritionPanelLazy"));

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
  const getDashboard = useServerFn(getNutritionDashboard);
  const date = todayISO();
  const [open, setOpen] = useState(false);

  const q = useQuery({
    queryKey: ["nutrition-dashboard", date],
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
    <Card className="p-4 md:p-5">
      <div className="flex flex-wrap items-center gap-3">
        <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/15 text-primary">
          <UtensilsCrossed className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase tracking-widest">Today's Intake</div>
          <div className="text-[11px] text-muted-foreground tabular-nums">
            {Math.round(totals.calories)} kcal · {Math.round(totals.protein)}P · {Math.round(totals.carbs)}C ·{" "}
            {Math.round(totals.fat)}F · {meals.length} meal{meals.length === 1 ? "" : "s"}
          </div>
        </div>
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setOpen(true)}>
          Log Food
        </Button>
      </div>
      <LogSheet open={open} onOpenChange={setOpen} />
    </Card>
  );
}

/** "Log Food" entry inside Nutrition Tools (used when nothing is logged yet). */
export function LogFoodToolButton() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="outline" className="h-11 w-full justify-start" onClick={() => setOpen(true)}>
        <UtensilsCrossed className="mr-2 h-4 w-4" /> Log Food
      </Button>
      <LogSheet open={open} onOpenChange={setOpen} />
    </>
  );
}
