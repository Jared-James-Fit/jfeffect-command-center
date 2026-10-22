import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { CalendarDays, CalendarPlus, Plus, Ticket, SlidersHorizontal, ChevronRight, StickyNote } from "lucide-react";
import { GoogleImportDialog } from "@/components/sessions/google-import-dialog";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SellSessionsDialog } from "@/components/sell-sessions-dialog";
import { adjustSessionCredits } from "@/lib/session-credit-packages.functions";
import { statusTone, fmtTimeRange, COMMON_TIMEZONES } from "@/lib/pt-sessions";
import {
  summarizeSessions,
  packageValueWithTax,
  fmtMoneyMinor,
  sessionEventLabel,
  type LedgerPaymentRow,
  type SessionBalanceRow,
} from "@/lib/sessions-inventory";

import { WORKSPACE_FULL_SPAN_CLASS } from "@/components/workspace/workspace-container";
import { SessionActionsSheet, whenLabel } from "@/components/schedule/session-actions-sheet";
import { sessionCredit, sessionStatusLabel, type CreditState } from "@/lib/session-credit";
import { useCoachNotes } from "@/lib/session-coach-notes";
import { ChangeRequestsCard } from "@/components/schedule/change-requests-card";
import { deviceTodayISO } from "@/lib/schedule-time";
import { useAuth } from "@/lib/auth";
import { listenChannel } from "@/lib/realtime-channel";
import { packageRenewal } from "@/lib/client-owed";
import { clientTaxRate } from "@/lib/client-billing-summary";
import { withTax } from "@/lib/sale-money";

const CREDIT_TEXT: Record<CreditState, string> = {
  held: "text-primary",
  used: "text-success",
  banked: "text-sky-300",
  free: "text-muted-foreground",
};
const ADJUST_REASONS = ["Bonus session", "Complimentary", "Correction", "Refund / manual adjustment", "No-show deduction", "Other"];

// Local date, not UTC: after 7 PM in Winnipeg the UTC date is already tomorrow.
function todayISO() {
  return deviceTodayISO();
}

/** Sessions trained beyond what was bought: what they're worth at the latest package's price. */
/**
 * Sessions past what's paid for. A package renews in its own size, so they
 * start the client's next package (Marc: the next 16), not a per-session tab.
 */
function RenewalNote({ purchases, trained, booked }: { purchases: any[]; trained: number; booked: number }) {
  const money = (cents: number) => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(cents / 100);
  const r = packageRenewal(purchases, trained, booked);
  const plural = (n: number) => `${n} session${n === 1 ? "" : "s"}`;
  if (!r) {
    if (trained <= 0) return null;
    return (
      <p className="rounded-md border border-warning/40 bg-warning/10 px-3 py-2 text-xs text-foreground">
        <strong>{plural(trained)} not paid for yet</strong>. Add a sale with sessions so they come off.
      </p>
    );
  }
  if (r.count === 0 && r.bookedAfter === 0) return null;
  const price = withTax(r.priceCents, clientTaxRate(purchases));
  return (
    <p className={`rounded-md border px-3 py-2 text-xs text-foreground ${r.count > 0 ? "border-warning/40 bg-warning/10" : "border-border bg-secondary/20"}`}>
      {r.count > 0 ? (
        <>
          <strong>Renewal due: {r.name}</strong> · {plural(r.trained)} trained past the last package started the next {r.count > 1 ? `${r.count} packages` : r.size} ({money(price)} each). Add it from Billing and they move onto it.
        </>
      ) : (
        <>
          <strong>{plural(r.bookedAfter)} booked past what's paid for</strong> · the next {r.size} ({money(price)}) is due once the first is trained.
        </>
      )}
    </p>
  );
}

