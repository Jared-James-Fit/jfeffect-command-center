/**
 * Competition preparation: the checklist, readiness, what's outstanding, and the
 * reminders (pure, tested in competition-handling.test.ts).
 *
 * The checklist is generated from what's known about the meet and the athlete
 * (travel only when they travel, the class only when there is one, handling's
 * terms only when they're handled), in four stages: early preparation, travel and
 * packing, the day before, and meet day. An item is done when the records say so
 * (registered, a class on file, rack heights in the gameplan, warm-ups the
 * athlete confirmed) or when the athlete or coach ticks it; its keys match the
 * Meet Day checklist form's, so an answer there counts here.
 *
 * Readiness weighs what's missing by how much it matters and when it's due,
 * never a percentage: an overdue critical item puts them at risk, anything
 * critical or important due soon needs attention, and they're ready only when
 * every critical and important item that applies is done.
 *
 * Reminders are decided here from the same facts, so they move when the facts
 * do: a few days before an item matters, at most one push a day per person
 * (every open item it's about in one line), never for something done, and on the
 * day itself the time-sensitive ones (leave, weigh in, start warming up) at the
 * timeline's times.
 */
import type { Lift } from "./types";
import type { Timeline, TimelineEntry } from "./event-timeline";

export type Stage = "early" | "travel" | "day_before" | "meet_day";
export const STAGES: Stage[] = ["early", "travel", "day_before", "meet_day"];
export const STAGE_LABEL: Record<Stage, string> = {
  early: "Early preparation",
  travel: "Travel and packing",
  day_before: "The day before",
  meet_day: "Meet day",
};

export type Priority = "critical" | "important" | "optional";
export type Owner = "athlete" | "coach" | "both";
export type ItemState = "done" | "na" | "open";

export type PrepFacts = {
  today: string;
  meetDate: string;
  sport: string;
  registration: "registered" | "not_registered" | "unknown";
  federation: string | null;
  weightClass: string | null;
  classLimitKg: number | null;
  bodyweightKg: number | null;
  scheduleKnown: boolean;
  weighInKnown: boolean;
  travel: "local" | "drive" | "fly" | null;
  travelMinutesKnown: boolean;
  rackHeights: { squat: boolean; bench: boolean };
  openersSet: boolean;
  gameplanApproved: boolean;
  athleteConfirmed: boolean;
  warmupsConfirmed: boolean;
  nutritionPlanned: boolean;
  handled: boolean;
  intakeComplete: boolean;
  termsAccepted: boolean;
  payment: "not_set" | "waived" | "link" | "paid" | "refunded" | null;
  /** ticks from the athlete or coach, and the Meet Day checklist form's answers, by key */
  states: Record<string, ItemState>;
  liftPrep?: {requested:boolean;submitted:boolean;reviewed:boolean;cueRequested:boolean;cueSubmitted:boolean;cueReviewed:boolean;referencesPrepared:boolean;cuesApproved:boolean};
};

export type PrepItem = {
  key: string;
  label: string;
  stage: Stage;
  priority: Priority;
  owner: Owner;
  /** done by the records (not a tick) */
  auto: boolean;
  state: ItemState;
  /** the day it should be done by */
  due: string;
  /** days before the meet a reminder goes when it's still open */
  remind: number[];
  help?: string;
};

type Def = {
  key: string;
  label: string;
  stage: Stage;
  priority: Priority | ((f: PrepFacts) => Priority);
  owner: Owner;
  dueDays: number;
  remind?: number[];
  applies?: (f: PrepFacts) => boolean;
  auto?: (f: PrepFacts) => boolean | null;
  help?: string;
};

const PL = (f: PrepFacts) => f.sport === "powerlifting";
const makingWeight = (f: PrepFacts) =>
  f.classLimitKg != null && f.bodyweightKg != null && f.bodyweightKg > f.classLimitKg;

