import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ClipboardList, FileText, Target, Utensils, Droplets } from "lucide-react";
import { MealPlanDisplay } from "@/components/meal-plan-display";
import { RecipeBrowser } from "@/components/nutrition/RecipeBrowser";
import { getCoachAssignedMealPlan } from "@/lib/nutrition-targets/member-targets.functions";
import { usePortalUserId, useClientImpersonation } from "@/lib/client-impersonation";
import { cn } from "@/lib/utils";
import { SectionErrorBoundary } from "@/components/section-error-boundary";

export const Route = createFileRoute("/_authenticated/portal/nutrition-targets")({
  component: PortalNutrition,
});

function PortalNutrition() {
  const portalUserId = usePortalUserId();
  const { client: impersonatedClient } = useClientImpersonation();
  const getPlanFn = useServerFn(getCoachAssignedMealPlan);

  const ctxQ = useQuery({
    queryKey: ["portal-nutrition-ctx", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => {
      try {
        const { data } = await (supabase as any)
          .from("clients")
          .select("goals")
          .eq("user_id", portalUserId!)
          .maybeSingle();
        const goals = data?.goals ? [String(data.goals)] : [];
        return { goals };
      } catch (e) {
        console.error("[portal-nutrition] ctx query failed", e);
        return { goals: [] as string[] };
      }
    },
    retry: false,
  });

  const planQ = useQuery({
    queryKey: ["portal-coach-meal-plan", portalUserId, impersonatedClient?.user_id ?? null],
    enabled: !!portalUserId,
    queryFn: () =>
      getPlanFn({
        data: impersonatedClient?.user_id
          ? { viewAsUserId: impersonatedClient.user_id }
          : {},
      }),
    staleTime: 60_000,
    retry: false,
  });

  const plan = (planQ.data ?? null) as any | null;
  const days: any[] = Array.isArray(plan?.days) ? plan.days : [];
  const [dayIdx, setDayIdx] = useState(0);
  const idx = Math.min(dayIdx, Math.max(0, days.length - 1));
  const day = days[idx];

  const headerLine = useMemo(
    () =>
      plan
        ? [plan.phase, plan.goal, plan.structure].filter(Boolean).join(" · ") || "Assigned by your coach"
        : "",
    [plan],
  );

  return (
    <>
      <PageHeader title="Nutrition" subtitle="Your plan, targets, and recipes — set by your coach." />

      <div className="px-4 md:px-6 pt-4 space-y-4">
        {/* 1. Nutrition Targets card */}
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
          <Card className="p-4 md:p-5 space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                  <Target className="h-4 w-4" />
                </div>
                <div>
                  <div className="text-sm font-black uppercase tracking-widest">Nutrition Targets</div>
                  <div className="text-[11px] text-muted-foreground">{headerLine}</div>
                  {(plan.start_date || plan.end_date) && (
                    <div className="text-[11px] text-muted-foreground mt-0.5">
                      {plan.start_date ? `From ${plan.start_date}` : ""}
                      {plan.end_date ? `${plan.start_date ? " · " : ""}Until ${plan.end_date}` : ""}
                    </div>
                  )}
                </div>
              </div>
              {plan.pdf_signed_url && (
                <Button asChild size="sm" variant="outline" className="gap-1.5">
                  <a href={plan.pdf_signed_url} target="_blank" rel="noreferrer">
                    <FileText className="h-3.5 w-3.5" /> {plan.pdf_name || "Open PDF"}
                  </a>
                </Button>
              )}
            </div>

            {/* 3. Day type selector */}
            {days.length > 1 && (
              <div className="flex flex-wrap gap-1.5">
                {days.map((d, i) => (
                  <button
                    key={d.id ?? i}
                    type="button"
                    onClick={() => setDayIdx(i)}
                    className={cn(
                      "rounded-full border px-3 py-1 text-[11px] font-bold uppercase tracking-wider transition",
                      i === idx
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-secondary/40 text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {d.day_label || `Day ${i + 1}`}
                  </button>
                ))}
              </div>
            )}

            {day ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
                {[
                  { label: "Calories", value: day.calories },
                  { label: "Protein", value: day.protein, unit: "g" },
                  { label: "Carbs", value: day.carbs, unit: "g" },
                  { label: "Fats", value: day.fats, unit: "g" },
                  { label: "Fibre", value: day.fibre, unit: "g" },
                ].map((m) => (
                  <div key={m.label} className="rounded-md border border-border bg-secondary/20 px-3 py-2 text-center">
                    <div className="text-lg font-black leading-none">
                      {m.value ?? "—"}
                      {m.value != null && m.unit && (
                        <span className="ml-0.5 text-[10px] font-normal text-muted-foreground">{m.unit}</span>
                      )}
                    </div>
                    <div className="mt-1 text-[10px] uppercase tracking-wide text-muted-foreground">{m.label}</div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">No day targets set.</div>
            )}

            {plan.water && (
              <div className="flex items-center gap-2 rounded-md border border-border bg-secondary/20 px-3 py-2">
                <Droplets className="h-4 w-4 text-primary" />
                <div className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">Water</div>
                <div className="ml-auto text-sm font-black">{plan.water}</div>
              </div>
            )}
          </Card>
        )}
        </SectionErrorBoundary>

        {/* 2. Meal Plan section */}
        {plan && day && (
        <SectionErrorBoundary label="Meal plan">
          <Card className="p-4 md:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                <Utensils className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-black uppercase tracking-widest">Meal Plan</div>
                <div className="text-[11px] text-muted-foreground">
                  {day.day_label || `Day ${idx + 1}`}
                </div>
              </div>
            </div>
            {day.notes && String(day.notes).trim() ? (
              <MealPlanDisplay text={day.notes} />
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
            <div className="flex items-center gap-2 mb-2">
              <ClipboardList className="h-4 w-4 text-primary" />
              <div className="text-[11px] font-black uppercase tracking-widest text-muted-foreground">
                Coach Notes
              </div>
            </div>
            <div className="text-xs whitespace-pre-wrap">{plan.client_notes}</div>
          </Card>
        )}
      </div>

      {/* 4. Recipes below */}
      <div className="p-4 pb-28 md:p-6 md:pb-12">
        <div className="mb-3 text-xs font-black uppercase tracking-widest text-muted-foreground">
          Recipes
        </div>
        <SectionErrorBoundary label="Recipes">
          <RecipeBrowser viewer="client" userId={portalUserId ?? undefined} goals={ctxQ.data?.goals ?? []} />
        </SectionErrorBoundary>
      </div>
    </>
  );
}
