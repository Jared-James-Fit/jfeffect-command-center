/**
 * A client's packages at a glance: the one block the coach reads between
 * sessions. Two rows, each a few words and one bar:
 *
 *   Training   · Package 4 · 7 done · 9 booked · 0 left · next session
 *   Paying off · Package 3 · $0 of $672 paid · next payment, and how
 *
 * then what's left to pay against what's been trained but not paid for, and
 * anything overdue. The package being trained and the package being paid
 * are found separately (package-status.ts); the words come from one place
 * (package-view.ts), so the Summary, Sessions and Billing tabs never differ.
 * Nothing here changes anything.
 */
import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useClientPayments } from "@/components/billing/use-client-payments";
import { PaymentStatusText, SegmentBar, StatusText } from "@/components/billing/package-visuals";
import { formatMoney } from "@/lib/payment-display";
import { shortDay } from "@/lib/session-credit";
import { fmtWallClock } from "@/lib/schedule-time";
import { dueWords, packageGlance } from "@/lib/package-view";
import type { ClientPayments } from "@/lib/payment-schedule";
import { cn } from "@/lib/utils";

export type NextSession = { session_date: string; start_time: string } | null;

/** "Today at 3:30 PM", "Tomorrow at 10:30 AM", "Mon Nov 16 at 5:30 PM". */
export function sessionWhen(s: { session_date: string; start_time: string }, today: string): string {
  const d = String(s.session_date).slice(0, 10);
  const t = fmtWallClock(String(s.start_time).slice(0, 5));
  const tomorrow = new Date(`${today}T12:00:00Z`);
  tomorrow.setUTCDate(tomorrow.getUTCDate() + 1);
  const day = d === today ? "Today" : d === tomorrow.toISOString().slice(0, 10) ? "Tomorrow" : shortDay(d);
  return `${day} at ${t}`;
}

/** Loads what it needs (the shared payments read, and the next session unless it's given). */
export function ClientPackageSnapshot({ clientId, nextSession, onOpenSessions, onOpenBilling, hideWhenEmpty, money = true, className }: {
  clientId: string;
  /** The money line at its foot (outstanding, unpaid training, overdue); off where the page shows the money itself. */
  money?: boolean;
  /** The next booked session, when the caller already has it (undefined: read it here). */
  nextSession?: NextSession;
  onOpenSessions?: () => void;
  onOpenBilling?: () => void;
  /** No session package at all: show nothing (the Summary tab). */
  hideWhenEmpty?: boolean;
  className?: string;
}) {
  const { payments, today } = useClientPayments(clientId);
  const { data: fetchedNext } = useQuery({
    queryKey: ["pt-sessions", clientId, "next", today],
    enabled: nextSession === undefined,
    queryFn: async () => {
      const { data } = await supabase
        .from("pt_sessions")
        .select("session_date, start_time")
        .eq("client_id", clientId)
        .eq("status", "Scheduled")
        .gte("session_date", today)
        .order("session_date", { ascending: true })
        .order("start_time", { ascending: true })
        .limit(1);
      return ((data ?? [])[0] ?? null) as NextSession;
    },
  });
  if (!payments) {
    return hideWhenEmpty ? null : <div className={cn("h-40 animate-pulse rounded-2xl bg-muted", className)} aria-busy="true" />;
  }
  if (hideWhenEmpty && payments.packages.length === 0) return null;
  return (
    <PackageSnapshot
      p={payments}
      today={today}
      nextSession={nextSession === undefined ? fetchedNext ?? null : nextSession}
      onOpenSessions={onOpenSessions}
      onOpenBilling={onOpenBilling}
      showMoney={money}
      className={className}
    />
  );
}