const DEFS: Def[] = [
  // early preparation
  { key: "registered", label: "Registered for the meet", stage: "early", priority: "critical", owner: "athlete", dueDays: 21, remind: [28, 14, 7], auto: (f) => (f.registration === "registered" ? true : null) },
  { key: "membership", label: "Federation membership current", stage: "early", priority: "critical", owner: "athlete", dueDays: 14, remind: [21, 10], applies: (f) => PL(f) && !!f.federation, help: "Printed or as a PDF; most federations check it at weigh-in" },
  { key: "intake", label: "Meet details shared", stage: "early", priority: "important", owner: "athlete", dueDays: 14, remind: [14, 7], applies: (f) => f.handled, auto: (f) => (f.intakeComplete ? true : null) },
  { key: "terms", label: "Handling terms accepted", stage: "early", priority: "critical", owner: "athlete", dueDays: 7, remind: [10, 5, 2], applies: (f) => f.handled, auto: (f) => (f.termsAccepted ? true : null) },
  { key: "payment", label: "Handling paid", stage: "early", priority: "important", owner: "coach", dueDays: 3, applies: (f) => f.handled && (f.payment === "link" || f.payment === "paid"), auto: (f) => (f.payment === "paid" ? true : null) },
  { key: "weight_class", label: "Weight class confirmed", stage: "early", priority: "critical", owner: "both", dueDays: 14, remind: [21, 10], applies: PL, auto: (f) => (f.weightClass ? true : null) },
  { key: "bodyweight", label: "Bodyweight on track for the class", stage: "early", priority: "critical", owner: "both", dueDays: 7, remind: [14, 7, 3], applies: (f) => PL(f) && f.classLimitKg != null && f.bodyweightKg != null, auto: (f) => (makingWeight(f) ? null : true), help: "Never water or sodium tricks, saunas or a crash cut" },
  { key: "openers", label: "Openers set", stage: "early", priority: "critical", owner: "coach", dueDays: 7, applies: PL, auto: (f) => (f.openersSet ? true : null) },
  { key: "gameplan", label: "Gameplan approved", stage: "early", priority: "important", owner: "coach", dueDays: 7, auto: (f) => (f.gameplanApproved ? true : null) },
  { key: "schedule", label: "Session, flight and weigh-in times known", stage: "early", priority: "critical", owner: "both", dueDays: 5, remind: [7, 3], auto: (f) => (f.scheduleKnown && f.weighInKnown ? true : null) },
  { key: "kit", label: "Gear on the federation's approved list", stage: "early", priority: "important", owner: "athlete", dueDays: 7, remind: [10], applies: PL },
  { key: "rules", label: "Rules and commands reviewed", stage: "early", priority: "optional", owner: "athlete", dueDays: 3, applies: PL },

  { key: "prep_lifts", label: "Requested prep lifts submitted", stage: "early", priority: "important", owner: "athlete", dueDays: 7, applies: f=>PL(f)&&!!f.liftPrep?.requested, auto:f=>f.liftPrep?.submitted??null },
  { key: "prep_lifts_review", label: "Prep lifts reviewed", stage: "early", priority: "important", owner: "coach", dueDays: 5, applies: f=>PL(f)&&!!f.liftPrep?.requested, auto:f=>f.liftPrep?.reviewed??null },
  { key: "cue_profile", label: "Competition cue profile shared", stage: "early", priority: "important", owner: "athlete", dueDays: 5, applies: f=>PL(f)&&!!f.liftPrep?.cueRequested, auto:f=>f.liftPrep?.cueSubmitted??null },
  { key: "prep_cue_review", label: "Athlete cue profile reviewed", stage: "early", priority: "important", owner: "coach", dueDays: 4, applies:f=>PL(f)&&!!f.liftPrep?.cueRequested, auto:f=>f.liftPrep?.cueReviewed??null },
  { key: "prep_cues_approved", label: "Game Day cues approved", stage: "early", priority: "important", owner: "coach", dueDays: 2, applies:f=>PL(f)&&!!f.liftPrep?.cueRequested, auto:f=>f.liftPrep?.cuesApproved??null },
  { key: "prep_references", label: "Game Day references prepared", stage: "early", priority: "important", owner: "coach", dueDays: 2, applies:f=>PL(f)&&!!f.liftPrep?.requested, auto:f=>f.liftPrep?.referencesPrepared??null },
  // travel and packing
  { key: "travel", label: "Travel booked", stage: "travel", priority: (f) => (f.travel === "fly" ? "critical" : "important"), owner: "athlete", dueDays: 21, remind: [28, 14], applies: (f) => f.travel === "fly" || f.travel === "drive" },
  { key: "accommodation", label: "Accommodation booked", stage: "travel", priority: "important", owner: "athlete", dueDays: 14, remind: [21, 10], applies: (f) => f.travel === "fly" || f.travel === "drive" },
  { key: "venue", label: "Venue and how long it takes to get there", stage: "travel", priority: "important", owner: "athlete", dueDays: 3, remind: [5], auto: (f) => (f.travelMinutesKnown ? true : null) },
  { key: "rack_heights", label: "Rack heights recorded", stage: "travel", priority: "important", owner: "both", dueDays: 3, remind: [7, 2], applies: PL, auto: (f) => (f.rackHeights.squat && f.rackHeights.bench ? true : null) },
  { key: "warm_ups", label: "Warm-ups confirmed", stage: "travel", priority: "important", owner: "athlete", dueDays: 3, remind: [5, 2], applies: PL, auto: (f) => (f.warmupsConfirmed ? true : null) },
  { key: "nutrition", label: "Meet-day food and fluids planned", stage: "travel", priority: "important", owner: "athlete", dueDays: 2, remind: [3], auto: (f) => (f.nutritionPlanned ? true : null) },
  { key: "documents", label: "Photo ID and membership packed", stage: "travel", priority: "critical", owner: "athlete", dueDays: 1, remind: [2, 1], applies: PL },
  { key: "gear", label: "Singlet, belt, shoes, sleeves, wraps and socks packed", stage: "travel", priority: "critical", owner: "athlete", dueDays: 1, remind: [2, 1], applies: PL },
  { key: "food", label: "Food and drinks for the day packed", stage: "travel", priority: "important", owner: "athlete", dueDays: 1, remind: [1] },

  // the day before
  { key: "weigh_in", label: "Weigh-in time and place known", stage: "day_before", priority: "critical", owner: "both", dueDays: 1, remind: [2, 1], applies: PL, auto: (f) => (f.weighInKnown ? true : null) },
  { key: "attempts_written", label: "Openers and rack heights written down", stage: "day_before", priority: "important", owner: "athlete", dueDays: 1, applies: PL, auto: (f) => (f.openersSet && f.rackHeights.squat && f.rackHeights.bench ? true : null) },
  { key: "plan_confirmed", label: "Gameplan read and confirmed", stage: "day_before", priority: "important", owner: "athlete", dueDays: 1, remind: [2, 1], auto: (f) => (f.athleteConfirmed ? true : null) },
  { key: "bodyweight_check", label: "Bodyweight checked on the same scale", stage: "day_before", priority: "important", owner: "athlete", dueDays: 1, applies: (f) => PL(f) && makingWeight(f) },
  { key: "sleep", label: "Alarm set and the night planned", stage: "day_before", priority: "optional", owner: "athlete", dueDays: 1 },

  // meet day
  { key: "md_weighed_in", label: "Weighed in", stage: "meet_day", priority: "critical", owner: "both", dueDays: 0, applies: PL },
  { key: "md_handed_in", label: "Openers and rack heights handed in", stage: "meet_day", priority: "critical", owner: "both", dueDays: 0, applies: PL },
  { key: "md_ate", label: "Ate and drank after weigh-in", stage: "meet_day", priority: "important", owner: "athlete", dueDays: 0 },
  { key: "md_warmup_room", label: "Warm-up room and platform found", stage: "meet_day", priority: "important", owner: "both", dueDays: 0 },
];

