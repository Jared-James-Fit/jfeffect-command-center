/**
 * The powerlifting readout the check-in AI reads next to the program: for
 * squat, bench and deadlift separately, what was prescribed this week vs
 * what was logged (top set load × reps @ RPE against the prescribed RPE,
 * back-off RPE, sets done), the RPE-adjusted e1RM against recent weeks, and
 * next week's prescription with how the demand changes. Pure.
 *
 * Lifts are grouped by the coach's role labels ("Primary Squat", "Primary
 * Squat Backoff", "Secondary Bench", "Quaternary / Limiter Squat",
 * "Isolation Deadlift"...), falling back to the exercise's competition lift
 * type. GPP is nobody's. Sessions scheduled after `asOf` are "still to come",
 * never "missed": check-ins usually go out before the week is over.
 */
import { estimate1RMWithRpe } from "@/lib/analytics/e1rm";

export type Lift = "squat" | "bench" | "deadlift";
export const LIFTS: Lift[] = ["squat", "bench", "deadlift"];
const LIFT_NAME: Record<Lift, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

export type ReadoutRow = {
  id: string;
  day_id: string;
  sort_order?: number | null;
  exercise_id?: string | null;
  name: string;
  purpose_label?: string | null;
  competition_lift_type?: string | null;
  sets?: number | null;
  reps_text?: string | null;
  rpe?: string | null;
  percentage?: number | null;
};
export type ReadoutDay = { id: string; week_id: string; day_index?: number | null; date: string | null };
export type ReadoutSet = {
  row_id: string;
  set_index?: number | null;
  kg: number | null;
  reps: number | null;
  rpe: number | null;
  working?: boolean | null;
  /** "YYYY-MM-DD" it was done (history only). */
  at?: string | null;
};

/** "6-7", "6–7", "@7", "7.5" → [min, max]. */
export function parseRange(text: string | null | undefined): [number, number] | null {
  const nums = (String(text ?? "").match(/\d+(?:\.\d+)?/g) ?? []).map(Number).filter((n) => Number.isFinite(n));
  if (!nums.length) return null;
  return [Math.min(...nums), Math.max(...nums)];
}

/** Which lift a row trains: the coach's role label first, then the exercise's comp-lift type. GPP is none. */
export function liftOf(row: Pick<ReadoutRow, "purpose_label" | "competition_lift_type">): Lift | null {
  const label = String(row.purpose_label ?? "").toLowerCase();
  if (/\bgpp\b/.test(label)) return null;
  for (const l of LIFTS) if (label.includes(l)) return l;
  const t = String(row.competition_lift_type ?? "").toLowerCase();
  return (LIFTS as string[]).includes(t) ? (t as Lift) : null;
}

const isPrimary = (r: ReadoutRow) => /\bprimary\b/i.test(r.purpose_label ?? "");
const isBackoff = (r: ReadoutRow) => /back\s*-?\s*off/i.test(r.purpose_label ?? "");

function fmtLoad(kg: number, unit: "kg" | "lb"): string {
  const v = unit === "lb" ? kg * 2.2046226 : kg;
  const r = unit === "lb" ? Math.round(v) : Math.round(v * 2) / 2;
  return `${r}${unit}`;
}
const fmtRpe = (range: [number, number] | null) => (!range ? null : range[0] === range[1] ? `${range[0]}` : `${range[0]}-${range[1]}`);

function prescription(r: ReadoutRow): string {
  const rpe = fmtRpe(parseRange(r.rpe));
  const load = rpe ? ` @ RPE ${rpe}` : r.percentage ? ` @ ${r.percentage}%` : "";
  return `${r.sets ?? "?"}×${(r.reps_text ?? "?").trim()}${load}`;
}

const workingSets = (sets: ReadoutSet[]) =>
  sets.filter((s) => s.working !== false && (s.kg ?? 0) > 0 && (s.reps ?? 0) > 0);

