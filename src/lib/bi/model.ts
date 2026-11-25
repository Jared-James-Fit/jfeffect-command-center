/**
 * Business intelligence (Nov 25 2026): what each Analytics tab's database read returns
 * (bi_* in 20270530090000_business_intelligence.sql), shaped for the page, plus the few numbers
 * worked out from them (rates, changes, MRR per client, lifetime value). Pure: the page, the CSV
 * export, Cleo's insights and Cleo's analytics lookup all read these shapes, so they never disagree.
 *
 * Every number here comes from a record; nothing is estimated or filled in. A rate with no base is
 * null (the page shows a dash), a change with nothing to compare is null, and lifetime value is only
 * worked out once enough clients have ended to say how long one stays (LTV_MIN_ENDED).
 */
import { businessDay, pct, pctChange } from "./period";

export const BI_TABS = [
  "overview",
  "acquisition",
  "geography",
  "conversions",
  "engagement",
  "retention",
  "revenue",
  "technical",
  "insights",
] as const;
export type BiTab = (typeof BI_TABS)[number];

export const BI_TAB_LABEL: Record<BiTab, string> = {
  overview: "Overview",
  acquisition: "Acquisition",
  geography: "Audience & Geography",
  conversions: "Conversions",
  engagement: "App Engagement",
  retention: "Retention",
  revenue: "Revenue",
  technical: "Technical Performance",
  insights: "Cleo Insights",
};

const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};
const obj = (v: unknown): Record<string, any> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, any>) : {});
const arr = (v: unknown): any[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);
const counts = (v: unknown): Record<string, number> =>
  Object.fromEntries(Object.entries(obj(v)).map(([k, n]) => [k, num(n)]));

// ---------------------------------------------------------------------------
// formatting
// ---------------------------------------------------------------------------

export function money(cents: number | null | undefined, opts: { whole?: boolean } = {}): string {
  if (cents == null || !Number.isFinite(cents)) return "–";
  const v = cents / 100;
  return v.toLocaleString("en-CA", {
    style: "currency",
    currency: "CAD",
    minimumFractionDigits: opts.whole ? 0 : 2,
    maximumFractionDigits: opts.whole ? 0 : 2,
  });
}

