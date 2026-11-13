import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import {
  CalendarDays, CalendarPlus, CalendarRange, Check, ChevronDown, ChevronRight, ExternalLink, MessageSquare, Pencil, Plus, Repeat,
  Settings2, SlidersHorizontal, StickyNote, Ticket, Wallet,
} from "lucide-react";
import { GoogleImportDialog } from "@/components/sessions/google-import-dialog";
import { PrebookDialog } from "@/components/sessions/prebook-dialog";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SellSessionsDialog } from "@/components/sell-sessions-dialog";
import { CardHeader, MoreButton, StatusChip, type ChipTone } from "@/components/nutrition/nutrition-ui";
import { TermDateEditor } from "@/components/purchase-records-panel";
import { useClientPayments } from "@/components/billing/use-client-payments";
import { adjustSessionCredits } from "@/lib/session-credit-packages.functions";
import { renewSessionPackage } from "@/lib/billing.functions";
import { COMMON_TIMEZONES } from "@/lib/pt-sessions";
import { sessionEventLabel, type SessionBalanceRow } from "@/lib/sessions-inventory";
import { WORKSPACE_FULL_SPAN_CLASS } from "@/components/workspace/workspace-container";
import { SessionActionsSheet, whenLabel } from "@/components/schedule/session-actions-sheet";
import { sessionStatusLabel, shortDay } from "@/lib/session-credit";
import { useCoachNotes } from "@/lib/session-coach-notes";
import { ChangeRequestsCard } from "@/components/schedule/change-requests-card";
import { deviceTodayISO, fmtWallClock } from "@/lib/schedule-time";
import { useAuth } from "@/lib/auth";
import { listenChannel } from "@/lib/realtime-channel";
import { latestPackage } from "@/lib/client-owed";
import { clientTaxRate } from "@/lib/client-billing-summary";
import { withTax } from "@/lib/sale-money";
import { formatMoney } from "@/lib/payment-display";
import { fetchAllPages } from "@/lib/supabase-paginate";
import { billingStatusLine, type AutoPayStatus, type ClientPayments } from "@/lib/payment-schedule";
import {
  buildSessionPackages,
  dayRange,
  sessionsNextStep,
  type NextPackage,
  type PackageLedgerEvent,
  type PackageSessionRow,
  type PackageView,
  type SessionPackages,
  type SessionsNextStep,
} from "@/lib/session-packages";
import { cn } from "@/lib/utils";

const ADJUST_REASONS = ["Bonus session", "Complimentary", "Correction", "Refund / manual adjustment", "No-show deduction", "Other"];
const plural = (n: number, w = "session") => `${n} ${w}${n === 1 ? "" : "s"}`;
const money = (cents: number, currency = "CAD") => formatMoney(cents / 100, currency);

/**
 * A client's Sessions tab: training, not money. How many are completed,
 * booked and still available, the next session, the package they're on now
 * (its sessions one tap away), anything to do next (book what's left, renew
 * once they've trained past it), and earlier packages folded away. Money is
 * one line that opens Billing, where every amount and date lives.
 *
 * One term everywhere: SESSIONS (never "credits").
 */
