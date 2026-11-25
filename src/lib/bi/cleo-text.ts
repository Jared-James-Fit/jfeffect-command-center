/**
 * The Analytics numbers as text for Cleo's business_analytics lookup (Nov 25 2026). Pure. Cleo
 * reads these lines, nothing else, so an answer about the business can only cite what's measured;
 * the header tells it to keep facts, possible reasons and recommendations apart and to say when a
 * number isn't collected.
 */
import { channelLabel } from "./channels";
import { featureTotals, countryName, count, duration, money, percent, SEGMENT_LABEL } from "./model";
import type { BiTabData, InsightsView } from "./bi.server";
import { pctChange, rangeLabel, type BiRange } from "./period";

export const ANALYTICS_RULES = [
  "These are JF Effect's own analytics, read from the app's records. Use only these numbers.",
  "In your answer, label FACTS (a number below), POSSIBLE REASONS (a hypothesis, said as one) and RECOMMENDATIONS (what to try) separately.",
  "Never invent a number, a trend or a cause. If something isn't measured here, say it isn't tracked.",
  "Visits are tracked since Nov 23 2026 and the website's steps since Nov 19 2026; activity, sign-ups, applications and payments reach further back.",
  "Nothing you say changes the business or the app; anything to do is the owner's call.",
].join("\n");

const ch = (n: number | null) => (n == null ? "" : ` (${n > 0 ? "+" : ""}${n}% vs the period before)`);

