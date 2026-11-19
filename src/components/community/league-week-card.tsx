import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle } from "@/components/ui/sheet";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AvatarPhoto } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { useAuth } from "@/lib/auth";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { markFeatureSeen } from "@/lib/feature-seen";
import { formatLeaguePoints } from "@/lib/league-points";
import { monthName } from "@/lib/league-recap";
import { usePerformanceLeague } from "@/lib/use-performance-league";
import { chaseLine, prLine, rankMove, spotlightSeenKey, weekFacts, weekHeadline, weekRange, type LeagueWeek, type WeekPerson } from "@/lib/league-week";

/**
 * Last week in the League, for you (Nov 19 2026): how your rank moved, the
 * one thing worth chasing this week (read live from the board, so it's true
 * whenever it's opened), your week in plain facts and your all-time PRs, then
 * the week's top scorers and biggest climbers, everyone already on the board.
 * Crew shows it once a week as a screen of the feed (LeagueWeekScreen) from
 * Monday 6 AM on your own clock; Rankings keeps it one tap away (Last week).
 */
export function LeagueWeekCard({ week, play = true, onRankings, onDismiss, dismissLabel = "Dismiss", bare = false }: {
  week: LeagueWeek;
  /** Start the rank's tick and the reveal (in the feed: once it's on screen). */
  play?: boolean;
  onRankings?: () => void;
  onDismiss?: () => void;
  dismissLabel?: string;
  /** In a sheet: no frame of its own. */
  bare?: boolean;
}) {
  const { me } = week;
  const { data: live } = usePerformanceLeague("current");
  const liveMe = live?.find((r) => r.is_me) ?? null;
  const chase = live ? chaseLine(live, liveMe) : null;
  const head = weekHeadline(me);
  const move = rankMove(me.rank, me.prev_rank);
  const facts = weekFacts(me);
  const prs = prLine(me.prs);
  const shownRank = useTick(me.prev_rank, me.rank, play);
  const reveal = (i: number) => (play ? { className: "animate-in fade-in-0 slide-in-from-bottom-2 fill-mode-both duration-500", style: { animationDelay: `${120 + i * 90}ms` } } : { className: "opacity-0", style: undefined });

  return (
    <article data-league-week className={cn("relative overflow-hidden text-card-foreground", bare ? "px-1 pb-1" : "rounded-3xl border border-border/70 bg-card px-4 pb-4 pt-3.5")}>
      <header className="flex items-center gap-2">
        <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-muted-foreground">
          {monthName(week.month_start)} League · week {week.week_of_month}
        </span>
        <span className="shrink-0 text-[13px] tabular-nums text-muted-foreground">{weekRange(week.week_start, week.week_end)}</span>
        {onDismiss && (
          <button type="button" onClick={onDismiss} aria-label={dismissLabel} className="-mr-2 grid h-10 w-10 shrink-0 place-items-center rounded-full text-muted-foreground active:bg-muted" data-league-week-dismiss>
            <X className="h-5 w-5" />
          </button>
        )}
      </header>

      {/* your rank and how it moved: the number, then a chip that says the move (no title repeating it) */}
      {me.qualified && me.rank != null ? (
        <div className={cn("flex items-center gap-2.5", onDismiss ? "mt-1" : "mt-2")}>
          <span className="text-[44px] font-semibold leading-none tracking-tight tabular-nums" aria-label={`Rank ${me.rank}`}>
            #{shownRank ?? me.rank}
          </span>
          {move && (
            <span
              className={cn(
                "rounded-full px-2 py-0.5 text-[13px] font-semibold tabular-nums",
                move.dir === "up" ? "bg-success/15 text-success" : "bg-muted text-muted-foreground",
                play && "animate-in zoom-in-50 fade-in-0 fill-mode-both duration-500 [animation-delay:650ms]",
              )}
              aria-label={head.title}
              data-league-week-move={move.dir}
            >
              {move.dir === "up" ? `▲ ${move.spots}` : move.dir === "down" ? `▼ ${move.spots}` : "Held"}
            </span>
          )}
          {head.emoji && <span className="text-[26px] leading-none" aria-hidden>{head.emoji}</span>}
        </div>
      ) : (
        <h3 className={cn("text-[19px] font-semibold leading-tight", onDismiss ? "mt-1" : "mt-2")}>{head.title}</h3>
      )}
      {me.qualified && (
        <p className="mt-1 text-[14px] tabular-nums text-muted-foreground">
          <span className="font-semibold text-foreground">+{formatLeaguePoints(me.week_points)} pts</span> last week · {formatLeaguePoints(me.total_points)} total
        </p>
      )}

      {/* the one reason to come back this week, read off the live board */}
      <div {...reveal(0)} className={cn("mt-3 min-h-[44px] rounded-2xl bg-muted/70 px-3 py-2.5 text-[14px] leading-snug", reveal(0).className)} data-league-week-chase>
        {chase ?? <span className="block h-4 w-3/4 animate-pulse rounded bg-muted" aria-hidden />}
      </div>

      {(facts.length > 0 || prs) && (
        <div {...reveal(1)} className={cn("mt-3", reveal(1).className)} data-league-week-you>
          <div className="text-[13px] font-medium text-muted-foreground">Your week</div>
          {facts.length > 0 && <p className="mt-0.5 text-[14px] leading-snug">{facts.join(" · ")}</p>}
          {prs && (
            <p className="mt-1 text-[14px] font-medium leading-snug text-warning" data-league-week-prs>
              🏅 {prs}
            </p>
          )}
        </div>
      )}

      {(week.top_week.length > 0 || week.climbers.length > 0) && (
        <div {...reveal(2)} className={cn("mt-3.5 grid grid-cols-2 gap-x-3 border-t border-border/60 pt-3", reveal(2).className)}>
          <PeopleColumn title="Top week" people={week.top_week} value={(p) => `+${formatLeaguePoints(p.week_points)}`} />
          <PeopleColumn title="Biggest climbs" people={week.climbers} value={(p) => `▲${p.prev_rank - (p.rank ?? p.prev_rank)}`} tone="up" />
        </div>
      )}

      {onRankings && (
        <div {...reveal(3)} className={cn("mt-4", reveal(3).className)}>
          <Button type="button" className="h-11 w-full text-[15px]" onClick={onRankings} data-league-week-open>
            See the rankings
          </Button>
        </div>
      )}
    </article>
  );
}

