import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { useRef, useState } from "react";
import { ChevronRight, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { formatLeaguePoints, leaguePointsFromEncoded } from "@/lib/league-points";
import { formatMultiple, meStatus, pickBoard } from "@/lib/strength-board";
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

type Slide = "monthly" | "strength";

/** One podium line: medal, name, their number; you in red. */
function PodiumLine({ place, name, value, me }: { place: number; name: string; value: string; me: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2 text-[13px] leading-5">
      <span className="w-5 shrink-0 text-center" aria-label={`#${place}`}>{MEDALS[place - 1]}</span>
      <span className={cn("min-w-0 flex-1 truncate font-semibold", me && "text-primary")}>{me ? "You" : name}</span>
      <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{value}</span>
    </li>
  );
}

/** Where you stand, under the podium: rank and number, or what's needed to get ranked. */
function YouLine({ rank, value, note }: { rank: number | null; value?: string | null; note: string }) {
  return (
    <div className="mt-auto flex min-w-0 items-baseline gap-2 border-t border-border/60 pt-2 text-[12px]">
      {rank ? (
        <>
          <span className="shrink-0 font-bold text-muted-foreground">You</span>
          <span className="shrink-0 text-[15px] font-black leading-none text-primary">#{rank}</span>
          {value && <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{value}</span>}
          <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{note}</span>
        </>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">{note}</span>
      )}
    </div>
  );
}

/**
 * Home → Rankings: one compact card, swiped sideways between Monthly (this
 * month's League: Top 3, your rank, points to the next spot) and Strength (Hall
 * of Strength Top 3, pound for pound total: the board's default). Monthly
 * first, never rotates by itself, both pages the same height, dots below.
 * "View all" opens the page you're on in Crew → Rankings. Same data and cache
 * as Rankings.
 */
export function HomeLeaguePreviews() {
  const viewerId = usePortalUserId() ?? null;
  const { data: leagueRows = [], isPending: leaguePending } = useQuery({
    // Same key and query as the Monthly board, so it's one fetch for both.
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
  const leagueTop = topThree(leagueRows);
  const myTotal = board.find((r) => r.is_me && r.lift === "total") ?? null;
  const division = myTotal?.sex ?? "all";
  const { top: hallTop, me } = pickBoard(board, "p4p", "total", division, 3);
  const hall = meStatus(me, "p4p", "total", division);
  const ratio = me ? formatMultiple(me.bw_multiple) : null;

  const scroller = useRef<HTMLDivElement | null>(null);
  const [slide, setSlide] = useState<Slide>("monthly");
  const onScroll = () => {
    const el = scroller.current;
    if (!el || !el.clientWidth) return;
    setSlide(Math.round(el.scrollLeft / el.clientWidth) >= 1 ? "strength" : "monthly");
  };
  const goTo = (s: Slide) => {
    const el = scroller.current;
    if (el) el.scrollTo({ left: s === "strength" ? el.clientWidth : 0, behavior: "smooth" });
    setSlide(s);
  };

  const page = "flex w-full shrink-0 snap-center snap-always flex-col px-3.5 pb-3 pt-1";
  const title = "mb-1.5 flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground";
  const loading = <div className="space-y-1.5">{[0, 1, 2].map((i) => <div key={i} className="h-5 animate-pulse rounded-md bg-muted/50" />)}</div>;

  return (
    <section data-home-rankings className="overflow-hidden rounded-2xl border border-border/80 bg-card" aria-label="Rankings">
      <div className="flex items-center gap-2 px-3.5 pb-1 pt-2.5">
        <span className="text-[15px] font-black tracking-tight">Rankings</span>
        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
          <span className="relative flex h-1.5 w-1.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-500 opacity-60" />
            <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
          </span>
          Live
        </span>
        <Link
          to="/portal/community"
          hash={slide === "strength" ? "rankings=strength" : "rankings"}
          className="ml-auto inline-flex min-h-8 items-center gap-0.5 rounded-full px-1.5 text-[12px] font-bold text-primary active:bg-muted"
        >
          View all <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* two pages side by side: a row stretches both to the taller one, so they're the same height */}
      <div
        ref={scroller}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        <div className={page} aria-label="Monthly">
          <div className={title}>{format(new Date(), "MMMM")} League</div>
          {leaguePending ? loading : leagueTop.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Nobody's ranked yet this month.</p>
          ) : (
            <ol className="space-y-1">
              {leagueTop.map((r, i) => (
                <PodiumLine key={r.client_id} place={i + 1} name={r.display_name?.trim() || "Athlete"} value={`${formatLeaguePoints(score(r))} pts`} me={r.is_me} />
              ))}
            </ol>
          )}
          {!leaguePending && (
            <YouLine
              rank={league.rank}
              value={league.rank ? `${formatLeaguePoints(league.points)} pts` : null}
              note={league.rank ? (league.gap ? `${formatLeaguePoints(league.gap.pts)} pts to #${league.gap.to}` : "You're leading 🔥") : "Log your bodyweight to enter this month"}
            />
          )}
        </div>

        <div className={page} aria-label="Strength">
          <div className={title}>
            <span className="truncate">Hall of Strength</span>
            <Trophy className="h-3 w-3 shrink-0 text-amber-400" aria-hidden />
          </div>
          {boardPending ? loading : hallTop.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Nobody's on this board yet.</p>
          ) : (
            <ol className="space-y-1">
              {hallTop.map((r, i) => (
                <PodiumLine key={r.key} place={i + 1} name={r.display_name} value={`${formatMultiple(r.bw_multiple) ?? "—"} BW`} me={r.is_me} />
              ))}
            </ol>
          )}
          {!boardPending && (
            <YouLine
              rank={hall.kind === "ranked" ? hall.rank : null}
              value={hall.kind === "ranked" && ratio ? `${ratio} BW` : null}
              note={
                hall.kind === "ranked" ? "Pound for pound · total"
                : hall.kind === "no-bodyweight" ? "Log your bodyweight to rank"
                : hall.kind === "no-division" ? "Set Men or Women in your profile to rank"
                : "Log a squat, bench and deadlift to rank"
              }
            />
          )}
        </div>
      </div>

      {/* page dots: tap to switch too */}
      <div className="flex justify-center gap-1.5 pb-2.5" role="tablist" aria-label="Rankings page">
        {(["monthly", "strength"] as const).map((s) => (
          <button
            key={s}
            type="button"
            role="tab"
            aria-selected={slide === s}
            aria-label={s === "monthly" ? "Monthly" : "Strength"}
            onClick={() => goTo(s)}
            className={cn("h-1.5 rounded-full transition-all", slide === s ? "w-4 bg-foreground/70" : "w-1.5 bg-muted-foreground/30")}
          />
        ))}
      </div>
    </section>
  );
}
