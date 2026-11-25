/**
 * Session preparation (pure, tested in coaching-sessions.test.ts): what a call
 * is for, built from the records before any model writes a word, so every line
 * has a source and Cleo only ever adds to it.
 *
 *  - buildSessionPrep: what's going well, where to improve, what the athlete
 *    needs from the coach and the coach from the athlete, what's missing, the
 *    decisions to make and the milestones ahead. Each item says where it came
 *    from: a record, the coach's notes, the athlete's words, or the app's read
 *    (an interpretation, labelled).
 *  - planAgenda: 15 to 30 minutes in five sections, the athlete's corner and
 *    their own topics holding 25–35% of it.
 *  - recommendIntervention: the lowest effective intervention, from nothing to
 *    a full call, never a call for its own sake or one the week of a meet.
 */
import type { PrepInput } from "@/lib/coaching-packages/call-prep";
import type { SessionEvent } from "./events";
import { routeAnswers } from "./questionnaire";

export type Source = "record" | "coach" | "athlete" | "read" | "history";
export type PrepItem = { text: string; source: Source; ref?: string };

export type Commitment = {
  id: string;
  sessionId?: string | null;
  owner: "coach" | "athlete";
  text: string;
  dueOn: string | null;
  status: "open" | "done" | "dropped";
  sessionDate: string | null;
};

export type CompetitionContext = {
  expectedTotal: number | null;
  range: { conservative: number; high: number } | null;
  place: number | null;
  gamePlanReleased: boolean;
  /** the latest assessment's one-line finding */
  headline: string | null;
  /** decisions the competition read left open (class, attempts, taper) */
  openDecisions: string[];
  classGapKg: number | null;
};

export type SessionPrepInput = PrepInput & {
  event: SessionEvent | null;
  competition: CompetitionContext | null;
  commitments: Commitment[];
  /** confirmed lasting intelligence lines (client_intelligence) */
  intelligence: string[];
  coachNotes: string | null;
  coachPriorities: string[];
  /** what the athlete answered on the pre-call questions, by session key (routeAnswers places each) */
  answers: Record<string, string>;
};

export type SessionPrep = {
  goingWell: PrepItem[];
  improve: PrepItem[];
  athleteNeeds: PrepItem[];
  coachNeeds: PrepItem[];
  missing: PrepItem[];
  decisions: PrepItem[];
  milestones: PrepItem[];
  carriedOver: Commitment[];
};

const day = (iso: string | null | undefined) =>
  iso
    ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-CA", {
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      })
    : "";
