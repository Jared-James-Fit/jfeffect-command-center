import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Archive, ArchiveRestore, Banknote, Download, PlusCircle, Undo2 } from "lucide-react";
import { toast } from "sonner";
import { useState, useEffect, useMemo } from "react";
import { ClientAgreementBadge } from "@/components/coaching-agreement/client-agreement-badge";
import { useServerFn } from "@tanstack/react-start";
import { getSignedAgreementUrl } from "@/lib/agreements.functions";
import { archivePurchaseRecord, restorePurchaseRecord } from "@/lib/purchase-archive.functions";
import { Checkbox } from "@/components/ui/checkbox";
import { clientTaxRate } from "@/lib/client-billing-summary";
import { saleMoney, salePayments, type PaymentRow } from "@/lib/sale-money";
import { AccessBadge, fmtDate, saleStatus } from "@/components/admin/sale-row-parts";
import { SaleCard } from "@/components/admin/sale-card";
import { AddSessionsDialog, RecordPaymentDialog, RefundDialog, VoidPaymentDialog } from "@/components/admin/sale-payment-dialogs";
import { downloadPurchasePdf } from "@/components/purchase-records-panel";

export const Route = createFileRoute("/_authenticated/admin/purchases/$id")({ component: PurchaseDetail });

type Open = "pay" | "refund" | "sessions" | { void: PaymentRow } | null;

/**
 * One sale: the same card as the client's Billing tab with its payments open,
 * the money actions as buttons, what they bought, the agreement and notes.
 * Money is never typed in here: payments, refunds and voids are recorded as
 * payments, so every total stays in step with the payment history.
 */
