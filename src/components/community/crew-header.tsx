import { useEffect, useState, type ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/** The bar's height under the status bar: 48px, Instagram's. */
export const CREW_BAR_HEIGHT = "3rem";

/**
 * Reading down the feed, the bar slides away; the moment you scroll back up
 * (or reach the top) it's there again, Instagram's way. Small moves don't
 * count, so it never flickers on a jittery thumb or iOS's rubber band.
 */
export function useBarHidden(enabled: boolean): boolean {
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    if (!enabled) {
      setHidden(false);
      return;
    }
    let last = window.scrollY;
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const y = window.scrollY;
        const dy = y - last;
        if (y < 56) {
          setHidden(false);
          last = y;
        } else if (dy > 8) {
          setHidden(true);
          last = y;
        } else if (dy < -8) {
          setHidden(false);
          last = y;
        }
      });
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [enabled]);
  return hidden;
}

/**
 * Crew's one top bar: left, a centred middle, right. The middle sits in the
 * centre of the bar whenever it fits, and gives way only as much as the
 * buttons need (a grid whose sides are equal but never narrower than their
 * buttons), so Crew · Following · Rankings fit a 320px phone. On phones it's fixed under
 * the status bar (the shell's own bar steps aside on Crew) and slides away
 * while you read down; on wider screens it sits at the top of the column. A
 * coach viewing as a client gets the very same bar, under the preview banner
 * (--app-chrome-top), so there's still one bar.
 *
 * `overlay`: over the paged feed's posts (TikTok's): on a phone it's
 * see-through with a soft shade under its icons and the notch kept solid
 * black (styles.css, `.crew-bar[data-overlay]`), so every post runs up under
 * it; always dark, like the feed under it.
 */
export function CrewBar({ left, center, right, hidden = false, overlay = false, label }: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  hidden?: boolean;
  overlay?: boolean;
  label: string;
}) {
  return (
    <>
      <header
        aria-label={label}
        data-crew-bar
        data-hidden={hidden ? "" : undefined}
        data-overlay={overlay ? "" : undefined}
        // over the paged feed it's dark whatever the theme, like the posts under it
        className={cn("crew-bar fixed inset-x-0 top-[var(--app-chrome-top)] z-40 bg-background md:relative md:inset-auto", overlay && "dark text-foreground")}
        style={{ paddingTop: "var(--app-safe-top)" }}
      >
        <div
          className="relative mx-auto grid w-full max-w-[560px] grid-cols-[minmax(max-content,1fr)_minmax(0,auto)_minmax(max-content,1fr)] items-center px-1.5"
          style={{ height: CREW_BAR_HEIGHT }}
          data-crew-bar-row
        >
          <div className="flex items-center justify-self-start">{left}</div>
          <div className="flex min-w-0 items-center justify-center overflow-hidden px-1" data-crew-bar-center>{center}</div>
          <div className="flex items-center justify-self-end">{right}</div>
        </div>
      </header>
      {/* holds the bar's room in the page, so nothing jumps under it */}
      <div aria-hidden className="md:hidden" style={{ height: `calc(var(--app-safe-top) + ${CREW_BAR_HEIGHT})` }} />
    </>
  );
}

/** A 40px round icon button for the bar (44pt tap area with the bar's padding). */
export function BarButton({ label, onClick, children, className, ...rest }: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
} & Record<`data-${string}`, string | boolean | undefined>) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      className={cn("relative grid h-10 w-10 shrink-0 place-items-center rounded-full text-foreground transition-transform active:scale-90", className)}
      {...rest}
    >
      {children}
    </button>
  );
}

/** ‹ back, for the pages opened from the feed (Rankings, a profile). */
export function BarBack({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <BarButton label={label} onClick={onClick} data-crew-back>
      <ChevronLeft className="h-7 w-7" strokeWidth={2} />
    </BarButton>
  );
}

/** A page's name in the middle of the bar. */
export function BarTitle({ children }: { children: ReactNode }) {
  return <h1 className="truncate text-[16px] font-bold tracking-tight">{children}</h1>;
}

export type CrewFeedTab = "crew" | "following";
/** Crew's three top tabs: the feed's two looks, then Rankings. */
export type CrewTab = CrewFeedTab | "rankings";

export const CREW_TABS: readonly (readonly [CrewTab, string])[] = [
  ["crew", "Crew"],
  ["following", "Following"],
  ["rankings", "Rankings"],
];

/**
 * Crew's top tabs in the middle of its bar, TikTok's Following / For You:
 * Crew (everyone, where the feed always opens), Following (people you follow
 * and what they repost) and Rankings (the Monthly League and the Hall of
 * Strength). The one you're on is full strength with a short line under it; a
 * tap on it again goes back to its top. Over the paged feed the words get the
 * icons' soft shadow (styles.css). Sized to fit three across a 320px phone
 * between Crew's buttons.
 */
function warmRankingsMusic() {
  void import("@/components/community/rankings-music").then((m) => m.warmRankingsMusicIfOn(), () => {});
}

export function CrewFeedTabs({ tab, onPick, compact = false }: {
  tab: CrewTab;
  onPick: (t: CrewTab) => void;
  /** Two buttons on the left (the coach's + and Manage): a size smaller, so all three still fit. */
  compact?: boolean;
}) {
  return (
    <div
      role="tablist"
      aria-label="Crew"
      className={cn("flex items-center", compact ? "gap-3 max-[389px]:gap-2 max-[359px]:gap-1" : "gap-4 max-[389px]:gap-3 max-[359px]:gap-2")}
      data-crew-feed-tabs
    >
      {CREW_TABS.map(([k, label]) => {
        const on = tab === k;
        return (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={on}
            onClick={() => onPick(k)}
            // Rankings' music is decoded as the finger lands, so it's ready as the tab opens
            onPointerDown={k === "rankings" ? warmRankingsMusic : undefined}
            // both bold, so picking one never shifts the other; the one you're off is quieter
            className={cn(
              "relative h-10 px-0.5 font-bold leading-none tracking-[-0.01em] transition-colors active:opacity-70",
              compact ? "text-[15px] max-[389px]:text-[13.5px] max-[359px]:text-[11px]" : "text-[16px] max-[389px]:text-[15px] max-[359px]:text-[13.5px]",
              on ? "text-foreground" : "text-foreground/55",
            )}
            data-crew-feed-tab={k}
            data-on={on ? "" : undefined}
          >
            {label}
            <span
              aria-hidden
              className={cn(
                "absolute bottom-[3px] left-1/2 h-[2.5px] w-5 -translate-x-1/2 rounded-full bg-foreground transition-[transform,opacity] duration-200 ease-out motion-reduce:transition-none",
                on ? "scale-x-100 opacity-100" : "scale-x-0 opacity-0",
              )}
            />
          </button>
        );
      })}
    </div>
  );
}
