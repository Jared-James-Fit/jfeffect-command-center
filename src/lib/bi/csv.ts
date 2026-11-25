/**
 * CSV for the Analytics tabs (Nov 25 2026). Pure. Each tab exports the tables it shows, one block
 * per table with its title, so a spreadsheet opens with everything that was on screen. Cells that
 * start with = + - @ are prefixed with ' so a spreadsheet never runs them as a formula.
 */
import { CHANNEL_LABEL } from "./channels";
import {
  ATTRIBUTION_LABEL,
  SEGMENT_LABEL,
  VISIT_KPIS,
  countryName,
  type AcquisitionView,
  type BiTab,
  type ConversionsView,
  type EngagementView,
  type GeographyView,
  type OverviewView,
  type RetentionView,
  type RevenueView,
  type TechnicalView,
} from "./model";
import type { BiInsight } from "./insights";

export type CsvTable = { title: string; header: string[]; rows: (string | number | null | undefined)[][] };

export function csvCell(v: string | number | null | undefined): string {
  if (v == null) return "";
  let s = typeof v === "number" ? (Number.isFinite(v) ? String(v) : "") : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(tables: CsvTable[]): string {
  const out: string[] = [];
  for (const t of tables) {
    if (out.length) out.push("");
    out.push(csvCell(t.title));
    out.push(t.header.map(csvCell).join(","));
    for (const r of t.rows) out.push(r.map(csvCell).join(","));
  }
  return out.join("\r\n") + "\r\n";
}

const dollars = (cents: number | null | undefined) => (cents == null ? null : Math.round(cents) / 100);
const ch = (c: string | null) => (c == null ? "" : (CHANNEL_LABEL as Record<string, string>)[c] ?? (c === "untracked" ? "Not tracked" : c));

export type TabData = {
  overview?: OverviewView;
  acquisition?: AcquisitionView;
  geography?: GeographyView;
  conversions?: ConversionsView;
  engagement?: EngagementView;
  retention?: RetentionView;
  revenue?: RevenueView;
  technical?: TechnicalView;
  insights?: BiInsight[];
};

export function tablesFor(tab: BiTab, d: TabData): CsvTable[] {
  switch (tab) {
    case "overview": {
      const v = d.overview;
      if (!v) return [];
      const keys: [string, keyof OverviewView["current"]][] = [
        ["Visitors", "visitors"], ["New visitors", "newVisitors"], ["Returning visitors", "returningVisitors"],
        ["Sessions", "sessions"], ["Engagement rate %", "engagementRate"], ["Bounce rate %", "bounceRate"],
        ["Average session seconds", "avgSessionSeconds"], ["Active people", "activePeople"], ["Average daily active", "dauAvg"],
        ["Weekly active (last 7 days)", "wau"], ["Monthly active (last 30 days)", "mau"], ["New accounts", "registrations"],
        ["Membership applications", "memberApplications"], ["Coaching applications", "coachingApplications"],
        ["New paying clients", "newPaying"], ["Free to paid", "freeToPaid"], ["Paying clients", "payingClients"],
        ["Coaching clients at start", "clientsAtStart"], ["Coaching clients ended", "clientsEnded"], ["Client retention %", "clientRetention"],
      ];
      return [
        {
          title: `Overview ${v.current.from} to ${v.current.to} vs ${v.previous.from} to ${v.previous.to}`,
          header: ["Metric", "This period", "Period before"],
          rows: [
            // a visit number isn't given for a period before visits were recorded (Nov 23 2026)
            ...keys.map(([label, k]) => [label, v.current[k] as number, !v.prevVisitsTracked && VISIT_KPIS.includes(k) ? null : (v.previous[k] as number)]),
            ["Revenue (CAD, before tax)", dollars(v.current.revenueCents), dollars(v.previous.revenueCents)],
            ["MRR now (CAD)", dollars(v.mrr.mrrCents), null],
          ],
        },
        {
          title: "By day",
          header: ["Day", "Visitors", "Sessions", "Active people", "New accounts", "Applications", "Revenue (CAD)"],
          rows: v.daily.map((r) => [r.day, r.visitors, r.sessions, r.active, r.registrations, r.applications, dollars(r.revenueCents)]),
        },
      ];
    }
    case "acquisition": {
      const v = d.acquisition;
      if (!v) return [];
      return [
        {
          title: "Channels (visits by the visit's own source; sign-ups, clients and revenue by first touch)",
          header: ["Channel", "Sessions", "Sessions before", "Visitors", "Engagement %", "New accounts", "Membership apps", "Coaching apps", "New paying (first touch)", "New paying (last touch)", "Paying clients", "Revenue (CAD)"],
          rows: v.channels.map((c) => [ch(c.channel), c.sessions, c.prevSessions, c.visitors, c.engagementRate, c.registrations, c.memberApps, c.coachingApps, c.newPayingFirst, c.newPayingLast, c.payingClients, dollars(c.revenueCents)]),
        },
        {
          title: "Campaigns",
          header: ["Campaign", "Channel", "Sessions", "Visitors", "Engaged", "New accounts", "Membership apps", "Coaching apps"],
          rows: v.campaigns.map((c) => [c.campaign, ch(c.channel), c.sessions, c.visitors, c.engaged, c.registrations, c.memberApps, c.coachingApps]),
        },
        {
          title: "Landing pages",
          header: ["Page", "Sessions", "Visitors", "Engaged", "Average seconds", "Applied", "Applied %"],
          rows: v.landingPages.map((p) => [p.path, p.sessions, p.visitors, p.engaged, p.avgSeconds, p.converted, p.conversionRate]),
        },
        { title: "Referrers", header: ["Site", "Channel", "Sessions", "Visitors"], rows: v.referrers.map((r) => [r.host, ch(r.channel), r.sessions, r.visitors]) },
        {
          title: "How paying clients were attributed",
          header: ["Method", "Paying clients"],
          rows: Object.entries(v.attribution.payingAll).map(([k, n]) => [ATTRIBUTION_LABEL[k] ?? k, n]),
        },
      ];
    }
    case "geography": {
      const v = d.geography;
      if (!v) return [];
      const head = ["Sessions", "Sessions before", "Visitors", "Registered (placed here)", "New accounts", "Paying now", "New accounts per 100 visitors"];
      const row = (p: GeographyView["countries"][number]) => [p.sessions, p.prevSessions, p.visitors, p.people, p.registrations, p.paying, p.conversion];
      return [
        { title: "Countries", header: ["Country", ...head], rows: v.countries.map((p) => [countryName(p.country), ...row(p)]) },
        { title: "Provinces / states", header: ["Country", "Province / state", ...head], rows: v.regions.map((p) => [countryName(p.country), p.region, ...row(p)]) },
        { title: "Cities (approximate)", header: ["Country", "Province / state", "City", ...head], rows: v.cities.map((p) => [countryName(p.country), p.region, p.city, ...row(p)]) },
      ];
    }
    case "conversions": {
      const v = d.conversions;
      if (!v) return [];
      const m = v.main;
      return [
        {
          title: "Main path (people reaching each step in the period)",
          header: ["Step", "People"],
          rows: [
            ["Website visitors", m.siteVisitors ?? "not recorded for all of this period"], ["Saw the landing or coaching page", m.landing], ["Saw pricing", m.pricing],
            ["Started applying", m.started], ["Sent an application", m.submitted], ["Applications received", m.applications],
            ["New accounts", m.accounts], ["Started a checkout", m.checkout], ["Paid for the first time", m.paid],
            ["Paid 60+ days ago (base)", m.retainedBase], ["Still a client 60 days after paying", m.retained],
          ],
        },
        {
          title: "Coaching application steps reached",
          header: ["Step", "People"],
          rows: Object.entries(v.applySteps).map(([k, n]) => [k, n]),
        },
        { title: "Free membership application steps reached", header: ["Step", "People"], rows: Object.entries(v.joinSteps).map(([k, n]) => [k, n]) },
        {
          title: "Onboarding",
          header: ["Step", "People"],
          rows: [["New accounts", v.onboarding.accounts], ["Free members", v.onboarding.members], ["Finished setup (members)", v.onboarding.setupDone], ["Came back another day", v.onboarding.cameBack], ["Trained in week 1", v.onboarding.trainedWeek1], ["Two weeks old (base)", v.onboarding.week2Base], ["Active in week 2", v.onboarding.week2Active]],
        },
      ];
    }
    case "engagement": {
      const v = d.engagement;
      if (!v) return [];
      return [
        {
          title: "Features by kind of person",
          header: ["Feature", "Segment", "People", "People before", "Adoption %", "Used on 2+ days %", "Days per person", "Times used"],
          rows: v.features.map((f) => [f.label, SEGMENT_LABEL[f.tier] ?? f.tier, f.users, f.prevUsers, f.adoption, f.repeatRate, f.daysPerUser, f.events]),
        },
        { title: "App pages opened", header: ["Area", "Views", "People", "Views before"], rows: v.pages.map((p) => [p.feature, p.views, p.people, p.prevViews]) },
        {
          title: "Early use and staying (association, not cause)",
          header: ["Feature", "Used in first 14 days", "Of them active weeks 5-6 %", "Didn't use", "Of them active weeks 5-6 %"],
          rows: v.association.byFeature.map((f) => [f.label, f.used, f.usedRate, f.notUsed, f.notUsedRate]),
        },
        { title: "Staff tools", header: ["Area", "Views", "Days used", "Staff"], rows: v.staffTools.map((s) => [s.feature, s.views, s.days, s.staff]) },
      ];
    }
    case "retention": {
      const v = d.retention;
      if (!v) return [];
      return [
        { title: "Day N retention", header: ["Day", "Eligible", "Active in window", "Rate %"], rows: v.dayN.map((x) => [`Day ${x.n}`, x.eligible, x.kept, x.rate]) },
        { title: "Weekly cohorts (% active by week after joining)", header: ["Cohort week", "Joined", ...Array.from({ length: 12 }, (_, i) => `W${i}`)], rows: v.weekly.map((c) => [c.cohort, c.size, ...c.cells]) },
        { title: "Monthly cohorts (% active by month after joining)", header: ["Cohort month", "Joined", ...Array.from({ length: 12 }, (_, i) => `M${i}`)], rows: v.monthly.map((c) => [c.cohort, c.size, ...c.cells]) },
        { title: "Coaching clients by month", header: ["Month", "At start", "Started", "Ended", "Churn %"], rows: v.clientsByMonth.map((m) => [m.month, m.activeStart, m.started, m.ended, m.churn]) },
        { title: "At risk", header: ["Name", "Kind", "Last active", "Active days the month before"], rows: v.atRisk.map((p) => [p.name, SEGMENT_LABEL[p.tier] ?? p.tier, p.lastDay, p.priorDays]) },
      ];
    }
    case "revenue": {
      const v = d.revenue;
      if (!v) return [];
      return [
        {
          title: "Revenue by month (CAD, before tax)",
          header: ["Month", "Coaching", "Refunds", "Subscriptions (recurring)", "Credit packs", "Other income", "Total", "Paying clients", "New paying", "Revenue per paying client"],
          rows: v.byMonth.map((m) => [m.month, dollars(m.coachingCents), dollars(m.refundsCents), dollars(m.recurringCents), dollars(m.creditsCents), dollars(m.otherCents), dollars(m.totalCents), m.payingClients, m.newPaying, dollars(m.arppuCents)]),
        },
        { title: "By package (this period)", header: ["Package", "Revenue (CAD)", "Clients", "Payments"], rows: v.byPackage.map((p) => [p.package, dollars(p.revenueCents), p.clients, p.payments]) },
        { title: "MRR by package (now)", header: ["Package", "Subscriptions", "MRR (CAD)"], rows: v.mrr.byPackage.map((p) => [p.package, p.subscriptions, dollars(p.mrrCents)]) },
      ];
    }
    case "technical": {
      const v = d.technical;
      if (!v) return [];
      return [
        { title: "Web vitals (75th percentile)", header: ["Metric", "Readings", "p75", "Good", "Needs improvement", "Poor"], rows: v.vitals.map((x) => [x.metric, x.n, x.p75 == null ? null : Math.round(x.p75 * 1000) / 1000, x.good, x.ni, x.poor]) },
        { title: "Vitals by area", header: ["Area", "Metric", "Readings", "p75", "Poor"], rows: v.vitalsByFeature.map((x) => [x.feature, x.metric, x.n, x.p75 == null ? null : Math.round(x.p75), x.poor]) },
        { title: "Errors", header: ["Error", "Times", "Visits", "Area", "Last seen"], rows: v.errors.top.map((x) => [x.label, x.n, x.sessions, x.feature, x.lastAt]) },
        { title: "Failed requests", header: ["Area", "Kind", "Times", "Visits"], rows: v.failedRequests.map((x) => [x.area, x.kind, x.n, x.sessions]) },
        { title: "Pages not found", header: ["Path", "Times"], rows: v.notFound.map((x) => [x.path, x.n]) },
        { title: "Devices", header: ["Device", "Sessions"], rows: Object.entries(v.byDevice).map(([k, n]) => [k, n]) },
        { title: "Browsers", header: ["Browser", "Sessions"], rows: Object.entries(v.byBrowser).map(([k, n]) => [k, n]) },
        { title: "Operating systems", header: ["OS", "Sessions"], rows: Object.entries(v.byOs).map(([k, n]) => [k, n]) },
      ];
    }
    case "insights": {
      const list = d.insights ?? [];
      return [
        {
          title: "Cleo insights (facts, possible reasons and recommendations)",
          header: ["Title", "Fact", "Possible reason", "Recommendation", "Impact", "Urgency", "Confidence", "Evidence"],
          rows: list.map((i) => [i.title, i.fact, i.hypothesis, i.recommendation, i.impact, i.urgency, i.confidence, i.evidence.join(" | ")]),
        },
      ];
    }
  }
  return [];
}

