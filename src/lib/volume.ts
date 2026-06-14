// Phase 1 volume tracking constants + pure calculators.
// Frontend-only. No DB writes from this file.

export const MOVEMENT_PATTERNS = [
  "squat",
  "bench",
  "deadlift",
  "horizontal_push",
  "vertical_push",
  "horizontal_pull",
  "vertical_pull",
  "knee_extension",
  "hip_hinge",
  "hamstring_curl",
  "glutes",
  "arms",
  "delts",
  "core",
  "conditioning",
  "rehab",
  "other",
] as const;
export type MovementPattern = (typeof MOVEMENT_PATTERNS)[number];

export const MOVEMENT_PATTERN_LABELS: Record<MovementPattern, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
  horizontal_push: "Horizontal push",
  vertical_push: "Vertical push",
  horizontal_pull: "Horizontal pull",
  vertical_pull: "Vertical pull",
  knee_extension: "Knee extension",
  hip_hinge: "Hip hinge",
  hamstring_curl: "Hamstring curl",
  glutes: "Glutes",
  arms: "Arms",
  delts: "Delts",
  core: "Core",
  conditioning: "Conditioning",
  rehab: "Rehab",
  other: "Other",
};

export const LIFT_FAMILIES = [
  "squat",
  "bench",
  "deadlift",
  "accessory",
  "conditioning",
  "rehab",
] as const;
export type LiftFamily = (typeof LIFT_FAMILIES)[number];

export const VARIATION_TYPES = [
  "competition",
  "close_variation",
  "secondary_compound",
  "accessory",
  "isolation",
  "rehab",
  "conditioning",
] as const;
export type VariationType = (typeof VARIATION_TYPES)[number];

export const VARIATION_LABELS: Record<VariationType, string> = {
  competition: "Competition",
  close_variation: "Close variation",
  secondary_compound: "Secondary compound",
  accessory: "Accessory",
  isolation: "Isolation",
  rehab: "Rehab",
  conditioning: "Conditioning",
};

export const DEFAULT_VOLUME_MULTIPLIERS: Record<VariationType, number> = {
  competition: 1.0,
  close_variation: 0.8,
  secondary_compound: 0.7,
  accessory: 0.5,
  isolation: 0.4,
  rehab: 0.25,
  conditioning: 0,
};

// Common muscle-group choices for the multi-select. Stored as text[] so
// any value is accepted; this list just drives the picker UI.
export const MUSCLE_GROUPS = [
  "chest",
  "upper_back",
  "lats",
  "traps",
  "rear_delts",
  "side_delts",
  "front_delts",
  "biceps",
  "triceps",
  "forearms",
  "quads",
  "hamstrings",
  "glutes",
  "adductors",
  "calves",
  "core",
] as const;
export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_GROUP_LABELS: Record<string, string> = {
  chest: "Chest",
  upper_back: "Upper back",
  lats: "Lats",
  traps: "Traps",
  rear_delts: "Rear delts",
  side_delts: "Side delts",
  front_delts: "Front delts",
  biceps: "Biceps",
  triceps: "Triceps",
  forearms: "Forearms",
  quads: "Quads",
  hamstrings: "Hamstrings",
  glutes: "Glutes",
  adductors: "Adductors",
  calves: "Calves",
  core: "Core",
};

export function labelForMuscle(m: string): string {
  return MUSCLE_GROUP_LABELS[m] ?? m.replace(/_/g, " ");
}

export function multiplierForVariation(v: string | null | undefined): number {
  if (!v) return 0;
  return DEFAULT_VOLUME_MULTIPLIERS[v as VariationType] ?? 0;
}

// Minimum shape we need off an exercise row for volume math.
export interface ExerciseTag {
  id: string;
  primary_movement_pattern?: string | null;
  muscle_groups?: string[] | null;
  lift_family?: string | null;
  variation_type?: string | null;
  counts_toward_volume?: boolean | null;
  volume_multiplier?: number | string | null;
}

export interface PlannedRow {
  exercise_id?: string | null;
  sets?: number | string | null;
  // Future: working_set flag. For Phase 1, every programmed row is treated
  // as working sets unless `sets` is null/0.
}

export interface PlannedDay {
  rows?: PlannedRow[] | null;
}

export interface PlannedWeek {
  days?: PlannedDay[] | null;
}