/** Heaviest working set; ties go to more reps, then the harder RPE (the honest read). */
function topSet(sets: ReadoutSet[]): ReadoutSet | null {
  return workingSets(sets).sort((a, b) => (b.kg! - a.kg!) || (b.reps! - a.reps!) || ((b.rpe ?? 0) - (a.rpe ?? 0)))[0] ?? null;
}

/**
 * RPE-adjusted e1RM, only where RPE is a reliable read: RPE 7+ and 8 reps or
 * fewer. A set of 5 @ RPE 6 says little about a max, so it gets no number.
 */
function e1rm(s: ReadoutSet | null): number | null {
  if (!s || !s.kg || !s.reps || s.reps > 8 || s.rpe == null || s.rpe < 7) return null;
  return estimate1RMWithRpe(s.kg, s.reps, s.rpe);
}

/** This week's top set against the last session of the same exercise. */
function vsLastTime(top: ReadoutSet | null, last: ReadoutSet | null, unit: "kg" | "lb"): string | null {
  if (!top || !last || !top.kg || !last.kg || !top.reps || !last.reps) return null;
  const lastText = `${fmtLoad(last.kg, unit)} × ${last.reps}${last.rpe != null ? ` @ RPE ${last.rpe}` : ""}`;
  const sameLoad = Math.abs(top.kg - last.kg) < 1;
  if (sameLoad && top.reps === last.reps && top.rpe != null && last.rpe != null) {
    const d = +(top.rpe - last.rpe).toFixed(1);
    if (d === 0) return `same load × reps as last time at the same RPE (${lastText})`;
    return `same load × reps as last time, ${Math.abs(d)} RPE ${d < 0 ? "easier" : "harder"} (last time ${lastText})`;
  }
  if (!sameLoad && top.reps === last.reps) {
    const raw = (top.kg - last.kg) * (unit === "lb" ? 2.2046226 : 1);
    const diff = unit === "lb" ? Math.round(raw) : Math.round(raw * 2) / 2;
    return `${diff > 0 ? "+" : "−"}${Math.abs(diff)}${unit} vs last time (${lastText})`;
  }
  return `last time ${lastText}`;
}

function vsPlan(actual: number | null, plan: [number, number] | null): string | null {
  if (actual == null || !plan) return null;
  if (actual > plan[1]) return `${+(actual - plan[1]).toFixed(1)} RPE over plan`;
  if (actual < plan[0]) return `${+(plan[0] - actual).toFixed(1)} RPE under plan`;
  return "on plan";
}

export type LiftReadout = {
  lift: Lift;
  /** Main exercise (the primary top-set row's). */
  exercise: string | null;
  prescribed: string | null;
  top: string | null;
  top_vs_plan: string | null;
  backoff: string | null;
  backoff_vs_plan: string | null;
  /** The main top-set row's day has passed (so "not logged" means something). */
  top_due: boolean;
  sets_done: number;
  sets_due: number;
  sets_to_come: number;
  vs_last: string | null;
  e1rm: string | null;
  e1rm_change: string | null;
};
export type LiftNext = { lift: Lift; prescribed: string | null; top_rpe_change: string | null; sets: string | null };
export type TrainingReadout = { unit: "kg" | "lb"; this_week: LiftReadout[]; next_week: LiftNext[] };

/**
 * `rows` / `days` cover this week and next week. `sets` are this week's
 * logged sets; `history` are earlier logged sets OF THIS BLOCK (with their
 * rows in `historyRows`) for "vs last time" and the e1RM baseline. Never pass
 * another block's sets: off-season 5s against last block's peak singles is
 * not a comparison.
 */