export function duration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  if (m < 60) return r ? `${m}m ${r}s` : `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

export function percent(v: number | null | undefined): string {
  return v == null || !Number.isFinite(v) ? "–" : `${v}%`;
}

export function count(n: number | null | undefined): string {
  return n == null || !Number.isFinite(n) ? "–" : Math.round(n).toLocaleString("en-CA");
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export type Kpis = {
  from: string;
  to: string;
  days: number;
  visitors: number;
  newVisitors: number;
  returningVisitors: number;
  sessions: number;
  engagedSessions: number;
  engagementRate: number | null;
  bounceRate: number | null;
  avgSessionSeconds: number | null;
  medianSessionSeconds: number | null;
  pageViews: number;
  siteVisitors: number;
  activePeople: number;
  dauAvg: number;
  wau: number;
  mau: number;
  registrations: number;
  memberApplications: number;
  coachingApplications: number;
  applications: number;
  newPaying: number;
  freeToPaid: number;
  payingClients: number;
  revenueCents: number;
  revenueCoachingCents: number;
  revenueCreditsCents: number;
  revenueOtherCents: number;
  clientsAtStart: number;
  clientsEnded: number;
  clientsEndedOfStart: number;
  clientsStarted: number;
  clientsNow: number;
  /** of the coaching clients at the start of the range, the share still coaching at its end */
  clientRetention: number | null;
  clientChurn: number | null;
};

export function shapeKpis(raw: unknown): Kpis {
  const r = obj(raw);
  const sessions = num(r.sessions);
  const engaged = num(r.engaged_sessions);
  const visitors = num(r.visitors);
  const newVisitors = Math.min(visitors, num(r.new_visitors));
  const coaching = num(r.revenue_coaching_cents);
  const credits = num(r.revenue_credits_cents);
  const other = num(r.revenue_other_cents);
  const atStart = num(r.clients_at_start);
  const endedOfStart = num(r.clients_ended_of_start);
  const engagementRate = pct(engaged, sessions);
  return {
    from: String(r.from ?? ""),
    to: String(r.to ?? ""),
    days: num(r.days),
    visitors,
    newVisitors,
    returningVisitors: Math.max(0, visitors - newVisitors),
    sessions,
    engagedSessions: engaged,
    engagementRate,
    bounceRate: engagementRate == null ? null : 100 - engagementRate,
    avgSessionSeconds: numOrNull(r.avg_session_seconds),
    medianSessionSeconds: numOrNull(r.median_session_seconds),
    pageViews: num(r.page_views),
    siteVisitors: num(r.site_visitors),
    activePeople: num(r.active_people),
    dauAvg: num(r.dau_avg),
    wau: num(r.wau),
    mau: num(r.mau),
    registrations: num(r.registrations),
    memberApplications: num(r.member_applications),
    coachingApplications: num(r.coaching_applications),
    applications: num(r.member_applications) + num(r.coaching_applications),
    newPaying: num(r.new_paying),
    freeToPaid: num(r.free_to_paid),
    payingClients: num(r.paying_clients),
    revenueCents: coaching + credits + other,
    revenueCoachingCents: coaching,
    revenueCreditsCents: credits,
    revenueOtherCents: other,
    clientsAtStart: atStart,
    clientsEnded: num(r.clients_ended),
    clientsEndedOfStart: endedOfStart,
    clientsStarted: num(r.clients_started),
    clientsNow: num(r.clients_now),
    clientRetention: atStart ? pct(atStart - endedOfStart, atStart) : null,
    clientChurn: atStart ? pct(endedOfStart, atStart) : null,
  };
}

export type Mrr = {
  mrrCents: number;
  subscriptions: number;
  ending: number;
  endingMrrCents: number;
  failing: number;
  installmentPlans: number;
  installmentOutstandingCents: number;
  collected30dCents: number;
  byPackage: { package: string; subscriptions: number; mrrCents: number }[];
  /** MRR per subscription, a reading of what one recurring client brings a month */
  perSubscriptionCents: number | null;
};

export function shapeMrr(raw: unknown): Mrr {
  const r = obj(raw);
  const subs = num(r.subscriptions);
  const mrr = num(r.mrr_cents);
  return {
    mrrCents: mrr,
    subscriptions: subs,
    ending: num(r.ending),
    endingMrrCents: num(r.ending_mrr_cents),
    failing: num(r.failing),
    installmentPlans: num(r.installment_plans),
    installmentOutstandingCents: num(r.installment_outstanding_cents),
    collected30dCents: num(r.collected_30d_cents),
    byPackage: arr(r.by_package).map((p) => ({ package: String(p.package ?? "Other"), subscriptions: num(p.subscriptions), mrrCents: num(p.mrr_cents) })),
    perSubscriptionCents: subs ? Math.round(mrr / subs) : null,
  };
}

export type DailyRow = { day: string; visitors: number; sessions: number; active: number; registrations: number; applications: number; revenueCents: number };

export type OverviewView = {
  current: Kpis;
  previous: Kpis;
  daily: DailyRow[];
  mrr: Mrr;
  live: number;
  visitsSince: string | null;
  funnelSince: string | null;
  eventsSince: string | null;
  /** the previous period is wholly inside visit tracking, so visit numbers can be compared */
  prevVisitsTracked: boolean;
};

/** The numbers read from recorded visits (since Nov 23 2026); never compared with a period before that. */
export const VISIT_KPIS: readonly (keyof Kpis)[] = [
  "visitors", "newVisitors", "returningVisitors", "sessions", "engagedSessions", "engagementRate", "bounceRate",
  "avgSessionSeconds", "medianSessionSeconds", "pageViews", "siteVisitors",
];

/** True when a period starting on `from` is wholly inside visit tracking. */
export function visitsCover(from: string, visitsSince: string | null): boolean {
  if (!visitsSince || !from) return false;
  const t = new Date(visitsSince);
  if (Number.isNaN(t.getTime())) return false;
  return from >= businessDay(t);
}

export function shapeOverview(raw: unknown): OverviewView {
  const r = obj(raw);
  return {
    current: shapeKpis(r.current),
    previous: shapeKpis(r.previous),
    daily: arr(r.daily).map((d) => ({
      day: String(d.day),
      visitors: num(d.visitors),
      sessions: num(d.sessions),
      active: num(d.active),
      registrations: num(d.registrations),
      applications: num(d.applications),
      revenueCents: num(d.revenue_cents),
    })),
    mrr: shapeMrr(r.mrr),
    live: num(r.live),
    visitsSince: str(r.visits_since),
    funnelSince: str(r.funnel_since),
    eventsSince: str(r.events_since),
    prevVisitsTracked: visitsCover(shapeKpis(r.previous).from, str(r.visits_since)),
  };
}

/** A KPI's change against the previous range; null when there's nothing before to compare. */
export function kpiDelta(v: OverviewView, key: keyof Kpis): number | null {
  if (!v.prevVisitsTracked && VISIT_KPIS.includes(key)) return null;
  const a = v.current[key];
  const b = v.previous[key];
  if (typeof a !== "number" || typeof b !== "number") return null;
  return pctChange(a, b);
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

export type ChannelRow = {
  channel: string;
  sessions: number;
  prevSessions: number | null;
  visitors: number;
  engaged: number;
  engagementRate: number | null;
  avgSeconds: number | null;
  registrations: number;
  memberApps: number;
  coachingApps: number;
  newPayingFirst: number;
  newPayingLast: number;
  payingClients: number;
  revenueCents: number;
  /** registrations per 100 visitors from this channel (null without visitors) */
  signupRate: number | null;
};

export type AcquisitionView = {
  channels: ChannelRow[];
  campaigns: { campaign: string; channel: string | null; sessions: number; visitors: number; engaged: number; memberApps: number; coachingApps: number; registrations: number }[];
  landingPages: { path: string; sessions: number; visitors: number; engaged: number; avgSeconds: number | null; converted: number; conversionRate: number | null }[];
  referrers: { host: string; channel: string | null; sessions: number; visitors: number }[];
  browsers: Record<string, number>;
  attribution: { registrations: Record<string, number>; newPaying: Record<string, number>; payingAll: Record<string, number> };
  totals: { sessions: number; prevSessions: number | null; registrations: number; newPaying: number; revenueCents: number };
  /** visits were recorded for all of the period before, so "vs before" means something */
  prevTracked: boolean;
};

export function shapeAcquisition(raw: unknown): AcquisitionView {
  const r = obj(raw);
  // the period before is compared only when visits were recorded for all of it (since Nov 23 2026)
  const prevTracked = r.prev_tracked === true;
  const channels: ChannelRow[] = arr(r.channels).map((c) => {
    const sessions = num(c.sessions);
    const visitors = num(c.visitors);
    return {
      channel: String(c.channel ?? "direct"),
      sessions,
      prevSessions: prevTracked ? num(c.prev_sessions) : null,
      visitors,
      engaged: num(c.engaged),
      engagementRate: pct(num(c.engaged), sessions),
      avgSeconds: numOrNull(c.avg_seconds),
      registrations: num(c.registrations),
      memberApps: num(c.member_apps),
      coachingApps: num(c.coaching_apps),
      newPayingFirst: num(c.new_paying_first),
      newPayingLast: num(c.new_paying_last),
      payingClients: num(c.paying_clients),
      revenueCents: num(c.revenue_cents),
      signupRate: visitors ? pct(num(c.registrations), visitors) : null,
    };
  });
  // most valuable first: revenue, then paying clients, sign-ups, visits
  channels.sort((a, b) => b.revenueCents - a.revenueCents || b.newPayingFirst - a.newPayingFirst || b.registrations - a.registrations || b.sessions - a.sessions);
  const t = obj(r.totals);
  const a = obj(r.attribution);
  return {
    prevTracked,
    channels,
    campaigns: arr(r.campaigns).map((c) => ({
      campaign: String(c.campaign),
      channel: str(c.channel),
      sessions: num(c.sessions),
      visitors: num(c.visitors),
      engaged: num(c.engaged),
      memberApps: num(c.member_apps),
      coachingApps: num(c.coaching_apps),
      registrations: num(c.registrations),
    })),
    landingPages: arr(r.landing_pages).map((p) => ({
      path: String(p.path ?? "/"),
      sessions: num(p.sessions),
      visitors: num(p.visitors),
      engaged: num(p.engaged),
      avgSeconds: numOrNull(p.avg_seconds),
      converted: num(p.converted),
      conversionRate: pct(num(p.converted), num(p.visitors), 1),
    })),
    referrers: arr(r.referrers).map((x) => ({ host: String(x.host), channel: str(x.channel), sessions: num(x.sessions), visitors: num(x.visitors) })),
    browsers: counts(r.browsers),
    attribution: { registrations: counts(a.registrations), newPaying: counts(a.new_paying), payingAll: counts(a.paying_all) },
    totals: {
      sessions: num(t.sessions),
      prevSessions: prevTracked ? num(t.prev_sessions) : null,
      registrations: num(t.registrations),
      newPaying: num(t.new_paying),
      revenueCents: num(t.revenue_cents),
    },
  };
}

export const ATTRIBUTION_LABEL: Record<string, string> = {
  tracked: "Tracked visit",
  application: "Application form",
  recorded: "Source on their record",
  none: "Not tracked",
};

// ---------------------------------------------------------------------------
// Geography
// ---------------------------------------------------------------------------

export type PlaceRow = {
  country: string;
  region: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
  sessions: number;
  /** null when visits weren't recorded for all of the period before */
  prevSessions: number | null;
  visitors: number;
  people: number;
  registrations: number;
  paying: number;
  live: number;
  growth: number | null;
  /** new accounts per 100 visitors */
  conversion: number | null;
};

export type GeographyView = {
  countries: PlaceRow[];
  regions: PlaceRow[];
  cities: PlaceRow[];
  unplacedSessions: number;
  placedSessions: number;
  peoplePlaced: number;
  peopleTotal: number;
  prevTracked: boolean;
};

function placeRow(p: any, prevTracked: boolean): PlaceRow {
  const sessions = num(p.sessions);
  const prev = prevTracked ? num(p.prev_sessions) : null;
  return {
    country: String(p.country ?? ""),
    region: str(p.region),
    city: str(p.city),
    lat: numOrNull(p.lat),
    lng: numOrNull(p.lng),
    sessions,
    prevSessions: prev,
    visitors: num(p.visitors),
    people: num(p.people),
    registrations: num(p.registrations),
    paying: num(p.paying),
    live: num(p.live),
    growth: prev == null ? null : pctChange(sessions, prev),
    conversion: pct(num(p.registrations), num(p.visitors), 1),
  };
}

export function shapeGeography(raw: unknown): GeographyView {
  const r = obj(raw);
  const prevTracked = r.prev_tracked === true;
  const row = (p: any) => placeRow(p, prevTracked);
  return {
    prevTracked,
    countries: arr(r.countries).map(row),
    regions: arr(r.regions).map(row),
    cities: arr(r.cities).map(row),
    unplacedSessions: num(r.unplaced_sessions),
    placedSessions: num(r.placed_sessions),
    peoplePlaced: num(r.people_placed),
    peopleTotal: num(r.people_total),
  };
}

const COUNTRY_NAMES: Record<string, string> = {
  CA: "Canada", US: "United States", GB: "United Kingdom", AU: "Australia", NZ: "New Zealand", IE: "Ireland",
  PH: "Philippines", IN: "India", MX: "Mexico", DE: "Germany", FR: "France", NL: "Netherlands", ES: "Spain",
  IT: "Italy", SE: "Sweden", NO: "Norway", DK: "Denmark", FI: "Finland", BR: "Brazil", ZA: "South Africa",
  JP: "Japan", KR: "South Korea", SG: "Singapore", AE: "United Arab Emirates", PK: "Pakistan", NG: "Nigeria",
};

export function countryName(code: string | null | undefined): string {
  const c = String(code ?? "").toUpperCase();
  if (!c) return "Unknown";
  if (COUNTRY_NAMES[c]) return COUNTRY_NAMES[c];
  try {
    const n = new Intl.DisplayNames(["en"], { type: "region" }).of(c);
    return n ?? c;
  } catch {
    return c;
  }
}

export function placeLabel(p: Pick<PlaceRow, "country" | "region" | "city">): string {
  return [p.city, p.region, countryName(p.country)].filter(Boolean).join(", ");
}

// ---------------------------------------------------------------------------
// Conversions
// ---------------------------------------------------------------------------

export type ConversionsView = {
  main: {
    /** null when the period reaches back before visits were recorded (only the site's own steps are). */
    siteVisitors: number | null; visitsSince: string | null; landing: number; pricing: number; started: number; submitted: number;
    applications: number; accounts: number; checkout: number; paid: number; retainedBase: number; retained: number;
  };
  freePath: { landing: number; cta: number; started: number; sent: number; applications: number; approved: number; activated: number; trainedWeek1: number };
  coachingPath: { coachingPage: number; pricing: number; cta: number; started: number; sent: number; applications: number; becameClients: number };
  directCheckout: { applications: number; paid: number };
  upgrades: { started: number; applied: number };
  applySteps: Record<string, number>;
  joinSteps: Record<string, number>;
  checkouts: { planStarted: number; planCompleted: number; planAbandoned: number; planOpen: number; linksSent: number; linksPaid: number };
  timing: {
    visitToAccountDays: number | null; visitToAccountN: number;
    accountToPaidDays: number | null; accountToPaidN: number;
    applicationToClientDays: number | null; applicationToClientN: number;
  };
  onboarding: { accounts: number; members: number; setupDone: number; cameBack: number; trainedWeek1: number; week2Base: number; week2Active: number };
};

export function shapeConversions(raw: unknown): ConversionsView {
  const r = obj(raw);
  const m = obj(r.main);
  const f = obj(r.free_path);
  const c = obj(r.coaching_path);
  const d = obj(r.direct_checkout);
  const u = obj(r.upgrades);
  const k = obj(r.checkouts);
  const t = obj(r.timing);
  const o = obj(r.onboarding);
  return {
    main: {
      siteVisitors: numOrNull(m.site_visitors), visitsSince: typeof m.visits_since === "string" ? m.visits_since : null, landing: num(m.landing), pricing: num(m.pricing), started: num(m.started),
      submitted: num(m.submitted), applications: num(m.applications), accounts: num(m.accounts), checkout: num(m.checkout),
      paid: num(m.paid), retainedBase: num(m.retained_base), retained: num(m.retained),
    },
    freePath: {
      landing: num(f.landing), cta: num(f.cta), started: num(f.started), sent: num(f.sent), applications: num(f.applications),
      approved: num(f.approved), activated: num(f.activated), trainedWeek1: num(f.trained_week1),
    },
    coachingPath: {
      coachingPage: num(c.coaching_page), pricing: num(c.pricing), cta: num(c.cta), started: num(c.started), sent: num(c.sent),
      applications: num(c.applications), becameClients: num(c.became_clients),
    },
    directCheckout: { applications: num(d.applications), paid: num(d.paid) },
    upgrades: { started: num(u.started), applied: num(u.applied) },
    applySteps: counts(r.apply_steps),
    joinSteps: counts(r.join_steps),
    checkouts: {
      planStarted: num(k.plan_started), planCompleted: num(k.plan_completed), planAbandoned: num(k.plan_abandoned),
      planOpen: num(k.plan_open), linksSent: num(k.links_sent), linksPaid: num(k.links_paid),
    },
    timing: {
      visitToAccountDays: numOrNull(t.visit_to_account_days), visitToAccountN: num(t.visit_to_account_n),
      accountToPaidDays: numOrNull(t.account_to_paid_days), accountToPaidN: num(t.account_to_paid_n),
      applicationToClientDays: numOrNull(t.application_to_client_days), applicationToClientN: num(t.application_to_client_n),
    },
    onboarding: {
      accounts: num(o.accounts), members: num(o.members), setupDone: num(o.setup_done), cameBack: num(o.came_back),
      trainedWeek1: num(o.trained_week1), week2Base: num(o.week2_base), week2Active: num(o.week2_active),
    },
  };
}

/** The biggest drop between consecutive steps with a base of at least `minBase` (where most are lost). */
export function biggestDrop(steps: { label: string; value: number }[], minBase = 5): { from: string; to: string; lost: number; keptPct: number } | null {
  let best: { from: string; to: string; lost: number; keptPct: number } | null = null;
  for (let i = 1; i < steps.length; i++) {
    const a = steps[i - 1];
    const b = steps[i];
    if (a.value < minBase) continue;
    const kept = Math.min(100, Math.round((b.value / a.value) * 100));
    const lost = a.value - Math.min(a.value, b.value);
    if (!best || kept < best.keptPct) best = { from: a.label, to: b.label, lost, keptPct: kept };
  }
  return best;
}

// ---------------------------------------------------------------------------
// Engagement
// ---------------------------------------------------------------------------

export const FEATURES: { key: string; label: string; help: string }[] = [
  { key: "workouts", label: "Workouts finished", help: "A workout marked finished." },
  { key: "logging", label: "Sets logged", help: "A set logged in the workout logger." },
  { key: "nutrition", label: "Nutrition", help: "Food logged, or the Nutrition pages opened (pages since Nov 23 2026)." },
  { key: "cardio", label: "Cardio", help: "A cardio session marked done." },
  { key: "checkins", label: "Check-ins & forms", help: "A weekly check-in or a form sent." },
  { key: "messaging", label: "Messaging", help: "A message sent to their coach, a group, a 1:1 or Support." },
  { key: "community", label: "Crew posting", help: "A post, like or comment in Crew." },
  { key: "crew_browse", label: "Crew browsing", help: "A Crew post seen." },
  { key: "progress", label: "Progress tracking", help: "A weigh-in or a progress check-in." },
  { key: "meetings", label: "Meetings & calls", help: "A coaching meeting held, or a PT session completed." },
  { key: "competition", label: "Competition", help: "A competition set up for them, or their competition page opened." },
  { key: "programs", label: "Own programs", help: "A program they built or imported." },
  { key: "cleo", label: "Cleo inbox", help: "A Cleo update read (Premium members)." },
];

export const SEGMENT_LABEL: Record<string, string> = {
  member: "Free members",
  client: "Coaching clients",
  lead: "Coaching applicants",
  pending: "Waiting on approval",
};

export type FeatureRow = {
  feature: string;
  label: string;
  tier: string;
  users: number;
  prevUsers: number;
  events: number;
  userDays: number;
  repeatUsers: number;
  adoption: number | null;
  repeatRate: number | null;
  daysPerUser: number | null;
  change: number | null;
};

export type EngagementView = {
  base: Record<string, number>;
  basePrev: Record<string, number>;
  features: FeatureRow[];
  pages: { feature: string; views: number; people: number; prevViews: number }[];
  staffTools: { feature: string; views: number; days: number; staff: number }[];
  staffCleo: { questions: number; people: number };
  association: {
    people: number;
    stayed: number;
    byFeature: { feature: string; label: string; used: number; usedStayed: number; notUsed: number; notUsedStayed: number; usedRate: number | null; notUsedRate: number | null; lift: number | null }[];
  };
};

const featureLabel = (k: string) => FEATURES.find((f) => f.key === k)?.label ?? k;

/** Groups of this size or more are needed before a rate difference is shown at all. */
export const ASSOC_MIN_GROUP = 5;

export function shapeEngagement(raw: unknown): EngagementView {
  const r = obj(raw);
  const base = counts(r.base);
  const rows: FeatureRow[] = [
    ...arr(r.features).map((f) => ({ ...f, prev_users: num(f.prev_users) })),
    ...arr(r.prev_only).map((f) => ({ feature: f.feature, tier: f.tier, users: 0, events: 0, user_days: 0, repeat_users: 0, prev_users: num(f.prev_users) })),
  ].map((f) => {
    const users = num(f.users);
    return {
      feature: String(f.feature),
      label: featureLabel(String(f.feature)),
      tier: String(f.tier),
      users,
      prevUsers: num(f.prev_users),
      events: num(f.events),
      userDays: num(f.user_days),
      repeatUsers: num(f.repeat_users),
      adoption: pct(users, base[String(f.tier)] ?? 0),
      repeatRate: pct(num(f.repeat_users), users),
      daysPerUser: users ? Math.round((num(f.user_days) / users) * 10) / 10 : null,
      change: pctChange(users, num(f.prev_users)),
    };
  });
  const a = obj(r.association);
  return {
    base,
    basePrev: counts(r.base_prev),
    features: rows,
    pages: arr(r.pages).map((p) => ({ feature: String(p.feature), views: num(p.views), people: num(p.people), prevViews: num(p.prev_views) })),
    staffTools: arr(r.staff_tools).map((s) => ({ feature: String(s.feature), views: num(s.views), days: num(s.days), staff: num(s.staff) })),
    staffCleo: { questions: num(obj(r.staff_cleo).questions), people: num(obj(r.staff_cleo).people) },
    association: {
      people: num(a.people),
      stayed: num(a.stayed),
      byFeature: arr(a.by_feature)
        .map((f) => {
          const used = num(f.used);
          const notUsed = num(f.not_used);
          const usedRate = used >= ASSOC_MIN_GROUP ? pct(num(f.used_stayed), used) : null;
          const notUsedRate = notUsed >= ASSOC_MIN_GROUP ? pct(num(f.not_used_stayed), notUsed) : null;
          return {
            feature: String(f.feature),
            label: featureLabel(String(f.feature)),
            used,
            usedStayed: num(f.used_stayed),
            notUsed,
            notUsedStayed: num(f.not_used_stayed),
            usedRate,
            notUsedRate,
            lift: usedRate != null && notUsedRate != null ? usedRate - notUsedRate : null,
          };
        })
        .sort((x, y) => (y.lift ?? -999) - (x.lift ?? -999)),
    },
  };
}

/** Each feature across every segment: people, adoption of everyone active. */
export function featureTotals(v: EngagementView): { feature: string; label: string; users: number; prevUsers: number; adoption: number | null; repeatRate: number | null }[] {
  const allBase = Object.values(v.base).reduce((s, n) => s + n, 0);
  const by = new Map<string, { users: number; prev: number; repeat: number }>();
  for (const f of v.features) {
    const x = by.get(f.feature) ?? { users: 0, prev: 0, repeat: 0 };
    x.users += f.users;
    x.prev += f.prevUsers;
    x.repeat += f.repeatUsers;
    by.set(f.feature, x);
  }
  return FEATURES.filter((f) => by.has(f.key))
    .map((f) => {
      const x = by.get(f.key)!;
      return { feature: f.key, label: f.label, users: x.users, prevUsers: x.prev, adoption: pct(x.users, allBase), repeatRate: pct(x.repeat, x.users) };
    })
    .sort((a, b) => b.users - a.users);
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

export type RetentionView = {
  dayN: { n: number; eligible: number; kept: number; rate: number | null; inRangeEligible: number; inRangeKept: number; inRangeRate: number | null; byTier: Record<string, { eligible: number; kept: number; rate: number | null }> }[];
  weekly: { cohort: string; size: number; cells: (number | null)[] }[];
  monthly: { cohort: string; size: number; cells: (number | null)[] }[];
  status: Record<string, Record<string, number>>;
  atRisk: { clientId: string | null; name: string; tier: string; lastDay: string; priorDays: number }[];
  returning: { active: number; returning: number; rate: number | null };
  mauByMonth: { month: string; active: number }[];
  clientsByMonth: { month: string; started: number; ended: number; activeStart: number; churn: number | null }[];
  cancellations: number;
  planMoves: Record<string, number>;
  activitySince: string | null;
};

const DAY_NS = [1, 7, 30, 90];

export function shapeRetention(raw: unknown, today: string): RetentionView {
  const r = obj(raw);
  const dn = arr(r.day_n);
  const dayN = DAY_NS.map((n) => {
    const rows = dn.filter((x) => num(x.n) === n);
    const sum = (f: (x: any) => boolean, k: "eligible" | "kept") => rows.filter(f).reduce((s, x) => s + num(x[k]), 0);
    const eligible = sum(() => true, "eligible");
    const kept = sum(() => true, "kept");
    const inE = sum((x) => !!x.in_range, "eligible");
    const inK = sum((x) => !!x.in_range, "kept");
    const byTier: Record<string, { eligible: number; kept: number; rate: number | null }> = {};
    for (const x of rows) {
      const t = String(x.tier);
      const b = byTier[t] ?? { eligible: 0, kept: 0, rate: null };
      b.eligible += num(x.eligible);
      b.kept += num(x.kept);
      b.rate = pct(b.kept, b.eligible);
      byTier[t] = b;
    }
    return { n, eligible, kept, rate: pct(kept, eligible), inRangeEligible: inE, inRangeKept: inK, inRangeRate: pct(inK, inE), byTier };
  });
  const cohortCells = (rows: any[], key: "weeks" | "months", k: "w" | "m", unitDays: number, max: number) =>
    rows.map((c) => {
      const size = num(c.size);
      const start = String(c.cohort).length === 7 ? `${c.cohort}-01` : String(c.cohort);
      const elapsed = Math.floor((Date.parse(`${today}T12:00:00Z`) - Date.parse(`${start}T12:00:00Z`)) / 86_400_000);
      const reached = unitDays === 30 ? monthsBetween(start, today) : Math.floor(elapsed / unitDays);
      const cells: (number | null)[] = [];
      for (let i = 0; i <= max; i++) {
        if (i > reached) cells.push(null);
        else {
          const hit = arr(c[key]).find((x) => num(x[k]) === i);
          cells.push(size ? Math.round((num(hit?.active) / size) * 100) : null);
        }
      }
      return { cohort: String(c.cohort), size, cells };
    });
  const status: Record<string, Record<string, number>> = {};
  for (const s of arr(r.status)) {
    const t = String(s.tier);
    status[t] = status[t] ?? {};
    status[t][String(s.bucket)] = num(s.n);
  }
  const ret = obj(r.returning);
  return {
    dayN,
    weekly: cohortCells(arr(r.weekly), "weeks", "w", 7, 11),
    monthly: cohortCells(arr(r.monthly), "months", "m", 30, 11),
    status,
    atRisk: arr(r.at_risk).map((x) => ({ clientId: str(x.client_id), name: String(x.name ?? "Someone"), tier: String(x.tier), lastDay: String(x.last_day), priorDays: num(x.prior_days) })),
    returning: { active: num(ret.active), returning: num(ret.returning), rate: pct(num(ret.returning), num(ret.active)) },
    mauByMonth: arr(r.mau_by_month).map((m) => ({ month: String(m.month), active: num(m.active) })),
    clientsByMonth: arr(r.clients_by_month).map((m) => ({
      month: String(m.month),
      started: num(m.started),
      ended: num(m.ended),
      activeStart: num(m.active_start),
      churn: pct(num(m.ended), num(m.active_start)),
    })),
    cancellations: num(r.cancellations),
    planMoves: counts(r.plan_moves),
    activitySince: str(r.activity_since),
  };
}

function monthsBetween(fromIso: string, toIso: string): number {
  return (Number(toIso.slice(0, 4)) - Number(fromIso.slice(0, 4))) * 12 + Number(toIso.slice(5, 7)) - Number(fromIso.slice(5, 7));
}

// ---------------------------------------------------------------------------
// Revenue
// ---------------------------------------------------------------------------

export type RevenueMonth = {
  month: string;
  coachingCents: number;
  refundsCents: number;
  recurringCents: number;
  creditsCents: number;
  otherCents: number;
  totalCents: number;
  payingClients: number;
  newPaying: number;
  arppuCents: number | null;
};

export type RevenueView = {
  byMonth: RevenueMonth[];
  current: { revenueCents: number; refundsCents: number; payments: number; payingClients: number; arppuCents: number | null };
  previous: { revenueCents: number; payingClients: number; arppuCents: number | null };
  byPackage: { package: string; revenueCents: number; clients: number; payments: number }[];
  mrr: Mrr;
  lifetime: {
    clients: number;
    paidCents: number;
    avgPerClientCents: number | null;
    endedClients: number;
    endedAvgCents: number | null;
    endedMonths: number | null;
    firstPayment: string | null;
  };
  ltv: Ltv;
  failing: { subscriptions: number; planPayments: number };
  planMoves: { from: string | null; to: string | null; fromCents: number | null; toCents: number | null; at: string }[];
};

export type Ltv = {
  /** projected lifetime value, only with enough history */
  cents: number | null;
  /** average monthly revenue per paying client over the last full months */
  monthlyArppuCents: number | null;
  /** coaching client churn a month over the last six months */
  monthlyChurn: number | null;
  reason: string | null;
};

/** Ended paying clients needed before a churn rate (and so a lifetime value) is worth showing. */
export const LTV_MIN_ENDED = 3;
export const LTV_MIN_MONTHS = 3;

/**
 * Lifetime value = average monthly revenue per paying client ÷ monthly churn, from the last full
 * months (never the current part-month). Only when at least LTV_MIN_MONTHS months had paying clients
 * and LTV_MIN_ENDED clients ended in the churn window; otherwise null with the reason.
 */
export function lifetimeValue(byMonth: RevenueMonth[], clientsByMonth: RetentionView["clientsByMonth"], today: string): Ltv {
  const thisMonth = today.slice(0, 7);
  const full = byMonth.filter((m) => m.month < thisMonth && m.payingClients > 0).slice(-3);
  const churnRows = clientsByMonth.filter((m) => m.month < thisMonth && m.activeStart > 0).slice(-6);
  const monthlyArppu = full.length
    ? Math.round(full.reduce((s, m) => s + m.coachingCents - m.refundsCents, 0) / full.reduce((s, m) => s + m.payingClients, 0))
    : null;
  const ended = churnRows.reduce((s, m) => s + m.ended, 0);
  const exposure = churnRows.reduce((s, m) => s + m.activeStart, 0);
  const churn = exposure ? ended / exposure : null;
  if (full.length < LTV_MIN_MONTHS) return { cents: null, monthlyArppuCents: monthlyArppu, monthlyChurn: churn == null ? null : Math.round(churn * 1000) / 10, reason: `Needs ${LTV_MIN_MONTHS} full months with paying clients.` };
  if (ended < LTV_MIN_ENDED || !churn) return { cents: null, monthlyArppuCents: monthlyArppu, monthlyChurn: churn == null ? null : Math.round(churn * 1000) / 10, reason: `Needs at least ${LTV_MIN_ENDED} clients ending in the last 6 months to say how long a client stays (${ended} so far).` };
  return { cents: monthlyArppu != null ? Math.round(monthlyArppu / churn) : null, monthlyArppuCents: monthlyArppu, monthlyChurn: Math.round(churn * 1000) / 10, reason: null };
}

export function shapeRevenue(raw: unknown, clientsByMonth: RetentionView["clientsByMonth"], today: string): RevenueView {
  const r = obj(raw);
  const byMonth: RevenueMonth[] = arr(r.by_month).map((m) => {
    const coaching = num(m.coaching_cents);
    const refunds = num(m.refunds_cents);
    const credits = num(m.credits_cents);
    const other = num(m.other_cents);
    const paying = num(m.paying_clients);
    return {
      month: String(m.month),
      coachingCents: coaching,
      refundsCents: refunds,
      recurringCents: num(m.recurring_cents),
      creditsCents: credits,
      otherCents: other,
      totalCents: coaching - refunds + credits + other,
      payingClients: paying,
      newPaying: num(m.new_paying),
      arppuCents: paying ? Math.round((coaching - refunds) / paying) : null,
    };
  });
  const c = obj(r.current);
  const p = obj(r.previous);
  const l = obj(r.lifetime);
  const f = obj(r.failing);
  const lifetimeClients = num(l.clients);
  const endedClients = num(l.ended_clients);
  return {
    byMonth,
    current: {
      revenueCents: num(c.revenue_cents),
      refundsCents: num(c.refunds_cents),
      payments: num(c.payments),
      payingClients: num(c.paying_clients),
      arppuCents: num(c.paying_clients) ? Math.round(num(c.revenue_cents) / num(c.paying_clients)) : null,
    },
    previous: {
      revenueCents: num(p.revenue_cents),
      payingClients: num(p.paying_clients),
      arppuCents: num(p.paying_clients) ? Math.round(num(p.revenue_cents) / num(p.paying_clients)) : null,
    },
    byPackage: arr(r.by_package).map((x) => ({ package: String(x.package), revenueCents: num(x.revenue_cents), clients: num(x.clients), payments: num(x.payments) })),
    mrr: shapeMrr(r.mrr),
    lifetime: {
      clients: lifetimeClients,
      paidCents: num(l.paid_cents),
      avgPerClientCents: lifetimeClients ? Math.round(num(l.paid_cents) / lifetimeClients) : null,
      endedClients,
      endedAvgCents: endedClients ? Math.round(num(l.ended_paid_cents) / endedClients) : null,
      endedMonths: numOrNull(l.ended_months),
      firstPayment: str(l.first_payment),
    },
    ltv: lifetimeValue(byMonth, clientsByMonth, today),
    failing: { subscriptions: num(f.subscriptions), planPayments: num(f.plan_payments) },
    planMoves: arr(r.plan_moves).map((m) => ({ from: str(m.from), to: str(m.to), fromCents: numOrNull(m.from_cents), toCents: numOrNull(m.to_cents), at: String(m.at) })),
  };
}

// ---------------------------------------------------------------------------
// Technical
// ---------------------------------------------------------------------------

export type VitalRow = { metric: string; n: number; p75: number | null; good: number; ni: number; poor: number; goodRate: number | null };

export type TechnicalView = {
  sessions: number;
  byDevice: Record<string, number>;
  byPlatform: Record<string, number>;
  byOs: Record<string, number>;
  byBrowser: Record<string, number>;
  vitals: VitalRow[];
  vitalsByDevice: { metric: string; device: string; n: number; p75: number | null }[];
  vitalsByFeature: { feature: string; metric: string; n: number; p75: number | null; poor: number }[];
  vitalsDaily: { day: string; metric: string; p75: number | null; n: number }[];
  errors: { events: number; sessions: number; people: number; rate: number | null; top: { label: string; n: number; sessions: number; feature: string | null; lastAt: string }[] };
  errorRateByFeature: { feature: string; sessions: number; withErrors: number; rate: number | null }[];
  failedRequests: { area: string; kind: string; n: number; sessions: number }[];
  notFound: { path: string; n: number }[];
  payments: { failingSubscriptions: number; planPaymentsWaiting: number };
  ai: { calls: number; failed: number; rate: number | null };
  sms: { sent: number; undelivered: number; rate: number | null };
  eventsSince: string | null;
};

export function shapeTechnical(raw: unknown): TechnicalView {
  const r = obj(raw);
  const e = obj(r.errors);
  const sessions = num(r.sessions);
  const ai = obj(r.ai);
  const sms = obj(r.sms);
  const order = ["LCP", "INP", "CLS", "FCP", "TTFB"];
  return {
    sessions,
    byDevice: counts(r.by_device),
    byPlatform: counts(r.by_platform),
    byOs: counts(r.by_os),
    byBrowser: counts(r.by_browser),
    vitals: arr(r.vitals)
      .map((v) => ({
        metric: String(v.metric),
        n: num(v.n),
        p75: numOrNull(v.p75),
        good: num(v.good),
        ni: num(v.ni),
        poor: num(v.poor),
        goodRate: pct(num(v.good), num(v.n)),
      }))
      .sort((a, b) => order.indexOf(a.metric) - order.indexOf(b.metric)),
    vitalsByDevice: arr(r.vitals_by_device).map((v) => ({ metric: String(v.metric), device: String(v.device), n: num(v.n), p75: numOrNull(v.p75) })),
    vitalsByFeature: arr(r.vitals_by_feature).map((v) => ({ feature: String(v.feature), metric: String(v.metric), n: num(v.n), p75: numOrNull(v.p75), poor: num(v.poor) })),
    vitalsDaily: arr(r.vitals_daily).map((v) => ({ day: String(v.day), metric: String(v.metric), p75: numOrNull(v.p75), n: num(v.n) })),
    errors: {
      events: num(e.events),
      sessions: num(e.sessions),
      people: num(e.people),
      rate: pct(num(e.sessions), sessions, 1),
      top: arr(e.top).map((t) => ({ label: String(t.label), n: num(t.n), sessions: num(t.sessions), feature: str(t.feature), lastAt: String(t.last_at) })),
    },
    errorRateByFeature: arr(r.error_rate_by_feature).map((x) => ({
      feature: String(x.feature),
      sessions: num(x.sessions),
      withErrors: num(x.with_errors),
      rate: pct(num(x.with_errors), num(x.sessions), 1),
    })),
    failedRequests: arr(r.failed_requests).map((x) => ({ area: String(x.area), kind: String(x.kind ?? "other"), n: num(x.n), sessions: num(x.sessions) })),
    notFound: arr(r.not_found).map((x) => ({ path: String(x.path), n: num(x.n) })),
    payments: { failingSubscriptions: num(obj(r.payments).failing_subscriptions), planPaymentsWaiting: num(obj(r.payments).plan_payments_waiting) },
    ai: { calls: num(ai.calls), failed: num(ai.failed), rate: pct(num(ai.failed), num(ai.calls), 1) },
    sms: { sent: num(sms.sent), undelivered: num(sms.undelivered), rate: pct(num(sms.undelivered), num(sms.sent), 1) },
    eventsSince: str(r.events_since),
  };
}