function PurchaseDetail() {
  const { id } = Route.useParams();
  const qc = useQueryClient();
  const [dialog, setDialog] = useState<Open>(null);
  const archiveFn = useServerFn(archivePurchaseRecord);
  const restoreFn = useServerFn(restorePurchaseRecord);

  const { data: sale } = useQuery({
    queryKey: ["purchase-record", id],
    queryFn: async () => (await supabase.from("purchase_records").select("*, clients(id, full_name, email)").eq("id", id).single()).data as any,
  });
  const clientId: string | undefined = sale?.client_id;

  const { data: ledger = [] } = useQuery<any[]>({
    queryKey: ["purchase-ledger", id],
    queryFn: async () => (await supabase.from("payment_ledger").select("*").eq("purchase_id", id).order("transaction_date", { ascending: true })).data ?? [],
  });
  // The client's other sales, for their tax rate (shared with the Billing tab).
  const { data: clientSales = [] } = useQuery<any[]>({
    queryKey: ["client-purchases", clientId],
    enabled: !!clientId,
    queryFn: async () => (await supabase.from("purchase_records").select("*").eq("client_id", clientId!).order("purchased_at", { ascending: false })).data ?? [],
  });
  const { data: sessionBalance = [] } = useQuery<any[]>({
    queryKey: ["pt-balance", clientId],
    enabled: !!clientId,
    queryFn: async () => ((await (supabase as any).rpc("session_balance", { _client_id: clientId })).data ?? []) as any[],
  });
  const { data: offer } = useQuery({
    queryKey: ["purchase-offer", sale?.offer_id],
    enabled: !!sale?.offer_id,
    queryFn: async () => (await supabase.from("offers").select("id, requires_agreement, agreement_before_service, default_agreement_template_id").eq("id", sale.offer_id).maybeSingle()).data,
  });
  const { data: linkedAgreements = [] } = useQuery({
    queryKey: ["purchase-linked-agreements", id],
    queryFn: async () => (await supabase
      .from("agreements")
      .select("id, status, verification_status, template_name, signed_at, verified_at, signnow_signing_link, signnow_completed_link, signed_copy_url, signed_copy_storage_path")
      .eq("purchase_record_id", id)
      .order("created_at", { ascending: false })).data ?? [],
  });

  const money = useMemo(() => (sale ? saleMoney(sale, ledger, clientTaxRate(clientSales)) : null), [sale, ledger, clientSales]);
  const payments = useMemo(() => salePayments(ledger), [ledger]);

  if (!sale || !money) return <div className="p-10 text-muted-foreground">Loading…</div>;

  const refresh = () => {
    for (const key of [["purchase-record", id], ["purchase-ledger", id], ["client-purchases", clientId], ["client-billing", clientId], ["pt-balance", clientId], ["purchase-records"]]) {
      qc.invalidateQueries({ queryKey: key });
    }
  };
  const live = !sale.archived_at;
  const clientName = sale.clients?.full_name ?? "Client";
  // Back usually returns to the Billing tab through history; this is the fallback.
  const billingTab = `/admin/clients/${sale.client_id}`;

  const archive = async () => {
    try { await (live ? archiveFn : restoreFn)({ data: { id } }); toast.success(live ? "Sale archived" : "Sale restored"); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Could not update the sale"); }
  };

  return (
    <>
      <PageHeader
        backTo={billingTab}
        backLabel={`Back to ${clientName}`}
        breadcrumbs={[{ label: "Clients", to: "/admin/clients" }, { label: clientName, to: billingTab }, { label: sale.offer_name ?? "Sale" }]}
        title={sale.offer_name ?? "Sale"}
        subtitle={`${clientName} · bought ${fmtDate(sale.purchased_at) ?? "—"}`}
      />
      <div className="mx-auto grid max-w-5xl gap-4 p-4 md:grid-cols-5 md:p-8">
        <div className="space-y-4 md:col-span-3">
          <SaleCard
            raw={sale}
            money={money}
            status={saleStatus(sale, money)}
            badges={live && <AccessBadge raw={sale} />}
            sessions={sessionBalance.find((b: any) => b.purchase_id === id)}
            payments={payments}
            linkName={false}
            paymentsOpen
            onRecordPayment={() => setDialog("pay")}
            onVoidPayment={(p) => setDialog({ void: p })}
          />
          <div className="flex flex-wrap gap-2">
            {live && money.kind !== "free" && money.state !== "ended" && <Button variant="outline" size="sm" className="h-10" onClick={() => setDialog("pay")}><Banknote className="mr-2 h-4 w-4" />Record a payment</Button>}
            {live && money.paidCents > 0 && <Button variant="outline" size="sm" className="h-10" onClick={() => setDialog("refund")}><Undo2 className="mr-2 h-4 w-4" />Record a refund</Button>}
            {live && Number(sale.sessions_purchased ?? 0) > 0 && <Button variant="outline" size="sm" className="h-10" onClick={() => setDialog("sessions")}><PlusCircle className="mr-2 h-4 w-4" />Add sessions</Button>}
            <Button variant="outline" size="sm" className="h-10" onClick={() => void downloadPurchasePdf(sale, clientName)}><Download className="mr-2 h-4 w-4" />PDF</Button>
            <Button variant="ghost" size="sm" className="h-10 text-muted-foreground" onClick={() => void archive()}>
              {live ? <><Archive className="mr-2 h-4 w-4" />Archive sale</> : <><ArchiveRestore className="mr-2 h-4 w-4" />Restore sale</>}
            </Button>
          </div>
          <WhatTheyBought sale={sale} />
        </div>
        <div className="space-y-4 md:col-span-2">
          <NotesCard sale={sale} onSaved={refresh} />
          <AgreementCard sale={sale} offer={offer} linkedAgreements={linkedAgreements as any[]} onSaved={refresh} />
        </div>
      </div>

      {dialog === "pay" && <RecordPaymentDialog sale={sale} money={money} open onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />}
      {dialog === "refund" && <RefundDialog sale={sale} money={money} open onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />}
      {dialog === "sessions" && <AddSessionsDialog sale={sale} open onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />}
      {dialog && typeof dialog === "object" && <VoidPaymentDialog payment={dialog.void} currency={money.currency} open onOpenChange={(o) => !o && setDialog(null)} onDone={refresh} />}
    </>
  );
}

function WhatTheyBought({ sale }: { sale: any }) {
  const rows: Array<[string, string | null]> = [
    ["Length", sale.term_duration_text ?? null],
    ["Dates", sale.term_start_date || sale.term_end_date ? `${fmtDate(sale.term_start_date) ?? "?"} – ${fmtDate(sale.term_end_date) ?? "?"}` : null],
    ["Sessions", Number(sale.sessions_purchased ?? 0) > 0 ? String(sale.sessions_purchased) : null],
    ["Where", sale.location ?? null],
  ];
  const shown = rows.filter(([, v]) => v);
  const features: string[] = sale.included_features ?? [];
  if (!sale.short_description && shown.length === 0 && features.length === 0) return null;
  return (
    <Card className="space-y-3 border-border bg-card p-4">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">What they bought</h3>
      {sale.short_description && <p className="text-sm">{sale.short_description}</p>}
      {shown.length > 0 && (
        <dl className="grid grid-cols-2 gap-3 text-sm">
          {shown.map(([k, v]) => <div key={k}><dt className="text-xs text-muted-foreground">{k}</dt><dd>{v}</dd></div>)}
        </dl>
      )}
      {features.length > 0 && <ul className="space-y-0.5 text-sm">{features.map((f, i) => <li key={i}>• {f}</li>)}</ul>}
    </Card>
  );
}

function NotesCard({ sale, onSaved }: { sale: any; onSaved: () => void }) {
  const [notes, setNotes] = useState(sale.admin_notes ?? "");
  useEffect(() => { setNotes(sale.admin_notes ?? ""); }, [sale.admin_notes]);
  const dirty = notes !== (sale.admin_notes ?? "");
  const save = async () => {
    const { error } = await supabase.from("purchase_records").update({ admin_notes: notes }).eq("id", sale.id);
    if (error) return void toast.error(error.message);
    toast.success("Notes saved");
    onSaved();
  };
  return (
    <Card className="space-y-2 border-border bg-card p-4">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Notes</h3>
      <Textarea rows={4} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Only you see these." />
      {dirty && <div className="flex justify-end"><Button size="sm" onClick={() => void save()}>Save notes</Button></div>}
    </Card>
  );
}

function AgreementCard({ sale, offer, linkedAgreements, onSaved }: { sale: any; offer: any; linkedAgreements: any[]; onSaved: () => void }) {
  const [override, setOverride] = useState(!!sale.agreement_block_override);
  const [reason, setReason] = useState(sale.agreement_block_override_reason ?? "");
  useEffect(() => { setOverride(!!sale.agreement_block_override); setReason(sale.agreement_block_override_reason ?? ""); }, [sale.agreement_block_override, sale.agreement_block_override_reason]);
  const dirty = override !== !!sale.agreement_block_override || reason !== (sale.agreement_block_override_reason ?? "");

  const saveOverride = async () => {
    if (override && reason.trim().length < 5) return void toast.error("Override requires a written reason (at least 5 characters) for the audit log.");
    const { error } = await supabase.from("purchase_records").update({ agreement_block_override: override, agreement_block_override_reason: reason }).eq("id", sale.id);
    if (error) {
      const msg = /written reason/i.test(error.message)
        ? "Override requires a written reason (at least 5 characters)."
        : /admin or assigned coach|insufficient_privilege/i.test(error.message)
        ? "Only an admin or assigned coach can change the agreement override."
        : error.message;
      return void toast.error(msg);
    }
    toast.success("Saved");
    onSaved();
  };

  return (
    <Card className="space-y-2 border-border bg-card p-4">
      <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Agreement</h3>
      <div className="text-sm"><ClientAgreementBadge clientId={sale.clients?.id ?? sale.client_id} /></div>
      <p className="text-xs text-muted-foreground">This sale is covered by the agreement the client signs in the app. Nothing extra is sent with the payment.</p>
      {linkedAgreements.length > 0 && (
        <>
          <p className="pt-1 text-[11px] uppercase tracking-widest text-muted-foreground">Earlier per-sale agreement</p>
          <ul className="space-y-1">
            {linkedAgreements.map((a: any) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-secondary/20 p-2 text-xs">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{a.template_name}</div>
                  <div className="text-muted-foreground">Status: {a.status}{a.signed_at ? ` · signed ${new Date(a.signed_at).toLocaleDateString()}` : ""}</div>
                </div>
                <div className="flex gap-1">
                  {a.signed_copy_url && <a className="text-primary underline" href={a.signed_copy_url} target="_blank" rel="noreferrer">Signed copy</a>}
                  {a.signed_copy_storage_path && <DownloadSignedButton agreementId={a.id} />}
                  {!a.signed_copy_url && !a.signed_copy_storage_path && a.signnow_completed_link && (
                    <a className="text-primary underline" href={a.signnow_completed_link} target="_blank" rel="noreferrer">Open in SignNow</a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex items-center gap-2 pt-1 text-sm">Terms accepted: <Badge variant="outline" className={sale.terms_accepted ? "border-primary/40 text-primary" : "text-muted-foreground"}>{sale.terms_accepted ? "Yes" : "No"}</Badge></div>
      {sale.terms_accepted_at && <div className="text-xs text-muted-foreground">on {new Date(sale.terms_accepted_at).toLocaleString()}</div>}
      {offer?.requires_agreement && offer?.agreement_before_service && (
        <div className="mt-3 space-y-2 rounded-md border border-dashed border-border bg-secondary/10 p-3">
          <label className="flex items-center gap-2 text-xs font-semibold uppercase tracking-widest">
            <Checkbox checked={override} onCheckedChange={(v) => setOverride(!!v)} />
            Start without a signed agreement
          </label>
          <Label className="sr-only" htmlFor="override-reason">Reason</Label>
          <Textarea id="override-reason" rows={2} placeholder="Why (kept for the audit log)" value={reason} onChange={(e) => setReason(e.target.value)} />
          {sale.agreement_block_override_at && <div className="text-[10px] text-muted-foreground">Applied {new Date(sale.agreement_block_override_at).toLocaleString()}</div>}
          <p className="text-[11px] text-muted-foreground">Without this, the service can't start until a verified agreement is linked.</p>
          {dirty && <div className="flex justify-end"><Button size="sm" onClick={() => void saveOverride()}>Save</Button></div>}
        </div>
      )}
    </Card>
  );
}

function DownloadSignedButton({ agreementId }: { agreementId: string }) {
  const getUrl = useServerFn(getSignedAgreementUrl);
  return (
    <button
      type="button"
      className="text-primary underline inline-flex items-center gap-1"
      onClick={async () => {
        try {
          const r: any = await getUrl({ data: { id: agreementId } });
          if (r?.url) window.open(r.url, "_blank", "noopener,noreferrer");
          else toast.error("No signed copy available yet.");
        } catch (e: any) {
          toast.error(e?.message ?? "Couldn't fetch signed copy");
        }
      }}
    >
      <Download className="h-3 w-3" /> Download PDF
    </button>
  );
}