export function analyticsText(section: keyof BiTabData | "all", range: BiRange, d: Partial<BiTabData>): string {
  const out: string[] = [ANALYTICS_RULES, "", `Period: ${rangeLabel(range)} (${range.from} to ${range.to}), business days in Winnipeg.`];
  const want = (s: keyof BiTabData) => section === "all" || section === s;

  if (want("overview") && d.overview) {
    const c = d.overview.current;
    const p = d.overview.previous;
    // visits are recorded since Nov 23 2026: never compared with a period that reaches before that
    const vch = (now: number, before: number) => (d.overview!.prevVisitsTracked ? ch(pctChange(now, before)) : "");
    out.push(
      "",
      "OVERVIEW",
      `- Visitors ${count(c.visitors)}${vch(c.visitors, p.visitors)}; new ${count(c.newVisitors)}, returning ${count(c.returningVisitors)}.${d.overview.prevVisitsTracked ? "" : " (Visits weren't recorded for all of the period before, so there's no comparison.)"}`,
      `- Sessions ${count(c.sessions)}${vch(c.sessions, p.sessions)}; engaged ${percent(c.engagementRate)}, bounce ${percent(c.bounceRate)}; average ${duration(c.avgSessionSeconds)}.`,
      `- Active people (clients and members who did anything): ${count(c.activePeople)} in the period; daily average ${c.dauAvg}; last 7 days ${c.wau}; last 30 days ${c.mau}.`,
      `- New accounts ${c.registrations}${ch(pctChange(c.registrations, p.registrations))}; membership applications ${c.memberApplications}; coaching applications ${c.coachingApplications}.`,
      `- New paying clients ${c.newPaying} (from a free account first: ${c.freeToPaid}); paying clients ${c.payingClients}.`,
      `- Revenue ${money(c.revenueCents)} before tax${ch(pctChange(c.revenueCents, p.revenueCents))} (coaching ${money(c.revenueCoachingCents)}, credit packs ${money(c.revenueCreditsCents)}, other ${money(c.revenueOtherCents)}).`,
      `- MRR now ${money(d.overview.mrr.mrrCents)} from ${d.overview.mrr.subscriptions} subscriptions (${d.overview.mrr.ending} ending, ${d.overview.mrr.failing} failing); ${d.overview.mrr.installmentPlans} installment plans aren't counted as recurring.`,
      `- Coaching clients: ${c.clientsAtStart} at the start, ${c.clientsStarted} started, ${c.clientsEnded} ended; retention ${percent(c.clientRetention)}.`,
      `- Live now: ${d.overview.live}.`,
    );
  }
  if (want("acquisition") && d.acquisition) {
    const a = d.acquisition;
    out.push("", "ACQUISITION (visits by the visit's own source; sign-ups, paying clients and revenue by first touch)");
    for (const c of a.channels.slice(0, 12))
      out.push(`- ${channelLabel(c.channel) === "Not recorded" ? "Not tracked" : channelLabel(c.channel)}: ${c.sessions} visits, ${c.visitors} visitors, engaged ${percent(c.engagementRate)}, ${c.registrations} sign-ups, ${c.memberApps + c.coachingApps} applications, ${c.newPayingFirst} new paying (last touch ${c.newPayingLast}), ${money(c.revenueCents)} revenue.`);
    if (a.campaigns.length) out.push(`- Campaigns: ${a.campaigns.slice(0, 8).map((c) => `${c.campaign} (${c.sessions} visits, ${c.registrations} sign-ups)`).join("; ")}.`);
    if (a.landingPages.length) out.push(`- Landing pages: ${a.landingPages.slice(0, 8).map((p) => `${p.path} ${p.sessions} visits, ${p.converted} applied`).join("; ")}.`);
    out.push(`- How paying clients are attributed: ${Object.entries(a.attribution.payingAll).map(([k, n]) => `${k} ${n}`).join(", ") || "none"}.`);
  }
  if (want("geography") && d.geography) {
    const g = d.geography;
    out.push("", "GEOGRAPHY (approximate: IP country, time-zone city)");
    out.push(`- Countries: ${g.countries.slice(0, 8).map((c) => `${countryName(c.country)} ${c.sessions} visits, ${c.registrations} new accounts, ${c.paying} paying`).join("; ") || "none"}.`);
    if (g.regions.length) out.push(`- Provinces/states: ${g.regions.slice(0, 8).map((r) => `${r.region} ${r.sessions} visits${r.growth != null ? ` (${r.growth}%)` : r.prevSessions === 0 ? " (new)" : ""}`).join("; ")}.`);
    out.push(`- Visits without a place: ${g.unplacedSessions}.`);
  }
  if (want("conversions") && d.conversions) {
    const m = d.conversions.main;
    const o = d.conversions.onboarding;
    out.push(
      "",
      "CONVERSIONS (people reaching each step in the period)",
      `- ${m.siteVisitors != null ? `Website visitors ${m.siteVisitors} → ` : "(visits weren't recorded for all of this period) "}landing/coaching page ${m.landing} → pricing ${m.pricing} → started applying ${m.started} → sent ${m.submitted} → accounts ${m.accounts} → checkout ${m.checkout} → paid ${m.paid}.`,
      `- Still a client 60 days after paying: ${m.retained} of ${m.retainedBase}.`,
      `- Onboarding: ${o.accounts} new accounts; came back ${o.cameBack}; trained in week 1 ${o.trainedWeek1}; active in week 2 ${o.week2Active} of ${o.week2Base}.`,
      `- Checkouts: plan ${d.conversions.checkouts.planStarted} started / ${d.conversions.checkouts.planCompleted} finished; payment links ${d.conversions.checkouts.linksSent} sent / ${d.conversions.checkouts.linksPaid} paid.`,
      `- Median days: first visit → account ${d.conversions.timing.visitToAccountDays ?? "n/a"}; account → first payment ${d.conversions.timing.accountToPaidDays ?? "n/a"}.`,
    );
  }
  if (want("engagement") && d.engagement) {
    out.push("", "APP ENGAGEMENT (people active in the period: " + Object.entries(d.engagement.base).map(([k, n]) => `${SEGMENT_LABEL[k] ?? k} ${n}`).join(", ") + ")");
    for (const f of featureTotals(d.engagement)) out.push(`- ${f.label}: ${f.users} people (${percent(f.adoption)} of active), ${percent(f.repeatRate)} on 2+ days; before ${f.prevUsers}.`);
    const assoc = d.engagement.association.byFeature.filter((f) => f.lift != null);
    if (assoc.length) out.push(`- Early use vs staying (association only): ${assoc.map((f) => `${f.label} ${f.usedRate}% vs ${f.notUsedRate}%`).join("; ")}.`);
  }
  if (want("retention") && d.retention) {
    const r = d.retention;
    out.push("", "RETENTION");
    out.push(`- ${r.dayN.map((x) => `Day ${x.n}: ${percent(x.rate)} (${x.kept}/${x.eligible})`).join("; ")}.`);
    out.push(`- Returning people in the period: ${r.returning.returning} of ${r.returning.active}.`);
    out.push(`- At risk (active before, quiet 10+ days): ${r.atRisk.length}${r.atRisk.length ? ` — ${r.atRisk.slice(0, 10).map((p) => `${p.name} (${p.tier}, last ${p.lastDay})`).join(", ")}` : ""}.`);
    out.push(`- Coaching clients by month: ${r.clientsByMonth.slice(-6).map((m) => `${m.month} +${m.started}/-${m.ended}`).join(", ")}.`);
  }
  if (want("revenue") && d.revenue) {
    const v = d.revenue;
    out.push(
      "",
      "REVENUE (billing records; before tax)",
      `- This period ${money(v.current.revenueCents)} from ${v.current.payingClients} paying clients (per client ${money(v.current.arppuCents)}); before ${money(v.previous.revenueCents)}.`,
      `- By month: ${v.byMonth.slice(-6).map((m) => `${m.month} ${money(m.totalCents, { whole: true })}`).join(", ")}.`,
      `- MRR ${money(v.mrr.mrrCents)}; by package ${v.mrr.byPackage.map((p) => `${p.package} ${money(p.mrrCents)}`).join(", ") || "none"}.`,
      `- Lifetime: ${v.lifetime.clients} paying clients ever, ${money(v.lifetime.paidCents)} paid, average ${money(v.lifetime.avgPerClientCents)} each.`,
      v.ltv.cents != null ? `- Lifetime value estimate ${money(v.ltv.cents)} (monthly ${money(v.ltv.monthlyArppuCents)} ÷ churn ${v.ltv.monthlyChurn}%).` : `- Lifetime value not estimated: ${v.ltv.reason}`,
      `- Failing subscriptions ${v.failing.subscriptions}.`,
    );
  }
  if (want("technical") && d.technical) {
    const t = d.technical;
    out.push("", "TECHNICAL (customers' visits; collected since " + (t.eventsSince ?? "not yet") + ")");
    out.push(`- Vitals p75: ${t.vitals.map((v) => `${v.metric} ${v.p75 == null ? "n/a" : Math.round(v.p75 * 100) / 100} (${v.n} readings, good ${percent(v.goodRate)})`).join("; ") || "none yet"}.`);
    out.push(`- Errors: ${t.errors.events} in ${t.errors.sessions} visits (${percent(t.errors.rate)} of visits)${t.errors.top.length ? `; top: ${t.errors.top.slice(0, 3).map((e) => `"${e.label}" ×${e.n}`).join(", ")}` : ""}.`);
    out.push(`- Failed requests: ${t.failedRequests.slice(0, 5).map((f) => `${f.area} ${f.kind} ×${f.n}`).join(", ") || "none"}; pages not found ${t.notFound.reduce((s, x) => s + x.n, 0)}.`);
    out.push(`- Devices: ${Object.entries(t.byDevice).map(([k, n]) => `${k} ${n}`).join(", ")}; AI calls failed ${t.ai.failed}/${t.ai.calls}.`);
  }
  if (section === "all" || section === "insights") {
    const ins = (d.insights as InsightsView | undefined)?.insights ?? [];
    if (ins.length) {
      out.push("", "RULE-BASED INSIGHTS (computed in code from the numbers above)");
      for (const i of ins.slice(0, 8)) out.push(`- ${i.title}. Fact: ${i.fact}${i.hypothesis ? ` Possible reason: ${i.hypothesis}` : ""}${i.recommendation ? ` Recommendation: ${i.recommendation}` : ""} [impact ${i.impact}/3, urgency ${i.urgency}/3, confidence ${i.confidence}]`);
    }
    const w = (d.insights as InsightsView | undefined)?.weekly;
    if (w) out.push("", `LAST FULL WEEK (${w.label}): ${w.headline} ${w.lines.map((l) => `${l.label} ${l.value}${l.change ? ` (${l.change})` : ""}`).join("; ")}.`);
  }
  return out.join("\n");
}
