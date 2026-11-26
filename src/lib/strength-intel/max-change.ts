/**
 * Which running blocks a change to a max would move (pure, tested in
 * strength-intel.test.ts). A block that intentionally uses fixed percentages
 * must not change under the athlete mid-block without the coach saying so, so
 * the maxes panel asks before it saves: "Block 2 reads this max in 8 upcoming
 * workouts. Use the new numbers there too, or keep the block on the old ones?"
 *
 * The rows are `pl_upcoming_percent_rows` (the % sets on running blocks that
 * nothing has touched); each is worked out by the logger's own rule
 * (computeRowLoad over buildMaxIndex: the exercise's own max, else its lift's
 * competition max, a block's row winning) with the maxes before and after the
 * change. A set moves when its load changes. A % of Est. 1RM with no stored
 * estimate reads the live strength read on both sides, so it isn't counted
 * here: a pin is the coach's own move.
 */
import { buildMaxIndex, computeRowLoad, type ClientMaxRow } from "@/lib/pl-maxes";
import { referenceFamily } from "@/lib/workouts/load-reference";

export type UpcomingPercentRow = {
  id: string;
  day_id: string;
  date: string | null;
  block_id: string;
  block_name: string | null;
  exercise: string | null;
  percentage: number | string | null;
  percentage_basis: string | null;
  movement_family: string | null;
  competition_lift_type: string | null;
  exercise_family: string | null;
};

export type MovedBlock = {
  blockId: string;
  name: string;
  /** workouts with at least one set whose load would change */
  workouts: number;
  sets: number;
  /** one set as it reads now and after the change, for the question's words */
  example: { exercise: string; label: string | null; from: number | null; to: number | null; unit: "kg" | "lb" } | null;
};

function loadOf(r: UpcomingPercentRow, maxes: ClientMaxRow[], unit: "kg" | "lb") {
  const family = referenceFamily({ rowFamily: r.movement_family, competitionLiftType: r.competition_lift_type, movementFamily: r.exercise_family });
  const ownCompetition = !!family && String(r.competition_lift_type ?? "").toLowerCase() === family;
  const index = buildMaxIndex(maxes.filter((m) => !m.block_id || m.block_id === r.block_id));
  return computeRowLoad({
    exerciseName: r.exercise,
    basis: r.percentage_basis,
    percentage: r.percentage == null ? null : Number(r.percentage),
    manualLoadKg: null,
    manualLoadLb: null,
    unit,
    maxesIndex: index,
    family,
    ownCompetition,
  });
}

/** The running blocks whose upcoming % sets a change from `before` to `after` would move. */
export function blocksMovedByMaxChange(
  rows: UpcomingPercentRow[],
  before: ClientMaxRow[],
  after: ClientMaxRow[],
  unit: "kg" | "lb",
): MovedBlock[] {
  const byBlock = new Map<string, { name: string; days: Set<string>; sets: number; example: MovedBlock["example"]; firstDate: string | null }>();
  for (const r of rows) {
    if (r.percentage == null || r.percentage === "") continue;
    const a = loadOf(r, before, unit);
    const b = loadOf(r, after, unit);
    if (a.load === b.load) continue;
    const g = byBlock.get(r.block_id) ?? { name: r.block_name?.trim() || "This block", days: new Set<string>(), sets: 0, example: null, firstDate: null };
    g.days.add(r.day_id);
    g.sets += 1;
    if (!g.example || (r.date && (!g.firstDate || r.date < g.firstDate))) {
      g.example = { exercise: r.exercise ?? "A set", label: a.label ?? b.label ?? null, from: a.load, to: b.load, unit };
      g.firstDate = r.date ?? g.firstDate;
    }
    byBlock.set(r.block_id, g);
  }
  return [...byBlock.entries()]
    .map(([blockId, g]) => ({ blockId, name: g.name, workouts: g.days.size, sets: g.sets, example: g.example }))
    .sort((x, y) => y.workouts - x.workouts);
}

/** "8 upcoming workouts in Block 2 — Strength" (or two blocks, or more). */
export function movedBlocksWords(blocks: MovedBlock[]): string {
  const total = blocks.reduce((n, b) => n + b.workouts, 0);
  const w = `${total} upcoming workout${total === 1 ? "" : "s"}`;
  if (blocks.length === 1) return `${w} in ${blocks[0].name}`;
  if (blocks.length === 2) return `${w} in ${blocks[0].name} and ${blocks[1].name}`;
  return `${w} across ${blocks.length} running blocks`;
}

/** "Competition Squat 75% TM: 150 → 155 kg" ("no weight" when a side has none). */
export function exampleWords(e: MovedBlock["example"]): string | null {
  if (!e) return null;
  const v = (x: number | null) => (x == null ? "no weight" : `${Math.round(x * 100) / 100} ${e.unit}`);
  const head = e.label ? `${e.exercise} ${e.label}` : e.exercise;
  return `${head}: ${v(e.from)} → ${v(e.to)}`;
}
