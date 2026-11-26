/**
 * Meeting preparation (pure, tested in coaching-sessions.test.ts and
 * meeting-plan.test.ts): what a meeting is for, built from the records before
 * any model writes a word, so every line has a source and Cleo only ever
 * refines it.
 *
 * Coach-led (Nov 25 2026): a meeting is the coach telling the client what
 * they see, what's working, what's limiting progress, what to do about it and
 * what happens next, never an interview. The plan has six stages, each a few
 * concise talking points (a statement by default, a question only where it
 * resolves real uncertainty):
 *   Connect · Recognize · Evaluate · Coach · Execute · Align.
 *
 *  - buildSessionPrep: the sourced read of everything on file (training,
 *    bodyweight, check-ins, nutrition, pain, the program, the event and its
 *    competition read, earlier meetings and commitments, the client's own
 *    words and the coach's), with what needs clarifying apart. It never needs
 *    anything from the client: with nothing on file it still says what the
 *    coach should lead with. Incomplete logging is "not logged", never
 *    "missed".
 *  - planAgenda: the six stages as talking points with minutes that fit the
 *    meeting's length and kind.
 *  - mergeAgenda: a refreshed plan merged into the one on file, keeping every
 *    talking point the coach wrote, edited, skipped, addressed or reordered,
 *    and marking what's new since the coach last looked.
 *  - recommendIntervention: the lowest effective intervention, from nothing to
 *    a full call, never a call for its own sake or one the week of a meet.
 */
import type { PrepInput } from "@/lib/coaching-packages/call-prep";
import type { SessionEvent } from "./events";
import { routeAnswers } from "./questionnaire";

export type Source = "record" | "coach" | "athlete" | "read" | "history";
/** How sure the line is: logged data, the client's words, the coach's own, an interpretation, or not known. */
export type Basis = "verified" | "reported" | "observed" | "interpretation" | "unknown";
export type PointKind = "statement" | "question" | "action";
export type PointStatus = "open" | "addressed" | "skipped";

export type PrepItem = {
  text: string;
  source: Source;
  ref?: string;
  /** a stable name for what this line is about, so a refreshed plan updates it in place */
  slot?: string;
  basis?: Basis;
  kind?: PointKind;
  /** why it matters, in a sentence (the expanded view) */
  detail?: string | null;
  /** how a coach would say it, out loud */
  say?: string | null;
  /** needs clarifying before it's used with the client */
  clarify?: boolean;
};

/** A talking point on the plan: a prep line plus what the coach did with it. */
export type TalkingPoint = PrepItem & {
  id: string;
  basis: Basis;
  kind: PointKind;
  /** shown on the shared screen */
  share: boolean;
  status?: PointStatus;
  /** written by the coach */
  custom?: boolean;
  /** the coach changed its words or phrasing */
  edited?: boolean;
  /** when it first appeared on this plan (ISO) */
  addedAt?: string;
  /** Cleo's refined phrasing (checked against the prep) */
  cleoSay?: string | null;
};

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

/** What the rest of the client's file adds to a meeting (each part optional: missing is never a blocker). */
export type MeetingExtras = {
  /** the program on the calendar now */
  program?: { name: string; week: number | null; weeks: number | null; endsOn: string | null; nextName: string | null; nextStarts: string | null } | null;
  /** the client's own recent words in their coach chat (their questions and concerns) */
  recentMessages?: Array<{ date: string; text: string }>;
  /** set videos sent in the last 4 weeks */
  videos?: { count: number; lastDate: string | null } | null;
  /** cardio sessions planned and done in the last 4 weeks */
  cardio?: { planned: number; done: number } | null;
  /** the last meeting's summary and what came out of it */
  lastMeeting?: { date: string; summary: string | null } | null;
  /** commitments closed since the last meeting (follow-through worth recognizing) */
  doneCommitments?: Array<{ owner: "coach" | "athlete"; text: string; closedOn: string | null }>;
  /** the client's weight unit, for anything said in a load */
  unit?: "kg" | "lb";
  /** the goal ledger (goal-intel), each target already in words */
  goals?: Array<{
    id: string;
    title: string;
    status: "proposed" | "active";
    /** what they said ("220–225 lb") */
    clientTarget: string | null;
    unitInferred: boolean;
    tentative: boolean;
    /** the coach-approved target, in words */
    approved: string | null;
    /** Cleo's projection (an interpretation) */
    projection: string | null;
    score: number | null;
    /** the read's recommended action, when it asks for something */
    action: string | null;
    clientFacing: boolean;
  }>;
};

export type SessionPrepInput = PrepInput &
  MeetingExtras & {
    event: SessionEvent | null;
    competition: CompetitionContext | null;
    commitments: Commitment[];
    /** confirmed lasting intelligence lines (client_intelligence) */
    intelligence: string[];
    coachNotes: string | null;
    coachPriorities: string[];
    /** what the athlete answered on the pre-call questions, by session key (routeAnswers places each) */
    answers: Record<string, string>;
    firstName?: string | null;
  };

