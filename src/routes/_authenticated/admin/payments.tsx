import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CheckCircle2, Copy, ExternalLink, Download, AlertTriangle, Send, DollarSign, CreditCard } from "lucide-react";
import { toast } from "sonner";
import { updatePurchasePayment, sendPaymentLinkEmail } from "@/lib/payments.functions";
import { PAYMENT_STATUS_DETAILED } from "@/lib/offers";
import { SendPaymentRequestDialog } from "@/components/send-payment-request-dialog";

export const Route = createFileRoute("/_authenticated/admin/payments")({ component: PaymentsPage });

function statusTone(s?: string | null) {
  switch (s) {
    case "Paid":
    case "Active Subscription":
      return "bg-primary/10 text-primary border-primary/30";
    case "Overdue":
    case "Failed":
    case "Manual Payment Needed":
    case "Error":
      return "bg-destructive/10 text-destructive border-destructive/30";
    case "Refunded":
    case "Cancelled":
    case "Expired":
      return "bg-muted text-muted-foreground border-border";
    default:
      return "bg-warning/10 text-warning border-warning/30";
  }
}

function PaymentsPage() {
  const qc = useQueryClient();
  const updateFn = useServerFn(updatePurchasePayment);
  const sendFn = useServerFn(sendPaymentLinkEmail);

  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [q, setQ] = useState("");
  const [payDlg, setPayDlg] = useState<{ open: boolean; purchaseId: string; clientName?: string | null; hasPhone?: boolean; hasLink?: boolean }>({ open: false, purchaseId: "" });

  const { data: records = [] } = useQuery({
    queryKey: ["all-payments"],
    queryFn: async () => (await supabase
      .from("purchase_records")
      .select("*, clients(id, full_name, email, phone)")
      .order("purchased_at", { ascending: false })).data ?? [],
  });

  const filtered = useMemo(() => {
    return records.filter((r: any) => {
      if (statusFilter !== "all" && r.payment_status !== statusFilter) return false;
      if (q) {
        const t = q.toLowerCase();
        if (!`${r.offer_name} ${r.clients?.full_name ?? ""} ${r.clients?.email ?? ""}`.toLowerCase().includes(t)) return false;
      }
      return true;
    });
  }, [records, statusFilter, q]);

  const totals = useMemo(() => {
    const t = { count: filtered.length, paid: 0, pending: 0, overdue: 0 };
    for (const r of filtered) {
      if (r.payment_status === "Paid" || r.payment_status === "Active Subscription") t.paid += Number(r.amount_paid ?? r.full_payable_amount ?? 0);
      else if (r.payment_status === "Overdue" || r.payment_status === "Failed") t.overdue += Number(r.full_payable_amount ?? 0);
      else if ((r.payment_status ?? "").includes("Pending") || r.payment_status === "Manual Payment Needed") t.pending += Number(r.full_payable_amount ?? 0);
    }
    return t;
  }, [filtered]);

  const copyLink = (url?: string | null) => {
    if (!url) return toast.error("No payment link on this purchase");
    navigator.clipboard.writeText(url);
    toast.success("Payment link copied");
  };

  const markPaid = async (r: any) => {
    try {
      await updateFn({ data: { id: r.id, payment_status: "Paid", amount_paid: Number(r.full_payable_amount ?? 0) } });
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["all-payments"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const markStatus = async (r: any, status: string) => {
    try {
      await updateFn({ data: { id: r.id, payment_status: status } });
      toast.success(`Marked ${status}`);
      qc.invalidateQueries({ queryKey: ["all-payments"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const sendEmail = async (id: string) => {
    try {
      const r: any = await sendFn({ data: { id } });
      if (r?.sent) toast.success("Payment link emailed");
      else toast.message(r?.reason ?? "Email skipped");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const exportCsv = () => {
    const headers = ["Date", "Client", "Email", "Offer", "Amount", "Currency", "Payment status", "Service status", "Stripe link"];
    const rows = filtered.map((r: any) => [
      new Date(r.purchased_at).toISOString(),
      r.clients?.full_name ?? "",
      r.clients?.email ?? "",
      r.offer_name,
      r.full_payable_amount ?? "",
      r.currency ?? "",
      r.payment_status ?? "",
      r.service_status ?? "",
      r.stripe_payment_link ?? "",
    ]);
    const csv = [headers, ...rows].map((row) => row.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `payments-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
  };

  return (
    <>
      <PageHeader
        title="Payments"
        subtitle="Every payment status across clients, with quick actions and CSV export."
        actions={<Button variant="outline" onClick={exportCsv}><Download className="mr-2 h-4 w-4" />Export</Button>}
      />
      <div className="p-6 md:p-8 space-y-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Stat label="Records" value={totals.count.toString()} icon={DollarSign} />
          <Stat label="Paid" value={`$${totals.paid.toLocaleString()}`} tone="primary" icon={CheckCircle2} />
          <Stat label="Pending" value={`$${totals.pending.toLocaleString()}`} tone="warn" />
          <Stat label="Overdue / failed" value={`$${totals.overdue.toLocaleString()}`} tone="warn" icon={AlertTriangle} />
        </div>

        <Card className="border-border bg-card p-3 flex flex-wrap gap-3 items-center">
          <Input placeholder="Search client, email, offer…" value={q} onChange={(e) => setQ(e.target.value)} className="max-w-xs" />
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="max-w-[220px]"><SelectValue placeholder="Filter status" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All statuses</SelectItem>
              {PAYMENT_STATUS_DETAILED.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </Card>

        {filtered.length === 0 ? (
          <Card className="border-border bg-card p-10 text-center text-muted-foreground">No payments match these filters.</Card>
        ) : (
          <div className="space-y-2">
            {filtered.map((r: any) => (
              <Card key={r.id} className="border-border bg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to="/admin/purchases/$id" params={{ id: r.id }} className="font-bold hover:underline">{r.offer_name}</Link>
                    <div className="text-xs text-muted-foreground">
                      <Link to="/admin/clients/$id" params={{ id: r.clients?.id ?? r.client_id }} className="hover:underline">{r.clients?.full_name ?? "—"}</Link>
                      {" · "}{new Date(r.purchased_at).toLocaleDateString()}{" · "}{r.offer_type}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm">{r.currency ?? "USD"} {Number(r.full_payable_amount ?? 0).toLocaleString()}</span>
                    <Badge variant="outline" className={statusTone(r.payment_status)}>{r.payment_status ?? "Pending"}</Badge>
                    {r.service_status && r.service_status !== "Not Started" && <Badge variant="outline">{r.service_status}</Badge>}
                  </div>
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.payment_status !== "Paid" && (
                    <Button size="sm" variant="outline" onClick={() => markPaid(r)}><CheckCircle2 className="mr-1 h-3 w-3" />Mark paid</Button>
                  )}
                  {r.payment_status !== "Overdue" && r.payment_status !== "Paid" && (
                    <Button size="sm" variant="ghost" onClick={() => markStatus(r, "Overdue")}><AlertTriangle className="mr-1 h-3 w-3" />Overdue</Button>
                  )}
                  {r.stripe_payment_link && (
                    <>
                      <Button size="sm" variant="ghost" onClick={() => copyLink(r.stripe_payment_link)}><Copy className="mr-1 h-3 w-3" />Copy link</Button>
                      <a href={r.stripe_payment_link} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="mr-1 h-3 w-3" />Open</Button></a>
                    </>
                  )}
                  {r.stripe_payment_link && r.clients?.email && (
                    <Button size="sm" variant="ghost" onClick={() => sendEmail(r.id)}><Send className="mr-1 h-3 w-3" />Email link</Button>
                  )}
                  {r.stripe_payment_link && (
                    <Button size="sm" variant="outline" onClick={() => setPayDlg({
                      open: true,
                      purchaseId: r.id,
                      clientName: r.clients?.full_name,
                      hasPhone: !!r.clients?.phone,
                      hasLink: !!r.stripe_payment_link,
                    })}><CreditCard className="mr-1 h-3 w-3" />Send request</Button>
                  )}
                  {r.stripe_receipt_url && (
                    <a href={r.stripe_receipt_url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost">Receipt</Button></a>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
      <SendPaymentRequestDialog
        open={payDlg.open}
        onOpenChange={(o) => setPayDlg((p) => ({ ...p, open: o }))}
        purchaseId={payDlg.purchaseId}
        clientName={payDlg.clientName}
        hasPhone={payDlg.hasPhone}
        hasLink={payDlg.hasLink}
      />
    </>
  );
}

function Stat({ label, value, tone, icon: Icon }: { label: string; value: string; tone?: "primary" | "warn"; icon?: any }) {
  return (
    <Card className="border-border bg-card p-4">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
          <div className={`mt-1 text-2xl font-black ${tone === "warn" ? "text-warning" : tone === "primary" ? "text-primary" : ""}`}>{value}</div>
        </div>
        {Icon && <Icon className="h-5 w-5 text-muted-foreground" />}
      </div>
    </Card>
  );
}