import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { getMyJfBilling, openBillingPortal, reactivateFullMembership, syncMyStripeStatus, keepMembership, restartMembership } from "@/lib/jf-billing.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { CancelFlow } from "@/components/billing/cancel-flow";
import { toast } from "sonner";
import { CreditCard, RefreshCw, ExternalLink, AlertTriangle, ShieldAlert } from "lucide-react";

export const Route = createFileRoute("/_authenticated/m/billing")({ component: BillingPage });

const STATUS_TONE: Record<string, string> = {
  "Trialing": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "Active": "bg-emerald-500/10 text-emerald-300 border-emerald-500/30",
  "Active (Cancels at period end)": "bg-amber-500/10 text-amber-300 border-amber-500/30",
  "Past Due": "bg-rose-500/10 text-rose-300 border-rose-500/30",
  "Past Due (Access Restricted)": "bg-rose-600/15 text-rose-300 border-rose-500/40",
  "Payment Failed": "bg-rose-500/10 text-rose-300 border-rose-500/30",
  "Paused": "bg-sky-500/10 text-sky-300 border-sky-500/30",
  "Hold Plan": "bg-violet-500/10 text-violet-300 border-violet-500/30",
  "Cancelled": "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
  "Expired": "bg-zinc-500/10 text-zinc-300 border-zinc-500/30",
};

function fmt(d: string | null | undefined) { return d ? new Date(d).toLocaleDateString() : "—"; }

