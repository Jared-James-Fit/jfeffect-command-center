/**
 * How Generate Next Program decides a load is written: RPE, RIR, a % of a max
 * (with an RPE cap), or a % of today's top set. The model picks per exercise
 * (LOADING_RULES in the prompts); this file is what's checked in code:
 *
 * - loadingRefsFrom: which maxes are actually on file per competition lift
 *   (a training max, a tested 1RM, an e1RM stored or worth working out from
 *   their logged sets), so the prompt can say so and nothing invents one.
 * - withLoadingGuard: every built block, before it's kept. A % of a max on an
 *   exercise that isn't a competition lift or its barbell variation (a raise,
 *   a curl, a machine) is dropped for RPE / RIR; a % of a max the athlete has
 *   no such max for falls back to their logged e1RM when there is one, else to
 *   the RPE that load means for those reps; a % of the top set with no top set
 *   of the same exercise before it becomes RPE. What changed is listed.
 */
import { percentOf1RM } from "@/lib/load-suggestion";
import { E1RM_MIN_SESSIONS, E1RM_WINDOW_DAYS, isCompetitionMaxName, isLiftFamily, type LiftFamily } from "@/lib/workouts/load-reference";
import type { BuiltBlock, BuiltExercise } from "./generator-schemas";
import type { LiftReport, RawMax } from "./types";

export type LoadingBasis = "training_max" | "1rm" | "e1rm" | "top_set";
export type LiftRefs = { tm: boolean; oneRm: boolean; e1rm: boolean };
export type LoadingRefs = Record<LiftFamily, LiftRefs>;

const LIFTS: LiftFamily[] = ["squat", "bench", "deadlift"];
const LIFT_LABEL: Record<LiftFamily, string> = { squat: "Squat", bench: "Bench", deadlift: "Deadlift" };

/** What's on file per competition lift: the athlete's own maxes, and whether their logs give a recent e1RM (2+ sessions in 6 weeks). */
export function loadingRefsFrom(maxes: RawMax[], lifts: Pick<LiftReport, "lift" | "compTrend">[], now: number = Date.now()): LoadingRefs {
  const out = {} as LoadingRefs;
  for (const fam of LIFTS) {
    const live = maxes.filter((m) => m.active !== false && isCompetitionMaxName(String(m.lift ?? ""), fam));
    const has = (k: "training_max" | "one_rm" | "estimated_1rm") => live.some((m) => Number(m[k]) > 0);
    const points = lifts.find((l) => l.lift === fam)?.compTrend.points ?? [];
    const recent = points.filter((p) => now - Date.parse(p.date) <= E1RM_WINDOW_DAYS * 86_400_000);
    out[fam] = { tm: has("training_max"), oneRm: has("one_rm"), e1rm: has("estimated_1rm") || new Set(recent.map((p) => p.date)).size >= E1RM_MIN_SESSIONS };
  }
  return out;
}

/** The lines the construction prompt reads: what a percentage may reference for this athlete. */
export function loadingRefsText(refs: LoadingRefs): string {
  const lines = LIFTS.map((fam) => {
    const r = refs[fam];
    const on = [r.tm && "training_max", r.oneRm && "1rm", r.e1rm && "e1rm"].filter(Boolean);
    return `- ${LIFT_LABEL[fam]}: ${on.length ? `percentage_of may be ${on.join(" / ")}` : "no max on file: RPE only (a top_set back-off is still fine)"}`;
  });
  return `Loading references (what a percentage may read, per competition lift; a variation reads its lift's):\n${lines.join("\n")}`;
}

/** The RPE a load means for these reps (the RPE chart), when a % can't be kept: "80% for 5" ≈ RPE 7.5, clamped to 5–9. */
export function rpeForPercent(pct: number, reps: string | null | undefined): string {
  const r = Number(String(reps ?? "").match(/\d+/)?.[0] ?? 5);
  let best = { rir: 3, gap: Infinity };
  for (let rir = 0; rir <= 6; rir += 0.5) {
    const f = percentOf1RM(Math.max(1, r), rir);
    if (f == null) continue;
    const gap = Math.abs(f * 100 - pct);
    if (gap < best.gap) best = { rir, gap };
  }
  const rpe = Math.min(9, Math.max(5, 10 - best.rir));
  return String(Math.round(rpe * 2) / 2);
}

