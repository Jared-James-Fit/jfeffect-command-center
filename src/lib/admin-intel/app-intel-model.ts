/**
 * App & website (Nov 23 2026): the read app_intel_report returns, shaped for the page, plus the
 * handful of takeaways worth acting on. Pure.
 *
 * Definitions (the page repeats them):
 * - Active person: a signed-in client or member who opened the app that day (staff and test
 *   logins never count). Before Nov 23 2026 only coaching clients' sign-ins were kept, so earlier
 *   days undercount members.
 * - Live: a visit with a heartbeat in the last 5 minutes.
 * - Session: one visit; closing the app or 30 minutes away starts a new one.
 * - Website visitor: an anonymous browser that opened the landing page (one id per browser).
 */
import { DEVICE_LABEL, PLATFORM_LABEL } from "@/lib/app-pulse/pulse-rules";

export type AppIntelView = {
  days: number;
  from: string;
  today: string;
  trackingSince: string | null;
  live: { total: number; byAudience: Record<string, number>; byFeature: { feature: string; n: number }[] };
  now: {
    dau: number;
    wau: number;
    mau: number;
    wauPrev: number;
    mauPrev: number;
    people: number;
    members: number;
    clients: number;
    pending: number;
    signups: number;
    signupsPrev: number;
  };
  daily: { day: string; active: number; active7: number; sessions: number; landing: number; siteVisitors: number; signups: number }[];
  sessions: {
    count: number;
    medianMinutes: number | null;
    viewsPer: number | null;
    byPlatform: { key: string; label: string; n: number }[];
    byDevice: { key: string; label: string; n: number }[];
    byHour: { dow: number; hour: number; n: number }[];
  };
  pages: { feature: string; people: number; views: number }[];
  staffPages: { feature: string; views: number }[];
  actions: { action: string; people: number }[];
  pushDevices: { key: string; n: number }[];
  places: { key: string; label: string; country: string | null; region: string | null; city: string | null; lat: number | null; lng: number | null; people: number; visitors: number; sessions: number; live: number }[];
  unplacedSessions: number;
  site: {
    landingVisitors: number;
    landingPrev: number;
    sources: { source: string; visitors: number }[];
    devices: { key: string; label: string; n: number }[];
    steps: Record<string, number>;
    memberApps: number;
    memberApproved: number;
    memberJoined: number;
    coachingApps: number;
    coachingConverted: number;
  };
  retention: { cohort: string; size: number; months: { m: number; active: number }[] }[];
  onboarding: { joined: number; cameBack: number; trainedWeek1: number; everTrained: number; activeWeek4: number; week4Eligible: number };
  churn: { month: string; ended: number; started: number }[];
  revenue: { month: string; cashIn: number; refunds: number }[];
  subscriptions: { active: number; ending: number; failing: number };
  takeaways: { key: string; tone: "info" | "warning"; text: string }[];
};

const n = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : 0);
const obj = (v: unknown) => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});
const arr = (v: unknown) => (Array.isArray(v) ? (v as any[]) : []);

function mapCounts(v: unknown, labels: Record<string, string>): { key: string; label: string; n: number }[] {
  return Object.entries(obj(v))
    .map(([key, c]) => ({ key, label: labels[key] ?? key, n: n(c) }))
    .filter((r) => r.n > 0)
    .sort((a, b) => b.n - a.n);
}

const COUNTRY: Record<string, string> = { CA: "Canada", US: "United States", GB: "United Kingdom", AU: "Australia", PH: "Philippines", IN: "India", MX: "Mexico" };

function placeLabel(p: { city: string | null; region: string | null; country: string | null }): string {
  const country = p.country ? (COUNTRY[p.country] ?? p.country) : null;
  if (p.city) return [p.city, p.region && p.region !== p.city ? p.region : null].filter(Boolean).join(", ") + (p.country && p.country !== "CA" ? ` · ${country}` : "");
  if (p.region) return `${p.region}${country ? ` · ${country}` : ""}`;
  return country ?? "Unknown";
}