function toNumber(v: number | string | null | undefined): number {
  if (v == null || v === "") return 0;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) ? n : 0;
}

function effectiveMultiplier(ex: ExerciseTag | undefined): number {
  if (!ex) return 0;
  if (ex.counts_toward_volume === false) return 0;
  const stored = toNumber(ex.volume_multiplier ?? null);
  if (stored > 0) return stored;
  return multiplierForVariation(ex.variation_type);
}

export interface VolumeBucket {
  key: string;
  label: string;
  rawSets: number;
  effectiveSets: number;
  exerciseCount: number;
}

export interface WeeklyVolume {
  totalRawSets: number;
  totalEffectiveSets: number;
  taggedRowCount: number;
  untaggedRowCount: number;
  byPattern: VolumeBucket[];
  byMuscle: VolumeBucket[];
  byFamily: VolumeBucket[];
}

export function computeWeeklyVolume(
  week: PlannedWeek | null | undefined,
  exercises: ExerciseTag[],
): WeeklyVolume {
  const tagById = new Map<string, ExerciseTag>();
  for (const e of exercises) tagById.set(e.id, e);

  const patternAcc = new Map<string, { raw: number; eff: number; ex: Set<string> }>();
  const muscleAcc = new Map<string, { raw: number; eff: number; ex: Set<string> }>();
  const familyAcc = new Map<string, { raw: number; eff: number; ex: Set<string> }>();

  let totalRaw = 0;
  let totalEff = 0;
  let tagged = 0;
  let untagged = 0;

  const days = week?.days ?? [];
  for (const d of days) {
    const rows = d?.rows ?? [];
    for (const r of rows) {
      const sets = toNumber(r.sets);
      if (sets <= 0) continue;
      const ex = r.exercise_id ? tagById.get(r.exercise_id) : undefined;
      const mult = effectiveMultiplier(ex);
      const eff = sets * mult;
      totalRaw += sets;
      totalEff += eff;

      const hasTag =
        !!ex &&
        (!!ex.primary_movement_pattern ||
          !!ex.lift_family ||
          (ex.muscle_groups?.length ?? 0) > 0);
      if (hasTag) tagged++;
      else untagged++;

      const pat = ex?.primary_movement_pattern ?? "untagged";
      const fam = ex?.lift_family ?? "untagged";

      const addBucket = (
        m: Map<string, { raw: number; eff: number; ex: Set<string> }>,
        key: string,
        exId: string | null | undefined,
      ) => {
        const cur = m.get(key) ?? { raw: 0, eff: 0, ex: new Set<string>() };
        cur.raw += sets;
        cur.eff += eff;
        if (exId) cur.ex.add(exId);
        m.set(key, cur);
      };

      addBucket(patternAcc, pat, r.exercise_id);
      addBucket(familyAcc, fam, r.exercise_id);
      const muscles = ex?.muscle_groups ?? [];
      if (muscles.length === 0) {
        addBucket(muscleAcc, "untagged", r.exercise_id);
      } else {
        // Each muscle bucket gets the FULL set count (sets attribute to every
        // muscle worked, not divided across them — standard hypertrophy bookkeeping).
        for (const m of muscles) addBucket(muscleAcc, m, r.exercise_id);
      }
    }
  }

  const toBuckets = (
    m: Map<string, { raw: number; eff: number; ex: Set<string> }>,
    labelFor: (k: string) => string,
  ): VolumeBucket[] =>
    Array.from(m.entries())
      .map(([key, v]) => ({
        key,
        label: labelFor(key),
        rawSets: round1(v.raw),
        effectiveSets: round1(v.eff),
        exerciseCount: v.ex.size,
      }))
      .sort((a, b) => b.effectiveSets - a.effectiveSets);

  return {
    totalRawSets: round1(totalRaw),
    totalEffectiveSets: round1(totalEff),
    taggedRowCount: tagged,
    untaggedRowCount: untagged,
    byPattern: toBuckets(patternAcc, (k) =>
      k === "untagged" ? "Untagged" : (MOVEMENT_PATTERN_LABELS as any)[k] ?? k,
    ),
    byMuscle: toBuckets(muscleAcc, (k) => (k === "untagged" ? "Untagged" : labelForMuscle(k))),
    byFamily: toBuckets(familyAcc, (k) =>
      k === "untagged" ? "Untagged" : k[0]!.toUpperCase() + k.slice(1),
    ),
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}