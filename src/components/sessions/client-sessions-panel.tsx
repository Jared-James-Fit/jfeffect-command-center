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
  CalendarDays, CalendarPlus, CalendarRange, Check, CheckCircle2, ChevronDown, ChevronRight, MessageSquare, Plus, Repeat,
  Settings2, SlidersHorizontal, StickyNote, Ticket,
} from "lucide-react";
import { GoogleImportDialog } from "@/components/sessions/google-import-dialog";
import { PrebookDialog } from "@/components/sessions/prebook-dialog";
import { PtSessionDialog } from "@/components/pt-session-dialog";
import { SellSessionsDialog } from "@/components/sell-sessions-dialog";
import { CardHeader, MoreButton, StatusChip, type ChipTone } from "@/components/nutrition/nutrition-ui";
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
import {
  buildSessionPackages,
  dayRange,
  packagePayLine,
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
 * A client's Sessions tab: what they owe and have paid, how many are done,
 * booked and left, the one thing to do next, and their packages, each with the
 * very sessions on it (Marc's next 16 shows the 5 he's already trained or
 * booked on it before it's even added). Renewing adds the next package as owed,
 * nothing charged now; Book ahead fills it on their usual days.
 *
 * One term everywhere: SESSIONS (never "credits").
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
  const [prebookOpen, setPrebookOpen] = useState(false);
  const [renewOpen, setRenewOpen] = useState(false);
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

  // Every column the money reading needs (its own key: other screens load a few columns under ["pt-pack-purchases", id]).
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
      toast.success(`${first}'s next ${pkg?.size} added`, { description: "It's owed on Billing until it's paid. Nothing was charged." });
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
      <DropdownMenuContent align="end" className="w-60">
        <DropdownMenuItem onSelect={() => setPrebookOpen(true)}><CalendarRange className="mr-2 h-4 w-4" />Book ahead on their usual days</DropdownMenuItem>
        {pkg && <DropdownMenuItem onSelect={() => setRenewOpen(true)}><Repeat className="mr-2 h-4 w-4" />Renew: next {pkg.size} · pay later</DropdownMenuItem>}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => setAddOpen(true)}><Ticket className="mr-2 h-4 w-4" />Sell a new package</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setAdjustOpen(true)}><SlidersHorizontal className="mr-2 h-4 w-4" />Add or remove sessions</DropdownMenuItem>
        <DropdownMenuItem onSelect={() => setImportOpen(true)}><CalendarPlus className="mr-2 h-4 w-4" />Bring in from Google Calendar</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  ) : null;

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

        <SessionsTrackerBody
          model={model}
          sessions={sessions}
          today={today}
          coachNotes={coachNotes}
          first={first}
          isAdmin={isAdmin}
          renewSize={pkg?.size ?? null}
          renewEachCents={renewEachCents}
          manual={manual}
          onRenew={() => setRenewOpen(true)}
          onBookAhead={() => setPrebookOpen(true)}
          onSell={() => setAddOpen(true)}
          onOpenSession={setActing}
        />
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
 * Everything under the Sessions header: the summary, the one next step, the
 * packages with their sessions, and what isn't on a package. Pure view over the
 * package model (session-packages.ts), so it can be checked with fixture data.
 */
