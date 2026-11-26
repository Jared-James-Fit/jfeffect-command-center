/**
 * A client's plan, on the coach's side (client → Billing): what they're on,
 * anything scheduled, their plan history, and packages that can't be sold
 * yet. The admin can change it for them (the same preview and rules as the
 * client, plus "switch now, no charge" for a goodwill upgrade), undo a
 * scheduled change, and end coaching after a subscription ended in Stripe.
 * For a member, the admin approves (or declines) coaching; for someone on their
 * own price, the admin offers a switch the client accepts in the app.
 * A coach reads it; money stays the admin's.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronDown, Layers, Loader2, TriangleAlert } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { billingDay } from "@/lib/date-range";
import { PlanManager, type PlanApi } from "@/components/plans/plan-manager";
import {
  adminApproveCoaching,
  adminCreateOffer,
  adminDeclineCoaching,
  adminRevokeApproval,
  adminWithdrawOffer,
  adminChangeClientPlan,
  adminEndCoaching,
  adminGetClientPlan,
  adminPreviewClientPlanChange,
  adminUndoClientPlanChange,
} from "@/lib/plans/plans.functions";
import { cn } from "@/lib/utils";

export function ClientPlanCard({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const getFn = useServerFn(adminGetClientPlan);
  const previewFn = useServerFn(adminPreviewClientPlanChange);
  const changeFn = useServerFn(adminChangeClientPlan);
  const undoFn = useServerFn(adminUndoClientPlanChange);
  const endFn = useServerFn(adminEndCoaching);
  const withdrawFn = useServerFn(adminWithdrawOffer);
  const [open, setOpen] = useState(false);
  const [ending, setEnding] = useState(false);
  const key = ["client-plan", clientId] as const;
  const q = useQuery({ queryKey: key, queryFn: () => getFn({ data: { clientId } }), staleTime: 30_000 });

  const api: PlanApi = useMemo(
    () => ({
      preview: (toSlug) => previewFn({ data: { clientId, toSlug } }),
      confirm: (toSlug, extra) =>
        changeFn({ data: { clientId, toSlug, noCharge: !!extra.noCharge, prorationDate: extra.prorationDate ?? null, note: extra.note ?? null, origin: window.location.origin } }),
      undo: (changeId) => undoFn({ data: { clientId, changeId } }),
      keep: async () => {
        throw new Error("Only the client keeps a plan that's ending, or undo the scheduled change.");
      },
      withdrawOffer: (changeId) => withdrawFn({ data: { clientId, changeId } }),
    }),
    [clientId, previewFn, changeFn, undoFn, withdrawFn],
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: key });
    void qc.invalidateQueries({ queryKey: ["client-billing", clientId] });
    void qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
  };

  const v = q.data;
  const summary = v
    ? v.open
      ? v.open.status === "scheduled"
        ? `${v.current.name} → ${v.open.toLabel ?? "Free"}`
        : `${v.current.name} · change in progress`
      : v.current.name
    : null;

  const endCoaching = async () => {
    if (ending) return;
    setEnding(true);
    try {
      await endFn({ data: { clientId } });
      toast.success("Moved to the free app", { description: "Everything they logged stays. Coaching screens and check-ins stop." });
      refresh();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't end coaching");
    } finally {
      setEnding(false);
    }
  };

  return (
    <Card className="p-0" data-client-plan-card>
      <button type="button" className="flex min-h-14 w-full items-center gap-3 px-4 text-left" onClick={() => setOpen((x) => !x)} aria-expanded={open}>
        <Layers className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="block text-[15px] font-semibold">Plan</span>
          <span className="block truncate text-[13px] text-muted-foreground">
            {q.isLoading ? "Loading…" : q.isError ? "Couldn't load" : summary}
          </span>
        </span>
        {v?.configIssues.length ? <TriangleAlert className="h-4 w-4 shrink-0 text-warning" aria-label="A package needs setting up" /> : null}
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-4 border-t border-border p-3 md:p-4">
          {q.isError && (
            <div className="space-y-2 text-center">
              <p className="text-[14px] text-muted-foreground">Their plan couldn't be loaded.</p>
              <Button size="sm" variant="outline" className="h-10" onClick={() => q.refetch()}>Try again</Button>
            </div>
          )}
          {v && v.configIssues.length > 0 && (
            <div className="space-y-1 rounded-xl border border-warning/40 p-3" data-plan-config-issues>
              <p className="text-[14px] font-medium">Not for sale until it's set up</p>
              {v.configIssues.map((c) => (
                <p key={c.slug} className="text-[13px] text-muted-foreground">
                  {c.name}: {c.problem}. Fix it in Sales → Coaching packages.
                </p>
              ))}
            </div>
          )}
          {v?.endedInStripe && (
            <div className="space-y-2 rounded-xl border border-warning/40 p-3" data-plan-ended-in-stripe>
              <p className="text-[14px]">Their subscription ended in Stripe. They still have coaching access until you decide.</p>
              {v.canChange && (
                <Button size="sm" variant="outline" className="h-10" disabled={ending} onClick={endCoaching}>
                  {ending ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}End coaching (move to the free app)
                </Button>
              )}
            </div>
          )}
          {v && v.canChange && <AdminPlanActions clientId={clientId} view={v} onChanged={refresh} />}
          {v && <PlanManager view={v} api={api} who="admin" onChanged={refresh} />}
          {v && !v.canChange && <p className="text-center text-[13px] text-muted-foreground">Only the admin changes a client's plan.</p>}
        </div>
      )}
    </Card>
  );
}

/* ───────────────────────── approve coaching / offer a switch ───────────────────────── */

