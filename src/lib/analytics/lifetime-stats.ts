/**
 * Lifetime training: everything logged in JF Effect, added up once (pure,
 * deterministic, tested), for the analytics Lifetime section.
 *
 * What's counted, and what isn't:
 *  - a set is a working set that was done (reps logged and saved); warm-ups
 *    live in their own table and are never here;
 *  - loaded volume is weight × reps of sets with an external load only. A
 *    bodyweight set adds its set and reps, never a made-up weight; an
 *    assisted set (a machine taking weight off) adds nothing to volume;
 *  - a workout is a program day with at least one logged set (a day trained
 *    twice is still one workout), on the day it started (a set typed after
 *    midnight stays with it, as on the calendar); "finished" ones are the
 *    ones Finish was tapped on;
 *  - a block counts as completed when its status is Completed and something
 *    in it was trained;
 *  - PRs are the Strength tab's all-time records (recentPRs over everything);
 *  - kg and lb come from the same stored load (the kg mirror's factor), so
 *    the two totals are the same weight said twice.
 * Coverage says what isn't here: training before the first set logged in the
 * app, and sets logged with no weight.
 */
import { liftOf, type Lift } from "@/lib/analytics/training-load";

const DAY = 86_400_000;

export type LifetimeBlock = {
  id: string;
  name: string;
  status: string | null;
  start: string | null;
};

export type LifetimeGroup = {
  key: string;
  label: string;
  volumeLb: number;
  sets: number;
  reps: number;
  workouts: number;
};

export type Milestone = {
  label: string;
  reached: string | null;
  kind: "volume" | "workouts" | "sets";
};

export type LifetimeStats = {
  volumeLb: number;
  sets: number;
  loadedSets: number;
  bodyweightSets: number;
  assistedSets: number;
  reps: number;
  workouts: number;
  finishedWorkouts: number;
  trainingDays: number;
  blocksCompleted: number;
  prs: number;
  first: string | null;
  last: string | null;
  /** each month: its volume and the running total (oldest first) */
  months: Array<{
    month: string;
    volumeLb: number;
    cumulativeLb: number;
    workouts: number;
    sets: number;
  }>;
  byYear: LifetimeGroup[];
  byBlock: LifetimeGroup[];
  byExercise: LifetimeGroup[];
  byLift: LifetimeGroup[];
  /** reached (with the day) and the next one, per kind */
  milestones: { reached: Milestone[]; next: Array<Milestone & { progress: number }> };
  coverage: { noWeightSets: number; unratedSets: number; since: string | null };
};

function localDay(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso).slice(0, 10);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const VOLUME_MILESTONES_LB = [
  100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000, 50_000_000,
];
const VOLUME_MILESTONES_KG = [
  50_000, 100_000, 250_000, 500_000, 1_000_000, 2_500_000, 5_000_000, 10_000_000, 25_000_000,
];
const WORKOUT_MILESTONES = [10, 25, 50, 100, 250, 500, 1000];
const SET_MILESTONES = [1000, 2500, 5000, 10_000, 25_000, 50_000];
const LIFT_NAME: Record<Lift, string> = {
  squat: "Squat & variations",
  bench: "Bench & variations",
  deadlift: "Deadlift & variations",
};

const exKey = (r: any) =>
  r.exercise_id
    ? `id:${r.exercise_id}`
    : `name:${String(r.exercise_name ?? "")
        .trim()
        .toLowerCase()}`;

