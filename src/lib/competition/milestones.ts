/**
 * When each strategic deliverable is due (pure, tested in
 * competition-milestones.test.ts).
 *
 * A competition's preparation is a fixed set of milestones counted back from
 * the meet day: Reconnaissance (12+ weeks out), Strategic foundation (12
 * weeks), Competitive intelligence (8), Performance forecasting (4), Game plan
 * (2), Game plan confirmation (1) and the Debrief after it. The schedule is
 * worked out here and kept on the database (competition_milestones), where a
 * scheduled job claims each one on its day; the coach never presses a button
 * for it.
 *
 *  - Added late: only the milestone for where the athlete is now is done
 *    (today), with everything before it skipped. Its assessment uses the whole
 *    history, so nothing is lost by skipping.
 *  - Date moved later: anything not yet done follows the new date, and a done
 *    milestone that's now more than a week away is scheduled again (a game
 *    plan written for a meet that moved six weeks is redone, its first version
 *    kept as history).
 *  - Date moved earlier: the latest milestone now past is due today; the ones
 *    before it are skipped.
 *  - Cancelled: everything not done is skipped.
 */
import type { MilestoneKind } from "./types";

export type MilestoneDef = {
  kind: MilestoneKind;
  /** Days before the meet it's due (null: not counted from the meet). */
  daysOut: number | null;
  title: string;
  /** One line: what it's for. */
  purpose: string;
  /** Needs the coach's explicit approval before anything reaches the athlete. */
  approval: boolean;
};

export const MILESTONES: MilestoneDef[] = [
  {
    kind: "recon",
    daysOut: null,
    title: "Reconnaissance",
    purpose: "The meet, the athlete's history, early threats and what's missing",
    approval: false,
  },
  {
    kind: "foundation",
    daysOut: 84,
    title: "Strategic foundation",
    purpose: "Targets, projections, the bodyweight path and whether the program fits",
    approval: false,
  },
  {
    kind: "intel",
    daysOut: 56,
    title: "Competitive intelligence",
    purpose: "Competitors updated, progress against the plan, what should change",
    approval: false,
  },
  {
    kind: "forecast",
    daysOut: 28,
    title: "Performance forecasting",
    purpose: "Lift and total forecasts, preliminary attempts and the taper",
    approval: false,
  },
  {
    kind: "game_plan",
    daysOut: 14,
    title: "Game plan",
    purpose: "Attempts, warm-ups, the day's schedule and every contingency",
    approval: true,
  },
  {
    kind: "confirm",
    daysOut: 7,
    title: "Game plan confirmation",
    purpose: "The final read, what changed since the game plan, ready to release",
    approval: true,
  },
  {
    kind: "debrief",
    daysOut: null,
    title: "Debrief",
    purpose: "Projected against actual, what worked, what to change next time",
    approval: false,
  },
];

/** An interim update (a forecast that moved, a new concern): not on the schedule, written when it's needed. */
export const UPDATE_DEF: MilestoneDef = {
  kind: "update",
  daysOut: null,
  title: "Interim update",
  purpose: "Something meaningful changed between milestones",
  approval: false,
};

export const MILESTONE_BY_KIND: Record<MilestoneKind, MilestoneDef> = Object.fromEntries(
  [...MILESTONES, UPDATE_DEF].map((m) => [m.kind, m]),
) as Record<MilestoneKind, MilestoneDef>;

/** The countable milestones before the meet, earliest first. */
const BEFORE: MilestoneKind[] = [
  "recon",
  "foundation",
  "intel",
  "forecast",
  "game_plan",
  "confirm",
];
/** Recon only means something with more than 12 weeks to go. */
const RECON_AFTER = 84;

const DAY = 86_400_000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

export function dayNum(iso: string): number {
  return Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)) / DAY;
}
export function isoOf(n: number): string {
  return new Date(n * DAY).toISOString().slice(0, 10);
}
export function addDays(iso: string, n: number): string {
  return isoOf(dayNum(iso) + n);
}
export function daysBetween(from: string, to: string): number {
  return dayNum(to) - dayNum(from);
}

/** The phase the athlete is in, by days to the meet. */
export type Phase =
  | "reconnaissance"
  | "foundation"
  | "intel"
  | "forecast"
  | "game_plan"
  | "confirm"
  | "meet_day"
  | "post_meet";

export const PHASE_LABEL: Record<Phase, string> = {
  reconnaissance: "Reconnaissance",
  foundation: "Strategic foundation",
  intel: "Competitive intelligence",
  forecast: "Performance forecasting",
  game_plan: "Game plan development",
  confirm: "Game plan confirmation",
  meet_day: "Meet day",
  post_meet: "Post-meet",
};

export function phaseFor(daysOut: number, meetDays = 1): Phase {
  if (daysOut < -(meetDays - 1)) return "post_meet";
  if (daysOut <= 0) return "meet_day";
  if (daysOut <= 7) return "confirm";
  if (daysOut <= 14) return "game_plan";
  if (daysOut <= 28) return "forecast";
  if (daysOut <= 56) return "intel";
  if (daysOut <= 84) return "foundation";
  return "reconnaissance";
}

