/**
 * Muscle-group normalization for Performance Insights.
 *
 * Reads `exercises.primary_muscle_group` (primary weight 1.0) and
 * `exercises.muscle_groups[]` (secondary weight 0.5). Free-text values from
 * the library are normalized to a canonical set of 12 groups shown to the
 * athlete. Anything that fails to match is bucketed under "Other" so it can
 * be surfaced separately rather than silently dropped.
 */

export const MUSCLE_GROUPS = [
  "Chest",
  "Back",
  "Lats",
  "Shoulders",
  "Biceps",
  "Triceps",
  "Forearms",
  "Quads",
  "Hamstrings",
  "Glutes",
  "Calves",
  "Core",
] as const;

export type MuscleGroup = (typeof MUSCLE_GROUPS)[number];

export const MUSCLE_EMOJI: Record<MuscleGroup, string> = {
  Chest: "🫀",
  Back: "🪵",
  Lats: "🦅",
  Shoulders: "🪖",
  Biceps: "💪",
  Triceps: "🦾",
  Forearms: "🤚",
  Quads: "🦵",
  Hamstrings: "🐎",
  Glutes: "🍑",
  Calves: "🐇",
  Core: "🔥",
};

/** Canonicalize any free-text muscle label to one of MUSCLE_GROUPS or null. */
export function normalizeMuscle(input: string | null | undefined): MuscleGroup | null {
  if (!input) return null;
  const s = String(input).toLowerCase().trim();
  if (!s) return null;
  if (s.includes("chest") || s.includes("pec")) return "Chest";
  if (s.includes("lat") && !s.includes("plat")) return "Lats";
  if (
    s.includes("upper back") || s.includes("mid back") ||
    // "Lower Back" is a real production value in `exercises.primary_muscle_group`
    // (16 rows). Erectors/spinal already map to Back, so lower back joins them
    // instead of falling through to "Other".
    s.includes("lower back") || s.includes("low back") ||
    s.includes("trap") || s.includes("rhomb") ||
    s === "back" || s.includes("erector") || s.includes("spinal")
  ) return "Back";
  if (s.includes("delt") || s.includes("shoulder")) return "Shoulders";
  if (s.includes("bicep")) return "Biceps";
  if (s.includes("tricep")) return "Triceps";
  if (s.includes("forearm") || s.includes("grip")) return "Forearms";
  if (s.includes("quad")) return "Quads";
  if (s.includes("hamstring") || s === "hams") return "Hamstrings";
  if (s.includes("glute")) return "Glutes";
  // "Adductors" / "Abductors" are real production values (13 rows). They are
  // hip/thigh work — grouped under Glutes rather than dropped into "Other".
  if (s.includes("adductor") || s.includes("abductor") || s.includes("inner thigh") || s.includes("groin")) return "Glutes";
  if (s.includes("calf") || s.includes("calves")) return "Calves";
  if (s.includes("core") || s.includes("abs") || s.includes("oblique") || s.includes("abdom")) return "Core";
  return null;
}

export interface MuscleContribution {
  group: MuscleGroup;
  weight: number;
}

/**
 * Resolve an exercise's muscle contributions. Primary muscle counts 1.0,
 * each secondary counts 0.5, deduped so the same group can never exceed 1.0.
 */
export function resolveMuscleGroups(
  primary: string | null | undefined,
  secondaries: (string | null | undefined)[] | null | undefined,
): MuscleContribution[] {
  const weights = new Map<MuscleGroup, number>();
  const p = normalizeMuscle(primary);
  if (p) weights.set(p, 1);
  for (const s of secondaries ?? []) {
    const g = normalizeMuscle(s);
    if (!g) continue;
    if (!weights.has(g)) weights.set(g, 0.5);
  }
  return [...weights.entries()].map(([group, weight]) => ({ group, weight }));
}