export function shapeAppIntel(raw: unknown): AppIntelView {
  const r = obj(raw);
  const now = obj(r.now);
  const live = obj(r.live);
  const sessions = obj(r.sessions);
  const site = obj(r.site);
  const ob = obj(r.onboarding);
  const subs = obj(r.subscriptions);

  // pages: one row per feature, people added across audiences (staff kept apart)
  const pageMap = new Map<string, { feature: string; people: number; views: number }>();
  for (const f of arr(r.features)) {
    if (f.audience === "staff" || f.audience === "test") continue;
    const k = String(f.feature);
    const cur = pageMap.get(k) ?? { feature: k, people: 0, views: 0 };
    cur.people += n(f.people);
    cur.views += n(f.views);
    pageMap.set(k, cur);
  }

  const view: AppIntelView = {
    days: n(r.days) || 30,
    from: String(r.from ?? ""),
    today: String(r.today ?? ""),
    trackingSince: (r.tracking_since as string) ?? null,
    live: {
      total: n(live.total),
      byAudience: Object.fromEntries(Object.entries(obj(live.by_audience)).map(([k, v]) => [k, n(v)])),
      byFeature: arr(live.by_feature).map((x) => ({ feature: String(x.feature), n: n(x.n) })),
    },
    now: {
      dau: n(now.dau),
      wau: n(now.wau),
      mau: n(now.mau),
      wauPrev: n(now.wau_prev),
      mauPrev: n(now.mau_prev),
      people: n(now.people),
      members: n(now.members),
      clients: n(now.clients),
      pending: n(now.pending),
      signups: n(now.signups_window),
      signupsPrev: n(now.signups_prev),
    },
    daily: arr(r.daily).map((d) => ({
      day: String(d.day),
      active: n(d.active),
      active7: n(d.active7),
      sessions: n(d.sessions),
      landing: n(d.landing),
      siteVisitors: n(d.site_visitors),
      signups: n(d.signups),
    })),
    sessions: {
      count: n(sessions.count),
      medianMinutes: sessions.median_minutes == null ? null : n(sessions.median_minutes),
      viewsPer: sessions.views_per == null ? null : n(sessions.views_per),
      byPlatform: mapCounts(sessions.by_platform, PLATFORM_LABEL),
      byDevice: mapCounts(sessions.by_device, DEVICE_LABEL),
      byHour: arr(sessions.by_hour).map((h) => ({ dow: n(h.dow), hour: n(h.hour), n: n(h.n) })),
    },
    pages: [...pageMap.values()].sort((a, b) => b.people - a.people || b.views - a.views),
    staffPages: arr(r.staff_pages).map((p) => ({ feature: String(p.feature), views: n(p.views) })),
    actions: arr(r.actions).map((a) => ({ action: String(a.action), people: n(a.people) })).sort((a, b) => b.people - a.people),
    pushDevices: Object.entries(obj(r.push_devices)).map(([key, c]) => ({ key, n: n(c) })).sort((a, b) => b.n - a.n),
    places: arr(r.places).map((p) => {
      const place = { city: p.city ?? null, region: p.region ?? null, country: p.country ?? null };
      return {
        key: [place.country, place.region, place.city].join("|"),
        label: placeLabel(place),
        ...place,
        lat: p.lat == null ? null : n(p.lat),
        lng: p.lng == null ? null : n(p.lng),
        people: n(p.people),
        visitors: n(p.visitors),
        sessions: n(p.sessions),
        live: n(p.live),
      };
    }),
    unplacedSessions: n(r.unplaced_sessions),
    site: {
      landingVisitors: n(site.landing_visitors),
      landingPrev: n(site.landing_prev),
      sources: arr(site.sources).map((s) => ({ source: prettySource(String(s.source)), visitors: n(s.visitors) })),
      devices: mapCounts(site.devices, DEVICE_LABEL),
      steps: Object.fromEntries(Object.entries(obj(site.steps)).map(([k, v]) => [k, n(v)])),
      memberApps: n(site.member_apps),
      memberApproved: n(site.member_approved),
      memberJoined: n(site.member_joined),
      coachingApps: n(site.coaching_apps),
      coachingConverted: n(site.coaching_converted),
    },
    retention: arr(r.retention).map((c) => ({
      cohort: String(c.cohort).slice(0, 7),
      size: n(c.size),
      months: arr(c.months).map((m) => ({ m: n(m.m), active: n(m.active) })),
    })),
    onboarding: {
      joined: n(ob.joined),
      cameBack: n(ob.came_back),
      trainedWeek1: n(ob.trained_week1),
      everTrained: n(ob.ever_trained),
      activeWeek4: n(ob.active_week4),
      week4Eligible: n(ob.week4_eligible),
    },
    churn: arr(r.churn).map((c) => ({ month: String(c.month), ended: n(c.ended), started: n(c.started) })),
    revenue: arr(r.revenue).map((m) => ({ month: String(m.month), cashIn: n(m.cash_in), refunds: n(m.refunds) })),
    subscriptions: { active: n(subs.active), ending: n(subs.ending), failing: n(subs.failing) },
    takeaways: [],
  };
  view.takeaways = takeaways(view);
  return view;
}

