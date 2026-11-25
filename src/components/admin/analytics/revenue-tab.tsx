/**
 * Revenue: what the business earns, read from billing (payments less refunds, before tax). The
 * period against the one before, monthly recurring revenue from live subscriptions, revenue per
 * paying client, what clients have paid over their lifetime (and a lifetime value only once enough
 * clients have ended to say how long one stays), revenue by package, and subscriptions that are
 * ending or failing. The books (Sales) stay the place for tax and the accountant.
 */
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, Definitions, IntelSection, RankRows, axisTick, monthLabel, tooltipStyle } from "@/components/admin/intel/intel-ui";
import { count, money, type RevenueView } from "@/lib/bi/model";
import { pctChange } from "@/lib/bi/period";
import { KpiCard } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

export function RevenueTab({ range }: TabProps) {
  const q = useBiTab<RevenueView>("revenue", range);
  const v = q.data;
  if (!v) return <div />;
  const m = v.mrr;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard label="Revenue" value={money(v.current.revenueCents, { whole: true })} delta={pctChange(v.current.revenueCents, v.previous.revenueCents)} sub={`${v.current.payments} payment${v.current.payments === 1 ? "" : "s"}${v.current.refundsCents ? ` · ${money(v.current.refundsCents, { whole: true })} refunded` : ""}`} info="Coaching payments less refunds, before tax, by the day the money moved" />
        <KpiCard label="Monthly recurring revenue" value={money(m.mrrCents, { whole: true })} sub={`${m.subscriptions} subscription${m.subscriptions === 1 ? "" : "s"} · ${money(m.collected30dCents, { whole: true })} collected in 30 days`} tone={m.failing ? "warn" : "neutral"} info="Live open-ended subscriptions' price before tax, per month" />
        <KpiCard label="Paying clients" value={count(v.current.payingClients)} delta={pctChange(v.current.payingClients, v.previous.payingClients)} sub={`${count(v.previous.payingClients)} the period before`} />
        <KpiCard label="Revenue per paying client" value={money(v.current.arppuCents, { whole: true })} delta={pctChange(v.current.arppuCents ?? 0, v.previous.arppuCents ?? 0)} sub="in this period" />
        <KpiCard
          label="Lifetime value"
          value={v.ltv.cents != null ? money(v.ltv.cents, { whole: true }) : "Not yet"}
          sub={v.ltv.cents != null ? `${money(v.ltv.monthlyArppuCents, { whole: true })} a month ÷ ${v.ltv.monthlyChurn}% monthly churn` : v.ltv.reason}
          info="Average monthly revenue per paying client ÷ monthly client churn (last full months)"
        />
        <KpiCard label="Paid per client, all time" value={money(v.lifetime.avgPerClientCents, { whole: true })} sub={`${v.lifetime.clients} paying clients ever · ${money(v.lifetime.paidCents, { whole: true })} in total${v.lifetime.firstPayment ? ` since ${v.lifetime.firstPayment}` : ""}`} />
        <KpiCard label="Paid per client who ended" value={v.lifetime.endedClients ? money(v.lifetime.endedAvgCents, { whole: true }) : "–"} sub={v.lifetime.endedClients ? `${v.lifetime.endedClients} ended · ${v.lifetime.endedMonths ?? 0} months paying on average` : "No paying client has ended"} />
        <KpiCard label="Subscriptions at risk" value={count(m.failing + m.ending)} tone={m.failing ? "bad" : m.ending ? "warn" : "neutral"} sub={`${m.failing} failing · ${m.ending} ending (${money(m.endingMrrCents, { whole: true })}/mo)`} />
      </div>

      <IntelSection title="Revenue by month" sub="Before tax; coaching payments (less refunds), credit packs and other income">
        <MonthChart rows={v.byMonth} />
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="By package, this period" sub="Payments less refunds, by the package or product on the sale">
          <RankRows rows={v.byPackage.map((p) => ({ key: p.package, label: p.package, sub: `${p.clients} client${p.clients === 1 ? "" : "s"} · ${p.payments} payment${p.payments === 1 ? "" : "s"}`, values: [p.revenueCents] }))} format={(n) => money(n, { whole: true })} empty="No payments in this period." />
        </IntelSection>
        <IntelSection title="Recurring revenue now" sub="By package; installment plans for a package aren't recurring">
          <RankRows rows={m.byPackage.map((p) => ({ key: p.package, label: p.package, sub: `${p.subscriptions} subscription${p.subscriptions === 1 ? "" : "s"}`, values: [p.mrrCents] }))} format={(n) => `${money(n, { whole: true })}/mo`} empty="No live subscriptions." />
          <p className="mt-3 text-[12px] text-muted-foreground">
            {m.installmentPlans} installment plan{m.installmentPlans === 1 ? "" : "s"} running ({money(m.installmentOutstandingCents, { whole: true })} still to come).{" "}
            <Link to="/admin/plans" className="underline-offset-2 hover:underline">Sales → Plans</Link> has every subscription.
          </p>
        </IntelSection>
      </div>

      {v.planMoves.length > 0 && (
        <IntelSection title="Plan changes in this period" sub="Upgrades, downgrades and switches applied">
          <ul className="divide-y text-[13px]">
            {v.planMoves.map((p, i) => (
              <li key={i} className="flex items-center justify-between gap-3 py-2">
                <span>{p.from ?? "Free"} → {p.to ?? "Free"}</span>
                <span className="text-muted-foreground">{money(p.fromCents)} → {money(p.toCents)} · {p.at.slice(0, 10)}</span>
              </li>
            ))}
          </ul>
        </IntelSection>
      )}
      <Definitions
        items={[
          { term: "Revenue", text: "Payments recorded on sales (Stripe and by hand) less refunds, before tax, voided ones left out. Credit packs and other income are in the monthly chart." },
          { term: "Monthly recurring revenue", text: "Every live, open-ended subscription's price before tax, as a month (every 2 weeks × 26 ÷ 12). Installment plans for a package are being paid off, not recurring." },
          { term: "Revenue per paying client", text: "Revenue in the period ÷ clients who paid in it." },
          { term: "Lifetime value", text: "Average monthly revenue per paying client ÷ monthly churn of coaching clients, over the last full months. Shown only with 3+ months of paying clients and 3+ clients ended in the last 6 months." },
        ]}
      />
    </div>
  );
}

