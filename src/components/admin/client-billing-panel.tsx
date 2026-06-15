import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
import { todayLocalISO } from "@/lib/today";
  getClientBillingOverview,
  recordPayment,
  voidLedgerRow,
  recordRefund,
  issueClientCredit,
  applyClientCredit,
  convertClientService,
  grantSessionsManually,
  runExpireSessions,
} from "@/lib/billing.functions";

function fmt(amountMinor: number | null | undefined, currency = "CAD") {
  if (amountMinor === null || amountMinor === undefined) return "—";
  return new Intl.NumberFormat("en-CA", { style: "currency", currency }).format(amountMinor / 100);
}

const PAYMENT_METHODS = ["stripe","etransfer","cash","debit","credit_card","bank_transfer","cheque","credit_balance","other"] as const;

export function ClientBillingPanel({ clientId }: { clientId: string }) {
  const qc = useQueryClient();
  const overview = useServerFn(getClientBillingOverview);
  const { data, isLoading } = useQuery({
    queryKey: ["client-billing", clientId],
    queryFn: () => overview({ data: { client_id: clientId } }),
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["client-billing", clientId] });

  if (isLoading) return <Card className="p-6 md:col-span-3 text-sm text-muted-foreground">Loading billing…</Card>;
  if (!data?.ok) return <Card className="p-6 md:col-span-3 text-sm text-destructive">Failed to load billing.</Card>;

  const totalPaid = (data.ledger as any[])
    .filter((l) => !l.voided && ["payment","deposit","legacy_backfill"].includes(l.txn_type))
    .reduce((s, l) => s + Number(l.amount_minor), 0);
  const totalRefunded = (data.ledger as any[])
    .filter((l) => !l.voided && ["refund","partial_refund"].includes(l.txn_type))
    .reduce((s, l) => s + Number(l.amount_minor), 0);
  const totalOutstanding = (data.purchases as any[])
    .reduce((s, p) => s + Number(p.amount_outstanding_cents ?? 0), 0);

  return (
    <div className="md:col-span-3 space-y-6">
      {/* Summary tiles */}
      <div className="grid gap-4 md:grid-cols-4">
        <SummaryTile label="Total paid" value={fmt(totalPaid)} />
        <SummaryTile label="Total refunded" value={fmt(totalRefunded)} />
        <SummaryTile label="Outstanding" value={fmt(totalOutstanding)} highlight={totalOutstanding > 0} />
        <SummaryTile label="Credit balance" value={fmt(data.credit_balance_minor)} />
      </div>

      <Tabs defaultValue="purchases">
        <TabsList>
          <TabsTrigger value="purchases">Purchases</TabsTrigger>
          <TabsTrigger value="ledger">Payment ledger</TabsTrigger>
          <TabsTrigger value="sessions">PT sessions</TabsTrigger>
          <TabsTrigger value="credits">Credits</TabsTrigger>
          <TabsTrigger value="conversions">Conversions</TabsTrigger>
        </TabsList>

        <TabsContent value="purchases" className="space-y-3">
          {(data.purchases as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No purchases yet.</p>
          )}
          {(data.purchases as any[]).map((p) => (
            <PurchaseRow key={p.id} purchase={p} clientId={clientId} onChanged={invalidate} />
          ))}
        </TabsContent>

        <TabsContent value="ledger" className="space-y-2">
          {(data.ledger as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No ledger entries.</p>
          )}
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Type</th><th className="p-2 text-left">Method</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Note</th><th /></tr>
              </thead>
              <tbody>
                {(data.ledger as any[]).map((l) => (
                  <tr key={l.id} className={l.voided ? "opacity-50 line-through" : ""}>
                    <td className="p-2">{l.transaction_date}</td>
                    <td className="p-2">{l.txn_type}</td>
                    <td className="p-2">{l.method}</td>
                    <td className="p-2 text-right font-mono">{fmt(l.amount_minor, l.currency)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{l.internal_note ?? l.external_reference ?? ""}</td>
                    <td className="p-2 text-right">
                      {!l.voided && (
                        <VoidButton ledgerId={l.id} onDone={invalidate} />
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="sessions" className="space-y-3">
          <ExpireButton onDone={invalidate} />
          <SessionBalanceTable balance={data.session_balance as any[]} events={data.session_events as any[]} />
        </TabsContent>

        <TabsContent value="credits" className="space-y-2">
          {(data.credits as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No credits issued.</p>
          )}
          <div className="overflow-x-auto rounded border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-xs uppercase">
                <tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Kind</th><th className="p-2 text-right">Amount</th><th className="p-2 text-left">Reason</th></tr>
              </thead>
              <tbody>
                {(data.credits as any[]).map((c) => (
                  <tr key={c.id}>
                    <td className="p-2">{new Date(c.created_at).toLocaleDateString()}</td>
                    <td className="p-2">{c.kind}</td>
                    <td className="p-2 text-right font-mono">{fmt(c.amount_minor, c.currency)}</td>
                    <td className="p-2 text-xs text-muted-foreground">{c.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabsContent>

        <TabsContent value="conversions" className="space-y-2">
          {(data.conversions as any[]).length === 0 && (
            <p className="text-sm text-muted-foreground py-4">No service conversions.</p>
          )}
          {(data.conversions as any[]).map((c) => (
            <Card key={c.id} className="p-4 text-sm space-y-1">
              <div className="font-medium">Conversion · {c.effective_date} · {c.original_disposition}</div>
              <div className="text-xs text-muted-foreground">
                Original value {fmt(c.original_contract_value_cents)} · Delivered {fmt(c.value_delivered_cents)} ·
                Credit applied {fmt(c.credit_applied_cents)} · New price {fmt(c.new_price_cents)} ·
                {c.amount_due_cents > 0 ? ` Due ${fmt(c.amount_due_cents)}` : ""}
                {c.refund_owed_cents > 0 ? ` Refund owed ${fmt(c.refund_owed_cents)}` : ""}
              </div>
              {c.notes && <div className="text-xs">{c.notes}</div>}
            </Card>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}

function SummaryTile({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <Card className={`p-4 ${highlight ? "border-destructive/40 bg-destructive/5" : ""}`}>
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums">{value}</div>
    </Card>
  );
}

function PurchaseRow({ purchase, clientId, onChanged }: { purchase: any; clientId: string; onChanged: () => void }) {
  const currency = purchase.currency ?? "CAD";
  const contract = Number(purchase.contract_value_cents ?? Math.round(Number(purchase.full_payable_amount ?? 0) * 100));
  const paid = Number(purchase.amount_paid_cents ?? 0);
  const outstanding = Number(purchase.amount_outstanding_cents ?? Math.max(0, contract - paid));

  return (
    <Card className="p-4 space-y-3">
      <div className="flex justify-between items-start gap-4 flex-wrap">
        <div>
          <div className="font-medium">{purchase.offer_name}</div>
          <div className="text-xs text-muted-foreground">
            {purchase.payment_structure ?? "—"} · {purchase.term_start_date ?? "?"} → {purchase.term_end_date ?? "?"}
            {purchase.sessions_purchased > 0 && ` · ${purchase.sessions_purchased} sessions`}
          </div>
        </div>
        <div className="text-right text-sm">
          <div>Contract <span className="font-mono">{fmt(contract, currency)}</span></div>
          <div>Paid <span className="font-mono">{fmt(paid, currency)}</span></div>
          <div className={outstanding > 0 ? "text-destructive" : "text-green-600"}>
            {outstanding > 0 ? `Owes ${fmt(outstanding, currency)}` : "Paid in full"}
          </div>
        </div>
      </div>
      <div className="flex gap-2 flex-wrap">
        <RecordPaymentDialog purchase={purchase} onDone={onChanged} />
        <RecordRefundDialog purchase={purchase} onDone={onChanged} />
        <IssueCreditDialog purchase={purchase} clientId={clientId} onDone={onChanged} />
        <ApplyCreditDialog purchase={purchase} clientId={clientId} onDone={onChanged} />
        <ConvertDialog purchase={purchase} onDone={onChanged} />
        {purchase.sessions_purchased > 0 && (
          <GrantSessionsDialog purchase={purchase} onDone={onChanged} />
        )}
      </div>
    </Card>
  );
}

function RecordPaymentDialog({ purchase, onDone }: { purchase: any; onDone: () => void }) {
  const fn = useServerFn(recordPayment);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("etransfer");
  const [date, setDate] = useState(todayLocalISO());
  const [ref, setRef] = useState("");
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: async () => fn({ data: {
      purchase_id: purchase.id,
      method: method as any, amount_minor: Math.round(parseFloat(amount) * 100),
      currency: purchase.currency ?? "CAD", transaction_date: date,
      external_reference: ref || undefined, internal_note: note || undefined,
    } }),
    onSuccess: () => { toast.success("Payment recorded"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm">Record payment</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record payment · {purchase.offer_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount ({purchase.currency ?? "CAD"})</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="3000.00" /></div>
          <div><Label>Method</Label>
            <Select value={method} onValueChange={setMethod}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{PAYMENT_METHODS.map((m) => <SelectItem key={m} value={m}>{m}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Date received</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
          <div><Label>External reference (optional)</Label><Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="e-transfer confirmation #" /></div>
          <div><Label>Internal note (optional)</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!amount || m.isPending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RecordRefundDialog({ purchase, onDone }: { purchase: any; onDone: () => void }) {
  const fn = useServerFn(recordRefund);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async () => fn({ data: {
      purchase_id: purchase.id, amount_minor: Math.round(parseFloat(amount) * 100), reason,
      method: "etransfer",
    } }),
    onSuccess: () => { toast.success("Refund recorded"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Refund</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Record refund</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!amount || m.isPending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function IssueCreditDialog({ purchase, clientId, onDone }: { purchase: any; clientId: string; onDone: () => void }) {
  const fn = useServerFn(issueClientCredit);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async () => fn({ data: {
      client_id: clientId, amount_minor: Math.round(parseFloat(amount) * 100),
      currency: purchase.currency ?? "CAD", reason,
    } }),
    onSuccess: () => { toast.success("Credit issued"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Issue credit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Issue account credit</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!amount || m.isPending}>Save</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ApplyCreditDialog({ purchase, clientId, onDone }: { purchase: any; clientId: string; onDone: () => void }) {
  const fn = useServerFn(applyClientCredit);
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async () => fn({ data: {
      purchase_id: purchase.id,
      amount_minor: Math.round(parseFloat(amount) * 100), reason,
    } }),
    onSuccess: () => { toast.success("Credit applied"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Apply credit</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Apply credit to this purchase</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Amount</Label><Input value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div><Label>Note</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!amount || m.isPending}>Apply</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ConvertDialog({ purchase, onDone }: { purchase: any; onDone: () => void }) {
  const fn = useServerFn(convertClientService);
  const [open, setOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [date, setDate] = useState(todayLocalISO());
  const [delivered, setDelivered] = useState("0");
  const [newPrice, setNewPrice] = useState("");
  const [credit, setCredit] = useState("");
  const [disp, setDisp] = useState<"ended"|"partially_replaced"|"continues">("ended");
  const [reason, setReason] = useState("");
  const m = useMutation({
    mutationFn: async () => fn({ data: {
      original_purchase_id: purchase.id,
      new_offer_name: newName,
      effective_date: date,
      value_delivered_cents: Math.round(parseFloat(delivered || "0") * 100),
      new_price_cents: Math.round(parseFloat(newPrice || "0") * 100),
      credit_applied_cents: Math.round(parseFloat(credit || "0") * 100),
      original_disposition: disp,
      reason,
    } }),
    onSuccess: () => { toast.success("Service converted"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Convert</Button></DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>Convert · {purchase.offer_name}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>New service name</Label><Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. Online Coaching - 6 months" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Effective date</Label><Input type="date" value={date} onChange={(e) => setDate(e.target.value)} /></div>
            <div><Label>Original disposition</Label>
              <Select value={disp} onValueChange={(v: any) => setDisp(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="ended">Ended</SelectItem>
                  <SelectItem value="partially_replaced">Partially replaced</SelectItem>
                  <SelectItem value="continues">Continues</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><Label>Value delivered</Label><Input value={delivered} onChange={(e) => setDelivered(e.target.value)} /></div>
            <div><Label>New price</Label><Input value={newPrice} onChange={(e) => setNewPrice(e.target.value)} /></div>
            <div><Label>Credit applied</Label><Input value={credit} onChange={(e) => setCredit(e.target.value)} /></div>
          </div>
          <div><Label>Reason / notes</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!newName || !newPrice || m.isPending}>Convert</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function GrantSessionsDialog({ purchase, onDone }: { purchase: any; onDone: () => void }) {
  const fn = useServerFn(grantSessionsManually);
  const [open, setOpen] = useState(false);
  const [count, setCount] = useState("");
  const [note, setNote] = useState("");
  const m = useMutation({
    mutationFn: async () => fn({ data: { purchase_id: purchase.id, count: parseInt(count, 10), note } }),
    onSuccess: () => { toast.success("Sessions granted"); setOpen(false); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button size="sm" variant="outline">Grant sessions</Button></DialogTrigger>
      <DialogContent>
        <DialogHeader><DialogTitle>Grant additional sessions</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Count</Label><Input value={count} onChange={(e) => setCount(e.target.value)} /></div>
          <div><Label>Note</Label><Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} /></div>
        </div>
        <DialogFooter><Button onClick={() => m.mutate()} disabled={!count || m.isPending}>Grant</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function VoidButton({ ledgerId, onDone }: { ledgerId: string; onDone: () => void }) {
  const fn = useServerFn(voidLedgerRow);
  const m = useMutation({
    mutationFn: async () => {
      const reason = window.prompt("Void reason?");
      if (!reason) throw new Error("Cancelled");
      return fn({ data: { ledger_id: ledgerId, reason } });
    },
    onSuccess: () => { toast.success("Voided"); onDone(); },
    onError: (e: any) => { if (e.message !== "Cancelled") toast.error(e.message); },
  });
  return <Button size="sm" variant="ghost" onClick={() => m.mutate()}>Void</Button>;
}

function ExpireButton({ onDone }: { onDone: () => void }) {
  const fn = useServerFn(runExpireSessions);
  const m = useMutation({
    mutationFn: async () => fn({}),
    onSuccess: (d: any) => { toast.success(`Expired ${d.expired} package(s)`); onDone(); },
    onError: (e: any) => toast.error(e.message),
  });
  return <Button size="sm" variant="outline" onClick={() => m.mutate()} disabled={m.isPending}>Run expiry sweep</Button>;
}

function SessionBalanceTable({ balance, events }: { balance: any[]; events: any[] }) {
  if (balance.length === 0) return <p className="text-sm text-muted-foreground py-4">No session entitlements.</p>;
  return (
    <div className="space-y-4">
      <div className="overflow-x-auto rounded border border-border">
        <table className="w-full text-sm">
          <thead className="bg-muted/40 text-xs uppercase">
            <tr>
              <th className="p-2 text-left">Package</th>
              <th className="p-2 text-right">Granted</th>
              <th className="p-2 text-right">Used</th>
              <th className="p-2 text-right">Expired</th>
              <th className="p-2 text-right">Transferred</th>
              <th className="p-2 text-right font-bold">Remaining</th>
              <th className="p-2 text-left">Expires</th>
            </tr>
          </thead>
          <tbody>
            {balance.map((b) => (
              <tr key={b.purchase_id}>
                <td className="p-2">{b.offer_name}</td>
                <td className="p-2 text-right">{b.granted}</td>
                <td className="p-2 text-right">{b.used}</td>
                <td className="p-2 text-right">{b.expired}</td>
                <td className="p-2 text-right">{b.transferred}</td>
                <td className="p-2 text-right font-bold">{b.remaining}</td>
                <td className="p-2 text-xs">{b.expires_at ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <details className="text-xs">
        <summary className="cursor-pointer text-muted-foreground">Show session ledger ({events.length} events)</summary>
        <div className="mt-2 overflow-x-auto rounded border border-border">
          <table className="w-full">
            <thead className="bg-muted/40 uppercase">
              <tr><th className="p-2 text-left">Date</th><th className="p-2 text-left">Event</th><th className="p-2 text-right">Count</th><th className="p-2 text-left">Source</th><th className="p-2 text-left">Note</th></tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.id}>
                  <td className="p-2">{e.effective_date}</td>
                  <td className="p-2">{e.event_type}</td>
                  <td className="p-2 text-right">{e.session_count}</td>
                  <td className="p-2">{e.source}</td>
                  <td className="p-2 text-muted-foreground">{e.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}