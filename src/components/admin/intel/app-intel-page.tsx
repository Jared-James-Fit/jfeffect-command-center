/**
 * App & website (/admin/insights): how people find JF Effect, whether they come back, what they
 * use, where they are (approximately) and what it earns. Every section answers one question and
 * says how the number is counted.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { getAppIntelFn, getLiveNowFn } from "@/lib/admin-intel/app-intel.functions";
import { hourLabel, type AppIntelView } from "@/lib/admin-intel/app-intel-model";
import { countChange } from "@/lib/admin-intel/usage-model";
import {
  DaysWithTrend,
  Definitions,
  Funnel,
  IntelSection,
  Kpi,
  PeriodSwitch,
  RankRows,
} from "./intel-ui";
import { PlaceMap } from "./place-map";

const PERIODS = [
  { value: 7, label: "7 days" },
  { value: 30, label: "30 days" },
  { value: 90, label: "90 days" },
] as const;

const AUDIENCE_WORD: Record<string, [string, string]> = {
  client: ["client", "clients"],
  member: ["member", "members"],
  visitor: ["website visitor", "website visitors"],
  pending: ["waiting on approval", "waiting on approval"],
};
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function AppIntelPage() {
  const [days, setDays] = useState<number>(30);
  const fetchView = useServerFn(getAppIntelFn);
  const q = useQuery({
    queryKey: ["admin-app-intel", days],
    queryFn: () => fetchView({ data: { days } }) as Promise<AppIntelView>,
    refetchInterval: 5 * 60_000,
    placeholderData: (p) => p,
  });
  const v = q.data;
  return (
    <div className="mx-auto w-full max-w-6xl space-y-4 px-4 pb-28 pt-2 md:px-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <LiveNow />
        <PeriodSwitch value={days} options={PERIODS as any} onChange={setDays} />
      </div>
      {q.isLoading && !v ? (
        <div className="space-y-4" aria-busy>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-[112px] rounded-2xl" />
            ))}
          </div>
          <Skeleton className="h-[280px] rounded-2xl" />
          <Skeleton className="h-[360px] rounded-2xl" />
        </div>
      ) : q.error && !v ? (
        <IntelSection title="Couldn't load">
          <p className="text-[13px] text-destructive">{String((q.error as any)?.message ?? q.error)}</p>
          <Button className="mt-3" variant="outline" onClick={() => q.refetch()}>Try again</Button>
        </IntelSection>
      ) : v ? (
        <Body v={v} />
      ) : null}
    </div>
  );
}

/** Who's in the app right now (a heartbeat in the last 5 minutes), refreshed every 30 seconds. */
function LiveNow() {
  const fetchLive = useServerFn(getLiveNowFn);
  const q = useQuery({ queryKey: ["admin-live-now"], queryFn: () => fetchLive(), refetchInterval: 30_000 });
  const d = q.data;
  const total = d?.total ?? 0;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex items-center gap-2 text-[15px] font-semibold">
        <span className="relative inline-flex h-2.5 w-2.5">
          {total > 0 && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-[var(--viz-3)] opacity-60 motion-reduce:animate-none" />}
          <span className={cn("relative inline-flex h-2.5 w-2.5 rounded-full", total > 0 ? "bg-[var(--viz-3)]" : "bg-muted-foreground/40")} />
        </span>
        {q.isLoading ? "Checking who's here…" : `${total} in the app now`}
      </span>
      {d && total > 0 && (
        <span className="text-[13px] text-muted-foreground">
          {Object.entries(d.byAudience as Record<string, number>)
            .filter(([k]) => k !== "staff")
            .map(([k, n]) => (AUDIENCE_WORD[k] ? plural(n, AUDIENCE_WORD[k][0], AUDIENCE_WORD[k][1]) : `${n} ${k}`))
            .join(" · ")}
          {d.byFeature.length > 0 && <> · on {d.byFeature.slice(0, 3).map((f: any) => `${f.feature} (${f.n})`).join(", ")}</>}
        </span>
      )}
    </div>
  );
}