/** The view itself: pure over the payments model, checked with fixture data. */
export function PackageSnapshot({ p, today, nextSession, onOpenSessions, onOpenBilling, showMoney = true, className }: {
  p: ClientPayments;
  showMoney?: boolean;
  today: string;
  nextSession: NextSession;
  onOpenSessions?: () => void;
  onOpenBilling?: () => void;
  className?: string;
}) {
  const money = (c: number) => formatMoney(c / 100, p.currency);
  const g = packageGlance(p);
  const t = g.training;
  const pay = g.paying;

  return (
    <section className={cn("overflow-hidden rounded-2xl border border-border bg-card", className)} aria-label="Packages at a glance" data-package-snapshot>
      <GlanceRow
        label="Training"
        onClick={onOpenSessions}
        right={
          t.kind === "package"
            ? t.fullyBooked
              ? <StatusText tone="neutral" data-training-status="fully_booked">Fully booked</StatusText>
              : !t.now ? <StatusText tone={t.status === "expired" ? "attention" : "done"} data-training-status={t.status}>{t.status === "expired" ? "Expired" : "Training completed"}</StatusText> : null
            : t.kind === "past" ? <StatusText tone="attention">Needs renewing</StatusText> : null
        }
        data-glance="training"
      >
        {t.kind === "package" ? (
          <>
            <TitleLine
              title={t.label}
              aside={<Counts parts={[[t.completed, "done"], [t.booked, "booked"], [t.available, "left"]]} />}
            />
            <SegmentBar
              parts={[{ value: t.completed, tone: "done" }, { value: t.booked, tone: "booked" }]}
              total={t.size}
              label={`${t.completed} completed, ${t.booked} booked, ${t.available} still to book`}
            />
            <Sub>
              {nextSession
                ? <>Next session <span className="text-foreground">{sessionWhen(nextSession, today)}</span></>
                : t.now ? "Nothing booked" : "Every session on it is done"}
            </Sub>
          </>
        ) : t.kind === "past" ? (
          <>
            <TitleLine title={`${t.trained} past ${t.afterLabel ?? "their package"}`} />
            <Sub>Trained past their last package. Renew to put them on the next one.</Sub>
          </>
        ) : (
          <Sub>No session package yet.</Sub>
        )}
      </GlanceRow>

      <div className="mx-3 h-px bg-border" />

      <GlanceRow
        label={pay.kind === "plan" ? "Paying off" : "Payments"}
        onClick={onOpenBilling}
        right={pay.kind === "plan" ? <PaymentStatusText status={pay.status} auto={pay.next.auto} /> : pay.kind === "unscheduled" ? <StatusText tone="attention">No payment dates</StatusText> : null}
        data-glance="paying"
      >
        {pay.kind === "plan" ? (
          <>
            <TitleLine
              title={pay.label}
              aside={<span className="text-[13px] tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{money(pay.paidCents)}</span> of {money(pay.totalCents)} paid</span>}
            />
            <SegmentBar parts={[{ value: pay.paidCents, tone: "done" }]} total={pay.totalCents} label={`${money(pay.paidCents)} of ${money(pay.totalCents)} paid`} />
            <Sub>
              Next payment <span className="font-semibold tabular-nums text-foreground">{money(pay.next.cents)}</span>{" "}
              <span className={cn(pay.next.state === "failed" || pay.next.state === "overdue" ? "text-destructive" : "text-foreground")}>{dueWords(pay.next, shortDay)}</span>
              {pay.next.auto ? " · auto-pay" : ""}
            </Sub>
            {(pay.then.length > 0 || pay.more > 0) && (
              <Sub>
                {pay.then.length > 0 ? `Then ${pay.then.join(", then ")}` : ""}
                {pay.then.length > 0 && pay.more > 0 ? " · " : ""}
                {pay.more > 0 ? `${pay.more} more payment plan${pay.more === 1 ? "" : "s"} running` : ""}
              </Sub>
            )}
          </>
        ) : pay.kind === "unscheduled" ? (
          <>
            <TitleLine title={pay.label} aside={<span className="text-[13px] tabular-nums"><span className="font-semibold">{money(pay.leftCents)}</span> left</span>} />
            <Sub>Nothing says when it's paid. Set dates or record a payment on Billing.</Sub>
          </>
        ) : pay.kind === "paid_up" ? (
          <>
            <TitleLine title="Paid up" />
            {pay.nextCharge ? <Sub>Next charge <span className="text-foreground">{money(pay.nextCharge.cents)} {dueWords(pay.nextCharge, shortDay)}</span></Sub> : null}
          </>
        ) : (
          <Sub>Nothing billed yet.</Sub>
        )}
      </GlanceRow>

      {showMoney && (p.outstandingCents > 0 || p.unpaidDeliveredCents > 0 || p.overdueCents > 0) && (
        <dl className="grid grid-cols-3 divide-x divide-border border-t border-border" data-glance-money>
          <MoneyCell label="Outstanding" value={money(p.outstandingCents)} onClick={onOpenBilling} data-glance-outstanding={p.outstandingCents} />
          <MoneyCell label="Unpaid training" value={money(p.unpaidDeliveredCents)} dot={p.unpaidDeliveredCents > 0} onClick={onOpenBilling} data-glance-unpaid={p.unpaidDeliveredCents} />
          <MoneyCell label="Overdue" value={money(p.overdueCents)} tone={p.overdueCents > 0 ? "error" : "muted"} onClick={onOpenBilling} data-glance-overdue={p.overdueCents} />
        </dl>
      )}
    </section>
  );
}

function GlanceRow({ label, right, onClick, children, ...rest }: {
  label: string;
  right?: ReactNode;
  onClick?: () => void;
  children: ReactNode;
} & Record<`data-${string}`, unknown>) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">{label}</span>
        <span className="flex min-w-0 items-center gap-1">
          {right}
          {onClick && <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />}
        </span>
      </div>
      {children}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="block w-full space-y-1.5 px-3 py-3 text-left transition-colors hover:bg-muted/40" {...rest}>
      {body}
    </button>
  ) : (
    <div className="space-y-1.5 px-3 py-3" {...rest}>{body}</div>
  );
}

function TitleLine({ title, aside }: { title: string; aside?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3">
      <span className="text-[17px] font-semibold leading-tight">{title}</span>
      {aside}
    </div>
  );
}

function Counts({ parts }: { parts: Array<[number, string]> }) {
  return (
    <span className="text-[13px] tabular-nums text-muted-foreground" data-counts>
      {parts.map(([n, w], i) => (
        <span key={w}>{i > 0 ? " · " : ""}<span className="font-semibold text-foreground">{n}</span> {w}</span>
      ))}
    </span>
  );
}

const Sub = ({ children }: { children: ReactNode }) => <div className="text-[13px] leading-snug text-muted-foreground">{children}</div>;

function MoneyCell({ label, value, tone, dot, onClick, ...rest }: {
  label: string;
  value: string;
  tone?: "error" | "muted";
  dot?: boolean;
  onClick?: () => void;
} & Record<`data-${string}`, unknown>) {
  // The label comes first for readers; the number shows on top (flex-col-reverse), so the three line up.
  const inner = (
    <>
      <dt className="flex items-center gap-1 text-[12px] leading-tight text-muted-foreground">
        {dot && <span aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" />}
        {label}
      </dt>
      <dd className={cn("text-[15px] font-semibold tabular-nums", tone === "error" && "text-destructive", tone === "muted" && "text-muted-foreground")}>{value}</dd>
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className="flex min-w-0 flex-col-reverse justify-end px-3 py-2.5 text-left hover:bg-muted/40" {...rest}>{inner}</button>
  ) : (
    <div className="flex min-w-0 flex-col-reverse justify-end px-3 py-2.5" {...rest}>{inner}</div>
  );
}
