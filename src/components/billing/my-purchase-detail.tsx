/**
 * A purchase's own page for the client (portal/purchases/$id): a package's
 * sessions and money, a plan's dates or charges, its payments with receipts,
 * the details and policies folded away, and, for a payment link that's out,
 * the terms and Pay. The route loads; this draws (fixtures can draw it too).
 */
import { Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { ChevronDown, ExternalLink, FileSignature, Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { SegmentBar } from "@/components/billing/package-visuals";
import { myBillingKey, usePortalClientId, type MyBillingView } from "@/components/billing/use-my-billing";
import {
  ActionList, Panel, PaymentsList, PlanCard, SectionTitle, SessionCounts, SessionLog, Status, UpcomingPayments, UpdateCardButton, period,
} from "@/components/billing/my-purchases-view";
import { packageSessionLog, purchaseDetail, type MyAction, type MySessionRow } from "@/lib/my-purchases";
import type { PackageLedgerEvent } from "@/lib/session-packages";
import type { MyBilling } from "@/lib/my-billing.functions";
import { billingDay } from "@/lib/date-range";
import { resolvePaymentShareLink } from "@/lib/payment-share.functions";
import { sanitizeShareUrl } from "@/lib/payment-share-link";
import { useCoachingAgreement } from "@/components/coaching-agreement/agreement-context";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { cn } from "@/lib/utils";

const HOW: Record<string, string> = {
  auto_pay: "Paid automatically by card on these dates.",
  stripe: "Charged to your card automatically.",
  manual: "Paid to your coach on these dates.",
  none: "No payment dates yet. Your coach will let you know when it's due.",
};

/** Null when the purchase isn't on this client's account (or is archived). */
export function usePurchaseDetail(view: MyBillingView | null, data: MyBilling | undefined, id: string) {
  const detail = useMemo(
    () => (view ? purchaseDetail({ payments: view.payments, sales: view.sales, ledger: view.ledger, saleId: id, money: view.money }) : null),
    [view, id],
  );
  const sale = useMemo(() => (view?.sales as any[] | undefined)?.find((s) => s.id === id) ?? null, [view, id]);
  const sessionLog = useMemo(
    () => (detail?.kind === "package" && data
      ? packageSessionLog(data.sessions as unknown as MySessionRow[], data.session_events as unknown as PackageLedgerEvent[], id)
      : []),
    [detail, data, id],
  );
  return { detail, sale, sessionLog };
}

export function PurchaseDetailBody({ id, clientId, view, detail, sale, sessionLog, today }: {
  id: string;
  clientId: string;
  view: MyBillingView;
  detail: NonNullable<ReturnType<typeof usePurchaseDetail>["detail"]>;
  sale: any;
  sessionLog: ReturnType<typeof usePurchaseDetail>["sessionLog"];
  today: string;
}) {
  const { money } = view;
  const m = detail.money;
  const actions: MyAction[] = view.mine.summary.actions.filter((a) => a.saleId === id && a.kind !== "pay");
  const waiting = detail.kind === "waiting";
  const x = detail.pkg;

  return (
    <>
      <div className="mx-auto w-full max-w-2xl space-y-5 px-4 py-4 md:px-6 md:py-6" data-my-detail={detail.kind}>
        <ActionList actions={actions} money={money} />
        {waiting && <PayPanel sale={sale} clientId={clientId!} cents={m?.leftCents ?? 0} money={money} />}

        {x && (
          <Panel className="space-y-3 px-4 py-4" data-my-detail-sessions>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="text-[13px] text-muted-foreground">Sessions</div>
                <div className="text-[22px] font-semibold leading-tight tabular-nums">{x.sessions.completed} of {x.sessions.purchased} completed</div>
              </div>
              <Status text={x.training.text} tone={x.now ? "neutral" : x.training.tone} className={x.now ? "font-medium text-foreground" : undefined} />
            </div>
            <SegmentBar
              parts={[{ value: x.sessions.completed, tone: "done" }, { value: x.sessions.booked, tone: "booked" }]}
              total={Math.max(x.sessions.purchased, 1)}
              label={`${x.sessions.completed} completed, ${x.sessions.booked} booked, ${x.sessions.available} left to book`}
            />
            <SessionCounts s={x.sessions} />
            <p className="text-[13px] text-muted-foreground">
              {[x.from || x.to ? `Runs ${period(x.from, x.to)}` : null, x.renewedFromLabel ? `renewed from ${x.renewedFromLabel}` : null, x.boughtOn ? `bought ${billingDay(x.boughtOn)}` : null].filter(Boolean).join(" · ")}
            </p>
          </Panel>
        )}

        {detail.plan && <PlanCard x={{ kind: "plan", saleId: id, plan: detail.plan }} money={money} today={today} link={false} />}

        {/* A link waiting to be paid says its amount above; its money panel would only repeat it. */}
        {m && !waiting && (
          <Panel className="divide-y divide-border" data-my-detail-money>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="text-[15px] font-semibold">Payment</span>
              {x ? <Status text={x.payment.text} tone={x.payment.tone} /> : <SaleStatus state={m.state} />}
            </div>
            {m.kind === "subscription" ? (
              <dl className="grid grid-cols-2 divide-x divide-border">
                <Cell label={`Each ${m.per ?? "period"}`} value={money(m.priceCents)} />
                <Cell label="Paid so far" value={money(m.paidCents)} />
              </dl>
            ) : (
              <dl className="grid grid-cols-3 divide-x divide-border">
                <Cell label="Total" value={money(x ? x.totalCents : m.state === "paid" ? m.paidCents : m.priceCents)} />
                <Cell label="Paid" value={money(m.paidCents)} />
                <Cell label="Left" value={money(x ? x.leftCents : m.leftCents)} strong={(x ? x.leftCents : m.leftCents) > 0} />
              </dl>
            )}
            {detail.schedule && (
              <div className="space-y-1 py-2">
                <p className="px-4 pt-1 text-[13px] text-muted-foreground">{HOW[detail.schedule.how]}</p>
                <UpcomingPayments list={detail.upcoming} money={money} />
              </div>
            )}
            {!detail.schedule && m.kind === "subscription" && m.next?.date && m.state === "renews" && (
              <p className="px-4 py-3 text-[13px] text-muted-foreground">Next charge {billingDay(m.next.date, { weekday: true })}, automatic.</p>
            )}
            {detail.coverage && (
              <div className="space-y-1 px-4 py-3 text-[13px] text-muted-foreground" data-my-coverage>
                {detail.coverage.map((l) => <p key={l}>{l}</p>)}
                <p className="text-[12px]">Shared evenly across the package: no payment is for one particular session.</p>
              </div>
            )}
            {m.priceNote && m.state === "paid" && <p className="px-4 py-2.5 text-[12px] text-muted-foreground">{m.priceNote}</p>}
            {m.kind === "subscription" && (m.state === "renews" || m.state === "past_due") && (
              <div className="px-4 py-3"><UpdateCardButton label="Manage card and invoices" variant="outline" /></div>
            )}
          </Panel>
        )}

        {x && (
          <section className="space-y-2.5">
            <SectionTitle>Sessions on this package</SectionTitle>
            <SessionLog entries={sessionLog} />
          </section>
        )}

        <section className="space-y-2.5">
          <SectionTitle>Payments and receipts</SectionTitle>
          <PaymentsList payments={detail.payments} money={money} showFor={false} />
        </section>

        <Details sale={sale} />
        <AgreementRow />
      </div>
    </>
  );
}

function Cell({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex min-w-0 flex-col-reverse justify-end px-4 py-3">
      <dt className="text-[12px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-[16px] font-semibold tabular-nums", !strong && label === "Left" && "text-muted-foreground")}>{value}</dd>
    </div>
  );
}