/** The milestone whose work the athlete's current phase is (the one a late addition starts on). */
export function currentMilestone(daysOut: number): MilestoneKind | null {
  if (daysOut <= 0) return null;
  if (daysOut <= 7) return "confirm";
  if (daysOut <= 14) return "game_plan";
  if (daysOut <= 28) return "forecast";
  if (daysOut <= 56) return "intel";
  if (daysOut <= 84) return "foundation";
  return "recon";
}

export type ExistingMilestone = {
  kind: MilestoneKind;
  status: MilestoneStatus;
  due_on: string;
  /** When its assessment was written (null while scheduled). */
  done_at?: string | null;
};

export type MilestoneStatus =
  | "scheduled"
  | "generating"
  | "waiting_ai"
  | "ready"
  | "failed"
  | "skipped";

export type MilestoneChange = {
  kind: MilestoneKind;
  due_on: string;
  status: "scheduled" | "skipped";
  /** Why, in a few words (kept on the audit log). */
  why: string;
};

/**
 * The schedule for a meet on `meetDate` as of `today`, against what's on file.
 * Returns only what should change (new rows and moved / skipped / re-opened
 * ones). Pure: the worker applies it.
 */
export function planMilestones(input: {
  meetDate: string | null;
  meetEndDate?: string | null;
  today: string;
  status: "upcoming" | "completed" | "cancelled" | "archived";
  existing: ExistingMilestone[];
  /** Results are in (entered or synced): the debrief can be written now. */
  hasResults?: boolean;
}): MilestoneChange[] {
  const { today, existing } = input;
  const byKind = new Map(existing.map((m) => [m.kind, m]));
  const out: MilestoneChange[] = [];
  const open = (m: ExistingMilestone | undefined) =>
    !m || m.status === "scheduled" || m.status === "failed" || m.status === "skipped";
  const done = (m: ExistingMilestone | undefined) =>
    !!m && (m.status === "ready" || m.status === "generating" || m.status === "waiting_ai");

  if (
    input.status === "cancelled" ||
    input.status === "archived" ||
    !input.meetDate ||
    !ISO.test(input.meetDate)
  ) {
    for (const m of existing) {
      if (m.status === "scheduled")
        out.push({
          kind: m.kind,
          due_on: m.due_on,
          status: "skipped",
          why: input.status === "cancelled" ? "Competition cancelled" : "No meet date",
        });
    }
    return out;
  }

  const meet = input.meetDate;
  const end =
    input.meetEndDate && ISO.test(input.meetEndDate) && input.meetEndDate >= meet
      ? input.meetEndDate
      : meet;
  const daysOut = daysBetween(today, meet);
  const current = currentMilestone(daysOut);
  const fresh = existing.filter((m) => BEFORE.includes(m.kind)).length === 0;

  const target = (kind: MilestoneKind): string | null => {
    const def = MILESTONE_BY_KIND[kind];
    if (def.daysOut != null) return addDays(meet, -def.daysOut);
    return null;
  };

  const set = (kind: MilestoneKind, due: string, status: "scheduled" | "skipped", why: string) => {
    const had = byKind.get(kind);
    if (had && had.due_on === due && had.status === status) return;
    out.push({ kind, due_on: due, status, why });
  };

  for (const kind of BEFORE) {
    const had = byKind.get(kind);
    if (kind === "recon") {
      // Recon only for a meet more than 12 weeks away when it's first added.
      if (!had && fresh && daysOut > RECON_AFTER)
        set("recon", today, "scheduled", "Added more than 12 weeks out");
      continue;
    }
    const due = target(kind)!;
    const past = due <= today;
    if (done(had)) {
      // A done milestone whose meet moved so it's now more than a week away is done again
      // (never one that's being written right now).
      if (had!.status === "ready" && daysBetween(today, due) > 7 && had!.due_on < due)
        set(kind, due, "scheduled", "Meet moved later: written again closer to the day");
      continue;
    }
    if (!past) {
      if (open(had))
        set(kind, due, "scheduled", had ? "Follows the meet date" : "Scheduled from the meet date");
      continue;
    }
    // Past its day and not done: only the milestone for the current phase is done now.
    if (kind === current)
      set(
        kind,
        today,
        "scheduled",
        fresh ? "Added partway through: the current phase's assessment is done now" : "Due now",
      );
    else if (!had || had.status === "scheduled")
      set(kind, due, "skipped", "Its phase had passed when it was due");
  }

  // The debrief: once the results are in, or two days after the last meet day.
  const debrief = byKind.get("debrief");
  if (!done(debrief)) {
    const due = input.hasResults ? (today >= meet ? today : addDays(end, 1)) : addDays(end, 2);
    if (open(debrief))
      set("debrief", due, "scheduled", input.hasResults ? "Results are in" : "After the meet");
  }

  // A meet already past with nothing before it done: nothing to schedule but the debrief.
  if (daysOut < 0) return out.filter((c) => c.kind === "debrief" || c.status === "skipped");
  return out;
}

/** "In 23 days", "Tomorrow", "Today", "3 days ago". */
export function countdownWords(daysOut: number): string {
  if (daysOut === 0) return "Today";
  if (daysOut === 1) return "Tomorrow";
  if (daysOut === -1) return "Yesterday";
  if (daysOut > 0) {
    if (daysOut >= 14) return `${Math.floor(daysOut / 7)} weeks · ${daysOut} days`;
    return `In ${daysOut} days`;
  }
  return `${-daysOut} days ago`;
}
