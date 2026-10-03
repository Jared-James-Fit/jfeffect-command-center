/**
 * Final Week Boost — presentation logic for the Performance League.
 * All numbers come from the get_performance_league RPC (database is the
 * source of truth); this module only decides what to say about them.
 */

export const LEAGUE_TZ = "America/Winnipeg";
export const BOOST_ONE_LINER = "Hit 90%+ of your workouts → Match the highest Workout Points 🔥";

export type BoostStatus = "ready" | "chasing" | "out" | "none";

export type LeagueRow = {
  client_id: string;
  display_name: string;
  avatar_url: string | null;
  rank: number | null;
  is_me: boolean;
  qualified: boolean;
  bodyweight_value: number | null;
  bodyweight_unit: string | null;
  total_points: number;
  workout_points: number;
  logging_points: number;
  bodyweight_points: number;
  improvement_points: number;
  match_points: number;
  workouts_completed: number;
  fully_logged: number;
  boost_status: BoostStatus;
  needed_workouts: number;
  projected_total: number | null;
  eligible_workouts: number | null;
  completed_eligible: number | null;
  adherence_pct: number | null;
  open_workouts: number | null;
  match_target: number | null;
  projected_match: number | null;
  month_start: string;
  final_week_start: string;
  is_final_week: boolean;
  month_closed: boolean;
  finalized: boolean;
};

/** Today's date (YYYY-MM-DD) in the league timezone. */
export function leagueToday(now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: LEAGUE_TZ, year: "numeric", month: "2-digit", day: "2-digit" })
    .formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Final week = the last 7 days of the month, league timezone. */
export function isFinalWeek(now = new Date()): boolean {
  const [y, m, d] = leagueToday(now).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d >= last - 6;
}

/** Days left in the league month including today. */
export function daysLeftInMonth(now = new Date()): number {
  const [y, m, d] = leagueToday(now).split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return last - d + 1;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Short leaderboard tag. Null = show nothing (no clutter, no fake hype). */
export function boostTag(row: Pick<LeagueRow, "boost_status" | "needed_workouts">): string | null {
  if (row.boost_status === "ready") return "🔥 BOOST READY";
  if (row.boost_status !== "chasing") return null;
  if (row.needed_workouts === 1) return "🔥 1 WORKOUT LEFT";
  if (row.needed_workouts === 2) return "🔥 2 WORKOUTS LEFT";
  return "🔥 IN THE RACE";
}

/** Can this row still gain points from the boost? */
export function canStillMove(row: Pick<LeagueRow, "boost_status" | "projected_total" | "total_points">): boolean {
  return (row.boost_status === "ready" || row.boost_status === "chasing")
    && row.projected_total != null && row.projected_total > row.total_points;
}

export type HeroState = {
  tone: "hype" | "win" | "neutral";
  eyebrow: string;
  headline: string;
  sub: string;
};

/** The big final-week card for the signed-in athlete. */
export function heroState(me: Pick<LeagueRow, "boost_status" | "needed_workouts">): HeroState {
  if (me.boost_status === "ready") {
    return { tone: "win", eyebrow: "🔥 BOOST UNLOCKED", headline: "90%+ complete", sub: "Workout Points Match secured" };
  }
  if (me.boost_status === "chasing") {
    if (me.needed_workouts === 1) {
      return { tone: "hype", eyebrow: "🔥 FINAL WEEK BOOST", headline: "ONE WORKOUT LEFT", sub: "Finish it → Workout Points Match unlocked" };
    }
    if (me.needed_workouts === 2) {
      return { tone: "hype", eyebrow: "🔥 FINAL WEEK BOOST", headline: "2 WORKOUTS LEFT", sub: "Finish them → Unlock the boost" };
    }
    return {
      tone: "hype",
      eyebrow: "🔥 FINAL WEEK BOOST",
      headline: `${plural(me.needed_workouts, "workout")} to go`,
      sub: "Finish strong and unlock your Workout Points Match",
    };
  }
  // Can't qualify (or no qualifying program): neutral, never misleading.
  return { tone: "neutral", eyebrow: "Final Week Boost", headline: "90% monthly adherence required", sub: "" };
}

/**
 * How many athletes currently behind me can still catch or pass me through
 * their boost. Compared with my own best case (my projected total if I can
 * still unlock it, else my current total). Ties count as "catch".
 */
export function threatCount(rows: LeagueRow[], me: LeagueRow | undefined): number {
  if (!me || !me.qualified || me.rank == null || !me.is_final_week) return 0;
  const myBest = canStillMove(me) ? (me.projected_total as number) : me.total_points;
  return rows.filter((r) =>
    !r.is_me && r.qualified && r.rank != null && r.rank > (me.rank as number)
    && canStillMove(r) && (r.projected_total as number) >= myBest,
  ).length;
}

/** Where my projected total would place me against everyone's current total. */
export function projectedRank(rows: LeagueRow[], me: LeagueRow | undefined): number | null {
  if (!me || !me.qualified || !canStillMove(me)) return null;
  const mine = me.projected_total as number;
  return 1 + rows.filter((r) => !r.is_me && r.qualified && r.total_points > mine).length;
}

/** Workouts the athlete must still do to reach 90% (target count). */
export function adherenceTarget(eligible: number): number {
  return Math.ceil((eligible * 9) / 10);
}
