import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The unit a client logs in (clients.preferred_weight_unit), lb unless they
 * chose kg — the same fallback the workout logger uses. Max editors default
 * to it so "315" typed for an lb lifter is never saved as 315 kg.
 */
export function useClientWeightUnit(clientId: string | null | undefined): {
  unit: "kg" | "lb";
  ready: boolean;
} {
  const { data, isSuccess } = useQuery({
    queryKey: ["client-weight-unit", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("preferred_weight_unit")
        .eq("id", clientId!)
        .maybeSingle();
      return data?.preferred_weight_unit === "kg" ? "kg" : "lb";
    },
  });
  return { unit: data ?? "lb", ready: isSuccess };
}
