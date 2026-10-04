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
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { addDays, format } from "date-fns";
import { Copy, Lightbulb, Loader2, ShoppingCart } from "lucide-react";
import { toast } from "sonner";
import { STORE_AISLE_EMOJI, groceryListText, groupByAisle } from "@/lib/grocery-shop";
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
  const [span, setSpan] = useState<1 | 2>(1);
  const [hideChecked, setHideChecked] = useState(false);
  const [checked, setChecked] = useState<string[]>([]);

  const thisMonday = mondayOf(todayLocalISO());
  const weekStart = toLocalISO(addDays(parseLocalDate(thisMonday)!, weekOffset * 7));
  const weekEnd = toLocalISO(addDays(parseLocalDate(weekStart)!, 7 * span - 1));

  const q = useQuery({
    // Lazy: only fetches once the sheet is opened.
    enabled: !!open && !!clientId,
    queryKey: [...groceryListKey(clientId, weekStart), viewAsUserId ?? null, span],
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
      const workoutDates = resolveWorkoutDatesFromItems(
        workouts as any[],
        client?.committed_training_days ?? null,
      );
      // 1 or 2 weeks of groceries: resolve each week's day types and combine.
      const days = Array.from({ length: span }, (_, w) =>
        resolveClientWeekDays({
          clientId: clientId!,
          weekDates: mondayWeekDates(toLocalISO(addDays(parseLocalDate(weekStart)!, w * 7))),
          workouts: workoutDates,
          recurringHighDays: client?.preferred_high_days ?? null,
          highDayOverrides: (overridesRes.data ?? []) as any[],
          fullCardioRestDays: client?.full_cardio_rest_days ?? null,
        }),
      ).flat();
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

  // Local-only shopping ticks, keyed by target + week start (+ span).
  const checkKey = span === 2 ? `${weekStart}:2w` : weekStart;
  useEffect(() => {
    if (!targetId) return;
    setChecked(readCheckedIdentities(targetId, checkKey));
  }, [targetId, checkKey]);

  const toggle = (identity: string) => {
    setChecked((prev) => {
      const next = prev.includes(identity) ? prev.filter((x) => x !== identity) : [...prev, identity];
      if (targetId) writeCheckedIdentities(targetId, checkKey, next);
      return next;
    });
  };

  const clearChecked = () => {
    setChecked([]);
    if (targetId) clearCheckedIdentities(targetId, checkKey);
  };

  const aisles = useMemo(() => groupByAisle(result.items), [result.items]);
  const doneCount = result.items.filter((i) => checked.includes(i.identity)).length;
  const copyList = async () => {
    const text = groceryListText(aisles, `JF Effect grocery list · ${span === 2 ? "2 weeks" : "1 week"} · ${rangeLabel}`);
    try {
      if (navigator.share && /iPhone|iPad|Android/i.test(navigator.userAgent)) {
        await navigator.share({ text, title: "Grocery list" });
      } else {
        await navigator.clipboard.writeText(text);
        toast.success("Grocery list copied — paste it into Notes or a text");
      }
    } catch (e: any) {
      if (e?.name !== "AbortError") toast.error("Couldn't copy the list");
    }
  };

  const rangeLabel = `${format(parseLocalDate(weekStart)!, "MMM d")} – ${format(parseLocalDate(weekEnd)!, "MMM d, yyyy")}`;
  const hasPlan = !!targetId && result.items.length > 0;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-0">
        <SheetHeader className="space-y-1 border-b border-border px-4 pb-3 pt-16 text-left">
          <SheetTitle className="text-lg font-black">
            🛒 {span === 2 ? "2 weeks" : "1 week"} of groceries
          </SheetTitle>
          <SheetDescription className="text-xs">
            Everything you need for {span === 2 ? "14 days" : "7 days"} of your meal plan, matched to your Training, Non-Training
            and High Days.
          </SheetDescription>
          {coachPreview && (
            <div className="text-[11px] font-bold uppercase tracking-widest text-primary">Coach preview</div>
          )}
        </SheetHeader>

        <div className="space-y-4 px-4 pb-[calc(6rem+env(safe-area-inset-bottom))] pt-4">
          <div className="grid grid-cols-2 rounded-xl bg-muted/60 p-1 text-sm font-bold">
            {([1, 2] as const).map((n) => (
              <button
                key={n}
                type="button"
                onClick={() => setSpan(n)}
                className={cn("min-h-10 rounded-lg transition", span === n ? "bg-background shadow-sm" : "text-muted-foreground")}
              >
                {n === 1 ? "1 week" : "2 weeks"}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {([0, 1] as const).map((off) => (
              <Button
                key={off}
                size="sm"
                variant={weekOffset === off ? "default" : "outline"}
                onClick={() => setWeekOffset(off)}
                className="rounded-full"
              >
                {off === 0 ? "Starting this week" : "Starting next week"}
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

              <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 px-3 py-2.5">
                <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="text-[11px] leading-relaxed text-muted-foreground">
                  <span className="font-bold text-foreground">Already done for you:</span> your plan uses cooked weights, so meat,
                  rice and potatoes are converted to what to buy <b>raw / dry</b> and rounded up to real package sizes. Sorted in the
                  order you walk the store.
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <div className="mr-auto text-xs font-bold tabular-nums">
                  {doneCount}/{result.items.length} in your cart
                </div>
                <Button size="sm" variant="outline" className="gap-1.5" onClick={copyList}>
                  <Copy className="h-3.5 w-3.5" /> Copy / share
                </Button>
                <Button size="sm" variant="outline" onClick={clearChecked} disabled={checked.length === 0}>
                  Clear
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setHideChecked((v) => !v)}>
                  {hideChecked ? "Show checked" : "Hide checked"}
                </Button>
              </div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-primary transition-all"
                  style={{ width: `${result.items.length ? (doneCount / result.items.length) * 100 : 0}%` }}
                />
              </div>

              <div className="space-y-5">
                {aisles.map((group) => {
                  const visible = hideChecked
                    ? group.items.filter((i) => !checked.includes(i.identity))
                    : group.items;
                  if (visible.length === 0) return null;
                  return (
                    <div key={group.aisle} className="space-y-2">
                      <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                        <span aria-hidden>{STORE_AISLE_EMOJI[group.aisle]}</span> {group.aisle}
                      </div>
                      <ul className="space-y-1.5">
                        {visible.map((item) => {
                          const isChecked = checked.includes(item.identity);
                          return (
                            <li key={item.identity}>
                              <label
                                className={cn(
                                  "flex min-h-[56px] w-full cursor-pointer items-start gap-3 rounded-xl border border-border bg-card px-3 py-2.5 transition",
                                  isChecked && "opacity-50",
                                )}
                              >
                                <Checkbox
                                  checked={isChecked}
                                  onCheckedChange={() => toggle(item.identity)}
                                  className="mt-0.5 h-6 w-6 shrink-0"
                                />
                                <span className="min-w-0 flex-1">
                                  <span className={cn("block break-words text-sm font-bold capitalize", isChecked && "line-through")}>
                                    {item.name}
                                  </span>
                                  <span className="block text-sm font-black text-primary">{item.buy}</span>
                                  {item.detail && <span className="block text-[11px] text-muted-foreground">{item.detail}</span>}
                                  {item.tip && !isChecked && (
                                    <span className="mt-0.5 block text-[11px] italic text-muted-foreground/90">💡 {item.tip}</span>
                                  )}
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

              <div className="rounded-lg border border-border bg-secondary/20 px-3 py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                <div className="mb-1 font-black uppercase tracking-widest text-foreground">🇨🇦 Save money</div>
                No Frills, Food Basics, FreshCo and Walmart are cheapest for staples. Costco wins on chicken, eggs, rice and whey.
                Buy family packs and freeze what you won't eat in 3 days. Frozen fruit and veg are just as good as fresh.
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
    <div className={cn("overflow-hidden rounded-xl border border-primary/30 bg-gradient-to-br from-primary/10 via-card to-card p-4 md:p-5", className)}>
      <button type="button" onClick={() => setOpen(true)} disabled={!clientId} className="flex w-full items-center gap-3 text-left">
        <div className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground shadow-sm">
          <ShoppingCart className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-black uppercase tracking-widest">Grocery List</div>
          <div className="text-[12px] text-muted-foreground">1 or 2 weeks of food from your plan · sorted by store aisle</div>
        </div>
        <span className="shrink-0 rounded-full bg-primary px-3 py-1.5 text-xs font-black text-primary-foreground">Open</span>
      </button>
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
