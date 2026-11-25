/**
 * Acquisition: where people come from, and which sources actually bring paying clients. Visits are
 * by the visit's own source; sign-ups, applications, paying clients and revenue are by where the
 * person FIRST came from (and new paying clients also by their last non-direct visit before paying),
 * so a channel is judged by what it brings, not just traffic.
 */
import { useState } from "react";
import { Definitions, IntelSection, RankRows } from "@/components/admin/intel/intel-ui";
import { CHANNEL_HELP, CHANNEL_LABEL, type Channel } from "@/lib/bi/channels";
import { ATTRIBUTION_LABEL, count, duration, money, percent, type AcquisitionView, type ChannelRow } from "@/lib/bi/model";
import { pctChange } from "@/lib/bi/period";
import { DataTable, Segmented, SinceNote } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

const label = (c: string | null) => (c ? (CHANNEL_LABEL as Record<string, string>)[c] ?? (c === "untracked" ? "Not tracked" : c) : "–");
const BROWSER: Record<string, string> = {
  safari: "Safari", chrome: "Chrome", firefox: "Firefox", edge: "Edge", samsung: "Samsung Internet", opera: "Opera",
  instagram: "Instagram's in-app browser", facebook: "Facebook's in-app browser", tiktok: "TikTok's in-app browser",
  webview: "The JF Effect app", other: "Other", unknown: "Not recorded",
};

