/**
 * Client Nutrition — single container that owns ONE canonical selected-day
 * state. The selected day type synchronously drives the hero, targets
 * (calories/protein/carbs/fats/fibre/water), coach instructions and the meal
 * plan. There is no separate targets-vs-meal-plan selector any more.
 *
 * Everything here is read-only against coach data.
 */

import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format } from "date-fns";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, Download, FileText, Loader2, Target, Utensils, Droplets } from "lucide-react";
import { MealPlanDisplay } from "@/components/meal-plan-display";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { getClientWorkouts } from "@/lib/pl-programs";
import { resolveWorkoutDatesFromItems } from "@/lib/resolved-client-days";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { todayLocalISO } from "@/lib/today";
import { SectionErrorBoundary } from "@/components/section-error-boundary";
import { toast } from "sonner";
import {
  DAY_TYPE_LABEL,
  resolveClientNutritionDay,
  resolvePlanDaySelection,
} from "@/lib/client-nutrition-day";
import { TodaysPlanHero } from "@/components/nutrition/TodaysPlanHero";
import { MacroBreakdown } from "@/components/nutrition/MacroBreakdown";
import { NutritionReviewCard } from "@/components/nutrition/NutritionReviewCard";
import { TodaysIntakeCard, LogFoodToolButton } from "@/components/nutrition/TodaysIntakeCard";
import { CookbookEntryCard } from "@/components/nutrition/CookbookSheet";
import { NutritionToolsCard } from "@/components/nutrition/NutritionToolsCard";
import { GroceryListEntryCard } from "@/components/nutrition/GroceryListSheet";
import { RecentAdherenceWidget } from "@/components/nutrition/RecentAdherenceWidget";
import { ClientCardioSection } from "@/components/cardio/ClientCardioSection";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({
  component: PortalNutrition,
});

