import { addDays, format } from "date-fns";
import { weekDisplayRange } from "@/lib/block-dates";
import { localStartOfToday, parseLocalDate } from "@/lib/today";

export type WorkoutItem = {
  day: any;
  week: any;
  block: any;
  completion: any;
  /** Count of logged sets for this day; >0 with no completion = in-progress. */
  logged_sets_count?: number;
  /**
   * Instance-level scheduling fields (Phase 2a canonical merge).
   *
   * When this item was emitted by the pl_scheduled_workouts merge, these
   * fields carry the instance identity. When the item is a legacy fallback
   * (a pl_days.scheduled_date row with no matching instance) or an
   * unscheduled placeholder, `scheduledWorkoutId` is null.
   */
  scheduledWorkoutId?: string | null;
  /** yyyy-mm-dd — canonical date from the instance, or legacy pl_days.scheduled_date. */
  scheduledDate?: string | null;
  scheduledTime?: string | null;
  scheduleOrderIndex?: number;
  scheduleSource?: "program" | "manual" | "moved" | "copied" | "legacy" | null;
};

export type TodayState =
  | { kind: "workout_today"; item: WorkoutItem }
  | { kind: "in_progress"; item: WorkoutItem }
  | { kind: "rest_day"; next?: WorkoutItem }
  | { kind: "upcoming"; item: WorkoutItem; whenLabel: string }
  | { kind: "missed"; item: WorkoutItem; whenLabel: string }
  | { kind: "block_complete"; block: any }
  | { kind: "no_program" };

const DAY_NAMES = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

const WEEKDAY_ALIASES: Record<string, string> = {
  sun: "Sunday", sunday: "Sunday",
  mon: "Monday", monday: "Monday",
  tue: "Tuesday", tues: "Tuesday", tuesday: "Tuesday",
  wed: "Wednesday", weds: "Wednesday", wednesday: "Wednesday",
  thu: "Thursday", thur: "Thursday", thurs: "Thursday", thursday: "Thursday",
  fri: "Friday", friday: "Friday",
  sat: "Saturday", saturday: "Saturday",
};

function normalizeWeekday(raw: unknown): string | null {
  const key = String(raw ?? "").trim().toLowerCase();
  return WEEKDAY_ALIASES[key] ?? null;
}

function normalizeWeekdays(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    const day = normalizeWeekday(value);
    if (day && !out.includes(day)) out.push(day);
  }
  return out;
}

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/**
 * Resolve the calendar date for a workout day.
 *
 * Priority:
 *   1. day.scheduled_date (explicit reschedule — always wins)
 *   2. week.training_days (coach set specific days during assignment)
 *   3. committedTrainingDays (client's committed schedule, e.g. Mon/Wed/Fri)
 *   4. Linear fallback (Day 1 = week start, Day 2 = +1 day, etc.)
 *
 * ROOT CAUSE FIX 2026-06-26: pl_weeks.training_days is null for most weeks
 * (only set when coach explicitly configures it). Without committedTrainingDays
 * as fallback, the function used linear distribution which ignores the client's
 * actual schedule, causing dots to appear on wrong calendar days.
 */
export function dayScheduledDate(
  item: WorkoutItem,
  committedTrainingDays?: string[] | null,
): Date | null {
  // 1) explicit scheduled_date on the day — always wins (manual reschedule)
  if (item.day?.scheduled_date) {
    const d = parseLocalDate(item.day.scheduled_date);
    if (d) return d;
  }
  // 2) derive from week range + day_index
  const range = item.block && item.week ? weekDisplayRange(item.block, item.week) : null;
  if (!range) return null;
  // Use week.training_days if set, otherwise fall back to committedTrainingDays
  const weekTrainingDays = normalizeWeekdays(item.week?.training_days);
  const trainingDays = weekTrainingDays.length > 0
    ? weekTrainingDays
    : normalizeWeekdays(committedTrainingDays);
  if (trainingDays.length > 0) {
    // Find the Nth training-day within the week range that matches day_index ordering.
    const days: Date[] = [];
    for (let i = 0; i < 7; i++) {
      const d = addDays(range.start, i);
      if (d > range.end) break;
      if (trainingDays.includes(DAY_NAMES[d.getDay()])) days.push(d);
    }
    const idx = Math.max(1, item.day?.day_index ?? 1) - 1;
    if (days[idx]) return parseLocalDate(days[idx]);
  }
  // 3) fallback: linear distribution across the week (no schedule configured)
  const idx = Math.max(1, item.day?.day_index ?? 1) - 1;
  return parseLocalDate(addDays(range.start, Math.min(6, idx)));
}