/** Keys of the Meet Day checklist form (meet-checklist-template.ts) that answer an item here. */
export const FORM_KEY_FOR: Record<string, string> = {
  registered: "registered",
  "weigh-in": "weigh_in",
  venue: "venue",
  travel: "accommodation",
  rules: "rules",
  kit: "kit",
  membership: "membership",
  "photo-id": "documents",
  singlet: "gear",
  food: "food",
  "openers-written": "attempts_written",
  "warm-ups": "warm_ups",
  schedule: "schedule",
  sleep: "sleep",
};

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso.slice(0, 10)}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
export function daysFrom(a: string, b: string): number {
  return Math.round(
    (new Date(`${b.slice(0, 10)}T12:00:00Z`).getTime() - new Date(`${a.slice(0, 10)}T12:00:00Z`).getTime()) / 864e5,
  );
}

/** The checklist for these facts, in stage order. */
export function buildChecklist(f: PrepFacts): PrepItem[] {
  const out: PrepItem[] = [];
  for (const d of DEFS) {
    if (d.applies && !d.applies(f)) continue;
    const auto = d.auto?.(f) ?? null;
    const ticked = f.states[d.key];
    const state: ItemState = auto ? "done" : ticked === "done" || ticked === "na" ? ticked : "open";
    out.push({
      key: d.key,
      label: d.label,
      stage: d.stage,
      priority: typeof d.priority === "function" ? d.priority(f) : d.priority,
      owner: d.owner,
      auto: !!auto,
      state,
      due: addDays(f.meetDate, -d.dueDays),
      remind: d.remind ?? [],
      help: d.help,
    });
  }
  return out;
}

