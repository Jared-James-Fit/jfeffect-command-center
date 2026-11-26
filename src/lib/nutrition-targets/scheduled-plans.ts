import { supabase } from "@/integrations/supabase/client";
export type ScheduledNutrition = { id: string; client_id: string; start_date: string; updated_at: string; payload: Record<string, any>; days: Array<Record<string, any>>; baseline: unknown };
export const scheduledNutritionKey = (clientId: string) => ["nutrition-scheduled-plans", clientId] as const;
export function scheduledNutritionQuery(clientId: string) {
  return { queryKey: scheduledNutritionKey(clientId), enabled: !!clientId, queryFn: async (): Promise<ScheduledNutrition[]> => {
    const { data, error } = await (supabase as any).from("nutrition_scheduled_plans").select("id,client_id,start_date,updated_at,payload,days,baseline").eq("client_id",clientId).eq("state","scheduled").order("start_date");
    if (error) throw new Error(error.message);
    return data ?? [];
  }};
}
export async function manageScheduledNutrition(clientId: string, draft: ScheduledNutrition | null, action: "save" | "activate" | "cancel", payload?: Record<string, any>, days?: Array<Record<string, any>>) {
  const { data,error } = await (supabase as any).rpc("manage_scheduled_nutrition", { _client_id: clientId, _id: draft?.id ?? null, _expected_updated_at: draft?.updated_at ?? null, _action: action, _payload: payload ?? null, _days: days ?? null });
  if (error || !data) throw new Error(error?.message ?? "Couldn't save scheduled plan");
  return data as { id?: string; targetId?: string; archived?: number };
}
