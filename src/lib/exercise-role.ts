/**
 * What an exercise is in its workout, for the builder's quiet visual marks
 * (Nov 24 2026): a thin bar at the row's left edge, strongest for the lifts
 * the session is built around, lighter for what follows, none for
 * accessories, dotted for warm-ups, a muted blue for cardio. Never the only
 * cue: the row's own label ("Primary", "Back-off", "Warm-up") says it in words.
 */
export type ExerciseRole =
  | "primary"
  | "secondary"
  | "top"
  | "backoff"
  | "accessory"
  | "warmup"
  | "cardio";

export function exerciseRole(input: {
  /** the row's purpose label ("Primary Squat", "Secondary", "Assistance", "Warm-Up", "Conditioning") */
  purposeLabel?: string | null;
  /** a back-off row under its top set */
  backoff?: boolean;
  /** a set group written as the top set */
  top?: boolean;
  warmup?: boolean;
  cardio?: boolean;
}): ExerciseRole {
  const label = String(input.purposeLabel ?? "").trim();
  if (input.cardio || /^(conditioning|cardio)\b/i.test(label)) return "cardio";
  if (input.warmup || /^warm[- ]?up\b|^mobility\b/i.test(label)) return "warmup";
  if (input.backoff || /\bback[- ]?offs?\b/i.test(label)) return "backoff";
  if (input.top || /\btop set\b/i.test(label)) return "top";
  if (/^(primary|competition)\b/i.test(label)) return "primary";
  if (/^(secondary|tertiary|quaternary)\b/i.test(label)) return "secondary";
  return "accessory";
}

/** The mark each role gets: the left bar's class, and its name in words. */
export const ROLE_MARK: Record<ExerciseRole, { bar: string | null; word: string }> = {
  primary: { bar: "bg-foreground", word: "Primary" },
  top: { bar: "bg-foreground", word: "Top set" },
  secondary: { bar: "bg-foreground/40", word: "Secondary" },
  backoff: { bar: "bg-foreground/20", word: "Back-off" },
  accessory: { bar: null, word: "Accessory" },
  warmup: {
    bar: "bg-[repeating-linear-gradient(to_bottom,color-mix(in_oklch,var(--muted-foreground)_60%,transparent)_0_3px,transparent_3px_6px)]",
    word: "Warm-up",
  },
  cardio: { bar: "bg-sky-500/55 dark:bg-sky-400/55", word: "Cardio" },
};

/** The main lifts get a slightly bigger name; everything else reads at the list's size. */
export const isMainRole = (r: ExerciseRole) => r === "primary" || r === "top";