export type ReadinessVerdict = "ready" | "on_track" | "needs_attention" | "at_risk";
export const READINESS_WORD: Record<ReadinessVerdict, string> = {
  ready: "Ready",
  on_track: "On track",
  needs_attention: "Needs attention",
  at_risk: "At risk",
};

export type Readiness = {
  verdict: ReadinessVerdict;
  /** open items in the order they matter: overdue critical first */
  outstanding: PrepItem[];
  overdue: number;
  openCritical: number;
  openImportant: number;
  /** what the verdict rests on, in a line */
  line: string;
};

const PRIORITY_RANK: Record<Priority, number> = { critical: 0, important: 1, optional: 2 };

/**
 * Readiness by importance and timing. Ready: every critical and important item
 * that applies is done. At risk: a critical item is overdue. Needs attention:
 * an important item is overdue, or a critical one is due within 3 days. On
 * track: nothing that matters is late.
 */
export function readinessOf(items: PrepItem[], today: string): Readiness {
  const open = items.filter((i) => i.state === "open");
  const overdue = (i: PrepItem) => i.due < today;
  const soon = (i: PrepItem) => daysFrom(today, i.due) <= 3;
  const outstanding = [...open]
    .filter((i) => i.priority !== "optional" || overdue(i))
    .sort(
      (a, b) =>
        Number(overdue(b)) - Number(overdue(a)) ||
        PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
        a.due.localeCompare(b.due),
    );
  const openCritical = open.filter((i) => i.priority === "critical").length;
  const openImportant = open.filter((i) => i.priority === "important").length;
  const lateCritical = open.filter((i) => i.priority === "critical" && overdue(i)).length;
  const lateImportant = open.filter((i) => i.priority === "important" && overdue(i)).length;
  const soonCritical = open.filter((i) => i.priority === "critical" && soon(i)).length;
  let verdict: ReadinessVerdict;
  if (!openCritical && !openImportant) verdict = "ready";
  else if (lateCritical) verdict = "at_risk";
  else if (lateImportant || soonCritical) verdict = "needs_attention";
  else verdict = "on_track";
  const line =
    verdict === "ready"
      ? "Everything that matters is done"
      : verdict === "at_risk"
        ? `${lateCritical} must-have ${lateCritical === 1 ? "item is" : "items are"} overdue`
        : verdict === "needs_attention"
          ? lateImportant
            ? `${lateImportant} important ${lateImportant === 1 ? "item is" : "items are"} overdue`
            : `${soonCritical} must-have ${soonCritical === 1 ? "item is" : "items are"} due within 3 days`
          : `${openCritical + openImportant} to do before the meet, none late`;
  return {
    verdict,
    outstanding,
    overdue: open.filter(overdue).length,
    openCritical,
    openImportant,
    line,
  };
}

/* ------------------------------------------------------------------ */
/* Reminders                                                          */

export type Audience = "athlete" | "coach";
export type Reminder = {
  /** push_notification_dedupe key: one per competition, day (or timeline entry) and audience */
  key: string;
  audience: Audience;
  title: string;
  body: string;
  /** time-sensitive meet-day ones go even in quiet hours (silently) and when they're in the app */
  urgent: boolean;
  items: string[];
};

/** Meet-day timeline entries worth a push, and how many minutes before. */
const TIMED: Record<string, { lead: number; title: (e: TimelineEntry) => string }> = {
  depart: { lead: 30, title: () => "Leave for the venue soon" },
  weigh_in: { lead: 30, title: () => "Weigh-in soon" },
  squat_warmup: { lead: 10, title: () => "Squat warm-ups start soon" },
  bench_warmup: { lead: 10, title: () => "Bench warm-ups start soon" },
  deadlift_warmup: { lead: 10, title: () => "Deadlift warm-ups start soon" },
};

/**
 * The reminders due now. Day-level ones from 9 AM to 9 PM in the meet's zone,
 * once a day per audience (every open item due a nudge today in one push);
 * timed ones in the window before their entry. Never for anything done, never
 * for an internal test, and none once the meet is over.
 */
