/**
 * The top of a client's Purchases tab: one number for what they owe, in the
 * dollars they actually pay, and each thing that makes it up in plain words.
 */
import { Card } from "@/components/ui/card";
import { CheckCircle2, CalendarClock, AlertTriangle } from "lucide-react";
import type { BillingSummary } from "@/lib/client-billing-summary";
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

export function ClientBalanceCard({ summary, currency = "CAD" }: { summary: BillingSummary; currency?: string }) {
  const owes = summary.owedCents > 0;
  const tax = summary.taxIncluded ? "Tax included" : "Before tax";
  const { bought, used, booked } = summary.sessions;

  return (
    <Card className="space-y-4 border-border bg-card p-4 md:col-span-3 md:p-6">
      <div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
        <div className="min-w-0">
          <div className="text-xs uppercase tracking-widest text-muted-foreground">Balance</div>
          {owes ? (
            <div className="text-3xl font-black tabular-nums text-destructive">Owes {money(summary.owedCents, currency)}</div>
          ) : (
            <div className="flex items-center gap-2 text-3xl font-black text-success">
              <CheckCircle2 className="h-7 w-7" /> All paid up
            </div>
          )}
          {owes && <div className="text-xs text-muted-foreground">{tax}</div>}
        </div>
        <dl className="flex gap-6 text-sm">
          <div>
            <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Paid so far</dt>
            <dd className="font-semibold tabular-nums">{money(summary.paidCents, currency)}</dd>
          </div>
          {bought + used > 0 && (
            <div>
              <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">Sessions</dt>
              <dd className="font-semibold tabular-nums">
                {used} trained · {bought} paid for
                {booked > 0 && <span className="block text-xs font-normal text-muted-foreground">{booked} booked ahead</span>}
              </dd>
            </div>
          )}
        </dl>
      </div>

      {summary.lines.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border">
          {summary.lines.map((line) =>
            line.kind === "sale" ? (
              <li key={line.id} className="flex items-start justify-between gap-3 p-3">
                <div className="flex min-w-0 gap-2.5">
                  <CalendarClock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  <div className="min-w-0">
                    <div className="text-sm font-medium">{line.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {line.paymentsTotal != null && line.paymentsMade != null && line.nextPaymentCents != null
                        ? <>
                            {line.paymentsMade} of {line.paymentsTotal} payments made
                            {" · next "}
                            <span className="font-medium text-foreground">
                              {money(line.nextPaymentCents, currency)}{day(line.nextDate) ? ` on ${day(line.nextDate)}` : ""}
                            </span>
                          </>
                        : "Left to pay on this sale"}
                    </div>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums">{money(line.leftCents, currency)}</div>
              </li>
            ) : (
              <li key="unbilled" className="flex items-start justify-between gap-3 bg-warning/10 p-3">
                <div className="flex min-w-0 gap-2.5">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
                  <div className="min-w-0 space-y-0.5">
                    <div className="text-sm font-medium">{plural(line.sessions, "session")} trained, not billed yet</div>
                    <div className="text-xs text-muted-foreground">
                      {range(line.from, line.to) ? `${range(line.from, line.to)} · ` : ""}
                      {line.eachCents ? `${money(line.eachCents, currency)} each (package price)` : "No package price to go by"}
                    </div>
                    {line.booked > 0 && (
                      <div className="text-xs text-muted-foreground">
                        {line.booked} more booked{range(line.bookedFrom, line.bookedTo) ? ` (${range(line.bookedFrom, line.bookedTo)})` : ""}, not covered yet.
                      </div>
                    )}
                    <div className="text-xs font-medium">Add the next package in Sales below. These sessions move onto it by themselves.</div>
                  </div>
                </div>
                <div className="shrink-0 text-sm font-semibold tabular-nums">{line.totalCents > 0 ? money(line.totalCents, currency) : "—"}</div>
              </li>
            ),
          )}
        </ul>
      )}
    </Card>
  );
}
