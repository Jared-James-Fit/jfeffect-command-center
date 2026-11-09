/**
 * How long the next program is, and how it fits the athlete's longer timeline.
 *
 * Two different things, kept apart:
 *  - the long-term timeline: the time to a deadline (a meet, a test, a dated
 *    goal), which can be months or years away;
 *  - the program horizon: the weeks written and scheduled now.
 *
 * By default 12 weeks are written. A deadline changes that only where it should:
 * within 12 weeks the program runs to it (an 8-week prep for a meet in 8), 13–16
 * weeks out it stops 4 weeks short so the final prep is written later from
 * fresh results (16 → 12 now + 4), and further out it's 12 weeks of a longer
 * roadmap. Weeks are counted from the program's planned start (after whatever
 * is running now), never from today. Pure and deterministic.
 */
import { daysBetween } from "./core";

export const DEFAULT_PROGRAM_WEEKS = 12;
export const MAX_PROGRAM_WEEKS = 24;
/** The final preparation left for its own program when a deadline is 13–16 weeks out. */
export const FINAL_PREP_WEEKS = 4;

export type DurationMode = "default" | "custom" | "goal";
export type Deadline = { kind: "meet" | "goal"; name: string; date: string; source: string };
/** The dated goal a coach keeps on the athlete's intel profile (`program_intel_profiles.long_term_goal`). */
export type LongTermGoal = { text: string; date: string | null; savedAt?: string | null };
export type HorizonConflict = { id: string; title: string; detail: string; options: string[] };
export type RoadmapStep = { from: number; to: number; label: string };

export type Horizon = {
  mode: DurationMode;
  /** Weeks written and scheduled now. */
  weeks: number;
  /** The program's first day (a Monday) and last day. */
  start: string;
  end: string;
  /** What decided the start. */
  startWhy: string;
  /** The deadline this program works toward, with the program week it falls in (counted from the start). */
  deadline: (Deadline & { week: number }) | null;
  /** Later deadlines (beyond this one) that still shape the long-term plan. */
  later: Array<Deadline & { week: number }>;
  /**
   * open: no deadline; to_deadline: the program ends the week of the deadline;
   * before_final_prep: it stops a few weeks short, the final prep comes next;
   * phase: one part of a longer road; past_deadline: it runs on past the deadline.
   */
  role: "open" | "to_deadline" | "before_final_prep" | "phase" | "past_deadline";
  /** What the AI would pick in Goal timeline mode, and why. */
  recommended: { weeks: number; why: string };
  /** The road from this start to the deadline, program by program (this one first). */
  roadmap: RoadmapStep[];
  why: string;
  conflicts: HorizonConflict[];
};

const iso = (d: Date) => d.toISOString().slice(0, 10);
export function addDays(date: string, n: number): string {
  return iso(new Date(Date.parse(`${date}T00:00:00Z`) + n * 86_400_000));
}
/** The Monday on or after a date. */
export function mondayOnOrAfter(date: string): string {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 Sunday … 6 Saturday
  return addDays(date, (8 - dow) % 7);
}

/**
 * When the next program starts: the Monday after today, or the Monday after the
 * running program ends if that's later (so the two never overlap).
 */
export function plannedStart(today: string, currentEnd: string | null): { date: string; why: string } {
  const next = mondayOnOrAfter(addDays(today, 1));
  if (currentEnd && currentEnd >= today) {
    const after = mondayOnOrAfter(addDays(currentEnd, 1));
    if (after > next) return { date: after, why: `the Monday after the current program ends (${currentEnd})` };
  }
  return { date: next, why: "next Monday" };
}

/** The program week (1-based, counted from the start) a date falls in; 0 or less when it's before the start. */
export function weekOf(start: string, date: string): number {
  return Math.floor(daysBetween(start, date) / 7) + 1;
}

/** The length the AI picks for a deadline in program week W. */
export function lengthForDeadline(week: number): { weeks: number; role: Horizon["role"] } {
  if (week <= DEFAULT_PROGRAM_WEEKS) return { weeks: Math.max(1, week), role: "to_deadline" };
  if (week <= DEFAULT_PROGRAM_WEEKS + FINAL_PREP_WEEKS) return { weeks: week - FINAL_PREP_WEEKS, role: "before_final_prep" };
  return { weeks: DEFAULT_PROGRAM_WEEKS, role: "phase" };
}

