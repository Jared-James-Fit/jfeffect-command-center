import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useClientImpersonation, usePortalUserId } from "@/lib/client-impersonation";
import type { WeightUnit } from "@/lib/weight-lifted";

// lb by default; the choice is saved on the client (clients.preferred_weight_unit,
// the same preference the analytics pages seed from). A coach in "View as client"
// can flip the display but never writes to the client's record.
export function useWeightUnit() {
  const qc = useQueryClient();
  const portalUserId = usePortalUserId();
  const viewingAsClient = !!useClientImpersonation().client;
  const key = ["league-weight-unit", portalUserId];
  const { data: saved } = useQuery({
    queryKey: key,
    enabled: !!portalUserId,
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<WeightUnit> => {
      const { data } = await supabase.from("clients").select("preferred_weight_unit").eq("user_id", portalUserId!).maybeSingle();
      return data?.preferred_weight_unit === "kg" ? "kg" : "lb";
    },
  });
  const [local, setLocal] = useState<WeightUnit | null>(null);
  const unit: WeightUnit = local ?? saved ?? "lb";
  const setUnit = async (next: WeightUnit) => {
    const prev = unit;
    setLocal(next);
    if (viewingAsClient || !portalUserId) return;
    qc.setQueryData(key, next);
    const { error } = await supabase.from("clients").update({ preferred_weight_unit: next }).eq("user_id", portalUserId);
    if (error) {
      qc.setQueryData(key, prev);
      setLocal(null);
      toast.error("Couldn't save your unit preference");
    }
  };
  return { unit, setUnit };
}
