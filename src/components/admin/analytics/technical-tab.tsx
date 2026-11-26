/**
 * Technical Performance: how fast and how reliably the app and site run for customers (your team's
 * visits left out). Web vitals measured in each visitor's own browser (75th percentile, Google's
 * thresholds), script errors with where they happen, requests that failed by area, pages not found,
 * devices, browsers and systems, and the money and messaging failures that break a flow.
 */
import { Link } from "@tanstack/react-router";
import { Definitions, IntelSection, Kpi, RankRows } from "@/components/admin/intel/intel-ui";
import { PLATFORM_LABEL, DEVICE_LABEL } from "@/lib/app-pulse/pulse-rules";
import { VITAL_LABEL, VITAL_THRESHOLDS, rateVital, type Vital } from "@/lib/bi/events";
import { count, percent, type TechnicalView } from "@/lib/bi/model";
import { cn } from "@/lib/utils";
import { DataTable, SinceNote } from "./bi-ui";
import { useBiTab, type TabProps } from "./analytics-page";

const OS: Record<string, string> = { ios: "iOS / iPadOS", android: "Android", macos: "macOS", windows: "Windows", linux: "Linux", chromeos: "ChromeOS", other: "Other", unknown: "Not recorded" };
const BROWSER: Record<string, string> = {
  safari: "Safari", chrome: "Chrome", firefox: "Firefox", edge: "Edge", samsung: "Samsung Internet", opera: "Opera",
  instagram: "Instagram in-app", facebook: "Facebook in-app", tiktok: "TikTok in-app", webview: "JF Effect app", other: "Other", unknown: "Not recorded",
};
const KIND: Record<string, string> = { network: "Network", timeout: "Timed out", session: "Signed out", forbidden: "Not allowed", not_found: "Not found", rate: "Too many requests", server: "Server error", other: "Other" };

function vitalValue(metric: string, v: number | null): string {
  if (v == null) return "–";
  if (metric === "CLS") return (Math.round(v * 1000) / 1000).toString();
  return v >= 1000 ? `${(v / 1000).toFixed(2)}s` : `${Math.round(v)}ms`;
}

