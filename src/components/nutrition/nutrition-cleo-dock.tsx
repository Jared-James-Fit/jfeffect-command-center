/**
 * Cleo — Nutrition on the client's Nutrition tab (Nov 23 2026): the same
 * docked panel as Cleo in the program builder and the Cardio tab, hosting the
 * plan's own reviewed, undoable change engine (PlanAiChange: the coach says
 * what to change, it's written in the background from the shared client
 * intelligence, the coach sees exactly what changes day by day and puts it on
 * the plan with one tap, Undo after). It opens from the Current plan card,
 * from plan quality's Optimize, and from a recommendation (the prefill event),
 * with the words in the box, never sent or applied by itself.
 *
 * One way in on the tab (Nov 24 2026): the plan-quality strip's Optimize and Ask
 * Cleo, then the closed dock's handle once the strip has scrolled away (or with
 * no plan yet, when there's no strip). The Current plan card's own entry
 * (NutritionCleoEntry) is only for where no dock is mounted: a quick sheet from
 * the Clients list, which takes the coach to the tab.
 */
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { useCleoAccess } from "@/hooks/use-cleo-access";
import { CleoDockFrame, DockBrief, useCleoDock } from "@/components/program-ai/cleo-dock";
import type { QualityScore } from "@/lib/plan-quality";
import { CleoMark } from "@/components/summer/cleo-mark";
import { PlanAiChange } from "@/components/nutrition/PlanAiChange";
import { clientPlansQuery } from "@/lib/nutrition-targets/plan-publish";
import { splitPlans } from "@/lib/nutrition-targets/plan-history";
import { PLAN_AI_PREFILL_EVENT, prefillPlanAiChange } from "@/lib/weight-management/handoff";
import { cn } from "@/lib/utils";

export const NUTRITION_CLEO_OPEN_EVENT = "jf:nutrition-cleo-open";
export const NUTRITION_CLEO_OPTIMIZE_EVENT = "jf:nutrition-cleo-optimize";

export const NUTRITION_QUICK_ASKS = [
  "Adjust their nutrition for the next four weeks",
  "Optimize their calories, macros and steps together, keeping cardio as it is",
  "Review everything before I publish",
  "Make the rest days easier to stick to",
];

/** The strip's Cleo buttons (or the strip while it loads): the tab's one way into Cleo. */
const NUTRITION_CLEO_ANCHOR = "[data-plan-intelligence='nutrition'] [data-quality-actions], [data-plan-intelligence='nutrition'][aria-busy]";

/** Clients whose Nutrition tab has its dock mounted (a quick sheet from the Clients list doesn't). */
const mounted = new Set<string>();

/** Open Cleo on the Nutrition tab (optionally with words in the box). */
export function openNutritionCleo(clientId: string, text?: string) {
  if (typeof window === "undefined") return;
  if (text) prefillPlanAiChange(clientId, text);
  else window.dispatchEvent(new CustomEvent(NUTRITION_CLEO_OPEN_EVENT, { detail: { clientId } }));
}

/** Optimize with Cleo: the dock opens on the ranked brief (plan-intelligence.tsx). */
export function optimizeNutritionCleo(clientId: string, quality: QualityScore) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(NUTRITION_CLEO_OPTIMIZE_EVENT, { detail: { clientId, quality } }));
}

/** The Current plan card's way in. */
export function NutritionCleoEntry({ clientId }: { clientId: string }) {
  const cleo = useCleoAccess();
  const navigate = useNavigate();
  return (
    <button
      type="button"
      onClick={() => {
        if (mounted.has(clientId)) openNutritionCleo(clientId);
        // from a quick sheet: the Nutrition tab, where the dock sits beside the plan
        else
          void navigate({ to: "/admin/clients/$id", params: { id: clientId }, search: { tab: "nutrition" } as any }).then(() =>
            window.setTimeout(() => openNutritionCleo(clientId), 500),
          );
      }}
      className="flex min-h-12 w-full cursor-pointer items-center gap-3 rounded-xl border border-border px-3 py-2.5 text-left transition-colors hover:bg-muted/40"
      data-nutrition-cleo-entry
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-foreground text-background">{cleo ? <CleoMark size={16} /> : null}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[15px] font-medium">{cleo ? "Adjust with Cleo" : "Adjust plan"}</span>
        <span className="block text-[13px] text-muted-foreground">Say what to change. You see every change before it reaches the plan.</span>
      </span>
    </button>
  );
}

