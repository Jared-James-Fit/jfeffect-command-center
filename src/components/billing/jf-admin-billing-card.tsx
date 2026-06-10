import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminSyncMemberStripe, adminCancelMember, adminFreezeMember,
  adminHoldPlanMember, adminReactivateMember, adminCompAccess,
} from "@/lib/jf-billing.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Snowflake, Pause, CreditCard, XCircle, ExternalLink, Gift } from "lucide-react";

function fmt(d: string | null | undefined) { return d ? new Date(d).toLocaleString() : "—"; }

const STATUS_TONE: Record<string, string> = {
  "Trialing": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "Active": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "Past Due": "bg-rose-500/10 text-rose-300 border-rose-500/30",
  "Payment Failed": "bg-rose-500/10 text-rose-300 border-rose-500/30",
  "Paused": "bg-sky-500/10 text-sky-300 border-sky-500/30",
  "Hold Plan": "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "Cancelled": "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
};

export function JfAdminBillingCard({ member }: { member: any }) {
  const qc = useQueryClient();
  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-member", member.id] });

  const syncFn = useServerFn(adminSyncMemberStripe);
  const cancelFn = useServerFn(adminCancelMember);
  const freezeFn = useServerFn(adminFreezeMember);
  const holdFn = useServerFn(adminHoldPlanMember);
  const reactFn = useServerFn(adminReactivateMember);
  const compFn = useServerFn(adminCompAccess);

  const sync = useMutation({
    mutationFn: () => syncFn({ data: { member_id: member.id } }),
    onSuccess: () => { toast.success("Synced from Stripe"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const cancel = useMutation({
    mutationFn: () => cancelFn({ data: { member_id: member.id } }),
    onSuccess: () => { toast.success("Cancelled"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const freeze = useMutation({
    mutationFn: () => freezeFn({ data: { member_id: member.id } }),
    onSuccess: () => { toast.success("Frozen 30 days"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const hold = useMutation({
    mutationFn: () => holdFn({ data: { member_id: member.id } }),
    onSuccess: () => { toast.success("Switched to Hold Plan"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const react = useMutation({
    mutationFn: () => reactFn({ data: { member_id: member.id } }),
    onSuccess: () => { toast.success("Reactivated"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const comp = useMutation({
    mutationFn: () => compFn({ data: { member_id: member.id, months: 1 } }),
    onSuccess: () => { toast.success("Comp month granted"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });

  const status = member.subscription_status ?? "—";
  const stripeUrl = member.stripe_subscription_id
    ? `https://dashboard.stripe.com/subscriptions/${member.stripe_subscription_id}`
    : member.stripe_customer_id
    ? `https://dashboard.stripe.com/customers/${member.stripe_customer_id}`
    : null;

  return (
    <Card className="border-border p-5 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">JF Billing</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline" className={STATUS_TONE[status] ?? ""}>{status}</Badge>
            {member.stripe_subscription_id && <span className="text-[11px] text-muted-foreground font-mono">{member.stripe_subscription_id}</span>}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={() => sync.mutate()} disabled={sync.isPending}>
            <RefreshCw className={`mr-1 h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} /> Sync Stripe
          </Button>
          {stripeUrl && (
            <a href={stripeUrl} target="_blank" rel="noopener" className="inline-flex">
              <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3.5 w-3.5" /> Stripe</Button>
            </a>
          )}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <div><span className="text-muted-foreground text-xs">Trial end:</span> {fmt(member.trial_end_at)}</div>
        <div><span className="text-muted-foreground text-xs">Next billing:</span> {fmt(member.current_period_end)}</div>
        <div><span className="text-muted-foreground text-xs">Cancel at:</span> {fmt(member.cancel_at)}</div>
        <div><span className="text-muted-foreground text-xs">Cancelled at:</span> {fmt(member.cancelled_at)}</div>
        <div><span className="text-muted-foreground text-xs">Paused until:</span> {fmt(member.paused_until)}</div>
        <div><span className="text-muted-foreground text-xs">Hold since:</span> {fmt(member.hold_plan_started_at)}</div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button size="sm" variant="outline" onClick={() => freeze.mutate()} disabled={freeze.isPending}>
          <Snowflake className="mr-1 h-3.5 w-3.5" /> Freeze 30d
        </Button>
        <Button size="sm" variant="outline" onClick={() => hold.mutate()} disabled={hold.isPending}>
          <Pause className="mr-1 h-3.5 w-3.5" /> Hold Plan
        </Button>
        <Button size="sm" variant="outline" onClick={() => react.mutate()} disabled={react.isPending}>
          <CreditCard className="mr-1 h-3.5 w-3.5" /> Reactivate
        </Button>
        <Button size="sm" variant="destructive" onClick={() => cancel.mutate()} disabled={cancel.isPending}>
          <XCircle className="mr-1 h-3.5 w-3.5" /> Cancel
        </Button>
        <Button size="sm" variant="ghost" onClick={() => comp.mutate()} disabled={comp.isPending}>
          <Gift className="mr-1 h-3.5 w-3.5" /> Comp 1 month
        </Button>
      </div>
    </Card>
  );
}