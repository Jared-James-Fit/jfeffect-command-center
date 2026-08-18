/**
 * Reusable Program Upload / Assignment availability guardrail.
 *
 * Single source of truth for the rule:
 *   "A program should never be assigned with an unclear or incompatible
 *    workout-day schedule."
 *
 * Pure logic only — no I/O — so every assignment pathway (planner, quick
 * assign, template → client, duplicated/imported programs) can reuse it and
 * every branch is unit-testable.
 */
import type { Weekday } from "@/lib/program-planner/types";

export const GUARD_WEEKDAYS: Weekday[] = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

export const GUARD_WEEKDAY_LABEL: Record<Weekday, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
};

export const GUARD_WEEKDAY_SHORT: Record<Weekday, string> = {
  mon: "Mon", tue: "Tue", wed: "Wed", thu: "Thu", fri: "Fri", sat: "Sat", sun: "Sun",
};

/** Long ("Monday") or short ("mon") weekday strings → canonical Weekday list, week-ordered, de-duped. */
export function normalizeWeekdays(input: unknown): Weekday[] {
  if (!Array.isArray(input)) return [];
  const map: Record<string, Weekday> = {
    mon: "mon", tue: "tue", wed: "wed", thu: "thu", fri: "fri", sat: "sat", sun: "sun",
    monday: "mon", tuesday: "tue", wednesday: "wed", thursday: "thu",
    friday: "fri", saturday: "sat", sunday: "sun",
  };
  const found = new Set<Weekday>();
  for (const raw of input) {
    const v = map[String(raw ?? "").trim().toLowerCase()];
    if (v) found.add(v);
  }
  return GUARD_WEEKDAYS.filter((d) => found.has(d));
}

export type AvailabilitySource = "committed" | "available" | "preferred" | "none";

export interface ResolvedAvailability {
  days: Weekday[];
  source: AvailabilitySource;
}

/**
 * Canonical client availability resolution: committed → available →
 * preferred, always minus explicitly unavailable days.
 */
export function resolveClientAvailability(client: {
  committed_training_days?: unknown;
  available_training_days?: unknown;
  preferred_training_days?: unknown;
  unavailable_training_days?: unknown;
} | null | undefined): ResolvedAvailability {
  const unavailable = new Set(normalizeWeekdays(client?.unavailable_training_days));
  const pick = (xs: unknown) => normalizeWeekdays(xs).filter((d) => !unavailable.has(d));
  const committed = pick(client?.committed_training_days);
  if (committed.length) return { days: committed, source: "committed" };
  const available = pick(client?.available_training_days);
  if (available.length) return { days: available, source: "available" };
  const preferred = pick(client?.preferred_training_days);
  if (preferred.length) return { days: preferred, source: "preferred" };
  return { days: [], source: "none" };
}

export const AVAILABILITY_SOURCE_LABEL: Record<AvailabilitySource, string> = {
  committed: "Committed training days",
  available: "Selected availability",
  preferred: "Client onboarding preferences",
  none: "No saved training days",
};

/* ---------------- Program frequency detection ---------------- */

export interface WeekFrequency {
  /** Stable label, e.g. "Block 1 · Week 2". */
  label: string;
  workouts: number;
}

export interface ProgramFrequency {
  perWeek: WeekFrequency[];
  /** Highest workouts-per-week across all programmed weeks. */
  max: number;
  /** Lowest workouts-per-week across all programmed weeks (ignoring empty weeks). */
  min: number;
  /** True when weeks require different numbers of training days. */
  variable: boolean;
}

export function summarizeFrequency(perWeek: WeekFrequency[]): ProgramFrequency {
  const counts = perWeek.map((w) => w.workouts).filter((n) => n > 0);
  const max = counts.length ? Math.max(...counts) : 0;
  const min = counts.length ? Math.min(...counts) : 0;
  return { perWeek, max, min, variable: counts.length > 1 && max !== min };
}

/**
 * Frequency from planner placements — the canonical structure (actual unique
 * programmed workout days per week), never exercise counts or metadata.
 */
export function frequencyFromPlacements(
  placements: Array<{ blockKey: string; weekIndex: number; dayIndex?: number; dayKey?: string }>,
): ProgramFrequency {
  const perWeek = new Map<string, Set<string | number>>();
  for (const p of placements) {
    const key = `${p.blockKey}::w${p.weekIndex}`;
    const set = perWeek.get(key) ?? new Set<string | number>();
    set.add(p.dayKey ?? p.dayIndex ?? set.size);
    perWeek.set(key, set);
  }
  const rows: WeekFrequency[] = [...perWeek.entries()].map(([key, set], i) => ({
    label: `Week ${i + 1}`,
    workouts: set.size,
    ...(key ? {} : {}),
  }));
  return summarizeFrequency(rows);
}

