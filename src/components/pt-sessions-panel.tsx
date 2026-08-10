import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Plus, CalendarDays, Pencil, Trash2, CheckCircle2, Undo2, Ticket, Wallet, Ban, CircleOff, ArrowRightLeft, ScrollText, AlertTriangle,
} from "lucide-react";
import { toast } from "sonner";
import { PtSessionDialog } from "./pt-session-dialog";
import { SellSessionsDialog } from "./sell-sessions-dialog";
import { ApplyCreditDialog } from "./apply-credit-dialog";
import { EditPackDialog } from "./edit-pack-dialog";
import { adjustSessionCredits } from "@/lib/session-credit-packages.functions";
import { setPtSessionStatus } from "@/lib/pt-pack.functions";
import { statusTone, fmtTimeRange } from "@/lib/pt-sessions";
import { useAuth } from "@/lib/auth";

const ADJUST_REASONS = ["Bonus session", "Comped session", "Correction", "Refund / manual adjustment", "No-show deduction", "Other"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

function fmtMoney(minor: number | null, currency: string) {
  if (minor == null) return null;
  return `${currency} ${(minor / 100).toLocaleString()}`;
}

export function PtSessionsPanel({ clientId, client }: { clientId: string; client: any }) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [bookOpen, setBookOpen] = useState(false);
  const [sellOpen, setSellOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [upgradeOpen, setUpgradeOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [editingPack, setEditingPack] = useState<any>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["pt-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-adhoc-credits", clientId] });
    qc.invalidateQueries({ queryKey: ["client-session-credits", clientId] });
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["client", clientId] });
  };

  useEffect(() => {
    const ch = supabase
      .channel(`pt-sessions-${clientId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pt_sessions", filter: `client_id=eq.${clientId}` },
        invalidateAll,
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "session_ledger_events", filter: `client_id=eq.${clientId}` },
        invalidateAll,
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, qc]);

  const { data: sessions = [] } = useQuery<any[]>({
    queryKey: ["pt-sessions", clientId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pt_sessions")
        .select("*")
        .eq("client_id", clientId)
        .order("session_date", { ascending: false })
        .order("start_time", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Ledger-driven pack balances (one row per purchase with session activity)
  const { data: balance = [] } = useQuery<any[]>({
    queryKey: ["pt-balance", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      if (error) return [];
      return (data ?? []) as any[];
    },
  });

  // All session-pack purchases — including pending-payment ones that have no
  // ledger activity yet (and therefore don't appear in session_balance).
  const { data: sessionPurchases = [] } = useQuery<any[]>({
    queryKey: ["pt-pack-purchases", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("id, offer_name, payment_status, contract_value_cents, full_payable_amount, amount_paid_cents, amount_outstanding_cents, show_value_to_client, currency, sessions_purchased, package_expiry_date")
        .eq("client_id", clientId)
        .gt("sessions_purchased", 0)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  // Ad-hoc credits (quick grants / adjustments / overbooked reservations) have
  // no purchase attached and are invisible to session_balance — net them in.
  const { data: adhocEvents = [] } = useQuery<any[]>({
    queryKey: ["pt-adhoc-credits", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_ledger_events")
        .select("session_count, event_type")
        .eq("client_id", clientId)
        .is("purchase_id", null);
      return data ?? [];
    },
  });
  const adhocRemaining = adhocEvents.reduce((s, e) => s + Number(e.session_count ?? 0), 0);
  const adhocGranted = adhocEvents
    .filter((e) => ["granted", "transferred_in"].includes(e.event_type))
    .reduce((s, e) => s + Number(e.session_count ?? 0), 0);

  // Merge: every session purchase gets a card (with or without ledger row),
  // plus any balance rows whose purchase no longer matches (defensive).
  const packRows = [
    ...sessionPurchases.map((p) => ({ key: p.id, purchase: p, row: balance.find((b) => b.purchase_id === p.id) })),
    ...balance
      .filter((b) => !sessionPurchases.some((p) => p.id === b.purchase_id))
      .map((b) => ({ key: b.purchase_id ?? b.offer_name, purchase: undefined as any, row: b })),
  ];

  const totalPurchased = balance.reduce((s, r) => s + Number(r.granted ?? 0), 0) + adhocGranted;
  const totalUsed = balance.reduce((s, r) => s + Number(r.used ?? 0), 0);
  const totalAvailable = balance.reduce((s, r) => s + Number(r.remaining ?? 0), 0) + adhocRemaining;

  // Remaining dollar credit = available sessions × paid value per session.
  let remainingCreditMinor = 0;
  let creditCurrency = "CAD";
  for (const b of balance) {
    const p = sessionPurchases.find((x) => x.id === b.purchase_id);
    if (!p) continue;
    const n = Math.max(Number(p.sessions_purchased ?? 0), 1);
    const paidUnit = Math.round(Number(p.amount_paid_cents ?? 0) / n);
    remainingCreditMinor += Math.max(Number(b.remaining ?? 0), 0) * paidUnit;
    creditCurrency = p.currency ?? "CAD";
  }

  const today = todayISO();
  const upcoming = sessions
    .filter((s) => s.status === "Scheduled" && s.session_date >= today)
    .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));
  const needsReview = sessions
    .filter((s) => s.status === "Scheduled" && s.session_date < today)
    .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));
  const totalScheduled = upcoming.length + needsReview.length;
  const past = sessions.filter((s) => !upcoming.includes(s) && !needsReview.includes(s));
  const hasPacks = packRows.length > 0 || adhocRemaining !== 0 || adhocGranted > 0;

  const packStatus = (row: any, purchase: any) => {
    const expired =
      (row?.expires_at && row.expires_at < today) ||
      (purchase?.package_expiry_date && purchase.package_expiry_date < today);
    if (purchase && purchase.payment_status !== "Paid" && !row) return { label: "Pending Payment", cls: "border-warning/40 bg-warning/10 text-warning" };
    if (row && Number(row.remaining ?? 0) <= 0) return { label: "Used Up", cls: "border-border bg-secondary/40 text-muted-foreground" };
    if (expired) return { label: "Expired", cls: "border-destructive/40 bg-destructive/10 text-destructive" };
    if (purchase && purchase.payment_status !== "Paid") return { label: "Pending Payment", cls: "border-warning/40 bg-warning/10 text-warning" };
    return { label: "Paid in Full", cls: "border-success/40 bg-success/10 text-success" };
  };

  const changeStatus = async (s: any, status: string, deductOnMissed?: boolean) => {
    try {
      await setPtSessionStatus({ data: { sessionId: s.id, status: status as any, deductOnMissed } });
      invalidateAll();
      toast.success(`Marked ${status}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    }
  };

  const markComplete = (s: any) => {
    if (totalAvailable <= 0 && !confirm("No available session credits for this client.\n\nComplete anyway (admin override)?")) return;
    changeStatus(s, "Completed");
  };

  const markMissed = (s: any) => {
    const deduct = confirm("Mark as no-show.\n\nOK — deduct one session credit\nCancel — no-show without deducting");
    changeStatus(s, "Missed", deduct);
  };

  const undoComplete = (s: any) => {
    if (!confirm("Undo completion? One session credit will be restored to the balance.")) return;
    changeStatus(s, "Scheduled");
  };

  const del = async (s: any) => {
    if (!confirm("Delete this session? This cannot be undone.")) return;
    const { error } = await supabase.from("pt_sessions").delete().eq("id", s.id);
    if (error) return toast.error(error.message);
    invalidateAll();
    toast.success("Deleted");
  };

  const sessionRow = (s: any) => (
    <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
      <div className="flex items-center gap-3 min-w-0">
        <Badge variant="outline" className={statusTone(s.status)}>{s.status === "Missed" ? "No-show" : s.status}</Badge>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{s.title}</div>
          <div className="text-xs text-muted-foreground">
            {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {fmtTimeRange(s.start_time, s.end_time)} · {s.location}
          </div>
        </div>
      </div>
      <div className="flex gap-1">
        {s.status === "Scheduled" && (
          <>
            <Button size="sm" variant="ghost" title="Mark completed (deducts 1 credit)" onClick={() => markComplete(s)}><CheckCircle2 className="h-4 w-4 text-success" /></Button>
            <Button size="sm" variant="ghost" title="No-show" onClick={() => markMissed(s)}><Ban className="h-4 w-4 text-warning" /></Button>
            <Button size="sm" variant="ghost" title="Cancel session" onClick={() => { if (confirm("Cancel this session? No credit is deducted.")) changeStatus(s, "Cancelled"); }}><CircleOff className="h-4 w-4 text-muted-foreground" /></Button>
          </>
        )}
        {s.status === "Completed" && (
          <Button size="sm" variant="ghost" title="Undo completion (restores 1 credit)" onClick={() => undoComplete(s)}><Undo2 className="h-4 w-4 text-primary" /></Button>
        )}
        <Button size="sm" variant="ghost" title="Edit / reschedule" onClick={() => { setEditing(s); setBookOpen(true); }}><Pencil className="h-4 w-4" /></Button>
        {s.status !== "Completed" && (
          <Button size="sm" variant="ghost" className="text-destructive" title="Delete" onClick={() => del(s)}><Trash2 className="h-4 w-4" /></Button>
        )}
      </div>
    </li>
  );

  return (
    <Card className="border-border bg-card p-6 md:col-span-3 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
          <CalendarDays className="h-4 w-4" /> Personal Training Credits
        </h3>
        <div className="flex flex-wrap gap-2">
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setAdjustOpen(true)}>
              <Wallet className="mr-2 h-4 w-4" /> Adjust Balance
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" onClick={() => setSellOpen(true)}>
              <Ticket className="mr-2 h-4 w-4" /> Add Sessions
            </Button>
          )}
          {isAdmin && (
            <Button size="sm" variant="outline" disabled={totalAvailable <= 0} title={totalAvailable <= 0 ? "No available sessions to convert" : "Convert available sessions into credit for a new package"} onClick={() => setUpgradeOpen(true)}>
              <ArrowRightLeft className="mr-2 h-4 w-4" /> Apply Credit
            </Button>
          )}
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setBookOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Book Session
          </Button>
          <Button size="sm" variant="ghost" onClick={() => document.getElementById("session-transactions")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <ScrollText className="mr-2 h-4 w-4" /> Transactions
          </Button>
        </div>
      </div>

      {hasPacks && (
        <div className="grid gap-2 sm:grid-cols-5 text-xs">
          <Stat label="Purchased" value={totalPurchased} />
          <Stat label="Scheduled" value={totalScheduled} tone={needsReview.length > 0 ? "warning" : undefined} />
          <Stat label="Used" value={totalUsed} />
          <Stat label="Available" value={totalAvailable} tone="primary" />
          <Stat label="Credit" value={fmtMoney(remainingCreditMinor, creditCurrency) ?? "—"} tone={remainingCreditMinor > 0 ? "success" : undefined} />
        </div>
      )}

      {/* Session packs */}
      {packRows.length > 0 && (
        <div className="space-y-2">
          {packRows.map(({ key, purchase, row }) => {
            const st = packStatus(row, purchase);
            const totalMinor = purchase
              ? (purchase.contract_value_cents ?? (purchase.full_payable_amount != null ? Math.round(Number(purchase.full_payable_amount) * 100) : null))
              : null;
            const packSessions = Number(purchase?.sessions_purchased ?? row?.granted ?? 0);
            const perSession = totalMinor != null && packSessions > 0 ? Math.round(totalMinor / packSessions) : null;
            const expiry = row?.expires_at ?? purchase?.package_expiry_date ?? null;
            const counts = row
              ? <>{row.granted} purchased · {row.used} used · <strong className="text-foreground">{row.remaining} remaining</strong></>
              : <>{packSessions} sessions · <strong className="text-foreground">not active yet</strong></>;
            return (
              <div key={key} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-bold">{purchase?.offer_name || row?.offer_name || "Session pack"}</div>
                  <div className="text-xs text-muted-foreground">
                    {counts}
                    {expiry ? ` · expires ${new Date(expiry + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}` : ""}
                  </div>
                  {totalMinor != null && (
                    <div className="text-xs text-muted-foreground">
                      {fmtMoney(totalMinor, purchase?.currency ?? row?.currency ?? "CAD")} total
                      {perSession != null ? ` · ${fmtMoney(perSession, purchase?.currency ?? row?.currency ?? "CAD")}/session` : ""}
                    </div>
                  )}
                </div>
                <Badge variant="outline" className={st.cls}>{st.label}</Badge>
              </div>
            );
          })}
        </div>
      )}

      {/* Empty states */}
      {!hasPacks && sessions.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-6 text-center space-y-3">
          <p className="text-sm text-muted-foreground">No personal training sessions sold yet.</p>
          {isAdmin && (
            <Button size="sm" onClick={() => setSellOpen(true)}><Ticket className="mr-2 h-4 w-4" /> Sell Sessions</Button>
          )}
        </div>
      )}
      {hasPacks && upcoming.length === 0 && (
        <div className="rounded-md border border-dashed border-border p-4 text-center space-y-2">
          <p className="text-sm text-muted-foreground">
            {totalRemaining > 0 ? "No sessions booked yet." : "All sessions used."}
          </p>
          <div className="flex justify-center gap-2">
            {totalRemaining > 0 && (
              <Button size="sm" variant="outline" onClick={() => { setEditing(null); setBookOpen(true); }}><Plus className="mr-2 h-4 w-4" /> Book Session</Button>
            )}
            {totalRemaining <= 0 && isAdmin && (
              <Button size="sm" variant="outline" onClick={() => setSellOpen(true)}><Ticket className="mr-2 h-4 w-4" /> Sell More Sessions</Button>
            )}
          </div>
        </div>
      )}

      {/* Upcoming */}
      {upcoming.length > 0 && (
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-widest text-muted-foreground">Upcoming</div>
          <ul className="divide-y divide-border">{upcoming.map(sessionRow)}</ul>
        </div>
      )}

      {/* History */}
      {past.length > 0 && (
        <details className="group">
          <summary className="cursor-pointer select-none text-[10px] uppercase tracking-widest text-muted-foreground hover:text-foreground">
            Past sessions ({past.length})
          </summary>
          <ul className="mt-1 divide-y divide-border">{past.map(sessionRow)}</ul>
        </details>
      )}

      <PtSessionDialog open={bookOpen} onOpenChange={setBookOpen} clientId={clientId} clients={client ? [client] : []} initial={editing ?? undefined} />
      {isAdmin && <SellSessionsDialog open={sellOpen} onOpenChange={setSellOpen} clientId={clientId} />}
      {isAdmin && <AdjustBalanceDialog open={adjustOpen} onOpenChange={setAdjustOpen} clientId={clientId} onSaved={invalidateAll} />}
    </Card>
  );
}

