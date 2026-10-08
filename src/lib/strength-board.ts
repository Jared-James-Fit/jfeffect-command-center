/**
 * All-Time Strength Board: shapes the get_strength_board() rows into the
 * boards clients see, plus the copy and math that make it easy to read.
 * Ranking itself happens in the database (20261016090000_all_time_strength_board.sql).
 */
import type { WeightUnit } from "@/lib/weight-lifted";

export type BoardLift = "total" | "squat" | "bench" | "deadlift";
export type BoardMode = "p4p" | "absolute";
export type Division = "male" | "female";

export type StrengthRow = {
  client_id: string;
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
  is_coach: boolean;
  sex: Division | null;
  lift: BoardLift;
  kg: number;
  reps: number | null;
  lifted_at: string;
  bw_kg: number | null;
  bw_multiple: number | null;
  dots: number | null;
  abs_rank: number | null;
  p4p_rank: number | null;
  abs_count: number | null;
  p4p_count: number | null;
};

export const BOARD_LIFTS: { key: BoardLift; label: string }[] = [
  { key: "total", label: "Total" },
  { key: "squat", label: "Squat" },
  { key: "bench", label: "Bench" },
  { key: "deadlift", label: "Deadlift" },
];

export const LIFT_NAME: Record<BoardLift, string> = {
  total: "total",
  squat: "squat",
  bench: "bench",
  deadlift: "deadlift",
};

const LB_PER_KG = 2.2046226;
export const TOP = 10;

export function normalizeRow(r: any): StrengthRow {
  const num = (v: unknown) => (v == null ? null : Number(v));
  return {
    client_id: r.client_id,
    display_name: r.display_name ?? "Athlete",
    avatar_url: r.avatar_url ?? null,
    is_me: !!r.is_me,
    is_coach: !!r.is_coach,
    sex: r.sex === "male" || r.sex === "female" ? r.sex : null,
    lift: r.lift,
    kg: Number(r.kg ?? 0),
    reps: num(r.reps),
    lifted_at: r.lifted_at,
    bw_kg: num(r.bw_kg),
    bw_multiple: num(r.bw_multiple),
    dots: num(r.dots),
    abs_rank: num(r.abs_rank),
    p4p_rank: num(r.p4p_rank),
    abs_count: num(r.abs_count),
    p4p_count: num(r.p4p_count),
  };
}

export const rankOf = (r: StrengthRow, mode: BoardMode) => (mode === "p4p" ? r.p4p_rank : r.abs_rank);

/** One board: its ranked rows (top 10) and the viewer's own row for that lift. */
export function pickBoard(rows: StrengthRow[], mode: BoardMode, lift: BoardLift, division: Division) {
  const onBoard = rows.filter(
    (r) => r.lift === lift && rankOf(r, mode) != null && (mode === "p4p" || r.sex === division),
  );
  const top = onBoard.filter((r) => (rankOf(r, mode) as number) <= TOP).sort((a, b) => rankOf(a, mode)! - rankOf(b, mode)!);
  const me = rows.find((r) => r.is_me && r.lift === lift) ?? null;
  return { top, me };
}

/** 250 kg → "551 lb" / "250 kg"; 52.16 kg → "115 lb" / "52.2 kg". */
export function formatLoad(kg: number, unit: WeightUnit): string {
  if (!Number.isFinite(kg) || kg <= 0) return `0 ${unit}`;
  if (unit === "lb") return `${Math.round(kg * LB_PER_KG).toLocaleString()} lb`;
  const v = Math.round(kg * 10) / 10;
  return `${Number.isInteger(v) ? v.toLocaleString() : v.toFixed(1)} kg`;
}

/** 9.4142 → "9.41×" */
export function formatMultiple(x: number | null | undefined): string | null {
  if (x == null || !Number.isFinite(x) || x <= 0) return null;
  return `${x.toFixed(2)}×`;
}

export function formatDots(d: number | null | undefined): string {
  if (d == null || !Number.isFinite(d)) return "—";
  return Math.round(d).toLocaleString();
}

/** Powerlifting totals club for a total in kg (the clubs are in lb). */
export function totalClub(kg: number): string | null {
  const lb = kg * LB_PER_KG;
  if (lb >= 1500) return "1500 CLUB";
  if (lb >= 1200) return "1200 CLUB";
  if (lb >= 1000) return "1000 LB CLUB";
  return null;
}

/**
 * How much heavier the viewer's lift must be to pass #10, in the display unit,
 * rounded up to plates (2.5 kg / 5 lb). Pound for pound assumes the same
 * bodyweight: DOTS scales linearly with weight lifted, so the needed weight is
 * my weight × (10th DOTS / my DOTS). Null when already in the top 10 or the
 * board isn't full yet.
 */
export function gapToTop10(
  me: StrengthRow | null,
  top: StrengthRow[],
  mode: BoardMode,
  unit: WeightUnit,
): number | null {
  if (!me) return null;
  const rank = rankOf(me, mode);
  if (rank == null || rank <= TOP || top.length < TOP) return null;
  const tenth = top[TOP - 1];
  let neededKg: number;
  if (mode === "p4p") {
    if (!me.dots || !tenth.dots || me.dots <= 0) return null;
    neededKg = me.kg * (tenth.dots / me.dots) - me.kg;
  } else {
    neededKg = tenth.kg - me.kg;
  }
  const step = unit === "kg" ? 2.5 : 5;
  const inUnit = unit === "kg" ? neededKg : neededKg * LB_PER_KG;
  // Ties go to whoever lifted it first, so matching #10 isn't enough: always at least one plate.
  return Math.max(step, Math.ceil((inUnit + 1e-6) / step) * step);
}

export type MeStatus =
  | { kind: "ranked"; rank: number; count: number | null }
  | { kind: "no-lift" }
  | { kind: "no-total" }
  | { kind: "no-division" }
  | { kind: "no-bodyweight" };

/** Why the viewer is (or isn't) on this board, so the UI can say what to do next. */
export function meStatus(me: StrengthRow | null, mode: BoardMode, lift: BoardLift): MeStatus {
  if (!me) return lift === "total" ? { kind: "no-total" } : { kind: "no-lift" };
  if (!me.sex) return { kind: "no-division" };
  const rank = rankOf(me, mode);
  if (rank == null) return mode === "p4p" ? { kind: "no-bodyweight" } : { kind: "no-division" };
  return { kind: "ranked", rank, count: mode === "p4p" ? me.p4p_count : me.abs_count };
}
