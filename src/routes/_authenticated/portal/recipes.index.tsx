import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { RecipeBrowser } from "@/components/nutrition/RecipeBrowser";
import { MemberMealPlanPanel } from "@/components/nutrition/MemberMealPlanPanel";
import { getActiveMemberTargets } from "@/lib/nutrition-targets/member-targets.functions";
import { Card } from "@/components/ui/card";
import { Target } from "lucide-react";

export const Route = createFileRoute("/_authenticated/portal/recipes/")({
  component: PortalRecipes,
});

function PortalRecipes() {
  const portalUserId = usePortalUserId();
  const { data: client } = useQuery({
    queryKey: ["my-client-recipes", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () =>
      (await supabase.from("clients").select("goals").eq("user_id", portalUserId!).maybeSingle()).data,
  });
  const goals = (client as any)?.goals ? [String((client as any).goals)] : [];

  const getTargetsFn = useServerFn(getActiveMemberTargets);
  const targetsQ = useQuery({
    queryKey: ["portal-recipes-targets", portalUserId],
    queryFn: () => getTargetsFn({}),
    staleTime: 60_000,
  });
  const t = targetsQ.data as any;

  return (
    <>
      <PageHeader title="Nutrition" subtitle="Your meal plan, targets, and recipes." />
      <MemberMealPlanPanel />
      {t && (
        <div className="px-4 md:px-6 pt-4">
          <Card className="p-4 md:p-5 space-y-3">
            <div className="flex items-center gap-2">
              <div className="grid h-9 w-9 place-items-center rounded-lg bg-primary/15 text-primary">
                <Target className="h-4 w-4" />
              </div>
              <div>
                <div className="text-sm font-black uppercase tracking-widest">Your Targets</div>
                <div className="text-[11px] text-muted-foreground">
                  {t.source === "coach" ? "Set by your coach" : t.source === "manual" ? "Manually set" : "Calculated"}
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "Cal", value: t.calories },
                { label: "Protein", value: t.protein_g, unit: "g" },
                { label: "Carbs", value: t.carbs_g, unit: "g" },
                { label: "Fats", value: t.fat_g, unit: "g" },
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
          </Card>
        </div>
      )}
      <div className="p-4 pb-28 md:p-6 md:pb-12">
        <div className="mb-3 text-xs font-black uppercase tracking-widest text-muted-foreground">Recipes</div>
        <RecipeBrowser viewer="client" userId={portalUserId ?? undefined} goals={goals} />
      </div>
    </>
  );
}
