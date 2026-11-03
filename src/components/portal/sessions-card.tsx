import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Ticket } from "lucide-react";
import { Card } from "@/components/ui/card";

type Props = {
  clientId: string | null | undefined;
};

/**
 * Compact "Sessions" card for the client dashboard: the package and its
 * credits (purchased · scheduled · used · available). The next session is
 * the calendar card's, right above it, so it isn't repeated here, and the
 * calendar is that card's one link. Hidden when the client has no active
 * session packages. Monetary value is only rendered when
 * `show_value_to_client` is true.
 */
export function SessionsCard({ clientId }: Props) {
  const { data: balance } = useQuery<any[]>({
    queryKey: ["my-session-balance", clientId],
    enabled: !!clientId,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      if (error) return [];
      return (data ?? []).filter((p: any) => (p.remaining ?? 0) > 0);
    },
  });

  const active = (balance ?? [])[0];

  // Look up the show_value flag for this purchase
  const { data: purchase } = useQuery<{ show_value_to_client: boolean; full_payable_amount: number | null; currency: string | null } | null>({
    queryKey: ["my-session-purchase", active?.purchase_id ?? null],
    enabled: !!active?.purchase_id,
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("show_value_to_client, full_payable_amount, currency")
        .eq("id", active!.purchase_id)
        .maybeSingle();
      return (data as any) ?? null;
    },
  });

  if (!active) return null;

  return (
    <Card className="flex items-center gap-3 p-4">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground" aria-hidden>
        <Ticket className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-semibold">{active.offer_name || "Session package"}</div>
        <div className="text-xs text-muted-foreground">
          {active.granted} purchased
          {Number(active.reserved ?? 0) > 0 ? <> · {active.reserved} scheduled</> : null}
          {" · "}{active.used} used
          {purchase?.show_value_to_client && purchase.full_payable_amount
            ? ` · ${(purchase.currency || "CAD")} ${Number(purchase.full_payable_amount).toLocaleString()}`
            : ""}
        </div>
      </div>
      <div className="shrink-0 text-right">
        <div className="text-lg font-semibold leading-none tabular-nums">{active.remaining}</div>
        <div className="mt-0.5 text-[11px] text-muted-foreground">available</div>
      </div>
    </Card>
  );
}
