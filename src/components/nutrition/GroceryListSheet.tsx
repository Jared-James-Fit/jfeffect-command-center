/**
 * GroceryListSheet — auto-generated weekly grocery list.
 *
 * Read-only derivation from the EXISTING coach-assigned nutrition plan
 * (`nutrition_targets` + `nutrition_target_days.notes`) and the canonical
 * weekly day resolver (`resolveClientWeekDays`). Shared by the client
 * Nutrition page and the coach "Preview Grocery List" action.
 */

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format } from "date-fns";
import { Loader2, ShoppingCart } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { getClientWorkouts } from "@/lib/pl-programs";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { mondayWeekDates, resolveClientWeekDays, resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { parseLocalDate, toLocalISO, todayLocalISO } from "@/lib/today";
import {
  buildGroceryList,
  weekSummaryText,
  type GroceryDayType,
} from "@/lib/grocery-list";
import {
  clearCheckedIdentities,
  readCheckedIdentities,
  writeCheckedIdentities,
} from "@/lib/grocery-shopping-state";
import { cn } from "@/lib/utils";
import { groceryListKey } from "@/lib/grocery-query-keys";

function mondayOf(dateISO: string): string {
  const d = parseLocalDate(dateISO) ?? new Date();
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return toLocalISO(monday);
}

export function GroceryListSheet({
  open,
  onOpenChange,
  clientId,
  viewAsUserId,
  coachPreview = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string | null | undefined;
  viewAsUserId?: string | null;
  coachPreview?: boolean;
}) {
  const getPlanFn = useServerFn(getCoachAssignedMealPlan);
  const [weekOffset, setWeekOffset] = useState<0 | 1>(0);
  const [hideChecked, setHideChecked] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);

  const thisMonday = mondayOf(todayLocalISO());
  const weekStart = toLocalISO(addDays(parseLocalDate(thisMonday)!, weekOffset * 7));
  const weekEnd = toLocalISO(addDays(parseLocalDate(weekStart)!, 6));

  const q = useQuery({
    // Lazy: only fetches once the sheet is opened.
    enabled: !!open && !!clientId,
    queryKey: [...groceryListKey(clientId, weekStart), viewAsUserId ?? null],
    staleTime: 0,
    refetchOnMount: "always",
    queryFn: async () => {
      const [plan, clientRes, overridesRes, workouts] = await Promise.all([
        getPlanFn({ data: viewAsUserId ? { viewAsUserId } : {} }),
        supabase
          .from("clients")
          .select("committed_training_days,preferred_high_days,full_cardio_rest_days")
          .eq("id", clientId!)
          .maybeSingle(),
        (supabase.from("nutrition_day_overrides") as any)
          .select("override_date,day_label")
          .eq("client_id", clientId!),
        getClientWorkouts(clientId!),
      ]);
      const client = clientRes.data as any;
      const weekDates = mondayWeekDates(weekStart);
      const workoutDates = resolveWorkoutDatesFromItems(
        workouts as any[],
        client?.committed_training_days ?? null,
      );
      const days = resolveClientWeekDays({
        clientId: clientId!,
        weekDates,
        workouts: workoutDates,
        recurringHighDays: client?.preferred_high_days ?? null,
        highDayOverrides: (overridesRes.data ?? []) as any[],
        fullCardioRestDays: client?.full_cardio_rest_days ?? null,
      });
      const configuredHighDay = (client?.preferred_high_days ?? [])[0] ?? null;
      // Schedule accuracy signal: program days that carry no resolvable date
      // cannot be counted, so day-type totals may under-report.
      const schedulable = (workouts as any[]).filter((i) => i?.day?.id && i?.week?.id).length;
      const unscheduledCount = Math.max(0, schedulable - workoutDates.length);
      return { plan: plan as any, days, configuredHighDay, unscheduledCount };
    },
  });

  const dayCounts = useMemo<Record<GroceryDayType, number>>(() => {
    const counts: Record<GroceryDayType, number> = { training: 0, non_training: 0, high: 0 };
    for (const d of q.data?.days ?? []) counts[d.nutritionDayType] += 1;
    return counts;
  }, [q.data]);

  const targetId = (q.data?.plan?.id as string | undefined) ?? null;
  const planDays = (q.data?.plan?.days ?? []) as any[];

  const result = useMemo(
    () => buildGroceryList({ planDays, dayCounts }),
    [planDays, dayCounts],
  );

  // Local-only shopping ticks, keyed by target + week start.
  useEffect(() => {
    if (!targetId) return;
    setChecked(readCheckedIdentities(targetId, weekStart));
  }, [targetId, weekStart]);

  const toggle = (identity: string) => {
    setChecked((prev) => {
      const next = prev.includes(identity) ? prev.filter((x) => x !== identity) : [...prev, identity];
      if (targetId) writeCheckedIdentities(targetId, weekStart, next);
      return next;
    });
  };

  const clearChecked = () => {
    setChecked([]);
    if (targetId) clearCheckedIdentities(targetId, weekStart);
  };

  const rangeLabel = `${format(parseLocalDate(weekStart)!, "MMM d")} – ${format(parseLocalDate(weekEnd)!, "MMM d, yyyy")}`;
  const hasPlan = !!targetId && result.items.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-0">
        <SheetHeader className="space-y-1 border-b border-border px-4 pb-3 pt-4 text-left">
          <SheetTitle className="text-base font-black">Your weekly grocery list</SheetTitle>
          <SheetDescription className="text-xs">
            Built automatically from your meal plan and your Training, Rest, and High Days.
          </SheetDescription>
          {coachPreview && (
            <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Coach preview</div>
          )}
        </SheetHeader>

        <div className="space-y-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
          <div className="flex flex-wrap items-center gap-2">
            {([0, 1] as const).map((off) => (
              <Button
                key={off}
                size="sm"
                variant={weekOffset === off ? "default" : "outline"}
                onClick={() => setWeekOffset(off)}
                className="rounded-full"
              >
                {off === 0 ? "This Week" : "Next Week"}
              </Button>
            ))}
            <div className="text-xs text-muted-foreground">{rangeLabel}</div>
          </div>

          {q.isLoading ? (
            <div className="flex items-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Building your list…
            </div>
          ) : !hasPlan ? (
            <div className="rounded-lg border border-border bg-secondary/20 p-6 text-center">
              <div className="text-sm font-black">No grocery list yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                Your grocery list will appear when your coach assigns a meal plan.
              </div>
            </div>
          ) : (
            <>
              <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2">
                <div className="text-xs font-semibold">{weekSummaryText(dayCounts)}</div>
                {q.data?.configuredHighDay && (
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    High Day: {q.data.configuredHighDay}
                  </div>
                )}
                {result.unmatchedDayTypes.length > 0 && (
                  <div className="mt-1 text-[11px] text-muted-foreground">
                    No plan set for:{" "}
                    {result.unmatchedDayTypes
                      .map((t) => (t === "high" ? "High Days" : t === "training" ? "Training Days" : "Non-Training Days"))
                      .join(", ")}
                  </div>
                )}
              </div>

              {(q.data?.unscheduledCount ?? 0) > 0 && (
                <div className="rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
                  <div className="text-xs font-semibold">Schedule incomplete</div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {q.data!.unscheduledCount} workout{q.data!.unscheduledCount === 1 ? "" : "s"} have no date yet, so
                    Training Day counts may be low.{" "}
                    <Link
                      to={coachPreview ? "/admin/clients/$id/schedule" : "/portal/schedule"}
                      params={coachPreview ? ({ id: clientId! } as any) : (undefined as any)}
                      className="font-semibold underline"
                      onClick={() => onOpenChange(false)}
                    >
                      Open Schedule Manager
                    </Link>
                  </div>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant="outline" onClick={clearChecked} disabled={checked.length === 0}>
                  Clear Checked
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setHideChecked((v) => !v)}>
                  {hideChecked ? "Show checked" : "Hide checked"}
                </Button>
              </div>

              <div className="space-y-5">
                {result.sections.map((section) => {
                  const visible = hideChecked
                    ? section.items.filter((i) => !checked.includes(i.identity))
                    : section.items;
                  if (visible.length === 0) return null;
                  return (
                    <div key={section.category} className="space-y-2">
                      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                        {section.category}
                      </div>
                      <ul className="space-y-1.5">
                        {visible.map((item) => {
                          const isChecked = checked.includes(item.identity);
                          return (
                            <li key={item.identity}>
                              <label
                                className={cn(
                                  "flex min-h-[52px] w-full items-center gap-3 rounded-lg border border-border bg-card px-3 py-2",
                                  isChecked && "opacity-55",
                                )}
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggle(item.identity)}
                                  className="h-6 w-6 shrink-0"
                                />
                                <span
                                  className={cn(
                                    "min-w-0 flex-1 break-words text-sm font-semibold",
                                    isChecked && "line-through",
                                  )}
                                >
                                  {item.name}
                                </span>
                                <span className="shrink-0 whitespace-nowrap text-sm font-black tabular-nums">
                                  {item.quantityLabel}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Prominent entry point card shown next to Meal Plan. */
export function GroceryListEntryCard({
  clientId,
  viewAsUserId,
  className,
}: {
  clientId: string | null | undefined;
  viewAsUserId?: string | null;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className={cn("rounded-lg border border-border bg-card p-4 md:p-5", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
            <ShoppingCart className="h-4 w-4" />
          </div>
          <div>
            <div className="text-sm font-black uppercase tracking-widest">Grocery List</div>
            <div className="text-[11px] text-muted-foreground">Everything you need for the next 7 days</div>
          </div>
        </div>
        <Button size="sm" onClick={() => setOpen(true)} disabled={!clientId}>
          View Grocery List
        </Button>
      </div>
      {open && (
        <GroceryListSheet
          open={open}
          onOpenChange={setOpen}
          clientId={clientId}
          viewAsUserId={viewAsUserId}
        />
      )}
    </div>
  );
}
