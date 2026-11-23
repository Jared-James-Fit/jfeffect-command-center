/**
 * How a workout's prescription and its logged sets are said in words, shared
 * by the training PDFs (workout-pdf.ts) and the coach's workout quick view
 * (Clients list). Pure, with no PDF code, so a screen can use it without
 * loading jsPDF.
 *
 * A load reads as the athlete typed it; a prescription as the coach wrote it
 * (a % with what it's of, never a weight the app would work out on the day).
 * Text goes through `pdfText`, which keeps every letter and turns the few
 * symbols the PDF font lacks (→, ≥, ≈) into words, so the screen and the PDF
 * say the same thing.
 */
import { pdfDuration, pdfNumber, pdfText, plural } from "@/lib/pdf/text";
import { loggedSetHasInput } from "@/lib/workouts/training-report-data";
import { plannedLoadLabel } from "@/lib/workouts/load-reference";

export type LoggedSet = {
  set_index?: number | null;
  actual_reps?: number | null;
  actual_load?: number | null;
  actual_load_lb?: number | null;
  actual_load_kg?: number | null;
  actual_load_unit?: string | null;
  entered_value?: number | null;
  entered_unit?: string | null;
  normalized_lb?: number | null;
  normalized_kg?: number | null;
  actual_rpe?: string | number | null;
  actual_rpe_num?: string | number | null;
  actual_rir?: string | number | null;
  completed_duration_seconds?: number | null;
  actual_calories?: number | null;
  actual_distance_m?: number | null;
  actual_distance_unit?: string | null;
  notes?: string | null;
};

export type PrescriptionRow = {
  id?: string;
  sort_order?: number | null;
  exercise_name_override?: string | null;
  exercises?: { name?: string | null } | null;
  sets?: number | null;
  reps_text?: string | null;
  rpe?: string | null;
  rir?: string | null;
  percentage?: number | null;
  percentage_basis?: string | null;
  load_kg?: number | null;
  load_lb?: number | null;
  load_unit?: string | null;
  rest_seconds?: number | null;
  tempo?: string | null;
  notes?: string | null;
  measurement_type?: string | null;
  duration_seconds?: number | null;
  purpose_label?: string | null;
  movement_family?: string | null;
  /** Actual logged sets for this row, in set_index order. */
  logged_sets?: LoggedSet[];
};
type Row = PrescriptionRow;

export const exerciseName = (r: Row) => pdfText(r.exercise_name_override) || pdfText(r.exercises?.name) || "Exercise";

/** "Primary", "Top set": the coach's role for the exercise, never the default "Assistance". */
export function roleOf(r: Row): string | null {
  const p = pdfText(r.purpose_label);
  return p && p.toLowerCase() !== "assistance" ? p : null;
}

/** The load as the coach wrote it: "140 kg", "75% TM", "92.5% of top set"; null when there's none. */
export function prescribedLoad(r: Row): string | null {
  const pct = Number(r.percentage);
  if (r.percentage != null && Number.isFinite(pct) && pct > 0) {
    return plannedLoadLabel({ percentage: pct, basis: r.percentage_basis }) ?? `${pdfNumber(pct, 2)}%`;
  }
  const unit = r.load_unit === "kg" || r.load_unit === "lb" ? r.load_unit : r.load_kg != null ? "kg" : r.load_lb != null ? "lb" : null;
  const value = unit === "kg" ? (r.load_kg ?? null) : unit === "lb" ? (r.load_lb ?? null) : null;
  if (unit && value != null && Number(value) > 0) return `${pdfNumber(Number(value), 2)} ${unit}`;
  return null;
}

/** "8", "6-8", "10 min" for a timed row. */
export function prescribedReps(r: Row): string | null {
  if (r.measurement_type === "time" && r.duration_seconds != null) return pdfDuration(r.duration_seconds) || null;
  const t = pdfText(r.reps_text);
  return t || null;
}

