/**
 * Cleo's business insights (Nov 25 2026): what's worth acting on, read from the Analytics tabs'
 * numbers by rules in code, never by a model. Pure and tested (business-intelligence.test.ts).
 *
 * Every insight keeps three things apart:
 *   fact            what the numbers say, with the numbers (the evidence lines are its source)
 *   hypothesis      a possible reason, said as a possibility (never as the cause)
 *   recommendation  what to try or look at; nothing here changes the business or the app
 * and is ranked by impact × urgency × confidence. Each rule has a minimum sample and stays quiet
 * below it; a small business gets few insights, which is the honest answer.
 *
 * The weekly summary is the last full Monday–Sunday week against the week before, in plain words.
 */
import { CHANNEL_LABEL, type Channel } from "./channels";
import {
  biggestDrop,
  countryName,
  count,
  duration,
  featureTotals,
  money,
  percent,
  type AcquisitionView,
  type BiTab,
  type ConversionsView,
  type EngagementView,
  type GeographyView,
  type Kpis,
  type OverviewView,
  type RetentionView,
  type RevenueView,
  type TechnicalView,
} from "./model";
import { pct, pctChange, rangeLabel, type BiRange } from "./period";

export type Confidence = "high" | "medium" | "low";

export type BiInsight = {
  id: string;
  tab: BiTab;
  title: string;
  fact: string;
  hypothesis: string | null;
  recommendation: string | null;
  evidence: string[];
  /** 1 (minor) to 3 (major): how much it could move revenue, clients or the experience */
  impact: 1 | 2 | 3;
  /** 1 (whenever) to 3 (now) */
  urgency: 1 | 2 | 3;
  confidence: Confidence;
  score: number;
};

export type InsightInputs = {
  today: string;
  overview?: OverviewView | null;
  acquisition?: AcquisitionView | null;
  geography?: GeographyView | null;
  conversions?: ConversionsView | null;
  engagement?: EngagementView | null;
  retention?: RetentionView | null;
  revenue?: RevenueView | null;
  technical?: TechnicalView | null;
};

const CONF_WEIGHT: Record<Confidence, number> = { high: 1, medium: 0.75, low: 0.5 };

function make(i: Omit<BiInsight, "score">): BiInsight {
  return { ...i, score: Math.round(i.impact * i.urgency * CONF_WEIGHT[i.confidence] * 100) / 100 };
}

/** A sample's confidence: a few is low, a couple of dozen medium, more high. */
export function confidenceFor(n: number): Confidence {
  if (n >= 50) return "high";
  if (n >= 15) return "medium";
  return "low";
}

const chLabel = (c: string) => (CHANNEL_LABEL as Record<string, string>)[c] ?? (c === "untracked" ? "Not tracked" : c);
const signed = (n: number | null) => (n == null ? "" : `${n > 0 ? "+" : ""}${n}%`);

