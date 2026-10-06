import { addDays, format, parseISO } from "date-fns";
import { WEEK_DAYS, type WeekDay } from "@/lib/training-schedule";

// ───────────────────────────────────────────────────────────────────────────
// Pure planner for "client changed their committed training days → move every
// FUTURE, unstarted workout onto the new days". No I/O here so the rules can
// be unit tested; schedule-bulk.functions.ts loads the data and applies moves.
//
// Rules (unchanged from the original in-line implementation):
//   • workouts in the past, or with a started/in-progress/completed record,
//     are never moved and still consume their ordinal committed-day slot
//   • canonical placement is the scheduled-workout instance, then pl_days
//   • coach-locked / manually pinned days only move when includePinned and
//     the actor may override the lock
//   • idempotent: re-running with the same committed days produces no moves
// ───────────────────────────────────────────────────────────────────────────

export const WEEKDAY_INDEX: Record<WeekDay, number> = {
  Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4,
  Friday: 5, Saturday: 6, Sunday: 0,
};

export type RealignRole = "client" | "member" | "coach" | "admin";

export interface RealignBlock {
  id: string;
  start_date: string | null;
  week_duration_days?: number | null;
}
export interface RealignWeek { id: string; week_index: number | null; block_id: string }
export interface RealignDay {
  id: string;
  day_index: number | null;
  week_id: string;
  scheduled_date: string | null;
  schedule_source: string | null;
  schedule_locked: boolean | null;
}
export interface RealignInstance {
  id: string;
  source_day_id: string;
  scheduled_date: string;
  schedule_source: string | null;
}
export interface RealignMove {
  dayId: string;
  prev: string | null;
  next: string;
  prevSource: string | null;
  wasPinned: boolean;
}
export interface RealignPlan {
  moves: RealignMove[];
  /** Upcoming pinned workouts left alone that are not on a committed day. */
  pendingPinned: number;
  /**
   * Upcoming movable workouts that could not be placed because a week has more
   * workouts than committed days. They keep their old date.
   */
  unplaced: number;
}

/**
 * Client columns owned by the Committed Training Schedule flow
 * (saveCommittedSchedule). Generic "save the whole client row" forms must not
 * write these back: a stale form copy would silently undo a schedule change
 * the client just made, with no realign of their workouts.
 */
export const SCHEDULE_OWNED_CLIENT_FIELDS = [
  "committed_training_days",
  "committed_training_frequency",
  "training_schedule_completed",
  "training_schedule_last_updated",
  "training_schedule_updated_by",
  "schedule_locked",
] as const;

export function omitScheduleFields<T extends Record<string, any>>(row: T): Partial<T> {
  const out: Record<string, any> = { ...row };
  for (const k of SCHEDULE_OWNED_CLIENT_FIELDS) delete out[k];
  return out as Partial<T>;
}

/** Keep only valid, de-duplicated long weekday names, in calendar order. */
export function normalizeCommittedDays(days: readonly string[] | null | undefined): WeekDay[] {
  const set = new Set(days ?? []);
  return WEEK_DAYS.filter((d) => set.has(d));
}

/** Today's date (yyyy-MM-dd) in the client's timezone; server date if unknown. */
export function todayInTimeZone(timeZone?: string | null, now: Date = new Date()): string {
  if (timeZone) {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      }).format(now);
    } catch {
      /* invalid tz → fall through */
    }
  }
  return format(now, "yyyy-MM-dd");
}

