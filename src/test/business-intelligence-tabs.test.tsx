/**
 * Every Analytics tab draws (Nov 25 2026): with a quiet period (nothing recorded) and with a
 * filled one shaped like production's own read, so no tab can crash on an empty week or show a
 * placeholder. The reads are the shape functions the server uses, on synthetic rows.
 */
import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import {
  shapeAcquisition,
  shapeConversions,
  shapeEngagement,
  shapeGeography,
  shapeOverview,
  shapeRetention,
  shapeRevenue,
  shapeTechnical,
  type BiTab,
} from "@/lib/bi/model";
import { buildInsights, weeklySummary } from "@/lib/bi/insights";

const data: Partial<Record<BiTab, unknown>> = {};

vi.mock("@/components/admin/analytics/analytics-page", () => ({
  useBiTab: (tab: BiTab) => ({ data: data[tab], isLoading: false, isFetching: false }),
}));
vi.mock("@tanstack/react-router", () => ({
  Link: ({ children, to }: { children: ReactNode; to: string }) => <a href={to}>{children}</a>,
}));
vi.mock("@/hooks/use-cleo-access", () => ({ useCleoAccess: () => true }));
vi.mock("@/lib/cleo-open", () => ({ openSummer: () => undefined }));

const { OverviewTab } = await import("@/components/admin/analytics/overview-tab");
const { AcquisitionTab } = await import("@/components/admin/analytics/acquisition-tab");
const { GeographyTab } = await import("@/components/admin/analytics/geography-tab");
const { ConversionsTab } = await import("@/components/admin/analytics/conversions-tab");
const { EngagementTab } = await import("@/components/admin/analytics/engagement-tab");
const { RetentionTab } = await import("@/components/admin/analytics/retention-tab");
const { RevenueTab } = await import("@/components/admin/analytics/revenue-tab");
const { TechnicalTab } = await import("@/components/admin/analytics/technical-tab");
const { InsightsTab } = await import("@/components/admin/analytics/insights-tab");

const TODAY = "2026-11-25";
const range = { from: "2026-10-27", to: TODAY };
const props = { range, today: TODAY, goTo: () => undefined };

const TABS = [
  ["overview", OverviewTab],
  ["acquisition", AcquisitionTab],
  ["geography", GeographyTab],
  ["conversions", ConversionsTab],
  ["engagement", EngagementTab],
  ["retention", RetentionTab],
  ["revenue", RevenueTab],
  ["technical", TechnicalTab],
  ["insights", InsightsTab],
] as const;

function load(raw: Record<string, unknown>) {
  const overview = shapeOverview(raw.overview);
  const retention = shapeRetention(raw.retention, TODAY);
  const all = {
    overview,
    acquisition: shapeAcquisition(raw.acquisition),
    geography: shapeGeography(raw.geography),
    conversions: shapeConversions(raw.conversions),
    engagement: shapeEngagement(raw.engagement),
    retention,
    revenue: shapeRevenue(raw.revenue, retention.clientsByMonth, TODAY),
    technical: shapeTechnical(raw.technical),
  };
  Object.assign(data, all, {
    insights: {
      insights: buildInsights({ today: TODAY, ...all }),
      weekly: weeklySummary({ from: "2026-11-16", to: "2026-11-22" }, overview.current, overview.previous, overview.mrr.mrrCents),
      generatedFrom: Object.keys(all),
    },
  });
}

const kpis = (o: Record<string, unknown>) => ({ from: "2026-10-27", to: TODAY, days: 30, ...o });

