/**
 * Powerlifting Exposure Analytics
 *
 * An "exposure" is one training event of a competition lift family
 * (squat / bench / deadlift) at a given priority role on a given day.
 * Top sets and backoffs on the SAME day share ONE exposure — they are
 * two prescriptions of the same session, not two separate exposures.
 *
 * Group key: (day_id, movement_family, purpose_label).
 */

export type LiftFamily = "squat" | "bench" | "deadlift";
export type Role = "Primary" | "Secondary" | "Tertiary" | "Quaternary";

const ROLE_SET: readonly Role[] = ["Primary", "Secondary", "Tertiary", "Quaternary"] as const;
const FAMILY_SET: readonly LiftFamily[] = ["squat", "bench", "deadlift"] as const;

export interface PlExposure {
  weekIndex: number;
  dayIndex: number;
  dayId: string;
  family: LiftFamily;
  role: Role;
  scheduledDate: string | null;
  completed: boolean;
  rowIds: string[];
}

export interface ExposureRow {
  id: string;
  day_id: string;
  purpose_label: string | null;
  movement_family: string | null;
  sort_order: number;
}

export interface ExposureDay {
  id: string;
  day_index: number;
  week_index: number;
  scheduled_date: string | null;
}

export interface ExposureCompletion {
  day_id: string;
  completed_at: string | null;
}

function isRole(x: string | null | undefined): x is Role {
  return !!x && (ROLE_SET as readonly string[]).includes(x);
}
function isFamily(x: string | null | undefined): x is LiftFamily {
  return !!x && (FAMILY_SET as readonly string[]).includes(x.toLowerCase());
}

/** Build exposures grouped by (day_id, family, role). */
export function buildExposures(
  rows: ExposureRow[],
  days: ExposureDay[],
  completions: ExposureCompletion[],
  dateRange: { start: Date; end: Date },
): PlExposure[] {
  const dayById = new Map(days.map((d) => [d.id, d]));
  const completedByDay = new Set(
    completions.filter((c) => c.completed_at != null).map((c) => c.day_id),
  );
  const startMs = dateRange.start.getTime();
  const endMs = dateRange.end.getTime();

  const grouped = new Map<string, PlExposure>();
  for (const r of rows) {
    if (!isRole(r.purpose_label) || !isFamily(r.movement_family)) continue;
    const day = dayById.get(r.day_id);
    if (!day) continue;
    // Date filter: use scheduled_date if present, otherwise include (unscheduled rows still count).
    if (day.scheduled_date) {
      const t = new Date(day.scheduled_date).getTime();
      if (isFinite(t) && (t < startMs || t > endMs)) continue;
    }
    const family = r.movement_family!.toLowerCase() as LiftFamily;
    const role = r.purpose_label as Role;
    const key = `${day.id}|${family}|${role}`;
    const existing = grouped.get(key);
    if (existing) {
      existing.rowIds.push(r.id);
    } else {
      grouped.set(key, {
        weekIndex: day.week_index,
        dayIndex: day.day_index,
        dayId: day.id,
        family,
        role,
        scheduledDate: day.scheduled_date,
        completed: completedByDay.has(day.id),
        rowIds: [r.id],
      });
    }
  }
  return [...grouped.values()].sort((a, b) => {
    if (a.weekIndex !== b.weekIndex) return a.weekIndex - b.weekIndex;
    if (a.dayIndex !== b.dayIndex) return a.dayIndex - b.dayIndex;
    return a.family.localeCompare(b.family);
  });
}

export type ExposureStats = Record<
  LiftFamily,
  {
    planned: number;
    completed: number;
    byRole: Record<Role, { planned: number; completed: number }>;
  }
>;

export function exposureStats(exposures: PlExposure[]): ExposureStats {
  const base = (): ExposureStats[LiftFamily] => ({
    planned: 0,
    completed: 0,
    byRole: {
      Primary: { planned: 0, completed: 0 },
      Secondary: { planned: 0, completed: 0 },
      Tertiary: { planned: 0, completed: 0 },
      Quaternary: { planned: 0, completed: 0 },
    },
  });
  const out: ExposureStats = {
    squat: base(),
    bench: base(),
    deadlift: base(),
  };
  for (const e of exposures) {
    const s = out[e.family];
    s.planned += 1;
    if (e.completed) s.completed += 1;
    s.byRole[e.role].planned += 1;
    if (e.completed) s.byRole[e.role].completed += 1;
  }
  return out;
}

const ROLE_LETTER: Record<Role, string> = {
  Primary: "P",
  Secondary: "S",
  Tertiary: "T",
  Quaternary: "Q",
};

export interface WeekTimelineRow {
  weekIndex: number;
  squat: string[];
  bench: string[];
  deadlift: string[];
  // Map family+letter -> first matching dayId for tap navigation
  dayIdByCell: Record<string, string>;
}

export function exposureTimeline(exposures: PlExposure[]): WeekTimelineRow[] {
  const byWeek = new Map<number, WeekTimelineRow>();
  for (const e of exposures) {
    const w =
      byWeek.get(e.weekIndex) ??
      { weekIndex: e.weekIndex, squat: [], bench: [], deadlift: [], dayIdByCell: {} };
    const letter = ROLE_LETTER[e.role];
    const list = w[e.family];
    if (!list.includes(letter)) list.push(letter);
    const cellKey = `${e.family}:${letter}`;
    if (!w.dayIdByCell[cellKey]) w.dayIdByCell[cellKey] = e.dayId;
    byWeek.set(e.weekIndex, w);
  }
  const sortRoles = (arr: string[]) => {
    const order = ["P", "S", "T", "Q"];
    return arr.sort((a, b) => order.indexOf(a) - order.indexOf(b));
  };
  return [...byWeek.values()]
    .map((w) => ({
      ...w,
      squat: sortRoles(w.squat),
      bench: sortRoles(w.bench),
      deadlift: sortRoles(w.deadlift),
    }))
    .sort((a, b) => a.weekIndex - b.weekIndex);
}

export const ROLE_LETTER_MAP = ROLE_LETTER;
export const FAMILIES = FAMILY_SET;
export const ROLES = ROLE_SET;