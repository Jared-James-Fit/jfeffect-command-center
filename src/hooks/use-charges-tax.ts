import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Whether the business charges tax on what it sells (GST-registered in
 * business_tax_settings, read through `business_charges_tax`). Products are
 * priced before tax and checkout adds it, so prices read "+ tax" while it's on.
 * Unknown (loading, or the read failed) says nothing rather than guess.
 */
export function useChargesTax(): boolean {
  const { data } = useQuery({
    queryKey: ["business-charges-tax"],
    staleTime: 60 * 60_000,
    gcTime: 24 * 60 * 60_000,
    retry: 1,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("business_charges_tax");
      if (error) throw error;
      return data === true;
    },
  });
  return data === true;
}