export function ClientSessionsPanel({
  clientId,
  client,
  onChangeField,
  onOpenBilling,
}: {
  clientId: string;
  client: any;
  onChangeField?: (field: string, value: any) => void;
  /** Opens the client's Billing tab. */
  onOpenBilling?: () => void;
}) {
  const qc = useQueryClient();
  const { role } = useAuth();
  const isAdmin = role === "admin";
  const [bookOpen, setBookOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [prebookOpen, setPrebookOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
  const [datesOf, setDatesOf] = useState<any>(null);
  const [editing, setEditing] = useState<any>(null);
  const [acting, setActing] = useState<any>(null);
  const first = client?.first_name || String(client?.full_name ?? "").split(" ")[0] || "client";

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ["pt-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-balance", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-pack-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-client-ledger", clientId] });
    qc.invalidateQueries({ queryKey: ["client-purchases", clientId] });
    qc.invalidateQueries({ queryKey: ["client-billing", clientId] });
    qc.invalidateQueries({ queryKey: ["pt-payment-ledger", clientId] });
  };

  useEffect(() => {
    const filter = `client_id=eq.${clientId}`;
    const ch = listenChannel(`sessions-${clientId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "pt_sessions", filter }, invalidateAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "session_ledger_events", filter }, invalidateAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "purchase_records", filter }, invalidateAll)
      .on("postgres_changes", { event: "*", schema: "public", table: "payment_ledger", filter }, invalidateAll)
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const { data: sessions = [], isLoading: sessionsLoading } = useQuery<any[]>({
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

  // Every column the package reading needs (its own key: other screens load a few columns under ["pt-pack-purchases", id]).
  const { data: purchases = [] } = useQuery<any[]>({
    queryKey: ["pt-pack-purchases", clientId, "full"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("purchase_records")
        .select("*")
        .eq("client_id", clientId)
        .gt("sessions_purchased", 0)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  // The whole session ledger, page by page: which package each session is on.
  const { data: events = [] } = useQuery<PackageLedgerEvent[]>({
    queryKey: ["pt-client-ledger", clientId],
    queryFn: () =>
      fetchAllPages<PackageLedgerEvent>((from, to) =>
        (supabase as any)
          .from("session_ledger_events")
          .select("id, purchase_id, pt_session_id, event_type, session_count, source, note, related_event_id, effective_date, created_at")
          .eq("client_id", clientId)
          .order("created_at", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to),
      ),
  });

  const { data: payments = [] } = useQuery<any[]>({
    queryKey: ["pt-payment-ledger", clientId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("payment_ledger")
        .select("id, purchase_id, txn_type, amount_minor, tax_minor, voided, transaction_date, method, source")
        .eq("client_id", clientId);
      return (data ?? []) as any[];
    },
  });

  // Money, read the way Billing reads it: one line here.
  const billing = useClientPayments(clientId);

  const today = deviceTodayISO();
  const model = useMemo(
    () => buildSessionPackages({ sales: purchases, payments, balance, events, sessions, today }),
    [purchases, payments, balance, events, sessions, today],
  );
  const pkg = useMemo(() => latestPackage(purchases), [purchases]);
  const renewEachCents = pkg ? withTax(pkg.priceCents, clientTaxRate(purchases)) : null;
  const manual = events.filter((e) => !e.purchase_id && !e.pt_session_id && Number(e.session_count ?? 0) !== 0);

  const renewFn = useServerFn(renewSessionPackage);
  const [bookAfterRenew, setBookAfterRenew] = useState(true);
  const renew = useMutation({
    mutationFn: () => renewFn({ data: { purchase_id: (pkg!.sale as any).id } }),
    onSuccess: () => {
      const after = model.next[0]?.open ?? pkg?.size ?? 0;
      toast.success(`${first}'s next ${pkg?.size} added`, { description: "It's on Billing until it's paid. Nothing was charged." });
      invalidateAll();
      setRenewOpen(false);
      if (bookAfterRenew && after > 0) setPrebookOpen(true);
    },
    onError: (e: any) => toast.error(e?.message ?? "Couldn't renew"),
  });

  const tools = isAdmin ? (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <MoreButton label="Session tools" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        <DropdownMenuItem onSelect={() => setPrebookOpen(true)}><CalendarRange className="mr-2 h-4 w-4" />Book ahead on their usual days</DropdownMenuItem>
        {pkg && <DropdownMenuItem onSelect={() => setRenewOpen(true)}><Repeat className="mr-2 h-4 w-4" />Renew: add the next {pkg.size}</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAddOpen(true)}><Ticket className="mr-2 h-4 w-4" />Sell a new package</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAdjustOpen(true)}><SlidersHorizontal className="mr-2 h-4 w-4" />Add or remove sessions</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setImportOpen(true)}><CalendarPlus className="mr-2 h-4 w-4" />Bring in from Google Calendar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

  const loading = sessionsLoading && sessions.length === 0;

  return (
    <>
      <Card className={`${WORKSPACE_FULL_SPAN_CLASS} space-y-4 overflow-hidden border-border bg-card p-4 md:p-6`}>
        <CardHeader
          icon={CalendarDays}
          title="Sessions"
          actions={
            <>
              <Button size="sm" variant="outline" className="h-10 px-3" onClick={() => { setEditing(null); setBookOpen(true); }}>
                <Plus className="mr-1.5 h-4 w-4" /> Book
              </Button>
              {tools}
            </>
          }
        />

        <ChangeRequestsCard clientId={clientId} onEdit={(s) => { setEditing(sessions.find((x) => x.id === s.id) ?? s); setBookOpen(true); }} />

        {loading ? (
          <div className="space-y-3" aria-busy="true">
            <div className="h-28 animate-pulse rounded-xl bg-muted" />
            <div className="h-36 animate-pulse rounded-xl bg-muted" />
          </div>
        ) : (
          <SessionsTrackerBody
            model={model}
            sessions={sessions}
            today={today}
            coachNotes={coachNotes}
            first={first}
            isAdmin={isAdmin}
            renewSize={pkg?.size ?? null}
            renewEachCents={renewEachCents}
            renewFromId={(pkg?.sale as any)?.id ?? null}
            manual={manual}
            payments={billing.payments}
            onOpenBilling={onOpenBilling}
            onRenew={() => setRenewOpen(true)}
            onBookAhead={() => setPrebookOpen(true)}
            onSell={() => setAddOpen(true)}
            onAdjust={() => setAdjustOpen(true)}
            onEditDates={(id) => setDatesOf(purchases.find((p) => p.id === id) ?? null)}
            onOpenSession={setActing}
          />
        )}
      </Card>

      <SessionSettings client={client} onChangeField={onChangeField} />

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
      {datesOf && <TermDateEditor purchase={datesOf} clientId={clientId} onClose={() => { setDatesOf(null); invalidateAll(); }} />}
      {isAdmin && <GoogleImportDialog open={importOpen} onOpenChange={setImportOpen} clientId={clientId} clientName={client?.full_name} onDone={invalidateAll} />}
      {isAdmin && <PrebookDialog open={prebookOpen} onOpenChange={setPrebookOpen} clientId={clientId} clientName={client?.full_name} onDone={invalidateAll} />}
      {isAdmin && pkg && (
        <RenewDialog
          open={renewOpen}
          onOpenChange={setRenewOpen}
          first={first}
          name={pkg.sale.offer_name ?? "Session package"}
          size={pkg.size}
          priceCents={pkg.priceCents}
          payments={Number((pkg.sale as any).number_of_payments ?? 0)}
          next={model.next[0] ?? null}
          leftNow={model.totals.leftToBook}
          autoPay={billing.payments?.autoPay ?? null}
          bookAfter={bookAfterRenew}
          onBookAfter={setBookAfterRenew}
          pending={renew.isPending}
          onConfirm={() => renew.mutate()}
        />
      )}
    </>
  );
}

/**
 * Everything under the Sessions header: the overview, what to do next, the
 * package they're on, what's coming up, and history folded away. Pure view
 * over the package model (session-packages.ts) and the payments model's one
 * line (payment-schedule.ts), so it can be checked with fixture data.
 */
export function SessionsTrackerBody({
  model, sessions, today, coachNotes, first, isAdmin, renewSize, renewEachCents, renewFromId, manual, payments,
  onOpenBilling, onRenew, onBookAhead, onSell, onAdjust, onEditDates, onOpenSession,
}: {
  model: SessionPackages;
  sessions: any[];
  today: string;
  coachNotes?: Map<string, string> | null;
  first: string;
  isAdmin: boolean;
  /** Sessions in the package a renewal copies (null: nothing priced to renew). */
  renewSize: number | null;
  renewEachCents: number | null;
  /** The package a renewal copies (only its card offers Renew). */
  renewFromId?: string | null;
  manual: PackageLedgerEvent[];
  payments?: ClientPayments | null;
  onOpenBilling?: () => void;
  onRenew: () => void;
  onBookAhead: () => void;
  onSell: () => void;
  onAdjust?: () => void;
  onEditDates?: (saleId: string) => void;
  onOpenSession: (s: any) => void;
}) {
  const step = sessionsNextStep(model, renewSize != null, renewSize);
  const sessionById = useMemo(() => new Map(sessions.map((s) => [s.id, s])), [sessions]);

  const upcoming = sessions
    .filter((s) => s.status === "Scheduled" && s.session_date >= today)
    .sort((a, b) => (a.session_date + a.start_time).localeCompare(b.session_date + b.start_time));
  const needsReview = sessions.filter((s) => s.status === "Scheduled" && s.session_date < today);

  // Everything not counted on a package: cancelled, moved, no-session types, and anything older than the ledger.
  const placed = new Set<string>([
    ...model.packages.flatMap((p) => p.sessions.map((s) => s.id)),
    ...model.next.flatMap((p) => p.sessions.map((s) => s.id)),
    ...model.free.map((s) => s.id),
    ...model.unpriced.map((s) => s.id),
  ]);
  const others = sessions.filter((s) => !placed.has(s.id));

  const lastNumber = model.packages.reduce((m, p) => Math.max(m, p.number), 0);
  // The package they're on: the one new bookings draw on, else the newest one.
  const current = model.packages.find((p) => p.id === model.currentId) ?? (model.next.length ? null : model.packages[0] ?? null);
  const history = model.packages.filter((p) => p.id !== current?.id && !(p.phase === "waiting" && p.number > (current?.number ?? 0)));
  const waitingAfter = model.packages.filter((p) => p.id !== current?.id && p.phase === "waiting" && p.number > (current?.number ?? 0));

  const openSession = (s: PackageSessionRow) => onOpenSession(sessionById.get(s.id) ?? s);
  const sessionRow = (s: PackageSessionRow) => {
    const full = sessionById.get(s.id) ?? s;
    return <SessionRow key={s.id} s={full} today={today} coachNote={coachNotes?.get(s.id)} clientFirst={first} onOpen={() => openSession(s)} />;
  };

  return (
    <>
      <Overview
        done={model.totals.done}
        booked={upcoming.length + needsReview.length}
        available={model.totals.leftToBook}
        nextUp={upcoming[0] ?? null}
        needsReview={needsReview.length}
        payments={payments ?? null}
        onOpenNext={upcoming[0] ? () => onOpenSession(upcoming[0]) : undefined}
        onOpenBilling={onOpenBilling}
      />

      <NextStep
        step={step}
        first={first}
        isAdmin={isAdmin}
        number={lastNumber + 1}
        renderSession={sessionRow}
        renewPriceCents={renewEachCents}
        onRenew={onRenew}
        onBookAhead={onBookAhead}
        onSell={onSell}
        unpriced={model.unpriced}
      />

      {current && (
        <CurrentPackage
          p={current}
          today={today}
          isAdmin={isAdmin}
          canRenew={renewFromId === current.id && step.kind !== "renew"}
          renderSession={sessionRow}
          overviewNextId={upcoming[0]?.id ?? null}
          onRenew={onRenew}
          onBookAhead={onBookAhead}
          onAdjust={onAdjust}
          onEditDates={onEditDates}
          onOpenBilling={onOpenBilling}
        />
      )}

      {model.next.slice(1).map((n, i) => (
        <PendingPackage key={`next-${i}`} next={n} number={lastNumber + 2 + i} renderSession={sessionRow} />
      ))}
      {waitingAfter.map((p) => (
        <PackageRow key={p.id} p={p} renderSession={sessionRow} />
      ))}

      {upcoming.length > 0 && (
        <Folder title="Upcoming sessions" summary={`${upcoming.length}`} data-upcoming>
          <ul className="divide-y divide-border rounded-lg border border-border">{upcoming.map((s) => sessionRow(s))}</ul>
        </Folder>
      )}

      {history.length > 0 && (
        <Folder title="Earlier packages" summary={`${history.length}`} data-history>
          {history.map((p) => <PackageRow key={p.id} p={p} renderSession={sessionRow} />)}
        </Folder>
      )}

      {(model.free.length > 0 || others.length > 0 || manual.length > 0) && (
        <OtherSessions free={model.free} others={others} manual={manual} renderSession={(s) => sessionRow(s)} />
      )}
    </>
  );
}

/* ---------------- Overview ---------------- */

/** "Nov 27" */
const monthDay = (iso: string) =>
  new Date(`${iso.slice(0, 10)}T00:00:00`).toLocaleDateString("en-CA", { month: "short", day: "numeric" });

const TONE_TEXT: Record<ChipTone, string> = {
  neutral: "text-muted-foreground",
  done: "text-success",
  attention: "text-warning",
  error: "text-destructive",
};

function Overview({ done, booked, available, nextUp, needsReview, payments, onOpenNext, onOpenBilling }: {
  done: number; booked: number; available: number;
  nextUp: any | null; needsReview: number;
  payments: ClientPayments | null;
  onOpenNext?: () => void;
  onOpenBilling?: () => void;
}) {
  const bill = payments ? billingStatusLine(payments, (c) => money(c, payments.currency), monthDay) : null;
  return (
    <div className="space-y-3 rounded-xl border border-border p-3 sm:p-4" data-sessions-overview>
      <dl className="grid grid-cols-3 text-center">
        {([["Completed", done], ["Booked", booked], ["Available", available]] as const).map(([label, value], i) => (
          <div key={label} className={cn("px-1", i > 0 && "border-l border-border")}>
            <dd className="text-2xl font-semibold tabular-nums">{value}</dd>
            <dt className="text-[13px] text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>
      {nextUp ? (
        <button
          type="button"
          onClick={onOpenNext}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-lg bg-muted/50 px-3 text-left"
          data-next-session
        >
          <span className="min-w-0 text-[14px]">
            <span className="text-muted-foreground">Next session </span>
            <span className="font-medium">{whenLabel(nextUp.session_date, String(nextUp.start_time).slice(0, 5))}</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </button>
      ) : (
        <p className="text-[13px] text-muted-foreground">Nothing booked yet.</p>
      )}
      {needsReview > 0 && (
        <p className="text-[13px] text-warning">
          {needsReview === 1 ? "1 past session is" : `${needsReview} past sessions are`} waiting on you (a change request kept it open). Tap it below to pick what happened.
        </p>
      )}
      {bill && (
        <button
          type="button"
          onClick={onOpenBilling}
          disabled={!onOpenBilling}
          className="flex min-h-10 w-full items-center gap-2 border-t border-border pt-2 text-left text-[13px]"
          data-billing-line={bill.tone}
        >
          <Wallet className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className={cn("min-w-0 flex-1", TONE_TEXT[bill.tone])}>{bill.text}</span>
          {onOpenBilling && <span className="flex shrink-0 items-center text-muted-foreground">Billing<ChevronRight className="h-4 w-4" /></span>}
        </button>
      )}
    </div>
  );
}

/* ---------------- The one next step ---------------- */

/** Only when there's something to do: renew once they've trained past it, book what's left, or sell a first package. */
function NextStep({ step, first, isAdmin, number, renderSession, renewPriceCents, onRenew, onBookAhead, onSell, unpriced }: {
  step: SessionsNextStep;
  first: string;
  isAdmin: boolean;
  number: number;
  renderSession: (s: PackageSessionRow) => ReactNode;
  renewPriceCents: number | null;
  onRenew: () => void;
  onBookAhead: () => void;
  onSell: () => void;
  unpriced: PackageSessionRow[];
}) {
  if (step.kind === "renew") {
    const n = step.next;
    return (
      <PendingPackage
        next={n}
        number={number}
        renderSession={renderSession}
        lead={
          <p className="text-[13px] text-muted-foreground">
            {n.done > 0
              ? `${first} trained ${plural(n.done)} past the last package, so these are on the next one. Renew to add it; nothing is charged now.`
              : `${plural(n.booked)} booked past the last package. They need the next package once the first is trained.`}
          </p>
        }
        actions={isAdmin ? (
          <>
            <Button className="h-11 w-full sm:w-auto" onClick={onRenew}>
              <Repeat className="mr-2 h-4 w-4" /> Renew: add the next {n.size}
            </Button>
            {n.open > 0 && (
              <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onBookAhead}>
                <CalendarRange className="mr-2 h-4 w-4" /> Book the {n.open} left
              </Button>
            )}
          </>
        ) : null}
      />
    );
  }

  let text: ReactNode = null;
  let action: ReactNode = null;
  let tone: "neutral" | "attention" = "neutral";
  switch (step.kind) {
    case "sell_unpriced":
      tone = "attention";
      text = `${plural(step.count)} trained or booked past what's paid for, and no package to renew. Sell ${first} a package and they move onto it.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onSell}><Ticket className="mr-2 h-4 w-4" /> Sell a package</Button>;
      break;
    case "book":
      text = `${plural(step.left)} available to book${step.packageNumber ? ` on package ${step.packageNumber}` : ""}.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onBookAhead}><CalendarRange className="mr-2 h-4 w-4" /> Book the {step.left} on {first}'s usual days</Button>;
      break;
    case "waiting_payment":
      text = `${step.name} starts once it's paid. Its sessions aren't available yet.`;
      break;
    case "renew_all_used":
      tone = "attention";
      text = `Every session is completed. Renew ${first}'s next ${step.size}${renewPriceCents ? ` (${money(renewPriceCents)})` : ""} to keep booking; nothing is charged now.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onRenew}><Repeat className="mr-2 h-4 w-4" /> Renew: add the next {step.size}</Button>;
      break;
    case "sell_first":
      text = `No session package yet. Sell ${first} one, or book a session and charge for it.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onSell}><Ticket className="mr-2 h-4 w-4" /> Sell a package</Button>;
      break;
    case "all_booked":
      // Nothing to do: the package card says it's all booked, and Renew is in its menu.
      return null;
  }
  if (!text) return null;
  return (
    <div className={cn("space-y-3 rounded-xl border p-3", tone === "attention" ? "border-warning/40" : "border-border")} data-next-step={step.kind}>
      <p className="text-[14px]">{text}</p>
      {step.kind === "sell_unpriced" && unpriced.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{unpriced.map(renderSession)}</ul>}
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/* ---------------- Packages ---------------- */

/** One cell per session: completed (solid), booked (grey), available (empty). */
export function SlotBar({ size, done, booked }: { size: number; done: number; booked: number }) {
  const cells = Math.max(size, done + booked, 1);
  return (
    <div
      role="img"
      aria-label={`${done} completed, ${booked} booked, ${Math.max(0, cells - done - booked)} available`}
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${Math.min(cells, 16)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={cn("h-2 rounded-full", i < done ? "bg-foreground" : i < done + booked ? "bg-foreground/35" : "bg-border")} />
      ))}
    </div>
  );
}

/** "7 completed · 9 booked · 0 available" */
export function countLine(p: { size: number; done: number; booked: number; open: number; expired?: number }, phase?: PackageView["phase"]): string {
  if (phase === "waiting") return `${p.size} sessions · available once it's paid`;
  const parts = [`${p.done} completed`, `${p.booked} booked`, `${p.open} available`];
  if (p.expired) parts.push(`${p.expired} expired`);
  return parts.join(" · ");
}

/** The package's period: its own term, else when its sessions ran. */
const periodOf = (p: PackageView) => dayRange(p.termFrom ?? p.from, p.termTo ?? p.to);

/** The package they're on now, compact: what it is, where it's at, the next session, and its sessions one tap away. */
function CurrentPackage({ p, today, isAdmin, canRenew, renderSession, overviewNextId, onRenew, onBookAhead, onAdjust, onEditDates, onOpenBilling }: {
  p: PackageView;
  today: string;
  isAdmin: boolean;
  canRenew: boolean;
  renderSession: (s: PackageSessionRow) => ReactNode;
  /** The next session the overview already shows (never said twice). */
  overviewNextId?: string | null;
  onRenew: () => void;
  onBookAhead: () => void;
  onAdjust?: () => void;
  onEditDates?: (saleId: string) => void;
  onOpenBilling?: () => void;
}) {
  const [open, setOpen] = useState(false);
  const next = p.sessions.find((s) => s.status === "Scheduled" && s.session_date >= today) ?? null;
  const lastBooked = [...p.sessions].reverse().find((s) => s.status === "Scheduled")?.session_date ?? null;
  const period = periodOf(p);
  return (
    <section className="space-y-3 rounded-xl border border-border p-3 sm:p-4" aria-label="Current package" data-current-package={p.number}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[13px] text-muted-foreground">{p.phase === "finished" ? "Last package" : "Current package"} · Package {p.number}</div>
          <div className="line-clamp-2 text-[15px] font-semibold">{p.name}</div>
          {period && <div className="text-[13px] text-muted-foreground">{period}</div>}
        </div>
        {isAdmin && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="outline" size="sm" className="h-10 shrink-0 px-3">Manage<ChevronDown className="ml-1 h-4 w-4" /></Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              {p.open > 0 && <DropdownMenuItem onSelect={onBookAhead}><CalendarRange className="mr-2 h-4 w-4" />Book the {p.open} available</DropdownMenuItem>}
              {canRenew && <DropdownMenuItem onSelect={onRenew}><Repeat className="mr-2 h-4 w-4" />Renew: add the next {p.size}</DropdownMenuItem>}
              {onAdjust && <DropdownMenuItem onSelect={onAdjust}><SlidersHorizontal className="mr-2 h-4 w-4" />Add or remove sessions</DropdownMenuItem>}
              {onEditDates && <DropdownMenuItem onSelect={() => onEditDates(p.id)}><Pencil className="mr-2 h-4 w-4" />Edit its dates</DropdownMenuItem>}
              <DropdownMenuSeparator />
              {onOpenBilling && <DropdownMenuItem onSelect={onOpenBilling}><Wallet className="mr-2 h-4 w-4" />Payments on Billing</DropdownMenuItem>}
              <DropdownMenuItem asChild>
                <Link to="/admin/purchases/$id" params={{ id: p.id }}><ExternalLink className="mr-2 h-4 w-4" />Open the sale</Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="space-y-1.5">
        <div className="text-[14px] tabular-nums">{countLine(p, p.phase)}</div>
        <SlotBar size={p.size} done={p.done} booked={p.booked} />
      </div>

      {next && next.id !== overviewNextId ? (
        <p className="text-[13px] text-muted-foreground">
          Next session <span className="font-medium text-foreground">{whenLabel(next.session_date, String(next.start_time).slice(0, 5))}</span>
        </p>
      ) : p.phase === "active" && p.open === 0 && lastBooked ? (
        <p className="text-[13px] text-muted-foreground">Every session is booked, through {shortDay(lastBooked)}.</p>
      ) : null}
      {p.expiresAt && p.phase === "active" && p.open > 0 && (
        <p className={cn("text-[13px]", p.expiresAt < today ? "text-warning" : "text-muted-foreground")}>
          {p.expiresAt < today ? `Expired ${shortDay(p.expiresAt)}: its ${plural(p.open)} can't be booked` : `Use by ${shortDay(p.expiresAt)}`}
        </p>
      )}

      {p.sessions.length > 0 && (
        <div>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className="flex min-h-10 w-full items-center justify-between rounded-lg text-[14px] font-medium"
          >
            {open ? "Hide sessions" : `View sessions (${p.sessions.length})`}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
          {open && <ul className="mt-1 divide-y divide-border rounded-lg border border-border">{p.sessions.map(renderSession)}</ul>}
        </div>
      )}
    </section>
  );
}

/** An earlier (or waiting) package, one line until it's opened. */
function PackageRow({ p, renderSession }: { p: PackageView; renderSession: (s: PackageSessionRow) => ReactNode }) {
  const [open, setOpen] = useState(false);
  const period = periodOf(p);
  const summary = p.phase === "waiting"
    ? `${p.size} sessions · available once it's paid`
    : `${p.done} of ${p.size} completed${p.expired ? ` · ${p.expired} expired` : ""}${p.booked ? ` · ${p.booked} booked` : ""}`;
  return (
    <div className="overflow-hidden rounded-xl border border-border" data-package={p.number}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-14 w-full items-center gap-3 px-3 py-2 text-left">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium">Package {p.number}{period ? <span className="font-normal text-muted-foreground"> · {period}</span> : null}</div>
          <div className="text-[13px] text-muted-foreground">{summary}</div>
        </div>
        <ChevronDown className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180")} />
      </button>
      {open && (
        <div className="space-y-2 border-t border-border px-3 pb-3 pt-2">
          <div className="text-[13px] text-muted-foreground">{p.name}</div>
          {p.sessions.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">{p.sessions.map(renderSession)}</ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">No sessions on it.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** The next package before it's added: the sessions already on it. */
function PendingPackage({ next, number, renderSession, lead, actions }: {
  next: NextPackage;
  number: number;
  renderSession: (s: PackageSessionRow) => ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const when = dayRange(next.sessions[0]?.session_date ?? null, next.sessions[next.sessions.length - 1]?.session_date ?? null);
  return (
    <section className={cn("space-y-3 rounded-xl border border-dashed p-3", next.owed ? "border-warning/60" : "border-border")} data-package-next={number}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[15px] font-semibold">Package {number} · next {next.size}</div>
          <div className="text-[13px] text-muted-foreground">{when ? `${when} · ` : ""}not added yet</div>
        </div>
        <StatusChip tone={next.owed ? "attention" : "neutral"}>{next.owed ? "Needs renewing" : "Not added yet"}</StatusChip>
      </div>
      <div className="space-y-1.5">
        <div className="text-[14px] tabular-nums">{countLine(next)}</div>
        <SlotBar size={next.size} done={next.done} booked={next.booked} />
      </div>
      {lead}
      {next.sessions.length > 0 && (
        <div>
          <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-10 w-full items-center justify-between text-[14px] font-medium">
            {open ? "Hide sessions" : `View sessions (${next.sessions.length})`}
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", open && "rotate-180")} />
          </button>
          {open && <ul className="mt-1 divide-y divide-border rounded-lg border border-border">{next.sessions.map(renderSession)}</ul>}
        </div>
      )}
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </section>
  );
}

/** A folded section: a title row that opens in place. */
function Folder({ title, summary, children, ...rest }: { title: string; summary?: string; children: ReactNode } & Record<`data-${string}`, unknown>) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-xl border border-border" {...rest}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left">
        <span className="text-[15px] font-medium">{title}</span>
        <span className="flex items-center gap-1 text-[13px] text-muted-foreground">
          {summary}
          <ChevronDown className={cn("h-4 w-4 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && <div className="space-y-2 border-t border-border p-3">{children}</div>}
    </section>
  );
}

/* ---------------- Sessions ---------------- */

function SessionRow({ s, today, coachNote, clientFirst, onOpen }: {
  s: any;
  today: string;
  coachNote?: string | null;
  clientFirst: string;
  onOpen: () => void;
}) {
  const past = s.session_date < today;
  const waiting = s.status === "Scheduled" && past;
  const isNext = s.status === "Scheduled" && !past;
  return (
    <li>
      {/* Whole row is the button: one tap opens labelled actions (Reschedule, bank it, count it). */}
      <button type="button" onClick={onOpen} className="flex min-h-12 w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-muted/40">
        <div className="min-w-0 flex-1">
          <div className="text-[14px] font-medium tabular-nums">
            {shortDay(s.session_date)} · {fmtWallClock(String(s.start_time).slice(0, 5))}
          </div>
          {coachNote && (
            <div className="mt-0.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-200" data-coach-note>
              <StickyNote className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">{coachNote}</span>
            </div>
          )}
          {/* The note on the session itself is the client's to read: said so, so it's never mistaken for a private one. */}
          {s.notes?.trim() && s.client_visible_notes !== false && (
            <div className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground" data-client-note>
              <MessageSquare className="mt-0.5 h-3 w-3 shrink-0" />
              <span className="line-clamp-2">To {clientFirst}: {s.notes.trim()}</span>
            </div>
          )}
        </div>
        {waiting ? (
          <StatusChip tone="attention">Pick what happened</StatusChip>
        ) : s.status === "Completed" ? (
          <span className="flex shrink-0 items-center gap-1 text-[13px] text-muted-foreground"><Check className="h-4 w-4 text-success" /> Done</span>
        ) : s.status === "Missed" ? (
          <StatusChip tone="attention">Missed · counted</StatusChip>
        ) : isNext ? (
          <StatusChip>Booked</StatusChip>
        ) : (
          <StatusChip>{s.uses_credit === false ? `${sessionStatusLabel(s.status)} · no session used` : sessionStatusLabel(s.status)}</StatusChip>
        )}
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </li>
  );
}

function OtherSessions({ free, others, manual, renderSession }: {
  free: PackageSessionRow[];
  others: any[];
  manual: PackageLedgerEvent[];
  renderSession: (s: PackageSessionRow) => ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const cancelled = others.filter((s) => s.status === "Cancelled" || s.status === "Rescheduled").length;
  const summary = [
    cancelled ? `${cancelled} cancelled` : "",
    others.length - cancelled ? `${others.length - cancelled} not counted` : "",
    free.length ? `${free.length} free` : "",
    !free.length && !others.length ? "changes by hand" : "",
  ].filter(Boolean).join(" · ");
  return (
    <section className="rounded-xl border border-border">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex min-h-12 w-full items-center justify-between gap-3 px-3 text-left">
        <span className="whitespace-nowrap text-[15px] font-medium">Not on a package</span>
        <span className="flex min-w-0 items-center gap-1 text-[13px] text-muted-foreground">
          <span className="truncate">{summary}</span>
          <ChevronDown className={cn("h-4 w-4 shrink-0 transition-transform", open && "rotate-180")} />
        </span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-border p-3">
          {free.length > 0 && (
            <div className="space-y-1">
              <div className="text-[13px] text-muted-foreground">Free sessions (given, not sold)</div>
              <ul className="divide-y divide-border rounded-lg border border-border">{free.map(renderSession)}</ul>
            </div>
          )}
          {others.length > 0 && (
            <div className="space-y-1">
              <div className="text-[13px] text-muted-foreground">Cancelled, moved, or a kind that doesn't use a session</div>
              <ul className="divide-y divide-border rounded-lg border border-border">{others.map((s) => renderSession(s))}</ul>
            </div>
          )}
          {manual.length > 0 && (
            <div className="space-y-1">
              <div className="text-[13px] text-muted-foreground">Sessions added or removed by hand</div>
              <ul className="space-y-1">
                {manual.map((e) => (
                  <li key={e.id} className="flex items-start justify-between gap-2 text-[13px]">
                    <span className="min-w-0 truncate">
                      {sessionEventLabel(e.event_type, e.source)}
                      {(e as any).note ? ` · ${(e as any).note}` : ""}
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{Number(e.session_count) > 0 ? `+${e.session_count}` : e.session_count}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/* ---------------- Renew ---------------- */

/**
 * Renewing adds the client's next package (a copy of their latest: same
 * sessions, price and plan), nothing charged. Sessions left on the package
 * they're on stay there and are booked first; sessions already trained or
 * booked past it move onto the new one. Only one untouched package at a time
 * (renew_session_package refuses a second).
 */
function RenewDialog({ open, onOpenChange, first, name, size, priceCents, payments, next, leftNow, autoPay, bookAfter, onBookAfter, pending, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  first: string;
  name: string;
  size: number;
  priceCents: number;
  payments: number;
  next: NextPackage | null;
  leftNow: number;
  autoPay: AutoPayStatus | null;
  bookAfter: boolean;
  onBookAfter: (v: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const moving = next ? next.sessions.length : 0;
  const toBook = next ? next.open : size;
  const howPaid = autoPay?.state === "on"
    ? `Auto-pay (${money(autoPay.cents)}${autoPay.per ? ` every ${autoPay.per}` : ""}) pays it after what's owed before it.`
    : `It shows on Billing with no payment dates until you set them, send a link or record a payment.`;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Add {first}'s next {size}?</DialogTitle>
          <DialogDescription>Nothing is charged now.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-[14px]">
          <li className="rounded-lg border border-border p-3">
            <div className="font-medium">{size} sessions · {money(priceCents)} + tax</div>
            <div className="text-[13px] text-muted-foreground">
              {name}{payments > 1 ? `, in ${payments} payments of ${money(Math.round(priceCents / payments))} + tax like the last one` : ""}.
            </div>
          </li>
          <li className="text-[13px] text-muted-foreground">{howPaid}</li>
          {moving > 0 && (
            <li className="text-[13px] text-muted-foreground">
              The {plural(moving)} since {shortDay(next!.sessions[0].session_date)} move onto it, leaving {toBook} to book.
            </li>
          )}
          {!next && leftNow > 0 && (
            <li className="text-[13px] text-muted-foreground">The {plural(leftNow)} {first} still has stay on their package and are booked first.</li>
          )}
        </ul>
        {toBook > 0 && (
          <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg border border-border px-3">
            <Checkbox checked={bookAfter} onCheckedChange={(v) => onBookAfter(v === true)} />
            <span className="text-[14px]">Then book the {toBook} on {first}'s usual days</span>
          </label>
        )}
        <DialogFooter className="gap-2">
          <Button variant="outline" className="h-11" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button className="h-11" disabled={pending} onClick={onConfirm}>{pending ? "Adding…" : `Add the next ${size}`}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ---------------- Settings ---------------- */

function SessionSettings({ client, onChangeField }: { client: any; onChangeField?: (field: string, value: any) => void }) {
  return (
    <Card className={`${WORKSPACE_FULL_SPAN_CLASS} space-y-3 overflow-hidden border-border bg-card p-4 md:p-6`}>
      <CardHeader icon={Settings2} title="Session settings" />
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
          <Input value={client?.default_session_location ?? ""} onChange={(e) => onChangeField?.("default_session_location", e.target.value)} placeholder="800 Vaughan Ave" />
        </div>
      </div>
      <p className="text-[12px] text-muted-foreground">
        Clients get one text at 6 PM the evening before each session, in this time zone. Save at the top of the page to apply.
      </p>
    </Card>
  );
}

/* ---------------- Adjust ---------------- */

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
      toast.success(`${d > 0 ? "Added" : "Removed"} ${plural(Math.abs(d))}`);
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
        <DialogHeader>
          <DialogTitle>Add or remove sessions</DialogTitle>
          <DialogDescription>For a free session or a correction. To sell sessions, renew or sell a package instead.</DialogDescription>
        </DialogHeader>
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
          <Button onClick={submit} disabled={saving} className="h-11 w-full sm:w-auto">{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
