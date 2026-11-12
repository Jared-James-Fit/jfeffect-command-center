/**
 * Client Nutrition — single container that owns ONE canonical selected-day
 * state. The selected day type synchronously drives the hero, targets
 * (calories/protein/carbs/fats/fibre/water), coach instructions and the meal
 * plan. There is no separate targets-vs-meal-plan selector any more.
 *
 * Everything here is read-only against coach data.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useServiceTier } from "@/lib/service-tier";
import { MemberNutritionPage } from "@/components/nutrition/member-nutrition-page";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { PageBodySkeleton } from "@/components/route-pending";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { ClipboardList, Download, FileText, Pill, Scale, ShieldAlert, Target, Utensils } from "lucide-react";
import { NUTRITION_DISCLAIMER, NUTRITION_DISCLAIMER_TITLE } from "@/lib/nutrition-disclaimer";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { clientWorkoutsQuery, PAGE_CACHE_MS, PAGE_FRESH_MS, primaryWorkouts } from "@/lib/client-workouts-query";
import { coachMealPlanQuery, portalNutritionCtxQuery } from "@/lib/portal-page-queries";
import { useArrivalClass } from "@/hooks/use-arrival";
import { MealPlanCardSkeleton, TargetsCardSkeleton } from "@/components/nutrition/nutrition-skeleton";
import { cn } from "@/lib/utils";
import { resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { todayLocalISO } from "@/lib/today";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { toast } from "sonner";
import {
  DAY_TYPE_LABEL,
  resolveClientNutritionDay,
  resolvePlanDaySelection,
  weekdayForISO,
  type DayResolution,
} from "@/lib/client-nutrition-day";
import { TodaysPlanHero } from "@/components/nutrition/TodaysPlanHero";
import { MacroTargetsChart } from "@/components/nutrition/MacroTargetsChart";
import { MealPlanReader } from "@/components/nutrition/MealPlanReader";
import { NutritionInfoSheet, RulesList } from "@/components/nutrition/NutritionInfoSheet";
import { TodaysIntakeCard, LogFoodToolButton } from "@/components/nutrition/TodaysIntakeCard";
import { CookbookToolTile } from "@/components/nutrition/CookbookSheet";
import { NutritionToolsCard, ToolRow, ToolTile } from "@/components/nutrition/NutritionToolsCard";
import { GroceryListEntryCard } from "@/components/nutrition/GroceryListSheet";
import { SupplementList } from "@/components/nutrition/supplements-ui";
import { readPlanSupplements } from "@/lib/nutrition-targets/supplements";
import { RecentAdherenceWidget } from "@/components/nutrition/RecentAdherenceWidget";
import { ClientCardioSection } from "@/components/cardio/ClientCardioSection";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({
  component: PortalNutritionByTier,
});

/**
 * Members set their own targets; coaching clients see their coach's. Until the
 * tier is known the title stays and the body waits: never one version first
 * and then the other.
 */
function PortalNutritionByTier() {
  const { tier, loading } = useServiceTier();
  if (loading) {
    return (
      <>
        <PageHeader title="Nutrition" />
        <PageBodySkeleton />
      </>
    );
  }
  return tier === "self_serve" ? <MemberNutritionPage /> : <PortalNutrition />;
}

