import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminSyncMemberStripe, adminCancelMember, adminFreezeMember,
  adminHoldPlanMember, adminReactivateMember, adminCompAccess,
  adminGrantTemporaryAccess, adminExtendTrial, adminRevokeAccess,
} from "@/lib/jf-billing.functions";
import { getMemberPaymentLedger, recordManualPayment } from "@/lib/member-payment-ledger.functions";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { RefreshCw, Snowflake, Pause, CreditCard, XCircle, ExternalLink, Gift, ShieldCheck, ShieldOff, Clock, DollarSign, ChevronDown, ChevronUp } from "lucide-react";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

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
  const [showLedger, setShowLedger] = useState(false);
  const [tempDays, setTempDays] = useState("30");
  const [tempNote, setTempNote] = useState("");
  const [extendDays, setExtendDays] = useState("7");
  const [manualAmount, setManualAmount] = useState("");
  const [manualNote, setManualNote] = useState("");
  const [manualDays, setManualDays] = useState("30");
  const [showTempForm, setShowTempForm] = useState(false);
  const [showManualForm, setShowManualForm] = useState(false);

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

  const grantTempFn = useServerFn(adminGrantTemporaryAccess);
  const extendTrialFn = useServerFn(adminExtendTrial);
  const revokeFn = useServerFn(adminRevokeAccess);
  const recordPaymentFn = useServerFn(recordManualPayment);
  const getLedgerFn = useServerFn(getMemberPaymentLedger);

  const grantTemp = useMutation({
    mutationFn: () => grantTempFn({ data: { member_id: member.id, days: parseInt(tempDays) || 30, note: tempNote || undefined } }),
    onSuccess: () => { toast.success(`Temporary access granted for ${tempDays} days`); setShowTempForm(false); setTempNote(""); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const extendTrial = useMutation({
    mutationFn: () => extendTrialFn({ data: { member_id: member.id, days: parseInt(extendDays) || 7 } }),
    onSuccess: () => { toast.success(`Trial extended by ${extendDays} days`); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const revoke = useMutation({
    mutationFn: () => revokeFn({ data: { member_id: member.id } }),
    onSuccess: () => { toast.success("Access revoked"); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const recordPayment = useMutation({
    mutationFn: () => recordPaymentFn({ data: {
      memberId: member.id,
      amountCents: manualAmount ? Math.round(parseFloat(manualAmount) * 100) : undefined,
      note: manualNote || undefined,
      accessGrantDays: parseInt(manualDays) || 30,
      status: "manual",
    }}),
    onSuccess: () => { toast.success("Manual payment recorded"); setShowManualForm(false); setManualNote(""); setManualAmount(""); invalidate(); },
    onError: (e: any) => toast.error(e.message),
  });
  const { data: ledgerData } = useQuery({
    queryKey: ["member-ledger", member.id],
    queryFn: () => getLedgerFn({ data: { memberId: member.id } }),
    enabled: showLedger,
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

      {/* ── New admin tools ── */}
      <div className="space-y-3 pt-3 border-t border-border">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Manual Access Tools</div>

        {/* Grant temporary access */}
        <div className="space-y-2">
          <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setShowTempForm(!showTempForm)}>
            <ShieldCheck className="mr-2 h-3.5 w-3.5 text-emerald-400" />
            Grant Temporary Access
            {showTempForm ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
          </Button>
          {showTempForm && (
            <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <Label className="text-xs">Days</Label>
                  <Input className="mt-1 h-8" type="number" min="1" value={tempDays} onChange={e => setTempDays(e.target.value)} />
                </div>
                <div>
                  <Label className="text-xs">Note (optional)</Label>
                  <Input className="mt-1 h-8" value={tempNote} onChange={e => setTempNote(e.target.value)} placeholder="Reason" />
                </div>
              </div>
              <Button size="sm" className="w-full" onClick={() => grantTemp.mutate()} disabled={grantTemp.isPending}>
                {grantTemp.isPending ? "Granting…" : `Grant ${tempDays || 30} days access`}
              </Button>
            </div>
          )}
        </div>

        {/* Extend trial */}
        <div className="flex items-center gap-2">
          <Button size="sm" variant="outline" className="flex-1 justify-start" onClick={() => extendTrial.mutate()} disabled={extendTrial.isPending}>
            <Clock className="mr-2 h-3.5 w-3.5 text-amber-400" />
            {extendTrial.isPending ? "Extending…" : `Extend Trial +${extendDays}d`}
          </Button>
          <Input className="h-8 w-16" type="number" min="1" value={extendDays} onChange={e => setExtendDays(e.target.value)} />
        </div>

        {/* Revoke access */}
        <Button size="sm" variant="outline" className="w-full justify-start text-red-400 border-red-500/30 hover:bg-red-500/10" onClick={() => revoke.mutate()} disabled={revoke.isPending}>
          <ShieldOff className="mr-2 h-3.5 w-3.5" />
          {revoke.isPending ? "Revoking…" : "Revoke Access (Kill Switch)"}
        </Button>
      </div>

      {/* ── Manual payment recording ── */}
      <div className="space-y-2 pt-3 border-t border-border">
        <Button size="sm" variant="outline" className="w-full justify-start" onClick={() => setShowManualForm(!showManualForm)}>
          <DollarSign className="mr-2 h-3.5 w-3.5 text-sky-400" />
          Record Manual Payment
          {showManualForm ? <ChevronUp className="ml-auto h-3.5 w-3.5" /> : <ChevronDown className="ml-auto h-3.5 w-3.5" />}
        </Button>
        {showManualForm && (
          <div className="rounded-md border border-border bg-muted/30 p-3 space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Amount ($)</Label>
                <Input className="mt-1 h-8" type="number" min="0" step="0.01" value={manualAmount} onChange={e => setManualAmount(e.target.value)} placeholder="0.00" />
              </div>
              <div>
                <Label className="text-xs">Access days</Label>
                <Input className="mt-1 h-8" type="number" min="1" value={manualDays} onChange={e => setManualDays(e.target.value)} />
              </div>
            </div>
            <div>
              <Label className="text-xs">Note</Label>
              <Input className="mt-1 h-8" value={manualNote} onChange={e => setManualNote(e.target.value)} placeholder="e.g. Cash payment received" />
            </div>
            <Button size="sm" className="w-full" onClick={() => recordPayment.mutate()} disabled={recordPayment.isPending}>
              {recordPayment.isPending ? "Recording…" : "Record Payment & Grant Access"}
            </Button>
          </div>
        )}
      </div>

      {/* ── Payment ledger ── */}
      <div className="pt-3 border-t border-border">
        <Button size="sm" variant="ghost" className="w-full justify-start text-xs" onClick={() => setShowLedger(!showLedger)}>
          {showLedger ? <ChevronUp className="mr-2 h-3.5 w-3.5" /> : <ChevronDown className="mr-2 h-3.5 w-3.5" />}
          {showLedger ? "Hide" : "Show"} Payment Ledger
        </Button>
        {showLedger && (
          <div className="mt-2 space-y-1">
            {!ledgerData?.ledger?.length && <div className="text-xs text-muted-foreground p-2">No payment records yet.</div>}
            {(ledgerData?.ledger ?? []).map((entry: any) => (
              <div key={entry.id} className="rounded-md border border-border bg-muted/20 p-2 text-xs space-y-0.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium">{entry.service_product ?? "Membership"}</span>
                  <Badge variant="outline" className="text-[10px]">{entry.status}</Badge>
                </div>
                <div className="text-muted-foreground">
                  {new Date(entry.payment_date).toLocaleDateString()}
                  {entry.amount_cents != null && ` · $${(entry.amount_cents / 100).toFixed(2)}`}
                  {entry.payment_method && ` · ${entry.payment_method}`}
                </div>
                {entry.manual_note && <div className="text-muted-foreground italic">{entry.manual_note}</div>}
                {entry.access_end_date && <div className="text-muted-foreground">Access until: {new Date(entry.access_end_date).toLocaleDateString()}</div>}
              </div>
            ))}
          </div>
        )}
      </div>
    </Card>
  );
}