function Body({ v }: { v: AppIntelView }) {
  const stick = v.now.mau ? Math.round((v.now.dau / v.now.mau) * 100) : null;
  const sinceLabel = v.trackingSince ? new Date(v.trackingSince).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : null;
  return (
    <div className="space-y-4">
      {v.takeaways.length > 0 && (
        <IntelSection title="Worth acting on" sub="From the numbers on this page.">
          <ul className="space-y-2">
            {v.takeaways.map((t) => (
              <li key={t.key} className={cn("flex gap-2 text-[14px] leading-snug", t.tone === "warning" && "font-medium")}>
                <span className={cn("mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full", t.tone === "warning" ? "bg-amber-500" : "bg-muted-foreground/50")} aria-hidden />
                {t.text}
              </li>
            ))}
          </ul>
        </IntelSection>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          label="Active this week"
          value={v.now.wau}
          delta={countChange(v.now.wau, v.now.wauPrev)}
          sub={`${v.now.dau} today${stick != null ? ` · ${stick}% of the month's actives` : ""}`}
        />
        <Kpi label="Active this month" value={v.now.mau} delta={countChange(v.now.mau, v.now.mauPrev)} sub={`of ${v.now.people} people with an account`} />
        <Kpi
          label="New sign-ups"
          value={v.now.signups}
          delta={countChange(v.now.signups, v.now.signupsPrev)}
          sub={`${plural(v.now.clients, "coaching client", "coaching clients")} · ${plural(v.now.members, "free member", "free members")}${v.now.pending ? ` · ${v.now.pending} waiting` : ""}`}
        />
        <Kpi
          label="Website visitors"
          value={v.site.landingVisitors}
          delta={countChange(v.site.landingVisitors, v.site.landingPrev)}
          sub={`${v.site.memberApps + v.site.coachingApps} applied in the last ${v.days} days`}
        />
      </div>

      <IntelSection
        title="Active people by day"
        sub="Bars: clients and members who opened the app that day. Line: people active in the 7 days up to it."
      >
        <DaysWithTrend rows={v.daily} barKey="active" lineKey="active7" barLabel="Active that day" lineLabel="Active over 7 days" ariaLabel="Active people by day" />
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="How people find you" sub={`The public site, last ${v.days} days.`}>
          <Funnel
            steps={[
              { label: "Opened the landing page", value: v.site.landingVisitors },
              { label: "Saw the prices", value: Math.max(v.site.steps["pricing_view:home"] ?? 0, 0) + (v.site.steps["pricing_view:coaching"] ?? 0) },
              { label: "Applied", value: v.site.memberApps + v.site.coachingApps, hint: `${v.site.memberApps} free · ${v.site.coachingApps} coaching` },
              { label: "Joined or became a client", value: v.site.memberJoined + v.site.coachingConverted },
            ]}
          />
          <h3 className="mb-2 mt-5 text-[13px] font-semibold">Where visitors came from</h3>
          <RankRows
            rows={v.site.sources.slice(0, 6).map((s) => ({ key: s.source, label: s.source, values: [s.visitors] }))}
            format={(n) => String(Math.round(n))}
            empty="No landing page visits in this period."
          />
          {v.site.devices.length > 0 && (
            <p className="mt-3 text-[12px] text-muted-foreground">
              Devices: {v.site.devices.map((d) => `${d.label} ${d.n}`).join(" · ")}
            </p>
          )}
          <Link to="/admin/sales" search={{ tab: "coaching" } as any} className="mt-3 inline-block text-[13px] font-medium text-muted-foreground underline-offset-2 hover:underline">
            Coaching funnel by package
          </Link>
        </IntelSection>

        <IntelSection title="Getting started" sub="Everyone who got an account in the last 6 months.">
          <Funnel
            steps={[
              { label: "Got an account", value: v.onboarding.joined },
              { label: "Came back on another day", value: v.onboarding.cameBack },
              { label: "Logged a workout in week 1", value: v.onboarding.trainedWeek1 },
              { label: "Still active in week 4", value: v.onboarding.activeWeek4, base: v.onboarding.week4Eligible, hint: `of ${v.onboarding.week4Eligible} who've had 5 weeks` },
            ]}
          />
          <p className="mt-3 text-[12px] text-muted-foreground">
            {v.onboarding.everTrained} of {v.onboarding.joined} have logged a workout at any point.
          </p>
        </IntelSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="What people do" sub="Clients and members who did each thing in the last 30 days, from what each feature records.">
          <RankRows
            rows={v.actions.map((a) => ({
              key: a.action,
              label: a.action,
              sub: v.now.mau ? `${Math.round((a.people / v.now.mau) * 100)}% of the month's actives` : undefined,
              values: [a.people],
            }))}
            format={(n) => `${Math.round(n)} ${Math.round(n) === 1 ? "person" : "people"}`}
          />
        </IntelSection>
        <IntelSection
          title="Pages people open"
          sub={sinceLabel ? `Recorded since ${sinceLabel}; people who opened each in this period.` : "Recording starts as people open the app."}
        >
          <RankRows
            rows={v.pages.slice(0, 12).map((p) => ({ key: p.feature, label: p.feature, sub: `${p.views} views`, values: [p.people] }))}
            format={(n) => `${Math.round(n)} ${Math.round(n) === 1 ? "person" : "people"}`}
            empty="No page views recorded yet."
          />
          {v.pages.length > 12 && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              Least opened: {v.pages.slice(-4).map((p) => p.feature).join(", ")}.
            </p>
          )}
        </IntelSection>
      </div>

      <IntelSection
        title="Where they are"
        sub="Approximate: the country a visit's internet address is in, placed at the main city of the device's time zone (most of Manitoba shows as Winnipeg). Nobody's exact location is recorded, and no place names a person."
      >
        <PlaceMap places={v.places} />
        <div className="mt-3 grid gap-x-6 gap-y-1 text-[13px] sm:grid-cols-2">
          {v.places.slice(0, 8).map((p) => (
            <div key={p.key} className="flex items-baseline justify-between gap-3 border-b py-1.5 last:border-0">
              <span className="min-w-0 truncate">
                {p.live > 0 && <span className="mr-1.5 inline-block h-2 w-2 rounded-full bg-[var(--viz-3)]" aria-label="in the app now" />}
                {p.label}
              </span>
              <span className="shrink-0 tabular-nums text-muted-foreground">{p.sessions} visits</span>
            </div>
          ))}
        </div>
        {v.unplacedSessions > 0 && (
          <p className="mt-2 text-[12px] text-muted-foreground">
            {v.unplacedSessions} visit{v.unplacedSessions === 1 ? " has" : "s have"} no place (the browser asked not to be tracked, or the host didn't give one).
          </p>
        )}
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Coming back" sub="Of each month's new accounts, the share who opened the app in each month after.">
          <RetentionGrid rows={v.retention} />
        </IntelSection>
        <IntelSection title="When people open the app" sub={`Visits by weekday and hour (Winnipeg time), last ${v.days} days.`}>
          <HourGrid cells={v.sessions.byHour} />
        </IntelSection>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Devices" sub={`How visits opened JF Effect, last ${v.days} days.`}>
          <RankRows rows={v.sessions.byPlatform.map((p) => ({ key: p.key, label: p.label, values: [p.n] }))} format={(n) => `${Math.round(n)} visits`} empty="No visits recorded yet." />
          {v.sessions.byDevice.length > 0 && (
            <p className="mt-3 text-[12px] text-muted-foreground">{v.sessions.byDevice.map((d) => `${d.label} ${d.n}`).join(" · ")}</p>
          )}
          <p className="mt-2 text-[12px] text-muted-foreground">
            {v.sessions.count} visits · {v.sessions.medianMinutes != null ? `${v.sessions.medianMinutes} min typical length` : "length not recorded yet"}
            {v.sessions.viewsPer != null && ` · ${v.sessions.viewsPer} pages a visit`}
            {v.pushDevices.length > 0 && ` · push on ${v.pushDevices.map((p) => `${p.n} ${p.key}`).join(", ")}`}
          </p>
        </IntelSection>

        <IntelSection
          title="Revenue & coaching"
          sub="Cash in before tax, by month, from the books."
          action={
            <Button asChild size="sm" variant="outline" className="h-9">
              <Link to="/admin/sales" search={{ tab: "overview" } as any}>Sales</Link>
            </Button>
          }
        >
          <MonthBars rows={v.revenue} />
          <div className="mt-3 grid grid-cols-3 gap-2 text-center">
            <Mini label="Subscriptions running" value={v.subscriptions.active} />
            <Mini label="Ending" value={v.subscriptions.ending} tone={v.subscriptions.ending ? "warn" : undefined} />
            <Mini label="Failing" value={v.subscriptions.failing} tone={v.subscriptions.failing ? "bad" : undefined} />
          </div>
          <div className="mt-3">
            <div className="mb-1 text-[12px] text-muted-foreground">Coaching clients who started and ended, by month</div>
            <div className="grid grid-cols-6 gap-1 text-center text-[11px]">
              {v.churn.map((c) => (
                <div key={c.month} className="rounded-md bg-muted/50 px-1 py-1.5" title={`${monthShort(c.month)}: ${c.started} started, ${c.ended} ended`}>
                  <div className="text-muted-foreground">{monthShort(c.month)}</div>
                  <div className="font-semibold tabular-nums">+{c.started}</div>
                  <div className={cn("tabular-nums", c.ended ? "text-foreground" : "text-muted-foreground")}>−{c.ended}</div>
                </div>
              ))}
            </div>
          </div>
        </IntelSection>
      </div>

      {v.staffPages.length > 0 && (
        <IntelSection title="Staff pages used" sub={`Your team's own visits, last ${v.days} days (never counted above).`}>
          <RankRows rows={v.staffPages.slice(0, 15).map((p) => ({ key: p.feature, label: p.feature, values: [p.views] }))} format={(n) => `${Math.round(n)} views`} />
        </IntelSection>
      )}

      <Definitions
        items={[
          { term: "Active", text: "A signed-in client or member who opened the app that day. Staff and test accounts never count. Before Nov 23 2026 only coaching clients' sign-ins were kept." },
          { term: "In the app now", text: "A visit with a heartbeat in the last 5 minutes (the app beats once a minute while it's on screen)." },
          { term: "Visit", text: "One session: closing the app or 30 minutes away starts a new one." },
          { term: "Website visitor", text: "An anonymous browser that opened the landing page, counted once a day. A browser asking not to be tracked isn't counted." },
          { term: "Places", text: "On a visit's first beat: the country from the host's IP geolocation (the IP itself is never stored), put on the map at the main city of the device's time zone when that zone is in the same country, else listed by country only." },
          { term: "Revenue", text: "Payments less refunds before GST/HST, by the day the money moved; voided payments left out." },
        ]}
      />
    </div>
  );
}

const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthShort = (ym: string) => MON[Number(ym.slice(5, 7)) - 1] ?? ym;

function Mini({ label, value, tone }: { label: string; value: number; tone?: "warn" | "bad" }) {
  return (
    <div className={cn("rounded-xl bg-muted/50 p-2.5", tone === "warn" && "bg-amber-500/10", tone === "bad" && "bg-destructive/10")}>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
      <div className="text-[11px] leading-tight text-muted-foreground">{label}</div>
    </div>
  );
}

function MonthBars({ rows }: { rows: AppIntelView["revenue"] }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No payments in the last 6 months.</p>;
  const max = Math.max(1, ...rows.map((r) => r.cashIn));
  return (
    <div className="flex h-40 items-end gap-2" role="img" aria-label={rows.map((r) => `${monthShort(r.month)} $${Math.round(r.cashIn)}`).join(", ")}>
      {rows.map((r, i) => (
        <div key={r.month} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
          <span className="text-[11px] tabular-nums text-muted-foreground">${r.cashIn >= 1000 ? `${(r.cashIn / 1000).toFixed(1)}k` : Math.round(r.cashIn)}</span>
          <div
            className="w-full max-w-10 rounded-t"
            style={{ height: `${Math.max(2, (r.cashIn / max) * 100)}%`, background: "var(--viz-1)", opacity: i === rows.length - 1 ? 1 : 0.55 }}
            title={`${monthShort(r.month)}: $${r.cashIn.toFixed(2)} in${r.refunds ? `, $${r.refunds.toFixed(2)} refunded` : ""}`}
          />
          <span className="text-[11px] text-muted-foreground">{monthShort(r.month)}</span>
        </div>
      ))}
    </div>
  );
}

/** Cohort × month-since-joining, shaded by the share still active (one hue, darker = more). */
function RetentionGrid({ rows }: { rows: AppIntelView["retention"] }) {
  if (!rows.length) return <p className="text-[13px] text-muted-foreground">No accounts made in the last 6 months.</p>;
  const cols = Math.max(1, ...rows.map((r) => Math.max(0, ...r.months.map((m) => m.m)) + 1));
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[320px] border-separate border-spacing-1 text-[12px]">
        <thead>
          <tr className="text-muted-foreground">
            <th className="text-left font-medium">Joined</th>
            <th className="text-right font-medium">People</th>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i} className="font-medium">{i === 0 ? "Month 1" : `+${i}`}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.cohort}>
              <td className="whitespace-nowrap">{monthShort(r.cohort)} {r.cohort.slice(0, 4)}</td>
              <td className="text-right tabular-nums">{r.size}</td>
              {Array.from({ length: cols }, (_, i) => {
                const m = r.months.find((x) => x.m === i);
                const pct = r.size ? Math.round(((m?.active ?? 0) / r.size) * 100) : 0;
                return (
                  <td
                    key={i}
                    className="h-8 min-w-10 rounded text-center tabular-nums"
                    style={{ background: `color-mix(in oklch, var(--viz-1) ${Math.round(pct * 0.85)}%, var(--muted))`, color: pct >= 55 ? "white" : undefined }}
                    title={`${m?.active ?? 0} of ${r.size} active`}
                  >
                    {m ? `${pct}%` : ""}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function HourGrid({ cells }: { cells: AppIntelView["sessions"]["byHour"] }) {
  const total = cells.reduce((s, c) => s + c.n, 0);
  if (!total) return <p className="text-[13px] text-muted-foreground">Visits start recording as people open the app.</p>;
  const max = Math.max(1, ...cells.map((c) => c.n));
  // two-hour squares from 4 AM to midnight (the night is quiet and left out)
  const hours = [4, 6, 8, 10, 12, 14, 16, 18, 20, 22];
  const at = (d: number, h: number) => cells.filter((c) => c.dow === d && (c.hour === h || c.hour === h + 1)).reduce((s, c) => s + c.n, 0);
  return (
    <div className="-mx-1 overflow-x-auto">
      <table className="w-full min-w-[320px] border-separate border-spacing-1 text-[11px]">
        <thead>
          <tr className="text-muted-foreground">
            <th />
            {hours.map((h) => (
              <th key={h} className="font-medium">{hourLabel(h).replace(" ", "")}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {DOW.map((d, i) => (
            <tr key={d}>
              <td className="pr-1 text-muted-foreground">{d}</td>
              {hours.map((h) => {
                const n = at(i + 1, h);
                return (
                  <td
                    key={h}
                    className="h-6 min-w-6 rounded"
                    style={{ background: `color-mix(in oklch, var(--viz-1) ${Math.round((n / max) * 85)}%, var(--muted))` }}
                    title={`${d} ${hourLabel(h)} to ${hourLabel((h + 2) % 24)}: ${n} visits`}
                  />
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <p className="mt-1 text-[11px] text-muted-foreground">Each square is two hours; darker is busier.</p>
    </div>
  );
}

