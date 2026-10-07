/**
 * Monthly League Recap — data + presentation helpers.
 * Numbers come from get_league_month_recap (database is the source of truth);
 * seen state lives server-side in feature_announcement_views so the recap
 * never replays on another device.
 */
import { supabase } from "@/integrations/supabase/client";
import { LEAGUE_TZ, leagueToday } from "@/lib/league-boost";

const db = supabase as any;

export type RecapAthlete = {
  display_name: string;
  avatar_url: string | null;
  rank: number | null;
  total_points: number;
  /** The coach's own athlete account (older recaps from before this field simply don't have it). */
  is_coach?: boolean;
};

export type LeagueRecap = {
  month_start: string;
  me: RecapAthlete & {
    qualified: boolean;
    workout_points: number;
    logging_points: number;
    bodyweight_points: number;
    improvement_points: number;
    match_points: number;
    workouts_completed: number;
    fully_logged: number;
    bodyweight_logs: number;
    improved_exercises: number;
    atpr_lifts: number;
    program_pr_lifts: number;
    block_pr_lifts: number;
    adherence_pct: number | null;
    boost_qualified: boolean;
    beat_pct: number | null;
  };
  previous: { rank: number | null; total_points: number; qualified: boolean } | null;
  league: { athletes: number; avg_points: number; top_points: number; total_workouts: number; total_atprs: number } | null;
  podium: Array<RecapAthlete & { is_me: boolean; atpr_lifts: number }>;
  rivals: Array<RecapAthlete & {
    gap: number;
    workouts_completed: number;
    atpr_lifts: number;
    program_pr_lifts: number;
    improved_exercises: number;
  }>;
};

/** Recap is offered automatically during the first week of a new month. */
export const RECAP_WINDOW_DAYS = 7;

export function previousLeagueMonth(today = leagueToday()): string {
  const [y, m] = today.split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

/** The `count` league months before (and including) `monthStart`, newest first. */
export function recapMonths(monthStart: string, count: number): string[] {
  const [y, m] = monthStart.split("-").map(Number);
  return Array.from({ length: count }, (_, k) => {
    const d = new Date(Date.UTC(y, m - 1 - k, 1));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-01`;
  });
}

export function inRecapWindow(today = leagueToday()): boolean {
  return Number(today.split("-")[2]) <= RECAP_WINDOW_DAYS;
}

export function recapSeenKey(monthStart: string) {
  return `league_recap:${monthStart.slice(0, 7)}`;
}

export function monthName(monthStart: string, opts: Intl.DateTimeFormatOptions = { month: "long" }) {
  return new Date(`${monthStart}T12:00:00Z`).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
}

export function nextMonthName(monthStart: string) {
  const [y, m] = monthStart.split("-").map(Number);
  return new Date(Date.UTC(y, m, 15)).toLocaleDateString("en-US", { month: "long", timeZone: "UTC" });
}

export function ordinal(n: number) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

/** "▲ 2 spots from August" / "▼ 1 spot" / "Same spot as August". */
export function rankChange(recap: LeagueRecap): { dir: "up" | "down" | "same"; text: string } | null {
  const now = recap.me.rank;
  const before = recap.previous?.qualified ? recap.previous.rank : null;
  if (now == null || before == null) return null;
  const prevName = monthName(previousLeagueMonth(recap.month_start.slice(0, 8) + "15"));
  const diff = before - now;
  if (diff === 0) return { dir: "same", text: `Same spot as ${prevName}` };
  const spots = `${Math.abs(diff)} spot${Math.abs(diff) === 1 ? "" : "s"}`;
  return diff > 0 ? { dir: "up", text: `Up ${spots} from ${prevName}` } : { dir: "down", text: `Down ${spots} from ${prevName}` };
}

/** Head-to-head line for a rival, from my point of view. */
export function rivalLine(gap: number) {
  if (gap < 0) return { tone: "win" as const, text: `You beat them by ${Math.abs(gap)}` };
  if (gap > 0) return { tone: "loss" as const, text: `${gap} pts ahead of you` };
  return { tone: "tie" as const, text: "Dead even" };
}

/** Closing nudge: chase the nearest rival who finished ahead, else defend. */
export function outroLine(recap: LeagueRecap) {
  const ahead = recap.rivals.filter((r) => r.gap > 0).sort((a, b) => a.gap - b.gap)[0];
  if (recap.me.rank === 1) return "You're the champ. Everyone's chasing you now — defend the crown.";
  if (ahead) return `${ahead.display_name} finished ${ahead.gap} pts ahead. This month, close the gap.`;
  return "You out-scored your closest rivals. Keep the pressure on.";
}

/**
 * `asUser` = the client being viewed in coach "View as client" mode. The
 * database only honours it for admins and that client's coach.
 */
export async function fetchLeagueRecap(month: string, asUser?: string | null): Promise<LeagueRecap | null> {
  const args: Record<string, unknown> = { _month: month };
  if (asUser) args._as_user = asUser;
  const { data, error } = await db.rpc("get_league_month_recap", args);
  if (error) throw error;
  return (data ?? null) as LeagueRecap | null;
}

export async function hasSeenFeature(userId: string, key: string): Promise<boolean> {
  const { data, error } = await db
    .from("feature_announcement_views")
    .select("feature_key")
    .eq("user_id", userId)
    .eq("feature_key", key)
    .maybeSingle();
  if (error) return true; // don't nag if the check fails
  return !!data;
}

export async function markFeatureSeen(userId: string, key: string, attempts = 4) {
  for (let i = 0; i < attempts; i++) {
    const { error } = await db.from("feature_announcement_views").upsert(
      { user_id: userId, feature_key: key },
      { onConflict: "user_id,feature_key", ignoreDuplicates: true },
    );
    if (!error) return true;
    await new Promise((r) => setTimeout(r, 800 * 2 ** i));
  }
  return false;
}

export { LEAGUE_TZ };
