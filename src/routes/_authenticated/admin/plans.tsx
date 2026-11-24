import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState, type ReactNode } from "react";
import { ChevronRight, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { StatusChip } from "@/components/nutrition/nutrition-ui";
import { billingDay } from "@/lib/date-range";
import { money } from "@/lib/plans/plan-engine";
import { adminPlansOverview, type PlansOverview } from "@/lib/plans/plans-admin.functions";
import { adminApproveCoaching, adminDeclineCoaching, adminDecideRequest } from "@/lib/plans/plans.functions";

export const Route = createFileRoute("/_authenticated/admin/plans")({ component: PlansPage });

const day = (iso: string | null | undefined) => (iso ? billingDay(iso.slice(0, 10)) : null);

const KIND_WORD: Record<string, string> = {
  start: "Started",
  upgrade: "Upgrade",
  downgrade: "Switch down",
  cancel: "Cancel",
  end: "Ended",
  reactivate: "Back to coaching",
  request: "Request",
};
const STATUS_WORD: Record<string, string> = {
  checkout: "At checkout",
  processing: "Going through",
  awaiting_payment: "Waiting for payment",
  scheduled: "Scheduled",
  applied: "Done",
  cancelled: "Undone",
  failed: "Failed",
};

function Section({ title, count, children, empty }: { title: string; count?: number; children: ReactNode; empty?: string }) {
  return (
    <section className="space-y-2">
      <h2 className="flex items-baseline gap-2 px-1 text-base font-semibold">
        {title}
        {count != null ? <span className="text-[13px] font-normal text-muted-foreground">{count}</span> : null}
      </h2>
      {count === 0 && empty ? <Card className="p-4 text-[14px] text-muted-foreground">{empty}</Card> : <Card className="divide-y divide-border p-0">{children}</Card>}
    </section>
  );
}

function PersonRow({ clientId, name, sub, right, children }: { clientId: string; name: string; sub: ReactNode; right?: ReactNode; children?: ReactNode }) {
  return (
    <div className="px-4 py-3">
      <div className="flex items-start justify-between gap-3">
        <Link to="/admin/clients/$id" params={{ id: clientId }} search={{ tab: "billing" } as any} className="min-w-0 flex-1">
          <div className="flex items-center gap-1 text-[15px] font-medium">
            {name}
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden />
          </div>
          <div className="text-[13px] leading-snug text-muted-foreground">{sub}</div>
        </Link>
        {right}
      </div>
      {children}
    </div>
  );
}

function Decision({ d, onDone }: { d: PlansOverview["decisions"][number]; onDone: () => void }) {
  const approveFn = useServerFn(adminApproveCoaching);
  const declineFn = useServerFn(adminDeclineCoaching);
  const decideFn = useServerFn(adminDecideRequest);
  const [busy, setBusy] = useState<string | null>(null);
  const go = async (which: string, fn: () => Promise<unknown>, done: string) => {
    if (busy) return;
    setBusy(which);
    try {
      await fn();
      toast.success(done);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't do that");
    } finally {
      setBusy(null);
    }
  };
  const forCoaching = d.kind !== "request";
  return (
    <PersonRow
      clientId={d.person.clientId}
      name={d.person.name}
      sub={
        <>
          {d.detail}
          {d.packageName && d.kind === "application" ? ` · for ${d.packageName}` : ""} · {day(d.at)}
        </>
      }
    >
      <div className="mt-2 flex flex-wrap gap-2">
        {forCoaching ? (
          <>
            <Button
              size="sm"
              className="h-10"
              disabled={!!busy}
              onClick={() =>
                go("yes", () => approveFn({ data: { clientId: d.person.clientId, requestChangeId: d.changeId, applicationId: d.applicationId } }), "Approved. They've been told.")
              }
            >
              {busy === "yes" ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}Approve
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-10"
              disabled={!!busy}
              onClick={() => go("no", () => declineFn({ data: { clientId: d.person.clientId, requestChangeId: d.changeId, applicationId: d.applicationId } }), "Declined")}
            >
              Decline
            </Button>
          </>
        ) : (
          <>
            <Button size="sm" variant="outline" className="h-10" disabled={!!busy} onClick={() => go("done", () => decideFn({ data: { changeId: d.changeId!, done: true } }), "Marked as dealt with")}>
              Dealt with
            </Button>
            <Button size="sm" variant="ghost" className="h-10" disabled={!!busy} onClick={() => go("no", () => decideFn({ data: { changeId: d.changeId!, done: false } }), "Declined")}>
              Decline
            </Button>
          </>
        )}
      </div>
    </PersonRow>
  );
}

/**
 * Sales → Plans: every plan and its price, what's waiting on you (members
 * applying for coaching, former clients asking to come back, requests to
 * change a custom plan), grandfathered and custom prices, changes in flight,
 * failed payments and plans about to end. Changes are made on each client's
 * plan card (their Billing tab); this page is where you see all of it.
 */
function PlansPage() {
  const fn = useServerFn(adminPlansOverview);
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["admin-plans-overview"], queryFn: () => fn(), staleTime: 30_000 });
  const refresh = () => void qc.invalidateQueries({ queryKey: ["admin-plans-overview"] });
  const v = q.data;
  return (
    <>
      <PageHeader title="Plans" backTo="/admin/sales" backLabel="Sales" />
      <div className="mx-auto w-full max-w-3xl space-y-6 p-4 md:p-6" style={{ paddingBottom: "max(env(safe-area-inset-bottom), 6rem)" }}>
        {q.isLoading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-28 animate-pulse rounded-2xl bg-muted" />
            <div className="h-40 animate-pulse rounded-2xl bg-muted" />
          </div>
        ) : q.isError || !v ? (
          <Card className="space-y-2 p-5 text-center">
            <p className="text-[14px] text-muted-foreground">Plans couldn't be loaded.</p>
            <Button size="sm" variant="outline" className="h-10" onClick={() => q.refetch()}>
              Try again
            </Button>
          </Card>
        ) : (
          <>
            <Section title="Needs your decision" count={v.decisions.length} empty="Nothing waiting on you.">
              {v.decisions.map((d) => (
                <Decision key={`${d.kind}-${d.id}`} d={d} onDone={refresh} />
              ))}
            </Section>

            <Section title="Plans and prices" count={v.catalog.length}>
              {v.catalog.map((c) => (
                <div key={c.slug} className="flex items-start justify-between gap-3 px-4 py-3" data-plans-catalog={c.slug}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 text-[15px] font-medium">
                      {c.name}
                      {!c.listed && c.family !== "free" ? <StatusChip>Not on the site</StatusChip> : null}
                      {c.problem ? <StatusChip tone="attention">Can't be sold</StatusChip> : null}
                    </div>
                    <div className="text-[13px] text-muted-foreground">
                      {c.onIt} on it{c.onSpecialPrice ? ` · ${c.onSpecialPrice} on their own price` : ""}
                      {c.problem ? ` · ${c.problem}` : ""}
                    </div>
                  </div>
                  <div className="shrink-0 text-right text-[15px] font-semibold">{c.family === "free" ? "Free" : `${money(c.priceCents)}/mo`}</div>
                </div>
              ))}
            </Section>

            <Section title="Grandfathered and custom prices" count={v.grandfathered.length} empty="Everyone pays the advertised price.">
              {v.grandfathered.map((g, i) => (
                <PersonRow
                  key={`${g.person.clientId}-${i}`}
                  clientId={g.person.clientId}
                  name={g.person.name}
                  sub={
                    <>
                      {g.planName} · {g.priceCents != null ? `${money(g.priceCents)}/mo` : "their own price"}
                      {g.advertisedCents != null ? ` (advertised ${money(g.advertisedCents)})` : ""}
                      {g.nextBillingDate ? ` · next payment ${day(g.nextBillingDate)}` : ""}
                    </>
                  }
                  right={<StatusChip>{g.how === "special_price" ? "Special price" : "Custom"}</StatusChip>}
                />
              ))}
            </Section>
            <p className="-mt-4 px-1 text-[13px] text-muted-foreground">
              Kept until they switch or cancel. To move someone, open their plan and offer a switch: nothing changes unless they accept it.
            </p>

            <Section title="Changes in progress and scheduled" count={v.inFlight.length} empty="No changes waiting.">
              {v.inFlight.map((r) => (
                <PersonRow
                  key={r.id}
                  clientId={r.person.clientId}
                  name={r.person.name}
                  sub={
                    <>
                      {KIND_WORD[r.kind] ?? r.kind}: {r.fromName ?? "Free"} → {r.toName ?? "Free"}
                      {r.effectiveAt && r.status === "scheduled" ? ` · ${day(r.effectiveAt)}` : ""}
                    </>
                  }
                  right={<StatusChip tone={r.status === "awaiting_payment" ? "attention" : undefined}>{STATUS_WORD[r.status] ?? r.status}</StatusChip>}
                />
              ))}
            </Section>

            <Section title="Failed payments" count={v.failedPayments.length} empty="No failed payments.">
              {v.failedPayments.map((f, i) => (
                <PersonRow
                  key={`${f.person.clientId}-${i}`}
                  clientId={f.person.clientId}
                  name={f.person.name}
                  sub={`${f.planName} · Stripe is retrying. They can update their card from Your plan.`}
                  right={<StatusChip tone="error">Past due</StatusChip>}
                />
              ))}
            </Section>

            <Section title="Ending" count={v.ending.length} empty="No plans set to end.">
              {v.ending.map((e, i) => (
                <PersonRow key={`${e.person.clientId}-${i}`} clientId={e.person.clientId} name={e.person.name} sub={`${e.planName} · ends ${day(e.endsOn) ?? "at the end of the paid month"}`} />
              ))}
            </Section>

            {(v.offers.length > 0 || v.approvals.length > 0) && (
              <Section title="Waiting on the client">
                {v.offers.map((o) => (
                  <PersonRow
                    key={o.id}
                    clientId={o.person.clientId}
                    name={o.person.name}
                    sub={`Offered ${o.toName ?? "a switch"}${o.toPriceCents != null ? ` at ${money(o.toPriceCents)}/mo` : ""} · open until ${day(o.expiresAt) ?? "soon"}`}
                    right={<StatusChip>Offer</StatusChip>}
                  />
                ))}
                {v.approvals.map((a) => (
                  <PersonRow
                    key={a.id}
                    clientId={a.person.clientId}
                    name={a.person.name}
                    sub={`Approved for ${a.packageName ?? "coaching"} · open until ${day(a.expiresAt) ?? "soon"}`}
                    right={<StatusChip>Approved</StatusChip>}
                  />
                ))}
              </Section>
            )}

            <Section title="Recent plan history" count={v.history.length} empty="No plan changes yet.">
              {v.history.map((h) => (
                <PersonRow
                  key={h.id}
                  clientId={h.person.clientId}
                  name={h.person.name}
                  sub={
                    <>
                      {KIND_WORD[h.kind] ?? h.kind}: {h.fromName ?? "Free"} → {h.toName ?? "Free"} · {day(h.at)}
                      {h.source === "stripe" ? " · in Stripe" : h.source === "admin" ? " · by you" : ""}
                    </>
                  }
                  right={<span className="text-[13px] text-muted-foreground">{STATUS_WORD[h.status] ?? h.status}</span>}
                />
              ))}
            </Section>

            <p className="px-1 text-[13px] text-muted-foreground" data-plans-portal>
              Stripe's billing page: {v.portal.live ? "locked to card, billing details and receipts" : "not set up yet (Stripe's default page is used)"}. Plans are only changed here and in each client's app.
            </p>
          </>
        )}
      </div>
    </>
  );
}