type Rx = { percentage?: number | null; percentage_of?: LoadingBasis | null; rpe?: string | null; rir?: string | null; reps?: string | null };

/** One prescription's load checked against what's on file; null = keep it as written. */
function checkRx(rx: Rx, basis: LoadingBasis, fam: LiftFamily | null, refs: LoadingRefs, hasTopSetBefore: boolean, reps: string | null | undefined):
  | { keep: true }
  | { keep: false; patch: Partial<Rx>; why: string } {
  const pct = Number(rx.percentage);
  const rpeOrRir = (fallback: string) => (rx.rpe || rx.rir ? {} : { rpe: fallback });
  if (basis === "top_set") {
    if (hasTopSetBefore) return { keep: true };
    return { keep: false, patch: { percentage: null, percentage_of: null, ...rpeOrRir("7") }, why: "no top set of it before it in the day" };
  }
  if (!fam) {
    return { keep: false, patch: { percentage: null, percentage_of: null, ...(rx.rpe || rx.rir ? {} : { rir: "2" }) }, why: "accessory work stays RPE / RIR" };
  }
  const r = refs[fam];
  const onFile = basis === "training_max" ? r.tm : basis === "1rm" ? r.oneRm : r.e1rm;
  if (onFile) return { keep: true };
  // their logged e1RM stands in for a missing tested 1RM (the same thing, read from the training);
  // a missing training max never does (a TM is deliberately lighter): that one becomes RPE
  if (basis === "1rm" && r.e1rm) return { keep: false, patch: { percentage_of: "e1rm" }, why: `no ${LIFT_LABEL[fam].toLowerCase()} 1RM on file, their logged e1RM instead` };
  return {
    keep: false,
    patch: { percentage: null, percentage_of: null, ...(rx.rpe || rx.rir ? {} : { rpe: rpeForPercent(pct, reps) }) },
    why: `no ${LIFT_LABEL[fam].toLowerCase()} ${basis === "training_max" ? "training max" : basis === "1rm" ? "1RM" : "e1RM"} on file`,
  };
}

/**
 * Every exercise's load (and each week's) checked against what's on file. `familyOf`
 * says which competition lift an exercise is or varies (null for accessories).
 */
export function withLoadingGuard(
  block: BuiltBlock,
  refs: LoadingRefs,
  familyOf: (exerciseId: string | null | undefined, name: string) => LiftFamily | null,
): { block: BuiltBlock; changed: string[] } {
  const changed: string[] = [];
  const days = block.days.map((d) => {
    const exercises = d.exercises.map((ex, i): BuiltExercise => {
      const famRaw = familyOf(ex.exercise_id, ex.exercise_name);
      const fam = isLiftFamily(famRaw) ? famRaw : null;
      const topSetBefore = d.exercises.slice(0, i).some((p) => (ex.exercise_id ? p.exercise_id === ex.exercise_id : p.exercise_name === ex.exercise_name));
      let next: BuiltExercise = ex;
      if (ex.percentage != null) {
        const basis = (ex.percentage_of ?? "e1rm") as LoadingBasis;
        const res = checkRx(ex, basis, fam, refs, topSetBefore, ex.reps);
        if (!res.keep) {
          next = { ...next, ...res.patch } as BuiltExercise;
          changed.push(`${ex.exercise_name} (${d.title}): ${ex.percentage}% ${basis.replace("_", " ")} → ${res.patch.percentage === null ? (next.rpe ? `RPE ${next.rpe}` : next.rir ? `${next.rir} RIR` : "RPE") : `${ex.percentage}% e1RM`}, ${res.why}`);
        }
      }
      if (next.weeks?.length) {
        const weeks = next.weeks.map((w) => {
          if (w.percentage == null) return w;
          // the week's own basis, else the one the exercise was written with (never a patched one)
          const basis = ((w as Rx).percentage_of ?? ex.percentage_of ?? "e1rm") as LoadingBasis;
          const res = checkRx({ ...w, rpe: w.rpe ?? ex.rpe, rir: w.rir ?? ex.rir }, basis, fam, refs, topSetBefore, w.reps ?? ex.reps);
          // a kept week names its basis, so it never inherits a patched one
          if (res.keep) return { ...w, percentage_of: basis };
          return { ...w, ...res.patch } as typeof w;
        });
        next = { ...next, weeks };
      }
      return next;
    });
    return { ...d, exercises };
  });
  return { block: { ...block, days }, changed };
}