function PeopleColumn<T extends WeekPerson>({ title, people, value, tone }: { title: string; people: T[]; value: (p: T) => string; tone?: "up" }) {
  if (!people.length) return <div />;
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[12px] font-medium text-muted-foreground">{title}</div>
      <ol className="space-y-1.5">
        {people.map((p) => (
          <li key={p.client_id} className="flex min-w-0 items-center gap-1.5">
            <Avatar className="h-6 w-6 shrink-0 border border-border">
              <AvatarPhoto src={p.avatar_url} alt={p.name} />
              <AvatarFallback className="text-[10px] font-bold">{(p.name || "?").slice(0, 1).toUpperCase()}</AvatarFallback>
            </Avatar>
            <span className={cn("min-w-0 flex-1 truncate text-[13px]", p.is_me && "font-semibold")}>{p.is_me ? "You" : p.name}</span>
            <span className={cn("shrink-0 text-[13px] font-semibold tabular-nums", tone === "up" && "text-success")}>{value(p)}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/** The rank ticks from last week's to this week's once it plays (never under reduced motion). */
function useTick(from: number | null, to: number | null, play: boolean): number | null {
  const reduced = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const start = from != null && to != null && from !== to && !reduced ? from : to;
  const [shown, setShown] = useState<number | null>(start);
  const done = useRef(false);
  useEffect(() => {
    if (!play || done.current || from == null || to == null || from === to || reduced) {
      if (play) setShown(to);
      return;
    }
    done.current = true;
    const steps = Math.abs(from - to);
    const dir = to < from ? -1 : 1;
    const every = Math.max(60, Math.min(160, 700 / steps));
    let n = 0;
    const id = window.setInterval(() => {
      n += 1;
      setShown(from + dir * n);
      if (n >= steps) window.clearInterval(id);
    }, every);
    return () => window.clearInterval(id);
  }, [play, from, to, reduced]);
  return shown;
}

/**
 * The card as a screen of the feed: it plays once it's on screen and counts as
 * seen after a beat there (or when dismissed), server-side, so it never comes
 * back on another phone. A coach viewing as a client sees it and records
 * nothing. Dismiss moves on to the next post.
 */
export function LeagueWeekScreen({ week, onRankings }: { week: LeagueWeek; onRankings: () => void }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [onScreen, setOnScreen] = useState(false);
  const [played, setPlayed] = useState(false);
  const seen = useMarkWeekSeen(week.week_start);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return setOnScreen(true);
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting && e.intersectionRatio >= 0.6), { threshold: [0, 0.6] });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  useEffect(() => {
    if (onScreen) setPlayed(true);
    if (!onScreen) return;
    const t = window.setTimeout(seen, 1200);
    return () => window.clearTimeout(t);
  }, [onScreen, seen]);
  const dismiss = () => {
    seen();
    // on to the next post (the screen after this one)
    const page = ref.current?.closest(".feed-page") as HTMLElement | null;
    const next = page?.nextElementSibling as HTMLElement | null;
    if (next) window.scrollTo({ top: window.scrollY + next.getBoundingClientRect().top, behavior: "smooth" });
  };
  return (
    <div ref={ref} className="mx-auto w-full max-w-[460px]" data-league-week-screen>
      <LeagueWeekCard week={week} play={played} onRankings={onRankings} onDismiss={dismiss} />
    </div>
  );
}

/** Record this week's card as seen, once (never while viewing as a client). */
function useMarkWeekSeen(weekStart: string) {
  const { user } = useAuth();
  const preview = useViewingAsClient();
  const qc = useQueryClient();
  const done = useRef(false);
  const uid = user?.id;
  const ref = useRef<() => void>(() => {});
  ref.current = () => {
    if (done.current || preview || !uid) return;
    done.current = true;
    qc.setQueryData(["league-week-seen", uid, weekStart], true);
    void markFeatureSeen(uid, spotlightSeenKey(weekStart));
  };
  // a stable callback for effects
  const [cb] = useState(() => () => ref.current());
  return cb;
}

/** Rankings' "Last week" row opens the card here, any time that week. */
export function LeagueWeekSheet({ week, open, onOpenChange }: { week: LeagueWeek | null; open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Sheet open={open && !!week} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" swipeToClose hideCloseButton className="max-h-[90dvh] overflow-y-auto overscroll-contain rounded-t-[22px] px-3 pb-[max(env(safe-area-inset-bottom),16px)] pt-2 sm:mx-auto sm:max-w-[520px]" data-league-week-sheet>
        <span className="mx-auto mb-2 block h-1 w-9 rounded-full bg-muted-foreground/30" aria-hidden />
        <SheetTitle className="sr-only">Last week in the League</SheetTitle>
        <SheetDescription className="sr-only">Your rank, how it moved, and the week's top scorers and climbers</SheetDescription>
        {week && <LeagueWeekCard week={week} play={open} bare onDismiss={() => onOpenChange(false)} dismissLabel="Close" />}
      </SheetContent>
    </Sheet>
  );
}
