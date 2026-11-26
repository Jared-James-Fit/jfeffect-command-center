/**
 * The right half of an exercise card's reference strip when the coach planned
 * the load as a percentage (of today's top set, or of a max): what the % is of,
 * the weight it means today, and, behind its ⓘ, how it was worked out.
 *
 *   "92.5% of top set"     After your top set     (top set not logged yet)
 *   "92.5% of top set"     400 lb                 (92.5% of the 435 lb logged)
 *   "62.5% Comp Squat TM"  147.5 kg
 *
 * The prescription above it keeps the coach's words ("2 × 4 @ 92.5% | RPE 6");
 * this says what that is today, in the athlete's unit. It sits where an RPE
 * card has Suggested: the engine never suggests over a coach's planned load,
 * and the RPE beside a % is its cap (capAdjustedLoad), said behind the ⓘ and,
 * when a set goes over it, under the sets (data-rpe-cap-next).
 */
import { isMaxBasis, plannedLoadLabel } from "./load-reference";
import { rpeCap } from "@/lib/percent-load-line";

export type LoadUnit = "kg" | "lb";

const LB_PER_KG = 2.2046226218;
const MAX_NAMES: Record<string, string> = { training_max: "Training Max", "1rm": "1RM", est_1rm: "Est. 1RM" };

export interface PlannedLoadInput {
  percentage: number | string | null | undefined;
  basis: string | null | undefined;
  rpe?: string | number | null;
  unit: LoadUnit;
  /** the % worked out and rounded to a plate step, in `unit` (null while there's nothing to read yet) */
  planned: number | null;
  /** a top-set back-off's plain % before how the top set went moved it (topSetAdjustment) */
  plain?: number | null;
  /** how the top set went moved it: its RPE against what it was prescribed */
  adjust?: { dir: "down" | "up"; rpe: number; target: string } | null;
  /** what the open sets carry now: `planned`, or less after a set over the cap */
  open: number | null;
  /** today's logged top set (top_set rows), in its own unit */
  linked?: { value: number; unit: LoadUnit } | null;
  /** a max-based row's reference, in the max's own unit (maxReference) */
  reference?: { lift: string; value: number; unit: LoadUnit } | null;
  /** the competition lift a variation's % reads (its label names it) */
  refLift?: string | null;
  viaFamily?: boolean;
  /** a set logged over the cap, and what it was rated */
  capOver?: { set: number; rpe: number } | null;
  /** where a max read from their training came from (e1rmSourceLine), said after the working-out */
  referenceNote?: string | null;
  /** the label the max lookup already made ("65% Comp Squat TM"), else one is made here */
  label?: string | null;
  /** the maxes are still loading (a % of a max) */
  pending?: boolean;
}

export interface PlannedLoadView {
  /** "92.5% of top set", "62.5% Comp Squat TM" */
  label: string;
  /** "400 lb" once there's a weight */
  value: string | null;
  /** that weight as a number (what one tap fills the open sets with), in `unit` */
  load: number | null;
  unit: LoadUnit;
  /** what it waits on ("After your top set"), shown muted in place of the value */
  waiting: string | null;
  /** the ⓘ, a line each */
  why: string[];
  /** the open sets carry less than the % (a set went over the cap) */
  capped: boolean;
}

export function fmtLoad(n: number): string {
  return String(Math.round(n * 100) / 100);
}

const fmtPct = (p: number) => String(Math.round(p * 100) / 100);
const fmtRpe = (r: number) => String(Math.round(r * 10) / 10);

function convert(value: number, from: LoadUnit, to: LoadUnit): number {
  if (from === to) return value;
  return from === "kg" ? value * LB_PER_KG : value / LB_PER_KG;
}

/** "is 402.4 lb, rounded to 400 lb" / "is 400 lb" */
function workedOut(exact: number, planned: number, unit: LoadUnit): string {
  const e = Math.round(exact * 10) / 10;
  return Math.abs(e - planned) < 0.05 ? `is ${fmtLoad(planned)} ${unit}` : `is ${fmtLoad(e)} ${unit}, rounded to ${fmtLoad(planned)} ${unit}`;
}

/**
 * What the card's planned-load half says, or null when the row isn't a coach's
 * % (an RPE row, a fixed load, a % of a max nobody has on file: those keep the
 * engine's Suggested and the % line).
 */
export function plannedLoadView(i: PlannedLoadInput): PlannedLoadView | null {
  const pct = Number(i.percentage);
  if (!Number.isFinite(pct) || pct <= 0) return null;
  const topSet = i.basis === "top_set";
  if (!topSet && !isMaxBasis(i.basis)) return null;
  const label = i.label || plannedLoadLabel({ percentage: pct, basis: i.basis, refLift: i.refLift, viaFamily: i.viaFamily });
  if (!label) return null;

  const cap = rpeCap(i.rpe);
  const why: string[] = [];
  let value: string | null = null;
  let waiting: string | null = null;

  if (topSet) {
    if (i.linked && i.linked.value > 0 && i.planned != null) {
      const exact = (convert(i.linked.value, i.linked.unit, i.unit) * pct) / 100;
      why.push(`${fmtPct(pct)}% of your top set (${fmtLoad(i.linked.value)} ${i.linked.unit}) ${workedOut(exact, i.plain ?? i.planned, i.unit)}.`);
      if (i.adjust) {
        why.push(i.adjust.dir === "down"
          ? `Your top set was RPE ${fmtRpe(i.adjust.rpe)}, over its ${i.adjust.target}, so back-offs start lighter: ${fmtLoad(i.planned)} ${i.unit}.`
          : `Your top set was RPE ${fmtRpe(i.adjust.rpe)}, a clear point under its ${i.adjust.target}, so back-offs start a little heavier: ${fmtLoad(i.planned)} ${i.unit}.`);
      }
    } else {
      waiting = "After your top set";
      why.push(`Your coach set these at ${fmtPct(pct)}% of today's top set. Log the top set and the weight shows here.`);
    }
  } else {
    // a % of a max: there's always a reference here (no max on file keeps the % line instead)
    const of = MAX_NAMES[String(i.basis)] ?? "max";
    if (i.pending) return { label, value: null, load: null, unit: i.unit, waiting: null, why: [`Your coach set these at ${fmtPct(pct)}% of your ${of}.`], capped: false };
    if (!i.reference || i.planned == null) return null;
    const exact = (convert(i.reference.value, i.reference.unit, i.unit) * pct) / 100;
    why.push(`${fmtPct(pct)}% of your ${of} (${i.reference.lift} ${fmtLoad(i.reference.value)} ${i.reference.unit}) ${workedOut(exact, i.planned, i.unit)}.`);
    if (i.referenceNote) why.push(i.referenceNote);
  }

  const capped = i.open != null && i.planned != null && i.open < i.planned - 1e-9;
  if (i.open != null && waiting == null) value = `${fmtLoad(i.open)} ${i.unit}`;
  if (cap) {
    why.push(
      capped && i.capOver
        ? `Set ${i.capOver.set} was RPE ${fmtRpe(i.capOver.rpe)}, over the RPE ${cap} cap, so the sets left are ${fmtLoad(i.open as number)} ${i.unit}.`
        : `RPE ${cap} is a cap: if a set goes over it, the next one comes down.`,
    );
  }
  if (value != null) why.push("Tap the weight to fill your open sets, or type your own.");
  return { label, value, load: value != null ? i.open : null, unit: i.unit, waiting, why, capped };
}
