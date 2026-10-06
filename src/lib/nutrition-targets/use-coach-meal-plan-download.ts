import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { getClientMealPlanForCoach } from "@/lib/nutrition-targets/admin-meal-plan.functions";

/** Coach side: download the meal plan this client currently sees, as a PDF. */
export function useCoachMealPlanDownload(clientId: string, clientName?: string | null) {
  const [pending, setPending] = useState(false);
  const fetchMealPlan = useServerFn(getClientMealPlanForCoach);

  const download = async () => {
    setPending(true);
    const toastId = toast.loading("Generating meal plan PDF…");
    try {
      const plan = await fetchMealPlan({ data: { clientId } });
      if (!plan) {
        toast.error(`${clientName ?? "This client"} has no visible meal plan assigned.`, { id: toastId });
        return;
      }
      const { downloadMealPlanPdf } = await import("@/lib/nutrition-targets/meal-plan-pdf");
      await downloadMealPlanPdf({
        client_name: plan.client_name ?? clientName ?? null,
        coach_name: plan.coach_name ?? null,
        updated_at: plan.updated_at ?? null,
        start_date: plan.start_date ?? null,
        phase: plan.phase ?? null,
        goal: plan.goal ?? null,
        structure: plan.structure ?? null,
        water: plan.water ?? null,
        client_notes: plan.client_notes ?? null,
        food_weighing_rules: (plan as any).food_weighing_rules ?? null,
        days: (plan.days ?? []) as any[],
      });
      toast.success("Meal plan PDF downloaded", { id: toastId });
    } catch (err) {
      console.error("Meal plan PDF download failed", err);
      toast.error("Could not generate meal plan PDF.", { id: toastId });
    } finally {
      setPending(false);
    }
  };

  return { pending, download };
}
