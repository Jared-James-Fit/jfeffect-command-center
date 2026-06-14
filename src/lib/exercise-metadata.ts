/**
 * Single source of truth for exercise metadata that drives:
 *   • card color accent
 *   • default rest seconds
 *   • purpose label (Primary / Secondary / Tertiary / Quaternary / Assistance)
 *
 * Business logic NEVER depends on exercise names. It depends on the metadata
 * columns added in the 2026-06-12 migration:
 *   exercises.exercise_category        ('competition' | 'variation' | 'assistance')
 *   exercises.is_competition_lift      (boolean)
 *   exercises.competition_lift_type    ('squat' | 'bench' | 'deadlift' | null)
 *
 * Per-row overrides live on pl_exercise_rows:
 *   purpose_label              (manual override; otherwise derived)
 *   rest_seconds_override      (manual override; otherwise category default)
 *   card_color                 (manual override; otherwise category default)
 */

export type ExerciseCategory = "competition" | "variation" | "assistance";
export type CompetitionLiftType = "squat" | "bench" | "deadlift" | null;

export interface ExerciseMeta {
  exercise_category?: ExerciseCategory | null;
  is_competition_lift?: boolean | null;
  competition_lift_type?: CompetitionLiftType;
  name?: string | null;
}

/** Resolve effective category, defaulting to 'assistance'. */
export function resolveCategory(ex?: ExerciseMeta | null): ExerciseCategory {
  const c = ex?.exercise_category;
  if (c === "competition" || c === "variation" || c === "assistance") return c;
  return "assistance";
}

/** Default card color for an exercise based on its metadata. */
export function defaultCardColor(ex?: ExerciseMeta | null): string {
  if (ex?.is_competition_lift) {
    switch (ex.competition_lift_type) {
      case "squat":    return "yellow";
      case "bench":    return "sky";
      case "deadlift": return "emerald";
    }
  }
  // variations get amber, everything else (assistance) gets red
  if (resolveCategory(ex) === "variation") return "amber";
  return "red";
}

/**
 * Default rest range (seconds) for a category.
 * Competition / primary strength : 3–12 min
 * Variation                      : 2–5 min
 * Assistance / accessory         : 1–3 min
 */
export function defaultRestRange(cat: ExerciseCategory): { min: number; max: number; suggested: number } {
  switch (cat) {
    case "competition": return { min: 180, max: 720, suggested: 300 };
    case "variation":   return { min: 120, max: 300, suggested: 180 };
    default:            return { min: 60,  max: 180, suggested: 120 };
  }
}

/** Suggested default rest seconds for a fresh row of an exercise. */
export function defaultRestSeconds(ex?: ExerciseMeta | null): number {
  return defaultRestRange(resolveCategory(ex)).suggested;
}

/** Effective rest seconds for a row (override wins, else category default). */
export function effectiveRestSeconds(
  row: { rest_seconds_override?: number | null; rest_seconds?: number | null },
  ex?: ExerciseMeta | null,
): number | null {
  if (row.rest_seconds_override != null) return row.rest_seconds_override;
  if (row.rest_seconds != null) return row.rest_seconds;
  return defaultRestSeconds(ex);
}

/** Human-readable rest range label, e.g. "3–12 min". */
export function restRangeLabel(cat: ExerciseCategory): string {
  const r = defaultRestRange(cat);
  const fmt = (s: number) => (s >= 60 ? `${Math.round(s / 60)}` : `${s}s`);
  return `${fmt(r.min)}–${fmt(r.max)} min`;
}

export type PurposeLabel =
  | "Primary"
  | "Secondary"
  | "Tertiary"
  | "Quaternary"
  | "Assistance"
  | string;

const ORDERED: PurposeLabel[] = ["Primary", "Secondary", "Tertiary", "Quaternary"];

/**
 * Identify the competition-lift colour group a row belongs to.
 * Source-of-truth for the Primary/Secondary/Tertiary sequencing — matches
 * the same metadata that drives the card colour accent (exerciseAccent):
 *   • per-row card_color override (yellow=squat, sky=bench, emerald=deadlift)
 *   • else exercise.competition_lift_type
 * Returns null for any row that is not in a lift colour group (assistance,
 * neutral variations, etc.) so those rows do NOT advance the sequence.
 */
export function liftColorGroup(
  meta?: ExerciseMeta | null,
  cardColorOverride?: string | null,
): "squat" | "bench" | "deadlift" | null {
  const o = (cardColorOverride ?? "").toLowerCase();
  if (o === "yellow") return "squat";
  if (o === "sky") return "bench";
  if (o === "emerald") return "deadlift";
  const t = meta?.competition_lift_type;
  if (t === "squat" || t === "bench" || t === "deadlift") return t;
  return null;
}

/**
 * Derive purpose labels for an ordered list of rows in a workout day.
 *
 * Sequencing is calculated SEPARATELY within each competition-lift colour
 * group (squat / bench / deadlift). The first row in each group is
 * "Primary", the second "Secondary", the third "Tertiary", the fourth
 * "Quaternary"; any 5th+ row in the same group returns "" (no badge).
 *
 * Rows that do not belong to a squat/bench/deadlift colour group never
 * advance any sequence and are labelled "Assistance" (unless they have a
 * manual `purpose_label`).
 *
 * Manual `purpose_label` on a row always wins.
 */
export function derivePurposeLabels<
  R extends { purpose_label?: string | null; card_color?: string | null },
>(
  rows: R[],
  resolveMeta: (row: R) => ExerciseMeta | null | undefined,
): PurposeLabel[] {
  const counters: Record<"squat" | "bench" | "deadlift", number> = {
    squat: 0,
    bench: 0,
    deadlift: 0,
  };
  return rows.map((row) => {
    if (row.purpose_label && row.purpose_label.trim()) return row.purpose_label.trim();
    const meta = resolveMeta(row);
    const group = liftColorGroup(meta, row.card_color ?? null);
    if (group) {
      const idx = counters[group]++;
      return idx < ORDERED.length ? ORDERED[idx] : "";
    }
    return "Assistance";
  });
}

/** Badge color class for a purpose label. */
export function purposeLabelBadgeClass(label: string | null | undefined): string {
  const l = (label ?? "").trim();
  if (l === "Assistance") {
    return "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400";
  }
  if (["Primary", "Secondary", "Tertiary", "Quaternary"].includes(l)) {
    return "border-red-500/40 bg-red-500/10 text-red-600 dark:text-red-400";
  }
  return "border-muted-foreground/30 bg-muted text-muted-foreground";
}

/** Suggested purpose-label options shown in the manual override picker. */
export const PURPOSE_LABEL_OPTIONS: PurposeLabel[] = [
  "Primary",
  "Secondary",
  "Tertiary",
  "Quaternary",
  "Assistance",
  "Warm-Up",
  "Conditioning",
];