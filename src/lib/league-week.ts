/**
 * The League's week (Nov 19 2026): movement on the board ("▲2 this week") and
 * the Monday spotlight card in Crew. Every number comes from the database
 * (league_week_snapshots, taken each Monday 00:00 in the league's clock by
 * league_month_scores itself, 20270417090000_league_weekly_spotlight.sql);
 * this module only decides what to say about them. Pure, tested.
 */
import { formatLeaguePoints } from "@/lib/league-points";
import { boostLine, standingOf, type StandingRow } from "@/lib/league-standing";
import type { LeagueRow } from "@/lib/league-boost";

export type WeekPerson = {
  client_id: string;
  name: string;
  avatar_url: string | null;
  rank: number | null;
  is_me: boolean;
};

export type WeekPr = { exercise: string; reps: number; load_kg: number | null };

/** get_league_week_spotlight(): last week (Monday to Sunday) in the League, for you. */
export type LeagueWeek = {
  week_start: string;
  week_end: string;
  month_start: string;
  week_of_month: number;
  athletes: number;
  /** Whose board it's about (set by the app from the audience it asked for; Community when absent). */
  audience?: "coaching" | "community";
  me: {
    client_id: string;
    qualified: boolean;
    rank: number | null;
    prev_rank: number | null;
    total_points: number;
    week_points: number;
    workouts: number;
    fully_logged: number;
    bodyweight_logs: number;
    posts: number;
    prs: WeekPr[];
  };
  climbers: (WeekPerson & { prev_rank: number })[];
  top_week: (WeekPerson & { week_points: number })[];
  crew: { workouts: number; records: number };
};

/** A rank's move over the week: up / down by how many spots, or nothing to compare with. */
export type RankMove = { dir: "up" | "down" | "same"; spots: number } | null;

export function rankMove(rank: number | null | undefined, prev: number | null | undefined): RankMove {
  if (rank == null || prev == null) return null;
  const spots = prev - rank;
  if (spots === 0) return { dir: "same", spots: 0 };
  return spots > 0 ? { dir: "up", spots } : { dir: "down", spots: -spots };
}

/** "▲2" / "▼1" / null (unchanged or nothing to compare with), for a row on the board. */
export function moveMark(m: RankMove): string | null {
  if (!m || m.dir === "same") return null;
  return `${m.dir === "up" ? "▲" : "▼"}${m.spots}`;
}

export type WeekBaseline = { client_id: string; rank: number | null; total_points: number; qualified: boolean };

/**
 * Each athlete's move since this week began (Monday 00:00), read against the
 * board's live rows. Someone ranked now who wasn't then has no move (they're
 * new this week), never a made-up "▲".
 */
export function boardMoves(rows: Pick<LeagueRow, "client_id" | "rank" | "qualified" | "total_points">[], baseline: WeekBaseline[] | null | undefined) {
  const out = new Map<string, { move: RankMove; weekPoints: number | null }>();
  if (!baseline?.length) return out;
  const was = new Map(baseline.map((b) => [b.client_id, b]));
  for (const r of rows) {
    const b = was.get(r.client_id);
    const prev = b?.qualified ? b.rank : null;
    out.set(r.client_id, {
      move: r.qualified ? rankMove(r.rank, prev) : null,
      weekPoints: b ? Math.max(0, Number(r.total_points ?? 0) - Number(b.total_points ?? 0)) : null,
    });
  }
  return out;
}

const LEAGUE_DAY = (iso: string) => new Date(`${iso}T12:00:00Z`);

/** "Nov 9 – 15" / "Nov 30 – Dec 6". */
export function weekRange(start: string, end: string): string {
  const s = LEAGUE_DAY(start);
  const e = LEAGUE_DAY(end);
  const mon = (d: Date) => d.toLocaleDateString("en-US", { month: "short", timeZone: "UTC" });
  const day = (d: Date) => d.getUTCDate();
  return mon(s) === mon(e) ? `${mon(s)} ${day(s)} – ${day(e)}` : `${mon(s)} ${day(s)} – ${mon(e)} ${day(e)}`;
}

/** The hour of Monday morning (the viewer's own clock) the card is ready from. */
export const SPOTLIGHT_HOUR = 6;

/**
 * The week's card is ready on the Monday after it (the day after `week_end`)
 * from 6 AM on the viewer's own clock, so nobody gets it at midnight, and
 * never before the League's own week is over (the database only answers for a
 * finished week).
 */
