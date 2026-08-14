/**
 * Post-workout PR collection + "positive takeaway" lines.
 *
 * PRs reuse the exact same detection used by the in-logger trophy badges
 * (`detectSetPR` / `detectAssistedSetPR`) so the celebration screen can never
 * disagree with the set rows. No PR is fabricated — a lift with no history
 * simply produces no PR.
 */
import { detectAssistedSetPR, detectSetPR } from "./workout-pr";
import type { PreviousLiftLog } from "./workout-previous-lift";
import type { WorkoutSummary } from "./workout-summary";

export type SessionPR = {
  exerciseName: string;
  reps: number;
  amount: number;
  unit: "kg" | "lb";
  assisted: boolean;
};

type PRRow = {
  id: string;
  exercises?: { name?: string | null } | null;
  exercise_name_override?: string | null;
};

type PRResult = {
  row_id: string;
  actual_reps: number | null;
  actual_load: number | null;
  actual_load_unit: "kg" | "lb" | null;
  completed_at: string | null;
  load_type?: string | null;
  is_bodyweight?: boolean | null;
};

/** Best PR per exercise for the current session. */
export function collectSessionPRs(
  rows: PRRow[],
  results: PRResult[],
  repMaxBestsByRow: Map<string, Map<number, PreviousLiftLog>>,
  assistedBestsByRow: Map<string, Map<number, PreviousLiftLog>>,
  displayUnit: "kg" | "lb",
): SessionPR[] {
  const nameByRow = new Map<string, string>();
  for (const r of rows) {
    nameByRow.set(r.id, r.exercise_name_override || r.exercises?.name || "Exercise");
  }

  const bestByExercise = new Map<string, SessionPR>();
  for (const res of results) {
    if (!res.completed_at) continue;
    const name = nameByRow.get(res.row_id);
    if (!name) continue;
    const loadType = res.load_type ?? (res.is_bodyweight ? "bodyweight" : "external");
    if (loadType === "bodyweight") continue;
    const setInput = {
      reps: res.actual_reps != null ? Number(res.actual_reps) : null,
      load: res.actual_load != null ? Number(res.actual_load) : null,
      loadUnit: res.actual_load_unit === "kg" || res.actual_load_unit === "lb"
        ? res.actual_load_unit
        : displayUnit,
    };
    let pr: SessionPR | null = null;
    if (loadType === "assisted") {
      const bests = assistedBestsByRow.get(res.row_id);
      const hit = bests ? detectAssistedSetPR(setInput, bests, displayUnit) : null;
      if (hit) pr = { exerciseName: name, reps: hit.reps, amount: hit.amount, unit: hit.unit, assisted: true };
    } else {
      const bests = repMaxBestsByRow.get(res.row_id);
      const hit = bests ? detectSetPR(setInput, bests, displayUnit) : null;
      if (hit) pr = { exerciseName: name, reps: hit.reps, amount: hit.amount, unit: hit.unit, assisted: false };
    }
    if (!pr) continue;
    const prev = bestByExercise.get(name);
    if (!prev || pr.amount > prev.amount) bestByExercise.set(name, pr);
  }
  return [...bestByExercise.values()].sort((a, b) => b.amount - a.amount);
}

export function formatPR(pr: SessionPR): string {
  return pr.assisted
    ? `${pr.exerciseName} — ${pr.reps} reps at ${pr.amount} ${pr.unit} less assistance`
    : `${pr.exerciseName} — ${pr.reps}-rep PR, +${pr.amount} ${pr.unit}`;
}

export type CardioTakeawayInput = {
  status: "not_started" | "logged" | "skipped";
  minutes?: number | null;
} | null;

/**
 * Up to three short positive/actionable lines. Always returns at least one —
 * showing up is itself the takeaway on a rough day.
 */
export function buildWorkoutTakeaways(
  summary: WorkoutSummary,
  prs: SessionPR[],
  cardio: CardioTakeawayInput = null,
): string[] {
  const out: string[] = [];

  if (prs.length === 1) out.push(`🏆 New PR: ${formatPR(prs[0])}.`);
  else if (prs.length > 1) out.push(`🏆 ${prs.length} new PRs today — led by ${formatPR(prs[0])}.`);

  if (summary.completionPct >= 100 && summary.prescribedSets > 0) {
    out.push(`✅ Every prescribed set completed (${summary.completedSets}/${summary.prescribedSets}).`);
  } else if (summary.completionPct >= 80) {
    out.push(`✅ ${summary.completionPct}% of the plan completed — the important work got done.`);
  }

  if (summary.totalLifted > 0) {
    out.push(`💪 ${summary.totalLiftedFmt} moved across ${summary.completedSets} set${summary.completedSets === 1 ? "" : "s"}.`);
  }

  if (cardio?.status === "logged") {
    out.push(
      cardio.minutes && cardio.minutes > 0
        ? `❤️ Cardio logged — ${cardio.minutes} min in the bank.`
        : "❤️ Prescribed cardio logged.",
    );
  } else if (cardio?.status === "not_started") {
    out.push("❤️ Cardio is still open for today — log it when it's done.");
  }

  if (summary.avgRpe != null && summary.avgRpe >= 8 && out.length < 3) {
    out.push(`🔥 Average RPE ${summary.avgRpe} — you worked close to the top end.`);
  }

  if (out.length === 0) out.push("✅ Session logged. Showing up is the habit that compounds.");
  return out.slice(0, 3);
}