/**
 * Resolve calendar dates for every day in a single week, avoiding collisions.
 *
 * Manually pinned `scheduled_date` values always win. Remaining days (no
 * explicit date) are laid onto training-day slots inside the week range in
 * `day_index` order, skipping any slot already claimed by a pinned day so we
 * never lose a workout to a duplicate. When training-day slots are
 * exhausted, we fall through to any remaining day in the week range, and
 * finally to the last day of the range so nothing is dropped.
 *
 * ROOT CAUSE FIX 2026-07-03: previous per-day resolver could stack multiple
 * derived days onto the same weekday when a sibling day was pinned to a
 * training-day slot, causing calendar dots to disappear (e.g. Fionna's Sat
 * workout collapsed onto Fri because Day 4 was pinned to Fri and Day 3
 * derived to the same Fri slot).
 */
export function resolveWeekDayDates(
  days: any[],
  week: any,
  block: any,
  committedTrainingDays?: string[] | null,
): Map<string, Date> {
  const out = new Map<string, Date>();
  if (!Array.isArray(days) || days.length === 0) return out;
  const range = week && block ? weekDisplayRange(block, week) : null;

  // Sort by day_index so lower-indexed days claim earlier slots.
  const sorted = [...days].sort(
    (a, b) => (a?.day_index ?? 0) - (b?.day_index ?? 0),
  );

  const used = new Set<string>(); // ISO yyyy-mm-dd of taken dates in this week
  const dateKey = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  // Pass 1: explicit scheduled_date wins.
  for (const d of sorted) {
    if (!d?.id || !d?.scheduled_date) continue;
    const parsed = parseLocalDate(d.scheduled_date);
    if (!parsed) continue;
    out.set(d.id, parsed);
    used.add(dateKey(parsed));
  }

  if (!range) return out;

  // Build the week's ordered day list once.
  const weekDays: Date[] = [];
  for (let i = 0; i < 7; i++) {
    const d = addDays(range.start, i);
    if (d > range.end) break;
    weekDays.push(d);
  }

  const weekTrainingDays = normalizeWeekdays(week?.training_days);
  const trainingDays = weekTrainingDays.length > 0
    ? weekTrainingDays
    : normalizeWeekdays(committedTrainingDays);

  const trainingSlots = trainingDays.length > 0
    ? weekDays.filter((d) => trainingDays.includes(DAY_NAMES[d.getDay()]))
    : weekDays;

  // Pass 2: derived days claim the next unused training-day slot.
  for (const d of sorted) {
    if (!d?.id || out.has(d.id)) continue;
    let picked: Date | null = null;
    for (const slot of trainingSlots) {
      const k = dateKey(slot);
      if (used.has(k)) continue;
      picked = slot;
      used.add(k);
      break;
    }
    if (!picked) {
      // Fall back to any remaining day in the range.
      for (const slot of weekDays) {
        const k = dateKey(slot);
        if (used.has(k)) continue;
        picked = slot;
        used.add(k);
        break;
      }
    }
    // Last-resort: pin to the range end so the day still shows up.
    if (!picked) picked = weekDays[weekDays.length - 1] ?? range.end;
    const normalized = parseLocalDate(picked);
    if (normalized) out.set(d.id, normalized);
  }

  return out;
}

function isRestDayToday(restDays: string[] | null | undefined): boolean {
  const normalized = normalizeWeekdays(restDays);
  if (normalized.length === 0) return false;
  const today = localStartOfToday();
  return normalized.includes(DAY_NAMES[today.getDay()]);
}

function isTrainingDayToday(trainingDays: string[] | null | undefined): boolean {
  const normalized = normalizeWeekdays(trainingDays);
  if (normalized.length === 0) return false;
  const today = localStartOfToday();
  return normalized.includes(DAY_NAMES[today.getDay()]);
}

export function computeTodayState(
  items: WorkoutItem[],
  client: { preferred_rest_days?: string[] | null; preferred_training_days?: string[] | null } | null | undefined,
): TodayState {
  if (!items || items.length === 0) return { kind: "no_program" };
  const today = localStartOfToday();

  const undone = items.filter((it) => !it.completion?.completed_at);
  if (undone.length === 0) {
    const block = items[items.length - 1]?.block;
    return { kind: "block_complete", block };
  }

  // In-progress: has a completion row started but not finished
  const inProgress = undone.find((it) => it.completion && !it.completion?.completed_at);
  if (inProgress) {
    const sd = dayScheduledDate(inProgress);
    if (!sd || sd <= addDays(today, 1)) return { kind: "in_progress", item: inProgress };
  }

  // Today match
  const todayItem = undone.find((it) => {
    const sd = dayScheduledDate(it);
    return sd && isSameDay(sd, today);
  });
  if (todayItem) {
    if (todayItem.completion) return { kind: "in_progress", item: todayItem };
    return { kind: "workout_today", item: todayItem };
  }

  // The top "What do I do?" card should NEVER surface a workout that
  // already passed — past uncompleted days are visible in the calendar
  // and block view instead. From here on we only consider future or
  // today-scheduled undone workouts.
  const future = undone
    .map((it) => ({ it, sd: dayScheduledDate(it) }))
    .filter((x): x is { it: WorkoutItem; sd: Date } => !!x.sd && x.sd >= today)
    .sort((a, b) => a.sd.getTime() - b.sd.getTime());

  // No upcoming work left → treat as block complete so the hero card
  // surfaces "Nice work" rather than a stale past day.
  if (future.length === 0) {
    const block = items[items.length - 1]?.block;
    return { kind: "block_complete", block };
  }

  // Rest day if today is a rest day or not a training day at all
  if (isRestDayToday(client?.preferred_rest_days) ||
     (client?.preferred_training_days?.length && !isTrainingDayToday(client?.preferred_training_days))) {
    return { kind: "rest_day", next: future[0].it };
  }

  // Otherwise, upcoming next workout
  const next = future[0].it;
  const sd = future[0].sd;
  const diff = Math.round((sd.getTime() - today.getTime()) / 86400000);
  const whenLabel =
    diff <= 0 ? "Today"
    : diff === 1 ? "Tomorrow"
    : diff < 7 ? format(sd, "EEEE")
    : format(sd, "MMM d");
  return { kind: "upcoming", item: next, whenLabel };
}

