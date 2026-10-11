import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronRight, Trophy } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { formatLeaguePoints, leaguePointsFromEncoded } from "@/lib/league-points";
import { formatMultiple, meStatus, pickBoard } from "@/lib/strength-board";
import { cn } from "@/lib/utils";
import { useStrengthBoard } from "@/components/portal/strength-board";

type LeagueRow = { client_id: string; display_name?: string | null; monthly_xp: number; rank: number | null; is_me: boolean; qualified: boolean };
const score = (r?: LeagueRow | null) => leaguePointsFromEncoded(r?.monthly_xp);

/**
 * Your rank and the points to move up (pure, tested). Ranks are unique even on
 * equal points, so: tied with someone ranked above you → 1 point takes their
 * spot; otherwise passing the next higher score lands you on the best rank
 * anyone on that score holds (it passes everyone tied there at once).
 */
export function leaguePreview(rows: LeagueRow[]) {
  const me = rows.find((r) => r.is_me) ?? null;
  if (!me?.qualified || me.rank == null) return { me: null, rank: null, points: 0, gap: null as null | { to: number; pts: number } };
  const rank = Number(me.rank);
  const mine = score(me);
  const ranked = rows.filter((r) => r.qualified && r.rank != null);
  const bestRankAt = (pts: number) => Math.min(...ranked.filter((r) => score(r) === pts).map((r) => Number(r.rank)));
  let gap: null | { to: number; pts: number } = null;
  const tiedAbove = ranked.filter((r) => score(r) === mine && Number(r.rank) < rank);
  if (tiedAbove.length) gap = { to: bestRankAt(mine), pts: 1 };
  else {
    const higher = ranked.map(score).filter((p) => p > mine);
    if (higher.length) {
      const next = Math.min(...higher);
      gap = { to: bestRankAt(next), pts: next - mine + 1 };
    }
  }
  return { me, rank, points: mine, gap };
}

/** The top three of a board, in rank order. */
export function topThree<T extends { rank: number | null; qualified?: boolean }>(rows: T[]): T[] {
  return rows.filter((r) => r.rank != null && r.qualified !== false).sort((a, b) => Number(a.rank) - Number(b.rank)).slice(0, 3);
}

const MEDALS = ["🥇", "🥈", "🥉"];

/** The little podium in each tile: medal, short name, their number; you in red. */
function TopThree({ rows }: { rows: { key: string; name: string; value: string; me: boolean }[] }) {
  if (!rows.length) return null;
  return (
    <span data-top-three className="mt-auto flex flex-col gap-0.5 border-t border-border/60 pt-1.5">
      {rows.map((r, i) => (
        <span key={r.key} className="flex min-w-0 items-center gap-1 text-[11px] leading-[16px]">
          <span className="w-4 shrink-0 text-center text-[11px]" aria-label={`#${i + 1}`}>{MEDALS[i]}</span>
          <span className={cn("min-w-0 flex-1 truncate font-semibold", r.me && "text-primary")}>{r.me ? "You" : r.name}</span>
          <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{r.value}</span>
        </span>
      ))}
    </span>
  );
}

/**
 * Home: two small League tiles under the Crew feed. Your Performance League rank this
 * month (and what it takes to move up), and your Hall of Strength pound-for-pound total
 * rank. Same data and cache as the League tab; tapping opens that section there.
 */
export function HomeLeaguePreviews() {
  const viewerId = usePortalUserId() ?? null;
  const { data: leagueRows = [], isPending: leaguePending } = useQuery({
    // Same key and query as the League card, so it's one fetch for both.
    queryKey: ["athlete-rankings-monthly-raw", viewerId],
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_monthly_athlete_rankings", { _limit: 50, ...(viewerId ? { _as_user: viewerId } : {}) });
      if (error) throw error;
      return (data ?? []) as LeagueRow[];
    },
  });
  const { data: board = [], isPending: boardPending } = useStrengthBoard();

  const league = leaguePreview(leagueRows);
  const myTotal = board.find((r) => r.is_me && r.lift === "total") ?? null;
  const division = myTotal?.sex ?? "all";
  const { me, top } = pickBoard(board, "p4p", "total", division, 3);
  const hall = meStatus(me, "p4p", "total", division);
  const ratio = me ? formatMultiple(me.bw_multiple) : null;

  const leagueTop = topThree(leagueRows).map((r) => ({ key: r.client_id, name: r.display_name?.trim() || "Athlete", value: formatLeaguePoints(score(r)), me: r.is_me }));
  const hallTop = top.slice(0, 3).map((r) => ({ key: r.key, name: r.display_name, value: `${formatMultiple(r.bw_multiple)}`, me: r.is_me }));

  const tile = "flex min-w-0 flex-col rounded-2xl border border-border/80 bg-card px-3 py-2.5 text-left transition active:scale-[0.99] active:bg-muted/40";
  const kicker = "flex items-center justify-between gap-0.5 text-[10px] font-semibold uppercase tracking-[0.05em] text-muted-foreground";

  return (
    <div className="grid grid-cols-2 gap-2" aria-label="League">
      <Link to="/portal/community" hash="league=standings" className={tile}>
        <span className={kicker}>
          <span className="truncate">{format(new Date(), "MMM")} League</span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </span>
        {leaguePending ? (
          <span className="mt-1.5 h-9 animate-pulse rounded-md bg-muted/50" />
        ) : league.rank ? (
          <>
            <span className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-bold leading-tight text-primary">#{league.rank}</span>
              <span className="truncate text-[11px] font-bold tabular-nums text-muted-foreground">{formatLeaguePoints(league.points)} pts</span>
            </span>
            <span className="truncate text-[11px] text-muted-foreground">
              {league.gap ? `${formatLeaguePoints(league.gap.pts)} pts to #${league.gap.to}` : "You're leading 🔥"}
            </span>
          </>
        ) : (
          <span className="mt-1 text-[11px] leading-snug text-muted-foreground">Log bodyweight to enter this month</span>
        )}
        {!leaguePending && <TopThree rows={leagueTop} />}
      </Link>

      <Link to="/portal/community" hash="league=strength" className={tile}>
        <span className={kicker}>
          {/* the trophy sits outside the truncating text, so it's never clipped */}
          <span className="flex min-w-0 items-center gap-1">
            <span className="truncate">Hall of Strength</span>
            <Trophy className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
          </span>
          <ChevronRight className="h-3.5 w-3.5 shrink-0" />
        </span>
        {boardPending ? (
          <span className="mt-1.5 h-9 animate-pulse rounded-md bg-muted/50" />
        ) : hall.kind === "ranked" ? (
          <>
            <span className="mt-0.5 flex items-baseline gap-1.5">
              <span className="text-lg font-bold leading-tight text-primary">#{hall.rank}</span>
              {ratio && <span className="truncate text-[11px] font-bold tabular-nums text-muted-foreground">{ratio} BW</span>}
            </span>
            <span className="truncate text-[11px] text-muted-foreground">Pound for pound · total</span>
          </>
        ) : (
          <span className="mt-1 text-[11px] leading-snug text-muted-foreground">
            {hall.kind === "no-bodyweight" ? "Log bodyweight to rank" : hall.kind === "no-division" ? "Set Men/Women in profile to rank" : "Log a total to get ranked"}
          </span>
        )}
        {!boardPending && <TopThree rows={hallTop} />}
      </Link>
    </div>
  );
}
