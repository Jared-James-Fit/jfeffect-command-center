import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  adminCancelMember,
  adminCancelMemberImmediately,
  adminUndoScheduledCancel,
  adminGetMemberSubscription,
  adminSyncMemberStripe,
} from "@/lib/jf-billing.functions";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { CalendarClock, RefreshCw, RotateCcw, XCircle, Zap } from "lucide-react";
import { toast } from "sonner";
import { stripeRecurringPhrase } from "@/lib/billing-frequency";

type Mode = "period_end" | "immediate" | "undo";

function fmtDate(iso: string | null | undefined) {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "—";
  }
}

function fmtMoney(cents: number | null | undefined, currency: string | null | undefined) {
  if (cents == null) return "—";
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency ?? "usd").toUpperCase(),
    }).format(cents / 100);
  } catch {
    return `$${(cents / 100).toFixed(2)}`;
  }
}

function fmtInterval(interval: string | null, count: number) {
  // Canonical: week x 2 renders as "every 2 weeks", never "weekly".
  return stripeRecurringPhrase({ interval, interval_count: count });
}

/**
 * Manage-Subscription panel: shows live Stripe details for a JF member
 * and exposes cancel-at-period-end / cancel-immediately / undo controls.
 * Both the client profile card and the subscription management list use
 * this same component so state stays consistent.
 */
