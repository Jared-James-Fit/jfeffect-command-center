/**
 * Hall of Strength: shapes the get_strength_board_all() (All-time: everyone
 * ever coached, training + meets) and get_strength_board_meets()
 * (Competition: sanctioned meets only) rows into the boards clients see,
 * plus the copy and math that make them easy to read. Ranking itself happens
 * in the database (20261024090000_hall_of_strength_all_time.sql).
 */
import type { WeightUnit } from "@/lib/weight-lifted";

export type BoardLift = "total" | "squat" | "bench" | "deadlift";
export type BoardMode = "p4p" | "absolute";
/** "all" = All-time (training + meets), "meets" = Competition (sanctioned meets only). */
export type BoardSource = "all" | "meets";
export type Sex = "male" | "female";
/** Absolute boards: everyone, or one sex. Pound for pound is always everyone. */
export type Division = "all" | Sex;

export type StrengthRow = {
  /** Stable per-athlete key: the client, or the meet athlete when not linked to one. */
  key: string;
  client_id: string | null;
  display_name: string;
  avatar_url: string | null;
  is_me: boolean;
  is_coach: boolean;
  sex: Sex | null;
  lift: BoardLift;
  kg: number;
  reps: number | null;
  lifted_at: string;
  bw_kg: number | null;
  bw_multiple: number | null;
  abs_rank: number | null;
  p4p_rank: number | null;
  all_rank: number | null;
  abs_count: number | null;
  p4p_count: number | null;
  all_count: number | null;
  /** Former client / retired athlete: their records stand. */
  is_alumni: boolean;
  /** Where this number was made. */
  source: "training" | "meet";
  // Meet rows only.
  meet?: {
    name: string;
    federation: string | null;
    weight_class: string | null;
    gl_points: number | null;
    competed_as: string | null;
    athlete_meets: number;
    first_meet: string | null;
  };
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

const num = (v: unknown) => (v == null ? null : Number(v));
const sexOf = (v: unknown): Sex | null => (v === "male" || v === "female" ? v : null);

export function normalizeRow(r: any): StrengthRow {
  return {
    key: String(r.client_id),
    client_id: r.client_id,
    display_name: r.display_name ?? "Athlete",
    avatar_url: r.avatar_url ?? null,
    is_me: !!r.is_me,
    is_coach: !!r.is_coach,
    sex: sexOf(r.sex),
    lift: r.lift,
    kg: Number(r.kg ?? 0),
    reps: num(r.reps),
    lifted_at: r.lifted_at,
    bw_kg: num(r.bw_kg),
    bw_multiple: num(r.bw_multiple),
    abs_rank: num(r.abs_rank),
    p4p_rank: num(r.p4p_rank),
    all_rank: num(r.all_rank),
    abs_count: num(r.abs_count),
    p4p_count: num(r.p4p_count),
    all_count: num(r.all_count),
    is_alumni: !!r.is_alumni,
    source: r.source === "meet" ? "meet" : "training",
  };
}

/** A get_strength_board_all() row: one person's best from training or a meet. */
export function normalizeAllRow(r: any): StrengthRow {
  const meet = r.source === "meet";
  return {
    ...normalizeRow({ ...r, lifted_at: `${r.lifted_on}T12:00:00` }),
    key: String(r.person),
    client_id: r.client_id ?? null,
    meet: meet
      ? { name: r.meet_name ?? "Meet", federation: r.federation ?? null, weight_class: null, gl_points: null, competed_as: null, athlete_meets: 0, first_meet: null }
      : undefined,
  };
}

export function normalizeMeetRow(r: any): StrengthRow {
  return {
    ...normalizeRow({ ...r, reps: null, source: "meet", lifted_at: `${r.meet_date}T12:00:00` }),
    key: String(r.athlete_id),
    client_id: r.client_id ?? null,
    meet: {
      name: r.meet_name ?? "Meet",
      federation: r.federation ?? null,
      weight_class: r.weight_class ?? null,
      gl_points: num(r.gl_points),
      competed_as: r.competed_as ?? null,
      athlete_meets: Number(r.athlete_meets ?? 0),
      first_meet: r.first_meet ?? null,
    },
  };
}

export function rankOf(r: StrengthRow, mode: BoardMode, division: Division): number | null {
  if (mode === "p4p") return r.p4p_rank;
  if (division === "all") return r.all_rank;
  return r.sex === division ? r.abs_rank : null;
}

export function countOf(r: StrengthRow, mode: BoardMode, division: Division): number | null {
  if (mode === "p4p") return r.p4p_count;
  return division === "all" ? r.all_count : r.abs_count;
}

/**
 * One board: its ranked rows (top `limit`), how many athletes are on it, and
 * the viewer's own row for that lift. Meet athletes can have two rows per lift
 * (their heaviest meet and their best x-bodyweight meet); each board only sees
 * the row ranked on it.
 */
export function pickBoard(rows: StrengthRow[], mode: BoardMode, lift: BoardLift, division: Division, limit = TOP) {
  const onBoard = (mode === "p4p" && division !== "all" ? p4pDivision(rows, lift, division) : rows)
    .filter((r) => r.lift === lift && rankOf(r, mode, division) != null)
    .sort((a, b) => rankOf(a, mode, division)! - rankOf(b, mode, division)!);
  const top = onBoard.filter((r) => rankOf(r, mode, division)! <= limit);
  const me = onBoard.find((r) => r.is_me) ?? rows.find((r) => r.is_me && r.lift === lift) ?? null;
  const count = onBoard[0] ? countOf(onBoard[0], mode, division) : 0;
  return { top, me, count: count ?? onBoard.length };
}

/**
 * Pound for pound for one sex: the database ranks everyone together, so keep
 * that order and renumber within the sex (the boards return every athlete,
 * so nobody is missing from the count).
 */
function p4pDivision(rows: StrengthRow[], lift: BoardLift, sex: Sex): StrengthRow[] {
  const mine = rows
    .filter((r) => r.lift === lift && r.p4p_rank != null && r.sex === sex)
    .sort((a, b) => a.p4p_rank! - b.p4p_rank!);
  return mine.map((r, i) => ({ ...r, p4p_rank: i + 1, p4p_count: mine.length }));
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
 * bodyweight: #10's x bodyweight times mine. Null when already in the top 10
 * or the board isn't full yet.
 */
export function gapToTop10(
  me: StrengthRow | null,
  top: StrengthRow[],
  mode: BoardMode,
  division: Division,
  unit: WeightUnit,
): number | null {
  if (!me) return null;
  const rank = rankOf(me, mode, division);
  if (rank == null || rank <= TOP || top.length < TOP) return null;
  const tenth = top[TOP - 1];
  let neededKg: number;
  if (mode === "p4p") {
    if (!me.bw_kg || !tenth.bw_kg) return null;
    neededKg = (tenth.kg / tenth.bw_kg) * me.bw_kg - me.kg;
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
  | { kind: "other-division" }
  | { kind: "no-bodyweight" };

/** Why the viewer is (or isn't) on this board, so the UI can say what to do next. */
export function meStatus(me: StrengthRow | null, mode: BoardMode, lift: BoardLift, division: Division): MeStatus {
  if (!me) return lift === "total" ? { kind: "no-total" } : { kind: "no-lift" };
  const rank = rankOf(me, mode, division);
  if (rank != null && (mode !== "p4p" || division === "all" || me.sex === division)) {
    return { kind: "ranked", rank, count: countOf(me, mode, division) };
  }
  if (mode === "p4p" && division !== "all" && !me.sex) return { kind: "no-division" };
  if (mode === "p4p" && division !== "all" && me.sex !== division) return { kind: "other-division" };
  if (mode === "p4p") return { kind: "no-bodyweight" };
  if (!me.sex) return { kind: "no-division" };
  return { kind: "other-division" };
}

/** "25 athletes · 74 meets · since 2018" from the meet board rows. */
export function meetHistory(rows: StrengthRow[]) {
  const seen = new Map<string, StrengthRow>();
  for (const r of rows) if (r.meet && !seen.has(r.key)) seen.set(r.key, r);
  const athletes = [...seen.values()];
  const meets = athletes.reduce((n, r) => n + (r.meet?.athlete_meets ?? 0), 0);
  const firsts = athletes.map((r) => r.meet?.first_meet).filter((d): d is string => !!d).sort();
  return { athletes: athletes.length, meets, since: firsts[0] ? Number(firsts[0].slice(0, 4)) : null };
}
