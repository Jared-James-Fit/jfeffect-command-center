/**
 * Performance League insights: where an athlete's points come from, why one
 * athlete is ahead of another, and the 1–2 things that would move the viewer
 * most. Pure presentation logic over get_performance_league() rows; the
 * database stays the source of truth for every number.
 */
import { LEAGUE_RECORD_CAP, LEAGUE_RECORDS_START, formatLeaguePoints } from "@/lib/league-points";
import { leagueToday, type LeagueRow } from "@/lib/league-boost";

export type PointSourceKey = "workouts" | "logging" | "bodyweight" | "records" | "community" | "boost";

/**
 * Fixed order = fixed color (categorical slots 1–6, validated light + dark).
 * Color follows the source, never its size or rank.
 */
export const POINT_SOURCES: { key: PointSourceKey; label: string; color: string }[] = [
  { key: "workouts", label: "Workouts", color: "bg-[#2a78d6] dark:bg-[#3987e5]" },
  { key: "logging", label: "Fully logged", color: "bg-[#eb6834] dark:bg-[#d95926]" },
  { key: "bodyweight", label: "Bodyweight", color: "bg-[#1baf7a] dark:bg-[#199e70]" },
  { key: "records", label: "Records", color: "bg-[#eda100] dark:bg-[#c98500]" },
  { key: "community", label: "Community", color: "bg-[#e87ba4] dark:bg-[#d55181]" },
  { key: "boost", label: "Boost", color: "bg-[#008300] dark:bg-[#008300]" },
];

type Row = Pick<LeagueRow, "workout_points" | "logging_points" | "bodyweight_points" | "improvement_points" | "match_points"> &
  Partial<Pick<LeagueRow, "community_points">>;

export function pointsBySource(r: Row): Record<PointSourceKey, number> {
  const n = (v: unknown) => Math.max(0, Number(v ?? 0) || 0);
  return {
    workouts: n(r.workout_points),
    logging: n(r.logging_points),
    bodyweight: n(r.bodyweight_points),
    records: n(r.improvement_points),
    community: n(r.community_points),
    boost: n(r.match_points),
  };
}

export type Edge = { key: PointSourceKey; label: string; diff: number };

/** Sources where `them` out-scored `me`, biggest gap first. */
export function edgesOver(them: Row, me: Row): Edge[] {
  const a = pointsBySource(them);
  const b = pointsBySource(me);
  return POINT_SOURCES.map((s) => ({ key: s.key, label: s.label, diff: a[s.key] - b[s.key] }))
    .filter((e) => e.diff > 0)
    .sort((x, y) => y.diff - x.diff);
}

export type CoachTip = { key: string; title: string; detail: string; upTo: number; score: number };

type MeRow = Row &
  Pick<LeagueRow, "workouts_completed" | "fully_logged" | "boost_status" | "needed_workouts" | "projected_total" | "total_points" | "month_start" | "month_closed" | "is_final_week"> &
  Partial<Pick<LeagueRow, "community_posts" | "open_workouts" | "adherence_pct">>;

/** Day of month (1-based), days in month and days left (incl. today) in the league timezone. */
function monthClock(today: string) {
  const [y, m, d] = today.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  // Mon–Sun weeks left that still touch this month (the community cap is per week).
  const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7; // Mon = 0
  const weeksLeft = Math.ceil((last - d + 1 + dow) / 7);
  return { day: d, last, daysLeft: last - d + 1, weeksLeft };
}

const s = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const pts = (n: number) => `+${formatLeaguePoints(n)}`;

/**
 * The 1–2 things that would add the most points from here. Each lever is
 * scored by the points still available × how much of it the athlete is
 * leaving on the table so far (a daily bodyweight logger gets no
 * bodyweight tip). Empty for a closed month.
 */