function PortalNutrition() {
  const portalUserId = usePortalUserId();
  const { client: impersonatedClient } = useClientImpersonation();
  const getPlanFn = useServerFn(getCoachAssignedMealPlan);
  const todayISO = todayLocalISO();

  // All three start together: the client row, the coach's plan, and the program
  // (shared with Workouts and the cardio card, so it's downloaded once and often
  // already on the phone). Each is kept a day, so the next open paints at once.
  const ctxQ = useQuery({ ...portalNutritionCtxQuery(portalUserId ?? ""), enabled: !!portalUserId });

  const clientId = ctxQ.data?.clientId ?? null;

  // Exact-date overrides + scheduled workouts: the two inputs for auto-detection.
  const overridesQ = useQuery({
    queryKey: ["portal-nutrition-overrides", clientId],
    enabled: !!clientId,
    staleTime: PAGE_FRESH_MS,
    gcTime: PAGE_CACHE_MS,
    queryFn: async () =>
      (((await (supabase.from("nutrition_day_overrides") as any)
        .select("override_date,day_label")
        .eq("client_id", clientId!)).data ?? []) as { override_date: string; day_label: string }[]),
  });
  const workoutsQ = useQuery({ ...clientWorkoutsQuery(clientId ?? ""), enabled: !!clientId });
  const committedTrainingDays = ctxQ.data?.committedTrainingDays ?? null;
  const schedule = useMemo(
    () =>
      overridesQ.data && workoutsQ.data
        ? {
            overrides: overridesQ.data,
            workoutDates: resolveWorkoutDatesFromItems(primaryWorkouts(workoutsQ.data) as any[], committedTrainingDays).map((w) => w.date),
          }
        : null,
    [overridesQ.data, workoutsQ.data, committedTrainingDays],
  );

  const planQ = useQuery({
    ...coachMealPlanQuery(portalUserId ?? "", impersonatedClient?.user_id ?? null, getPlanFn as any),
    enabled: !!portalUserId,
  });
  const planArrived = useArrivalClass(planQ.isLoading);

  const plan = (planQ.data ?? null) as any | null;
  const days: any[] = Array.isArray(plan?.days) ? plan.days : [];

  const resolution = useMemo(
    () =>
      resolveClientNutritionDay({
        dateISO: todayISO,
        overrides: schedule?.overrides ?? null,
        preferredHighDays: ctxQ.data?.preferredHighDays ?? null,
        workoutDates: schedule?.workoutDates ?? null,
        scheduleKnown: !!schedule,
      }),
    [todayISO, schedule, ctxQ.data?.preferredHighDays],
  );

  // Today's plan day is the one the coach set for today's kind of day and
  // weekday (pickPlanDayForDate: "Training Day (Friday Only)" on a training
  // Friday). The client can still pick any saved day by its stable ID.
  const [manualPlanId, setManualPlanId] = useState<string | null>(null);
  const selection = resolvePlanDaySelection(
    days,
    { dayType: resolution.dayType, baseType: resolution.baseType, weekday: weekdayForISO(todayISO) },
    manualPlanId,
  );
  const automaticDayType = selection.dayType;
  // a High Day on a plan with no High Day is just the training / rest day it is
  const shownResolution: DayResolution =
    automaticDayType === resolution.dayType
      ? resolution
      : { ...resolution, dayType: automaticDayType, source: automaticDayType === "training" ? "workout" : "default", suggested: !schedule };
  const day = selection.selectedPlanDayId
    ? days.find((candidate) => candidate.id === selection.selectedPlanDayId) ?? null
    : null;
  const planChoices = days
    .filter((candidate) => typeof candidate.id === "string" && String(candidate.day_label ?? "").trim().length > 0)
    .map((candidate) => ({ id: candidate.id as string, title: String(candidate.day_label).trim() }));

  const [downloading, setDownloading] = useState(false);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [suppsOpen, setSuppsOpen] = useState(false);
  const supplements = readPlanSupplements(plan?.supplements ?? null);
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const weighingRules = plan?.food_weighing_rules ? String(plan.food_weighing_rules).trim() : "";
  const handleDownload = async () => {
    if (!plan) return;
    setDownloading(true);
    try {
      const { downloadMealPlanPdf } = await import("@/lib/nutrition-targets/meal-plan-pdf");
      await downloadMealPlanPdf({
        client_name: plan.client_name ?? null,
        coach_name: plan.coach_name ?? null,
        updated_at: plan.updated_at ?? null,
        start_date: plan.start_date ?? null,
        phase: plan.phase ?? null,
        goal: plan.goal ?? null,
        structure: plan.structure ?? null,
        water: plan.water ?? null,
        client_notes: plan.client_notes ?? null,
        food_weighing_rules: plan.food_weighing_rules ?? null,
        days: days as any[],
      });
    } catch (err) {
      console.error("Failed to generate meal plan PDF", err);
      toast.error("Could not generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  // The targets card names the day and the phase; goal and structure are the coach's detail.
  const phase = plan?.phase ? String(plan.phase).trim() : "";

  const missingDayNote = plan && !day
    ? `No ${DAY_TYPE_LABEL[automaticDayType]} plan is assigned for today. You can still review any uploaded plan above.`
    : null;

  return (
    <>
      <PageHeader title="Nutrition" />

      <div className="space-y-4 px-4 pb-[max(6rem,env(safe-area-inset-bottom))] pt-4 md:px-6">
        {/* 1. Which day's plan: a slim switch (date + chips), not a hero; the targets card names the day. */}
        <SectionErrorBoundary label="Today's plan">
          <TodaysPlanHero
            planChoices={planChoices}
            selectedPlanId={selection.selectedPlanDayId}
            todayPlanId={selection.automaticPlanDayId}
            automaticDayType={automaticDayType}
            onSelectPlan={(planDayId) => setManualPlanId(planDayId === selection.automaticPlanDayId ? null : planDayId)}
            resolution={shownResolution}
            isManual={selection.isManual}
            dateLabel={format(new Date(), "EEE, MMM d")}
          />
        </SectionErrorBoundary>

        {/* 2. Meal Plan first: it's what the client opens Nutrition for. Its PDF
            is the Tools tile (one PDF button on the page, reachable on any day). */}
        {planQ.isLoading && <MealPlanCardSkeleton />}
        {plan && day && (
          <SectionErrorBoundary label="Meal plan">
            <Card className={cn("space-y-4 p-4 md:p-5", planArrived)}>
              <div className="flex items-center gap-2">
                <Utensils className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="text-base font-semibold">Meal plan</div>
                  {/* The day is the chip above; this is when the coach last updated the plan (the same date the coach sees on it). */}
                  {plan.updated_at && (
                    <div className="text-xs text-muted-foreground">Updated {format(new Date(plan.updated_at), "MMM d")}</div>
                  )}
                </div>
              </div>
              {day.notes && String(day.notes).trim() ? (
                <MealPlanReader text={String(day.notes)} water={plan.water ?? null} />
              ) : (
                <div className="text-xs text-muted-foreground">
                  Your coach hasn't added meal details for this day yet.
                </div>
              )}
              {/* 3. The meal plan's own tools, right under it: weighing, then the grocery list. */}
              {(weighingRules || clientId || supplements.items.length > 0) && (
                <div className="space-y-2">
                  {weighingRules && (
                    <ToolRow icon={Scale} title="How to weigh your food" onClick={() => setRulesOpen(true)} />
                  )}
                  {supplements.items.length > 0 && (
                    <ToolRow icon={Pill} title="Supplements" hint={supplements.items.map((x) => x.name).join(", ")} onClick={() => setSuppsOpen(true)} />
                  )}
                  {clientId && (
                    <SectionErrorBoundary label="Grocery list">
                      <GroceryListEntryCard clientId={clientId} viewAsUserId={impersonatedClient?.user_id ?? null} />
                    </SectionErrorBoundary>
                  )}
                </div>
              )}
            </Card>
          </SectionErrorBoundary>
        )}
        {/* No plan day today: the grocery list still has the week's days. */}
        {plan && !day && clientId && (
          <SectionErrorBoundary label="Grocery list">
            <GroceryListEntryCard clientId={clientId} viewAsUserId={impersonatedClient?.user_id ?? null} />
          </SectionErrorBoundary>
        )}

        {/* 4. Nutrition Targets for the same day as the meal plan. */}
        <SectionErrorBoundary label="Nutrition targets">
          {planQ.isLoading ? (
            <TargetsCardSkeleton />
          ) : planQ.isError || !plan ? (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <Target className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <div>
                  <div className="text-base font-semibold">Nutrition targets</div>
                  <div className="text-xs text-muted-foreground">
                    {planQ.isError ? "We couldn't load your plan right now." : "No nutrition targets assigned yet."}
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className={cn("space-y-4 p-4 md:p-5", planArrived)}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Target className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                  <div>
                    <div className="text-base font-semibold">Nutrition targets</div>
                    <div className="text-xs text-muted-foreground">
                      {day?.day_label || DAY_TYPE_LABEL[automaticDayType]}
                      {phase ? ` · ${phase}` : ""}
                    </div>
                  </div>
                </div>
              </div>

              {day ? (
                <MacroTargetsChart
                  calories={day.calories}
                  protein={day.protein}
                  carbs={day.carbs}
                  fats={day.fats}
                  fibre={day.fibre}
                  water={plan.water ?? null}
                  steps={(day as any).steps ?? null}
                />
              ) : (
                <div className="text-xs text-muted-foreground">{missingDayNote ?? "No uploaded meal plan is available yet."}</div>
              )}
            </Card>
          )}
        </SectionErrorBoundary>

        {plan?.client_notes && (
          <Card className="p-4 md:p-5">
            <div className="mb-2 flex items-center gap-2">
              <ClipboardList className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
              <div className="text-base font-semibold">Notes from your coach</div>
            </div>
            <div className="whitespace-pre-wrap text-sm">{plan.client_notes}</div>
          </Card>
        )}

        {/* Nutrition Tools — always open, right under the plan. Every tool appears
            once on the page: Log Food, the PDF and the Cookbook live only here. */}
        <SectionErrorBoundary label="Nutrition tools">
          <NutritionToolsCard
            viewer="client"
            hasCoachApprovedTargets={!!plan}
            tiles={
              <>
                <LogFoodToolButton />
                <ToolTile
                  icon={Download}
                  title="Meal Plan PDF"
                  onClick={handleDownload}
                  disabled={!plan}
                  busy={downloading}
                />
                {plan?.pdf_signed_url && (
                  <ToolTile icon={FileText} title="Coach's PDF" href={plan.pdf_signed_url} />
                )}
                {/* recipes load only when it's opened */}
                <CookbookToolTile viewer="client" />
              </>
            }
          />
        </SectionErrorBoundary>

        {/* Self-reported adherence: its own card, only once there are updates to show. */}
        <SectionErrorBoundary label="Recent adherence">
          <RecentAdherenceWidget />
        </SectionErrorBoundary>

        {/* 5. Today's Intake — only when food logging is actually in use. */}
        <SectionErrorBoundary label="Today's intake">
          <TodaysIntakeCard />
        </SectionErrorBoundary>

        {/* 6. Today's cardio as one line (it's logged in the workout or on Workouts, never here too). */}
        {clientId && (
          <SectionErrorBoundary label="Cardio">
            <ClientCardioSection clientId={clientId} hideWhenEmpty variant="line" />
          </SectionErrorBoundary>
        )}

        {/* Nutrition disclaimer: one quiet line, the full text a tap away. Always last. */}
        <button
          type="button"
          onClick={() => setDisclaimerOpen(true)}
          className="flex w-full items-center justify-center gap-1.5 rounded-lg py-3 text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ShieldAlert className="h-3.5 w-3.5 shrink-0" aria-hidden />
          <span>Coaching guidance, not medical advice.</span>
          <span className="font-semibold underline underline-offset-2">Read the disclaimer</span>
        </button>

        {supplements.items.length > 0 && (
          <NutritionInfoSheet open={suppsOpen} onOpenChange={setSuppsOpen} title="Supplements" icon={Pill}>
            <div className="space-y-3">
              <p className="text-[13px] text-muted-foreground">From your coach, picked for you. Food comes first: these fill the gaps.</p>
              <SupplementList value={supplements} />
            </div>
          </NutritionInfoSheet>
        )}
        {weighingRules && (
          <NutritionInfoSheet open={rulesOpen} onOpenChange={setRulesOpen} title="How to weigh your food" icon={Scale}>
            <RulesList text={weighingRules} />
          </NutritionInfoSheet>
        )}
        <NutritionInfoSheet open={disclaimerOpen} onOpenChange={setDisclaimerOpen} title={NUTRITION_DISCLAIMER_TITLE} icon={ShieldAlert}>
          <p>{NUTRITION_DISCLAIMER}</p>
        </NutritionInfoSheet>
      </div>
    </>
  );
}
