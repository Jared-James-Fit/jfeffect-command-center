/**
 * The top of a client's Billing tab: one number for what they owe, in the
 * dollars they actually pay, and each thing that makes it up in plain words,
 * including the renewal their training has started (a package renews in its
 * own size), one tap from being added.
 */
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, CalendarClock, AlertTriangle, Send, RefreshCw } from "lucide-react";
import type { BillingSummary, RenewalLine } from "@/lib/client-billing-summary";
import { formatMoney } from "@/lib/payment-display";

const money = (cents: number, currency: string) => formatMoney(cents / 100, currency);

function day(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(`${iso.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString("en-CA", { month: "short", day: "numeric", ...(sameYear ? {} : { year: "numeric" }) });
}

function range(from: string | null, to: string | null): string | null {
  const a = day(from);
  const b = day(to);
  if (a && b) return a === b ? a : `${a} – ${b}`;
  return a ?? b;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

function RenewalRow({ line, currency, onRenew, renewing }: {
  line: RenewalLine; currency: string; onRenew?: (fromSaleId: string) => void; renewing?: boolean;
}) {
  const due = line.count > 0;
  const covered = line.count * line.size;
  const open = covered - line.trained - line.bookedIn;
  const trainedWhen = range(line.trainedFrom, line.trainedTo);
  const afterWhen = range(line.bookedAfterFrom, line.bookedAfterTo);
  const what = line.count > 1 ? `${line.count} × ${line.size} sessions` : `${line.size} sessions`;
  return (
    <li className={`space-y-2 p-3 ${due ? "bg-warning/10" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-2.5">
          <RefreshCw className={`mt-0.5 h-4 w-4 shrink-0 ${due ? "text-warning" : "text-muted-foreground"}`} />
          <div className="min-w-0 space-y-0.5">
            <div className="text-sm font-medium">
              {due ? (line.count > 1 ? `${line.count} renewals due` : "Renewal due") : "Next renewal"}: {line.name}
            </div>
            {due ? (
              <>
                <div className="text-xs text-muted-foreground">
                  {plural(line.trained, "session")} trained past the last package{trainedWhen ? ` (${trainedWhen})` : ""} started the next {line.count > 1 ? `${line.count} packages` : line.size}.
                </div>
                <div className="text-xs text-muted-foreground">
                  {what}: <span className="font-medium text-foreground">{line.trained} trained</span>
                  {line.bookedIn > 0 && <> · {line.bookedIn} booked</>}
                  {open > 0 && <> · {open} not booked yet</>}
                  {" · "}{money(line.priceCents, currency)}{line.eachCents !== line.priceCents ? " + tax" : ""}{line.count > 1 ? " each" : ""}
                </div>
              </>
            ) : (
              <div className="text-xs text-muted-foreground">
                {plural(line.bookedAfter, "session")} booked past what's paid for{afterWhen ? ` (${afterWhen})` : ""}. The next {line.size} ({money(line.eachCents, currency)}) is due once the first is trained.
              </div>
            )}
            {due && line.bookedAfter > 0 && (
              <div className="text-xs text-muted-foreground">
                {line.bookedAfter} more booked after {line.count > 1 ? "them" : "it"}{afterWhen ? ` (${afterWhen})` : ""}: the renewal after this one.
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 text-sm font-semibold tabular-nums">{due ? money(line.totalCents, currency) : "—"}</div>
      </div>
      {onRenew && line.fromSaleId && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pl-[26px]">
          <Button size="sm" variant={due ? "default" : "outline"} className="h-9" disabled={renewing} onClick={() => onRenew(line.fromSaleId!)}>
            {renewing ? "Adding…" : "Add renewal"}
          </Button>
          <span className="text-xs text-muted-foreground">Adds it to Sales and moves these sessions onto it.</span>
        </div>
      )}
    </li>
  );
}

export function ClientBalanceCard({ summary, currency = "CAD", onRenew, renewing }: {
  summary: BillingSummary;
  currency?: string;
  /** Adds the renewal (copies the package with this id). */
  onRenew?: (fromSaleId: string) => void;
  renewing?: boolean;
}) {
  const owes = summary.owedCents > 0;
  const tax = summary.taxIncluded ? "Tax included" : "Before tax";
  const { bought, used, booked } = summary.sessions;
  const next = summary.next;

  return (
    <Card className="space-y-4 border-border bg-card p-4 md:col-span-3 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Balance</div>
          {owes ? (
            <div className="text-3xl font-black tabular-nums text-destructive">Owes {money(summary.owedCents, currency)}</div>
          ) : summary.waiting.length > 0 ? (
            <div className="text-3xl font-black text-foreground">Nothing owed yet</div>
          ) : (
            <div className="flex items-center gap-2 text-3xl font-black text-success">
              <CheckCircle2 className="h-7 w-7" /> All paid up
            </div>
          )}
          {owes && <div className="text-xs text-muted-foreground">{tax}</div>}
        </div>
        <dl className="flex flex-wrap gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Paid so far</dt>
            <dd className="font-semibold tabular-nums">{money(summary.paidCents, currency)}</dd>
          </div>
          {next && (
            <div>
              <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Next payment</dt>
              <dd className="font-semibold tabular-nums">
                {next.cents != null ? money(next.cents, currency) : "—"}
                <span className="block text-xs font-normal text-muted-foreground">{day(next.date)}</span>
              </dd>
            </div>
          )}
          {bought + used > 0 && (
            <div>
              <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Sessions</dt>
              <dd className="font-semibold tabular-nums">
                {used} trained · {bought} in packages
                {booked > 0 && <span className="block text-xs font-normal text-muted-foreground">{booked} booked ahead</span>}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {summary.lines.length + summary.waiting.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {summary.lines.map((line) =>
            line.kind === "sale" ? (
              <li key={line.id} className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 gap-2.5">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {range(line.from, line.to) && <>{range(line.from, line.to)} · </>}
                      {line.pastDue && <span className="font-medium text-destructive">Payment failed · </span>}
                      {line.paymentsTotal != null && line.paymentsMade != null && line.nextPaymentCents != null
                        ? <>
                            {line.paymentsMade} of {line.paymentsTotal} payments made
                            {" · next "}
                            <span className="font-medium text-foreground">
                              {money(line.nextPaymentCents, currency)}{day(line.nextDate) ? ` on ${day(line.nextDate)}` : ""}
                            </span>
                            {!day(line.nextDate) && ", no date set yet"}
                          </>
                        : "Left to pay on this sale"}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums">{money(line.leftCents, currency)}</div>
              </li>
            ) : line.kind === "renewal" ? (
              <RenewalRow key="renewal" line={line} currency={currency} onRenew={onRenew} renewing={renewing} />
            ) : (
              <li key="unbilled" className="flex items-start justify-between gap-3 bg-warning/10 p-3">
                <div className="flex min-w-0 gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-sm font-medium">{plural(line.sessions, "session")} trained past what's paid for</div>
                    <div className="text-xs text-muted-foreground">
                      {range(line.from, line.to) ? `${range(line.from, line.to)} · ` : ""}No priced package to renew
                    </div>
                    {line.booked > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {line.booked} more booked{range(line.bookedFrom, line.bookedTo) ? ` (${range(line.bookedFrom, line.bookedTo)})` : ""}, not covered yet.
                      </div>
                    )}
                    <div className="text-xs font-medium">Add a sale with sessions in Sales below. These sessions move onto it by themselves.</div>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums">{line.totalCents > 0 ? money(line.totalCents, currency) : "—"}</div>
              </li>
            ),
          )}
          {summary.waiting.map((w) => (
            <li key={w.id} className="flex items-start justify-between gap-3 p-3">
              <div className="flex min-w-0 gap-2.5">
                <Send className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0">
                  <div className="text-sm font-medium">{w.name}</div>
                  <div className="text-xs text-muted-foreground">
                    Payment requested{day(w.since) ? ` ${day(w.since)}` : ""}, nothing paid yet. Not counted as owed.
                  </div>
                </div>
              </div>
              <div className="shrink-0 text-sm font-semibold tabular-nums text-muted-foreground">{w.cents > 0 ? money(w.cents, currency) : "—"}</div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
