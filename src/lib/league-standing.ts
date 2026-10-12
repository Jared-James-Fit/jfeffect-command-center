/**
 * Where you stand in this month's Performance League, in one honest line.
 * Pure presentation over get_performance_league() rows: the database ranks
 * (points, then the tiebreak below), this only says what that means for you.
 *
 * Ranks are unique even on equal points, so a tie is said as a tie ("Tied
 * with Reece · ahead on tiebreak") instead of a made-up "1 pt to #1".
 */
import { adherenceTarget, daysLeftInMonth, type LeagueRow } from "@/lib/league-boost";
import { formatLeaguePoints } from "@/lib/league-points";

export type StandingRow = Pick<LeagueRow, "client_id" | "display_name" | "rank" | "total_points" | "qualified" | "is_me">;

export type Standing =
  | { kind: "unranked" }
  | { kind: "solo" }
  | { kind: "leading"; by: number; over: StandingRow }
  | { kind: "tied-top"; with: StandingRow }
  | { kind: "tied"; with: StandingRow }
  | { kind: "behind"; pts: number; of: StandingRow };

/** Same order as league_month_scores(): points, then these, then name. */
export const TIEBREAK_NOTE = "Tied on points? More record points wins, then more workouts, then fully logged workouts, then bodyweight logs.";

/** Everyone ranked this month, best first. */
export function rankedRows<T extends StandingRow>(rows: T[]): T[] {
  return rows.filter((r) => r.qualified && r.rank != null).sort((a, b) => Number(a.rank) - Number(b.rank));
}

const pts = (r: StandingRow) => Number(r.total_points ?? 0);

/** Your standing against the athlete right above you (or right below, at #1). */
export function standingOf(rows: StandingRow[], me: StandingRow | null | undefined = rows.find((r) => r.is_me)): Standing {
  if (!me?.qualified || me.rank == null) return { kind: "unranked" };
  const ranked = rankedRows(rows);
  const at = ranked.findIndex((r) => r.client_id === me.client_id);
  if (at === -1) return { kind: "unranked" };
  if (at === 0) {
    const next = ranked[1];
    if (!next) return { kind: "solo" };
    return pts(next) === pts(me) ? { kind: "tied-top", with: next } : { kind: "leading", by: pts(me) - pts(next), over: next };
  }
  const above = ranked[at - 1];
  return pts(above) === pts(me) ? { kind: "tied", with: above } : { kind: "behind", pts: pts(above) - pts(me), of: above };
}

/**
 * The line under your rank. `short` fits Home's card ("10 pts behind #1");
 * the long one names the athlete ("10 pts behind Reece R (#1)").
 */
export function standingText(s: Standing, short = false): string {
  switch (s.kind) {
    case "unranked":
      return "Log your bodyweight to join this month";
    case "solo":
      return "First one on the board";
    case "leading":
      return short ? `Leading by ${formatLeaguePoints(s.by)} pts` : `Leading ${s.over.display_name} by ${formatLeaguePoints(s.by)} pts`;
    case "tied-top":
      return short ? "Tied on points" : `Tied with ${s.with.display_name} · you're ahead on tiebreak`;
    case "tied":
      return short ? `Tied with #${s.with.rank}` : `Tied with ${s.with.display_name} (#${s.with.rank}) · your next points pass them`;
    case "behind":
      return short ? `${formatLeaguePoints(s.pts)} pts behind #${s.of.rank}` : `${formatLeaguePoints(s.pts)} pts behind ${s.of.display_name} (#${s.of.rank})`;
  }
}

/** "19 days left" / "Final 5 days" / "Last day" (league timezone). */
export function monthClockLabel(finalWeek: boolean, now = new Date()): string {
  const left = daysLeftInMonth(now);
  if (left <= 1) return "Last day";
  return finalWeek ? `Final ${left} days` : `${left} days left`;
}

type BoostRow = Pick<LeagueRow, "boost_status" | "needed_workouts" | "projected_match" | "is_final_week" | "month_closed" | "qualified">;

/**
 * The Final Week Boost in one line, for the last 7 days only (Home and the
 * board). Null when it doesn't apply, so nothing shows for nothing.
 */
export function boostLine(me: BoostRow | null | undefined): { tone: "ready" | "chasing"; text: string } | null {
  if (!me?.qualified || !me.is_final_week || me.month_closed) return null;
  if (me.boost_status === "ready") {
    const match = Number(me.projected_match ?? 0);
    return { tone: "ready", text: match > 0 ? `Boost unlocked · +${formatLeaguePoints(match)} pts` : "Boost unlocked · 90%+ done" };
  }
  if (me.boost_status === "chasing") {
    const n = Number(me.needed_workouts ?? 0);
    return { tone: "chasing", text: `${n} workout${n === 1 ? "" : "s"} to unlock your Boost` };
  }
  return null;
}

/**
 * Before the final week: how far along the 90% is ("8 of 21 done"). Null
 * when there's no prescribed month to count (or it can't be reached).
 */
export function boostProgress(me: Pick<LeagueRow, "boost_status" | "eligible_workouts" | "completed_eligible"> | null | undefined) {
  const eligible = Number(me?.eligible_workouts ?? 0);
  if (!me || eligible <= 0 || (me.boost_status !== "chasing" && me.boost_status !== "ready")) return null;
  const done = Number(me.completed_eligible ?? 0);
  const target = adherenceTarget(eligible);
  return { done, target, eligible, pct: Math.min(100, Math.round((done / Math.max(1, target)) * 100)) };
}