export function NutritionCleoDock({ clientId }: { clientId: string }) {
  const dock = useCleoDock();
  const cleo = useCleoAccess();
  const { data: targets = [] } = useQuery(clientPlansQuery(clientId));
  const plan = splitPlans(targets).current[0] ?? null;
  const { data: client } = useQuery({
    queryKey: ["client-user-id", clientId],
    queryFn: async () => {
      const { data, error } = await supabase.from("clients").select("user_id, full_name").eq("id", clientId).maybeSingle();
      if (error) throw error;
      return data;
    },
  });
  const firstName = String((client as any)?.full_name ?? "").trim().split(/\s+/)[0] || null;

  useEffect(() => {
    mounted.add(clientId);
    return () => {
      mounted.delete(clientId);
    };
  }, [clientId]);

  const { ask: dockAsk, optimize: dockOptimize } = dock;
  useEffect(() => {
    const onPrefill = (e: Event) => {
      const d = (e as CustomEvent<{ clientId: string; text?: string }>).detail;
      if (!d || d.clientId !== clientId) return;
      dockAsk(d.text);
    };
    const onOptimize = (e: Event) => {
      const d = (e as CustomEvent<{ clientId: string; quality: QualityScore }>).detail;
      if (!d || d.clientId !== clientId || !d.quality) return;
      dockOptimize({ domain: "nutrition", what: "nutrition plan", quality: d.quality });
    };
    window.addEventListener(PLAN_AI_PREFILL_EVENT, onPrefill);
    window.addEventListener(NUTRITION_CLEO_OPEN_EVENT, onPrefill);
    window.addEventListener(NUTRITION_CLEO_OPTIMIZE_EVENT, onOptimize);
    return () => {
      window.removeEventListener(PLAN_AI_PREFILL_EVENT, onPrefill);
      window.removeEventListener(NUTRITION_CLEO_OPEN_EVENT, onPrefill);
      window.removeEventListener(NUTRITION_CLEO_OPTIMIZE_EVENT, onOptimize);
    };
  }, [clientId, dockAsk, dockOptimize]);

  return (
    <CleoDockFrame dock={dock} name={cleo ? "Cleo" : "Adjust plan"} subtitle={`Nutrition${firstName ? ` · ${firstName}` : ""}`} branded={cleo} handle={NUTRITION_CLEO_ANCHOR}>
      <DockBrief dock={dock} />
      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3" data-nutrition-cleo>
        <p className="text-[13px] leading-snug text-muted-foreground">
          I read their plan, food on file, bodyweight trend, check-ins, training and cardio. Tell me what to change; you pick which days change, and nothing reaches {firstName ?? "them"} until you put it on the plan.
        </p>
        <div className="flex flex-wrap gap-1.5" data-nutrition-quick>
          {NUTRITION_QUICK_ASKS.map((q) => (
            <button
              key={q}
              type="button"
              onClick={() => prefillPlanAiChange(clientId, q)}
              className={cn("cursor-pointer rounded-full border border-border px-2.5 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground")}
            >
              {q}
            </button>
          ))}
        </div>
        {plan ? (
          <PlanAiChange clientId={clientId} plan={plan as any} firstName={firstName} seed={dock.seed} />
        ) : (
          <p className="rounded-xl border border-border px-3 py-3 text-[13px] text-muted-foreground">No nutrition plan yet. Build one or send the Nutrition Update first; then I can change it with you.</p>
        )}
        <p className="text-[12px] text-muted-foreground">
          Cardio is its own plan: change it on the{" "}
          <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "cardio" } as any} className="font-medium text-foreground underline-offset-2 hover:underline">
            Cardio tab
          </Link>
          , where Cleo reads this same picture of them.
        </p>
      </div>
    </CleoDockFrame>
  );
}