function BillingPage() {
  const qc = useQueryClient();
  const fn = useServerFn(getMyJfBilling);
  const portalFn = useServerFn(openBillingPortal);
  const reactivateFn = useServerFn(reactivateFullMembership);
  const keepFn = useServerFn(keepMembership);
  const restartFn = useServerFn(restartMembership);
  const syncFn = useServerFn(syncMyStripeStatus);

  const { data, isLoading } = useQuery({ queryKey: ["my-jf-billing"], queryFn: () => fn() });
  const [cancelOpen, setCancelOpen] = useState(false);

  const portal = useMutation({
    mutationFn: () => portalFn({ data: { return_url: window.location.href } }),
    onSuccess: (r) => window.location.assign(r.url),
    onError: (e: any) => toast.error(e.message),
  });
  const sync = useMutation({
    mutationFn: () => syncFn(),
    onSuccess: () => { toast.success("Synced"); qc.invalidateQueries({ queryKey: ["my-jf-billing"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const reactivate = useMutation({
    mutationFn: () => reactivateFn(),
    onSuccess: () => { toast.success("Membership reactivated"); qc.invalidateQueries({ queryKey: ["my-jf-billing"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const keep = useMutation({
    mutationFn: () => keepFn(),
    onSuccess: () => { toast.success("Membership kept"); qc.invalidateQueries({ queryKey: ["my-jf-billing"] }); },
    onError: (e: any) => toast.error(e.message),
  });
  const restart = useMutation({
    mutationFn: () => restartFn({ data: { origin: window.location.origin } }),
    onSuccess: (r: any) => { if (r?.url) window.location.assign(r.url); },
    onError: (e: any) => toast.error(e.message),
  });

  if (isLoading) return <div className="p-6 text-muted-foreground">Loading…</div>;
  const m = data?.member;
  const s = data?.settings;
  const lc = (data as any)?.lifecycle;

  if (!m) return <div className="p-6"><PageHeader title="Billing" /><Card className="p-6 mt-4">No membership on file.</Card></div>;

  const status = lc?.status ?? m.subscription_status ?? "—";
  const isHold = s?.is_hold;
  const isPaused = status === "Paused";
  const isCancelled = status === "Cancelled" || status === "Expired" || lc?.subscription_ended;
  const action = lc?.action ?? (isCancelled ? "restart_membership" : "none");
  const showKeep = action === "keep_membership";
  const showRestart = action === "restart_membership";
  const inGrace = lc?.in_grace;
  const accessRestricted = status === "Past Due (Access Restricted)";
  const graceEndsAt = lc?.grace_ends_at;
  const showSyncWarning = !!m.sync_warning_at && !m.cross_account_locked;
  const showCrossAccountLock = !!m.cross_account_locked;

  return (
    <div className="space-y-5 p-4 md:p-6">
      <PageHeader title="Billing" subtitle="Manage your JF Membership subscription." />

      <Card className="p-5 space-y-3">
        {showCrossAccountLock && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200 flex gap-2">
            <ShieldAlert className="h-4 w-4 mt-0.5 shrink-0" />
            <div>
              <div className="font-medium">Manual review required</div>
              <div className="text-xs opacity-80">Your billing record is being reviewed. Please contact support before making changes.</div>
            </div>
          </div>
        )}
        {showSyncWarning && (
          <div className="rounded border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-200">
            We had trouble syncing the latest billing status. Your access is preserved. {m.sync_warning_reason ? `(${m.sync_warning_reason})` : null}
          </div>
        )}
        {inGrace && (
          <div className="rounded border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200 flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <div className="flex-1">
              <div className="font-medium">Payment failed — please update your payment method</div>
              <div className="text-xs opacity-90">
                Your access remains active until <span className="font-semibold">{fmt(graceEndsAt)}</span>.
                After that date your membership features will be paused until payment is recovered.
              </div>
              <Button size="sm" className="mt-2" onClick={() => portal.mutate()} disabled={portal.isPending}>
                <CreditCard className="mr-1 h-3.5 w-3.5" /> Update Payment Method
              </Button>
            </div>
          </div>
        )}
        {accessRestricted && (
          <div className="rounded border border-rose-600/40 bg-rose-600/15 p-3 text-sm text-rose-200">
            <div className="font-medium">Access restricted</div>
            <div className="text-xs opacity-90">Your grace period ended. Your account, history, and progress are preserved — update your payment method to restore full access.</div>
            <Button size="sm" className="mt-2" onClick={() => portal.mutate()} disabled={portal.isPending}>
              <CreditCard className="mr-1 h-3.5 w-3.5" /> Update Payment Method
            </Button>
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Current status</div>
            <Badge variant="outline" className={STATUS_TONE[status] ?? ""}>{status}</Badge>
          </div>
          <div className="flex gap-2">
            <Button variant="outline" size="sm" onClick={() => sync.mutate()} disabled={sync.isPending}>
              <RefreshCw className={`mr-1 h-3.5 w-3.5 ${sync.isPending ? "animate-spin" : ""}`} /> Sync
            </Button>
            <Button variant="outline" size="sm" onClick={() => portal.mutate()} disabled={portal.isPending}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" /> Stripe Portal
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2 pt-2">
          <Info label="Plan" value={isHold ? "Hold Plan" : "JF Membership"} />
          <Info
            label="Price"
            value={isHold ? (s?.hold_price_display ?? "$9/month USD") : (s?.monthly_price_display ?? "$29/month USD")}
            hint="Taxes calculated at checkout where applicable."
          />
          {status === "Trialing" && <Info label="Trial ends" value={fmt(m.trial_end_at)} />}
          <Info label="Next billing date" value={fmt(m.current_period_end)} />
          {m.cancel_at && <Info label="Cancels on" value={fmt(m.cancel_at)} />}
          {m.paused_until && <Info label="Resumes on" value={fmt(m.paused_until)} />}
        </div>

        <div className="flex flex-wrap gap-2 pt-3 border-t border-border">
          {!isCancelled && !isPaused && !isHold && !showKeep && (
            <Button variant="destructive" size="sm" onClick={() => setCancelOpen(true)}>Cancel Membership</Button>
          )}
          {showKeep && (
            <Button size="sm" onClick={() => keep.mutate()} disabled={keep.isPending}>
              <CreditCard className="mr-1 h-3.5 w-3.5" /> Keep Membership
            </Button>
          )}
          {showRestart && !showCrossAccountLock && (
            <Button size="sm" onClick={() => restart.mutate()} disabled={restart.isPending}>
              <CreditCard className="mr-1 h-3.5 w-3.5" /> Restart Membership
            </Button>
          )}
          {(isHold || isPaused) && (
            <Button size="sm" onClick={() => reactivate.mutate()} disabled={reactivate.isPending}>
              <CreditCard className="mr-1 h-3.5 w-3.5" /> Reactivate Full Membership
            </Button>
          )}
        </div>
      </Card>

      {s?.refund_policy && (
        <Card className="p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-2">Refund / cancellation policy</div>
          <p className="text-xs whitespace-pre-line text-muted-foreground">{s.refund_policy}</p>
        </Card>
      )}

      <CancelFlow open={cancelOpen} onOpenChange={setCancelOpen} holdPriceDisplay={s?.hold_price_display ?? "$9/month USD"} onDone={() => qc.invalidateQueries({ queryKey: ["my-jf-billing"] })} />
    </div>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-sm">{value}</div>
      {hint && <div className="text-[11px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}