const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b.slice(0, 10)}T00:00:00Z`) - Date.parse(`${a.slice(0, 10)}T00:00:00Z`)) / 86_400_000);

export function buildSessionPrep(x: SessionPrepInput): SessionPrep {
  const goingWell: PrepItem[] = [];
  const improve: PrepItem[] = [];
  const athleteNeeds: PrepItem[] = [];
  const coachNeeds: PrepItem[] = [];
  const missing: PrepItem[] = [];
  const decisions: PrepItem[] = [];
  const milestones: PrepItem[] = [];

  // training
  const wk = x.workouts;
  if (wk && wk.planned >= 4) {
    const share = wk.done / wk.planned;
    if (share >= 0.9)
      goingWell.push({ text: `${wk.done} of ${wk.planned} planned workouts done in the last 4 weeks`, source: "record" });
    else if (share < 0.75)
      improve.push({
        text: `${wk.missed} of ${wk.planned} planned workouts missed in the last 4 weeks`,
        source: "record",
      });
    if (wk.avgRating != null && wk.avgRating >= 4)
      goingWell.push({ text: `Sessions rated ${wk.avgRating.toFixed(1)} of 5 on average`, source: "record" });
    if (wk.avgRating != null && wk.avgRating <= 2.5)
      improve.push({ text: `Sessions rated ${wk.avgRating.toFixed(1)} of 5 on average`, source: "record" });
  } else if (!wk) missing.push({ text: "Recent workouts couldn't be read", source: "record" });
  if (wk?.lastDone && daysBetween(wk.lastDone, x.today) >= 10)
    improve.push({ text: `No workout logged since ${day(wk.lastDone)}`, source: "record" });

  // bodyweight
  const bw = x.bodyweight;
  if (!bw || (bw.latestKg == null && bw.avg7Kg == null))
    missing.push({ text: "Recent weigh-ins", source: "record" });
  else if (bw.stale) missing.push({ text: `A fresh weigh-in (the last is from ${day(bw.latestDate)})`, source: "record" });

  // check-ins and recovery
  const c = x.checkins;
  if (!c || c.count === 0) missing.push({ text: "A recent weekly check-in", source: "record" });
  else {
    if (c.adherence != null && c.adherence >= 4)
      goingWell.push({ text: `Nutrition consistency ${c.adherence.toFixed(1)} of 5 in recent check-ins`, source: "record" });
    if (c.adherence != null && c.adherence < 3)
      improve.push({ text: `Nutrition consistency ${c.adherence.toFixed(1)} of 5 in recent check-ins`, source: "record" });
    if (c.poorSleep >= 2 || c.lowEnergy >= 2 || c.stress >= 2)
      athleteNeeds.push({
        text: `Recovery support: ${[
          c.poorSleep >= 2 ? `poor sleep ${c.poorSleep}×` : null,
          c.lowEnergy >= 2 ? `low energy ${c.lowEnergy}×` : null,
          c.stress >= 2 ? `high stress ${c.stress}×` : null,
        ]
          .filter(Boolean)
          .join(", ")} in recent check-ins`,
        source: "record",
      });
    if (c.latest && daysBetween(c.latest, x.today) > 10)
      missing.push({ text: `This week's check-in (the last was ${day(c.latest)})`, source: "record" });
  }

  // pain
  for (const p of x.pain.slice(0, 3)) {
    athleteNeeds.push({
      text: `${p.label}: ${p.status}${p.trend ? `, ${p.trend}` : ""}`,
      source: "record",
    });
  }

  // nutrition
  if (!x.nutrition?.phase && !x.nutrition?.kcalLow) missing.push({ text: "A current nutrition plan", source: "record" });
  // the bodyweight engine: a hold is part of the plan, a change is something to improve, too little data is missing
  if (x.weightRead) {
    if (x.weightVerdict === "maintain") milestones.push({ text: `Bodyweight: ${x.weightRead}`, source: "read" });
    else if (x.weightVerdict === "need_data") missing.push({ text: x.weightRead, source: "read" });
    else improve.push({ text: x.weightRead, source: "read" });
  }

  // records: all-time PRs in finished workouts, the ones worth naming first
  const rec = x.records;
  if (rec?.top.length) {
    const unit = x.bodyweight?.unit ?? "lb";
    const load = (kg: number) => `${Math.round((unit === "kg" ? kg : kg * 2.20462) * 2) / 2} ${unit}`;
    // records lead: they're the wins the athlete remembers (the shared screen shows five lines at most)
    const prs: PrepItem[] = rec.top
      .slice(0, 2)
      .map((r) => ({ text: `All-time PR: ${r.exercise} ${load(r.loadKg)} × ${r.reps} (${day(r.date)})`, source: "record" as const }));
    const more = rec.total - Math.min(2, rec.top.length);
    if (more > 0) prs.push({ text: `${more} more all-time record${more === 1 ? "" : "s"} in the last 4 weeks`, source: "record" });
    goingWell.unshift(...prs);
  }

  // the event
  const e = x.event;
  if (e?.date && e.daysOut != null && e.daysOut >= 0) {
    milestones.push({
      text: `${e.title}: ${e.daysOut === 0 ? "today" : `${e.daysOut} days out`} (${day(e.date)})${e.phase ? `, ${e.phase.toLowerCase()}` : ""}`,
      source: "record",
      ref: e.source,
    });
    for (const conflict of e.conflicts)
      decisions.push({ text: `Confirm the details: ${conflict}`, source: "record", ref: e.source });
  }
  const comp = x.competition;
  if (comp) {
    if (comp.expectedTotal != null)
      milestones.push({
        text: `Projected total ${comp.expectedTotal} kg${comp.range ? ` (${comp.range.conservative}–${comp.range.high})` : ""}${comp.place ? `, about ${ordinal(comp.place)}` : ""}`,
        source: "read",
        ref: "Competition Intelligence",
      });
    if (comp.headline) improve.push({ text: comp.headline, source: "read", ref: "Competition Intelligence" });
    for (const d of comp.openDecisions) decisions.push({ text: d, source: "read", ref: "Competition Intelligence" });
    if (comp.classGapKg != null && comp.classGapKg > 0)
      decisions.push({
        text: `Weight class: ${comp.classGapKg.toFixed(1)} kg over the limit today`,
        source: "record",
        ref: "Bodyweight",
      });
    if (e?.daysOut != null && e.daysOut <= 21 && !comp.gamePlanReleased)
      coachNeeds.push({ text: "Release the game plan (attempts and warm-ups) before meet week", source: "read" });
  }

  // the athlete's own words and the coach's own priorities
  for (const t of x.topics ? [x.topics] : []) athleteNeeds.unshift({ text: t, source: "athlete", ref: "Their topics for this call" });
  const routed = routeAnswers(x.answers);
  const said = (text: string): PrepItem => ({ text, source: "athlete", ref: "Pre-call questions" });
  goingWell.push(...routed.goingWell.map(said));
  athleteNeeds.push(...routed.theirs.map(said));
  coachNeeds.push(...routed.coach.map(said));
  milestones.push(...routed.plan.map(said));
  for (const p of x.coachPriorities) decisions.unshift({ text: p, source: "coach" });
  if (x.coachNotes?.trim()) coachNeeds.unshift({ text: x.coachNotes.trim(), source: "coach" });

  // carried over from earlier calls
  const carriedOver = x.commitments.filter((m) => m.status === "open");
  for (const m of carriedOver)
    (m.owner === "athlete" ? coachNeeds : athleteNeeds).push({
      text: `${m.owner === "athlete" ? "Their commitment" : "Your commitment"} from ${day(m.sessionDate)}: ${m.text}`,
      source: "history",
    });
  if (x.previous?.actionItems.length)
    for (const a of x.previous.actionItems)
      coachNeeds.push({ text: `Follow up from ${day(x.previous.date)}: ${a}`, source: "history" });

  return {
    goingWell: dedupe(goingWell),
    improve: dedupe(improve),
    athleteNeeds: dedupe(athleteNeeds),
    coachNeeds: dedupe(coachNeeds),
    missing: dedupe(missing),
    decisions: dedupe(decisions),
    milestones: dedupe(milestones),
    carriedOver,
  };
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