export function coachFocus(me: MeRow, now = new Date(), max = 2): CoachTip[] {
  const today = leagueToday(now);
  if (me.month_closed || today.slice(0, 7) !== me.month_start.slice(0, 7)) return [];
  const { day, daysLeft, weeksLeft } = monthClock(today);
  const p = pointsBySource(me);
  const tips: CoachTip[] = [];

  if (me.is_final_week && me.boost_status === "chasing" && me.needed_workouts > 0
    && me.projected_total != null && me.projected_total > me.total_points) {
    const gain = me.projected_total - me.total_points;
    tips.push({
      key: "boost",
      title: `Finish ${s(me.needed_workouts, "more workout")} to unlock the boost`,
      detail: `Hitting 90% of your plan unlocks the Workout Points Match: ${pts(gain)} pts in one shot.`,
      upTo: gain,
      score: gain * 2,
    });
  }

  // Bodyweight: +5 a day, once a day.
  const bwDays = Math.round(p.bodyweight / 5);
  const bwRate = Math.min(1, bwDays / day);
  if (bwRate < 0.85) {
    const upTo = 5 * daysLeft;
    tips.push({
      key: "bodyweight",
      title: "Weigh in every morning",
      detail: `+5 a day, takes 10 seconds. You've logged ${bwDays} of ${s(day, "day")} so far. Daily from here is worth up to ${pts(upTo)}.`,
      upTo,
      score: upTo * (1 - bwRate),
    });
  }

  // Community: +15 a post, 1 a day, 2 a week (Mon–Sun).
  const posts = Number(me.community_posts ?? 0);
  if (me.month_start >= LEAGUE_RECORDS_START) {
    const weeksSoFar = Math.max(1, Math.ceil(day / 7));
    const postRate = Math.min(1, posts / (2 * weeksSoFar));
    if (postRate < 0.75) {
      const upTo = 30 * weeksLeft;
      tips.push({
        key: "community",
        title: "Share 2 workouts a week to the Community",
        detail: `+15 a post when you finish a session. ${posts === 0 ? "None yet this month" : `${s(posts, "post")} so far`}, up to ${pts(upTo)} left.`,
        upTo,
        score: upTo * (1 - postRate),
      });
    }
  }

  // Fully logged: +5 on top of every completed workout.
  const done = Number(me.workouts_completed ?? 0);
  const missed = Math.max(0, done - Number(me.fully_logged ?? 0));
  if (missed > 0) {
    const ahead = me.open_workouts != null ? Number(me.open_workouts) : Math.round((done / day) * daysLeft);
    const upTo = 5 * ahead;
    tips.push({
      key: "logging",
      title: "Fully log every set",
      detail: `+5 a workout on top of the +10. ${missed} of your ${s(done, "workout")} weren't fully logged: ${pts(missed * 5)} left on the table.`,
      upTo,
      score: Math.max(upTo * (missed / done), missed * 5),
    });
  }

  // Planned sessions: the biggest source once adherence slips.
  if (me.adherence_pct != null && me.open_workouts != null && me.open_workouts > 0 && Number(me.adherence_pct) < 80) {
    const upTo = 15 * Number(me.open_workouts);
    tips.push({
      key: "workouts",
      title: "Get your planned sessions in",
      detail: `+10 a workout, +15 fully logged. ${s(Number(me.open_workouts), "session")} left on your plan this month.`,
      upTo,
      score: upTo * (1 - Number(me.adherence_pct) / 100),
    });
  }

  // Records: least controllable, so they only win when nothing else is open.
  if (me.month_start >= LEAGUE_RECORDS_START && p.records < LEAGUE_RECORD_CAP) {
    const left = LEAGUE_RECORD_CAP - p.records;
    tips.push({
      key: "records",
      title: "Chase a PR",
      detail: `Beat a block, program or all-time best on any lift. ${pts(left)} of the ${LEAGUE_RECORD_CAP}-pt monthly record cap still open.`,
      upTo: left,
      score: left * 0.5,
    });
  }

  return tips.filter((t) => t.score >= 5).sort((a, b) => b.score - a.score).slice(0, max);
}
