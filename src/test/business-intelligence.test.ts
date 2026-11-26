/**
 * Business intelligence (Nov 25 2026): the Analytics section's pure parts. Channels (and their SQL
 * twin's cases), the event catalog and what it cleans, periods, the shaping of each tab's read, the
 * metrics worked out from them, Cleo's rule-based insights and weekly summary, the CSV export and
 * Cleo's analytics text.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CHANNEL_CASES, channelOf, hostOf } from "@/lib/bi/channels";
import { BI_EVENT_NAMES, cleanErrorLabel, cleanEvent, rateVital } from "@/lib/bi/events";
import {
  addDays,
  checkedRange,
  daysBetween,
  lastFullWeek,
  pct,
  pctChange,
  previousRange,
  rangeFor,
  rangeLabel,
} from "@/lib/bi/period";
import {
  biggestDrop,
  featureTotals,
  lifetimeValue,
  money,
  shapeAcquisition,
  shapeEngagement,
  shapeKpis,
  shapeMrr,
  shapeOverview,
  shapeRetention,
  shapeRevenue,
  shapeConversions,
  shapeGeography,
  shapeTechnical,
  kpiDelta,
  visitsCover,
} from "@/lib/bi/model";
import { buildInsights, confidenceFor, weeklySummary } from "@/lib/bi/insights";
import { csvCell, tablesFor, toCsv } from "@/lib/bi/csv";
import { analyticsText, ANALYTICS_RULES } from "@/lib/bi/cleo-text";
import { browserOf, featureOf } from "@/lib/app-pulse/pulse-rules";

const MIGRATION = readFileSync("supabase/migrations/20270530090000_business_intelligence.sql", "utf8");

describe("channels", () => {
  it.each(CHANNEL_CASES)("$in → $out", (c) => {
    expect(channelOf(c.in)).toBe(c.out);
  });
  it("reads a referrer as a bare host", () => {
    expect(hostOf("https://www.l.instagram.com/?u=x")).toBe("l.instagram.com");
    expect(hostOf("android-app://com.instagram.android")).toBe("com.instagram.android");
    expect(hostOf("instagram.com/p/123")).toBe("instagram.com");
    expect(hostOf("not a host!")).toBe("");
    expect(hostOf(null)).toBe("");
  });
  it("the SQL twin lists the same channels and is applied to old and new visits", () => {
    for (const ch of ["instagram", "youtube", "tiktok", "facebook", "google", "search", "social", "paid", "email", "referral", "other", "direct"]) {
      expect(MIGRATION).toContain(`'${ch}'`);
    }
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.bi_channel");
    expect(MIGRATION).toMatch(/UPDATE public\.app_sessions\s+SET channel = public\.bi_channel/);
  });
});

describe("event catalog", () => {
  const id = "11111111-1111-4111-8111-111111111111";
  it("keeps only cataloged events with a device id", () => {
    expect(cleanEvent({ id, name: "evil", label: "x" })).toBeNull();
    expect(cleanEvent({ id: "nope", name: "js_error", label: "x" })).toBeNull();
    expect(cleanEvent(null)).toBeNull();
    expect(BI_EVENT_NAMES).toEqual(["web_vital", "js_error", "request_failed", "page_not_found"]);
    // the database's own list says the same
    expect(MIGRATION).toContain("ARRAY['web_vital', 'js_error', 'request_failed', 'page_not_found']");
  });
  it("rates and rounds vitals, and refuses impossible ones", () => {
    const lcp = cleanEvent({ id, name: "web_vital", label: "lcp", value: 3000.4, path: "/portal?x=1", feature: "Home" })!;
    expect(lcp).toMatchObject({ label: "LCP", value: 3000, rating: "ni", path: "/portal" });
    expect(cleanEvent({ id, name: "web_vital", label: "CLS", value: 0.12345 })!.value).toBe(0.123);
    expect(cleanEvent({ id, name: "web_vital", label: "XYZ", value: 1 })).toBeNull();
    expect(cleanEvent({ id, name: "web_vital", label: "LCP", value: -5 })).toBeNull();
    expect(rateVital("INP", 200)).toBe("good");
    expect(rateVital("INP", 201)).toBe("ni");
    expect(rateVital("INP", 501)).toBe("poor");
    expect(rateVital("CLS", 0.3)).toBe("poor");
  });
  it("takes anything personal out of an error message", () => {
    const s = cleanErrorLabel('No client 9f1c2a3b-1111-4111-8111-111111111111 for jane.doe@example.com at https://x.com/a?b=1 "Jane Doe" #123456');
    expect(s).not.toMatch(/jane|Jane|9f1c|example\.com|123456|https/);
    expect(s).toContain(":id");
    expect(s).toContain(":email");
    expect(cleanErrorLabel("Cannot read properties of undefined (reading 'map')")).toBe("Cannot read properties of undefined (reading 'map')");
    expect(cleanErrorLabel("")).toBe("Unknown error");
    expect(cleanErrorLabel("x".repeat(500)).length).toBeLessThanOrEqual(120);
  });
  it("names a failed request by area and kind only", () => {
    const e = cleanEvent({ id, name: "request_failed", label: ["client-billing", "abc"], rating: "server" })!;
    expect(e.label).toBe("client-billing-abc");
    expect(cleanEvent({ id, name: "request_failed", label: "Client Billing!!", rating: "weird" })).toMatchObject({ label: "client-billing", rating: "other" });
  });
});

describe("visits", () => {
  it("tells in-app browsers apart", () => {
    expect(browserOf("Mozilla/5.0 (iPhone) AppleWebKit Instagram 300.0")).toBe("instagram");
    expect(browserOf("Mozilla/5.0 (iPhone) [FBAN/FBIOS;FBAV/400]")).toBe("facebook");
    expect(browserOf("Mozilla/5.0 (Macintosh) AppleWebKit Version/17.0 Safari/605")).toBe("safari");
    expect(browserOf("Mozilla/5.0 (Windows) Chrome/120 Safari/537 Edg/120")).toBe("edge");
    expect(browserOf("Mozilla/5.0 (Linux; Android) Chrome/120 Mobile Safari")).toBe("chrome");
    expect(browserOf("Mozilla/5.0 (iPhone) AppleWebKit", true)).toBe("webview");
  });
  it("files the new pages under their area", () => {
    expect(featureOf("/admin/insights")).toBe("Analytics");
    expect(featureOf("/portal/competition")).toBe("Competition");
  });
});

describe("periods", () => {
  it("presets end today; a custom range is put in order, capped and never past today", () => {
    expect(rangeFor("7d", "2026-11-25")).toEqual({ from: "2026-11-19", to: "2026-11-25" });
    expect(rangeFor("custom", "2026-11-25", { from: "2026-11-30", to: "2026-11-01" })).toEqual({ from: "2026-11-01", to: "2026-11-25" });
    const long = rangeFor("custom", "2026-11-25", { from: "2020-01-01", to: "2026-11-25" });
    expect(daysBetween(long.from, long.to)).toBe(400);
    expect(checkedRange("garbage", "2026-11-25", "2026-11-25")).toEqual(rangeFor("30d", "2026-11-25"));
  });
  it("compares with the same number of days just before", () => {
    expect(previousRange({ from: "2026-11-19", to: "2026-11-25" })).toEqual({ from: "2026-11-12", to: "2026-11-18" });
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
  });
  it("finds the last full Monday–Sunday week", () => {
    // Nov 25 2026 is a Wednesday
    expect(lastFullWeek("2026-11-25").week).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(lastFullWeek("2026-11-23").week).toEqual({ from: "2026-11-16", to: "2026-11-22" });
    expect(lastFullWeek("2026-11-22").week).toEqual({ from: "2026-11-09", to: "2026-11-15" });
    expect(rangeLabel({ from: "2026-11-16", to: "2026-11-22" })).toBe("Nov 16 – Nov 22, 2026");
  });
  it("changes and shares are null without a base", () => {
    expect(pctChange(5, 0)).toBeNull();
    expect(pctChange(15, 10)).toBe(50);
    expect(pct(1, 0)).toBeNull();
    expect(pct(1, 3, 1)).toBe(33.3);
  });
});

describe("shaping", () => {
  it("works out rates from counts and never invents a base", () => {
    const k = shapeKpis({ sessions: 10, engaged_sessions: 4, visitors: 8, new_visitors: 9, clients_at_start: 5, clients_ended_of_start: 1, revenue_coaching_cents: 1000, revenue_credits_cents: 299, revenue_other_cents: 1 });
    expect(k.engagementRate).toBe(40);
    expect(k.bounceRate).toBe(60);
    expect(k.newVisitors).toBe(8);
    expect(k.returningVisitors).toBe(0);
    expect(k.clientRetention).toBe(80);
    expect(k.revenueCents).toBe(1300);
    const empty = shapeKpis({});
    expect(empty.engagementRate).toBeNull();
    expect(empty.clientRetention).toBeNull();
  });
  it("MRR per subscription only with subscriptions", () => {
    expect(shapeMrr({ mrr_cents: 26000, subscriptions: 2 }).perSubscriptionCents).toBe(13000);
    expect(shapeMrr({}).perSubscriptionCents).toBeNull();
  });
  it("finds the step where most people stop, ignoring tiny bases", () => {
    const d = biggestDrop([
      { label: "A", value: 100 },
      { label: "B", value: 80 },
      { label: "C", value: 10 },
      { label: "D", value: 1 },
    ], 15);
    expect(d).toMatchObject({ from: "B", to: "C", keptPct: 13 });
    expect(biggestDrop([{ label: "A", value: 3 }, { label: "B", value: 0 }], 5)).toBeNull();
  });
  it("leaves a cohort's future cells empty, never zero", () => {
    const r = shapeRetention({ weekly: [{ cohort: "2026-11-16", size: 4, weeks: [{ w: 0, active: 4 }] }] }, "2026-11-25");
    expect(r.weekly[0].cells.slice(0, 3)).toEqual([100, 0, null]);
  });
  it("only gives a lifetime value with enough history", () => {
    const months = ["2026-07", "2026-08", "2026-09", "2026-10", "2026-11"].map((m) => ({ month: m, coachingCents: 26000, refundsCents: 0, recurringCents: 0, creditsCents: 0, otherCents: 0, totalCents: 26000, payingClients: 2, newPaying: 0, arppuCents: 13000 }));
    const fewEnded = lifetimeValue(months, [{ month: "2026-10", started: 0, ended: 1, activeStart: 10, churn: 10 }], "2026-11-25");
    expect(fewEnded.cents).toBeNull();
    expect(fewEnded.reason).toMatch(/at least 3 clients/);
    const enough = lifetimeValue(months, ["2026-08", "2026-09", "2026-10"].map((m) => ({ month: m, started: 0, ended: 1, activeStart: 10, churn: 10 })), "2026-11-25");
    // 13000 a month ÷ 10% monthly churn
    expect(enough.cents).toBe(130000);
    expect(enough.monthlyChurn).toBe(10);
    // the current part-month never counts
    expect(lifetimeValue(months.slice(-2), [], "2026-11-25").reason).toMatch(/full months/);
  });
  it("sorts channels by what they bring, not traffic", () => {
    const a = shapeAcquisition({ channels: [
      { channel: "tiktok", sessions: 500, visitors: 400 },
      { channel: "instagram", sessions: 50, visitors: 40, revenue_cents: 26000, new_paying_first: 2, registrations: 3 },
    ] });
    expect(a.channels.map((c) => c.channel)).toEqual(["instagram", "tiktok"]);
    expect(a.channels[0].signupRate).toBe(8);
  });
  it("adds each feature up across segments, adoption of everyone active", () => {
    const e = shapeEngagement({
      base: { member: 6, client: 4 },
      features: [
        { feature: "workouts", tier: "member", users: 3, repeat_users: 1, user_days: 5, events: 5, prev_users: 2 },
        { feature: "workouts", tier: "client", users: 4, repeat_users: 4, user_days: 12, events: 12, prev_users: 4 },
      ],
      association: { by_feature: [{ feature: "workouts", used: 6, used_stayed: 4, not_used: 5, not_used_stayed: 1 }] },
    });
    const w = featureTotals(e).find((f) => f.feature === "workouts")!;
    expect(w).toMatchObject({ users: 7, adoption: 70, repeatRate: 71 });
    expect(e.association.byFeature[0]).toMatchObject({ usedRate: 67, notUsedRate: 20, lift: 47 });
    // under 5 a side is never compared
    const small = shapeEngagement({ association: { by_feature: [{ feature: "workouts", used: 2, used_stayed: 2, not_used: 9, not_used_stayed: 1 }] } });
    expect(small.association.byFeature[0].lift).toBeNull();
  });
});

function overviewFixture(cur: Record<string, unknown>, prev: Record<string, unknown>, extra: Record<string, unknown> = {}) {
  return shapeOverview({ current: cur, previous: prev, daily: [], mrr: { mrr_cents: 0, subscriptions: 0 }, live: 0, ...extra });
}

describe("Cleo's insights", () => {
  it("stays quiet on a small sample", () => {
    const ins = buildInsights({ today: "2026-11-25", overview: overviewFixture({ visitors: 3, site_visitors: 3 }, { visitors: 2, site_visitors: 2 }) });
    expect(ins).toEqual([]);
  });
  it("keeps fact, possible reason and recommendation apart and ranks by impact × urgency × confidence", () => {
    const ins = buildInsights({
      today: "2026-11-25",
      overview: overviewFixture(
        { from: "2026-12-01", to: "2026-12-30", visitors: 200, site_visitors: 150, registrations: 3, revenue_coaching_cents: 50000 },
        { from: "2026-11-01", to: "2026-11-30", visitors: 100, site_visitors: 100, registrations: 10, revenue_coaching_cents: 100000 },
        { visits_since: "2026-10-01T12:00:00Z" },
      ),
      revenue: shapeRevenue({ failing: { subscriptions: 1 } }, [], "2026-11-25"),
      retention: shapeRetention({ at_risk: [{ client_id: "c", name: "Cal", tier: "client", last_day: "2026-11-01", prior_days: 6 }] }, "2026-11-25"),
    });
    const ids = ins.map((i) => i.id);
    expect(ids).toEqual(expect.arrayContaining(["failing-payments", "at-risk", "visitors-move", "conversion-decline", "revenue-move"]));
    for (const i of ins) {
      expect(i.fact.length).toBeGreaterThan(5);
      expect(i.evidence.length).toBeGreaterThan(0);
    }
    for (let n = 1; n < ins.length; n++) expect(ins[n - 1].score).toBeGreaterThanOrEqual(ins[n].score);
    expect(ins[0].urgency).toBe(3);
    const decline = ins.find((i) => i.id === "conversion-decline")!;
    expect(decline.fact).toContain("2%"); // 3 of 150
    expect(decline.hypothesis).toBeTruthy();
    expect(decline.recommendation).toBeTruthy();
  });
  it("calls a feature's link with staying an association", () => {
    const ins = buildInsights({
      today: "2026-11-25",
      engagement: shapeEngagement({ base: { member: 3 }, association: { by_feature: [{ feature: "community", used: 10, used_stayed: 8, not_used: 10, not_used_stayed: 2 }] } }),
    });
    const a = ins.find((i) => i.id === "association-community")!;
    expect(a.hypothesis).toMatch(/association, not proof/);
  });
  it("flags slow pages and errors only with enough readings", () => {
    const t = (n: number) => shapeTechnical({ sessions: 100, errors: { events: n, sessions: n, top: [{ label: "boom", n, sessions: n, feature: "Workouts" }] }, vitals: [{ metric: "LCP", n: 40, p75: 4200, good: 10, ni: 10, poor: 20 }], vitals_by_feature: [{ feature: "Workouts", metric: "LCP", n: 20, p75: 5100, poor: 12 }] });
    const ins = buildInsights({ today: "2026-11-25", technical: t(10) });
    expect(ins.map((i) => i.id)).toEqual(expect.arrayContaining(["errors", "vital-LCP"]));
    expect(ins.find((i) => i.id === "vital-LCP")!.hypothesis).toContain("Workouts");
    expect(buildInsights({ today: "2026-11-25", technical: t(1) }).some((i) => i.id === "errors")).toBe(false);
  });
  it("confidence grows with the sample", () => {
    expect(confidenceFor(3)).toBe("low");
    expect(confidenceFor(20)).toBe("medium");
    expect(confidenceFor(80)).toBe("high");
  });
  it("sums up last week in plain words, headlining only a real move", () => {
    const w = weeklySummary({ from: "2026-11-16", to: "2026-11-22" }, shapeKpis({ visitors: 60, revenue_coaching_cents: 26000, registrations: 2 }), shapeKpis({ visitors: 40, revenue_coaching_cents: 26000, registrations: 1 }), 91000);
    expect(w.headline).toBe("Website visitors up 50% (40 → 60).");
    expect(w.lines.find((l) => l.label === "Monthly recurring revenue now")!.value).toBe(money(91000, { whole: true }));
    const quiet = weeklySummary({ from: "2026-11-16", to: "2026-11-22" }, shapeKpis({ visitors: 3 }), shapeKpis({ visitors: 1 }), null);
    expect(quiet.headline).toBe("A steady week: nothing moved more than 15%.");
  });
});

describe("CSV export", () => {
  it("escapes quotes, commas and anything a spreadsheet would run", () => {
    expect(csvCell('a "b", c')).toBe('"a ""b"", c"');
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("-5")).toBe("'-5");
    expect(csvCell(-5)).toBe("'-5");
    expect(csvCell(null)).toBe("");
  });
  it("exports what each tab shows", () => {
    const overview = overviewFixture({ from: "2026-11-01", to: "2026-11-25", visitors: 5, revenue_coaching_cents: 13000 }, { from: "2026-10-07", visitors: 2 }, { visits_since: "2026-09-01T12:00:00Z" });
    const csv = toCsv(tablesFor("overview", { overview }));
    expect(csv).toContain("Visitors,5,2");
    const early = overviewFixture({ from: "2026-11-01", to: "2026-11-25", visitors: 5 }, { from: "2026-10-07", visitors: 0 }, { visits_since: "2026-11-23T08:00:00Z" });
    expect(toCsv(tablesFor("overview", { overview: early }))).toMatch(/^Visitors,5,\r?$/m);
    expect(csv).toContain('"Revenue (CAD, before tax)",130,0');
    expect(tablesFor("acquisition", {})).toEqual([]);
  });
});

describe("Cleo's analytics text", () => {
  it("starts with the rules and says only what it has", () => {
    const overview = overviewFixture({ visitors: 5, registrations: 1 }, { from: "2026-10-01", visitors: 2 }, { visits_since: "2026-09-01T12:00:00Z" });
    const t = analyticsText("overview", { from: "2026-11-01", to: "2026-11-25" }, { overview });
    expect(t.startsWith(ANALYTICS_RULES)).toBe(true);
    expect(t).toContain("FACTS");
    expect(t).toContain("Visitors 5 (+150% vs the period before)");
    expect(t).not.toContain("ACQUISITION");
    // a period before visits were recorded is never compared
    const early = overviewFixture({ visitors: 5 }, { from: "2026-10-01", visitors: 0 }, { visits_since: "2026-11-23T08:00:00Z" });
    const t2 = analyticsText("overview", { from: "2026-11-01", to: "2026-11-25" }, { overview: early });
    expect(t2).not.toContain("vs the period before);");
    expect(t2).toContain("no comparison");
  });
});

describe("the migration", () => {
  it("keeps every analytics table closed to users and every report server-only", () => {
    expect(MIGRATION).toMatch(/ALTER TABLE public\.analytics_visitors ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).toMatch(/ALTER TABLE public\.analytics_events ENABLE ROW LEVEL SECURITY/);
    expect(MIGRATION).not.toMatch(/CREATE POLICY/);
    const fns = [...MIGRATION.matchAll(/CREATE OR REPLACE FUNCTION public\.(bi_[a-z_]+)\(/g)].map((m) => m[1]);
    for (const fn of fns.filter((f) => !["bi_channel", "bi_zone_region", "bi_event_names"].includes(f))) {
      expect(MIGRATION, fn).toMatch(new RegExp(`REVOKE ALL ON FUNCTION public\\.${fn}\\([^)]*\\) FROM PUBLIC, anon, authenticated`));
    }
  });
  it("never ties an opted-out browser to its login, and forgets a purged account", () => {
    expect(MIGRATION).toContain("IF NOT coalesce(_opt_out, false) AND s.attribution_ok THEN");
    expect(MIGRATION).toContain("CREATE OR REPLACE FUNCTION public.bi_forget_user");
    expect(readFileSync("src/lib/account-deletion.server.ts", "utf8")).toContain('rpc("bi_forget_user"');
  });
});

describe("data from before tracking started", () => {
  it("compares visits only when the earlier period was recorded all the way through", () => {
    expect(visitsCover("2026-11-24", "2026-11-23T05:30:00Z")).toBe(true); // Nov 22 in Winnipeg, so the 24th is covered
    expect(visitsCover("2026-11-22", "2026-11-23T08:00:00Z")).toBe(false);
    expect(visitsCover("2026-11-24", null)).toBe(false);
    const v = overviewFixture({ from: "2026-11-19", to: "2026-11-25", visitors: 40, revenue_coaching_cents: 5000 }, { from: "2026-11-12", to: "2026-11-18", visitors: 3, revenue_coaching_cents: 1000 }, { visits_since: "2026-11-23T08:00:00Z" });
    expect(v.prevVisitsTracked).toBe(false);
    expect(kpiDelta(v, "visitors")).toBeNull();
    expect(kpiDelta(v, "revenueCents")).toBe(400); // billing reaches back, so money still compares
    const ins = buildInsights({ today: "2026-11-25", overview: overviewFixture({ from: "2026-11-01", visitors: 300 }, { from: "2026-10-01", visitors: 50 }, { visits_since: "2026-11-23T08:00:00Z" }) });
    expect(ins.find((i) => i.id === "visitors-move")).toBeUndefined();
  });
  it("leaves the website step out of a funnel whose period starts before visits were recorded", () => {
    const c = shapeConversions({ main: { site_visitors: null, visits_since: "2026-11-23T08:00:00Z", landing: 180, pricing: 28 } });
    expect(c.main.siteVisitors).toBeNull();
    expect(c.main.visitsSince).toBe("2026-11-23T08:00:00Z");
    expect(tablesFor("conversions", { conversions: c })[0].rows[0]).toEqual(["Website visitors", "not recorded for all of this period"]);
  });
  it("never gives a channel or a place a change against an unrecorded period", () => {
    const a = shapeAcquisition({ prev_tracked: false, channels: [{ channel: "instagram", sessions: 9, prev_sessions: 0 }], totals: { prev_sessions: 0 } });
    expect(a.channels[0].prevSessions).toBeNull();
    expect(a.totals.prevSessions).toBeNull();
    const g = shapeGeography({ prev_tracked: false, countries: [{ country: "CA", sessions: 40, prev_sessions: 0 }] });
    expect(g.countries[0].growth).toBeNull();
    expect(g.countries[0].prevSessions).toBeNull();
    const g2 = shapeGeography({ prev_tracked: true, countries: [{ country: "CA", sessions: 40, prev_sessions: 20 }] });
    expect(g2.countries[0].growth).toBe(100);
  });
  it("weekly summary leaves visitors uncompared before tracking", () => {
    const w = weeklySummary({ from: "2026-11-16", to: "2026-11-22" }, shapeKpis({ visitors: 60 }), shapeKpis({ visitors: 0 }), null, false);
    expect(w.lines.find((l) => l.label === "Website visitors")!.change).toBeNull();
    expect(w.headline).not.toMatch(/visitors/i);
  });
  it("counts free → paid only from a member account, and credits a first touch only when it came before they joined", () => {
    expect(MIGRATION).toContain("am.account_type IN ('jf_member', 'app_member')");
    expect(MIGRATION).toContain("e.event = 'moved_to_coaching'");
    expect(MIGRATION).toContain("AND av.first_seen_at <= u.created_at + interval '1 day'");
    expect(MIGRATION).toContain("AND public.bi_channel(NULL, c.source, NULL) NOT IN ('other', 'direct')");
  });
});