type View = NonNullable<Awaited<ReturnType<typeof adminGetClientPlan>>>;

function AdminPlanActions({ clientId, view, onChanged }: { clientId: string; view: View; onChanged: () => void }) {
  const approveFn = useServerFn(adminApproveCoaching);
  const declineFn = useServerFn(adminDeclineCoaching);
  const revokeFn = useServerFn(adminRevokeApproval);
  const offerFn = useServerFn(adminCreateOffer);
  const [busy, setBusy] = useState(false);
  const [mode, setMode] = useState<null | "approve" | "decline" | "offer">(null);
  const [pkg, setPkg] = useState<string>("any");
  const [timing, setTiming] = useState<"period_end" | "now">("period_end");
  const [note, setNote] = useState("");
  const coachingOptions = view.options.filter((o) => o.family === "coaching");
  const paidOptions = view.options.filter((o) => o.family !== "free" && !(o.transition.kind === "current" && o.transition.blocked === "Your current plan" && !view.current.specialPrice));
  const a = view.access;
  const member = view.tier === "self_serve";
  const paying = view.current.managed !== "free" && view.current.family !== "free";

  const go = async (fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      toast.success(done);
      setMode(null);
      setNote("");
      onChanged();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't do that");
    } finally {
      setBusy(false);
    }
  };
  const requestId = a.state === "comeback_pending" ? a.changeId : null;
  const applicationId = a.state === "applied" ? a.applicationId ?? null : null;

  return (
    <div className="space-y-3 rounded-xl border border-border p-3" data-plan-admin-actions>
      {member && (
        <>
          {view.approval ? (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-[14px]">
                Approved for {view.approval.packageName ?? "any coaching package"} until {billingDay(view.approval.expiresAt.slice(0, 10)) ?? "soon"}.
              </p>
              <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={() => go(() => revokeFn({ data: { clientId, approvalId: view.approval!.id } }), "Approval taken back")}>
                Take back
              </Button>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button size="sm" className="h-10" onClick={() => setMode(mode === "approve" ? null : "approve")} data-plan-approve>
                Approve for coaching
              </Button>
              {(requestId || applicationId) && (
                <Button size="sm" variant="outline" className="h-10" onClick={() => setMode(mode === "decline" ? null : "decline")}>
                  Decline
                </Button>
              )}
            </div>
          )}
          {mode === "approve" && (
            <div className="space-y-2">
              <Select value={pkg} onValueChange={setPkg}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Which package" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">Any coaching package</SelectItem>
                  {coachingOptions.map((o) => (
                    <SelectItem key={o.slug} value={o.slug}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="A note for your records (optional)" className="min-h-[72px] text-[16px]" />
              <p className="text-[13px] text-muted-foreground">They can pick it and pay in the app for 30 days. Nothing is charged until they do.</p>
              <Button
                size="sm"
                className="h-10"
                disabled={busy}
                onClick={() =>
                  go(
                    () =>
                      approveFn({
                        data: {
                          clientId,
                          packageSlug: pkg === "any" ? null : pkg,
                          note: note.trim() || null,
                          requestChangeId: requestId,
                          applicationId,
                        },
                      }),
                    "Approved. They've been told.",
                  )
                }
              >
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Approve
              </Button>
            </div>
          )}
          {mode === "decline" && (
            <div className="space-y-2">
              <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="A reply they'll see (optional; with no reply they aren't told)" className="min-h-[72px] text-[16px]" />
              <Button size="sm" variant="outline" className="h-10" disabled={busy} onClick={() => go(() => declineFn({ data: { clientId, note: note.trim() || null, requestChangeId: requestId, applicationId } }), "Declined")}>
                Decline
              </Button>
            </div>
          )}
        </>
      )}
      {!member && paying && !view.offer && !view.open && (
        <>
          <Button size="sm" variant="outline" className="h-10" onClick={() => setMode(mode === "offer" ? null : "offer")} data-plan-offer-open>
            Offer a switch
          </Button>
          {mode === "offer" && (
            <div className="space-y-2">
              <Select value={pkg === "any" ? "" : pkg} onValueChange={setPkg}>
                <SelectTrigger className="h-11">
                  <SelectValue placeholder="Package to offer" />
                </SelectTrigger>
                <SelectContent>
                  {paidOptions.map((o) => (
                    <SelectItem key={o.slug} value={o.slug}>
                      {o.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={timing} onValueChange={(v) => setTiming(v as "now" | "period_end")}>
                <SelectTrigger className="h-11">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="period_end">At their next billing date</SelectItem>
                  <SelectItem value="now">Today, new price from their next billing date</SelectItem>
                </SelectContent>
              </Select>
              <Textarea value={note} onChange={(e) => setNote(e.target.value.slice(0, 1000))} placeholder="A note they'll see with the offer (optional)" className="min-h-[72px] text-[16px]" />
              <p className="text-[13px] text-muted-foreground">
                Nothing changes unless they accept it in the app. Nothing is charged or credited on the day they accept.
                {view.current.specialPrice || view.current.managed === "custom" ? " They're told their current price ends if they accept." : ""} It closes after 14 days.
              </p>
              <Button
                size="sm"
                className="h-10"
                disabled={busy || pkg === "any"}
                onClick={() => go(() => offerFn({ data: { clientId, toSlug: pkg, timing, note: note.trim() || null } }), "Offer sent. They've been told.")}
              >
                {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Send offer
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