export function SessionsTrackerBody({
  model, sessions, today, coachNotes, first, isAdmin, renewSize, renewEachCents, manual,
  onRenew, onBookAhead, onSell, onOpenSession,
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
  manual: PackageLedgerEvent[];
  onRenew: () => void;
  onBookAhead: () => void;
  onSell: () => void;
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
  const [showEarlier, setShowEarlier] = useState(false);
  const current = model.packages.find((p) => p.id === model.currentId) ?? null;
  // Newest first; past the latest two, packages that are trained and paid in full fold away.
  const settled = (p: PackageView, i: number) => i >= 2 && p.phase === "finished" && p.money.state === "paid";
  const shown = showEarlier ? model.packages : model.packages.filter((p, i) => !settled(p, i));
  const folded = model.packages.filter(settled).length;

  const openSession = (s: PackageSessionRow) => onOpenSession(sessionById.get(s.id) ?? s);
  const sessionRow = (s: PackageSessionRow) => {
    const full = sessionById.get(s.id) ?? s;
    return <SessionRow key={s.id} s={full} today={today} coachNote={coachNotes?.get(s.id)} clientFirst={first} onOpen={() => openSession(s)} />;
  };

  return (
    <>
      <Summary
        owedCents={model.totals.owedCents}
        paidCents={model.totals.paidCents}
        taxIncluded={model.totals.taxIncluded}
        done={model.totals.done}
        booked={upcoming.length + needsReview.length}
        left={model.totals.leftToBook}
        nextUp={upcoming[0] ?? null}
        needsReview={needsReview.length}
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

      {model.packages.length > 0 && (
        <section className="space-y-2" aria-label="Packages">
          <h4 className="text-[15px] font-semibold">Packages</h4>
          {model.next.slice(1).map((n, i) => (
            <PendingPackage key={`next-${i}`} next={n} number={lastNumber + 2 + i} renderSession={sessionRow} />
          ))}
          {shown.map((p) => (
            <PackageCard key={p.id} p={p} current={p.id === current?.id} renderSession={sessionRow} />
          ))}
          {folded > 0 && (
            <button
              type="button"
              onClick={() => setShowEarlier((v) => !v)}
              className="flex min-h-10 w-full items-center justify-center gap-1 rounded-lg text-[13px] text-muted-foreground hover:bg-muted/40"
            >
              {showEarlier ? "Hide earlier packages" : `Earlier packages (${folded}) · paid in full`}
              <ChevronDown className={cn("h-4 w-4 transition-transform", showEarlier && "rotate-180")} />
            </button>
          )}
        </section>
      )}

      {(model.free.length > 0 || others.length > 0 || manual.length > 0) && (
        <OtherSessions free={model.free} others={others} manual={manual} renderSession={(s) => sessionRow(s)} />
      )}
    </>
  );
}

/* ---------------- Summary ---------------- */

function Summary({ owedCents, paidCents, taxIncluded, done, booked, left, nextUp, needsReview }: {
  owedCents: number; paidCents: number; taxIncluded: boolean;
  done: number; booked: number; left: number;
  nextUp: any | null; needsReview: number;
}) {
  return (
    <div className="space-y-3 rounded-xl border border-border p-3 sm:p-4" data-sessions-summary>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {owedCents > 0 ? (
            <>
              <div className="text-[13px] text-muted-foreground">Owes on sessions</div>
              <div className="text-2xl font-semibold tabular-nums text-warning">{money(owedCents)}</div>
              <div className="text-[12px] text-muted-foreground">{taxIncluded ? "Tax included" : "Before tax"}</div>
            </>
          ) : (
            <div className="flex items-center gap-1.5 py-1 text-xl font-semibold text-success">
              <CheckCircle2 className="h-5 w-5" /> Paid up
            </div>
          )}
        </div>
        <div className="shrink-0 text-right">
          <div className="text-[13px] text-muted-foreground">Paid so far</div>
          <div className="text-[15px] font-semibold tabular-nums">{money(paidCents)}</div>
        </div>
      </div>
      <dl className="grid grid-cols-3 overflow-hidden rounded-lg border border-border text-center">
        {([["Done", done], ["Booked", booked], ["Left to book", left]] as const).map(([label, value], i) => (
          <div key={label} className={cn("px-2 py-2", i > 0 && "border-l border-border")}>
            <dd className="text-lg font-semibold tabular-nums">{value}</dd>
            <dt className="text-[12px] text-muted-foreground">{label}</dt>
          </div>
        ))}
      </dl>
      {nextUp && (
        <p className="text-[13px] text-muted-foreground">
          Next session <span className="font-medium text-foreground">{whenLabel(nextUp.session_date, String(nextUp.start_time).slice(0, 5))}</span>
        </p>
      )}
      {needsReview > 0 && (
        <p className="text-[13px] text-warning">
          {needsReview === 1 ? "1 past session is" : `${needsReview} past sessions are`} waiting on you (a change request kept it open). Tap it below to pick what happened.
        </p>
      )}
    </div>
  );
}

/* ---------------- The one next step ---------------- */

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
              ? `${first} trained ${n.done} past the last package, so the next ${n.size} has started. Renew to bill it: nothing is charged now.`
              : `${plural(n.booked)} booked past the last package go on the next ${n.size}, owed once the first is trained.`}
          </p>
        }
        actions={isAdmin ? (
          <>
            <Button className="h-11 w-full sm:w-auto" onClick={onRenew}>
              <Repeat className="mr-2 h-4 w-4" /> Renew {n.size} · pay later
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

  let text: ReactNode;
  let action: ReactNode = null;
  let tone: "neutral" | "attention" = "neutral";
  switch (step.kind) {
    case "sell_unpriced":
      tone = "attention";
      text = `${plural(step.count)} trained or booked past what's paid for, and no package to renew. Sell ${first} a package and they move onto it.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onSell}><Ticket className="mr-2 h-4 w-4" /> Sell a package</Button>;
      break;
    case "book":
      text = `${plural(step.left)} left to book${step.packageNumber ? ` on package ${step.packageNumber}` : ""}. Book them on ${first}'s usual days in one go.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onBookAhead}><CalendarRange className="mr-2 h-4 w-4" /> Book the {step.left} left</Button>;
      break;
    case "all_booked":
      text = `Every session on the package is booked${step.through ? `, through ${shortDay(step.through)}` : ""}.`;
      action = isAdmin && step.canRenew && (
        <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onRenew}><Repeat className="mr-2 h-4 w-4" /> Renew early · pay later</Button>
      );
      break;
    case "waiting_payment":
      text = `${step.name} starts once it's paid. Its sessions aren't on the books yet.`;
      break;
    case "renew_all_used":
      tone = "attention";
      text = `Every session is trained. Renew ${first}'s next ${step.size}${renewPriceCents ? ` (${money(renewPriceCents)})` : ""} and book them ahead; nothing is charged now.`;
      action = isAdmin && (
        <>
          <Button className="h-11 w-full sm:w-auto" onClick={onRenew}><Repeat className="mr-2 h-4 w-4" /> Renew {step.size} · pay later</Button>
          <Button variant="outline" className="h-11 w-full sm:w-auto" onClick={onBookAhead}><CalendarRange className="mr-2 h-4 w-4" /> Book ahead</Button>
        </>
      );
      break;
    case "sell_first":
      text = `No session package yet. Sell ${first} one, or book a session and charge for it.`;
      action = isAdmin && <Button className="h-11 w-full sm:w-auto" onClick={onSell}><Ticket className="mr-2 h-4 w-4" /> Sell a package</Button>;
      break;
  }
  return (
    <div className={cn("space-y-3 rounded-xl border p-3", tone === "attention" ? "border-warning/40" : "border-border")} data-next-step={step.kind}>
      <p className="text-[14px]">{text}</p>
      {step.kind === "sell_unpriced" && unpriced.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{unpriced.map(renderSession)}</ul>}
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

/* ---------------- Packages ---------------- */

/** One cell per session: done (solid), booked (grey), still to book (empty). */
export function SlotBar({ size, done, booked }: { size: number; done: number; booked: number }) {
  const cells = Math.max(size, done + booked, 1);
  return (
    <div
      role="img"
      aria-label={`${done} done, ${booked} booked, ${Math.max(0, cells - done - booked)} to book`}
      className="grid gap-[3px]"
      style={{ gridTemplateColumns: `repeat(${Math.min(cells, 16)}, minmax(0, 1fr))` }}
    >
      {Array.from({ length: cells }, (_, i) => (
        <span key={i} className={cn("h-2 rounded-full", i < done ? "bg-foreground" : i < done + booked ? "bg-foreground/35" : "bg-border")} />
      ))}
    </div>
  );
}

function countLine(p: { size: number; done: number; booked: number; open: number }, phase?: PackageView["phase"]): string {
  if (phase === "waiting") return `${p.size} sessions · start once it's paid`;
  if (phase === "finished" || (p.open === 0 && p.booked === 0)) return `${p.done} of ${p.size} done`;
  const parts = [`${p.done} done`];
  if (p.booked) parts.push(`${p.booked} booked`);
  if (p.open) parts.push(`${p.open} to book`);
  return parts.join(" · ");
}

function PackageCard({ p, current, renderSession }: { p: PackageView; current: boolean; renderSession: (s: PackageSessionRow) => ReactNode }) {
  const [open, setOpen] = useState(current);
  const pay = packagePayLine(p.money, (c) => money(c, p.money.currency));
  const when = dayRange(p.from, p.to);
  const plan = p.money.plan;
  return (
    <div className="overflow-hidden rounded-xl border border-border" data-package={p.number}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full space-y-1.5 p-3 text-left transition-colors hover:bg-muted/30">
        <div className="flex items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <span className="whitespace-nowrap text-[15px] font-semibold">Package {p.number}</span>
            {current && <span className="rounded-full bg-foreground px-2 py-0.5 text-[11px] font-medium text-background">Now</span>}
          </div>
          {pay.text && <StatusChip tone={pay.tone as ChipTone}>{pay.text}</StatusChip>}
        </div>
        <div className="text-[13px] text-muted-foreground">
          {when ? `${when} · ` : ""}{countLine(p, p.phase)}
        </div>
        <SlotBar size={p.size} done={p.done} booked={p.booked} />
      </button>
      {open && (
        <div className="space-y-3 border-t border-border px-3 pb-3 pt-2">
          <div className="space-y-0.5 text-[13px] text-muted-foreground">
            <div className="font-medium text-foreground">{p.name}</div>
            {p.money.priceNote && <div>{p.money.state === "paid" ? `${money(p.money.priceCents)} (${p.money.priceNote})` : `${p.money.priceNote}${plan ? ` · ${plan.total} payments` : ""}`}</div>}
            {plan && (
              <div>
                {plan.made} of {plan.total} payments made
                {p.money.next?.cents
                  ? p.money.next.date
                    ? ` · next ${money(p.money.next.cents)} on ${shortDay(p.money.next.date)}`
                    : ` · ${money(p.money.next.cents)} each`
                  : ""}
              </div>
            )}
            {p.expired > 0 && <div>{plural(p.expired)} expired unused</div>}
            {p.expiresAt && p.phase === "active" && <div>Use by {shortDay(p.expiresAt)}</div>}
            <Link to="/admin/purchases/$id" params={{ id: p.id }} className="inline-flex min-h-10 items-center gap-1 font-medium text-foreground hover:underline">
              Payments and receipts <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
          {p.sessions.length > 0 ? (
            <ul className="divide-y divide-border rounded-lg border border-border">{p.sessions.map(renderSession)}</ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">No sessions on it yet.</p>
          )}
        </div>
      )}
    </div>
  );
}

/** The next package before it's added: the sessions already on it, and its price. */
function PendingPackage({ next, number, renderSession, lead, actions }: {
  next: NextPackage;
  number: number;
  renderSession: (s: PackageSessionRow) => ReactNode;
  lead?: ReactNode;
  actions?: ReactNode;
}) {
  const [open, setOpen] = useState(true);
  const when = dayRange(next.sessions[0]?.session_date ?? null, next.sessions[next.sessions.length - 1]?.session_date ?? null);
  return (
    <div className={cn("overflow-hidden rounded-xl border border-dashed", next.owed ? "border-warning/60" : "border-border")} data-package-next={number}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="w-full space-y-1.5 p-3 text-left transition-colors hover:bg-muted/30">
        <div className="flex items-center justify-between gap-2">
          <span className="min-w-0 text-[15px] font-semibold">Package {number} · next {next.size}</span>
          <StatusChip tone={next.owed ? "attention" : "neutral"}>{next.owed ? `${money(next.eachCents)} owed` : "Not added yet"}</StatusChip>
        </div>
        <div className="text-[13px] text-muted-foreground">
          {when ? `${when} · ` : ""}{countLine(next)}{next.owed ? " · not added yet" : ""}
        </div>
        <SlotBar size={next.size} done={next.done} booked={next.booked} />
      </button>
      <div className="space-y-3 px-3 pb-3">
        {lead}
        {open && next.sessions.length > 0 && <ul className="divide-y divide-border rounded-lg border border-border">{next.sessions.map(renderSession)}</ul>}
        {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
      </div>
    </div>
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

function RenewDialog({ open, onOpenChange, first, name, size, priceCents, payments, next, leftNow, bookAfter, onBookAfter, pending, onConfirm }: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  first: string;
  name: string;
  size: number;
  priceCents: number;
  payments: number;
  next: NextPackage | null;
  leftNow: number;
  bookAfter: boolean;
  onBookAfter: (v: boolean) => void;
  pending: boolean;
  onConfirm: () => void;
}) {
  const moving = next ? next.sessions.length : 0;
  const toBook = next ? next.open : size;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] w-[calc(100vw-2rem)] max-w-md overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Renew {first}'s sessions?</DialogTitle>
          <DialogDescription>Adds the next package now, paid later.</DialogDescription>
        </DialogHeader>
        <ul className="space-y-2 text-[14px]">
          <li className="rounded-lg border border-border p-3">
            <div className="font-medium">{size} sessions · {money(priceCents)} + tax</div>
            <div className="text-[13px] text-muted-foreground">
              {name}{payments > 1 ? `, in ${payments} payments of ${money(Math.round(priceCents / payments))} + tax like the last one` : ""}.
            </div>
          </li>
          <li className="text-[13px] text-muted-foreground">Nothing is charged now. It shows as owed on Billing until {first} pays, and you can record a payment or send a link from there.</li>
          {moving > 0 && (
            <li className="text-[13px] text-muted-foreground">
              The {plural(moving)} since {shortDay(next!.sessions[0].session_date)} move onto it, leaving {toBook} to book.
            </li>
          )}
          {!next && leftNow > 0 && (
            <li className="text-[13px] text-muted-foreground">{first} still has {plural(leftNow)} left; new bookings use those first.</li>
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
          <Button className="h-11" disabled={pending} onClick={onConfirm}>{pending ? "Renewing…" : "Renew · pay later"}</Button>
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