function MonthChart({ rows }: { rows: RevenueView["byMonth"] }) {
  const data = rows.map((r) => ({
    ...r,
    _l: monthLabel(r.month).slice(0, 3),
    coaching: Math.max(0, r.coachingCents - r.refundsCents) / 100,
    credits: r.creditsCents / 100,
    other: r.otherCents / 100,
  }));
  return (
    <ChartFrame
      ariaLabel="Revenue by month"
      legend={[
        { label: "Coaching", color: "var(--viz-1)" },
        { label: "Credit packs", color: "var(--viz-2)" },
        { label: "Other income", color: "var(--viz-3)" },
      ]}
      table={
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Month</th>
              <th className="px-3 py-1.5 text-right font-medium">Coaching</th>
              <th className="px-3 py-1.5 text-right font-medium">Refunds</th>
              <th className="px-3 py-1.5 text-right font-medium">Recurring</th>
              <th className="px-3 py-1.5 text-right font-medium">Credits</th>
              <th className="px-3 py-1.5 text-right font-medium">Other</th>
              <th className="px-3 py-1.5 text-right font-medium">Paying</th>
              <th className="px-3 py-1.5 text-right font-medium">New</th>
            </tr>
          </thead>
          <tbody>
            {[...rows].reverse().map((r) => (
              <tr key={r.month} className="border-t">
                <td className="px-3 py-1.5">{monthLabel(r.month)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.coachingCents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.refundsCents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.recurringCents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.creditsCents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.otherCents)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.payingClients}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.newPaying}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="_l" tick={axisTick} tickLine={false} axisLine={false} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={48} tickFormatter={(n) => `$${Math.round(Number(n)).toLocaleString("en-CA")}`} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} contentStyle={tooltipStyle} formatter={(n: number, name: string) => [money(Math.round(Number(n) * 100)), name]} />
            <Bar dataKey="coaching" name="Coaching" stackId="a" fill="var(--viz-1)" isAnimationActive={false} maxBarSize={28} />
            <Bar dataKey="credits" name="Credit packs" stackId="a" fill="var(--viz-2)" isAnimationActive={false} maxBarSize={28} />
            <Bar dataKey="other" name="Other income" stackId="a" fill="var(--viz-3)" radius={[3, 3, 0, 0]} isAnimationActive={false} maxBarSize={28} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
