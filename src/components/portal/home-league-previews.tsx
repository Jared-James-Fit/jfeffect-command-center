import { Link } from "@tanstack/react-router";
import { LiveMark as LiveIndicator } from "@/components/live-indicator";
import type { ReactNode } from "react";
import { ChevronRight, Dumbbell, Flame, Trophy } from "lucide-react";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { HomeSectionLabel } from "@/components/portal/home-section-label";
import { SwipeCards } from "@/components/portal/swipe-cards";
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

/** One podium line: medal, name, their number; you in red. */
function PodiumLine({ place, name, value, me }: { place: number; name: string; value: string; me: boolean }) {
  return (
    <li className="flex min-w-0 items-center gap-2.5 text-sm leading-6">
      <span className="w-5 shrink-0 text-center text-base" aria-label={`#${place}`}>{MEDALS[place - 1]}</span>
      <span className={cn("min-w-0 flex-1 truncate font-semibold", me && "text-primary")}>{me ? "You" : name}</span>
      <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{value}</span>
    </li>
  );
}

/** Where you stand, under the podium: rank and number, or what's needed to get ranked. */
function YouLine({ rank, value, note }: { rank: number | null; value?: string | null; note: string }) {
  return (
    <div className="mt-3 flex min-w-0 items-baseline gap-2 border-t border-border/60 pt-3 text-xs">
      {rank ? (
        <>
          <span className="shrink-0 font-bold text-muted-foreground">You</span>
          <span className="shrink-0 text-lg font-black leading-none text-primary">#{rank}</span>
          {value && <span className="shrink-0 font-bold tabular-nums text-muted-foreground">{value}</span>}
          <span className="min-w-0 flex-1 truncate text-right text-muted-foreground">{note}</span>
        </>
      ) : (
        <span className="min-w-0 truncate text-muted-foreground">{note}</span>
      )}
    </div>
  );
}

/** A board's card, laid out like the Progress cards: icon + title, View all on the right. */
function BoardCard({ icon, title, hash, children }: { icon: ReactNode; title: ReactNode; hash: string; children: ReactNode }) {
  return (
    <Card className="border-border bg-card p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {icon}
          <h3 className="truncate text-base font-bold">{title}</h3>
        </div>
        <Link
          to="/portal/community"
          hash={hash}
          className="-mr-2 inline-flex h-11 shrink-0 items-center gap-0.5 rounded-md px-2 text-xs font-semibold text-muted-foreground hover:text-foreground active:bg-muted"
        >
          View all <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <div className="mt-3">{children}</div>
    </Card>
  );
}

function LiveMark() {
  return (
    <LiveIndicator className="gap-1 text-[10px] tracking-wide" size={6} />
  );
}

/**
 * Home → Rankings, laid out like Home → Progress: a quiet section label, tabs
 * (League first, then Hall of Strength), swipe or tap between them, each a
 * card with its own View all into Crew → Rankings (the page you're on).
 * League: this month's Top 3, your rank, points to the next spot. Hall of
 * Strength: Top 3 pound for pound, total (the board's default). Same data and
 * cache as Rankings.
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

  const loading = <div className="space-y-2">{[0, 1, 2].map((i) => <div key={i} className="h-6 animate-pulse rounded-md bg-muted/50" />)}</div>;

  const league = (
    <BoardCard icon={<Trophy className="h-5 w-5 shrink-0 text-primary" />} title={`${monthName(month)} League`} hash="rankings">
      {leaguePending ? loading : leagueTop.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody's ranked yet this month.</p>
      ) : (
        <ol className="space-y-1.5">
          {leagueTop.map((r, i) => (
            <PodiumLine key={r.client_id} place={i + 1} name={r.display_name?.trim() || "Athlete"} value={`${formatLeaguePoints(r.total_points)} pts`} me={r.is_me} />
          ))}
        </ol>
      )}
      {/* final week only: the boost is what moves the board now */}
      {!leaguePending && boost && (
        <div className={cn("mt-2.5 flex min-w-0 items-center gap-1.5 text-xs font-bold", boost.tone === "ready" ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400")}>
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
    </BoardCard>
  );

  const strength = (
    <BoardCard icon={<Dumbbell className="h-5 w-5 shrink-0 text-primary" />} title={<span className="truncate">Hall of Strength</span>} hash="rankings=strength">
      {boardPending ? loading : hallTop.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nobody's on this board yet.</p>
      ) : (
        <ol className="space-y-1.5">
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
    </BoardCard>
  );

  return (
    <section data-home-rankings className="space-y-3" aria-label="Rankings">
      <HomeSectionLabel>
        Rankings <LiveMark />
      </HomeSectionLabel>
      {/* League always first; swipe or tap to the Hall of Strength */}
      <SwipeCards
        storageKey="jf-home-rankings"
        remember={false}
        cards={[
          { key: "league", label: "League", node: league },
          { key: "strength", label: "Hall of Strength", node: strength },
        ]}
      />
    </section>
  );
}
