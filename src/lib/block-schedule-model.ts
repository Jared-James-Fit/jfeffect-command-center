/**
 * CANONICAL CLIENT BLOCK SCHEDULE MODEL
 * =====================================
 *
 * Root cause this module fixes: the Training Program page derived "current"
 * and "previous" blocks from two different rules. `pl_blocks.status` is a free
 * text column maintained by several flows (template assignment, manual edits,
 * mark-complete), so a block whose `end_date` passed months ago could still
 * read `status = "Active"`. The page's own grouping used dates, which is why
 * "Current Blocks: No active blocks" could render directly above a "Previous
 * Blocks" card badged "Active".
 *
 * Canonical rule, single source of truth:
 *
 *   PROGRAM (pl_preps)       — what the client is training toward
 *   BLOCK   (pl_blocks)      — a dated phase of that program
 *   SCHEDULED WORKOUT        — the actual calendar date (pl_scheduled_workouts)
 *   COMPLETION               — what actually happened (never rewritten)
 *
 * A block's status is derived from its DATES first and its status column only
 * as a tiebreaker / explicit terminal flag. Exactly one block can be Active.
 *
 * "Ended early" needs no schema change: a block is ended early when its stored
 * `end_date` is before the end its own length implies (start + weeks *
 * week_duration_days - 1). The implied date is the audit trail of the original
 * scheduled end.
 */
import { addDays, format } from "date-fns";
import { parseLocalDate } from "@/lib/today";

export type ScheduleBlockStatus =
  | "Active"
  | "Upcoming"
  | "Draft"
  | "Completed"
  | "EndedEarly"
  | "Archived";

export type ScheduleBlockInput = {
  id: string;
  name?: string | null;
  prep_id?: string | null;
  status?: string | null;
  archived?: boolean | null;
  completed_at?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  weeks?: number | null;
  week_duration_days?: number | null;
  sort_order?: number | null;
  created_at?: string | null;
};

export type ScheduleBlock = ScheduleBlockInput & {
  status_derived: ScheduleBlockStatus;
  /** end implied by start + length, i.e. the ORIGINAL scheduled end. */
  original_end: string | null;
  /** the end actually in effect (stored end_date, else implied). */
  effective_end: string | null;
  /** 1-based week the client is in today, when active. */
  week_of: number | null;
  total_weeks: number | null;
};

export const STATUS_LABEL: Record<ScheduleBlockStatus, string> = {
  Active: "Active",
  Upcoming: "Upcoming",
  Draft: "Draft",
  Completed: "Completed",
  EndedEarly: "Ended early",
  Archived: "Archived",
};