const SOURCE_NAMES: Record<string, string> = {
  "instagram.com": "Instagram",
  "l.instagram.com": "Instagram",
  ig: "Instagram",
  instagram: "Instagram",
  "facebook.com": "Facebook",
  "m.facebook.com": "Facebook",
  "l.facebook.com": "Facebook",
  "google.com": "Google",
  "t.co": "X",
  "tiktok.com": "TikTok",
  tiktok: "TikTok",
};

export function prettySource(s: string): string {
  const k = s.toLowerCase().replace(/^www\./, "");
  return SOURCE_NAMES[k] ?? (k === "direct" ? "Direct or typed" : s);
}

const DOW = ["", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function hourLabel(h: number): string {
  if (h === 0) return "12 AM";
  if (h === 12) return "12 PM";
  return h < 12 ? `${h} AM` : `${h - 12} PM`;
}

/** The few things worth acting on, each from the numbers on the page; nothing when data's thin. */
export function takeaways(v: AppIntelView): { key: string; tone: "info" | "warning"; text: string }[] {
  const out: { key: string; tone: "info" | "warning"; text: string }[] = [];
  const o = v.onboarding;
  if (o.joined >= 3) {
    const steps = [
      { k: "came back on another day", n: o.cameBack },
      { k: "logged a workout in their first week", n: o.trainedWeek1 },
    ];
    const worst = steps.reduce((a, b) => (b.n < a.n ? b : a));
    if (worst.n / o.joined < 0.6)
      out.push({
        key: "onboarding",
        tone: "warning",
        text: `Of ${o.joined} people who joined in the last 6 months, ${worst.n} ${worst.k}. That's the step to fix first.`,
      });
  }
  if (o.week4Eligible >= 3) {
    out.push({
      key: "week4",
      tone: o.activeWeek4 / o.week4Eligible < 0.5 ? "warning" : "info",
      text: `${o.activeWeek4} of ${o.week4Eligible} people who joined more than 5 weeks ago were still opening the app in their 4th week.`,
    });
  }
  const zero = v.actions.filter((a) => a.people === 0).map((a) => a.action.toLowerCase());
  if (v.now.mau >= 5 && zero.length)
    out.push({ key: "unused", tone: "info", text: `In the last 30 days nobody ${joinWords(zero)}.` });
  const hours = [...v.sessions.byHour].sort((a, b) => b.n - a.n);
  const totalHours = hours.reduce((s, h) => s + h.n, 0);
  if (totalHours >= 30 && hours[0]) {
    const top = hours[0];
    out.push({ key: "peak", tone: "info", text: `People open the app most on ${DOW[top.dow]}s around ${hourLabel(top.hour)}: the best time for a post or a message to be seen.` });
  }
  const plat = v.sessions.byPlatform;
  const platTotal = plat.reduce((s, p) => s + p.n, 0);
  if (platTotal >= 20 && plat[0] && plat[0].n / platTotal >= 0.5)
    out.push({ key: "platform", tone: "info", text: `${Math.round((plat[0].n / platTotal) * 100)}% of visits come from the ${plat[0].label.toLowerCase()}: test changes there first.` });
  if (v.site.landingVisitors >= 30) {
    const applied = v.site.memberApps + v.site.coachingApps;
    out.push({
      key: "site",
      tone: applied === 0 ? "warning" : "info",
      text: `${v.site.landingVisitors} people opened the landing page and ${applied} applied (${Math.round((applied / v.site.landingVisitors) * 1000) / 10}%).`,
    });
  }
  if (v.subscriptions.failing > 0)
    out.push({ key: "failing", tone: "warning", text: `${v.subscriptions.failing} subscription${v.subscriptions.failing === 1 ? " is" : "s are"} failing to charge.` });
  return out.slice(0, 5);
}

function joinWords(xs: string[]): string {
  if (xs.length <= 1) return xs[0] ?? "";
  return `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}`;
}