function dedupe(items: PrepItem[]): PrepItem[] {
  const seen = new Set<string>();
  return items.filter((i) => {
    const k = i.text.toLowerCase().replace(/\s+/g, " ").trim();
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ------------------------------------------------------------------ */
/* The agenda                                                          */

export type SectionKey = "going_well" | "improve" | "athletes_corner" | "game_plan" | "alignment";
export const SECTION_TITLES: Record<SectionKey, string> = {
  going_well: "What's going well",
  improve: "Where we can improve",
  athletes_corner: "Your corner",
  game_plan: "Our game plan",
  alignment: "Alignment and next steps",
};

export type AgendaSection = { key: SectionKey; title: string; minutes: number; items: PrepItem[] };
export type Agenda = { minutes: number; athleteShare: number; sections: AgendaSection[] };

/** Minimum share of the call that's theirs, and the most it starts with. */
export const ATHLETE_SHARE = { min: 0.25, max: 0.35 } as const;

export function planAgenda(prep: SessionPrep, opts: { minutes?: number } = {}): Agenda {
  const decisions = prep.decisions.length;
  const athleteTopics = prep.athleteNeeds.filter((i) => i.source === "athlete").length;
  const minutes =
    opts.minutes ?? Math.min(30, Math.max(15, 15 + decisions * 3 + Math.min(athleteTopics, 3) * 2));
  // the athlete's corner grows with what they've raised, inside 25–35%
  const share = Math.min(ATHLETE_SHARE.max, ATHLETE_SHARE.min + athleteTopics * 0.03 + (prep.athleteNeeds.length ? 0.02 : 0));
  const weights: Record<SectionKey, number> = {
    going_well: 0.15,
    improve: prep.improve.length ? 0.2 : 0.1,
    athletes_corner: share,
    game_plan: prep.decisions.length || prep.milestones.length ? 0.25 : 0.2,
    alignment: 0.1,
  };
  const keys = Object.keys(weights) as SectionKey[];
  const total = keys.reduce((s, k) => s + weights[k], 0);
  // whole minutes that add up to the call, the athlete's corner rounded up
  const raw = keys.map((k) => ({ k, m: (weights[k] / total) * minutes }));
  const mins = raw.map((r) => ({ k: r.k, m: Math.max(1, r.k === "athletes_corner" ? Math.ceil(r.m) : Math.floor(r.m)) }));
  let diff = minutes - mins.reduce((s, r) => s + r.m, 0);
  for (const r of mins.filter((r) => r.k === "game_plan" || r.k === "improve")) {
    if (diff === 0) break;
    const step = diff > 0 ? 1 : -1;
    if (r.m + step >= 1) {
      r.m += step;
      diff -= step;
    }
  }
  const itemsFor: Record<SectionKey, PrepItem[]> = {
    going_well: prep.goingWell,
    improve: prep.improve,
    athletes_corner: prep.athleteNeeds,
    game_plan: [...prep.milestones, ...prep.decisions],
    alignment: [...prep.coachNeeds, ...prep.carriedOver.map((c) => ({ text: c.text, source: "history" as const }))],
  };
  const sections = mins.map((r) => ({ key: r.k, title: SECTION_TITLES[r.k], minutes: r.m, items: itemsFor[r.k] }));
  const corner = sections.find((s) => s.key === "athletes_corner")!.minutes;
  return { minutes, athleteShare: Math.round((corner / minutes) * 100) / 100, sections };
}

/* ------------------------------------------------------------------ */
/* The lowest effective intervention                                   */

export type InterventionLevel = "none" | "message" | "info_request" | "resource" | "touch_base" | "call";
export const LEVEL_WORDS: Record<InterventionLevel, string> = {
  none: "Nothing needed",
  message: "A quick message",
  info_request: "Ask for information",
  resource: "Send a resource",
  touch_base: "A 5–10 minute touch-base",
  call: "A 15–30 minute call",
};

export type InterventionInput = {
  today: string;
  event: SessionEvent | null;
  prep: SessionPrep;
  /** a call already booked, and when */
  bookedCallOn: string | null;
  lastCallOn: string | null;
  /** an included call left this billing period (Coaching Plus), else null */
  includedCallsLeft: number | null;
  /** the athlete asked to talk */
  athleteAsked: boolean;
  /** a serious concern on file (a pain warning sign, an urgent competition read) */
  seriousConcern: boolean;
};

export type Intervention = {
  level: InterventionLevel;
  minutes: number | null;
  reasons: string[];
  /** when it's worth doing, in words */
  timing: string | null;
  coverage: string | null;
};

export function recommendIntervention(x: InterventionInput): Intervention {
  const reasons: string[] = [];
  const decisions = x.prep.decisions.length;
  const daysOut = x.event?.kind === "competition" ? x.event.daysOut : null;
  const meetWeek = daysOut != null && daysOut >= 0 && daysOut <= 7;
  const coverage =
    x.includedCallsLeft == null
      ? null
      : x.includedCallsLeft > 0
        ? `${x.includedCallsLeft} included call${x.includedCallsLeft === 1 ? "" : "s"} left this billing period`
        : "No included calls left: it would be a General Call";

  if (x.bookedCallOn && daysBetween(x.today, x.bookedCallOn) >= 0 && daysBetween(x.today, x.bookedCallOn) <= 14) {
    return {
      level: "none",
      minutes: null,
      reasons: [`A call is already booked on ${x.bookedCallOn}: prepare for that one`],
      timing: null,
      coverage,
    };
  }

  if (meetWeek) {
    // the last week is for executing, not new conversations
    if (x.seriousConcern) {
      reasons.push("Meet week, with a serious concern on file: settle it briefly");
      return { level: "touch_base", minutes: 10, reasons, timing: "Today or tomorrow", coverage };
    }
    if (x.athleteAsked) {
      reasons.push("They asked to talk, in meet week: keep it short and on the plan");
      return { level: "touch_base", minutes: 10, reasons, timing: "Within a day", coverage };
    }
    reasons.push("Meet week: confirmations and encouragement go by message, not a call");
    return { level: "message", minutes: null, reasons, timing: null, coverage };
  }

  if (x.seriousConcern) reasons.push("A serious concern is on file");
  if (x.athleteAsked) reasons.push("They asked to talk");
  if (decisions >= 2) reasons.push(`${decisions} decisions to make together`);
  if (daysOut != null && daysOut > 7 && daysOut <= 56 && decisions >= 1)
    reasons.push(daysOut > 21 ? "Strategic meet preparation is worth doing now, well before meet week" : "Settle the strategy now, before meet week");

  const lastCallDays = x.lastCallOn ? daysBetween(x.lastCallOn, x.today) : null;
  const callWorthy = x.athleteAsked || x.seriousConcern || decisions >= 2 || (daysOut != null && daysOut > 7 && daysOut <= 56 && decisions >= 1);
  if (callWorthy) {
    const minutes = Math.min(30, Math.max(15, 15 + decisions * 3));
    if (lastCallDays != null && lastCallDays < 7 && !x.seriousConcern && !x.athleteAsked)
      return {
        level: "touch_base",
        minutes: 10,
        reasons: [...reasons, `You spoke ${lastCallDays} days ago: a short follow-up covers it`],
        timing: "This week",
        coverage,
      };
    return {
      level: "call",
      minutes,
      reasons,
      timing: daysOut != null && daysOut <= 21 ? "This week" : "Within the next 1–2 weeks",
      coverage,
    };
  }
  if (decisions === 1) {
    return {
      level: "touch_base",
      minutes: 10,
      reasons: ["One decision to make: a short touch-base is enough"],
      timing: "This week",
      coverage,
    };
  }
  if (x.prep.missing.length) {
    return {
      level: "info_request",
      minutes: null,
      reasons: [`Missing: ${x.prep.missing.map((m) => m.text.toLowerCase()).slice(0, 3).join(", ")}`],
      timing: null,
      coverage: null,
    };
  }
  if (x.prep.improve.length)
    return {
      level: "message",
      minutes: null,
      reasons: ["Small adjustments go by message"],
      timing: null,
      coverage: null,
    };
  return { level: "none", minutes: null, reasons: ["Things are on track: nothing needs a conversation"], timing: null, coverage: null };
}