export function prescribedEffort(r: Row): string | null {
  const rpe = pdfText(r.rpe);
  if (rpe) return `RPE ${rpe}`;
  const rir = pdfText(r.rir);
  if (rir) return `RIR ${rir}`;
  return null;
}

/** "5 × 3 @ 140 kg · RPE 8 · rest 3 min · tempo 3-1-1": the prescription in one line. */
export function prescriptionLine(r: Row): string {
  const reps = prescribedReps(r);
  const sets = r.sets != null && Number(r.sets) > 0 ? Number(r.sets) : null;
  const head = sets && reps ? `${sets} × ${reps}` : sets ? `${plural(sets, "set")}` : reps ?? "";
  const load = prescribedLoad(r);
  return [head + (load ? ` @ ${load}` : ""), prescribedEffort(r), r.rest_seconds ? `rest ${pdfDuration(r.rest_seconds)}` : null, pdfText(r.tempo) ? `tempo ${pdfText(r.tempo)}` : null]
    .filter((x) => x && String(x).trim())
    .join(" · ");
}

/** A logged set's load as typed ("140 kg"), else from the stored mirrors. */
export function loggedLoad(s: LoggedSet): string | null {
  const typed = s.entered_value ?? s.actual_load;
  if (typed != null && Number(typed) !== 0) {
    const unit = String(s.entered_unit ?? s.actual_load_unit ?? "lb").toLowerCase();
    return `${pdfNumber(Number(typed), 2)} ${unit}`;
  }
  if (s.actual_load_kg != null && Number(s.actual_load_kg) > 0) return `${pdfNumber(Number(s.actual_load_kg), 2)} kg`;
  if (s.actual_load_lb != null && Number(s.actual_load_lb) > 0) return `${pdfNumber(Number(s.actual_load_lb), 2)} lb`;
  return null;
}

/** "140 kg × 5 · RPE 8", "10 min · 120 cal · RPE 6", "5.2 km · 28:30 min". */
export function loggedSetText(s: LoggedSet): string {
  const load = loggedLoad(s);
  const reps = s.actual_reps != null && Number(s.actual_reps) > 0 ? Number(s.actual_reps) : null;
  const time = s.completed_duration_seconds != null && Number(s.completed_duration_seconds) > 0 ? pdfDuration(s.completed_duration_seconds) : null;
  const dist =
    s.actual_distance_m != null && Number(s.actual_distance_m) > 0
      ? s.actual_distance_unit === "mi"
        ? `${pdfNumber(Number(s.actual_distance_m) / 1609.344, 2)} mi`
        : `${pdfNumber(Number(s.actual_distance_m) / 1000, 2)} km`
      : null;
  const cal = s.actual_calories != null && Number(s.actual_calories) > 0 ? `${Math.round(Number(s.actual_calories))} cal` : null;
  const rpe = s.actual_rpe_num ?? s.actual_rpe;
  const effort = rpe != null && rpe !== "" ? `RPE ${rpe}` : s.actual_rir != null && s.actual_rir !== "" ? `RIR ${s.actual_rir}` : null;
  const main = load && reps ? `${load} × ${reps}` : load ? load : reps ? `${reps} reps` : null;
  return [main, dist, time, cal, effort].filter(Boolean).join(" · ") || "Logged";
}

/** A row's logged sets as lines, identical sets in a row said once: "Set 1: 140 kg × 5 · RPE 8", "Sets 2–4: 135 kg × 5 · RPE 8". */
export function loggedLines(sets: LoggedSet[]): string[] {
  const list = sets.filter(loggedSetHasInput).slice().sort((a, b) => (a.set_index ?? 0) - (b.set_index ?? 0));
  const out: string[] = [];
  let i = 0;
  while (i < list.length) {
    const text = loggedSetText(list[i]);
    let j = i;
    while (j + 1 < list.length && loggedSetText(list[j + 1]) === text) j++;
    const from = list[i].set_index ?? i + 1;
    const to = list[j].set_index ?? j + 1;
    out.push(`${from === to ? `Set ${from}` : `Sets ${from}–${to}`}: ${text}`);
    i = j + 1;
  }
  return out;
}