function SaleStatus({ state }: { state: string }) {
  switch (state) {
    case "paid": return <Status tone="done" text="Paid in full" />;
    case "free": return <Status tone="done" text="Included" />;
    case "renews": return <Status tone="done" text="Active" />;
    case "cancelling": return <Status tone="attention" text="Ending" />;
    case "past_due": return <Status tone="error" text="Payment failed" />;
    case "waiting": return <Status tone="attention" text="Ready to pay" />;
    case "left": return <Status tone="neutral" text="Payment plan" />;
    default: return <Status tone="neutral" text="Ended" />;
  }
}

/** A payment link that's out: accept the terms (once), then pay through Stripe's checkout. */
function PayPanel({ sale, clientId, cents, money }: { sale: any; clientId: string; cents: number; money: (c: number) => string }) {
  const qc = useQueryClient();
  const resolveShareFn = useServerFn(resolvePaymentShareLink);
  const { client: preview } = useClientImpersonation();
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const accepted = !!sale.terms_accepted;

  const accept = async () => {
    if (preview) return void toast.info("Preview only. Only the client can accept their terms.");
    setBusy(true);
    const { error } = await supabase.rpc("accept_my_purchase", { p_purchase_id: sale.id });
    setBusy(false);
    if (error) return void toast.error(error.message);
    toast.success("Terms accepted");
    void qc.invalidateQueries({ queryKey: myBillingKey(clientId) });
  };
  const pay = async () => {
    if (preview) return void toast.info("Preview only. Only the client can pay.");
    // Never the stored (possibly expired) checkout link: the current one, resolved on the server.
    const t = toast.loading("Opening secure payment…");
    try {
      const res: any = await resolveShareFn({ data: { purchaseRecordId: sale.id } });
      const url = sanitizeShareUrl(res?.url);
      if (!url) throw new Error("Your coach needs to send a fresh payment link.");
      toast.dismiss(t);
      window.location.assign(url);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't open the payment", { id: t });
    }
  };

  return (
    <Panel className="space-y-3 border-warning/50 px-4 py-4" data-my-pay>
      <div>
        <div className="text-[13px] text-muted-foreground">Ready to pay</div>
        <div className="text-[24px] font-semibold tabular-nums">{money(cents)}</div>
      </div>
      {!accepted && (
        <div className="space-y-2">
          {sale.purchase_disclaimer && <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{sale.purchase_disclaimer}</p>}
          <label className="flex min-h-10 cursor-pointer items-start gap-2.5 text-[14px]">
            <Checkbox checked={agree} onCheckedChange={(v) => setAgree(!!v)} className="mt-0.5" />
            <span>I understand what's included, the payment terms and the service term, and that my Coaching Agreement covers this purchase.</span>
          </label>
          <Button variant="outline" className="h-10 w-full" disabled={!agree || busy} onClick={accept}>
            {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}Accept terms
          </Button>
        </div>
      )}
      {sale.stripe_payment_link || sale.stripe_checkout_session_id ? (
        <Button className="h-11 w-full" disabled={!accepted} onClick={() => void pay()}>
          Pay {money(cents)}<ExternalLink className="ml-2 h-4 w-4" />
        </Button>
      ) : (
        <p className="text-[13px] text-muted-foreground">Your coach will send you a way to pay.</p>
      )}
    </Panel>
  );
}

