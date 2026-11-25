/**
 * Retention: do people keep coming back, and who's drifting away. Day 1 / 7 / 30 / 90 (counted only
 * for people who've had the whole window), weekly and monthly cohort heatmaps, everyone by when they
 * were last active, coaching clients started and ended by month, and the people worth a message
 * this week (with a link to their profile). Activity is read from every record that says someone
 * did something, so it reaches back before visits were tracked.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ChartFrame, Definitions, IntelSection, axisTick, monthLabel, tooltipStyle } from "@/components/admin/intel/intel-ui";
import { SEGMENT_LABEL, percent, type RetentionView } from "@/lib/bi/model";
import { CohortHeatmap, KpiCard, Segmented, ShareBar, SinceNote } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

const SHORT: Record<string, string> = { member: "members", client: "clients", lead: "applicants", pending: "waiting" };

const BUCKETS: { key: string; label: string }[] = [
  { key: "week", label: "Last 7 days" },
  { key: "month", label: "8–30 days ago" },
  { key: "quarter", label: "31–90 days ago" },
  { key: "lapsed", label: "Over 90 days" },
  { key: "never", label: "Never" },
];

export function RetentionTab({ range }: TabProps) {
  const q = useBiTab<RetentionView>("retention", range);
  const [unit, setUnit] = useState<"W" | "M">("W");
  const v = q.data;
  if (!v) return <div />;
  return (
    <div className="space-y-4">
      {v.activitySince && (
        <SinceNote>
          Activity is read from workouts, posts, likes, messages, weigh-ins, food and cardio logged, check-ins, sign-ins and visits (the
          earliest on record here is {v.activitySince}). Counted for everyone who joined in the last 400 days.
        </SinceNote>
      )}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-retention-dn>
        {v.dayN.map((d) => (
          <KpiCard
            key={d.n}
            label={`Day ${d.n} retention`}
            value={percent(d.rate)}
            sub={
              d.eligible
                ? `${d.kept} of ${d.eligible} · ${Object.entries(d.byTier).map(([t, b]) => `${SHORT[t] ?? t} ${percent(b.rate)}`).join(" · ")}`
                : "Nobody has had this long yet"
            }
            info={d.n === 1 ? "Active the day after joining" : d.n === 7 ? "Active in days 7–13 after joining" : d.n === 30 ? "Active in days 30–59 after joining" : "Active in days 90–119 after joining"}
          />
        ))}
      </div>

      <IntelSection
        title="Cohorts"
        sub="Each row is the people who joined that week or month; each cell, the share active that many weeks or months later"
        action={<Segmented label="Cohort size" value={unit} onChange={setUnit} options={[{ value: "W", label: "Weekly" }, { value: "M", label: "Monthly" }]} />}
      >
        <CohortHeatmap rows={unit === "W" ? v.weekly : v.monthly.map((m) => ({ ...m, cohort: monthLabel(m.cohort) }))} unit={unit} />
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Active and inactive" sub="Every current client and member by their last active day">
          <div className="space-y-3">
            {(["client", "member"] as const).map((t) => {
              const s = v.status[t] ?? {};
              const total = Object.values(s).reduce((a, b) => a + b, 0);
              return (
                <div key={t}>
                  <div className="mb-1 flex items-baseline justify-between text-[13px]">
                    <span className="font-medium">{SEGMENT_LABEL[t]}</span>
                    <span className="text-muted-foreground">{total}</span>
                  </div>
                  <ul className="space-y-1">
                    {BUCKETS.map((b) => (
                      <li key={b.key} className="flex items-center justify-between gap-3 text-[12px]">
                        <span className="text-muted-foreground">{b.label}</span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{s[b.key] ?? 0}</span>
                          <ShareBar pct={total ? Math.round(((s[b.key] ?? 0) / total) * 100) : null} tone={b.key === "lapsed" || b.key === "never" ? "warn" : "neutral"} />
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
            <p className="text-[12px] text-muted-foreground">
              Returning: {v.returning.returning} of {v.returning.active} active in this period were also active in the 90 days before ({percent(v.returning.rate)}).
            </p>
          </div>
        </IntelSection>
        <IntelSection title="At risk" sub="Active on 4+ days in the month before the last two weeks, and not in the last 10 days">
          {v.atRisk.length ? (
            <ul className="divide-y">
              {v.atRisk.map((p) => (
                <li key={(p.clientId ?? p.name) + p.lastDay} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0">
                    {p.clientId ? (
                      <Link to="/admin/clients/$id" params={{ id: p.clientId } as any} className="font-medium hover:underline">{p.name}</Link>
                    ) : (
                      <span className="font-medium">{p.name}</span>
                    )}
                    <span className="ml-1.5 text-[12px] text-muted-foreground">{SEGMENT_LABEL[p.tier] ?? p.tier}</span>
                  </span>
                  <span className="shrink-0 text-[12px] text-muted-foreground">last active {p.lastDay} · {p.priorDays} days before</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[13px] text-muted-foreground">Nobody who was active has gone quiet. (Worked out only when the period ends today.)</p>
          )}
        </IntelSection>
      </div>

      <IntelSection title="Coaching clients by month" sub="Started and ended; churn is ended ÷ clients at the month's start">
        <ChartFrame
          ariaLabel="Coaching clients started and ended by month"
          legend={[
            { label: "Started", color: "var(--viz-1)" },
            { label: "Ended", color: "var(--viz-2)" },
          ]}
          table={
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-card text-muted-foreground">
                <tr>
                  <th className="px-3 py-1.5 text-left font-medium">Month</th>
                  <th className="px-3 py-1.5 text-right font-medium">At start</th>
                  <th className="px-3 py-1.5 text-right font-medium">Started</th>
                  <th className="px-3 py-1.5 text-right font-medium">Ended</th>
                  <th className="px-3 py-1.5 text-right font-medium">Churn</th>
                </tr>
              </thead>
              <tbody>
                {[...v.clientsByMonth].reverse().map((m) => (
                  <tr key={m.month} className="border-t">
                    <td className="px-3 py-1.5">{monthLabel(m.month)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.activeStart}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.started}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{m.ended}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{percent(m.churn)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          }
        >
          <div style={{ height: 200 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={v.clientsByMonth.map((m) => ({ ...m, _l: monthLabel(m.month).slice(0, 3) }))} margin={{ top: 6, right: 4, left: 0, bottom: 0 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="_l" tick={axisTick} tickLine={false} axisLine={false} />
                <YAxis tick={axisTick} tickLine={false} axisLine={false} width={28} allowDecimals={false} />
                <Tooltip cursor={{ fill: "var(--muted)", opacity: 0.5 }} contentStyle={tooltipStyle} />
                <Bar dataKey="started" name="Started" fill="var(--viz-1)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                <Bar dataKey="ended" name="Ended" fill="var(--viz-2)" radius={[3, 3, 0, 0]} maxBarSize={18} isAnimationActive={false} />
                <Legend wrapperStyle={{ display: "none" }} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </ChartFrame>
        <p className="mt-2 text-[12px] text-muted-foreground">
          Monthly active people: {v.mauByMonth.map((m) => `${monthLabel(m.month).slice(0, 3)} ${m.active}`).join(" · ") || "none yet"}.
          {v.cancellations ? ` ${v.cancellations} cancellation${v.cancellations === 1 ? "" : "s"} or deactivation${v.cancellations === 1 ? "" : "s"} in this period.` : ""}
          {Object.keys(v.planMoves).length ? ` Plan changes: ${Object.entries(v.planMoves).map(([k, n]) => `${n} ${k}`).join(", ")}.` : ""}
        </p>
      </IntelSection>
      <Definitions
        items={[
          { term: "Day N retention", text: "Of everyone who joined and has had the whole window: active on day 1, in days 7–13, days 30–59 or days 90–119 after joining." },
          { term: "Active", text: "Did anything in the app that day: a visit, a sign-in, a workout, a post or like, a message, a weigh-in, food or cardio logged, a check-in." },
          { term: "At risk", text: "4+ active days in the month before the last two weeks, none in the last 10. It can be a holiday; a short message is cheap either way." },
          { term: "Churn", text: "Coaching clients who ended (deactivated or archived) in the month, out of those coaching at its start." },
        ]}
      />
    </div>
  );
}