export function dueReminders(input: {
  competitionId: string;
  meetName: string;
  meetDate: string;
  items: PrepItem[];
  now: { date: string; minutes: number };
  timeline?: Timeline | null;
  athleteFirst?: string | null;
}): Reminder[] {
  const { now, items } = input;
  const out: Reminder[] = [];
  const d = daysFrom(now.date, input.meetDate);
  if (d < 0) return out;
  const day = d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d} days`;

  if (now.minutes >= 9 * 60 && now.minutes < 21 * 60 && d >= 1) {
    for (const audience of ["athlete", "coach"] as Audience[]) {
      const due = items.filter(
        (i) =>
          i.state === "open" &&
          (i.owner === audience || i.owner === "both") &&
          i.remind.includes(d) &&
          i.priority !== "optional",
      );
      if (!due.length) continue;
      due.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
      const labels = due.map((i) => i.label);
      const who = audience === "coach" && input.athleteFirst ? `${input.athleteFirst} · ` : "";
      out.push({
        key: `comp:${input.competitionId}:prep:${d}:${audience}`,
        audience,
        title: `${who}${input.meetName} ${day}`,
        body:
          labels.length === 1
            ? `Still to sort: ${lower(labels[0])}.`
            : `Still to sort: ${labels.slice(0, 3).map(lower).join("; ")}${labels.length > 3 ? ` and ${labels.length - 3} more` : ""}.`,
        urgent: false,
        items: due.map((i) => i.key),
      });
    }
  }

  // the day itself (and a 24-hour weigh-in the day before): the timeline's times
  for (const e of input.timeline?.entries ?? []) {
    const t = TIMED[e.key];
    if (!t || e.at == null || e.date !== now.date) continue;
    const start = e.from ?? e.at;
    if (now.minutes >= start - t.lead && now.minutes < start) {
      out.push({
        key: `comp:${input.competitionId}:md:${e.key}:${e.date}`,
        audience: "athlete",
        title: t.title(e),
        body: `${e.label} about ${clockWord(start)}${e.status === "confirmed" ? "" : " (estimated)"}.`,
        urgent: true,
        items: [],
      });
    }
  }
  return out;
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);
function clockWord(minutes: number): string {
  const t = ((Math.round(minutes) % 1440) + 1440) % 1440;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/* ------------------------------------------------------------------ */
/* The next action                                                    */

export type NextAction = { label: string; when: string; kind: "item" | "timeline" | "milestone" };

/** The next thing that's scheduled: on the day, the timeline's next entry; before it, the most pressing open item. */
export function nextAction(input: {
  readiness: Readiness;
  today: string;
  meetDate: string;
  now?: { date: string; minutes: number } | null;
  timeline?: Timeline | null;
}): NextAction | null {
  const d = daysFrom(input.today, input.meetDate);
  if (d <= 1 && input.timeline && input.now) {
    const next = input.timeline.entries.find(
      (e) => e.at != null && (e.date > input.now!.date || (e.date === input.now!.date && (e.to ?? e.at) >= input.now!.minutes)),
    );
    if (next) return { label: next.label, when: `${next.date === input.now.date ? "" : "Tomorrow "}${clockWord(next.at!)}`, kind: "timeline" };
  }
  const top = input.readiness.outstanding[0];
  if (!top) return null;
  const late = top.due < input.today;
  const dueIn = daysFrom(input.today, top.due);
  return {
    label: top.label,
    when: late ? "Overdue" : dueIn === 0 ? "Due today" : dueIn === 1 ? "Due tomorrow" : `Due in ${dueIn} days`,
    kind: "item",
  };
}

/** Lifts whose rack heights are on the gameplan. */
export function rackHeightsKnown(plan: { equipment?: { racks?: Partial<Record<Lift, { height?: string | null }>> } } | null | undefined) {
  const r = plan?.equipment?.racks ?? {};
  return { squat: !!r.squat?.height, bench: !!r.bench?.height };
}

/** Read stored checklist ticks (`competitions.checklist`) safely: { key: { state } }. */
export function readChecklistStates(raw: unknown): Record<string, ItemState> {
  const out: Record<string, ItemState> = {};
  if (!raw || typeof raw !== "object") return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    const s = typeof v === "string" ? v : v?.state;
    if (/^[a-z0-9_]{2,40}$/.test(k) && (s === "done" || s === "na" || s === "open")) out[k] = s;
  }
  return out;
}
