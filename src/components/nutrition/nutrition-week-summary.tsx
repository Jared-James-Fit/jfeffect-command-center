import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getFoodHistoryFn } from "@/lib/nutrition-ai-plans.functions";
import { foodHistoryKey, type FoodHistory } from "@/lib/nutrition-targets/food-history";
import { Info, History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { supabase } from "@/integrations/supabase/client";
import { getClientWorkouts } from "@/lib/pl-programs";
import { mondayWeekDates, resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { parseLocalDate, todayLocalISO, toLocalISO } from "@/lib/today";
import { planPeriod, type PlanRow } from "@/lib/nutrition-targets/plan-history";
import { summarizeNutritionWeek, type WeeklyPlanDay } from "@/lib/nutrition-targets/weekly-summary";
import { PlanEventTimeline } from "@/components/clients/plan-event-timeline";
import { plansOnDate, type PlanMilestone } from "@/lib/plan-event-timeline";
import { prefillPlanAiChange } from "@/lib/weight-management/handoff";

type Props = {
  clientId: string;
  days: WeeklyPlanDay[];
  references: PlanRow[];
  anchor?: string;
  onReuse?: (plan: PlanRow) => void;
  showCleo?: boolean;
  currentId?: string | null;
};

const number = (v: number | null | undefined) => v == null ? "—" : Math.round(v).toLocaleString();
const difference = (a: number | null, b: number | null) => a == null || b == null ? "—" : (a > b ? "+" : "") + number(a - b);

export function NutritionWeekSummary({ clientId, days, references, anchor, onReuse, showCleo = false, currentId }: Props) {
  const [selected, setSelected] = useState("");
  const [detail, setDetail] = useState(0);
  const [showMeals, setShowMeals] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const readHistory = useServerFn(getFoodHistoryFn);
  const statsQ = useQuery({ queryKey: foodHistoryKey(clientId), enabled: !!clientId && compareOpen, staleTime: 30_000, queryFn: () => readHistory({ data: { clientId } }) as Promise<{ history: FoodHistory }> });
  const [milestone, setMilestone] = useState<PlanMilestone | null>(null);
  const eventRefs = milestone ? plansOnDate(references, milestone.date, (p) => ({ start: p.start_date, end: p.end_date })) : [];
  const ref = references.find((p) => p.id === selected) ?? (milestone ? eventRefs.length === 1 ? eventRefs[0] : undefined : references[0]);
  const today = todayLocalISO();
  const date = parseLocalDate(anchor || today) ?? parseLocalDate(today)!;
  const monday = new Date(date);
  monday.setDate(date.getDate() - ((date.getDay() + 6) % 7));
  const dates = mondayWeekDates(toLocalISO(monday));
  const q = useQuery({
    queryKey: ["nutrition-week-summary", clientId, dates[0]],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const [client, overrides, workouts] = await Promise.all([
        supabase.from("clients").select("committed_training_days, preferred_high_days").eq("id", clientId).maybeSingle(),
        (supabase.from("nutrition_day_overrides") as any).select("override_date,day_label").eq("client_id", clientId).gte("override_date", dates[0]).lte("override_date", dates[6]),
        getClientWorkouts(clientId),
      ]);
      if (client.error || overrides.error || !client.data) throw new Error("Couldn't load the nutrition schedule.");
      return {
        preferredHighDays: client.data.preferred_high_days as string[] | null,
        overrides: overrides.data ?? [],
        workoutDates: resolveWorkoutDatesFromItems(workouts as any[], client.data.committed_training_days ?? null).map((w) => w.date),
        scheduleKnown: true,
      };
    },
  });
  if (!clientId) return null;
  const current = q.data ? summarizeNutritionWeek(days, dates, q.data) : null;
  const previous = q.data && ref ? summarizeNutritionWeek((ref.nutrition_target_days ?? []) as WeeklyPlanDay[], dates, q.data) : null;
  const total = current?.total ?? null;
  const average = current?.average ?? null;
  const currDay = current?.rows[detail]?.day;
  const prevDay = previous?.rows[detail]?.day;
  const delta = difference(total, previous?.total ?? null);
  const referenceStats = statsQ.data?.history.plans.find((p) => p.id === ref?.id);
  const currentStats = currentId ? statsQ.data?.history.plans.find((p) => p.id === currentId) : undefined;
  const rate = (v: number | null | undefined) => v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(2)} kg/wk`;
  const rating = (v: number | null | undefined) => v == null ? "—" : `${v.toFixed(1)}/5`;

  return (
    <section className="min-w-0 space-y-2 rounded-xl border border-border p-3" aria-label="Weekly nutrition comparison">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5 text-[13px] font-medium">
          Weekly targets
          <Popover>
            <PopoverTrigger asChild>
              <button type="button" title="How weekly targets are calculated" aria-label="How weekly targets are calculated" className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-muted-foreground hover:bg-muted">
                <Info className="h-4 w-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent className="max-w-[calc(100vw-2rem)] text-xs" align="start">
              Prescribed calories across the selected Monday–Sunday schedule, using workouts, high day and overrides. Both plans are projected on the same dates to isolate plan changes; this is not historical intake. Missing targets are not counted as zero.
            </PopoverContent>
          </Popover>
        </div>
        <span className="text-xs text-muted-foreground">{dates[0]} – {dates[6].slice(5)}</span>
      </div>
      <PlanEventTimeline clientId={clientId} onPick={(m) => { setMilestone(m); setSelected(""); setShowMeals(false); }} renderMilestone={(m) => {
        const matches = plansOnDate(references, m.date, (p) => ({ start: p.start_date, end: p.end_date }));
        return <p className="text-muted-foreground">{matches.length === 1 ? planPeriod(matches[0]) : matches.length > 1 ? matches.length + " matching reference plans" : "No reference plan covers this date."}</p>;
      }} />
      {milestone && <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground"><span>{milestone.event.name} · {milestone.label} · {milestone.date}</span><button type="button" onClick={() => { setMilestone(null); setSelected(""); }} className="underline">Clear</button></div>}
      {q.isError ? (
        <div className="flex items-center justify-between gap-2 text-xs"><span>Schedule unavailable.</span><Button type="button" variant="ghost" size="sm" onClick={() => void q.refetch()}>Retry</Button></div>
      ) : !current ? <p className="text-xs text-muted-foreground" aria-live="polite">Reading schedule…</p> : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <div className="min-w-0"><div className="text-xs text-muted-foreground">Weekly calories</div><div className="text-xl font-semibold tabular-nums">{number(total)}</div></div>
            <div className="min-w-0"><div className="text-xs text-muted-foreground">Daily average</div><div className="text-xl font-semibold tabular-nums">{number(average)}</div></div>
          </div>
          {!current.complete ? <p className="text-xs text-warning">Incomplete week · assign all seven calorie targets.</p> : current.estimated ? <p className="text-xs text-muted-foreground">Estimated · includes a suggested high day.</p> : null}
          <div className="grid grid-cols-7 gap-1" role="group" aria-label="Select day to compare">
            {current.rows.map((r, i) => <button type="button" key={r.dateISO} aria-pressed={detail === i} onClick={() => setDetail(i)} title={r.day?.day_label ?? "Unassigned"} className={"min-w-0 rounded-md px-0.5 py-1.5 text-center text-[10px] tabular-nums hover:bg-muted " + (detail === i ? "bg-muted ring-1 ring-border" : "")}><span className="block text-muted-foreground">{["M","T","W","T","F","S","S"][i]}</span><span className="block font-medium">{number(r.calories)}</span></button>)}
          </div>
          <div className="flex items-center justify-between gap-2 border-t border-border pt-2 text-xs">
            <span className="min-w-0 truncate text-muted-foreground">{ref ? "vs. " + planPeriod(ref) : "No previous plan"}</span><span className="shrink-0 font-medium tabular-nums">{ref ? delta + (delta === "—" ? "" : " kcal") : ""}</span>
          </div>
          {references.length > 0 && <details className="group text-xs" onToggle={(e) => setCompareOpen(e.currentTarget.open)}>
            <summary className="flex cursor-pointer items-center gap-1.5 rounded-md py-2 font-medium"><History className="h-3.5 w-3.5" />Compare plans<span className="ml-auto text-muted-foreground">+</span></summary>
            <div className="space-y-3 pt-1">
              <label className="block text-muted-foreground">Reference plan
                <select className="mt-1 h-9 w-full rounded-md border border-border bg-background px-2 text-foreground" value={ref?.id ?? ""} onChange={(e) => { setSelected(e.target.value); setShowMeals(false); }}>
                  {!ref && <option value="" disabled>{eventRefs.length > 1 ? "Select a matching plan" : "Select a reference plan"}</option>}
                  {references.map((p) => <option key={p.id} value={p.id}>{planPeriod(p)} · {p.phase ?? "Nutrition"}</option>)}
                </select>
              </label>
              <div className="grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(0,1fr))] gap-x-2 gap-y-1.5 tabular-nums">
                <span/><span className="text-right text-muted-foreground">Reference</span><span className="text-right text-muted-foreground">This plan</span>
                <span>Week (kcal)</span><span className="text-right">{number(previous?.total)}</span><span className="text-right font-medium">{number(total)}</span>
                <span>Daily average</span><span className="text-right">{number(previous?.average)}</span><span className="text-right font-medium">{number(average)}</span>
                <span className="col-span-3 mt-1 border-t border-border pt-2 text-muted-foreground">{dates[detail]} · {currDay?.day_label ?? "Unassigned"}</span>
                {(["calories", "protein", "carbs", "fats", "steps"] as const).map((key) => <div key={key} className="contents"><span className="capitalize">{key}</span><span className="text-right">{number(prevDay?.[key])}</span><span className="text-right font-medium">{number(currDay?.[key])}</span></div>)}
              </div>
              <details className="rounded-md border border-border p-2">
                <summary className="cursor-pointer font-medium">Results during each plan</summary>
                {statsQ.isError ? <p className="mt-2 text-muted-foreground">Results unavailable. <button type="button" className="underline" onClick={() => void statsQ.refetch()}>Retry</button></p> : statsQ.isLoading ? <p className="mt-2 text-muted-foreground">Reading recorded results…</p> : <div className="mt-2 grid grid-cols-[minmax(0,1fr)_repeat(2,minmax(0,1fr))] gap-2 tabular-nums">
                  <span/><span className="text-right text-muted-foreground">Reference</span><span className="text-right text-muted-foreground">{currentId ? "This plan" : "Draft"}</span>
                  <span>Observed dates</span><span className="text-right">{referenceStats ? referenceStats.start.slice(5) + "–" + referenceStats.end.slice(5) : "—"}</span><span className="text-right">{currentStats ? currentStats.start.slice(5) + "–" + currentStats.end.slice(5) : "—"}</span>
                  <span>Weight trend</span><span className="text-right">{rate(referenceStats?.kgPerWeek)}</span><span className="text-right">{rate(currentStats?.kgPerWeek)}</span>
                  <span>Nutrition rating</span><span className="text-right">{rating(referenceStats?.rating)}</span><span className="text-right">{rating(currentStats?.rating)}</span>
                  <span>Check-ins</span><span className="text-right">{number(referenceStats?.checkins)}</span><span className="text-right">{number(currentStats?.checkins)}</span>
                  <span>Hunger flags</span><span className="text-right">{number(referenceStats?.hunger)}</span><span className="text-right">{number(currentStats?.hunger)}</span>
                  <span className="col-span-3 text-muted-foreground">Recorded results, not proof that the plan caused them. A draft has no results.</span>
                </div>}
              </details>
              <Button type="button" variant="ghost" size="sm" className="w-full" aria-expanded={showMeals} onClick={() => setShowMeals(!showMeals)}>{showMeals ? "Hide" : "Compare"} meal plan</Button>
              {showMeals && <div className="grid gap-2 sm:grid-cols-2">
                <div className="min-w-0 rounded-md border border-border p-2"><p className="mb-1 font-medium">Reference · {prevDay?.day_label ?? "—"}</p><p className="whitespace-pre-wrap break-words text-muted-foreground">{prevDay?.notes || "No meal text recorded."}</p></div>
                <div className="min-w-0 rounded-md border border-border p-2"><p className="mb-1 font-medium">This plan · {currDay?.day_label ?? "—"}</p><p className="whitespace-pre-wrap break-words text-muted-foreground">{currDay?.notes || "No meal text recorded."}</p></div>
              </div>}
              <div className="flex flex-wrap gap-2">
                {ref && onReuse && <Button type="button" variant="outline" size="sm" onClick={() => onReuse(ref)}>Use as draft</Button>}
                {ref && showCleo && <Button type="button" variant="outline" size="sm" onClick={() => prefillPlanAiChange(clientId, "Compare the current nutrition plan to the reference plan " + planPeriod(ref) + " (plan ID " + ref.id + "). Use the saved reference if available; do not guess missing details.")}>Ask Cleo to compare</Button>}
              </div>
            </div>
          </details>}
        </>
      )}
    </section>
  );
}
