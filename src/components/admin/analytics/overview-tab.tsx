/**
 * Overview: the business on one screen. The eight numbers that matter most first (each against the
 * period before, with its day-by-day line), the secondary ones in a strip, the daily chart, and
 * Cleo's top three things to act on. Every number says how it's counted under "What the numbers mean".
 */
import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, Definitions, IntelSection, axisTick, dayLabel, tooltipStyle } from "@/components/admin/intel/intel-ui";
import { count, duration, kpiDelta, money, percent, type OverviewView } from "@/lib/bi/model";
import type { InsightsView } from "@/lib/bi/bi.server";
import { pctChange } from "@/lib/bi/period";
import { KpiCard, SinceNote, StatStrip } from "./bi-ui";
import { InsightCard } from "./insights-tab";
import { useBiTab, type TabProps } from "./analytics-page";

export function OverviewTab({ range, goTo }: TabProps) {
  const q = useBiTab<OverviewView>("overview", range);
  const ins = useBiTab<InsightsView>("insights", range, !!q.data);
  const v = q.data;
  if (!v) return <div />;
  const c = v.current;
  const p = v.previous;
  const daily = v.daily;
  const visitsSince = v.visitsSince?.slice(0, 10) ?? null;
  return (
    <div className="space-y-4">
      {visitsSince && range.from < visitsSince && (
        <SinceNote>
          Visits, visitors, sessions and places are recorded since {visitsSince}; earlier days show none, not zero traffic. Accounts,
          activity, applications and payments come from their own records and reach further back.
        </SinceNote>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-overview-kpis>
        <KpiCard label="Visitors" value={count(c.visitors)} delta={kpiDelta(v, "visitors")} sub={`${count(c.newVisitors)} new · ${count(c.returningVisitors)} returning`} spark={daily.map((d) => d.visitors)} onClick={() => goTo("acquisition")} />
        <KpiCard label="Active people" value={count(c.activePeople)} delta={kpiDelta(v, "activePeople")} sub={`Daily avg ${c.dauAvg} · 7d ${c.wau} · 30d ${c.mau}`} spark={daily.map((d) => d.active)} onClick={() => goTo("engagement")} info="Clients and members who did anything in the app (a visit, a workout, a post, a message…)" />
        <KpiCard label="New accounts" value={count(c.registrations)} delta={kpiDelta(v, "registrations")} sub={`${c.applications} application${c.applications === 1 ? "" : "s"} (${c.memberApplications} free, ${c.coachingApplications} coaching)`} spark={daily.map((d) => d.registrations)} onClick={() => goTo("conversions")} />
        <KpiCard label="New paying clients" value={count(c.newPaying)} delta={kpiDelta(v, "newPaying")} sub={`${c.freeToPaid} from a free account first`} onClick={() => goTo("conversions")} />
        <KpiCard label="Revenue" value={money(c.revenueCents, { whole: true })} delta={kpiDelta(v, "revenueCents")} sub={`Before tax · ${c.payingClients} paying client${c.payingClients === 1 ? "" : "s"}`} spark={daily.map((d) => d.revenueCents)} onClick={() => goTo("revenue")} />
        <KpiCard label="Monthly recurring revenue" value={money(v.mrr.mrrCents, { whole: true })} sub={`${v.mrr.subscriptions} subscription${v.mrr.subscriptions === 1 ? "" : "s"}${v.mrr.ending ? ` · ${v.mrr.ending} ending` : ""}`} tone={v.mrr.failing ? "warn" : "neutral"} onClick={() => goTo("revenue")} info="Live open-ended subscriptions' price before tax, per month. Installment plans for a package aren't recurring." />
        <KpiCard label="Client retention" value={percent(c.clientRetention)} delta={c.clientRetention != null && p.clientRetention != null ? c.clientRetention - p.clientRetention : null} sub={`${c.clientsEndedOfStart} of ${c.clientsAtStart} coaching clients ended · ${c.clientsStarted} started`} onClick={() => goTo("retention")} info="Of the coaching clients at the start of the period, the share still coaching at its end" />
        <KpiCard label="Engagement rate" value={percent(c.engagementRate)} delta={v.prevVisitsTracked && c.engagementRate != null && p.engagementRate != null ? c.engagementRate - p.engagementRate : null} sub={`Bounce ${percent(c.bounceRate)} · ${count(c.sessions)} sessions`} onClick={() => goTo("technical")} info="Sessions with 10+ seconds on screen or 2+ pages" />
      </div>
      <StatStrip
        items={[
          { label: "Sessions", value: count(c.sessions), sub: v.prevVisitsTracked ? change(c.sessions, p.sessions) : undefined },
          { label: "Avg session", value: duration(c.avgSessionSeconds), sub: `median ${duration(c.medianSessionSeconds)}` },
          { label: "Page views", value: count(c.pageViews) },
          { label: "Website visitors", value: count(c.siteVisitors), sub: v.prevVisitsTracked ? change(c.siteVisitors, p.siteVisitors) : undefined },
          { label: "Weekly active", value: count(c.wau), sub: "last 7 days" },
          { label: "Monthly active", value: count(c.mau), sub: "last 30 days" },
          { label: "Free → paid", value: count(c.freeToPaid), sub: change(c.freeToPaid, p.freeToPaid) },
          { label: "Live now", value: count(v.live) },
        ]}
      />
      <IntelSection title="Day by day" sub="Visitors (bars) and people active in the app (line)">
        <DailyChart rows={daily} />
      </IntelSection>
      {ins.data && ins.data.insights.length > 0 && (
        <IntelSection
          title="Cleo's top things to act on"
          sub="Worked out from these numbers by rules; facts, possible reasons and recommendations kept apart"
          action={<button type="button" onClick={() => goTo("insights")} className="min-h-9 text-[13px] font-medium text-muted-foreground hover:text-foreground">All insights ›</button>}
        >
          <div className="grid gap-3 md:grid-cols-3">
            {ins.data.insights.slice(0, 3).map((i) => <InsightCard key={i.id} insight={i} compact onOpen={() => goTo(i.tab)} />)}
          </div>
        </IntelSection>
      )}
      <Definitions
        items={[
          { term: "Visitor", text: "A browser (one random id kept on it), whether or not someone's signed in. Your own team's browsers and test logins never count." },
          { term: "New / returning", text: "New: first seen in this period. Returning: seen before it." },
          { term: "Session", text: "One visit. Closing the app or 30 minutes away starts a new one." },
          { term: "Engagement / bounce", text: "Engaged: 10+ seconds on screen or 2+ pages. Bounce is the rest." },
          { term: "Active people", text: "Clients and members who did anything in the app that day: a visit, a sign-in, a workout, a post, a like, a message, a weigh-in, food or cardio logged, a check-in." },
          { term: "New account", text: "A new login (not your team, not a test login)." },
          { term: "New paying client", text: "A client whose first-ever payment landed in the period. Free → paid: of those, the ones who had a free account first." },
          { term: "Revenue", text: "Payments less refunds before tax (billing records), plus credit packs and other income, by the day the money moved." },
          { term: "Compared with", text: "Every change is against the same number of days just before." },
        ]}
      />
    </div>
  );
}

function change(now: number, before: number): string {
  const d = pctChange(now, before);
  return d == null ? (before === 0 && now > 0 ? "new" : "") : `${d > 0 ? "+" : ""}${d}% vs before`;
}

function DailyChart({ rows }: { rows: OverviewView["daily"] }) {
  const data = rows.map((r) => ({ ...r, _label: dayLabel(r.day) }));
  return (
    <ChartFrame
      ariaLabel="Visitors and active people by day"
      legend={[
        { label: "Visitors", color: "var(--viz-1)" },
        { label: "Active people", color: "var(--viz-2)" },
      ]}
      table={
        <table className="w-full text-[12px]">
          <thead className="sticky top-0 bg-card text-muted-foreground">
            <tr>
              <th className="px-3 py-1.5 text-left font-medium">Day</th>
              <th className="px-3 py-1.5 text-right font-medium">Visitors</th>
              <th className="px-3 py-1.5 text-right font-medium">Active</th>
              <th className="px-3 py-1.5 text-right font-medium">Accounts</th>
              <th className="px-3 py-1.5 text-right font-medium">Applications</th>
              <th className="px-3 py-1.5 text-right font-medium">Revenue</th>
            </tr>
          </thead>
          <tbody>
            {[...data].reverse().map((r) => (
              <tr key={r.day} className="border-t">
                <td className="px-3 py-1.5">{r._label}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.visitors}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.active}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.registrations}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{r.applications}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{money(r.revenueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      }
    >
      <div style={{ height: 220 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, left: 0, bottom: 0 }} barCategoryGap="18%">
            <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
            <XAxis dataKey="_label" tick={axisTick} tickLine={false} axisLine={false} interval="preserveStartEnd" minTickGap={18} />
            <YAxis tick={axisTick} tickLine={false} axisLine={false} width={32} allowDecimals={false} />
            <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} contentStyle={tooltipStyle} />
            <Bar dataKey="visitors" name="Visitors" fill="var(--viz-1)" radius={[3, 3, 0, 0]} maxBarSize={22} isAnimationActive={false} />
            <Line dataKey="active" name="Active people" stroke="var(--viz-2)" strokeWidth={2} dot={false} isAnimationActive={false} type="monotone" />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartFrame>
  );
}