export function ManageSubscriptionPanel({
  member,
  onChanged,
}: {
  member: { id: string; full_name?: string | null; email?: string | null };
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode | null>(null);

  const getSub = useServerFn(adminGetMemberSubscription);
  const cancelEndFn = useServerFn(adminCancelMember);
  const cancelNowFn = useServerFn(adminCancelMemberImmediately);
  const undoFn = useServerFn(adminUndoScheduledCancel);
  const syncFn = useServerFn(adminSyncMemberStripe);

  const queryKey = ["admin-subscription", member.id];
  const { data, isLoading, isFetching, refetch, error } = useQuery({
    queryKey,
    queryFn: () => getSub({ data: { member_id: member.id } }),
    staleTime: 15_000,
  });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey });
    qc.invalidateQueries({ queryKey: ["admin-member", member.id] });
    qc.invalidateQueries({ queryKey: ["jf-billing-members"] });
    onChanged?.();
  };

  const runAndSync = async (fn: () => Promise<any>) => {
    await fn();
    // Best-effort resync so local status/period_end reflect Stripe truth.
    try { await syncFn({ data: { member_id: member.id } }); } catch { /* ignore */ }
    invalidateAll();
  };

  const cancelEnd = useMutation({
    mutationFn: () => runAndSync(() => cancelEndFn({ data: { member_id: member.id } })),
    onSuccess: () => { toast.success("Subscription will cancel at period end."); setMode(null); },
    onError: (e: any) => toast.error(e?.message ?? "Stripe rejected the request."),
  });
  const cancelNow = useMutation({
    mutationFn: () => runAndSync(() => cancelNowFn({ data: { member_id: member.id } })),
    onSuccess: () => { toast.success("Subscription cancelled immediately."); setMode(null); },
    onError: (e: any) => toast.error(e?.message ?? "Stripe rejected the request."),
  });
  const undoCancel = useMutation({
    mutationFn: () => runAndSync(() => undoFn({ data: { member_id: member.id } })),
    onSuccess: () => { toast.success("Scheduled cancellation removed."); setMode(null); },
    onError: (e: any) => toast.error(e?.message ?? "Stripe rejected the request."),
  });

  const anyPending = cancelEnd.isPending || cancelNow.isPending || undoCancel.isPending;

  if (isLoading) {
    return (
      <Card className="border-border p-4 text-sm text-muted-foreground">Loading subscription…</Card>
    );
  }
  if (error) {
    return (
      <Card className="border-border p-4 text-sm">
        <div className="text-rose-300">Couldn't load subscription: {(error as any)?.message}</div>
        <Button size="sm" variant="outline" className="mt-2" onClick={() => refetch()}>Retry</Button>
      </Card>
    );
  }
  if (!data || !data.has_subscription) {
    return (
      <Card className="border-border p-4 text-sm text-muted-foreground">
        No Stripe subscription on file for this member.
      </Card>
    );
  }
  const sub = data as Extract<typeof data, { has_subscription: true }>;
  const displayStatus = sub.display_status ?? sub.status;
  const isScheduled = sub.cancel_at_period_end && sub.status !== "canceled";
  const isCanceled = sub.status === "canceled";
  const planLabel = sub.plan.nickname
    ? sub.plan.nickname
    : sub.plan.amount_cents != null
    ? `${fmtMoney(sub.plan.amount_cents, sub.plan.currency)} ${fmtInterval(sub.plan.interval, sub.plan.interval_count)}`
    : "Plan";

  const finalAccessDate = isScheduled
    ? (sub.cancel_at ?? sub.current_period_end)
    : null;

  return (
    <Card className="border-border p-4 space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Manage Subscription</div>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{displayStatus}</Badge>
            {isScheduled && (
              <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-300">
                <CalendarClock className="mr-1 h-3 w-3" /> Cancels {fmtDate(finalAccessDate)}
              </Badge>
            )}
            {isCanceled && (
              <Badge variant="outline" className="border-zinc-500/30 bg-zinc-500/10 text-zinc-300">Cancelled</Badge>
            )}
          </div>
        </div>
        <Button size="sm" variant="ghost" onClick={() => refetch()} disabled={isFetching}>
          <RefreshCw className={`mr-1 h-3.5 w-3.5 ${isFetching ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      <div className="grid gap-2 sm:grid-cols-2 text-sm">
        <div><span className="text-muted-foreground text-xs">Plan:</span> {planLabel}</div>
        <div><span className="text-muted-foreground text-xs">Amount:</span> {fmtMoney(sub.plan.amount_cents, sub.plan.currency)}</div>
        <div><span className="text-muted-foreground text-xs">Billing:</span> {fmtInterval(sub.plan.interval, sub.plan.interval_count)}</div>
        <div><span className="text-muted-foreground text-xs">Next payment:</span> {isScheduled || isCanceled ? "—" : fmtDate(sub.current_period_end)}</div>
        <div><span className="text-muted-foreground text-xs">Scheduled cancel:</span> {isScheduled ? fmtDate(finalAccessDate) : "—"}</div>
        <div><span className="text-muted-foreground text-xs">Cancelled at:</span> {fmtDate(sub.canceled_at)}</div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMode("period_end")}
          disabled={anyPending || isCanceled || isScheduled}
        >
          <CalendarClock className="mr-1 h-3.5 w-3.5" /> Cancel at period end
        </Button>
        <Button
          size="sm"
          variant="destructive"
          onClick={() => setMode("immediate")}
          disabled={anyPending || isCanceled}
        >
          <Zap className="mr-1 h-3.5 w-3.5" /> Cancel immediately
        </Button>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setMode("undo")}
          disabled={anyPending || !isScheduled}
        >
          <RotateCcw className="mr-1 h-3.5 w-3.5" /> Undo scheduled cancel
        </Button>
      </div>

      <AlertDialog open={mode !== null} onOpenChange={(o) => { if (!o) setMode(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {mode === "immediate" && "Cancel subscription immediately?"}
              {mode === "period_end" && "Cancel at end of billing period?"}
              {mode === "undo" && "Undo scheduled cancellation?"}
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <div className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-1">
                  <span className="text-muted-foreground">Client:</span>
                  <span>{member.full_name || member.email || "—"}</span>
                  <span className="text-muted-foreground">Plan:</span>
                  <span>{planLabel}</span>
                  <span className="text-muted-foreground">Next payment:</span>
                  <span>{fmtDate(sub.current_period_end)}</span>
                  <span className="text-muted-foreground">Cancellation type:</span>
                  <span>
                    {mode === "immediate" && "Immediate"}
                    {mode === "period_end" && "At end of current period"}
                    {mode === "undo" && "Undo — keep subscription active"}
                  </span>
                  <span className="text-muted-foreground">Final access date:</span>
                  <span>
                    {mode === "immediate" && "Today"}
                    {mode === "period_end" && fmtDate(sub.current_period_end)}
                    {mode === "undo" && "Ongoing"}
                  </span>
                </div>
                {mode !== "undo" && (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2 text-amber-200">
                    No refund is automatically issued. Past invoices and payment history are preserved.
                  </div>
                )}
                {mode === "immediate" && (
                  <div className="rounded-md border border-rose-500/30 bg-rose-500/10 p-2 text-rose-200">
                    The client may lose access to member-only areas immediately.
                  </div>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anyPending}>Back</AlertDialogCancel>
            <AlertDialogAction
              disabled={anyPending}
              onClick={(e) => {
                e.preventDefault();
                if (mode === "immediate") cancelNow.mutate();
                else if (mode === "period_end") cancelEnd.mutate();
                else if (mode === "undo") undoCancel.mutate();
              }}
            >
              {anyPending ? "Processing…" : mode === "undo" ? "Keep subscription" : mode === "immediate" ? "Cancel now" : "Schedule cancellation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