export function buildTrainingReadout(input: {
  thisWeekId: string | null;
  nextWeekId: string | null;
  days: ReadoutDay[];
  rows: ReadoutRow[];
  sets: ReadoutSet[];
  history?: ReadoutSet[];
  historyRows?: Array<Pick<ReadoutRow, "id" | "exercise_id" | "name">>;
  asOf: string;
  unit: "kg" | "lb";
}): TrainingReadout | null {
  const { unit } = input;
  const dayById = new Map(input.days.map((d) => [d.id, d]));
  const setsByRow = new Map<string, ReadoutSet[]>();
  for (const s of input.sets) setsByRow.set(s.row_id, [...(setsByRow.get(s.row_id) ?? []), s]);
  const order = (a: ReadoutRow, b: ReadoutRow) => {
    const da = dayById.get(a.day_id);
    const db = dayById.get(b.day_id);
    return (da?.day_index ?? 0) - (db?.day_index ?? 0) || (a.sort_order ?? 0) - (b.sort_order ?? 0);
  };
  const rowsFor = (weekId: string | null, lift: Lift) =>
    weekId
      ? input.rows.filter((r) => dayById.get(r.day_id)?.week_id === weekId && liftOf(r) === lift).sort(order)
      : [];

  // Earlier sets of this block, per exercise: best reliable e1RM and the last session.
  const histRow = new Map((input.historyRows ?? []).map((r) => [r.id, r]));
  const bestPrev = new Map<string, number>();
  const byExercise = new Map<string, ReadoutSet[]>();
  for (const s of input.history ?? []) {
    const r = histRow.get(s.row_id);
    const key = r?.exercise_id ?? r?.name;
    if (!key) continue;
    byExercise.set(key, [...(byExercise.get(key) ?? []), s]);
    const v = e1rm(s);
    if (v != null && v > (bestPrev.get(key) ?? 0)) bestPrev.set(key, v);
  }
  const lastSessionTop = (key: string | null | undefined) => {
    const list = key ? byExercise.get(key) ?? [] : [];
    const last = list.map((s) => s.at ?? "").filter(Boolean).sort().pop();
    return last ? topSet(list.filter((s) => s.at === last)) : null;
  };

  const thisWeek: LiftReadout[] = [];
  const nextWeek: LiftNext[] = [];
  for (const lift of LIFTS) {
    const cur = rowsFor(input.thisWeekId, lift);
    const nxt = rowsFor(input.nextWeekId, lift);
    const primary = cur.filter(isPrimary);
    const main = primary.find((r) => !isBackoff(r)) ?? primary[0] ?? cur.find((r) => r.competition_lift_type === lift) ?? null;
    const backoffs = primary.filter(isBackoff);

    if (cur.length) {
      // Due = its day has passed, or it's already logged (a session done early
      // counts). Today's session isn't due yet: they may train after answering.
      const isDue = (r: ReadoutRow) => {
        const d = dayById.get(r.day_id)?.date;
        return !d || d < input.asOf || workingSets(setsByRow.get(r.id) ?? []).length > 0;
      };
      const due = cur.filter(isDue);
      const toCome = cur.filter((r) => !due.includes(r));
      const done = due.reduce((n, r) => n + workingSets(setsByRow.get(r.id) ?? []).length, 0);
      const dueSets = due.reduce((n, r) => n + (r.sets ?? 0), 0);
      const top = main ? topSet(setsByRow.get(main.id) ?? []) : null;
      const boSets = backoffs.flatMap((r) => workingSets(setsByRow.get(r.id) ?? []));
      const boRpes = boSets.map((s) => s.rpe).filter((v): v is number => v != null);
      const boAvg = boRpes.length ? +(boRpes.reduce((a, b) => a + b, 0) / boRpes.length).toFixed(1) : null;
      const est = e1rm(top);
      const key = main ? main.exercise_id ?? main.name : null;
      const prev = key ? bestPrev.get(key) : undefined;
      thisWeek.push({
        lift,
        exercise: main?.name ?? null,
        prescribed: primary.length ? primary.map(prescription).join(" + ") : main ? prescription(main) : null,
        top: top ? `${fmtLoad(top.kg!, unit)} × ${top.reps}${top.rpe != null ? ` @ RPE ${top.rpe}` : ""}` : null,
        top_vs_plan: vsPlan(top?.rpe ?? null, main ? parseRange(main.rpe) : null),
        backoff: boSets.length ? `${boSets.length} sets${boAvg != null ? ` avg RPE ${boAvg}` : ""}` : null,
        backoff_vs_plan: backoffs[0] ? vsPlan(boAvg, parseRange(backoffs[0].rpe)) : null,
        top_due: !!main && isDue(main),
        sets_done: done,
        sets_due: dueSets,
        sets_to_come: toCome.reduce((n, r) => n + (r.sets ?? 0), 0),
        vs_last: vsLastTime(top, lastSessionTop(key), unit),
        e1rm: est ? fmtLoad(est, unit) : null,
        e1rm_change: est && prev ? `${est >= prev ? "+" : ""}${(((est - prev) / prev) * 100).toFixed(1)}% vs best earlier this block (${fmtLoad(prev, unit)})` : null,
      });
    }

    if (nxt.length) {
      const nPrimary = nxt.filter(isPrimary);
      const nMain = nPrimary.find((r) => !isBackoff(r)) ?? nPrimary[0] ?? null;
      const before = fmtRpe(main ? parseRange(main.rpe) : null);
      const after = fmtRpe(nMain ? parseRange(nMain.rpe) : null);
      const curSets = cur.reduce((n, r) => n + (r.sets ?? 0), 0);
      const nSets = nxt.reduce((n, r) => n + (r.sets ?? 0), 0);
      nextWeek.push({
        lift,
        prescribed: nPrimary.length ? `${nMain?.name ?? ""} ${nPrimary.map(prescription).join(" + ")}`.trim() : null,
        top_rpe_change: before && after && before !== after ? `top set RPE ${before} → ${after}` : null,
        sets: cur.length ? `${LIFT_NAME[lift].toLowerCase()} sets ${curSets} → ${nSets}` : `${nSets} ${LIFT_NAME[lift].toLowerCase()} sets`,
      });
    }
  }
  if (!thisWeek.length && !nextWeek.length) return null;
  return { unit, this_week: thisWeek, next_week: nextWeek };
}