export function buildInsights(x: InsightInputs): BiInsight[] {
  const out: BiInsight[] = [];
  const o = x.overview;

  // --- money that's at risk now -------------------------------------------------------------
  const failing = x.revenue?.failing.subscriptions ?? x.technical?.payments.failingSubscriptions ?? 0;
  if (failing > 0) {
    out.push(make({
      id: "failing-payments",
      tab: "revenue",
      title: `${failing} subscription${failing === 1 ? " is" : "s are"} failing to charge`,
      fact: `${failing} live subscription${failing === 1 ? "" : "s"} past due or unpaid in Stripe.`,
      hypothesis: "An expired or declined card is the usual reason.",
      recommendation: "Open Sales → Plans to see which client, and send them their card-update link.",
      evidence: [`Failing subscriptions: ${failing}`],
      impact: 3,
      urgency: 3,
      confidence: "high",
    }));
  }
  if (o && o.mrr.ending > 0) {
    out.push(make({
      id: "mrr-ending",
      tab: "revenue",
      title: `${money(o.mrr.endingMrrCents, { whole: true })} of monthly revenue is set to end`,
      fact: `${o.mrr.ending} subscription${o.mrr.ending === 1 ? " is" : "s are"} cancelling at the end of the paid month (${money(o.mrr.endingMrrCents, { whole: true })} of ${money(o.mrr.mrrCents, { whole: true })} MRR).`,
      hypothesis: null,
      recommendation: "A check-in with each before their last billing date is the cheapest client you'll ever keep.",
      evidence: [`MRR ${money(o.mrr.mrrCents)}`, `Ending ${money(o.mrr.endingMrrCents)}`],
      impact: 3,
      urgency: 2,
      confidence: "high",
    }));
  }

  // --- people drifting away -----------------------------------------------------------------
  const r = x.retention;
  if (r && r.atRisk.length) {
    const clients = r.atRisk.filter((p) => p.tier === "client");
    out.push(make({
      id: "at-risk",
      tab: "retention",
      title: `${r.atRisk.length} active ${r.atRisk.length === 1 ? "person has" : "people have"} gone quiet`,
      fact: `${r.atRisk.length} (${clients.length} coaching client${clients.length === 1 ? "" : "s"}) used the app on 4+ days last month and not in the last 10 days.`,
      hypothesis: "A missed week often becomes a lost client; it can also be travel, illness or a planned break.",
      recommendation: "A short personal message today. The names are on the Retention tab.",
      evidence: r.atRisk.slice(0, 5).map((p) => `${p.name} (${p.tier}), last active ${p.lastDay}`),
      impact: clients.length ? 3 : 2,
      urgency: 3,
      confidence: "high",
    }));
  }
  const d7 = r?.dayN.find((d) => d.n === 7);
  if (d7 && d7.eligible >= 10 && d7.rate != null && d7.rate < 35) {
    out.push(make({
      id: "day7",
      tab: "retention",
      title: `Only ${d7.rate}% are still using the app in their second week`,
      fact: `${d7.kept} of ${d7.eligible} people who joined (and have had two weeks) were active in days 7–13.`,
      hypothesis: "People who don't train in their first week rarely start later.",
      recommendation: "Make the first workout the first thing a new member sees, and nudge on day 2 and day 5.",
      evidence: [`Day 7 retention ${percent(d7.rate)} (${d7.kept}/${d7.eligible})`],
      impact: 3,
      urgency: 2,
      confidence: confidenceFor(d7.eligible),
    }));
  }

  // --- the funnel ---------------------------------------------------------------------------
  const c = x.conversions;
  if (c) {
    const steps = [
      ...(c.main.siteVisitors != null ? [{ label: "Website visitors", value: c.main.siteVisitors }] : []),
      { label: "Saw the landing page", value: c.main.landing },
      { label: "Saw pricing", value: c.main.pricing },
      { label: "Started applying", value: c.main.started },
      { label: "Sent it", value: c.main.submitted },
    ];
    const drop = biggestDrop(steps, 15);
    if (drop && drop.keptPct < 40) {
      out.push(make({
        id: "funnel-drop",
        tab: "conversions",
        title: `Most people leave between “${drop.from}” and “${drop.to}”`,
        fact: `${drop.keptPct}% of people who ${drop.from.toLowerCase()} went on to ${drop.to.toLowerCase()} (${drop.lost} didn't).`,
        hypothesis: "That step asks for more than the one before earns, or its next step isn't obvious.",
        recommendation: `Look at the page behind “${drop.to}”: one clear next step, above the fold on a phone.`,
        evidence: steps.map((s) => `${s.label}: ${s.value}`),
        impact: 3,
        urgency: 2,
        confidence: confidenceFor(steps[0].value),
      }));
    }
    const ob = c.onboarding;
    if (ob.accounts >= 4) {
      const rate = pct(ob.trainedWeek1, ob.accounts) ?? 0;
      if (rate < 50) {
        out.push(make({
          id: "onboarding-week1",
          tab: "conversions",
          title: `${100 - rate}% of new accounts didn't train in their first week`,
          fact: `${ob.trainedWeek1} of ${ob.accounts} new accounts finished a workout within 7 days.`,
          hypothesis: "Setup, finding a program or the first workout is where they stop.",
          recommendation: "Check where new members end up after setup: a program on their calendar before they leave setup is the fix that usually works.",
          evidence: [`Accounts ${ob.accounts}`, `Came back another day ${ob.cameBack}`, `Trained in week 1 ${ob.trainedWeek1}`],
          impact: 3,
          urgency: 2,
          confidence: confidenceFor(ob.accounts),
        }));
      }
    }
    const k = c.checkouts;
    const started = k.planStarted + k.linksSent;
    const done = k.planCompleted + k.linksPaid;
    if (started >= 3 && done / started < 0.5) {
      out.push(make({
        id: "checkout-abandon",
        tab: "conversions",
        title: `${started - done} of ${started} checkouts weren't finished`,
        fact: `${done} of ${started} checkouts and payment links started in this period were paid.`,
        hypothesis: "A price surprise (tax), a card problem, or they meant to come back later.",
        recommendation: "Follow up personally on each unpaid link; the client's Billing tab shows which.",
        evidence: [`Plan checkouts ${k.planStarted} (finished ${k.planCompleted})`, `Payment links ${k.linksSent} (paid ${k.linksPaid})`],
        impact: 3,
        urgency: 2,
        confidence: confidenceFor(started),
      }));
    }
  }

  // --- channels -----------------------------------------------------------------------------
  const a = x.acquisition;
  if (a) {
    const payers = a.channels.filter((ch) => ch.newPayingFirst > 0 || ch.revenueCents > 0);
    if (payers.length) {
      const best = payers[0];
      out.push(make({
        id: "best-channel",
        tab: "acquisition",
        title: `${chLabel(best.channel)} brings in the most paying clients`,
        fact: `By first touch, ${chLabel(best.channel)} brought ${best.payingClients} paying client${best.payingClients === 1 ? "" : "s"} and ${money(best.revenueCents, { whole: true })} this period (${best.newPayingFirst} new).`,
        hypothesis: best.channel === "untracked" ? "Most paying clients joined before visits were tracked, so their first touch isn't known yet." : null,
        recommendation: best.channel === "untracked" ? "Use tagged links (?utm_source=…) everywhere you post so the next clients are attributed." : `Keep ${chLabel(best.channel)} first in your posting time; it's the channel that pays.`,
        evidence: payers.slice(0, 4).map((ch) => `${chLabel(ch.channel)}: ${money(ch.revenueCents)} from ${ch.payingClients} client(s), ${ch.registrations} sign-up(s)`),
        impact: 2,
        urgency: 1,
        confidence: confidenceFor(payers.reduce((s, ch) => s + ch.payingClients, 0) * 5),
      }));
    }
    const traffic = a.channels.filter((ch) => ch.channel !== "direct" && ch.visitors >= 20 && ch.registrations === 0 && ch.memberApps + ch.coachingApps === 0);
    for (const ch of traffic.slice(0, 2)) {
      out.push(make({
        id: `traffic-no-signups-${ch.channel}`,
        tab: "acquisition",
        title: `${chLabel(ch.channel)} sends visitors who don't sign up`,
        fact: `${ch.visitors} visitors from ${chLabel(ch.channel)} this period, no sign-ups or applications.`,
        hypothesis: "The link may land on a page that doesn't match what the post promised.",
        recommendation: `Point ${chLabel(ch.channel)} links at the page the post talks about, with one call to action.`,
        evidence: [`Visitors ${ch.visitors}`, `Engaged ${percent(ch.engagementRate)}`],
        impact: 2,
        urgency: 1,
        confidence: confidenceFor(ch.visitors),
      }));
    }
    const untracked = a.attribution.payingAll.none ?? 0;
    const totalPaying = Object.values(a.attribution.payingAll).reduce((s, n) => s + n, 0);
    if (totalPaying >= 3 && untracked / totalPaying > 0.5) {
      out.push(make({
        id: "attribution-gap",
        tab: "acquisition",
        title: "Most paying clients have no known source",
        fact: `${untracked} of ${totalPaying} paying clients have no tracked visit, application source or recorded source.`,
        hypothesis: "They joined before visit tracking started (Nov 23 2026) or came by direct message.",
        recommendation: "Ask new clients where they found you and put it in their record's Source, and tag every link you post.",
        evidence: Object.entries(a.attribution.payingAll).map(([k, n]) => `${k}: ${n}`),
        impact: 1,
        urgency: 1,
        confidence: "high",
      }));
    }
    for (const lp of a.landingPages.filter((p) => p.sessions >= 20 && p.engaged / Math.max(1, p.sessions) < 0.4).slice(0, 2)) {
      out.push(make({
        id: `landing-bounce-${lp.path}`,
        tab: "acquisition",
        title: `${lp.path} loses most visitors straight away`,
        fact: `${Math.round(100 - (lp.engaged / lp.sessions) * 100)}% of ${lp.sessions} visits that started on ${lp.path} left within 10 seconds on one page.`,
        hypothesis: "It loads slowly on a phone, or its first screen doesn't say what to do next.",
        recommendation: `Check ${lp.path} on a phone: the first screen should answer "what is this and what do I tap".`,
        evidence: [`Sessions ${lp.sessions}`, `Engaged ${lp.engaged}`, `Average time ${duration(lp.avgSeconds)}`],
        impact: 2,
        urgency: 2,
        confidence: confidenceFor(lp.sessions),
      }));
    }
  }

  // --- traffic and revenue moves ------------------------------------------------------------
  if (o) {
    const cur = o.current;
    const prev = o.previous;
    const visitChange = pctChange(cur.visitors, prev.visitors);
    if (o.prevVisitsTracked && prev.visitors >= 20 && visitChange != null && Math.abs(visitChange) >= 40) {
      out.push(make({
        id: "visitors-move",
        tab: "overview",
        title: `Visitors ${visitChange > 0 ? "up" : "down"} ${Math.abs(visitChange)}%`,
        fact: `${count(cur.visitors)} visitors against ${count(prev.visitors)} in the same number of days before.`,
        hypothesis: visitChange > 0 ? "A post or a share likely drove it; the Acquisition tab shows which channel grew." : "Fewer posts, or a channel that stopped sending people.",
        recommendation: visitChange > 0 ? "Find the post behind it and make another like it this week." : "Compare channels on the Acquisition tab and restart whatever slowed.",
        evidence: [`Now ${cur.visitors}`, `Before ${prev.visitors}`],
        impact: 2,
        urgency: visitChange < 0 ? 2 : 1,
        confidence: confidenceFor(prev.visitors),
      }));
    }
    const signupRateNow = pct(cur.registrations, cur.siteVisitors, 1);
    const signupRateBefore = pct(prev.registrations, prev.siteVisitors, 1);
    if (o.prevVisitsTracked && cur.siteVisitors >= 30 && prev.siteVisitors >= 30 && signupRateNow != null && signupRateBefore != null && signupRateBefore > 0 && signupRateNow < signupRateBefore * 0.6) {
      out.push(make({
        id: "conversion-decline",
        tab: "conversions",
        title: "Fewer visitors are signing up",
        fact: `${signupRateNow}% of website visitors got an account, down from ${signupRateBefore}%.`,
        hypothesis: "New traffic from a channel that converts less, a change to the landing page, or the application taking longer to approve.",
        recommendation: "Check the Conversions tab for the step that fell, and how long applications are waiting on you.",
        evidence: [`Accounts ${cur.registrations} / visitors ${cur.siteVisitors}`, `Before: ${prev.registrations} / ${prev.siteVisitors}`],
        impact: 3,
        urgency: 2,
        confidence: confidenceFor(Math.min(cur.siteVisitors, prev.siteVisitors)),
      }));
    }
    const revChange = pctChange(cur.revenueCents, prev.revenueCents);
    if (prev.revenueCents > 0 && revChange != null && Math.abs(revChange) >= 25) {
      out.push(make({
        id: "revenue-move",
        tab: "revenue",
        title: `Revenue ${revChange > 0 ? "up" : "down"} ${Math.abs(revChange)}%`,
        fact: `${money(cur.revenueCents, { whole: true })} against ${money(prev.revenueCents, { whole: true })} before (before tax, refunds out).`,
        hypothesis: revChange < 0 ? "Billing dates falling outside the period, a package paid in full last period, or a client ending." : "New clients or a package paid up front.",
        recommendation: revChange < 0 ? "Check the Revenue tab's months: a single missing payment is a billing date, a trend is churn." : null,
        evidence: [`Paying clients ${cur.payingClients} (before ${prev.payingClients})`],
        impact: 3,
        urgency: revChange < 0 ? 2 : 1,
        confidence: "high",
      }));
    }
    const days = o.daily.filter((d) => d.visitors > 0);
    if (days.length >= 7) {
      const sorted = [...days].map((d) => d.visitors).sort((p, q) => p - q);
      const median = sorted[Math.floor(sorted.length / 2)];
      const peak = days.reduce((p, q) => (q.visitors > p.visitors ? q : p));
      if (peak.visitors >= 10 && peak.visitors >= median * 3) {
        out.push(make({
          id: "traffic-spike",
          tab: "acquisition",
          title: `Unusual traffic on ${peak.day}`,
          fact: `${peak.visitors} visitors that day against a typical ${median}.`,
          hypothesis: "A post, a story share or a mention; or automated traffic that got past the filters.",
          recommendation: "Open Acquisition for that day's sources; if it brought sign-ups, repeat the post.",
          evidence: [`Peak ${peak.visitors}`, `Typical ${median}`],
          impact: 1,
          urgency: 1,
          confidence: "medium",
        }));
      }
    }
  }

  // --- features -----------------------------------------------------------------------------
  const e = x.engagement;
  if (e) {
    const totals = featureTotals(e);
    const base = Object.values(e.base).reduce((s, n) => s + n, 0);
    if (base >= 8) {
      const quiet = totals.filter((t) => ["nutrition", "progress", "community", "checkins", "cardio"].includes(t.feature) && t.adoption != null && t.adoption < 15);
      for (const t of quiet.slice(0, 2)) {
        out.push(make({
          id: `underused-${t.feature}`,
          tab: "engagement",
          title: `${t.label} is barely used`,
          fact: `${t.users} of ${base} active people (${percent(t.adoption)}) used it this period.`,
          hypothesis: "People don't find it, or it isn't part of their routine yet.",
          recommendation: "Before building more of it, make it reachable from where people already are (Home, the workout recap).",
          evidence: [`Users ${t.users}`, `Active people ${base}`],
          impact: 1,
          urgency: 1,
          confidence: confidenceFor(base),
        }));
      }
    }
    const top = e.association.byFeature.find((f) => f.lift != null && f.lift >= 20);
    if (top) {
      out.push(make({
        id: `association-${top.feature}`,
        tab: "engagement",
        title: `People who use ${top.label.toLowerCase()} early tend to stay`,
        fact: `${top.usedRate}% of people who used it in their first 14 days were still active in weeks 5–6, against ${top.notUsedRate}% of those who didn't (${top.used} and ${top.notUsed} people).`,
        hypothesis: "It's an association, not proof: committed people may simply do more of everything.",
        recommendation: `Worth testing: put ${top.label.toLowerCase()} in front of new people in week 1 and watch whether week-5 retention moves.`,
        evidence: [`Used early: ${top.usedStayed}/${top.used}`, `Didn't: ${top.notUsedStayed}/${top.notUsed}`],
        impact: 2,
        urgency: 1,
        confidence: confidenceFor(Math.min(top.used, top.notUsed) * 3),
      }));
    }
  }

  // --- places -------------------------------------------------------------------------------
  const g = x.geography;
  if (g && g.prevTracked && g.countries.length > 1) {
    const home = g.countries[0];
    const rising = g.regions
      .concat(g.countries.slice(1))
      .filter((p) => p.sessions >= 10 && p.growth != null && p.growth >= 50 && !(p.country === home.country && !p.region));
    const best = rising.sort((p, q) => q.sessions - p.sessions)[0];
    if (best) {
      out.push(make({
        id: `emerging-${best.country}-${best.region ?? ""}`,
        tab: "geography",
        title: `${best.region ?? countryName(best.country)} is growing`,
        fact: `${best.sessions} visits, ${signed(best.growth)} on the period before; ${best.registrations} new account(s) there.`,
        hypothesis: "A share in a local community or a creator there; places are approximate (IP country and time zone).",
        recommendation: best.registrations ? "Worth a post that speaks to people there." : "Watch it for another period before acting.",
        evidence: [`Visits ${best.sessions} (before ${best.prevSessions})`],
        impact: 1,
        urgency: 1,
        confidence: confidenceFor(best.sessions),
      }));
    }
  }

  // --- technical ----------------------------------------------------------------------------
  const t = x.technical;
  if (t) {
    if (t.sessions >= 30 && t.errors.rate != null && t.errors.rate >= 5) {
      const topErr = t.errors.top[0];
      out.push(make({
        id: "errors",
        tab: "technical",
        title: `${t.errors.rate}% of visits hit an error`,
        fact: `${t.errors.sessions} of ${t.sessions} visits had a script error${topErr ? `; the most common: “${topErr.label}” (${topErr.n}×, ${topErr.feature ?? "various pages"})` : ""}.`,
        hypothesis: "One broken screen usually accounts for most of it.",
        recommendation: topErr ? `Fix “${topErr.label}” on ${topErr.feature ?? "that page"} first.` : "Open the Technical tab's error list.",
        evidence: t.errors.top.slice(0, 3).map((x2) => `${x2.label} — ${x2.n}× in ${x2.sessions} visit(s)`),
        impact: 2,
        urgency: 3,
        confidence: confidenceFor(t.sessions),
      }));
    }
    for (const v of t.vitals.filter((x2) => (x2.metric === "LCP" || x2.metric === "INP") && x2.n >= 20)) {
      const limit = v.metric === "LCP" ? 2500 : 200;
      if (v.p75 != null && v.p75 > limit) {
        const slow = t.vitalsByFeature
          .filter((f) => f.metric === v.metric && f.n >= 5 && f.p75 != null && f.p75 > limit)
          .sort((p, q) => (q.p75 ?? 0) - (p.p75 ?? 0))[0];
        out.push(make({
          id: `vital-${v.metric}`,
          tab: "technical",
          title: v.metric === "LCP" ? "Pages are slow to show their main content" : "Taps are slow to respond",
          fact: `The slowest quarter of ${v.metric} readings are over ${v.metric === "LCP" ? `${(v.p75 / 1000).toFixed(1)}s` : `${Math.round(v.p75)}ms`} (Google's "good" is under ${v.metric === "LCP" ? "2.5s" : "200ms"}).`,
          hypothesis: slow ? `${slow.feature} is the slowest (${v.metric === "LCP" ? `${((slow.p75 ?? 0) / 1000).toFixed(1)}s` : `${Math.round(slow.p75 ?? 0)}ms`}).` : "Large images or a heavy first screen on phones.",
          recommendation: slow ? `Start with ${slow.feature}: what it loads before anything shows.` : "Check the largest pages on a mid-range phone.",
          evidence: [`${v.metric} p75 ${Math.round(v.p75)}`, `Readings ${v.n}`, `Good ${percent(v.goodRate)}`],
          impact: 2,
          urgency: 2,
          confidence: confidenceFor(v.n),
        }));
      }
    }
    if (t.ai.calls >= 20 && t.ai.rate != null && t.ai.rate >= 10) {
      out.push(make({
        id: "ai-failures",
        tab: "technical",
        title: `${t.ai.rate}% of AI calls failed`,
        fact: `${t.ai.failed} of ${t.ai.calls} AI calls failed in this period.`,
        hypothesis: "Credits, a provider outage or a model change.",
        recommendation: "Insights → Usage & spend shows which feature and why.",
        evidence: [`Failed ${t.ai.failed}`, `Calls ${t.ai.calls}`],
        impact: 2,
        urgency: 2,
        confidence: confidenceFor(t.ai.calls),
      }));
    }
  }

  return out.sort((p, q) => q.score - p.score || q.impact - p.impact);
}