export function spotlightReady(weekEnd: string, now = new Date()): boolean {
  const [y, m, d] = weekEnd.split("-").map(Number);
  const monday = new Date(y, m - 1, d + 1, SPOTLIGHT_HOUR, 0, 0, 0);
  return now.getTime() >= monday.getTime();
}

/** Seen once per week, server-side (feature_announcement_views), so it never replays on another phone. */
export function spotlightSeenKey(weekStart: string): string {
  return `league_week:${weekStart}`;
}

/** The card's headline: how your rank moved. */
export function weekHeadline(me: LeagueWeek["me"]): { title: string; emoji: string | null } {
  if (!me.qualified || me.rank == null) return { title: "Not on the board yet", emoji: null };
  const m = rankMove(me.rank, me.prev_rank);
  if (!m) return { title: `#${me.rank} on the board`, emoji: null };
  if (m.dir === "same") return me.rank === 1 ? { title: "Held #1", emoji: "🏆" } : { title: `Held #${me.rank}`, emoji: null };
  if (m.dir === "up") return { title: me.rank === 1 ? "Up to #1" : `Up ${m.spots} to #${me.rank}`, emoji: me.rank === 1 ? "🏆" : "📈" };
  return { title: `Down ${m.spots} to #${me.rank}`, emoji: null };
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Your week in a few plain facts, only the ones that happened ("4 workouts · 3 fully logged · bodyweight 5 days"). */
export function weekFacts(me: LeagueWeek["me"]): string[] {
  const out: string[] = [];
  if (me.workouts > 0) out.push(plural(me.workouts, "workout"));
  if (me.fully_logged > 0) out.push(me.fully_logged === me.workouts ? "all fully logged" : `${me.fully_logged} fully logged`);
  if (me.bodyweight_logs > 0) out.push(`bodyweight ${plural(me.bodyweight_logs, "day")}`);
  if (me.posts > 0) out.push(plural(me.posts, "Crew post"));
  return out;
}

/** "All-time PR on Competition Squat" / "All-time PRs on Competition Squat and Paused Bench" / "… and 2 more". */
export function prLine(prs: WeekPr[]): string | null {
  if (!prs.length) return null;
  const names = prs.map((p) => p.exercise);
  if (names.length === 1) return `All-time PR on ${names[0]}`;
  if (names.length === 2) return `All-time PRs on ${names[0]} and ${names[1]}`;
  return `All-time PRs on ${names[0]}, ${names[1]} and ${names.length - 2} more`;
}

/** "1 pt" / "7.5 pts" / "25 pts". */
const ptsWord = (n: number) => `${formatLeaguePoints(n)} ${n === 1 ? "pt" : "pts"}`;

/** League points for one fully logged workout (completed 10 + fully logged 5, league-points.ts). */
export const FULLY_LOGGED_WORKOUT_POINTS = 15;

/**
 * The one reason to come back this week, from the live board (so it's true
 * whenever the card is opened): the gap to the next spot in workouts it takes,
 * holding #1, a tie to break, the Final Week Boost, or how to join. Planned
 * workouts are the only ones the League counts, so it never asks for more
 * training than the plan, only for logging it fully.
 */
export function chaseLine(rows: (StandingRow & Partial<LeagueRow>)[], me: (StandingRow & Partial<LeagueRow>) | null | undefined): string | null {
  if (!me) return null;
  if (!me.qualified || me.rank == null) return "Log your bodyweight to get on the board. Points you've earned count once you're in.";
  const boost = me.is_final_week ? boostLine(me as LeagueRow) : null;
  if (boost?.tone === "chasing") return `Final week: ${boost.text.charAt(0).toLowerCase()}${boost.text.slice(1)}.`;
  const s = standingOf(rows, me);
  switch (s.kind) {
    case "solo":
      return "You're the only one on the board. Every fully logged workout counts.";
    case "leading":
      return `You lead ${s.over.display_name} by ${ptsWord(s.by)}. Log your planned workouts fully to hold #1.`;
    case "tied-top":
      return `Tied with ${s.with.display_name} for #1. Your next points break it.`;
    case "tied":
      return `Tied with ${s.with.display_name} for #${s.with.rank}. Your next points pass them.`;
    case "behind": {
      const lead = `${ptsWord(s.pts)} to catch ${s.of.display_name} for #${s.of.rank}.`;
      if (s.pts <= FULLY_LOGGED_WORKOUT_POINTS) return `${lead} One fully logged workout closes it.`;
      if (s.pts <= FULLY_LOGGED_WORKOUT_POINTS * 2) return `${lead} Two fully logged workouts close it.`;
      return lead;
    }
    default:
      return null;
  }
}
