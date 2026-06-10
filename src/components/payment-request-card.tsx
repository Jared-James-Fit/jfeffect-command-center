import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CreditCard, ExternalLink, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SharedAttachment } from "@/components/chat-shared";

export function PaymentRequestCard({ att, mine }: { att: SharedAttachment; mine: boolean }) {
  const amount = typeof att.amount_cents === "number"
    ? (att.amount_cents / 100).toLocaleString(undefined, { style: "currency", currency: (att.currency ?? "USD").toUpperCase() })
    : null;
  const paid = att.status === "Paid" || att.status === "Active Subscription";
  return (
    <div
      className={cn(
        "w-[260px] max-w-full overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm",
        mine ? "border-primary/30" : "border-border",
      )}
    >
      <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/40 px-3 py-2">
        <CreditCard className="h-4 w-4 text-primary" />
        <span className="text-[11px] font-bold uppercase tracking-widest">Payment Request</span>
        {paid && (
          <Badge variant="outline" className="ml-auto border-emerald-500/40 bg-emerald-500/10 text-emerald-600 text-[10px]">
            <CheckCircle2 className="mr-1 h-3 w-3" />Paid
          </Badge>
        )}
      </div>
      <div className="px-3 py-2.5">
        {att.title && <div className="text-sm font-semibold leading-tight">{att.title}</div>}
        {amount && <div className="mt-0.5 text-lg font-black tracking-tight">{amount}</div>}
        {att.payment_structure && (
          <div className="text-[11px] text-muted-foreground">{att.payment_structure}</div>
        )}
      </div>
      <div className="px-3 pb-3">
        {att.payment_url ? (
          <a href={att.payment_url} target="_blank" rel="noreferrer" className="block">
            <Button size="sm" className="w-full" disabled={paid}>
              {paid ? "Already paid" : "Pay now"}
              {!paid && <ExternalLink className="ml-1.5 h-3 w-3" />}
            </Button>
          </a>
        ) : (
          <Button size="sm" variant="outline" className="w-full" disabled>Link unavailable</Button>
        )}
      </div>
    </div>
  );
}