// ---------------------------------------------------------------------------
// The weekly summary
// ---------------------------------------------------------------------------

export type WeeklySummary = {
  week: BiRange;
  label: string;
  lines: { label: string; value: string; change: string | null }[];
  headline: string;
};

function line(label: string, now: number, before: number, fmt: (n: number) => string): { label: string; value: string; change: string | null } {
  const ch = pctChange(now, before);
  const change = ch == null ? (before === 0 && now > 0 ? "new" : null) : signed(ch);
  return { label, value: fmt(now), change };
}

export function weeklySummary(week: BiRange, cur: Kpis, prev: Kpis, mrrCents: number | null, visitsTracked = true): WeeklySummary {
  const visitorsLine = line("Website visitors", cur.visitors, prev.visitors, count);
  const lines = [
    visitsTracked ? visitorsLine : { ...visitorsLine, change: null },
    line("People active in the app", cur.activePeople, prev.activePeople, count),
    line("New accounts", cur.registrations, prev.registrations, count),
    line("Applications", cur.applications, prev.applications, count),
    line("New paying clients", cur.newPaying, prev.newPaying, count),
    line("Revenue (before tax)", cur.revenueCents, prev.revenueCents, (n) => money(n, { whole: true })),
  ];
  if (mrrCents != null) lines.push({ label: "Monthly recurring revenue now", value: money(mrrCents, { whole: true }), change: null });
  // the headline is the biggest move worth saying, with a floor so "1 → 2" isn't news
  const moves = [
    { what: "revenue", now: cur.revenueCents / 100, before: prev.revenueCents / 100, floor: 100, fmt: (n: number) => money(n * 100, { whole: true }) },
    ...(visitsTracked ? [{ what: "website visitors", now: cur.visitors, before: prev.visitors, floor: 20, fmt: count }] : []),
    { what: "people active in the app", now: cur.activePeople, before: prev.activePeople, floor: 10, fmt: count },
    { what: "new accounts", now: cur.registrations, before: prev.registrations, floor: 5, fmt: count },
  ]
    .filter((m) => Math.max(m.now, m.before) >= m.floor)
    .map((m) => ({ ...m, ch: pctChange(m.now, m.before) }))
    .filter((m) => m.ch != null && Math.abs(m.ch) >= 15)
    .sort((p, q) => Math.abs(q.ch!) - Math.abs(p.ch!));
  const top = moves[0];
  const headline = top
    ? `${top.what[0].toUpperCase()}${top.what.slice(1)} ${top.ch! > 0 ? "up" : "down"} ${Math.abs(top.ch!)}% (${top.fmt(top.before)} → ${top.fmt(top.now)}).`
    : cur.newPaying
      ? `${cur.newPaying} new paying client${cur.newPaying === 1 ? "" : "s"}; everything else close to the week before.`
      : "A steady week: nothing moved more than 15%.";
  return { week, label: rangeLabel(week), lines, headline };
}
