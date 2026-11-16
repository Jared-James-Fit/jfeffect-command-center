/**
 * The auto-pay setup card in a chat (kind "auto_pay_setup"). It reads its
 * change live, because the attachment only says what was sent: a client sees
 * Set up auto-pay until they've done it, then "Auto-pay is set up"; a newer
 * link or a cancelled one reads "No longer needed". The coach sees where it
 * stands. The amount is what each payment comes to, tax included.
 */
import { useQuery } from "@tanstack/react-query";
import { CheckCircle2, ExternalLink, Repeat } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { billingDay } from "@/lib/date-range";
import { everyWords, type Every } from "@/lib/auto-pay";

export type AutoPaySetupAttachment = {
  kind: "auto_pay_setup";
  url?: string;
  change_id?: string;
  each_cents?: number;
  every?: Every;
  first_date?: string | null;
  currency?: string;
};

export function AutoPaySetupCard({ att, staff }: { att: AutoPaySetupAttachment; staff: boolean }) {
  const changeId = att.change_id;
  const { data: change } = useQuery({
    queryKey: ["auto-pay-change", changeId ?? null],
    enabled: !!changeId,
    staleTime: 30_000,
    queryFn: async () =>
      (await (supabase as any).from("auto_pay_changes").select("status, completed_at").eq("id", changeId!).maybeSingle()).data as
        | { status: string; completed_at: string | null }
        | null,
  });
  const status = change?.status ?? "pending";
  const done = status === "completed";
  const gone = status === "cancelled" || status === "superseded";
  const currency = (att.currency ?? "CAD").toUpperCase();
  const each = typeof att.each_cents === "number"
    ? new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(att.each_cents / 100)
    : null;

  return (
    <div className="w-[260px] max-w-full overflow-hidden rounded-xl border border-border bg-card text-card-foreground" data-auto-pay-card={status}>
      <div className="flex items-center gap-2 px-3 pt-3">
        <Repeat className="h-4 w-4 text-muted-foreground" />
        <span className="text-[14px] font-semibold">Auto-pay</span>
        {done && (
          <span className="ml-auto flex items-center gap-1 text-[12px] font-medium text-success">
            <CheckCircle2 className="h-3.5 w-3.5" /> Set up
          </span>
        )}
      </div>
      <div className="px-3 pb-3 pt-1">
        {each && (
          <div className={cn("text-[18px] font-semibold tabular-nums", gone && "text-muted-foreground line-through")}>
            {each} <span className="text-[14px] font-normal text-muted-foreground">{att.every ? everyWords(att.every) : ""}</span>
          </div>
        )}
        <div className="text-[13px] text-muted-foreground">
          {done
            ? "Auto-pay is set up. Payments come out on their own."
            : gone
              ? "No longer needed."
              : att.first_date
                ? `First payment ${billingDay(att.first_date)}. Tax included.`
                : "Tax included."}
        </div>
        {!done && !gone && att.url && (
          <a href={att.url} target="_blank" rel="noreferrer" className="mt-2.5 block">
            <Button size="sm" variant={staff ? "outline" : "default"} className="h-10 w-full">
              {staff ? "Waiting for them · open link" : "Set up auto-pay"}
              <ExternalLink className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </a>
        )}
      </div>
    </div>
  );
}
