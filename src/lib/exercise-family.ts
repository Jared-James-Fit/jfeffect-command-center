/**
 * Movement family: the ONE place that decides an exercise card's colour.
 *
 *   squat     = yellow    bench = blue    deadlift = green    accessory = red
 *
 * The family is the MOVEMENT, not the muscles it trains. Leg Curl is an
 * accessory even though it helps the deadlift; Pause Squat is a squat.
 * It is stored on `exercises.movement_family` (derived once by the database,
 * editable in the Exercise Library) so every screen reads the same value.
 *
 * Do not add per-screen colour logic. Import `movementFamilyStyle()` /
 * `<ExerciseOrderBadge />` instead.
 */

export const MOVEMENT_FAMILIES = ["squat", "bench", "deadlift", "accessory"] as const;
export type MovementFamily = (typeof MOVEMENT_FAMILIES)[number];

export const MOVEMENT_FAMILY_LABEL: Record<MovementFamily, string> = {
  squat: "Squat",
  bench: "Bench",
  deadlift: "Deadlift",
  accessory: "Accessory",
};

export const MOVEMENT_FAMILY_COLOR_NAME: Record<MovementFamily, string> = {
  squat: "Yellow",
  bench: "Blue",
  deadlift: "Green",
  accessory: "Red",
};

type FamilyStyle = {
  /** Solid left-edge stripe on a card. */
  stripe: string;
  /** Filled number badge (text colour chosen for contrast on the fill). */
  badge: string;
  /** Soft tint for chips / filters. */
  soft: string;
  /** Small solid dot. */
  dot: string;
};

// Full class strings on purpose: Tailwind only generates classes it can see.
const STYLES: Record<MovementFamily, FamilyStyle> = {
  squat: {
    stripe: "bg-yellow-500",
    badge: "bg-yellow-400 text-yellow-950 border-yellow-500/70",
    soft: "border-yellow-500/50 bg-yellow-500/10 text-yellow-700 dark:text-yellow-300",
    dot: "bg-yellow-500",
  },
  bench: {
    stripe: "bg-blue-500",
    badge: "bg-blue-500 text-white border-blue-600/70",
    soft: "border-blue-500/50 bg-blue-500/10 text-blue-700 dark:text-blue-300",
    dot: "bg-blue-500",
  },
  deadlift: {
    stripe: "bg-green-500",
    badge: "bg-green-600 text-white border-green-700/70",
    soft: "border-green-500/50 bg-green-500/10 text-green-700 dark:text-green-300",
    dot: "bg-green-500",
  },
  accessory: {
    stripe: "bg-red-500",
    badge: "bg-red-600 text-white border-red-700/70",
    soft: "border-red-500/50 bg-red-500/10 text-red-700 dark:text-red-300",
    dot: "bg-red-500",
  },
};

export function movementFamilyStyle(family: MovementFamily): FamilyStyle {
  return STYLES[family];
}

export function isMovementFamily(value: unknown): value is MovementFamily {
  return typeof value === "string" && (MOVEMENT_FAMILIES as readonly string[]).includes(value);
}

export type FamilyExercise = {
  movement_family?: string | null;
  competition_lift_type?: string | null;
} | null | undefined;

const SBD = new Set<string>(["squat", "bench", "deadlift"]);

/**
 * Resolve an exercise's family.
 *   1. exercises.movement_family            (the library's decision)
 *   2. exercises.competition_lift_type      (older cached payloads without the column)
 *   3. the program row's own movement_family, SBD values only — covers a row
 *      typed in by name that has no library link yet
 *   4. accessory
 * `card_color` is deliberately ignored: colour comes from the family only.
 */
export function resolveMovementFamily(
  exercise: FamilyExercise,
  rowMovementFamily?: string | null,
): MovementFamily {
  const own = String(exercise?.movement_family ?? "").toLowerCase();
  if (isMovementFamily(own)) return own;
  const comp = String(exercise?.competition_lift_type ?? "").toLowerCase();
  if (SBD.has(comp)) return comp as MovementFamily;
  const row = String(rowMovementFamily ?? "").toLowerCase();
  if (SBD.has(row)) return row as MovementFamily;
  return "accessory";
}

/** Stripe class for a card — the replacement for every ad-hoc accent helper. */
export function familyStripeClass(
  exercise: FamilyExercise,
  rowMovementFamily?: string | null,
): string {
  return STYLES[resolveMovementFamily(exercise, rowMovementFamily)].stripe;
}