function Stat({ label, value, tone }: { label: string; value: number | string; tone?: "primary" | "warning" | "success" }) {
  const toneCls =
    tone === "primary" ? "text-primary" : tone === "warning" ? "text-warning" : tone === "success" ? "text-success" : "text-foreground";
  return (
    <div className="min-w-0 rounded-lg border border-border bg-secondary/20 px-3 py-2">
      <div className="truncate text-[10px] uppercase tracking-widest text-muted-foreground">{label}</div>
      <div className={`text-lg font-black tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

/**
 * Canonical client Sessions panel.
 *
 * One term everywhere: SESSIONS (never "credits"). One place to see the
 * balance, book, add or adjust — selling always routes through the canonical
 * purchase flow so a sold product's sessions are granted automatically.
 */
export function ClientSessionsPanel({
  clientId,
  client,
  onChangeField,
}: {
  clientId: string;
  client: any;
  onChangeField?: (field: string, value: any) => void;
}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [bookOpen, setBookOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [acting, setActing] = useState<any>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["pt-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-adhoc-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-payment-ledger", clientId] });
  };

  useEffect(() => {
    const ch = listenChannel(`sessions-${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_sessions", filter: `client_id=eq.${clientId}` }, invalidateAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_ledger_events", filter: `client_id=eq.${clientId}` }, invalidateAll)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

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

  // Why a session was cancelled, moved or missed: the coach's own notes, never shown to the client.
  const { data: coachNotes } = useCoachNotes(clientId);

  const { data: balance = [] } = useQuery<SessionBalanceRow[]>({
    queryKey: ["pt-balance", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("session_balance", { _client_id: clientId });
      return (data ?? []) as SessionBalanceRow[];
    },
  });

  const { data: purchases = [] } = useQuery<any[]>({
    queryKey: ["pt-pack-purchases", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("purchase_records")
        .select("id, offer_name, payment_status, contract_value_cents, full_payable_amount, installment_amount, number_of_payments, is_recurring, amount_paid_cents, amount_tax_paid_cents, amount_outstanding_cents, currency, sessions_purchased, package_expiry_date, purchased_at, created_at, archived_at, stripe_checkout_session_id")
        .eq("client_id", clientId)
        .gt("sessions_purchased", 0)
        .order("created_at", { ascending: false });
      return data ?? [];
    },
  });

  const { data: adhoc = [] } = useQuery<any[]>({
    queryKey: ["pt-adhoc-sessions", clientId],
    queryFn: async () => {
      const { data } = await supabase
        .from("session_ledger_events")
        .select("session_count, event_type, source, note, created_at")
        .eq("client_id", clientId)
        .is("purchase_id", null);
      return data ?? [];
    },
  });

  // Stripe tax lives on the payment ledger: amount_minor is the gross charge,
  // tax_minor the tax portion. Contract values are pre-tax, so package math
  // must net the tax out before comparing against them.
  const { data: ledger = [] } = useQuery<(LedgerPaymentRow & { purchase_id: string | null })[]>({
    queryKey: ["pt-payment-ledger", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payment_ledger")
        .select("purchase_id, txn_type, amount_minor, tax_minor, voided")
        .eq("client_id", clientId);
      return (data ?? []) as any[];
    },
  });



  const today = todayISO();
  const upcoming = sessions
    .filter((s) => s.status === "Scheduled" && s.session_date >= today)
    .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));
  const needsReview = sessions.filter((s) => s.status === "Scheduled" && s.session_date < today);
  const summary = summarizeSessions(balance, adhoc, upcoming.length + needsReview.length);
  // Bookings no package had room for (holds less their releases).
  const looseHolds = Math.max(0, -adhoc
    .filter((e) => e.event_type === "reserved" || e.event_type === "released")
    .reduce((sum, e) => sum + Number(e.session_count ?? 0), 0));
  // Soonest upcoming first (what the coach acts on), then history newest first.
  const upcomingIds = new Set(upcoming.map((s) => s.id));
  const ordered = [...upcoming, ...sessions.filter((s) => !upcomingIds.has(s.id))];

  return (
    <>
      <Card className={`${WORKSPACE_FULL_SPAN_CLASS} space-y-4 overflow-hidden border-border bg-card p-4 md:p-6`}>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 sm:flex sm:flex-wrap sm:justify-between">
          <h3 className="flex min-w-0 items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
            <CalendarDays className="h-4 w-4 shrink-0" /> <span className="truncate">Sessions</span>
          </h3>
          <Button size="sm" className="bg-gradient-primary font-bold uppercase" onClick={() => { setEditing(null); setBookOpen(true); }}>
            <Plus className="mr-2 h-4 w-4" /> Book Session
          </Button>
        </div>

        <ChangeRequestsCard clientId={clientId} onEdit={(s) => { setEditing(sessions.find((x) => x.id === s.id) ?? s); setBookOpen(true); }} />

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Purchased" value={summary.purchased} />
          <Stat label="Used" value={summary.used} />
          <Stat label="Booked" value={summary.scheduled} tone={needsReview.length > 0 ? "warning" : undefined} />
          {summary.overdrawn > 0
            ? <Stat label="Over by" value={summary.overdrawn} tone="warning" />
            : <Stat label="Remaining" value={summary.remaining} tone="primary" />}
        </div>
        <p className="text-[11px] text-muted-foreground">
          Available to book: <strong className="text-foreground">{summary.available}</strong> (remaining minus booked).
          {" "}Booked sessions count as used by themselves once their day is over. Tap one to reschedule it, bank its credit or count a late cancel.
        </p>
        {needsReview.length > 0 && (
          <p className="text-[11px] text-warning">
            {needsReview.length === 1 ? "1 past session is" : `${needsReview.length} past sessions are`} waiting on you (a change request is open, so it wasn't counted by itself): tap to pick what happened.
          </p>
        )}
        <RenewalNote purchases={purchases} trained={summary.overdrawn} booked={looseHolds} />

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-w-0" onClick={() => setAddOpen(true)}>
              <Ticket className="mr-2 h-4 w-4" /> Add Sessions
            </Button>
            <Button size="sm" variant="outline" className="min-w-0" onClick={() => setAdjustOpen(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Adjust Sessions
            </Button>
            <Button size="sm" variant="outline" className="min-w-0" onClick={() => setImportOpen(true)}>
              <CalendarPlus className="mr-2 h-4 w-4" /> From Google Calendar
            </Button>
          </div>
        )}

        {/* ---------------- Package history ---------------- */}
        <div className="space-y-2">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Session packages</div>
          {purchases.length === 0 ? (
            <p className="text-sm text-muted-foreground">No session packages yet.</p>
          ) : (
            purchases.map((p) => {
              const v = packageValueWithTax(p, ledger.filter((l) => l.purchase_id === p.id));
              const row = balance.find((b) => b.purchase_id === p.id);
              const purchasedAt = p.purchased_at ?? p.created_at;
              return (
                <div key={p.id} className="min-w-0 rounded-lg border border-border bg-secondary/20 px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-bold">{p.offer_name || "Session package"}</div>
                      <div className="text-xs text-muted-foreground">
                        {purchasedAt ? new Date(purchasedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" }) : "—"}
                        {" · "}{v.sessions} sessions
                        {row ? <> · {Number(row.used ?? 0)} used · <strong className="text-foreground">{Number(row.remaining ?? 0)} remaining</strong></> : " · not active yet"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Contract {fmtMoneyMinor(v.packageValueMinor, v.currency)} (before tax)
                        {v.listRatePerSessionMinor != null ? ` · ${fmtMoneyMinor(v.listRatePerSessionMinor, v.currency)}/session` : ""}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Paid {fmtMoneyMinor(v.netPaidMinor, v.currency)} before tax
                        {v.outstandingMinor ? ` · ${fmtMoneyMinor(v.outstandingMinor, v.currency)} outstanding` : " · paid in full"}
                      </div>
                      {v.taxSeparated && (
                        <div className="text-xs text-muted-foreground">
                          Tax {fmtMoneyMinor(v.taxPaidMinor, v.currency)} · charged {fmtMoneyMinor(v.grossPaidMinor, v.currency)} total
                        </div>
                      )}

                    </div>
                    <Badge variant="outline" className="shrink-0">{p.payment_status ?? "—"}</Badge>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* ---------------- Session history ---------------- */}
        <div className="space-y-1">
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Session history</div>
          {sessions.length === 0 ? (
            <p className="text-sm text-muted-foreground">No sessions booked yet.</p>
          ) : (
            <ul className="divide-y divide-border">
              {ordered.map((s) => (
                <li key={s.id}>
                  {/* Whole row is the button: on a phone the date and time stay readable, and
                      one tap opens labelled actions (Reschedule, bank the credit, use it). */}
                  <button
                    type="button"
                    onClick={() => setActing(s)}
                    className="flex w-full items-center gap-3 py-2.5 text-left transition-colors hover:bg-secondary/30"
                  >
                    <Badge variant="outline" className={`${statusTone(s.status)} w-[84px] shrink-0 justify-center`}>{sessionStatusLabel(s.status)}</Badge>
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-semibold">{whenLabel(s.session_date, s.start_time)}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {s.uses_credit !== false && <span className={CREDIT_TEXT[sessionCredit(s, today).state]}>{sessionCredit(s, today).label} · </span>}
                        {fmtTimeRange(s.start_time, s.end_time)} · {s.title}{s.location ? ` · ${s.location.split(",")[0]}` : ""}
                      </div>
                      {coachNotes?.get(s.id) && (
                        <div className="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-200">
                          <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
                          <span className="line-clamp-2">{coachNotes.get(s.id)}</span>
                        </div>
                      )}
                    </div>
                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ---------------- Manual session adjustments ---------------- */}
        {adhoc.length > 0 && (
          <div className="space-y-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Manual session adjustments</div>
            <ul className="space-y-1">
              {adhoc.map((e, i) => (
                <li key={i} className="flex items-start justify-between gap-2 text-xs">
                  <span className="min-w-0 truncate">
                    {sessionEventLabel(e.event_type, e.source)}
                    {e.note ? ` · ${e.note}` : ""}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">{Number(e.session_count) > 0 ? `+${e.session_count}` : e.session_count}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </Card>

      {/* ---------------- Compact settings ---------------- */}
      <Card className={`${WORKSPACE_FULL_SPAN_CLASS} space-y-3 overflow-hidden border-border bg-card p-4 md:p-6`}>
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Session settings</h3>
        <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2">
          <div className="min-w-0">
            <Label>Time zone</Label>
            <Select value={client?.timezone ?? "America/Winnipeg"} onValueChange={(v) => onChangeField?.("timezone", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{COMMON_TIMEZONES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div className="min-w-0">
            <Label>Default location</Label>
            <Input value={client?.default_session_location ?? ""} onChange={(e) => onChangeField?.("default_session_location", e.target.value)} placeholder="Iron Image Gym" />
          </div>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Clients get one text at 6 PM the evening before each session, in this time zone. Save at the top of the page to apply.
        </p>
      </Card>

      <PtSessionDialog open={bookOpen} onOpenChange={setBookOpen} clientId={clientId} initial={editing} />
      <SessionActionsSheet
        session={acting}
        clientName={client?.full_name}
        open={!!acting}
        onOpenChange={(o) => { if (!o) setActing(null); }}
        onEdit={(s) => { setEditing(sessions.find((x) => x.id === s.id) ?? s); setBookOpen(true); }}
      />
      <SellSessionsDialog open={addOpen} onOpenChange={setAddOpen} clientId={clientId} />
      <AdjustSessionsDialog open={adjustOpen} onOpenChange={setAdjustOpen} clientId={clientId} onDone={invalidateAll} />
      {isAdmin && <GoogleImportDialog open={importOpen} onOpenChange={setImportOpen} clientId={clientId} clientName={client?.full_name} onDone={invalidateAll} />}
    </>
  );
}

function AdjustSessionsDialog({
  open,
  onOpenChange,
  clientId,
  onDone,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  clientId: string;
  onDone: () => void;
}) {
  const [delta, setDelta] = useState("1");
  const [reason, setReason] = useState(ADJUST_REASONS[0]);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const d = Number(delta);
    if (!Number.isInteger(d) || d === 0) return toast.error("Enter a non-zero whole number of sessions.");
    setSaving(true);
    try {
      await adjustSessionCredits({ data: { client_id: clientId, delta: d, note: [reason, note.trim()].filter(Boolean).join(" — ") } });
      toast.success(`${d > 0 ? "Added" : "Removed"} ${Math.abs(d)} session${Math.abs(d) === 1 ? "" : "s"}`);
      onDone();
      onOpenChange(false);
      setDelta("1");
      setNote("");
    } catch (e: any) {
      toast.error(e?.message ?? "Adjustment failed");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader><DialogTitle>Adjust Sessions</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Sessions to add or remove</Label>
            <Input inputMode="numeric" value={delta} onChange={(e) => setDelta(e.target.value)} placeholder="e.g. 2 or -1" />
          </div>
          <div>
            <Label>Reason</Label>
            <Select value={reason} onValueChange={setReason}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{ADJUST_REASONS.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div>
            <Label>Note (optional)</Label>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={saving} className="w-full sm:w-auto">{saving ? "Saving…" : "Adjust Sessions"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
