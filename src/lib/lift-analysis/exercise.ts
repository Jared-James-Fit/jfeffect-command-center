/**
 * Which set videos can have their bar path read (pure): a loaded barbell seen
 * from the side, so its plate is a disc that rises and falls. A dumbbell,
 * cable, machine, band or bodyweight exercise has no plate to follow (or one
 * moving on a sled), so it's never analysed by itself; a person can still ask.
 * And which way a rep goes, when the name says (a deadlift is pulled first,
 * a squat lowered first); otherwise the clip decides.
 */

const NOT_A_BAR =
  /\b(dumbbells?|db|cables?|bands?|kettlebells?|kb|bodyweight|pull[\s-]?ups?|chin[\s-]?ups?|dips?|push[\s-]?ups?|planks?|carry|carries|sled|treadmill|bike|walk|run|leg press|hack squat|pendulum|belt squat|lat pull|pulldown|curl machine|pec deck|leg extension|leg curl|calf raise machine|landmine)\b/i;
const MACHINE = /\bmachine\b/i;
const SMITH = /\bsmith\b/i;
/** Lifts that start with the bar low and go up first. */
const LIFT_FIRST =
  /\b(deadlifts?|dl|rack pulls?|block pulls?|deficit pulls?|cleans?|snatch(es)?|high pulls?|rows?|pendlay|overhead press|ohp|military press|push press|strict press|z press|hip thrusts?|glute bridges?|shrugs?)\b/i;
/** Lifts lowered first (the bar starts at the top). */
const LOWER_FIRST = /\b(squats?|bench|rdls?|sldl|romanian|good mornings?|stiff[\s-]?leg)\b/i;

/** A loaded barbell exercise whose plate can be followed (the default for auto-analysis). */
export function analysableExercise(
  name: string | null | undefined,
  equipment?: string | null,
): boolean {
  const s = `${name ?? ""} ${equipment ?? ""}`;
  if (!s.trim()) return false;
  if (NOT_A_BAR.test(s)) return false;
  if (MACHINE.test(s) && !SMITH.test(s)) return false;
  return /\b(barbell|smith|trap bar|ez bar|larsen|spoto|floor press|pin press|jerks?)\b/i.test(s) || LIFT_FIRST.test(s) || LOWER_FIRST.test(s);
}

/** Explosive multi-phase lifts (and their pulls): read for bar path and peak bar speed, never a squat/deadlift-style mean. */
export function olympicExercise(name: string | null | undefined): boolean {
  return /\b(clean|cleans|snatch|snatches|jerk|jerks|high pulls?)\b/i.test(name ?? "");
}

/**
 * The movement a set video shows, for what its read is checked against and
 * what its set speed means (pure). Each kind has the range (mm) one rep of it
 * travels for any lifter, which is also the check that the plate is the size
 * it was taken for: a 230 mm plate read as 450 mm doubles every range.
 * Olympic lifts log the set's mean PEAK bar speed (the number weightlifting
 * coaches use: a snatch's or clean's pull peaks around 1.5–2.2 m/s); every
 * other lift logs the set's mean concentric velocity.
 */
export type MovementKind = "squat" | "bench" | "deadlift" | "hinge" | "row" | "press" | "olympic" | "other";
export type Movement = { kind: MovementKind; metric: "mcv" | "peak" };

export const MOVEMENT_ROM_MM: Record<MovementKind, [number, number]> = {
  squat: [250, 950],
  bench: [100, 650],
  deadlift: [200, 850],
  hinge: [200, 850],
  row: [120, 650],
  press: [250, 850],
  olympic: [350, 2000],
  other: [100, 1000],
};

export function movementOf(name: string | null | undefined): Movement {
  const s = name ?? "";
  const kind: MovementKind = olympicExercise(s)
    ? "olympic"
    : /\b(rdls?|sldl|romanian|stiff[\s-]?leg|good mornings?)\b/i.test(s)
      ? "hinge"
      : /\b(rows?|pendlay|seal row|yates)\b/i.test(s)
        ? "row"
        : /\b(overhead press|ohp|military press|push press|strict press|z press|behind the neck)\b/i.test(s)
          ? "press"
          : guideLift(s) === "other"
            ? "other"
            : (guideLift(s) as MovementKind);
  return { kind, metric: kind === "olympic" ? "peak" : "mcv" };
}

/** Which way a rep goes, from the exercise's name (null when the name doesn't say). */
export function repDirection(name: string | null | undefined): "lower_first" | "lift_first" | null {
  const s = name ?? "";
  // "Romanian deadlift", "stiff-leg deadlift": lowered first even though they're deadlifts
  if (/\b(rdls?|romanian|stiff[\s-]?leg)\b/i.test(s)) return "lower_first";
  if (/\b(bench|floor press|pin press|larsen)\b/i.test(s)) return "lower_first";
  if (LIFT_FIRST.test(s)) return "lift_first";
  if (LOWER_FIRST.test(s)) return "lower_first";
  return null;
}

/** Which of the three lifts the filming guide and the phase words speak to (pure). */
export type GuideLift = "squat" | "bench" | "deadlift" | "other";

export function guideLift(name: string | null | undefined): GuideLift {
  const s = name ?? "";
  if (/\b(bench|floor press|larsen|spoto|pin press)\b/i.test(s)) return "bench";
  if (/\b(dead\s?lifts?|dl|rack pulls?|block pulls?|rdls?|romanian)\b/i.test(s)) return "deadlift";
  if (/\bsquats?\b/i.test(s)) return "squat";
  return "other";
}