export function trainingReadoutText(r: TrainingReadout | null | undefined): string {
  if (!r) return "";
  const lines: string[] = [];
  if (r.this_week.length) {
    lines.push("TRAINING READOUT (week just trained, logged vs prescribed, per lift):");
    for (const l of r.this_week) {
      const bits = [
        l.exercise && `${l.exercise}`,
        l.prescribed && `prescribed ${l.prescribed}`,
        l.top ? `top set ${l.top}${l.top_vs_plan ? ` (${l.top_vs_plan})` : ""}` : l.top_due ? "top set day passed with nothing logged" : null,
        l.backoff && `back-offs ${l.backoff}${l.backoff_vs_plan ? ` (${l.backoff_vs_plan})` : ""}`,
        l.sets_due === 0 && l.sets_to_come
          ? `${l.lift} not trained yet this week (${l.sets_to_come} sets still to come)`
          : `${l.sets_done}/${l.sets_due} ${l.lift} sets logged so far${l.sets_to_come ? `, ${l.sets_to_come} still to come this week` : ""}`,
        l.vs_last,
        l.e1rm && `RPE-adjusted e1RM ~${l.e1rm}${l.e1rm_change ? ` (${l.e1rm_change})` : ""}`,
      ].filter(Boolean);
      lines.push(`- ${LIFT_NAME[l.lift]}: ${bits.join(" · ")}`);
    }
  }
  if (r.next_week.length) {
    lines.push("NEXT WEEK'S PRESCRIPTION (per lift):");
    for (const n of r.next_week) {
      lines.push(`- ${LIFT_NAME[n.lift]}: ${[n.prescribed, n.top_rpe_change, n.sets].filter(Boolean).join(" · ")}`);
    }
  }
  return lines.join("\n");
}
