/**
 * Which set videos can have their bar path read (pure): a loaded barbell seen
 * from the side, so its plate is a disc that rises and falls. A dumbbell,
 * cable, machine, band or bodyweight exercise has no plate to follow (or one
 * moving on a sled), so it's never analysed by itself; a person can still ask.
 * And which way a rep goes, when the name says (a deadlift is pulled first,
 * a squat lowered first); otherwise the clip decides.
 */

const NOT_A_BAR =
  /\b(dumbbells?|db|cables?|bands?|kettlebells?|kb|bodyweight|pull[\s-]?ups?|chin[\s-]?ups?|dips?|push[\s-]?ups?|planks?|carry|carries|sled|treadmill|bike|walk|run|leg press|hack squat|pendulum|belt squat|lat pull|pulldown|curl machine|pec deck|leg extension|leg curl|calf raise machine)\b/i;
const MACHINE = /\bmachine\b/i;
const SMITH = /\bsmith\b/i;
/** Lifts that start with the bar low and go up first. */
const LIFT_FIRST =
  /\b(deadlifts?|dl|rack pulls?|block pulls?|deficit pulls?|cleans?|snatch(es)?|rows?|pendlay|overhead press|ohp|military press|push press|strict press|hip thrusts?|glute bridges?|shrugs?)\b/i;
/** Lifts lowered first (the bar starts at the top). */
const LOWER_FIRST = /\b(squats?|bench|rdls?|romanian|good mornings?|stiff[\s-]?leg)\b/i;

/** A loaded barbell exercise whose plate can be followed (the default for auto-analysis). */
export function analysableExercise(
  name: string | null | undefined,
  equipment?: string | null,
): boolean {
  const s = `${name ?? ""} ${equipment ?? ""}`;
  if (!s.trim()) return false;
  if (NOT_A_BAR.test(s)) return false;
  if (MACHINE.test(s) && !SMITH.test(s)) return false;
  return /\b(barbell|smith|trap bar|ez bar|larsen|spoto|floor press|pin press)\b/i.test(s) || LIFT_FIRST.test(s) || LOWER_FIRST.test(s);
}

/** Explosive multi-phase lifts are not a squat/deadlift concentric. Keep them out of that model. */
export function olympicExercise(name: string | null | undefined): boolean {
  return /\b(clean|cleans|snatch|snatches|jerk|jerks)\b/i.test(name ?? "");
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