function PortalNutrition() {
  const portalUserId = usePortalUserId();
  const { client: impersonatedClient } = useClientImpersonation();
  const getPlanFn = useServerFn(getCoachAssignedMealPlan);
  const todayISO = todayLocalISO();

  const ctxQ = useQuery({
    queryKey: ["portal-nutrition-ctx", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      try {
        const { data } = await (supabase as any)
          .from("clients")
          .select("id, goals, preferred_high_days, committed_training_days")
          .eq("user_id", portalUserId!)
          .maybeSingle();
        return {
          goals: data?.goals ? [String(data.goals)] : ([] as string[]),
          clientId: (data?.id as string | undefined) ?? null,
          preferredHighDays: (data?.preferred_high_days as string[] | null) ?? null,
          committedTrainingDays: (data?.committed_training_days as string[] | null) ?? null,
        };
      } catch (e) {
        console.error("[portal-nutrition] ctx query failed", e);
        return { goals: [] as string[], clientId: null as string | null, preferredHighDays: null, committedTrainingDays: null };
      }
    },
    retry: false,
  });

  const clientId = ctxQ.data?.clientId ?? null;

  // Exact-date overrides + scheduled workouts — the two inputs for auto-detection.
  const scheduleQ = useQuery({
    queryKey: ["portal-nutrition-schedule", clientId],
    enabled: !!clientId,
    staleTime: 60_000,
    queryFn: async () => {
      const [overridesRes, workouts] = await Promise.all([
        (supabase.from("nutrition_day_overrides") as any)
          .select("override_date,day_label")
          .eq("client_id", clientId!),
        getClientWorkouts(clientId!),
      ]);
      const workoutDates = resolveWorkoutDatesFromItems(
        workouts as any[],
        ctxQ.data?.committedTrainingDays ?? null,
      ).map((w) => w.date);
      return {
        overrides: (overridesRes.data ?? []) as { override_date: string; day_label: string }[],
        workoutDates,
      };
    },
  });

  const planQ = useQuery({
    queryKey: ["portal-coach-meal-plan", portalUserId, impersonatedClient?.user_id ?? null],
    enabled: !!portalUserId,
    queryFn: () =>
      getPlanFn({
        data: impersonatedClient?.user_id ? { viewAsUserId: impersonatedClient.user_id } : {},
      }),
    staleTime: 60_000,
    retry: false,
  });

  const plan = (planQ.data ?? null) as any | null;
  const days: any[] = Array.isArray(plan?.days) ? plan.days : [];

  const resolution = useMemo(
    () =>
      resolveClientNutritionDay({
        dateISO: todayISO,
        overrides: scheduleQ.data?.overrides ?? null,
        preferredHighDays: ctxQ.data?.preferredHighDays ?? null,
        workoutDates: scheduleQ.data?.workoutDates ?? null,
        scheduleKnown: !!scheduleQ.data,
      }),
    [todayISO, scheduleQ.data, ctxQ.data?.preferredHighDays],
  );

  // Automatic day categories are guidance only. The client selects an exact
  // uploaded plan-day record by stable ID, so coach-created titles never need
  // to be normalized or remapped to become reviewable.
  const automaticDayType = resolution.dayType;
  const [manualPlanId, setManualPlanId] = useState<string | null>(null);
  const selection = resolvePlanDaySelection(days, automaticDayType, manualPlanId);
  const day = selection.selectedPlanDayId
    ? days.find((candidate) => candidate.id === selection.selectedPlanDayId) ?? null
    : null;
  const planChoices = days
    .filter((candidate) => typeof candidate.id === "string" && String(candidate.day_label ?? "").trim().length > 0)
    .map((candidate) => ({ id: candidate.id as string, title: String(candidate.day_label).trim() }));

  const [downloading, setDownloading] = useState(false);
  const handleDownload = async () => {
    if (!plan) return;
    setDownloading(true);
    try {
      const { downloadMealPlanPdf } = await import("@/lib/nutrition-targets/meal-plan-pdf");
      downloadMealPlanPdf({
        client_name: plan.client_name ?? null,
        coach_name: plan.coach_name ?? null,
        updated_at: plan.updated_at ?? null,
        start_date: plan.start_date ?? null,
        phase: plan.phase ?? null,
        goal: plan.goal ?? null,
        structure: plan.structure ?? null,
        water: plan.water ?? null,
        client_notes: plan.client_notes ?? null,
        days: days as any[],
      });
    } catch (err) {
      console.error("Failed to generate meal plan PDF", err);
      toast.error("Could not generate PDF. Please try again.");
    } finally {
      setDownloading(false);
    }
  };

  const headerLine = useMemo(
    () =>
      plan ? [plan.phase, plan.goal, plan.structure].filter(Boolean).join(" · ") || "Assigned by your coach" : "",
    [plan],
  );

  const missingDayNote = plan && !day
    ? `No ${DAY_TYPE_LABEL[automaticDayType]} plan is assigned for today. You can still review any uploaded plan above.`
    : null;

  return (
    <>
      <PageHeader title="Nutrition" subtitle="Your plan, targets, and recipes — set by your coach." />

      <div className="space-y-4 px-4 pb-[max(6rem,env(safe-area-inset-bottom))] pt-4 md:px-6">
        {/* 1. TODAY'S PLAN hero — owns nothing, reflects the container state. */}
        <SectionErrorBoundary label="Today's plan">
          <TodaysPlanHero
            planChoices={planChoices}
            selectedPlanId={selection.selectedPlanDayId}
            automaticDayType={automaticDayType}
            onSelectPlan={(planDayId) => setManualPlanId(planDayId === selection.automaticPlanDayId ? null : planDayId)}
            resolution={resolution}
            isManual={selection.isManual}
            dateLabel={format(new Date(), "EEE, MMM d")}
          />
        </SectionErrorBoundary>

        {/* 2. Nutrition Targets for the selected day. */}
        <SectionErrorBoundary label="Nutrition targets">
          {planQ.isLoading ? (
            <Card className="p-5 text-sm text-muted-foreground">Loading your nutrition plan…</Card>
          ) : planQ.isError || !plan ? (
            <Card className="p-5">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-muted text-muted-foreground">
                  <Target className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-black uppercase tracking-widest">Nutrition Targets</div>
                  <div className="text-[12px] text-muted-foreground">
                    {planQ.isError ? "We couldn't load your plan right now." : "No nutrition targets assigned yet."}
                  </div>
                </div>
              </div>
            </Card>
          ) : (
            <Card className="space-y-4 p-4 md:p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex items-center gap-2">
                  <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                    <Target className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-black uppercase tracking-widest">Nutrition Targets</div>
                    <div className="text-[11px] text-muted-foreground">
                      {day?.day_label || DAY_TYPE_LABEL[automaticDayType]}
                      {headerLine ? ` · ${headerLine}` : ""}
                    </div>
                  </div>
                </div>
              </div>

              {day ? (
                <>
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                    {[
                      { label: "Calories", value: day.calories },
                      { label: "Protein", value: day.protein, unit: "g" },
                      { label: "Carbs", value: day.carbs, unit: "g" },
                      { label: "Fats", value: day.fats, unit: "g" },
                      { label: "Fibre", value: day.fibre, unit: "g" },
                    ].map((m) => (
                      <div key={m.label} className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-center">
                        <div className="text-lg font-black leading-none tabular-nums">
                          {m.value ?? "—"}
                          {m.value != null && m.unit && (
                            <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{m.unit}</span>
                          )}
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                      </div>
                    ))}
                  </div>

                  {plan.water && (
                    <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
                      <Droplets className="h-4 w-4 text-primary" />
                      <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Water</div>
                      <div className="ml-auto text-sm font-black">{plan.water}</div>
                    </div>
                  )}

                  {/* Macro split lives inside Targets. */}
                  <MacroBreakdown
                    targets={{
                      calories: day.calories,
                      protein: day.protein,
                      carbs: day.carbs,
                      fats: day.fats,
                    }}
                  />
                </>
              ) : (
                <div className="text-xs text-muted-foreground">{missingDayNote ?? "No uploaded meal plan is available yet."}</div>
              )}
            </Card>
          )}
        </SectionErrorBoundary>

        {/* 3. Meal Plan — always the same day as the targets above. */}
        {plan && day && (
          <SectionErrorBoundary label="Meal plan">
            <Card className="space-y-3 p-4 md:p-5">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Utensils className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-black uppercase tracking-widest">Meal Plan</div>
                  <div className="text-[11px] text-muted-foreground">{day.day_label || DAY_TYPE_LABEL[automaticDayType]}</div>
                </div>
              </div>
              {day.notes && String(day.notes).trim() ? (
                <MealPlanDisplay text={day.notes} collapsibleMeals />
              ) : (
                <div className="text-xs text-muted-foreground">
                  Your coach hasn't added meal details for this day yet.
                </div>
              )}
            </Card>
          </SectionErrorBoundary>
        )}

        {plan?.client_notes && (
          <Card className="p-4 md:p-5">
            <div className="mb-2 flex items-center gap-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">Coach Notes</div>
            </div>
            <div className="whitespace-pre-wrap text-xs">{plan.client_notes}</div>
          </Card>
        )}

        {/* 4. Nutrition Review — self-hides when no form is assigned. */}
        <SectionErrorBoundary label="Nutrition review">
          <NutritionReviewCard />
        </SectionErrorBoundary>

        {/* 5. Today's Intake — only when food logging is actually in use. */}
        <SectionErrorBoundary label="Today's intake">
          <TodaysIntakeCard />
        </SectionErrorBoundary>

        {/* 6. Prescribed cardio — hidden when nothing is prescribed. */}
        {clientId && (
          <SectionErrorBoundary label="Cardio">
            <ClientCardioSection clientId={clientId} hideWhenEmpty />
          </SectionErrorBoundary>
        )}

        {/* 7. Cookbook entry — recipes load only when opened. */}
        <SectionErrorBoundary label="Cookbook">
          <CookbookEntryCard viewer="client" />
        </SectionErrorBoundary>

        {/* 8. Compact Nutrition Tools. */}
        <SectionErrorBoundary label="Nutrition tools">
          <NutritionToolsCard
            viewer="client"
            hasCoachApprovedTargets={!!plan}
            extras={
              <div className="space-y-2">
                <LogFoodToolButton />
                {plan?.pdf_signed_url && (
                  <Button asChild variant="outline" className="h-11 w-full justify-start">
                    <a href={plan.pdf_signed_url} target="_blank" rel="noreferrer">
                      <FileText className="mr-2 h-4 w-4" /> {plan.pdf_name || "Open PDF"}
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  className="h-11 w-full justify-start"
                  onClick={handleDownload}
                  disabled={downloading || !plan}
                >
                  {downloading ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="mr-2 h-4 w-4" />
                  )}
                  {downloading ? "Preparing…" : "Download Meal Plan PDF"}
                </Button>
                <GroceryListEntryCard clientId={clientId} />
                <RecentAdherenceWidget />
              </div>
            }
          />
        </SectionErrorBoundary>
      </div>
    </>
  );
}