const FILLED = {
  overview: {
    current: kpis({ visitors: 60, new_visitors: 60, sessions: 125, engaged_sessions: 75, avg_session_seconds: 286, median_session_seconds: 34, page_views: 513, site_visitors: 48, active_people: 18, dau_avg: 9.6, wau: 17, mau: 18, registrations: 2, coaching_applications: 1, new_paying: 1, paying_clients: 8, revenue_coaching_cents: 174000, clients_at_start: 22, clients_ended_of_start: 1, clients_started: 2, clients_now: 23 }),
    previous: { from: "2026-09-27", to: "2026-10-26", days: 30, active_people: 16, registrations: 1, paying_clients: 7, revenue_coaching_cents: 150000 },
    daily: [{ day: "2026-11-24", visitors: 20, sessions: 40, active: 12, registrations: 1, applications: 0, revenue_cents: 13000 }],
    mrr: { mrr_cents: 75000, subscriptions: 7, by_package: [{ package: "Complete Online Coaching", subscriptions: 4, mrr_cents: 52000 }], installment_plans: 1 },
    live: 2,
    visits_since: "2026-11-23T08:00:00Z",
    funnel_since: "2026-11-19T06:00:00Z",
  },
  acquisition: {
    prev_tracked: false,
    channels: [
      { channel: "untracked", registrations: 1, paying_clients: 11, revenue_cents: 1683976 },
      { channel: "instagram", sessions: 30, visitors: 12, engaged: 20, avg_seconds: 40 },
      { channel: "direct", sessions: 80, visitors: 40, engaged: 50 },
    ],
    campaigns: [{ campaign: "nov_launch", channel: "instagram", sessions: 9, visitors: 7, engaged: 5 }],
    landing_pages: [{ path: "/", sessions: 50, visitors: 40, engaged: 30, avg_seconds: 30, converted: 1 }],
    referrers: [{ host: "l.instagram.com", channel: "instagram", sessions: 20, visitors: 10 }],
    browsers: { safari: 70, chrome: 40, instagram: 15 },
    attribution: { registrations: { none: 1, application: 1 }, new_paying: { none: 1 }, paying_all: { none: 11, application: 1 } },
    totals: { sessions: 125, prev_sessions: 0, registrations: 2, new_paying: 1, revenue_cents: 174000 },
  },
  geography: {
    prev_tracked: false,
    countries: [{ country: "CA", sessions: 84, visitors: 19, people: 10, registrations: 1, paying: 6 }, { country: "US", sessions: 20, visitors: 15 }],
    regions: [{ country: "CA", region: "Manitoba", sessions: 70, visitors: 14, people: 9, paying: 6 }],
    cities: [{ country: "CA", region: "Manitoba", city: "Winnipeg", lat: 49.9, lng: -97.1, sessions: 70, visitors: 14, live: 1, people: 9, paying: 6 }],
    unplaced_sessions: 21,
    placed_sessions: 104,
    people_placed: 10,
    people_total: 24,
  },
  conversions: {
    main: { site_visitors: null, visits_since: "2026-11-23T08:00:00Z", landing: 180, pricing: 28, started: 1, accounts: 2, checkout: 3, paid: 1, retained_base: 6, retained: 6, applications: 1 },
    free_path: { landing: 170, cta: 4 },
    coaching_path: { coaching_page: 20, pricing: 10, cta: 3, started: 1, applications: 1 },
    apply_steps: { goal: 1, name: 1 },
    checkouts: { links_sent: 3, links_paid: 2 },
    timing: { account_to_paid_days: 5.5, account_to_paid_n: 1 },
    onboarding: { accounts: 2, came_back: 1, trained_week1: 2, week2_base: 1, week2_active: 1 },
  },
  engagement: {
    base: { client: 17, member: 1 },
    base_prev: { client: 16 },
    features: [
      { feature: "workouts", tier: "client", users: 15, events: 120, user_days: 100, repeat_users: 14, prev_users: 14 },
      { feature: "community", tier: "member", users: 1, events: 3, user_days: 2, repeat_users: 1, prev_users: 0 },
    ],
    prev_only: [{ feature: "cardio", tier: "client", prev_users: 2 }],
    pages: [{ feature: "Workouts", views: 300, people: 15, prev_views: 0 }],
    staff_tools: [{ feature: "Analytics", views: 10, days: 1, staff: 1 }],
    staff_cleo: { questions: 12, people: 1 },
    association: { people: 26, stayed: 18, by_feature: [{ feature: "workouts", used: 20, used_stayed: 17, not_used: 6, not_used_stayed: 1 }] },
  },
  retention: {
    day_n: [
      { n: 1, tier: "client", in_range: false, eligible: 21, kept: 9 },
      { n: 7, tier: "client", in_range: false, eligible: 21, kept: 19 },
      { n: 30, tier: "client", in_range: false, eligible: 19, kept: 16 },
      { n: 90, tier: "client", in_range: false, eligible: 17, kept: 12 },
    ],
    weekly: [{ cohort: "2026-11-02", size: 2, weeks: [{ w: 0, active: 2 }, { w: 1, active: 1 }] }],
    monthly: [{ cohort: "2026-06", size: 12, months: [{ m: 0, active: 12 }, { m: 1, active: 11 }, { m: 5, active: 9 }] }],
    status: [{ tier: "client", bucket: "week", n: 15 }, { tier: "client", bucket: "month", n: 1 }],
    at_risk: [{ client_id: "00000000-0000-4000-8000-000000000001", name: "Sam", tier: "client", last_day: "2026-11-10", prior_days: 8 }],
    returning: { active: 18, returning: 16 },
    mau_by_month: [{ month: "2026-10", active: 17 }, { month: "2026-11", active: 18 }],
    clients_by_month: [{ month: "2026-11", started: 2, ended: 1, active_start: 22 }],
    cancellations: 1,
    plan_moves: {},
    activity_since: "2026-06-05",
  },
  revenue: {
    by_month: [{ month: "2026-11", coaching_cents: 174000, recurring_cents: 75000, paying_clients: 8, new_paying: 1 }],
    current: { revenue_cents: 174000, payments: 11, paying_clients: 8 },
    previous: { revenue_cents: 150000, paying_clients: 7 },
    by_package: [{ package: "Complete Online Coaching", revenue_cents: 52000, clients: 4, payments: 4 }],
    mrr: { mrr_cents: 75000, subscriptions: 7, by_package: [{ package: "Complete Online Coaching", subscriptions: 4, mrr_cents: 52000 }] },
    lifetime: { clients: 12, paid_cents: 1696976, ended_clients: 0, first_payment: "2026-05-20" },
    failing: { subscriptions: 0, plan_payments: 0 },
    plan_moves: [],
  },
  technical: {
    sessions: 125,
    by_device: { phone: 90, desktop: 33, tablet: 2 },
    by_platform: { browser: 100, home_screen: 25 },
    by_os: { ios: 80, macos: 30 },
    by_browser: { safari: 80, chrome: 40 },
    vitals: [{ metric: "LCP", n: 40, p75: 2900, good: 20, ni: 15, poor: 5 }],
    vitals_by_device: [{ metric: "LCP", device: "phone", n: 30, p75: 3100 }],
    vitals_by_feature: [{ feature: "Workouts", metric: "LCP", n: 20, p75: 3300, poor: 4 }],
    errors: { events: 3, sessions: 2, people: 2, top: [{ label: "TypeError: Cannot read properties of null", n: 3, sessions: 2, feature: "Workouts", last_at: "2026-11-25T10:00:00Z" }] },
    error_rate_by_feature: [{ feature: "Workouts", sessions: 50, with_errors: 2 }],
    failed_requests: [{ area: "workouts", kind: "server", n: 2, sessions: 1 }],
    not_found: [{ path: "/old", n: 1 }],
    payments: { failing_subscriptions: 0, plan_payments_waiting: 0 },
    ai: { calls: 508, failed: 55 },
    sms: { sent: 10, undelivered: 0 },
    events_since: "2026-11-25T20:00:00Z",
  },
};

describe("every Analytics tab draws", () => {
  for (const [label, raw] of [
    ["a quiet period with nothing recorded", {}],
    ["a filled period", FILLED],
  ] as const) {
    it(`with ${label}`, () => {
      load(raw as Record<string, unknown>);
      for (const [tab, Tab] of TABS) {
        const html = renderToStaticMarkup(<Tab {...props} />);
        expect(html.length, tab).toBeGreaterThan(200);
        expect(html, tab).not.toMatch(/NaN|undefined|\[object Object\]|Infinity/);
      }
    });
  }

  it("says how much comes from before tracking instead of comparing it", () => {
    load(FILLED);
    const conv = renderToStaticMarkup(<ConversionsTab {...props} />);
    expect(conv).not.toContain("Website visitors");
    expect(conv).toContain("starts at the landing page");
    const over = renderToStaticMarkup(<OverviewTab {...props} />);
    expect(over).toContain("Monthly recurring revenue");
    expect(over).toContain("$750");
  });
});