export function AcquisitionTab({ range }: TabProps) {
  const q = useBiTab<AcquisitionView>("acquisition", range);
  const [touch, setTouch] = useState<"first" | "last">("first");
  const v = q.data;
  if (!v) return <div />;
  const withVisits = v.channels.filter((c) => c.sessions > 0);
  const paying = v.channels.filter((c) => (touch === "first" ? c.newPayingFirst : c.newPayingLast) > 0 || c.revenueCents > 0);
  const payingAll = Object.values(v.attribution.payingAll).reduce((s, n) => s + n, 0);
  return (
    <div className="space-y-4">
      <SinceNote>
        A visit's channel is recorded since Nov 23 2026. A paying client who joined earlier is attributed by their application form or
        the source on their record when there is one, else “Not tracked”. {payingAll ? `Of ${payingAll} paying clients ever: ${Object.entries(v.attribution.payingAll).map(([k, n]) => `${ATTRIBUTION_LABEL[k] ?? k} ${n}`).join(", ")}.` : ""}
      </SinceNote>

      <IntelSection title="Channels" sub="Sorted by revenue they brought, then paying clients, sign-ups and visits">
        <DataTable<ChannelRow>
          rows={v.channels}
          rowKey={(r) => r.channel}
          limit={14}
          columns={[
            { key: "channel", label: "Channel", render: (r) => <span title={(CHANNEL_HELP as Record<string, string>)[r.channel]} className="font-medium">{label(r.channel)}</span>, sort: (r) => label(r.channel) },
            { key: "sessions", label: "Visits", align: "right", render: (r) => <>{count(r.sessions)}<Change now={r.sessions} before={r.prevSessions} /></>, sort: (r) => r.sessions },
            { key: "visitors", label: "Visitors", align: "right", render: (r) => count(r.visitors), sort: (r) => r.visitors },
            { key: "engaged", label: "Engaged", align: "right", render: (r) => percent(r.engagementRate), sort: (r) => r.engagementRate },
            { key: "avg", label: "Avg time", align: "right", render: (r) => duration(r.avgSeconds), sort: (r) => r.avgSeconds },
            { key: "regs", label: "Sign-ups", align: "right", render: (r) => count(r.registrations), sort: (r) => r.registrations },
            { key: "apps", label: "Applications", align: "right", render: (r) => count(r.memberApps + r.coachingApps), sort: (r) => r.memberApps + r.coachingApps },
            { key: "first", label: "New paying (first)", align: "right", render: (r) => count(r.newPayingFirst), sort: (r) => r.newPayingFirst },
            { key: "last", label: "New paying (last)", align: "right", render: (r) => count(r.newPayingLast), sort: (r) => r.newPayingLast },
            { key: "rev", label: "Revenue", align: "right", render: (r) => money(r.revenueCents, { whole: true }), sort: (r) => r.revenueCents },
          ]}
        />
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="What brings paying clients" sub={touch === "first" ? "By where they first came from" : "By their last non-direct visit before paying"} action={<Segmented label="Attribution" value={touch} onChange={setTouch} options={[{ value: "first", label: "First touch" }, { value: "last", label: "Last touch" }]} />}>
          <RankRows
            rows={paying.map((c) => ({ key: c.channel, label: label(c.channel), sub: `${touch === "first" ? c.newPayingFirst : c.newPayingLast} new · ${money(c.revenueCents, { whole: true })}`, values: [touch === "first" ? c.newPayingFirst : c.newPayingLast] }))}
            format={(n) => `${n} new`}
            empty="No new paying clients in this period."
          />
        </IntelSection>
        <IntelSection title="Traffic by channel" sub="Visits, and how many of them engaged">
          <RankRows
            rows={withVisits.map((c) => ({ key: c.channel, label: label(c.channel), sub: `${percent(c.engagementRate)} engaged`, values: [c.engaged, c.sessions - c.engaged] }))}
            parts={[{ label: "Engaged", color: "var(--viz-1)" }, { label: "Bounced", color: "var(--viz-2)" }]}
            format={(n) => count(n)}
            empty="No tracked visits in this period."
          />
        </IntelSection>
      </div>

      <IntelSection title="Campaigns" sub="Links tagged with ?utm_campaign=… (sign-ups by the campaign people first came from)">
        <DataTable
          rows={v.campaigns}
          rowKey={(r) => r.campaign}
          empty="No tagged campaigns in this period. Add ?utm_source=instagram&utm_campaign=… to the links you post to see them here."
          columns={[
            { key: "c", label: "Campaign", render: (r) => <span className="font-medium">{r.campaign}</span>, sort: (r) => r.campaign },
            { key: "ch", label: "Channel", render: (r) => label(r.channel) },
            { key: "s", label: "Visits", align: "right", render: (r) => count(r.sessions), sort: (r) => r.sessions },
            { key: "v", label: "Visitors", align: "right", render: (r) => count(r.visitors), sort: (r) => r.visitors },
            { key: "e", label: "Engaged", align: "right", render: (r) => count(r.engaged), sort: (r) => r.engaged },
            { key: "r", label: "Sign-ups", align: "right", render: (r) => count(r.registrations), sort: (r) => r.registrations },
            { key: "a", label: "Applications", align: "right", render: (r) => count(r.memberApps + r.coachingApps), sort: (r) => r.memberApps + r.coachingApps },
          ]}
        />
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Landing pages" sub="Where website visits started, and how many of those visitors applied">
          <DataTable
            rows={v.landingPages}
            rowKey={(r) => r.path}
            limit={10}
            columns={[
              { key: "p", label: "Page", render: (r) => <span className="font-mono text-[12px]">{r.path}</span>, sort: (r) => r.path },
              { key: "s", label: "Visits", align: "right", render: (r) => count(r.sessions), sort: (r) => r.sessions },
              { key: "e", label: "Engaged", align: "right", render: (r) => percent(r.sessions ? Math.round((r.engaged / r.sessions) * 100) : null), sort: (r) => (r.sessions ? r.engaged / r.sessions : null) },
              { key: "c", label: "Applied", align: "right", render: (r) => `${r.converted}${r.conversionRate != null ? ` (${r.conversionRate}%)` : ""}`, sort: (r) => r.converted },
            ]}
          />
        </IntelSection>
        <IntelSection title="Referring sites and in-app browsers" sub="The site that sent the visit, and where the link was opened">
          <RankRows rows={v.referrers.slice(0, 8).map((r) => ({ key: r.host, label: r.host, sub: label(r.channel), values: [r.sessions] }))} format={(n) => `${count(n)} visits`} empty="No referring sites in this period." />
          <div className="mt-4 border-t pt-3">
            <RankRows rows={Object.entries(v.browsers).sort((a, b) => b[1] - a[1]).map(([k, n]) => ({ key: k, label: BROWSER[k] ?? k, values: [n] }))} format={(n) => `${count(n)} visits`} />
          </div>
        </IntelSection>
      </div>

      <Definitions
        items={[
          { term: "Channel", text: "Read from the link that opened the visit: its referrer's site, ?utm_source / ?utm_medium, or a ?from= on your own links (lib/bi/channels.ts). Paid tags win over the platform." },
          { term: "Direct", text: "Typed in, a bookmark, the installed app, or a referrer the browser hid. Those can't be told apart." },
          { term: "First touch", text: "Where the person first came from: a browser they signed in on (tracked since Nov 23 2026), their application form, or the source on their record." },
          { term: "Last touch", text: "Their last visit before their first payment that came from somewhere other than Direct." },
          { term: "Revenue by channel", text: "Payments less refunds before tax in this period, from every paying client, by their first touch." },
          ...Object.entries(CHANNEL_HELP).map(([k, t]) => ({ term: CHANNEL_LABEL[k as Channel], text: t })),
        ]}
      />
    </div>
  );
}

function Change({ now, before }: { now: number; before: number | null }) {
  if (before == null) return null; // visits weren't recorded for all of the period before
  const d = pctChange(now, before);
  if (d == null) return null;
  return <span className="ml-1 text-[11px] text-muted-foreground">{d > 0 ? "+" : ""}{d}%</span>;
}