function Details({ sale }: { sale: any }) {
  const included: string[] = sale.included_features ?? [];
  const excluded: string[] = sale.excluded_features ?? [];
  const facts = [
    ["Bought", billingDay(sale.purchased_at, { year: "always" })],
    ["Service", period(sale.service_start_date ?? sale.term_start_date ?? null, sale.term_end_date ?? null)],
    ["Term", sale.term_duration_text],
    ["Location", sale.location],
  ].filter(([, v]) => !!v) as Array<[string, string]>;
  const policies = [["Cancellation", sale.cancellation_policy], ["Refunds", sale.refund_policy], ["In person", sale.in_person_policy]].filter(([, v]) => !!v) as Array<[string, string]>;
  const description = (sale.full_description ?? sale.short_description ?? "").trim();
  if (facts.length === 0 && included.length === 0 && !description && policies.length === 0) return null;
  return (
    <Panel className="divide-y divide-border" data-my-details>
      {(facts.length > 0 || description) && (
        <Fold title="Details" open>
          {facts.length > 0 && (
            <dl className="space-y-1.5 text-[14px]">
              {facts.map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-muted-foreground">{k}</dt><dd className="text-right">{v}</dd></div>
              ))}
            </dl>
          )}
          {description && <p className="whitespace-pre-wrap text-[14px] text-muted-foreground">{description}</p>}
        </Fold>
      )}
      {(included.length > 0 || excluded.length > 0) && (
        <Fold title="What's included">
          <ul className="space-y-1 text-[14px]">{included.map((f) => <li key={f}>✓ {f}</li>)}</ul>
          {excluded.length > 0 && <ul className="space-y-1 text-[14px] text-muted-foreground">{excluded.map((f) => <li key={f}>Not included: {f}</li>)}</ul>}
        </Fold>
      )}
      {policies.length > 0 && (
        <Fold title="Policies">
          {policies.map(([k, v]) => (
            <div key={k}><div className="text-[14px] font-medium">{k}</div><p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{v}</p></div>
          ))}
        </Fold>
      )}
    </Panel>
  );
}

function Fold({ title, children, open: startOpen = false }: { title: string; children: ReactNode; open?: boolean }) {
  const [open, setOpen] = useState(startOpen);
  return (
    <div>
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 text-left text-[15px] font-medium">
        {title}<ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} aria-hidden />
      </button>
      {open && <div className="space-y-2 px-4 pb-4">{children}</div>}
    </div>
  );
}

/** One line: the purchase is covered by their Coaching Agreement, or a way to sign it. */
function AgreementRow() {
  const { state, needsSignature, canSign, openSignFlow } = useCoachingAgreement();
  const { clientId } = usePortalClientId();
  const { data: c } = useQuery({
    queryKey: ["my-agreement-flag", clientId],
    enabled: !!clientId,
    staleTime: 5 * 60_000,
    queryFn: async () => (await supabase.from("clients").select("agreement_signed").eq("id", clientId!).maybeSingle()).data,
  });
  const signed = state?.state?.state === "signed" || !!c?.agreement_signed;
  return (
    <Panel className="flex items-center justify-between gap-3 px-4 py-3" data-my-agreement={signed ? "signed" : "unsigned"}>
      <div className="flex min-w-0 items-center gap-2 text-[14px]">
        <FileSignature className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0">{signed ? "Covered by your Coaching Agreement" : "Your Coaching Agreement isn't signed yet"}</span>
      </div>
      {signed ? (
        <Button size="sm" variant="ghost" className="h-10 shrink-0" asChild><Link to="/portal/account" hash="coaching-agreement">View</Link></Button>
      ) : needsSignature && canSign ? (
        <Button size="sm" className="h-10 shrink-0" onClick={openSignFlow}>Sign</Button>
      ) : null}
    </Panel>
  );
}