export function planCommittedRealign(input: {
  committed: readonly WeekDay[];
  blocks: readonly RealignBlock[];
  weeks: readonly RealignWeek[];
  days: readonly RealignDay[];
  instances: readonly RealignInstance[];
  touchedDayIds: ReadonlySet<string>;
  todayISO: string;
  role: RealignRole;
  includePinned: boolean;
}): RealignPlan {
  const { committed, todayISO, role, includePinned, touchedDayIds } = input;
  const moves: RealignMove[] = [];
  let pendingPinned = 0;
  let unplaced = 0;
  if (committed.length === 0) return { moves, pendingPinned, unplaced };

  // Earliest instance per day is the canonical placement.
  const instanceByDayId = new Map<string, RealignInstance>();
  for (const r of input.instances) {
    const prev = instanceByDayId.get(r.source_day_id);
    if (!prev || r.scheduled_date < prev.scheduled_date) instanceByDayId.set(r.source_day_id, r);
  }

  const daysByWeek = new Map<string, RealignDay[]>();
  for (const d of input.days) {
    const list = daysByWeek.get(d.week_id) ?? [];
    list.push(d);
    daysByWeek.set(d.week_id, list);
  }

  const committedSet = new Set<number>(committed.map((wd) => WEEKDAY_INDEX[wd]));

  for (const block of input.blocks) {
    if (!block.start_date) continue;
    const dur = block.week_duration_days ?? 7;
    const startDate = parseISO(block.start_date);
    const blockWeeks = input.weeks
      .filter((w) => w.block_id === block.id)
      .sort((a, b) => (a.week_index ?? 0) - (b.week_index ?? 0));

    for (const w of blockWeeks) {
      const weekStart = addDays(startDate, Math.max(0, (w.week_index ?? 1) - 1) * dur);
      const weekEndISO = format(addDays(weekStart, 6), "yyyy-MM-dd");
      if (weekEndISO < todayISO) continue; // past week

      const weekDays = (daysByWeek.get(w.id) ?? [])
        .slice()
        .sort((a, b) => (a.day_index ?? 0) - (b.day_index ?? 0));

      // Walk the 7 dates in this week window and keep the ones that fall on a
      // committed weekday. Scanning (instead of offsetting from Monday) keeps
      // this correct for blocks that start mid-week.
      const committedDates: string[] = [];
      for (let i = 0; i < 7; i++) {
        const dt = addDays(weekStart, i);
        if (committedSet.has(dt.getDay())) committedDates.push(format(dt, "yyyy-MM-dd"));
      }

      // Classify days using the CANONICAL date/source: instance first,
      // pl_days fallback second. Day order still maps to committed-day order
      // so a completed Day 1 keeps the Day 1 slot consumed even if it was
      // completed on an older weekday.
      const consumed = new Set<string>();
      const movable: Array<{
        row: RealignDay;
        pinned: boolean;
        effectiveDate: string | null;
        effectiveSource: string | null;
      }> = [];
      for (let dayPos = 0; dayPos < weekDays.length; dayPos++) {
        const d = weekDays[dayPos];
        const inst = instanceByDayId.get(d.id);
        const effectiveDate = inst?.scheduled_date ?? d.scheduled_date ?? null;
        const effectiveSource = inst?.schedule_source ?? d.schedule_source ?? null;
        const isCoachLocked = !!d.schedule_locked;
        const isManual = effectiveSource === "manual";
        const isPinned = isCoachLocked || isManual;
        const canOverridePinned =
          includePinned && (role === "coach" || role === "admin" || !isCoachLocked);
        const isTouched = touchedDayIds.has(d.id);
        const isPast = !!effectiveDate && effectiveDate < todayISO;
        const ordinalTarget = committedDates[dayPos] ?? null;

        // Started / completed / past workouts are never moved. Reserve their
        // intended committed-day slot too, so a completed Friday Day 1 does
        // not cause Day 2 to slide from Sunday onto Saturday.
        if (isTouched || isPast) {
          if (effectiveDate) consumed.add(effectiveDate);
          if (ordinalTarget) consumed.add(ordinalTarget);
          continue;
        }

        if (isPinned && !canOverridePinned) {
          if (effectiveDate) consumed.add(effectiveDate);
          if (ordinalTarget) consumed.add(ordinalTarget);
          if (!effectiveDate || !committedDates.includes(effectiveDate)) pendingPinned++;
          continue;
        }

        movable.push({ row: d, pinned: isPinned, effectiveDate, effectiveSource });
      }

      const pool = committedDates.filter((dt) => !consumed.has(dt) && dt >= todayISO);
      let cursor = 0;
      for (const m of movable) {
        if (cursor >= pool.length) {
          // More workouts than free committed days this week. Don't silently
          // drop it: report any that is still off the committed schedule.
          if (!m.effectiveDate || !committedDates.includes(m.effectiveDate)) unplaced++;
          continue;
        }
        const next = pool[cursor++];
        if (m.effectiveDate === next) continue;
        moves.push({
          dayId: m.row.id,
          prev: m.effectiveDate,
          next,
          prevSource: m.effectiveSource,
          wasPinned: m.pinned,
        });
      }
    }
  }

  return { moves, pendingPinned, unplaced };
}
