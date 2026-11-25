/**
 * App Engagement: which features people use, how often, and by whom (free members, coaching
 * clients, applicants), from each feature's own records. Underused features are flagged, and early
 * use is compared with staying, always said as an association (committed people do more of
 * everything), never as a cause. Your team's own use of the coaching tools is apart, at the end.
 */
import { useMemo, useState } from "react";
import { Definitions, IntelSection, RankRows } from "@/components/admin/intel/intel-ui";
import { FEATURES, SEGMENT_LABEL, count, featureTotals, percent, type EngagementView } from "@/lib/bi/model";
import { pct, pctChange } from "@/lib/bi/period";
import { DataTable, Segmented, ShareBar, SinceNote } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

type Seg = "all" | "member" | "client";

export function EngagementTab({ range }: TabProps) {
  const q = useBiTab<EngagementView>("engagement", range);
  const [seg, setSeg] = useState<Seg>("all");
  const v = q.data;
  const rows = useMemo(() => {
    if (!v) return [];
    if (seg === "all") return featureTotals(v).map((t) => ({ ...t, repeat: t.repeatRate, days: null as number | null, change: pctChange(t.users, t.prevUsers) }));
    const base = v.base[seg] ?? 0;
    return FEATURES.map((f) => {
      const r = v.features.find((x) => x.feature === f.key && x.tier === seg);
      return r
        ? { feature: f.key, label: f.label, users: r.users, prevUsers: r.prevUsers, adoption: pct(r.users, base), repeat: r.repeatRate, days: r.daysPerUser, change: r.change }
        : null;
    })
      .filter((x): x is NonNullable<typeof x> => !!x)
      .sort((a, b) => b.users - a.users);
  }, [v, seg]);
  if (!v) return <div />;
  const base = seg === "all" ? Object.values(v.base).reduce((s, n) => s + n, 0) : v.base[seg] ?? 0;
  const baseBefore = seg === "all" ? Object.values(v.basePrev).reduce((s, n) => s + n, 0) : v.basePrev[seg] ?? 0;
  const quiet = rows.filter((r) => r.adoption != null && r.adoption < 15 && base >= 5);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Segmented
          label="Who"
          value={seg}
          onChange={setSeg}
          options={[
            { value: "all", label: "Everyone" },
            { value: "member", label: SEGMENT_LABEL.member },
            { value: "client", label: SEGMENT_LABEL.client },
          ]}
        />
        <span className="text-[13px] text-muted-foreground">
          <span className="font-semibold text-foreground">{count(base)}</span> active in this period
          {baseBefore ? ` (${baseBefore} the period before)` : ""}
        </span>
      </div>
      <IntelSection title="Feature adoption" sub="People who used each feature in the period, as a share of everyone active; how many used it on 2+ days">
        <DataTable
          rows={rows}
          rowKey={(r) => r.feature}
          limit={15}
          columns={[
            { key: "f", label: "Feature", render: (r) => <span className="font-medium" title={FEATURES.find((f) => f.key === r.feature)?.help}>{r.label}</span>, sort: (r) => r.label },
            { key: "u", label: "People", align: "right", render: (r) => count(r.users), sort: (r) => r.users },
            { key: "a", label: "Adoption", align: "right", render: (r) => <ShareBar pct={r.adoption} tone={r.adoption != null && r.adoption < 15 && base >= 5 ? "warn" : "neutral"} />, sort: (r) => r.adoption },
            { key: "r", label: "2+ days", align: "right", render: (r) => percent(r.repeat), sort: (r) => r.repeat },
            ...(seg === "all" ? [] : [{ key: "d", label: "Days each", align: "right" as const, render: (r: (typeof rows)[number]) => (r.days == null ? "–" : r.days), sort: (r: (typeof rows)[number]) => r.days }]),
            { key: "c", label: "vs before", align: "right", render: (r) => (r.change == null ? (r.prevUsers === 0 && r.users > 0 ? "new" : "–") : `${r.change > 0 ? "+" : ""}${r.change}%`), sort: (r) => r.change },
          ]}
        />
        {quiet.length > 0 && (
          <p className="mt-3 rounded-lg bg-amber-500/10 px-3 py-2 text-[13px]">
            Underused: {quiet.map((r) => `${r.label} (${percent(r.adoption)})`).join(", ")}. Fewer than 15% of active people used them.
          </p>
        )}
      </IntelSection>

      <IntelSection
        title="Early use and staying"
        sub="Of people who joined 6 weeks to 7 months ago: active in weeks 5–6 if they used a feature in their first 14 days, against those who didn't"
      >
        <SinceNote>An association, not a cause: people who are more committed tend to do more of everything. Groups under 5 people aren't compared.</SinceNote>
        <div className="mt-3">
          <DataTable
            rows={v.association.byFeature}
            rowKey={(r) => r.feature}
            empty="Not enough people have been here 6 weeks yet."
            columns={[
              { key: "f", label: "Feature", render: (r) => <span className="font-medium">{r.label}</span> },
              { key: "u", label: "Used early", align: "right", render: (r) => `${r.usedStayed}/${r.used}`, sort: (r) => r.used },
              { key: "ur", label: "Stayed", align: "right", render: (r) => percent(r.usedRate), sort: (r) => r.usedRate },
              { key: "n", label: "Didn't", align: "right", render: (r) => `${r.notUsedStayed}/${r.notUsed}`, sort: (r) => r.notUsed },
              { key: "nr", label: "Stayed", align: "right", render: (r) => percent(r.notUsedRate), sort: (r) => r.notUsedRate },
              { key: "l", label: "Difference", align: "right", render: (r) => (r.lift == null ? "–" : `${r.lift > 0 ? "+" : ""}${r.lift} pts`), sort: (r) => r.lift },
            ]}
          />
        </div>
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Pages opened in the app" sub="Members and clients, by area (visits since Nov 23 2026)">
          <RankRows rows={v.pages.map((p) => ({ key: p.feature, label: p.feature, sub: `${p.people} people`, values: [p.views] }))} format={(n) => `${count(n)} views`} empty="No app pages recorded in this period." />
        </IntelSection>
        <IntelSection title="Your team's tools" sub="Staff pages opened (never counted above)">
          <RankRows rows={v.staffTools.slice(0, 12).map((s) => ({ key: s.feature, label: s.feature, sub: `${s.days} days`, values: [s.views] }))} format={(n) => `${count(n)} views`} empty="No staff pages recorded in this period." />
          <p className="mt-3 text-[12px] text-muted-foreground">Cleo: {v.staffCleo.questions} questions from {v.staffCleo.people} of your team.</p>
        </IntelSection>
      </div>
      <Definitions items={FEATURES.map((f) => ({ term: f.label, text: f.help }))} />
    </div>
  );
}
