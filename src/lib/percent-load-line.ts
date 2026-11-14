/**
 * The line under a percentage prescription in the workout logger: what the %
 * is of, the reference it's worked out from, and that the RPE is its cap.
 *
 *   "62.5% of Training Max (Competition Squat 235 kg) · RPE cap 6"
 *   "92.5% of today's top set (192.5 kg) · RPE cap 6"
 *   "92.5% of today's top set, once it's logged · RPE cap 6"
 *   "60% of Training Max · none on file yet, go by RPE · RPE cap 5"
 *
 * The prescription line above it already shows the weight to load; this says
 * where that weight comes from, so the % is never only in a coach's note.
 * The RPE on a % row is its cap (a hybrid program's rule: the cap beats the
 * percentage), and a range's cap is its top ("5-6" → 6).
 */

export type LoadUnit = "kg" | "lb";

export interface PercentLineInput {
  percentage: number | string | null | undefined;
  basis: string | null | undefined;
  rpe?: string | number | null;
  /** today's set this row follows (top_set / prev_set rows), once it's logged */
  linkedLoad?: { value: number; unit: LoadUnit } | null;
  /** a max-based row's reference, in the max's own unit */
  reference?: { lift: string; value: number; unit: LoadUnit } | null;
}

const MAX_BASES: Record<string, string> = {
  training_max: "Training Max",
  "1rm": "1RM",
  est_1rm: "Est. 1RM",
};

const LINKED_BASES: Record<string, { what: string; first: string }> = {
  top_set: { what: "today's top set", first: "the top set" },
  prev_set: { what: "the set before", first: "that set" },
  prev_week: { what: "last week's load", first: "last week's load" },
};

function num(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** The cap of an RPE target: its top ("5-6" → "6", "8-8.5" → "8.5", "7" → "7"). */
export function rpeCap(rpe: string | number | null | undefined): string | null {
  if (rpe == null) return null;
  const s = String(rpe).trim();
  if (!s) return null;
  const parts = s.split(/\s*[-–]\s*/).filter(Boolean);
  const top = parts[parts.length - 1];
  return /^\d+(\.\d+)?$/.test(top) ? top : null;
}

export function percentLoadLine(i: PercentLineInput): string | null {
  const pct = i.percentage == null || i.percentage === "" ? NaN : Number(i.percentage);
  if (!Number.isFinite(pct) || pct <= 0 || !i.basis) return null;
  const cap = rpeCap(i.rpe);
  const capText = cap ? ` · RPE cap ${cap}` : "";

  const linked = LINKED_BASES[i.basis];
  if (linked) {
    const of = `${num(pct)}% of ${linked.what}`;
    if (i.linkedLoad && i.linkedLoad.value > 0) return `${of} (${num(i.linkedLoad.value)} ${i.linkedLoad.unit})${capText}`;
    return `${of}, once ${linked.first} is logged${capText}`;
  }

  const label = MAX_BASES[i.basis];
  if (!label) return null;
  const of = `${num(pct)}% of ${label}`;
  if (i.reference && i.reference.value > 0) {
    return `${of} (${i.reference.lift} ${num(i.reference.value)} ${i.reference.unit})${capText}`;
  }
  return `${of} · none on file yet, go by RPE${capText}`;
}

/**
 * The reference a max-based row was worked out from, for the line above:
 * a variation that reads its competition lift at 100% names that lift
 * (High Bar Squat → "Competition Squat 235 kg"); anything else names its own.
 * `base` is in `baseUnit` (what computeRowLoad was asked for); the result is
 * in the max's own unit, so a 315 lb max reads 315 lb.
 */
export function maxReference(
  max: { lift: string; unit: string; source_lift?: string | null; variation_modifier?: number | string | null; manual_override?: boolean | null } | null | undefined,
  base: number | null | undefined,
  baseUnit: LoadUnit,
): { lift: string; value: number; unit: LoadUnit } | null {
  if (!max || base == null || !Number.isFinite(Number(base)) || Number(base) <= 0) return null;
  const unit: LoadUnit = max.unit === "lb" ? "lb" : "kg";
  const LB = 2.2046226218;
  const raw = unit === baseUnit ? Number(base) : unit === "lb" ? Number(base) * LB : Number(base) / LB;
  const value = Math.round(raw * 10) / 10;
  const modifier = max.variation_modifier == null ? 100 : Number(max.variation_modifier);
  const lift = max.source_lift && !max.manual_override && modifier === 100 ? max.source_lift : max.lift;
  return { lift, value, unit };
}