/** Frequency from a normalized template payload's active blocks. */
export function frequencyFromTemplateBlocks(
  blocks: Array<{ name?: string | null; weeks?: Array<{ days?: unknown[]; workout_days?: unknown[] }> }>,
): ProgramFrequency {
  const rows: WeekFrequency[] = [];
  for (const b of blocks ?? []) {
    (b.weeks ?? []).forEach((w, wi) => {
      const days = Array.isArray((w as any)?.days)
        ? (w as any).days
        : Array.isArray((w as any)?.workout_days)
        ? (w as any).workout_days
        : [];
      rows.push({ label: `${b.name ?? "Block"} · Week ${wi + 1}`, workouts: days.length });
    });
  }
  return summarizeFrequency(rows);
}

/* ---------------- Guard evaluation ---------------- */

export type GuardStatus =
  | "ok"                    // frequency === selected days
  | "no_program"            // nothing to schedule yet
  | "missing_availability"  // client has no saved training days
  | "too_few_days"          // program needs more days than client has → blocked
  | "extra_days";           // client has more days than the program needs → pick exact days

export interface GuardResult {
  status: GuardStatus;
  /** Training days required per week (max across weeks). */
  requiredDays: number;
  /** Days currently selected/available for scheduling. */
  selectedDays: Weekday[];
  availability: ResolvedAvailability;
  frequency: ProgramFrequency;
  /** True when the coach must not proceed on the normal path. */
  blocking: boolean;
  /** Variable-frequency programs need explicit acknowledgement. */
  variableFrequency: boolean;
  title: string;
  message: string;
}

export function evaluateAvailabilityGuard(args: {
  frequency: ProgramFrequency;
  availability: ResolvedAvailability;
  /** Days the coach has explicitly chosen for this assignment (overrides availability count check). */
  selectedDays?: Weekday[];
  clientName?: string | null;
}): GuardResult {
  const { frequency, availability } = args;
  const clientName = args.clientName?.trim() || "This client";
  const selectedDays = args.selectedDays?.length ? args.selectedDays : availability.days;
  const requiredDays = frequency.max;

  const base = {
    requiredDays,
    selectedDays,
    availability,
    frequency,
    variableFrequency: frequency.variable,
  };

  if (requiredDays === 0) {
    return {
      ...base, status: "no_program", blocking: false,
      title: "Nothing to schedule",
      message: "This assignment has no programmed workouts yet.",
    };
  }

  if (availability.days.length === 0 && !args.selectedDays?.length) {
    return {
      ...base, status: "missing_availability", blocking: true,
      title: "Set Training Availability First",
      message: `This program requires ${requiredDays} training day${requiredDays === 1 ? "" : "s"} per week. Select the days the client can train so JF Effect can schedule it correctly.`,
    };
  }

  if (selectedDays.length < requiredDays) {
    return {
      ...base, status: "too_few_days", blocking: true,
      title: "Training Days Don’t Match",
      message: `This program has ${requiredDays} workouts per week, but ${clientName} is currently available for ${selectedDays.length} training day${selectedDays.length === 1 ? "" : "s"}.`,
    };
  }

  if (selectedDays.length > requiredDays) {
    return {
      ...base, status: "extra_days", blocking: true,
      title: "Choose Scheduled Days",
      message: `This program requires ${requiredDays} training day${requiredDays === 1 ? "" : "s"}. Select which ${requiredDays} of ${clientName}'s ${selectedDays.length} available days should be used.`,
    };
  }

  return {
    ...base, status: "ok", blocking: false,
    title: "Weekly Schedule",
    message: `${requiredDays} workout${requiredDays === 1 ? "" : "s"} per week mapped to ${requiredDays} training day${requiredDays === 1 ? "" : "s"}.`,
  };
}

/** Chronologically map workout titles onto the chosen weekdays (order preserved). */
export function buildWeeklyPreview(
  workoutTitles: string[],
  days: Weekday[],
): Array<{ weekday: Weekday; label: string; title: string }> {
  return workoutTitles.slice(0, days.length).map((title, i) => ({
    weekday: days[i]!,
    label: GUARD_WEEKDAY_LABEL[days[i]!],
    title,
  }));
}