/** The read. `results` are getClientResults rows (load lb). `dayBlock` maps a program day to its block. */
export function buildLifetimeStats(input: {
  results: any[];
  finishedDayIds?: Iterable<string>;
  blocks?: LifetimeBlock[];
  dayBlock?: Map<string, string>;
  prCount?: number;
  /** milestones in this unit's round numbers */
  unit?: "lb" | "kg";
  lbPerKg?: number;
}): LifetimeStats {
  const lbPerKg = input.lbPerKg ?? 2.2046226;
  const rows = (input.results ?? [])
    .filter((r) => r?.date && Number(r.reps) > 0)
    .slice()
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const finished = new Set(input.finishedDayIds ?? []);
  const blockName = new Map((input.blocks ?? []).map((b) => [b.id, b.name]));
  let volume = 0;
  let loaded = 0;
  let bw = 0;
  let assisted = 0;
  let reps = 0;
  let noWeight = 0;
  let unrated = 0;
  const workouts = new Set<string>();
  const days = new Set<string>();
  const months = new Map<string, { volumeLb: number; workouts: Set<string>; sets: number }>();
  const groups = {
    year: new Map<string, LifetimeGroup & { w: Set<string> }>(),
    block: new Map<string, LifetimeGroup & { w: Set<string> }>(),
    exercise: new Map<string, LifetimeGroup & { w: Set<string> }>(),
    lift: new Map<string, LifetimeGroup & { w: Set<string> }>(),
  };
  const add = (
    map: Map<string, LifetimeGroup & { w: Set<string> }>,
    key: string,
    label: string,
    v: number,
    r: number,
    wk: string,
  ) => {
    const g = map.get(key) ?? {
      key,
      label,
      volumeLb: 0,
      sets: 0,
      reps: 0,
      workouts: 0,
      w: new Set<string>(),
    };
    g.volumeLb += v;
    g.sets += 1;
    g.reps += r;
    g.w.add(wk);
    g.label = label;
    map.set(key, g);
  };
  // milestone days: when the running totals crossed each line
  const unit = input.unit ?? "lb";
  const volMilestones =
    unit === "kg" ? VOLUME_MILESTONES_KG.map((k) => k * lbPerKg) : VOLUME_MILESTONES_LB;
  const reached: Milestone[] = [];
  let vi = 0;
  let si = 0;
  let wi = 0;
  let setCount = 0;
  const workoutOrder: string[] = [];
  const seenWorkout = new Set<string>();

  // a workout's sets belong to the day it started (one typed after midnight stays with it), as on the calendar
  const sessionDay = new Map<string, string>();
  for (const r of rows)
    if (r.day_id && !sessionDay.has(r.day_id)) sessionDay.set(r.day_id, localDay(r.date));
  for (const r of rows) {
    const day = (r.day_id && sessionDay.get(r.day_id)) || localDay(r.date);
    const n = Number(r.reps) || 0;
    const load = Number(r.load) || 0;
    const type =
      r.load_type === "assisted"
        ? "assisted"
        : r.load_type === "bodyweight" || r.is_bodyweight
          ? "bodyweight"
          : "external";
    const counts = type === "external" && r.counts_load !== false && load > 0;
    const v = counts ? load * n : 0;
    const wk = r.day_id ?? `day:${day}`;
    volume += v;
    reps += n;
    setCount += 1;
    if (counts) loaded++;
    else if (type === "bodyweight") bw++;
    else if (type === "assisted") assisted++;
    else noWeight++;
    if (r.rpe == null && r.rir == null) unrated++;
    workouts.add(wk);
    days.add(day);
    if (!seenWorkout.has(wk)) {
      seenWorkout.add(wk);
      workoutOrder.push(day);
    }
    const m = day.slice(0, 7);
    const mo = months.get(m) ?? { volumeLb: 0, workouts: new Set<string>(), sets: 0 };
    mo.volumeLb += v;
    mo.workouts.add(wk);
    mo.sets += 1;
    months.set(m, mo);
    add(groups.year, day.slice(0, 4), day.slice(0, 4), v, n, wk);
    const bid = r.day_id ? input.dayBlock?.get(r.day_id) : undefined;
    add(
      groups.block,
      bid ?? "none",
      bid ? (blockName.get(bid) ?? "Block") : "Not in a block",
      v,
      n,
      wk,
    );
    add(groups.exercise, exKey(r), r.exercise_name ?? "Exercise", v, n, wk);
    const lift = liftOf({
      rowFamily: r.movement_family ?? null,
      competitionLiftType: r.competition_lift_type ?? null,
      exerciseFamily: r.exercise_movement_family ?? null,
      exercise: r.exercise_name ?? "",
    });
    add(groups.lift, lift ?? "other", lift ? LIFT_NAME[lift] : "Everything else", v, n, wk);
    while (vi < volMilestones.length && volume >= volMilestones[vi]) {
      const val = unit === "kg" ? VOLUME_MILESTONES_KG[vi] : VOLUME_MILESTONES_LB[vi];
      reached.push({
        kind: "volume",
        label: `${val.toLocaleString("en-US")} ${unit} lifted`,
        reached: day,
      });
      vi++;
    }
    while (si < SET_MILESTONES.length && setCount >= SET_MILESTONES[si]) {
      reached.push({
        kind: "sets",
        label: `${SET_MILESTONES[si].toLocaleString("en-US")} sets`,
        reached: day,
      });
      si++;
    }
    while (wi < WORKOUT_MILESTONES.length && workoutOrder.length >= WORKOUT_MILESTONES[wi]) {
      reached.push({
        kind: "workouts",
        label: `${WORKOUT_MILESTONES[wi]} workouts`,
        reached: workoutOrder[WORKOUT_MILESTONES[wi] - 1],
      });
      wi++;
    }
  }

  const monthKeys = [...months.keys()].sort();
  // every month between the first and the last, a quiet one as zero
  const filled: string[] = [];
  if (monthKeys.length) {
    let [y, mo] = monthKeys[0].split("-").map(Number);
    const [ly, lm] = monthKeys[monthKeys.length - 1].split("-").map(Number);
    while (y < ly || (y === ly && mo <= lm)) {
      filled.push(`${y}-${String(mo).padStart(2, "0")}`);
      mo++;
      if (mo > 12) {
        mo = 1;
        y++;
      }
    }
  }
  let cum = 0;
  const monthRows = filled.map((m) => {
    const x = months.get(m);
    cum += x?.volumeLb ?? 0;
    return {
      month: m,
      volumeLb: Math.round(x?.volumeLb ?? 0),
      cumulativeLb: Math.round(cum),
      workouts: x?.workouts.size ?? 0,
      sets: x?.sets ?? 0,
    };
  });
  const finalize = (map: Map<string, LifetimeGroup & { w: Set<string> }>, sort: "volume" | "key") =>
    [...map.values()]
      .map(({ w, ...g }) => ({ ...g, volumeLb: Math.round(g.volumeLb), workouts: w.size }))
      .sort((a, b) =>
        sort === "key" ? a.key.localeCompare(b.key) : b.volumeLb - a.volumeLb || b.sets - a.sets,
      );

  const next: Array<Milestone & { progress: number }> = [];
  if (vi < volMilestones.length) {
    const val = unit === "kg" ? VOLUME_MILESTONES_KG[vi] : VOLUME_MILESTONES_LB[vi];
    next.push({
      kind: "volume",
      label: `${val.toLocaleString("en-US")} ${unit} lifted`,
      reached: null,
      progress: Math.min(1, volume / volMilestones[vi]),
    });
  }
  if (wi < WORKOUT_MILESTONES.length) {
    next.push({
      kind: "workouts",
      label: `${WORKOUT_MILESTONES[wi]} workouts`,
      reached: null,
      progress: Math.min(1, workouts.size / WORKOUT_MILESTONES[wi]),
    });
  }
  if (si < SET_MILESTONES.length) {
    next.push({
      kind: "sets",
      label: `${SET_MILESTONES[si].toLocaleString("en-US")} sets`,
      reached: null,
      progress: Math.min(1, setCount / SET_MILESTONES[si]),
    });
  }

  const trainedBlocks = new Set<string>();
  for (const r of rows) {
    const b = r.day_id ? input.dayBlock?.get(r.day_id) : undefined;
    if (b) trainedBlocks.add(b);
  }
  const blocksCompleted = (input.blocks ?? []).filter(
    (b) => String(b.status ?? "").toLowerCase() === "completed" && trainedBlocks.has(b.id),
  ).length;
  const dayKeys = [...days].sort();
  return {
    volumeLb: Math.round(volume),
    sets: rows.length,
    loadedSets: loaded,
    bodyweightSets: bw,
    assistedSets: assisted,
    reps,
    workouts: workouts.size,
    finishedWorkouts: [...workouts].filter((w) => finished.has(w)).length,
    trainingDays: days.size,
    blocksCompleted,
    prs: input.prCount ?? 0,
    first: dayKeys[0] ?? null,
    last: dayKeys.at(-1) ?? null,
    months: monthRows,
    byYear: finalize(groups.year, "key"),
    byBlock: finalize(groups.block, "volume").filter((g) => g.key !== "none" || g.sets > 0),
    byExercise: finalize(groups.exercise, "volume"),
    byLift: finalize(groups.lift, "volume"),
    milestones: {
      reached: reached.sort((a, b) => String(b.reached).localeCompare(String(a.reached))),
      next,
    },
    coverage: { noWeightSets: noWeight, unratedSets: unrated, since: dayKeys[0] ?? null },
  };
}

/** Weeks between two days, at least 1 (for "a week" averages over a whole history). */
export function weeksBetween(a: string, b: string): number {
  return Math.max(
    1,
    Math.round((Date.parse(`${b}T12:00:00Z`) - Date.parse(`${a}T12:00:00Z`)) / DAY / 7),
  );
}