export type SessionPrep = {
  /** what the meeting is for and what a good outcome is */
  objective: string;
  outcome: string;
  /** the objective is the coach's own private priority (never on the shared screen) */
  objectivePrivate?: boolean;
  connect: PrepItem[];
  goingWell: PrepItem[];
  /** what the coach is seeing (neutral) */
  observations: PrepItem[];
  /** what's limiting progress */
  improve: PrepItem[];
  /** what the coach recommends and why */
  recommendations: PrepItem[];
  athleteNeeds: PrepItem[];
  coachNeeds: PrepItem[];
  clientActions: PrepItem[];
  coachActions: PrepItem[];
  /** what needs clarifying: unlogged training, stale or conflicting data, an ambiguous unit */
  clarify: PrepItem[];
  missing: PrepItem[];
  decisions: PrepItem[];
  milestones: PrepItem[];
  /** the next objective, in words */
  nextObjective: string | null;
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
const LB = 2.20462;
const loadIn = (kg: number, unit: "kg" | "lb") => `${Math.round((unit === "kg" ? kg : kg * LB) * 2) / 2} ${unit}`;
const wtIn = (kg: number, unit: "kg" | "lb") => `${(unit === "kg" ? kg : kg * LB).toFixed(1)} ${unit}`;
const end = (s: string) => (/[.!?]$/.test(s.trim()) ? s.trim() : `${s.trim()}.`);
const lower = (t: string) => (t ? t[0]!.toLowerCase() + t.slice(1) : t);

/** The basis a source implies, unless a line says otherwise. */
export function basisOf(i: Pick<PrepItem, "source" | "basis" | "clarify">): Basis {
  if (i.basis) return i.basis;
  if (i.clarify) return "unknown";
  return i.source === "record" || i.source === "history"
    ? "verified"
    : i.source === "athlete"
      ? "reported"
      : i.source === "coach"
        ? "observed"
        : "interpretation";
}

export function buildSessionPrep(x: SessionPrepInput): SessionPrep {
  const connect: PrepItem[] = [];
  const goingWell: PrepItem[] = [];
  const observations: PrepItem[] = [];
  const improve: PrepItem[] = [];
  const recommendations: PrepItem[] = [];
  const athleteNeeds: PrepItem[] = [];
  const coachNeeds: PrepItem[] = [];
  const clientActions: PrepItem[] = [];
  const coachActions: PrepItem[] = [];
  const clarify: PrepItem[] = [];
  const missing: PrepItem[] = [];
  const decisions: PrepItem[] = [];
  const milestones: PrepItem[] = [];
  const unit: "kg" | "lb" = x.unit ?? x.bodyweight?.unit ?? "lb";
  const name = x.firstName?.trim() || null;

  // ---------------- training: logged is a fact, not logged is unknown, never "missed"
  const wk = x.workouts;
  const unlogged = wk ? Math.max(0, wk.planned - wk.done) : 0;
  if (wk && wk.planned >= 4) {
    const share = wk.done / wk.planned;
    if (share >= 0.9) {
      goingWell.push({
        slot: "training-consistency",
        text: `${wk.done} of ${wk.planned} planned workouts logged in the last 4 weeks`,
        source: "record",
        detail: "Consistency is what every other number on the plan is built on.",
        say: `You've logged ${wk.done} of ${wk.planned} planned workouts over the last month. That consistency is why the rest of the plan works.`,
      });
    } else if (share >= 0.75) {
      observations.push({
        slot: "training-consistency",
        text: `${wk.done} of ${wk.planned} planned workouts logged in the last 4 weeks`,
        source: "record",
        say: `Training's been mostly consistent: ${wk.done} of ${wk.planned} planned sessions logged this month.`,
      });
    } else {
      improve.push({
        slot: "training-logging",
        text: `${unlogged} of ${wk.planned} planned workouts have no log in the last 4 weeks`,
        source: "record",
        detail: "Unlogged isn't the same as missed: until it's logged I can't tell a skipped session from one done and not entered, so I can't adjust the plan to what actually happened.",
        say: `${unlogged} of your ${wk.planned} planned sessions this month have nothing logged. I need to know which of those you trained and which you didn't, because I can only adjust the plan to what I can see.`,
      });
      clarify.push({
        slot: "training-unlogged",
        text: `Were the ${unlogged} unlogged workouts trained, partly trained or skipped?`,
        source: "record",
        kind: "question",
        clarify: true,
        detail: "Ask once, early: the answer changes whether this is a logging habit or a training gap.",
        say: `Quick one first: those ${unlogged} sessions with nothing logged, did you train them?`,
      });
      clientActions.push({
        slot: "action-log-everything",
        text: "Log every session, even short or partial ones, the same day",
        source: "read",
        kind: "action",
        say: "From now on, every session gets logged the same day, even if it's only part of the workout. That's how I keep your plan honest.",
      });
    }
    if (wk.avgRating != null && wk.avgRating >= 4)
      goingWell.push({ slot: "training-rating", text: `Sessions rated ${wk.avgRating.toFixed(1)} of 5 on average`, source: "record", say: `You're rating your sessions ${wk.avgRating.toFixed(1)} out of 5 on average, which tells me the training is landing.` });
    if (wk.avgRating != null && wk.avgRating <= 2.5)
      improve.push({ slot: "training-rating", text: `Sessions rated ${wk.avgRating.toFixed(1)} of 5 on average`, source: "record", say: `Your session ratings have been low, around ${wk.avgRating.toFixed(1)} out of 5. That's a signal I take seriously.` });
  } else if (wk && wk.planned > 0) {
    observations.push({ slot: "training-consistency", text: `${wk.done} of ${wk.planned} planned workouts logged in the last 4 weeks`, source: "record" });
  } else if (!wk) missing.push({ slot: "missing-workouts", text: "Recent workouts couldn't be read", source: "record" });
  if (wk?.lastDone && daysBetween(wk.lastDone, x.today) >= 10) {
    improve.push({ slot: "training-gap", text: `Nothing logged since ${day(wk.lastDone)}`, source: "record", say: `I haven't seen a session logged since ${day(wk.lastDone)}.` });
    clarify.push({ slot: "training-since", text: `Have they trained since ${day(wk.lastDone)}?`, source: "record", kind: "question", clarify: true });
  }

  // ---------------- bodyweight
  const bw = x.bodyweight;
  if (!bw || (bw.latestKg == null && bw.avg7Kg == null)) {
    missing.push({ slot: "missing-weighins", text: "Recent weigh-ins", source: "record" });
  } else {
    if (bw.stale) {
      missing.push({ slot: "missing-weighins", text: `A fresh weigh-in (the last is from ${day(bw.latestDate)})`, source: "record" });
      clarify.push({ slot: "bw-stale", text: `Bodyweight since ${day(bw.latestDate)}: the last weigh-in is old`, source: "record", clarify: true });
    }
    const avg = bw.avg7Kg ?? bw.latestKg;
    const rate = bw.weeklyChangeKg;
    if (avg != null && bw.goalKg != null && rate != null && !bw.stale) {
      const toward = (bw.goalKg - avg) * rate > 0 && Math.abs(rate) >= 0.05;
      const line = `Bodyweight ${wtIn(avg, unit)} (7-day average), moving ${rate > 0 ? "up" : "down"} ${wtIn(Math.abs(rate), unit)} a week, goal ${wtIn(bw.goalKg, unit)}`;
      if (toward) goingWell.push({ slot: "bw-trend", text: line, source: "record", say: `Your bodyweight is heading the right way: ${wtIn(avg, unit)} on average and moving toward ${wtIn(bw.goalKg, unit)}.` });
      else observations.push({ slot: "bw-trend", text: line, source: "record" });
    } else if (avg != null && !bw.stale) {
      observations.push({ slot: "bw-trend", text: `Bodyweight ${wtIn(avg, unit)} (7-day average)`, source: "record" });
    }
  }
  if (x.weightRead) {
    if (x.weightVerdict === "maintain")
      milestones.push({ slot: "bw-read", text: `Bodyweight: ${x.weightRead}`, source: "read" });
    else if (x.weightVerdict === "need_data") {
      missing.push({ slot: "missing-bw-read", text: x.weightRead, source: "read" });
      clientActions.push({ slot: "action-weigh", text: "Weigh in first thing in the morning, at least 3 days a week", source: "read", kind: "action", say: "Weigh in first thing in the morning at least three days a week, so I'm reading a trend and not one day." });
    } else {
      improve.push({ slot: "bw-read", text: x.weightRead, source: "read" });
      recommendations.push({ slot: "rec-bodyweight", text: x.weightRead, source: "read", detail: "The weight-management read: one change at a time, judged on the trend, never one weigh-in." });
    }
  }

  // ---------------- check-ins and recovery
  const c = x.checkins;
  if (!c || c.count === 0) missing.push({ slot: "missing-checkin", text: "A recent weekly check-in", source: "record" });
  else {
    if (c.adherence != null && c.adherence >= 4)
      goingWell.push({ slot: "nutrition-adherence", text: `Nutrition consistency ${c.adherence.toFixed(1)} of 5 in recent check-ins`, source: "record", say: `You've rated your nutrition ${c.adherence.toFixed(1)} out of 5 on recent check-ins. That's what makes the numbers move.` });
    else if (c.adherence != null && c.adherence < 3) {
      improve.push({ slot: "nutrition-adherence", text: `Nutrition consistency ${c.adherence.toFixed(1)} of 5 in recent check-ins`, source: "record", say: `Nutrition consistency has been around ${c.adherence.toFixed(1)} out of 5. That's the biggest lever we have right now.` });
      recommendations.push({
        slot: "rec-nutrition-simplify",
        text: "Make the nutrition plan easier to hit before changing any numbers",
        source: "read",
        detail: "Changing targets that aren't being hit only moves the goalposts. First make the current plan doable.",
        say: "Before we touch your numbers, we make the plan you have easier to hit. I'd rather you nail a simpler version than half-follow a perfect one.",
      });
    } else if (c.adherence != null)
      observations.push({ slot: "nutrition-adherence", text: `Nutrition consistency ${c.adherence.toFixed(1)} of 5 in recent check-ins`, source: "record" });
    if (c.poorSleep >= 2 || c.lowEnergy >= 2 || c.stress >= 2) {
      const parts = [c.poorSleep >= 2 ? `poor sleep ${c.poorSleep}×` : null, c.lowEnergy >= 2 ? `low energy ${c.lowEnergy}×` : null, c.stress >= 2 ? `high stress ${c.stress}×` : null].filter(Boolean).join(", ");
      improve.push({ slot: "recovery", text: `Recovery: ${parts} in recent check-ins`, source: "record", say: `Your check-ins keep flagging recovery: ${parts}. That caps what training can do for you.` });
      athleteNeeds.push({ slot: "recovery-support", text: `Recovery support: ${parts} in recent check-ins`, source: "record" });
      recommendations.push({
        slot: "rec-recovery",
        text: c.poorSleep >= 2 ? "Protect sleep: a fixed bedtime and wake time for the next two weeks" : "Manage training stress while recovery is low",
        source: "read",
        detail: "Recovery decides how much training turns into progress; pushing harder on poor recovery usually costs more than it gives.",
        say: c.poorSleep >= 2
          ? "Sleep is the cheapest performance boost you've got. For the next two weeks, pick a bedtime and a wake time and hold them, weekends too."
          : "While recovery's this low, I'd rather keep your training where it is than add to it.",
      });
    }
    if (c.latest && daysBetween(c.latest, x.today) > 10) {
      missing.push({ slot: "missing-checkin", text: `This week's check-in (the last was ${day(c.latest)})`, source: "record" });
      clientActions.push({ slot: "action-checkin", text: "Send the weekly check-in every week, even a quick one", source: "read", kind: "action" });
    }
  }

  // ---------------- cardio
  if (x.cardio && x.cardio.planned >= 4) {
    const share = x.cardio.done / x.cardio.planned;
    if (share >= 0.85) goingWell.push({ slot: "cardio", text: `${x.cardio.done} of ${x.cardio.planned} planned cardio sessions logged`, source: "record" });
    else if (share < 0.5) {
      observations.push({ slot: "cardio", text: `${x.cardio.done} of ${x.cardio.planned} planned cardio sessions logged`, source: "record" });
      clarify.push({ slot: "cardio-unlogged", text: "Is the cardio being done and not logged, or skipped?", source: "record", kind: "question", clarify: true });
    }
  }

  // ---------------- pain: verified reports, their trend
  for (const p of x.pain.slice(0, 3)) {
    const label = `${p.label}: ${p.status}${p.trend ? `, ${p.trend}` : ""}`;
    if (/better|improv/i.test(p.trend ?? "")) {
      goingWell.push({ slot: `pain:${p.label}`, text: `${p.label} is improving`, source: "record" });
      continue;
    }
    athleteNeeds.push({ slot: `pain:${p.label}`, text: label, source: "record" });
    if (p.reasons.length) {
      improve.push({ slot: `pain:${p.label}`, text: label, source: "record", detail: p.reasons.join("; ") });
      recommendations.push({
        slot: `rec-pain:${p.label}`,
        text: `Train around the ${lower(p.label)}: adjust what aggravates it and keep everything else moving`,
        source: "read",
        detail: "Pain that keeps coming back is a programming question first. If it's worsening, limiting or has warning signs, get it assessed.",
        say: `On your ${lower(p.label)}: we work around what aggravates it and keep training everything else. If it keeps getting worse, I want you to get it looked at.`,
      });
    }
  }

  // ---------------- nutrition plan
  if (!x.nutrition?.phase && !x.nutrition?.kcalLow) missing.push({ slot: "missing-nutrition", text: "A current nutrition plan", source: "record" });
  else if (x.nutrition?.phase)
    observations.push({
      slot: "nutrition-plan",
      text: `Nutrition: ${x.nutrition.phase}${x.nutrition.kcalLow ? `, ${x.nutrition.kcalLow === x.nutrition.kcalHigh ? x.nutrition.kcalLow : `${x.nutrition.kcalLow}–${x.nutrition.kcalHigh}`} kcal` : ""}${x.nutrition.since ? ` since ${day(x.nutrition.since)}` : ""}`,
      source: "record",
    });

  // ---------------- the program
  const pr = x.program;
  if (pr) {
    const where = pr.week && pr.weeks ? `week ${pr.week} of ${pr.weeks}` : null;
    observations.push({ slot: "program", text: `Program: ${pr.name}${where ? `, ${where}` : ""}${pr.endsOn ? `, ends ${day(pr.endsOn)}` : ""}`, source: "record" });
    const endsIn = pr.endsOn ? daysBetween(x.today, pr.endsOn) : null;
    if (endsIn != null && endsIn >= 0 && endsIn <= 14) {
      if (pr.nextName)
        milestones.push({ slot: "program-next", text: `${pr.nextName} starts ${pr.nextStarts ? day(pr.nextStarts) : "after this block"}`, source: "record" });
      else {
        recommendations.push({
          slot: "rec-next-block",
          text: `Plan the next block: ${pr.name} ends ${day(pr.endsOn)}`,
          source: "record",
          detail: "Decide what the next block is for before this one ends, so there's no gap and the athlete knows why it changes.",
          say: `This block wraps up ${day(pr.endsOn)}. Here's what I want the next one to focus on, and why.`,
        });
        coachActions.push({ slot: "action-next-block", text: `Write the next block before ${day(pr.endsOn)}`, source: "read", kind: "action" });
      }
    }
  }

  // ---------------- videos
  if (x.videos && x.videos.count > 0)
    observations.push({ slot: "videos", text: `${x.videos.count} set video${x.videos.count === 1 ? "" : "s"} sent in the last 4 weeks${x.videos.lastDate ? `, the last ${day(x.videos.lastDate)}` : ""}`, source: "record" });

  // ---------------- records: all-time PRs in finished workouts, the wins they remember
  const rec = x.records;
  if (rec?.top.length) {
    const prs: PrepItem[] = rec.top.slice(0, 2).map((r) => ({
      slot: `pr:${r.exercise}`,
      text: `All-time PR: ${r.exercise} ${loadIn(r.loadKg, unit)} × ${r.reps} (${day(r.date)})`,
      source: "record" as const,
      say: `${r.exercise}: ${loadIn(r.loadKg, unit)} for ${r.reps}. That's an all-time best.`,
    }));
    const more = rec.total - Math.min(2, rec.top.length);
    if (more > 0) prs.push({ slot: "pr-more", text: `${more} more all-time record${more === 1 ? "" : "s"} in the last 4 weeks`, source: "record" });
    goingWell.unshift(...prs);
  }

  // ---------------- follow-through since last time
  for (const d of (x.doneCommitments ?? []).filter((d) => d.owner === "athlete").slice(0, 2))
    goingWell.push({ slot: `done:${d.text.slice(0, 40)}`, text: `Followed through: ${d.text}`, source: "history" });

  // ---------------- the event
  const e = x.event;
  const meetSoon = e?.kind === "competition" && e.daysOut != null && e.daysOut >= 0;
  if (e?.date && e.daysOut != null && e.daysOut >= 0) {
    milestones.push({
      slot: "event",
      text: `${e.title}: ${e.daysOut === 0 ? "today" : `${e.daysOut} days out`} (${day(e.date)})${e.phase ? `, ${e.phase.toLowerCase()}` : ""}`,
      source: "record",
      ref: e.source,
    });
    for (const conflict of e.conflicts) {
      decisions.push({ slot: `event-conflict:${conflict}`, text: `Confirm the details: ${conflict}`, source: "record", ref: e.source });
      clarify.push({ slot: `event-conflict:${conflict}`, text: `Records disagree: ${conflict}`, source: "record", clarify: true });
    }
  }
  const comp = x.competition;
  if (comp) {
    if (comp.expectedTotal != null)
      milestones.push({
        slot: "comp-projection",
        text: `Projected total ${comp.expectedTotal} kg${comp.range ? ` (${comp.range.conservative}–${comp.range.high})` : ""}${comp.place ? `, about ${ordinal(comp.place)}` : ""}`,
        source: "read",
        ref: "Competition Intelligence",
      });
    if (comp.headline) observations.push({ slot: "comp-headline", text: comp.headline, source: "read", ref: "Competition Intelligence" });
    for (const d of comp.openDecisions) {
      decisions.push({ slot: `comp-decision:${d.slice(0, 40)}`, text: d, source: "read", ref: "Competition Intelligence" });
      recommendations.push({ slot: `comp-decision:${d.slice(0, 40)}`, text: d, source: "read", ref: "Competition Intelligence" });
    }
    if (comp.classGapKg != null && comp.classGapKg > 0) {
      decisions.push({ slot: "comp-class", text: `Weight class: ${comp.classGapKg.toFixed(1)} kg over the limit today`, source: "record", ref: "Bodyweight" });
      improve.push({ slot: "comp-class", text: `Weight class: ${comp.classGapKg.toFixed(1)} kg over the limit today`, source: "record", ref: "Bodyweight" });
    }
    if (e?.daysOut != null && e.daysOut <= 21 && !comp.gamePlanReleased)
      coachActions.push({ slot: "action-game-plan", text: "Release the game plan (attempts and warm-ups) before meet week", source: "read", kind: "action" });
  }

  // ---------------- the goal ledger: approved targets, what they said, and what still needs the coach
  for (const g of x.goals ?? []) {
    const slot = `goal:${g.id}`;
    // Cleo's projection is an interpretation: the coach's to read, never on the shared screen
    if (g.projection) observations.push({ slot: `${slot}:projection`, text: `${g.title}: projected ${g.projection}${g.score != null ? `, ${g.score}/100 feasibility` : ""}`, source: "read", ref: "Goals" });
    if (g.status === "proposed") {
      if (g.clientTarget)
        decisions.push({
          slot,
          text: `Confirm the target: ${g.title}, they said ${g.clientTarget}${g.tentative ? " (tentatively)" : ""}`,
          source: "athlete",
          ref: "Goals",
        });
      if (g.unitInferred) clarify.push({ slot: `${slot}:unit`, text: `${g.title}: no unit was said (${g.clientTarget}); confirm it`, source: "athlete", clarify: true });
      continue;
    }
    if (g.approved)
      milestones.push({
        slot,
        text: `${g.title}: target ${g.approved}`,
        // a target the client isn't told about stays off the shared screen
        source: g.clientFacing ? "record" : "coach",
        ref: "Goals",
      });
    if (g.action) recommendations.push({ slot: `${slot}:action`, text: `${g.title}: ${g.action}`, source: "read", ref: "Goals" });
  }

  // ---------------- the client's own words: answers, topics, recent messages (reported, never verified)
  const routed = routeAnswers(x.answers);
  const said = (text: string, slot: string): PrepItem => ({ text, source: "athlete", ref: "Pre-call questions", slot });
  goingWell.push(...routed.goingWell.map((t, i) => said(t, `ans-good:${i}`)));
  athleteNeeds.push(...routed.theirs.map((t, i) => said(t, `ans-theirs:${i}`)));
  coachNeeds.push(...routed.coach.map((t, i) => said(t, `ans-coach:${i}`)));
  milestones.push(...routed.plan.map((t, i) => said(t, `ans-plan:${i}`)));
  if (x.answers.life && !/^(no|none|nothing|nothing new|n\/a)\.?$/i.test(x.answers.life.trim()))
    connect.push({ slot: "connect-life", text: `Coming up for them: ${x.answers.life.trim()}`, source: "athlete" });
  for (const t of x.topics ? [x.topics] : [])
    athleteNeeds.unshift({ slot: "topics", text: t, source: "athlete", ref: "Their topics for this call", detail: "Answer it with direction, not another question." });
  for (const m of (x.recentMessages ?? []).slice(0, 2))
    athleteNeeds.push({ slot: `msg:${m.date}:${m.text.slice(0, 24)}`, text: `They wrote (${day(m.date)}): “${m.text}”`, source: "athlete", ref: "Coach chat" });

  // ---------------- the coach's own words
  for (const p of x.coachPriorities) {
    decisions.unshift({ slot: `prio:${p.slice(0, 40)}`, text: p, source: "coach" });
    recommendations.unshift({ slot: `prio:${p.slice(0, 40)}`, text: p, source: "coach" });
  }
  if (x.coachNotes?.trim()) coachNeeds.unshift({ slot: "coach-notes", text: x.coachNotes.trim(), source: "coach" });

  // ---------------- carried over from earlier meetings
  const carriedOver = x.commitments.filter((m) => m.status === "open");
  for (const m of carriedOver) {
    const due = m.dueOn && m.dueOn < x.today ? " (past due)" : "";
    const line: PrepItem = {
      slot: `commit:${m.id}`,
      text: `${m.owner === "athlete" ? "Their commitment" : "Your commitment"} from ${day(m.sessionDate)}: ${m.text}${due}`,
      source: "history",
    };
    (m.owner === "athlete" ? coachNeeds : athleteNeeds).push(line);
    (m.owner === "athlete" ? clientActions : coachActions).push({ ...line, kind: "action", text: `${m.text}${due ? " (carried over, past due)" : " (carried over)"}` });
  }
  if (x.previous?.actionItems.length)
    for (const a of x.previous.actionItems)
      coachNeeds.push({ slot: `follow:${a.slice(0, 40)}`, text: `Follow up from ${day(x.previous.date)}: ${a}`, source: "history" });
  if (x.lastMeeting?.summary)
    observations.push({ slot: "last-meeting", text: `Last meeting (${day(x.lastMeeting.date)}): ${x.lastMeeting.summary}`, source: "history" });

  // ---------------- never an empty plan: when nothing stands out, the coach still leads
  if (!recommendations.length) {
    const solid = goingWell.length >= 2 && !improve.length;
    recommendations.push(
      solid
        ? { slot: "rec-stay", text: "Stay the course: the plan is working", source: "read", detail: "Changing a plan that's working costs momentum.", say: "My recommendation is simple: we don't change what's working. Same plan, same standard." }
        : { slot: "rec-baseline", text: "Hold the plan steady and get a clean read for the next two weeks", source: "read", detail: "With little on file, the most useful thing is a clean two weeks of logs, weigh-ins and a check-in, so the next decision rests on evidence.", say: "For the next two weeks I want a clean read: every session logged, weigh-ins in, check-in sent. Then I can make the right call on what changes." },
    );
  }
  if (!clientActions.length)
    clientActions.push({ slot: "action-execute", text: "Execute the plan as written until we next speak", source: "read", kind: "action" });

  const objective = objectiveOf(x, { improve, recommendations, goingWell });
  const nextObjective = e?.date && e.daysOut != null && e.daysOut >= 0
    ? `${e.title} on ${day(e.date)}`
    : pr?.endsOn && daysBetween(x.today, pr.endsOn) >= 0
      ? `Finish ${pr.name} strong (ends ${day(pr.endsOn)})`
      : null;

  void name;
  void meetSoon;
  return {
    objective: objective.objective,
    outcome: objective.outcome,
    objectivePrivate: objective.private,
    connect: dedupe(connect),
    goingWell: dedupe(goingWell),
    observations: dedupe(observations),
    improve: dedupe(improve),
    recommendations: dedupe(recommendations).slice(0, 6),
    athleteNeeds: dedupe(athleteNeeds),
    coachNeeds: dedupe(coachNeeds),
    clientActions: dedupe(clientActions).slice(0, 5),
    coachActions: dedupe(coachActions).slice(0, 5),
    clarify: dedupe(clarify).slice(0, 4),
    missing: dedupe(missing),
    decisions: dedupe(decisions),
    milestones: dedupe(milestones),
    nextObjective,
    carriedOver,
  };
}

function objectiveOf(x: SessionPrepInput, p: { improve: PrepItem[]; recommendations: PrepItem[]; goingWell: PrepItem[] }): { objective: string; outcome: string; private?: boolean } {
  const e = x.event;
  if (e?.kind === "competition" && e.daysOut != null && e.daysOut >= 0) {
    if (e.daysOut <= 7) return { objective: `Final confirmations for ${e.title}`, outcome: "They leave calm, clear on the plan and sure of every step to the platform." };
    if (e.daysOut <= 28) return { objective: `Lock in the strategy for ${e.title}`, outcome: "Attempts, weight and taper agreed; they know exactly what the next weeks look like." };
    return { objective: `Set the direction toward ${e.title}`, outcome: "They know what this phase is building and the 2–3 things that matter most until the meet." };
  }
  if (x.coachPriorities.length) return { objective: x.coachPriorities[0]!, outcome: "That decision made, the reasons understood and the next steps owned.", private: true };
  if (p.improve.length) return { objective: "Address what's limiting progress", outcome: "They understand what's holding them back, what changes and what they own." };
  if (p.goingWell.length) return { objective: "Review progress and set the next priorities", outcome: "They know what's working, why, and the next priorities until we speak." };
  return { objective: "Set the standard and the next priorities", outcome: "Clear expectations for the next two weeks and how progress will be measured." };
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
/* The plan: six coach-led stages                                      */

export type SectionKey = "connect" | "recognize" | "evaluate" | "coach" | "execute" | "align";
/** The stages before Nov 25 2026, still on meetings prepared then. */
export type LegacySectionKey = "going_well" | "improve" | "athletes_corner" | "game_plan" | "alignment";

export const SECTION_KEYS: SectionKey[] = ["connect", "recognize", "evaluate", "coach", "execute", "align"];
export const SECTION_TITLES: Record<SectionKey, string> = {
  connect: "Connect",
  recognize: "Recognize",
  evaluate: "Evaluate",
  coach: "Coach",
  execute: "Execute",
  align: "Align",
};
/** What each stage is for, in a line (the coach's view). */
export const SECTION_PURPOSE: Record<SectionKey, string> = {
  connect: "Rapport, and how they're doing",
  recognize: "Genuine wins and good habits",
  evaluate: "What you're seeing, and what's limiting progress",
  coach: "Direction, education and your recommendations",
  execute: "Priorities, responsibilities and expectations",
  align: "Confirm the direction and finish with confidence",
};

export type AgendaSection = { key: SectionKey; title: string; minutes: number; items: TalkingPoint[] };
export type Agenda = {
  version: 2;
  minutes: number;
  /** the share of the meeting left open for the client to talk (Connect, questions, Align) */
  athleteShare: number;
  objective: string;
  outcome: string;
  /** the objective is the coach's private priority: the shared screen leaves it out */
  objectivePrivate?: boolean;
  /** the coach wrote the objective: a refresh keeps it */
  objectiveEdited?: boolean;
  nextObjective: string | null;
  sections: AgendaSection[];
  /** clarifications to settle, kept apart from the talking points */
  clarify: TalkingPoint[];
};

/** Kept for meetings prepared before the coach-led plan (the old minimum share for "Your corner"). */
export const ATHLETE_SHARE = { min: 0.2, max: 0.35 } as const;

const SHAREABLE_SOURCES: ReadonlySet<Source> = new Set(["record", "athlete"]);
/**
 * Generated direction the client may see (the coach's recommendations and
 * their actions, worded as advice, holding nothing private); every other read
 * (a weight-management or competition interpretation) stays the coach's.
 */
const SHAREABLE_READ = /^(rec-(stay|baseline|recovery|nutrition-simplify|pain:|next-block)|action-|align-close)/;

/** Whether a point is on the shared screen until the coach says otherwise. */
export function sharedByDefault(i: PrepItem): boolean {
  const basis = basisOf(i);
  if (basis === "unknown" || i.clarify || i.kind === "question") return false;
  if (SHAREABLE_SOURCES.has(i.source)) return i.ref !== "Coach chat";
  return i.source === "read" && !!i.slot && SHAREABLE_READ.test(i.slot);
}

/** A stable id for a point: its stage and what it's about. */
export function pointId(section: SectionKey, i: PrepItem): string {
  const k = (i.slot ?? i.text).toLowerCase().replace(/[^a-z0-9:]+/g, "-").slice(0, 60);
  return `${section}:${k}`;
}

function toPoint(section: SectionKey, i: PrepItem, now: string | undefined): TalkingPoint {
  const basis = basisOf(i);
  return {
    ...i,
    id: pointId(section, i),
    basis,
    kind: i.kind ?? (i.text.trim().endsWith("?") ? "question" : "statement"),
    // the client's screen: their own records and words and the coach's direction, never a read, the coach's notes or anything unsettled
    share: sharedByDefault(i),
    status: "open",
    ...(now ? { addedAt: now } : {}),
  };
}

/** Section weights by meeting kind; empty stages give their time back. */
const WEIGHTS: Record<"call" | "touch_base", Record<SectionKey, number>> = {
  call: { connect: 0.08, recognize: 0.12, evaluate: 0.22, coach: 0.28, execute: 0.18, align: 0.12 },
  touch_base: { connect: 0.1, recognize: 0.1, evaluate: 0.2, coach: 0.3, execute: 0.2, align: 0.1 },
};

/**
 * Each thing is said once in a plan: the same signal can reach a section from
 * two lists (a check-in's recovery flags are both "what's not working" and
 * "what they need"; a worsening pain the same), so a point whose topic (its
 * slot, "-support" aside) or whose words (past a "Label:") were already said
 * in an earlier point is left out, the first one kept.
 */
function onceEach(raw: Record<SectionKey, PrepItem[]>): Record<SectionKey, PrepItem[]> {
  const seen = sayOnce();
  const out = {} as Record<SectionKey, PrepItem[]>;
  for (const k of SECTION_KEYS) out[k] = (raw[k] ?? []).filter((i) => seen(i));
  return out;
}

/** A filter that passes a point the first time its topic or its words come up. */
function sayOnce() {
  const topics = new Set<string>();
  const words = new Set<string>();
  return (i: { slot?: string | null; text: string }): boolean => {
    const topic = i.slot ? i.slot.replace(/-support$/, "") : null;
    const said = i.text.replace(/^[^:]{1,30}:\s*/, "").toLowerCase().replace(/[^a-z0-9×]+/g, " ").trim();
    if ((topic && topics.has(topic)) || (said.length > 8 && words.has(said))) return false;
    if (topic) topics.add(topic);
    if (said.length > 8) words.add(said);
    return true;
  };
}

export function planAgenda(prep: SessionPrep, opts: { minutes?: number; format?: string; now?: string; firstName?: string | null } = {}): Agenda {
  const fmt = opts.format === "touch_base" ? "touch_base" : "call";
  const decisions = prep.decisions.length + prep.recommendations.length;
  const minutes = opts.minutes ?? (fmt === "touch_base" ? 10 : Math.min(30, Math.max(15, 15 + Math.min(decisions, 4) * 3)));
  const name = opts.firstName?.trim() || null;

  const connect: PrepItem[] = [
    {
      slot: "connect-open",
      text: "Open warm: how's the week been?",
      source: "read",
      kind: "statement",
      say: `${name ? `Hey ${name}` : "Hey"}, good to see you. How's the week been?`,
      detail: "One easy opener. Listen, then move on: the meeting has a job to do.",
    },
    ...prep.connect,
  ];
  const athleteWords = prep.athleteNeeds.filter((i) => i.source === "athlete");
  const recognize = prep.goingWell.slice(0, 4);
  const evaluate = [...prep.observations.slice(0, 4), ...prep.improve.slice(0, 3), ...prep.athleteNeeds.filter((i) => i.source === "record").slice(0, 2)];
  const coach = [
    ...prep.recommendations.slice(0, 4),
    // their questions get an answer with direction
    ...athleteWords.slice(0, 3).map((i) => ({ ...i, text: i.slot === "topics" ? `They want to cover: ${i.text}` : i.text })),
  ];
  const execute = [...prep.clientActions, ...prep.coachActions, ...prep.coachNeeds.filter((i) => i.source !== "history" && i.source !== "coach").slice(0, 2)];
  const align: PrepItem[] = [
    ...(prep.nextObjective ? [{ slot: "align-next", text: `Next objective: ${prep.nextObjective}`, source: "record" as const }] : []),
    {
      slot: "align-confirm",
      text: "Have them say back their top priority",
      source: "read",
      kind: "question",
      say: "Before we finish, tell me in your own words the one thing you're focused on until we next talk.",
      detail: "Agreement you hear back is agreement you can hold them to.",
    },
    {
      slot: "align-close",
      text: "Finish with confidence",
      source: "read",
      say: "You know what to do and why. I'll send you a short recap so it's all in one place.",
    },
  ];
  const raw: Record<SectionKey, PrepItem[]> = onceEach({ connect, recognize, evaluate, coach, execute, align });
  if (fmt === "touch_base") {
    raw.recognize = raw.recognize.slice(0, 1);
    raw.evaluate = raw.evaluate.slice(0, 2);
    raw.coach = raw.coach.slice(0, 2);
    raw.execute = raw.execute.slice(0, 2);
    raw.align = raw.align.filter((i) => i.slot !== "align-close");
  }
  const weights = WEIGHTS[fmt];
  const active = SECTION_KEYS.filter((k) => raw[k].length > 0);
  const total = active.reduce((s, k) => s + weights[k], 0);
  const mins = active.map((k) => ({ k, m: Math.max(1, Math.round((weights[k] / total) * minutes)) }));
  let diff = minutes - mins.reduce((s, r) => s + r.m, 0);
  for (const r of [...mins].sort((a, b) => weights[b.k] - weights[a.k])) {
    if (diff === 0) break;
    const step = diff > 0 ? 1 : -1;
    if (r.m + step >= 1) {
      r.m += step;
      diff -= step;
    }
  }
  const sections: AgendaSection[] = mins.map(({ k, m }) => ({
    key: k,
    title: SECTION_TITLES[k],
    minutes: m,
    items: raw[k].map((i) => toPoint(k, i, opts.now)),
  }));
  const open = sections.filter((s) => s.key === "connect" || s.key === "align").reduce((a, s) => a + s.minutes, 0);
  return {
    version: 2,
    minutes,
    athleteShare: Math.round((open / Math.max(1, minutes)) * 100) / 100,
    objective: prep.objective,
    outcome: prep.outcome,
    objectivePrivate: !!prep.objectivePrivate,
    nextObjective: prep.nextObjective,
    sections,
    clarify: prep.clarify.map((i) => toPoint("evaluate", { ...i, clarify: true }, opts.now)),
  };
}

/* ------------------------------------------------------------------ */
/* Older plans, and keeping the coach's work when a plan refreshes     */

const LEGACY_TO: Record<LegacySectionKey, SectionKey> = {
  going_well: "recognize",
  improve: "evaluate",
  athletes_corner: "coach",
  game_plan: "coach",
  alignment: "execute",
};

/** Any stored agenda as a coach-led plan (a plan prepared before Nov 25 2026 is read into the new stages). */
export function normalizeAgenda(agenda: any): Agenda | null {
  if (!agenda || !Array.isArray(agenda.sections)) return null;
  if (agenda.version === 2) {
    // a plan stored before points were said once each: an untouched repeat is
    // left out as it's read (the coach's own, edited or settled points always stay)
    const seen = sayOnce();
    return {
      ...agenda,
      clarify: Array.isArray(agenda.clarify) ? agenda.clarify : [],
      sections: agenda.sections.map((s: any) => ({
        ...s,
        items: (s.items ?? [])
          .map((i: any) => fillPoint(s.key, i))
          .filter((i: TalkingPoint) => {
            const touched = !!(i.custom || i.edited || (i.status && i.status !== "open"));
            const first = seen(i);
            return first || touched;
          }),
      })),
    } as Agenda;
  }
  const by = new Map<SectionKey, AgendaSection>();
  for (const s of agenda.sections as any[]) {
    const key = LEGACY_TO[s.key as LegacySectionKey] ?? "coach";
    const sec = by.get(key) ?? { key, title: SECTION_TITLES[key], minutes: 0, items: [] };
    sec.minutes += Number(s.minutes) || 0;
    sec.items.push(...((s.items ?? []) as PrepItem[]).map((i) => fillPoint(key, i)));
    by.set(key, sec);
  }
  return {
    version: 2,
    minutes: Number(agenda.minutes) || 20,
    athleteShare: Number(agenda.athleteShare) || 0.25,
    objective: "Review progress and set the next priorities",
    outcome: "",
    nextObjective: null,
    sections: SECTION_KEYS.filter((k) => by.has(k)).map((k) => by.get(k)!),
    clarify: [],
  };
}

function fillPoint(section: SectionKey, i: any): TalkingPoint {
  if (i && typeof i.id === "string" && i.basis && i.kind) return { share: true, status: "open", ...i } as TalkingPoint;
  return toPoint(section, { text: String(i?.text ?? ""), source: (i?.source ?? "record") as Source, ref: i?.ref, slot: i?.slot }, undefined);
}

/** What changed between the plan on file and a refreshed one, in words (only what the coach would care about). */
export function agendaChanges(prev: Agenda | null, next: Agenda): string[] {
  if (!prev) return [];
  const before = new Map(prev.sections.flatMap((s) => s.items.map((i) => [i.id, i.text] as const)));
  const out: string[] = [];
  for (const s of next.sections)
    for (const i of s.items) {
      if (i.custom) continue;
      const was = before.get(i.id);
      if (was == null) out.push(`New in ${SECTION_TITLES[s.key]}: ${i.text}`);
      else if (was !== i.text && !i.edited) out.push(`Updated: ${i.text}`);
    }
  const nextIds = new Set(next.sections.flatMap((s) => s.items.map((i) => i.id)));
  for (const s of prev.sections)
    for (const i of s.items) if (!i.custom && !nextIds.has(i.id) && !i.edited) out.push(`No longer on file: ${i.text}`);
  if (prev.objective !== next.objective) out.push(`Objective: ${next.objective}`);
  return out.slice(0, 8);
}

/**
 * A refreshed plan merged into the one on file: every point the coach wrote,
 * edited, skipped or addressed stays as the coach left it (and where they put
 * it); a generated point whose facts changed is updated; a new one is added
 * with `addedAt` (so the coach sees it's new); a generated point that's no
 * longer on file goes unless the coach touched it. Minutes and order the coach
 * set stay.
 */
export function mergeAgenda(prev: Agenda | null, next: Agenda, now: string): Agenda {
  if (!prev) return { ...next, sections: next.sections.map((s) => ({ ...s, items: s.items.map((i) => ({ ...i, addedAt: i.addedAt ?? now })) })) };
  const prevById = new Map(prev.sections.flatMap((s) => s.items.map((i) => [i.id, { i, s: s.key }] as const)));
  const nextById = new Map(next.sections.flatMap((s) => s.items.map((i) => [i.id, i] as const)));
  const touched = (i: TalkingPoint) => i.custom || i.edited || (i.status && i.status !== "open");
  const sections: AgendaSection[] = [];
  for (const key of SECTION_KEYS) {
    const p = prev.sections.find((s) => s.key === key);
    const n = next.sections.find((s) => s.key === key);
    if (!p && !n) continue;
    const items: TalkingPoint[] = [];
    // the coach's order first: everything already on the plan, updated in place
    for (const i of p?.items ?? []) {
      const fresh = nextById.get(i.id);
      if (touched(i)) items.push(fresh && !i.edited && !i.custom ? { ...fresh, status: i.status, share: i.share, addedAt: i.addedAt, cleoSay: i.cleoSay } : i);
      else if (fresh) items.push({ ...fresh, share: i.share, addedAt: i.addedAt ?? now, cleoSay: fresh.text === i.text ? i.cleoSay : null });
    }
    for (const i of n?.items ?? []) if (!prevById.has(i.id)) items.push({ ...i, addedAt: now });
    if (!items.length) continue;
    sections.push({ key, title: SECTION_TITLES[key], minutes: p?.minutes ?? n?.minutes ?? 1, items });
  }
  // clarifications: the coach's wording and status stay; one they settled or reworded stays even once it's no longer on file
  const touchedClarify = (c: TalkingPoint) => c.custom || c.edited || (c.status && c.status !== "open");
  const nextClarify = new Set(next.clarify.map((c) => c.id));
  const clarify = [
    ...next.clarify.map((c) => {
      const was = prev.clarify.find((x) => x.id === c.id);
      if (!was) return { ...c, addedAt: now };
      return was.edited || was.custom ? was : { ...c, status: was.status, addedAt: was.addedAt };
    }),
    ...prev.clarify.filter((c) => !nextClarify.has(c.id) && touchedClarify(c)),
  ];
  return {
    ...next,
    ...(prev.objectiveEdited
      ? { objective: prev.objective, objectivePrivate: prev.objectivePrivate, objectiveEdited: true }
      : {}),
    minutes: prev.minutes,
    sections,
    clarify,
  };
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

/* ------------------------------------------------------------------ */
/* The coach's edits                                                   */

export type AgendaOp =
  | { op: "edit"; id: string; text?: string; say?: string | null; detail?: string | null }
  | { op: "add"; section: SectionKey; id: string; text: string; say?: string | null; kind?: PointKind; share?: boolean }
  | { op: "status"; id: string; status: PointStatus }
  | { op: "share"; id: string; share: boolean }
  | { op: "move"; id: string; dir: "up" | "down" }
  | { op: "section"; id: string; to: SectionKey }
  | { op: "remove"; id: string }
  | { op: "objective"; text: string }
  | { op: "minutes"; section: SectionKey; minutes: number };

/**
 * One edit applied to the plan on file (server side, so an edit never
 * overwrites what a refresh just added). Generated points are never deleted,
 * only skipped (a refresh would bring them back); the coach's own are.
 */
export function applyAgendaOp(raw: Agenda | unknown, op: AgendaOp, now: string): Agenda {
  const agenda = normalizeAgenda(raw);
  if (!agenda) throw new Error("This meeting has no plan yet.");
  const a: Agenda = { ...agenda, sections: agenda.sections.map((s) => ({ ...s, items: [...s.items] })), clarify: [...agenda.clarify] };
  const find = (id: string) => {
    for (const s of a.sections) {
      const i = s.items.findIndex((p) => p.id === id);
      if (i >= 0) return { list: s.items, i, section: s };
    }
    const c = a.clarify.findIndex((p) => p.id === id);
    if (c >= 0) return { list: a.clarify, i: c, section: null };
    return null;
  };
  switch (op.op) {
    case "objective":
      a.objective = op.text.trim().slice(0, 200) || a.objective;
      a.objectivePrivate = false;
      a.objectiveEdited = true;
      return a;
    case "minutes": {
      const s = a.sections.find((x) => x.key === op.section);
      if (s) s.minutes = Math.max(0, Math.min(60, Math.round(op.minutes)));
      a.minutes = a.sections.reduce((t, x) => t + x.minutes, 0) || a.minutes;
      return a;
    }
    case "add": {
      const text = op.text.trim().slice(0, 400);
      if (!text) return a;
      let s = a.sections.find((x) => x.key === op.section);
      if (!s) {
        s = { key: op.section, title: SECTION_TITLES[op.section], minutes: 2, items: [] };
        a.sections.push(s);
        a.sections.sort((x, y) => SECTION_KEYS.indexOf(x.key) - SECTION_KEYS.indexOf(y.key));
      }
      s.items.push({
        id: op.id,
        text,
        say: op.say?.trim() || null,
        source: "coach",
        basis: "observed",
        kind: op.kind ?? (text.endsWith("?") ? "question" : "statement"),
        share: op.share ?? false,
        status: "open",
        custom: true,
        edited: true,
        addedAt: now,
      });
      return a;
    }
  }
  const at = find(op.id);
  if (!at) return a;
  const p = at.list[at.i]!;
  switch (op.op) {
    case "edit":
      at.list[at.i] = {
        ...p,
        ...(op.text != null ? { text: op.text.trim().slice(0, 400) || p.text } : {}),
        ...(op.say !== undefined ? { say: op.say?.trim() || null } : {}),
        ...(op.detail !== undefined ? { detail: op.detail?.trim() || null } : {}),
        edited: true,
      };
      break;
    case "status":
      at.list[at.i] = { ...p, status: op.status };
      break;
    case "share":
      at.list[at.i] = { ...p, share: op.share };
      break;
    case "move": {
      const j = op.dir === "up" ? at.i - 1 : at.i + 1;
      if (j >= 0 && j < at.list.length) {
        at.list[at.i] = at.list[j]!;
        at.list[j] = { ...p, edited: p.edited ?? false };
      }
      break;
    }
    case "section": {
      if (!at.section || at.section.key === op.to) break;
      at.list.splice(at.i, 1);
      let s = a.sections.find((x) => x.key === op.to);
      if (!s) {
        s = { key: op.to, title: SECTION_TITLES[op.to], minutes: 2, items: [] };
        a.sections.push(s);
        a.sections.sort((x, y) => SECTION_KEYS.indexOf(x.key) - SECTION_KEYS.indexOf(y.key));
      }
      // its id stays (so a refresh still recognizes it), marked so a refresh leaves it where the coach put it
      s.items.push({ ...p, edited: true });
      break;
    }
    case "remove":
      if (p.custom) at.list.splice(at.i, 1);
      else at.list[at.i] = { ...p, status: "skipped" };
      break;
  }
  a.sections = a.sections.filter((s) => s.items.length > 0 || s.key === "align");
  return a;
}