/** The programs from the start to the deadline week: this one, then each later one by the same rule. */
export function roadmapTo(deadlineWeek: number, firstWeeks: number, deadlineName: string): RoadmapStep[] {
  const steps: RoadmapStep[] = [{ from: 1, to: firstWeeks, label: "This program" }];
  let at = firstWeeks;
  let n = 0;
  while (at < deadlineWeek && n < 12) {
    const left = deadlineWeek - at;
    const len = lengthForDeadline(left).weeks;
    const last = at + len >= deadlineWeek;
    steps.push({ from: at + 1, to: at + len, label: last ? `Final preparation to ${deadlineName}` : `Program ${steps.length + 1}` });
    at += len;
    n++;
  }
  return steps;
}

const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * The horizon for a duration mode. `deadlines` are everything dated on file
 * (meets, a dated goal); the earliest one on or after the start is the one this
 * program works toward.
 */
export function planHorizon(x: { mode: DurationMode; customWeeks?: number | null; start: string; startWhy?: string; deadlines: Deadline[] }): Horizon {
  const dated = x.deadlines
    .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d.date) && d.date >= x.start)
    .map((d) => ({ ...d, week: weekOf(x.start, d.date) }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const deadline = dated[0] ?? null;
  const later = dated.slice(1);
  const rec = deadline ? lengthForDeadline(deadline.week) : { weeks: DEFAULT_PROGRAM_WEEKS, role: "open" as const };
  const recWhy = !deadline
    ? `No dated deadline on file: ${DEFAULT_PROGRAM_WEEKS} weeks, then the next program is built from what happened.`
    : rec.role === "to_deadline"
      ? `${deadline.name} (${deadline.date}) falls in week ${deadline.week}: the program runs to it.`
      : rec.role === "before_final_prep"
        ? `${deadline.name} (${deadline.date}) is in week ${deadline.week}: ${rec.weeks} weeks now, and the final ${FINAL_PREP_WEEKS}-week prep is written next from how these go.`
        : `${deadline.name} (${deadline.date}) is ${deadline.week} weeks out: ${DEFAULT_PROGRAM_WEEKS} weeks now as one part of the road to it.`;

  const custom = Math.max(1, Math.min(MAX_PROGRAM_WEEKS, Math.round(Number(x.customWeeks) || DEFAULT_PROGRAM_WEEKS)));
  const weeks = x.mode === "goal" ? rec.weeks : x.mode === "custom" ? custom : DEFAULT_PROGRAM_WEEKS;
  const role: Horizon["role"] = !deadline ? "open" : weeks > deadline.week ? "past_deadline" : weeks === deadline.week ? "to_deadline" : deadline.week - weeks <= FINAL_PREP_WEEKS ? "before_final_prep" : "phase";

  const conflicts: HorizonConflict[] = [];
  if (deadline && x.mode !== "goal") {
    const D = deadline.week;
    if (weeks > D)
      conflicts.push({
        id: "runs-past-deadline",
        title: `${deadline.name} is in week ${D}, but the program runs ${weeks} weeks`,
        detail: `The last ${plural(weeks - D, "week")} would come after it.`,
        options: [`Make it ${plural(D, "week")} (finish at ${deadline.name})`, `Keep ${weeks} (plan what follows it)`],
      });
    else if (D - weeks > 0 && D - weeks < FINAL_PREP_WEEKS)
      conflicts.push({
        id: "short-final-prep",
        title: `Only ${plural(D - weeks, "week")} would be left before ${deadline.name}`,
        detail: `Too short for a final preparation of its own.`,
        options: [`Make it ${plural(D, "week")} (through ${deadline.name})`, ...(D - FINAL_PREP_WEEKS >= 1 ? [`Make it ${plural(D - FINAL_PREP_WEEKS, "week")} (a ${FINAL_PREP_WEEKS}-week final prep next)`] : []), `Keep ${weeks}`],
      });
  }
  const roadmap = deadline && deadline.week > weeks ? roadmapTo(deadline.week, weeks, deadline.name) : [{ from: 1, to: weeks, label: "This program" }];
  const why =
    x.mode === "goal"
      ? recWhy
      : x.mode === "custom"
        ? `${plural(weeks, "week")}, as you set it.${deadline ? ` ${deadline.name} (${deadline.date}) falls in week ${deadline.week}.` : ""}`
        : `The ${DEFAULT_PROGRAM_WEEKS}-week default.${deadline ? ` ${deadline.name} (${deadline.date}) falls in week ${deadline.week}.` : ""}`;
  return {
    mode: x.mode,
    weeks,
    start: x.start,
    end: addDays(x.start, weeks * 7 - 1),
    startWhy: x.startWhy ?? "",
    deadline,
    later,
    role,
    recommended: { weeks: rec.weeks, why: recWhy },
    roadmap,
    why,
    conflicts,
  };
}

/** The mode a new setup opens on: Goal timeline when a deadline within 16 weeks should set the length, else the 12-week default. */
export function defaultMode(h: Pick<Horizon, "deadline">): DurationMode {
  return h.deadline && h.deadline.week <= DEFAULT_PROGRAM_WEEKS + FINAL_PREP_WEEKS ? "goal" : "default";
}

/** A dated goal as a deadline, when it has a date. */
export function goalDeadline(g: LongTermGoal | null | undefined): Deadline | null {
  if (!g?.date || !/^\d{4}-\d{2}-\d{2}$/.test(g.date) || !g.text?.trim()) return null;
  return { kind: "goal", name: g.text.trim().slice(0, 80), date: g.date, source: "Long-term goal" };
}

/** The horizon in words for the brief and the prompts (what's written now vs the longer road). */
export function horizonText(h: Horizon): string {
  const L: string[] = [];
  L.push(`This program: ${plural(h.weeks, "week")}, ${h.start} → ${h.end} (starts ${h.startWhy || h.start}). ${h.why}`);
  if (h.deadline) {
    L.push(`Deadline: ${h.deadline.name} (${h.deadline.kind}), ${h.deadline.date}, in week ${h.deadline.week} counted from this program's start.`);
    if (h.role === "to_deadline") L.push(`The program ends the week of ${h.deadline.name}: its last weeks are the peak and taper (or the test), timed so ${h.deadline.date} falls in week ${h.weeks}.`);
    else if (h.role === "before_final_prep") L.push(`It stops ${plural(h.deadline.week - h.weeks, "week")} short of ${h.deadline.name}: build what the final prep needs (no peak or taper here); the final prep is written next from these results.`);
    else if (h.role === "phase") L.push(`It's one part of the road to ${h.deadline.name}: don't peak or taper now, and don't try to reach the whole goal in these weeks.`);
    else if (h.role === "past_deadline") L.push(`It runs ${plural(h.weeks - h.deadline.week, "week")} past ${h.deadline.name} (the coach chose this length): peak into week ${h.deadline.week}, then plan what follows it (recovery, then rebuilding).`);
  } else L.push("No dated deadline: progress from where they are and leave them ready for the next program.");
  if (h.roadmap.length > 1) L.push(`Road to the deadline (written one program at a time): ${h.roadmap.map((s) => `weeks ${s.from}–${s.to} ${s.label}`).join(" → ")}.`);
  for (const d of h.later) L.push(`Later: ${d.name} (${d.kind}), ${d.date}, week ${d.week}.`);
  return L.join("\n");
}

/** The Monday start that puts a deadline in the program's last week. */
export function alignedStart(deadline: string, weeks: number): string {
  return mondayOnOrAfter(addDays(deadline, -7 * weeks + 1));
}

export type AssignCheck = { id: "overlap" | "deadline-week"; text: string; suggest: string | null };

/**
 * What to say before a program is assigned from `start`: it would overlap the program running now
 * (duplicate sessions until that one ends), or a deadline it was written to finish at no longer
 * falls in its last week.
 */
export function assignChecks(x: { start: string; weeks: number; currentEnd: string | null; deadline: { name: string; date: string } | null; endsAtDeadline: boolean }): AssignCheck[] {
  const out: AssignCheck[] = [];
  if (x.currentEnd && x.start <= x.currentEnd) out.push({ id: "overlap", text: `The current program runs until ${x.currentEnd}: starting ${x.start} puts both programs' workouts on the same days.`, suggest: mondayOnOrAfter(addDays(x.currentEnd, 1)) });
  if (x.deadline && x.endsAtDeadline && x.deadline.date >= x.start) {
    const w = weekOf(x.start, x.deadline.date);
    if (w !== x.weeks) out.push({ id: "deadline-week", text: `With this start, ${x.deadline.name} (${x.deadline.date}) falls in week ${w} of ${x.weeks}, not the last week it was written to peak into.`, suggest: alignedStart(x.deadline.date, x.weeks) });
  }
  return out;
}
