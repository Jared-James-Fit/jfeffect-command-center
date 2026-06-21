import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { format, parseISO } from "date-fns";
import { Ticket } from "lucide-react";

type Props = {
  clientId: string | null | undefined;
  nextAppointmentAt?: string | null;
};

/**
 * Compact "Sessions" card for the client dashboard.
 * Shows: package name · sessions remaining · next appointment.
 * Hidden when the client has no active session packages.
 * Monetary value is only rendered when `show_value_to_client` is true.
 */
export function SessionsCard({ clientId, nextAppointmentAt }: Props) {
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
    <Link to="/portal/appointments" className="block">
      <div className="rounded-2xl border border-border bg-card p-4 hover:bg-accent/40 transition">
        <div className="flex items-center gap-3">
          <div className="rounded-lg bg-primary/10 p-2 text-primary"><Ticket className="h-4 w-4" /></div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{active.offer_name || "Session package"}</div>
            <div className="text-xs text-muted-foreground">
              {active.remaining} session{active.remaining === 1 ? "" : "s"} remaining
              {purchase?.show_value_to_client && purchase.full_payable_amount
                ? ` · ${(purchase.currency || "CAD")} ${Number(purchase.full_payable_amount).toLocaleString()}`
                : ""}
            </div>
            <div className="text-xs text-muted-foreground">
              {nextAppointmentAt
                ? `Next: ${format(parseISO(nextAppointmentAt), "EEE MMM d, h:mm a")}`
                : "No upcoming appointments"}
            </div>
          </div>
        </div>
      </div>
    </Link>
  );
}