import { Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
import { ChevronRight, Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { leagueToday } from "@/lib/league-boost";
import { formatLeaguePoints } from "@/lib/league-points";
import { monthName } from "@/lib/league-recap";
import { boostLine, standingOf, standingText } from "@/lib/league-standing";
import { usePerformanceLeague } from "@/lib/use-performance-league";
import { formatMultiple, meStatus, pickBoard } from "@/lib/strength-board";
import { defaultDivision, useStrengthBoard } from "@/components/portal/strength-board";

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
  // Same query (and cache) as the Monthly board in Crew → Rankings.
  const { data: leagueRows = [], isPending: leaguePending } = usePerformanceLeague("current");
  const { data: board = [], isPending: boardPending } = useStrengthBoard();

  const leagueMe = leagueRows.find((r) => r.is_me) ?? null;
  const standing = standingOf(leagueRows, leagueMe);
  const leagueTop = topThree(leagueRows);
  const boost = boostLine(leagueMe);
  const month = leagueRows[0]?.month_start ?? `${leagueToday().slice(0, 7)}-01`;
  // The board Rankings → Strength opens on: your division, pound for pound, total.
  const division = defaultDivision(board);
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
          <div className={title}>{monthName(month)} League</div>
          {leaguePending ? loading : leagueTop.length === 0 ? (
            <p className="text-[12px] text-muted-foreground">Nobody's ranked yet this month.</p>
          ) : (
            <ol className="space-y-1">
              {leagueTop.map((r, i) => (
                <PodiumLine key={r.client_id} place={i + 1} name={r.display_name?.trim() || "Athlete"} value={`${formatLeaguePoints(r.total_points)} pts`} me={r.is_me} />
              ))}
            </ol>
          )}
          {/* final week only: the boost is what moves the board now */}
          {!leaguePending && boost && (
            <div className={cn("mt-2 flex min-w-0 items-center gap-1.5 text-[12px] font-bold", boost.tone === "ready" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400")}>
              <Flame className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 truncate">{boost.text}</span>
            </div>
          )}
          {!leaguePending && (
            <YouLine
              rank={leagueMe?.qualified ? leagueMe.rank : null}
              value={leagueMe?.qualified && leagueMe.rank != null ? `${formatLeaguePoints(leagueMe.total_points)} pts` : null}
              note={standingText(standing, true)}
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