export function dayDisplayTitle(item: WorkoutItem | undefined | null): string {
  if (!item) return "Workout";
  const d = item.day;
  return cleanDayTitle(d?.title, d?.day_index);
}

/**
 * Some day rows have a literal date baked into `title` (e.g. "Day 1 — Monday,
 * June 16"). When the block is rescheduled the baked-in date goes stale and
 * the UI shows the wrong weekday. Strip any "— Weekday, Month Day" suffix so
 * we only ever surface the meaningful part of the title; the real scheduled
 * date is rendered separately by the cards/lists.
 */
// Match either a full "— Weekday, Month Day[, Year]" suffix OR a bare
// "— Weekday" suffix. Day titles are sometimes saved with a baked-in
// weekday name (e.g. "Day 1 — Monday") that goes stale as soon as the
// client commits to a different training schedule (Tue/Fri/Sun, etc.).
// We always strip the weekday so the only source of truth for the day's
// actual date is `scheduled_date`, which the cards render separately.
const STALE_DATE_RE =
  /\s*[—–-]\s*(?:Sun|Mon|Tue(?:s)?|Wed(?:nes)?|Thu(?:rs?)?|Fri|Sat(?:ur)?)(?:day)?(?:[.,]?\s+(?:Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:t(?:ember)?)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+\d{1,2}(?:st|nd|rd|th)?(?:,\s*\d{2,4})?)?(?=\s*(?:[—–-]|$))/gi;

export function cleanDayTitle(
  raw: string | null | undefined,
  dayIndex?: number | null,
): string {
  const fallback = dayIndex != null ? `Day ${dayIndex}` : "Workout";
  const s = (raw ?? "").trim();
  if (!s) return fallback;
  const cleaned = s
    .replace(STALE_DATE_RE, "")
    .replace(/\s*[—–-]\s*[—–-]\s*/g, " — ")
    .replace(/\s*[—–-]\s*$/, "")
    .replace(/\s{2,}/g, " ")
    .trim();
  return cleaned || fallback;
}

export function dayDurationLabel(item: WorkoutItem | undefined | null): string | null {
  if (!item?.day) return null;
  const min = item.day.duration_override_min ?? item.day.duration_estimate_min ?? null;
  if (!min) return null;
  const low = Math.max(5, Math.round((min * 0.9) / 5) * 5);
  const high = Math.round((min * 1.1) / 5) * 5;
  return low === high ? `${min} min` : `${low}–${high} min`;
}

/** Display-only week status (collapse "Manually Completed" → "Completed", add "Locked" support). */
export function displayWeekStatus(status: string | null | undefined): "Not Started" | "In Progress" | "Completed" | "Locked" {
  if (status === "Completed" || status === "Manually Completed") return "Completed";
  if (status === "In Progress") return "In Progress";
  if (status === "Locked") return "Locked";
  return "Not Started";
}

export function weekStatusTone(s: "Not Started" | "In Progress" | "Completed" | "Locked"): string {
  switch (s) {
    case "Completed": return "border-emerald-500/40 bg-emerald-500/10 text-emerald-500";
    case "In Progress": return "border-amber-500/40 bg-amber-500/10 text-amber-500";
    case "Locked": return "border-muted-foreground/20 bg-muted/20 text-muted-foreground/70";
    default: return "border-muted-foreground/30 bg-muted/30 text-muted-foreground";
  }
}

/** A week is "locked" (from the client's POV) when its date range is fully in the future. */
export function isWeekLocked(block: any, week: any): boolean {
  // Locking disabled — clients can view and open any week/day.
  void block; void week;
  return false;
}