function AdjustBalanceDialog({ open, onOpenChange, clientId, onSaved }: { open: boolean; onOpenChange: (o: boolean) => void; clientId: string; onSaved: () => void }) {
  const [delta, setDelta] = useState<number>(1);
  const [reason, setReason] = useState(ADJUST_REASONS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open) return;
    setDelta(1); setReason(ADJUST_REASONS[0]); setNote("");
  }, [open]);

  const save = async () => {
    if (!delta) return toast.error("Enter a non-zero adjustment");
    if (note.trim().length < 2) return toast.error("Add a short note for the audit trail");
    setSaving(true);
    try {
      await adjustSessionCredits({ data: { client_id: clientId, delta, note: `${reason}: ${note.trim()}` } });
      toast.success(`Balance adjusted by ${delta > 0 ? "+" : ""}${delta}`);
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e?.message ?? "Adjustment failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader><DialogTitle>Adjust Session Balance</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Sessions (+ add / − remove)</Label>
            <Input type="number" value={delta} onChange={(e) => setDelta(parseInt(e.target.value || "0", 10) || 0)} />
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ADJUST_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note (required)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Why is the balance changing?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Apply Adjustment"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: "primary" }) {
  return (
    <div className={`rounded-md border px-3 py-2 ${tone === "primary" ? "border-primary/40 bg-primary/10" : "border-border bg-secondary/40"}`}>
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className="text-lg font-black">{value}</div>
    </div>
  );
}