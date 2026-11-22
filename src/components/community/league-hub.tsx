import { useRef, useState, type TouchEvent } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId, useViewingAsClient } from "@/lib/client-impersonation";
import { useAuth } from "@/lib/auth";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { AthleteLevelCard } from "@/components/portal/athlete-level-card";
import { StrengthBoardSlide } from "@/components/portal/strength-board";
import { LeagueRecapButton } from "@/components/portal/league-recap";
import { inRecapWindow } from "@/lib/league-recap";
import { RankingsSpotlight } from "@/components/community/rankings-spotlight";
import type { SpotlightSlide, StrengthView } from "@/lib/rankings-spotlight";
import { feedback } from "@/lib/feedback";
import { RankingsMusicButton, useRankingsMusic } from "@/components/community/rankings-music";

export type RankingsBoard = "monthly" | "strength";

/**
 * Which board a link asks for: `#rankings=strength` / `#league=strength` (Home's
 * Hall of Strength tile) → Strength; `#rankings`, `#league`, `#league=standings`
 * → Monthly; anything else → null (not a Rankings link).
 */
export function rankingsFromHash(hash = typeof window === "undefined" ? "" : window.location.hash): RankingsBoard | null {
  if (!/#(rankings|league)/.test(hash)) return null;
  return /(rankings|league)=strength/.test(hash) ? "strength" : "monthly";
}

/**
 * The board a sideways swipe lands on, or null: at least 60px across and
 * clearly more across than down (so scrolling the page never flips it).
 * Swiping left goes to Strength, right goes back to Monthly.
 */
export function boardAfterSwipe(board: RankingsBoard, dx: number, dy: number): RankingsBoard | null {
  if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return null;
  if (dx < 0 && board === "monthly") return "strength";
  if (dx > 0 && board === "strength") return "monthly";
  return null;
}

/** The two boards, named for what they are (Crew → Rankings' switch). */
export const BOARD_TABS: readonly (readonly [RankingsBoard, string])[] = [
  ["monthly", "Monthly League"],
  ["strength", "Hall of Strength"],
];

/**
 * Crew → Rankings (the third tab in Crew's bar): one board at a time, picked
 * with the switch at the top. Monthly League (points this month, you first,
 * then the Top 10 with how far each moved since Monday) and Hall of Strength
 * (all-time bests). The other boards' podiums flip under the board, a tap
 * from opening theirs. Every card opens its full view. A coach sees the
 * crew's board without a "you".
 */
export function RankingsHub() {
  // the person whose portal this is (the client in coach "View as")
  const userId = usePortalUserId();
  const { role } = useAuth();
  const preview = useViewingAsClient();
  // a coach on their own Crew page (not viewing as a client): the board, no "you"
  const spectator = (role === "admin" || role === "coach") && !preview;
  const { data: client, isPending } = useQuery({
    queryKey: ["my-client", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase.from("clients").select("*").eq("user_id", userId!).maybeSingle();
      return data;
    },
  });
  const [board, setBoardState] = useState<RankingsBoard>(() => rankingsFromHash() ?? "monthly");
  // a podium tapped in the spotlight: which view of the board to open on (a new `n` remounts it there)
  const [opened, setOpened] = useState<{ n: number; view: StrengthView | null; previous: boolean }>({ n: 0, view: null, previous: false });
  const tabsRef = useRef<HTMLDivElement | null>(null);
  // which way the new board slides in (from a swipe or a tab tap)
  const [enterFrom, setEnterFrom] = useState<"left" | "right" | null>(null);
  // each board's theme (off until they turn it on, on this phone), following the board
  const music = useRankingsMusic(board === "strength" ? "hall" : "league");
  const setBoard = (next: RankingsBoard) => {
    if (next === board) return;
    // the board slides in with a soft swish
    feedback("board");
    setEnterFrom(next === "strength" ? "right" : "left");
    setBoardState(next);
    // a tab or a swipe opens a board as usual (not on whatever a podium tap asked for)
    setOpened((o) => ({ ...o, view: null, previous: false }));
  };

  // Swipe sideways on the board to switch Monthly ⇄ Strength (the tabs follow).
  // Only a clearly horizontal, single-finger swipe that starts on the board
  // itself counts: vertical scrolling, taps, sliders and anything in a sheet
  // opened from the board (portalled, but its events still bubble here) are left alone.
  const boardRef = useRef<HTMLDivElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (e: TouchEvent) => {
    const t = e.touches[0];
    const target = e.target as Node;
    touch.current =
      e.touches.length === 1 && boardRef.current?.contains(target) && !(target as HTMLElement).closest?.("input, textarea, [role=slider], [data-no-swipe]")
        ? { x: t.clientX, y: t.clientY }
        : null;
  };
  const onTouchEnd = (e: TouchEvent) => {
    const start = touch.current;
    touch.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    const next = boardAfterSwipe(board, t.clientX - start.x, t.clientY - start.y);
    if (next) setBoard(next);
  };

  const openFromSpotlight = (slide: SpotlightSlide) => {
    const next: RankingsBoard = slide.board === "strength" ? "strength" : "monthly";
    setEnterFrom(next === board ? null : next === "strength" ? "right" : "left");
    setBoardState(next);
    // Women · Heaviest total opens the board on Women, Heaviest; Champions on last month's standings
    setOpened((o) => ({ n: o.n + 1, view: slide.view ?? null, previous: slide.board === "champions" }));
    // the board sits right under the spotlight: bring it up
    requestAnimationFrame(() => tabsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  return (
    <div data-league-hub className="space-y-3">
      {/* which board: the first thing on the page, so the two never blur together; its theme music beside it */}
      <div ref={tabsRef} className="flex scroll-mt-[calc(var(--app-safe-top)+3.75rem)] items-center gap-2">
      <div className="grid min-w-0 flex-1 grid-cols-2 rounded-full bg-muted/60 p-1 text-[14px] font-semibold" role="tablist" aria-label="Leaderboard">
        {BOARD_TABS.map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={board === k}
            onClick={() => setBoard(k)}
            className={cn("min-h-10 truncate rounded-full px-2 transition-colors", board === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground")}
            data-rankings-tab={k}
          >
            {label}
          </button>
        ))}
      </div>
      <RankingsMusicButton theme={board === "strength" ? "hall" : "league"} on={music.on} playing={music.playing} onToggle={music.toggle} />
      </div>
      {/* last month's recap: up here in recap week (news); the rest of the month it's a row under the Monthly board */}
      {inRecapWindow() && !spectator && <LeagueRecapButton />}
      <div
        ref={boardRef}
        key={`${board}:${opened.n}`}
        data-rankings-board={board}
        onTouchStart={onTouchStart}
        onTouchEnd={onTouchEnd}
        onTouchCancel={() => (touch.current = null)}
        className={cn(
          "[touch-action:pan-y_pinch-zoom]",
          enterFrom && "animate-in fade-in duration-200",
          enterFrom === "right" && "slide-in-from-right-6",
          enterFrom === "left" && "slide-in-from-left-6",
        )}
      >
      {board === "strength" ? (
        <section data-standing="strength" className="overflow-hidden rounded-2xl border bg-card">
          <StrengthBoardSlide initialMode={opened.view?.mode} initialDivision={opened.view?.division} />
        </section>
      ) : client?.id ? (
        <AthleteLevelCard clientId={client.id} openPrevious={opened.previous} />
      ) : spectator ? (
        <AthleteLevelCard clientId={null} openPrevious={opened.previous} />
      ) : isPending && userId ? (
        <Skeleton className="h-64 w-full rounded-2xl" />
      ) : (
        <div className="rounded-2xl border border-dashed border-border px-5 py-10 text-center text-[13px] text-muted-foreground">The monthly League is for active coaching clients.</div>
      )}
      </div>
      {/* the other boards' podiums, flipping (pause-able), under the board you're on: a tap opens that board */}
      <RankingsSpotlight onOpen={openFromSpotlight} under={board} underView={opened.view} />
    </div>
  );
}
