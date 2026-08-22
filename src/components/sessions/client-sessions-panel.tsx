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
import { CalendarDays, Plus, Ticket, SlidersHorizontal, CheckCircle2, Ban, CircleOff, Undo2, Pencil } from "lucide-react";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SellSessionsDialog } from "@/components/sell-sessions-dialog";
import { adjustSessionCredits } from "@/lib/session-credit-packages.functions";
import { setPtSessionStatus } from "@/lib/pt-pack.functions";
import { statusTone, fmtTimeRange, COMMON_TIMEZONES } from "@/lib/pt-sessions";
import {
  summarizeSessions,
  packageValue,
  fmtMoneyMinor,
  sessionEventLabel,
  type SessionBalanceRow,
} from "@/lib/sessions-inventory";
import { WORKSPACE_FULL_SPAN_CLASS } from "@/components/workspace/workspace-container";
import { useAuth } from "@/lib/auth";

const ADJUST_REASONS = ["Bonus session", "Complimentary", "Correction", "Refund / manual adjustment", "No-show deduction", "Other"];

function todayISO() {
  return new Date().toISOString().slice(0, 10);
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
  const [editing, setEditing] = useState<any>(null);

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["pt-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-adhoc-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
  };

  useEffect(() => {
    const ch = supabase
      .channel(`sessions-${clientId}`)
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
        .select("id, offer_name, payment_status, contract_value_cents, full_payable_amount, amount_paid_cents, amount_outstanding_cents, currency, sessions_purchased, package_expiry_date, purchased_at, created_at, stripe_checkout_session_id")
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

  const today = todayISO();
  const upcoming = sessions
    .filter((s) => s.status === "Scheduled" && s.session_date >= today)
    .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));
  const needsReview = sessions.filter((s) => s.status === "Scheduled" && s.session_date < today);
  const summary = summarizeSessions(balance, adhoc, upcoming.length + needsReview.length);

  const changeStatus = async (s: any, status: string, deductOnMissed?: boolean) => {
    try {
      await setPtSessionStatus({ data: { sessionId: s.id, status: status as any, deductOnMissed } });
      invalidateAll();
      toast.success(`Marked ${status}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Update failed");
    }
  };

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

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Stat label="Purchased" value={summary.purchased} />
          <Stat label="Used" value={summary.used} />
          <Stat label="Scheduled" value={summary.scheduled} tone={needsReview.length > 0 ? "warning" : undefined} />
          <Stat label="Remaining" value={summary.remaining} tone="primary" />
        </div>
        <p className="text-[11px] text-muted-foreground">
          Available to book: <strong className="text-foreground">{summary.available}</strong> (remaining minus scheduled).
        </p>

        {isAdmin && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" className="min-w-0" onClick={() => setAddOpen(true)}>
              <Ticket className="mr-2 h-4 w-4" /> Add Sessions
            </Button>
            <Button size="sm" variant="outline" className="min-w-0" onClick={() => setAdjustOpen(true)}>
              <SlidersHorizontal className="mr-2 h-4 w-4" /> Adjust Sessions
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
              const v = packageValue(p);
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
                        Paid {fmtMoneyMinor(v.amountPaidMinor, v.currency)} of {fmtMoneyMinor(v.packageValueMinor, v.currency)}
                        {v.paidRatePerSessionMinor != null ? ` · paid rate ${fmtMoneyMinor(v.paidRatePerSessionMinor, v.currency)}/session` : ""}
                        {v.listRatePerSessionMinor != null ? ` · list ${fmtMoneyMinor(v.listRatePerSessionMinor, v.currency)}/session` : ""}
                        {v.outstandingMinor ? ` · ${fmtMoneyMinor(v.outstandingMinor, v.currency)} outstanding` : ""}
                      </div>
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
              {sessions.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <Badge variant="outline" className={`${statusTone(s.status)} shrink-0`}>{s.status === "Missed" ? "No-show" : s.status}</Badge>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-semibold">{s.title}</div>
                      <div className="truncate text-xs text-muted-foreground">
                        {new Date(s.session_date + "T00:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} · {fmtTimeRange(s.start_time, s.end_time)}{s.location ? ` · ${s.location}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {s.status === "Scheduled" && (
                      <>
                        <Button size="sm" variant="ghost" title="Mark completed (uses 1 session)" onClick={() => changeStatus(s, "Completed")}><CheckCircle2 className="h-4 w-4 text-success" /></Button>
                        <Button size="sm" variant="ghost" title="No-show" onClick={() => changeStatus(s, "Missed", confirm("Deduct one session for this no-show?"))}><Ban className="h-4 w-4 text-warning" /></Button>
                        <Button size="sm" variant="ghost" title="Cancel (returns the session)" onClick={() => { if (confirm("Cancel this session? The reserved session is returned.")) changeStatus(s, "Cancelled"); }}><CircleOff className="h-4 w-4 text-muted-foreground" /></Button>
                      </>
                    )}
                    {s.status === "Completed" && (
                      <Button size="sm" variant="ghost" title="Undo completion (returns 1 session)" onClick={() => { if (confirm("Undo completion? One session is returned.")) changeStatus(s, "Scheduled"); }}><Undo2 className="h-4 w-4 text-primary" /></Button>
                    )}
                    <Button size="sm" variant="ghost" title="Edit / reschedule" onClick={() => { setEditing(s); setBookOpen(true); }}><Pencil className="h-4 w-4" /></Button>
                  </div>
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
        <p className="text-[11px] text-muted-foreground">Reminders send in the client's time zone. Save at the top of the page to apply.</p>
      </Card>

      <PtSessionDialog open={bookOpen} onOpenChange={setBookOpen} clientId={clientId} initial={editing} />
      <SellSessionsDialog open={addOpen} onOpenChange={setAddOpen} clientId={clientId} />
      <AdjustSessionsDialog open={adjustOpen} onOpenChange={setAdjustOpen} clientId={clientId} onDone={invalidateAll} />
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