export function todayISO(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function addDaysISO(iso: string, days: number): string {
  const d = parseLocalDate(iso);
  if (!d) return iso;
  return format(addDays(d, days), "yyyy-MM-dd");
}

/** End date implied by the block's own length. Null when start/length unknown. */
export function impliedEnd(b: ScheduleBlockInput): string | null {
  if (!b.start_date) return null;
  const weeks = Number(b.weeks ?? 0);
  if (!weeks) return null;
  const dur = Number(b.week_duration_days ?? 7) || 7;
  return addDaysISO(b.start_date, weeks * dur - 1);
}

export function effectiveEnd(b: ScheduleBlockInput): string | null {
  return b.end_date ?? impliedEnd(b);
}

/** A block whose stored end is earlier than its own length implies. */
export function isEndedEarly(b: ScheduleBlockInput): boolean {
  const implied = impliedEnd(b);
  const stored = b.end_date ?? null;
  return !!implied && !!stored && stored < implied;
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = parseLocalDate(fromISO);
  const b = parseLocalDate(toISO);
  if (!a || !b) return 0;
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

/** Which 1-based week of the block `today` falls in (null when outside). */
export function weekOf(b: ScheduleBlockInput, today: string): number | null {
  if (!b.start_date) return null;
  const dur = Number(b.week_duration_days ?? 7) || 7;
  const offset = daysBetween(b.start_date, today);
  if (offset < 0) return null;
  const wk = Math.floor(offset / dur) + 1;
  const total = Number(b.weeks ?? 0);
  if (total && wk > total) return null;
  return wk;
}

function terminalStatus(b: ScheduleBlockInput): ScheduleBlockStatus | null {
  if (b.archived || b.status === "Archived") return "Archived";
  if (b.status === "Completed" || b.completed_at) {
    return isEndedEarly(b) ? "EndedEarly" : "Completed";
  }
  return null;
}

function orderKey(b: ScheduleBlockInput, i: number): [number, string, string] {
  const so = Number(b.sort_order);
  return [
    b.start_date ? 0 : 1,
    b.start_date ?? "",
    `${Number.isFinite(so) ? String(so).padStart(6, "0") : String(i).padStart(6, "0")}|${b.created_at ?? ""}`,
  ];
}

/**
 * Derive one canonical status per block. Dates win over the status column:
 * a block whose effective end is in the past is finished no matter what the
 * column says, which is exactly the contradiction this replaces.
 */
export function deriveSchedule(
  blocks: ScheduleBlockInput[],
  today: string = todayISO(),
): ScheduleBlock[] {
  const ordered = (blocks ?? [])
    .filter(Boolean)
    .map((b, i) => ({ b, k: orderKey(b, i) }))
    .sort((x, y) =>
      x.k[0] - y.k[0] ||
      x.k[1].localeCompare(y.k[1]) ||
      x.k[2].localeCompare(y.k[2]),
    )
    .map((e) => e.b);

  // Pass 1 — provisional status from terminal flags + dates.
  const provisional = ordered.map((b) => {
    const term = terminalStatus(b);
    const end = effectiveEnd(b);
    let status: ScheduleBlockStatus;
    if (term) {
      status = term;
    } else if (!b.start_date) {
      status = "Draft";
    } else if (b.start_date > today) {
      status = "Upcoming";
    } else if (end && end < today) {
      // Past its end but never explicitly closed off. It is history, and it
      // is "ended early" only when the coach shortened it.
      status = isEndedEarly(b) ? "EndedEarly" : "Completed";
    } else {
      status = "Active";
    }
    return { b, status };
  });

  // Pass 2 — exactly one Active. When several blocks cover today (overlapping
  // assignments), the latest-starting one wins: that is the phase the coach
  // most recently put the client into.
  const actives = provisional.filter((p) => p.status === "Active");
  if (actives.length > 1) {
    const winner = actives[actives.length - 1];
    for (const p of actives) if (p !== winner) p.status = "Completed";
  }

  return provisional.map(({ b, status }) => ({
    ...b,
    status_derived: status,
    original_end: impliedEnd(b),
    effective_end: effectiveEnd(b),
    week_of: status === "Active" ? weekOf(b, today) : null,
    total_weeks: b.weeks ?? null,
  }));
}

export function currentBlock(list: ScheduleBlock[]): ScheduleBlock | null {
  return list.find((b) => b.status_derived === "Active") ?? null;
}

export function upcomingBlocks(list: ScheduleBlock[]): ScheduleBlock[] {
  return list.filter((b) => b.status_derived === "Upcoming");
}

export function draftBlocks(list: ScheduleBlock[]): ScheduleBlock[] {
  return list.filter((b) => b.status_derived === "Draft");
}

/** History = everything finished or archived. Never rendered as Active. */
export function historyBlocks(list: ScheduleBlock[]): ScheduleBlock[] {
  return list
    .filter((b) =>
      b.status_derived === "Completed" ||
      b.status_derived === "EndedEarly" ||
      b.status_derived === "Archived",
    )
    .slice()
    .reverse();
}

export type BlockOverlap = { a: ScheduleBlock; b: ScheduleBlock };

/** Overlaps among live (non-history) blocks only. */
export function findOverlaps(list: ScheduleBlock[]): BlockOverlap[] {
  const live = list.filter(
    (b) =>
      (b.status_derived === "Active" || b.status_derived === "Upcoming") &&
      b.start_date,
  );
  const out: BlockOverlap[] = [];
  for (let i = 0; i < live.length; i++) {
    for (let j = i + 1; j < live.length; j++) {
      const a = live[i];
      const b = live[j];
      const aEnd = a.effective_end ?? a.start_date!;
      const bEnd = b.effective_end ?? b.start_date!;
      if (a.start_date! <= bEnd && b.start_date! <= aEnd) out.push({ a, b });
    }
  }
  return out;
}

/** Informational training gap in days between one block ending and the next starting. */
export function gapDays(prevEnd: string | null, nextStart: string | null): number {
  if (!prevEnd || !nextStart) return 0;
  const d = daysBetween(prevEnd, nextStart) - 1;
  return d > 0 ? d : 0;
}

/** Suggested start for the next block: the day after the current one ends. */
export function suggestedNextStart(
  current: ScheduleBlock | null,
  today: string = todayISO(),
): string {
  const end = current?.effective_end ?? null;
  if (!end) return today;
  const next = addDaysISO(end, 1);
  return next > today ? next : today;
}

export type ScheduledInstance = {
  id: string;
  scheduled_date: string;
  completed?: boolean;
};

/**
 * Which scheduled instances an early end would take off the active calendar.
 *
 * NON-NEGOTIABLE: completed workouts are never touched, and nothing on or
 * before the new end date is touched. Only future, uncompleted instances are
 * unscheduled — their program definition (pl_days) stays intact, so the block
 * can be re-extended later.
 */
export function instancesAffectedByEarlyEnd(
  instances: ScheduledInstance[],
  newEnd: string,
): ScheduledInstance[] {
  return (instances ?? []).filter(
    (i) => !!i?.scheduled_date && i.scheduled_date > newEnd && !i.completed,
  );
}

/** Completed instances past the new end — preserved, reported for transparency. */
export function completedPastNewEnd(
  instances: ScheduledInstance[],
  newEnd: string,
): ScheduledInstance[] {
  return (instances ?? []).filter(
    (i) => !!i?.scheduled_date && i.scheduled_date > newEnd && !!i.completed,
  );
}

export function formatRange(start?: string | null, end?: string | null): string {
  const s = parseLocalDate(start ?? null);
  const e = parseLocalDate(end ?? null);
  if (!s && !e) return "No dates set";
  if (s && !e) return `${format(s, "MMM d, yyyy")} → no end date`;
  if (!s && e) return `→ ${format(e, "MMM d, yyyy")}`;
  const sameYear = s!.getFullYear() === e!.getFullYear();
  return `${format(s!, "MMM d")} – ${format(e!, sameYear ? "MMM d, yyyy" : "MMM d, yyyy")}`;
}

export function durationLabel(b: ScheduleBlockInput): string | null {
  const start = b.start_date ?? null;
  const end = effectiveEnd(b);
  if (!start || !end) return b.weeks ? `${b.weeks} weeks` : null;
  const days = daysBetween(start, end) + 1;
  const dur = Number(b.week_duration_days ?? 7) || 7;
  const wks = days / dur;
  if (Number.isInteger(wks)) return `${wks} week${wks === 1 ? "" : "s"}`;
  return `${days} days`;
}