export function TechnicalTab({ range }: TabProps) {
  const q = useBiTab<TechnicalView>("technical", range);
  const v = q.data;
  if (!v) return <div />;
  const vitals = (["LCP", "INP", "CLS", "FCP", "TTFB"] as Vital[]).map((m) => v.vitals.find((x) => x.metric === m) ?? { metric: m, n: 0, p75: null, good: 0, ni: 0, poor: 0, goodRate: null });
  const dist = (o: Record<string, number>, labels: Record<string, string>) =>
    Object.entries(o)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => ({ key: k, label: labels[k] ?? k, values: [n] }));
  return (
    <div className="space-y-4">
      <SinceNote>
        Speed and errors are measured in each visitor's own browser {v.eventsSince ? `since ${v.eventsSince.slice(0, 10)}` : "from this release on"}; earlier periods have none. Your team's visits are left out.
      </SinceNote>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-5" data-vitals>
        {vitals.map((x) => {
          const rating = x.p75 == null ? null : rateVital(x.metric as Vital, x.p75);
          const [good, poor] = VITAL_THRESHOLDS[x.metric as Vital];
          return (
            <div key={x.metric} className={cn("rounded-2xl border bg-card p-4", rating === "poor" && "border-destructive/40", rating === "ni" && "border-amber-500/40")}>
              <div className="text-[13px] text-muted-foreground">{VITAL_LABEL[x.metric as Vital]}</div>
              <div className="mt-1 text-2xl font-semibold tabular-nums">{vitalValue(x.metric, x.p75)}</div>
              <div className="mt-1 text-[12px] text-muted-foreground">
                {x.metric} · {x.n ? `${count(x.n)} readings · ${percent(x.goodRate)} good` : "no readings yet"}
              </div>
              <div className="text-[11px] text-muted-foreground">good ≤ {vitalValue(x.metric, good)} · poor &gt; {vitalValue(x.metric, poor)}</div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Visits with an error" value={percent(v.errors.rate)} sub={`${v.errors.sessions} of ${count(v.sessions)} visits · ${v.errors.events} errors`} tone={v.errors.rate != null && v.errors.rate >= 5 ? "warn" : "neutral"} />
        <Kpi label="Failed requests" value={count(v.failedRequests.reduce((s, f) => s + f.n, 0))} sub={(() => { const n = v.failedRequests.reduce((s, f) => s + f.sessions, 0); return `in ${count(n)} visit${n === 1 ? "" : "s"} (the person's own connection left out)`; })()} />
        <Kpi label="Payments failing" value={count(v.payments.failingSubscriptions + v.payments.planPaymentsWaiting)} sub={`${v.payments.failingSubscriptions} subscriptions · ${v.payments.planPaymentsWaiting} plan changes waiting`} tone={v.payments.failingSubscriptions ? "bad" : "neutral"} to="/admin/plans" />
        <Kpi label="AI calls failed" value={percent(v.ai.rate)} sub={`${v.ai.failed} of ${count(v.ai.calls)} · texts undelivered ${v.sms.undelivered}`} to="/admin/usage" />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Slowest areas" sub="Largest content shown and response to taps, 75th percentile, by area of the app or site">
          <DataTable
            rows={v.vitalsByFeature.filter((x) => x.n > 0)}
            rowKey={(r) => `${r.feature}|${r.metric}`}
            limit={10}
            initialSort={{ key: "p", desc: true }}
            empty="No readings yet."
            columns={[
              { key: "f", label: "Area", render: (r) => <span className="font-medium">{r.feature}</span>, sort: (r) => r.feature },
              { key: "m", label: "Metric", render: (r) => r.metric },
              { key: "p", label: "p75", align: "right", render: (r) => vitalValue(r.metric, r.p75), sort: (r) => (r.metric === "LCP" ? (r.p75 ?? 0) / 2500 : (r.p75 ?? 0) / 200) },
              { key: "n", label: "Readings", align: "right", render: (r) => count(r.n), sort: (r) => r.n },
              { key: "po", label: "Poor", align: "right", render: (r) => count(r.poor), sort: (r) => r.poor },
            ]}
          />
        </IntelSection>
        <IntelSection title="By device" sub="75th percentile">
          <DataTable
            rows={v.vitalsByDevice.filter((x) => ["LCP", "INP", "CLS"].includes(x.metric))}
            rowKey={(r) => `${r.metric}|${r.device}`}
            limit={9}
            empty="No readings yet."
            columns={[
              { key: "d", label: "Device", render: (r) => DEVICE_LABEL[r.device] ?? r.device, sort: (r) => r.device },
              { key: "m", label: "Metric", render: (r) => r.metric, sort: (r) => r.metric },
              { key: "p", label: "p75", align: "right", render: (r) => vitalValue(r.metric, r.p75) },
              { key: "n", label: "Readings", align: "right", render: (r) => count(r.n), sort: (r) => r.n },
            ]}
          />
        </IntelSection>
      </div>

      <IntelSection title="Errors" sub="Script errors visitors hit, with anything personal taken out of the message">
        <DataTable
          rows={v.errors.top}
          rowKey={(r) => r.label}
          empty="No errors recorded in this period."
          columns={[
            { key: "l", label: "Error", render: (r) => <span className="font-mono text-[12px]">{r.label}</span> },
            { key: "f", label: "Area", render: (r) => r.feature ?? "–" },
            { key: "n", label: "Times", align: "right", render: (r) => count(r.n), sort: (r) => r.n },
            { key: "s", label: "Visits", align: "right", render: (r) => count(r.sessions), sort: (r) => r.sessions },
            { key: "t", label: "Last seen", align: "right", render: (r) => r.lastAt.slice(0, 10), sort: (r) => r.lastAt },
          ]}
        />
        {v.errorRateByFeature.length > 0 && (
          <p className="mt-3 text-[12px] text-muted-foreground">
            Areas where visits hit errors: {v.errorRateByFeature.slice(0, 6).map((f) => `${f.feature} ${percent(f.rate)} of ${f.sessions}`).join(" · ")}.
          </p>
        )}
      </IntelSection>

      <div className="grid gap-4 lg:grid-cols-2">
        <IntelSection title="Requests that failed" sub="By area of the app and why">
          <RankRows rows={v.failedRequests.map((f) => ({ key: `${f.area}|${f.kind}`, label: f.area, sub: KIND[f.kind] ?? f.kind, values: [f.n] }))} format={(n) => `${count(n)}×`} empty="No failed requests in this period." />
          {v.notFound.length > 0 && (
            <div className="mt-4 border-t pt-3">
              <h3 className="mb-1 text-[13px] font-medium">Pages not found</h3>
              <RankRows rows={v.notFound.map((p) => ({ key: p.path, label: p.path, values: [p.n] }))} format={(n) => `${count(n)}×`} />
            </div>
          )}
        </IntelSection>
        <IntelSection title="Devices, browsers and systems" sub="Customer visits in this period">
          <RankRows rows={dist(v.byDevice, DEVICE_LABEL)} format={(n) => count(n)} />
          <div className="mt-4 border-t pt-3"><RankRows rows={dist(v.byPlatform, PLATFORM_LABEL)} format={(n) => count(n)} /></div>
          <div className="mt-4 border-t pt-3"><RankRows rows={dist(v.byBrowser, BROWSER)} format={(n) => count(n)} /></div>
          <div className="mt-4 border-t pt-3"><RankRows rows={dist(v.byOs, OS)} format={(n) => count(n)} /></div>
        </IntelSection>
      </div>
      <p className="text-[12px] text-muted-foreground">
        AI and text-message cost and failures in detail: <Link to="/admin/usage" className="underline-offset-2 hover:underline">Usage &amp; spend</Link>.
      </p>
      <Definitions
        items={[
          { term: "Largest content shown (LCP)", text: "How long until the biggest thing on the first screen appears. Good under 2.5s." },
          { term: "Response to taps (INP)", text: "How long the slowest tap or key took to show a response. Good under 200ms." },
          { term: "Layout shift (CLS)", text: "How much the page jumps around while it loads. Good under 0.1." },
          { term: "75th percentile", text: "Three in four visits were at least this fast. Google judges sites the same way." },
          { term: "Failed request", text: "A screen's data or a save that couldn't complete, by its area; one a minute per area and reason. A person's own lost connection is left out." },
        ]}
      />
    </div>
  );
}
