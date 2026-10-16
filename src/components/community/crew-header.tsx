import { useEffect, useState, type ReactNode } from "react";
import { Check, ChevronDown, ChevronLeft } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
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
 * Crew's one top bar: left, a centred title, right. On phones it's fixed under
 * the status bar (the shell's own bar steps aside on Crew) and slides away
 * while you read down; on wider screens it sits at the top of the column.
 * `inline` keeps it in the page (a coach previewing a client, where the
 * shell's bar and the preview banner stay).
 */
export function CrewBar({ left, center, right, hidden = false, inline = false, label }: {
  left?: ReactNode;
  center?: ReactNode;
  right?: ReactNode;
  hidden?: boolean;
  inline?: boolean;
  label: string;
}) {
  return (
    <>
      <header
        aria-label={label}
        data-crew-bar
        data-hidden={hidden && !inline ? "" : undefined}
        className={cn(
          "crew-bar z-40 bg-background/90 backdrop-blur-xl supports-[backdrop-filter]:bg-background/80",
          inline ? "relative" : "fixed inset-x-0 top-0 md:relative md:inset-auto",
        )}
        style={inline ? undefined : { paddingTop: "env(safe-area-inset-top, 0px)" }}
      >
        <div className="relative mx-auto flex w-full max-w-[560px] items-center justify-between px-1.5" style={{ height: CREW_BAR_HEIGHT }}>
          <div className="relative z-10 flex min-w-0 items-center">{left}</div>
          {center != null && (
            <div className="pointer-events-none absolute inset-x-[92px] inset-y-0 flex items-center justify-center">
              <div className="pointer-events-auto flex min-w-0 max-w-full items-center justify-center">{center}</div>
            </div>
          )}
          <div className="relative z-10 flex min-w-0 items-center">{right}</div>
        </div>
      </header>
      {/* holds the bar's room in the page, so nothing jumps under it */}
      {!inline && <div aria-hidden className="md:hidden" style={{ height: `calc(env(safe-area-inset-top, 0px) + ${CREW_BAR_HEIGHT})` }} />}
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

/**
 * The brand in the middle of Crew's bar: the JF mark and the name. With people
 * you follow, it's also the feed's filter (Instagram's ⌄): All or Following,
 * and the name says which you're on.
 */
export function CrewBrand({ following, canFilter, onFilter, onTop }: {
  following: boolean;
  canFilter: boolean;
  onFilter: (f: "all" | "following") => void;
  /** Tapping the name without a menu: back to the top of the feed. */
  onTop: () => void;
}) {
  const mark = (
    <>
      <img src="/logo.png" alt="" aria-hidden className="h-[26px] w-[26px] shrink-0 rounded-[7px] object-cover max-[359px]:h-[22px] max-[359px]:w-[22px] max-[359px]:rounded-[6px]" />
      {/* italic letters lean past their box: a little room on the right so the T isn't clipped */}
      {/* the name, or (filtered) plain "Following", Instagram's title for it */}
      <span
        className={cn(
          "truncate pr-[3px] leading-[1.1]",
          following ? "text-[18px] font-extrabold tracking-[-0.02em] max-[359px]:text-[16px]" : "text-[19px] font-black uppercase italic tracking-[-0.035em] max-[359px]:text-[16px]",
        )}
        data-crew-brand-name
      >
        {following ? "Following" : "JF Effect"}
      </span>
    </>
  );
  if (!canFilter) {
    return (
      <button type="button" onClick={onTop} className="flex min-w-0 items-center gap-2 active:opacity-70 max-[359px]:gap-1.5" aria-label="JF Effect Crew" data-crew-brand>
        {mark}
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="flex min-w-0 items-center gap-2 active:opacity-70 max-[359px]:gap-1.5" aria-label={following ? "Showing people you follow. Change feed" : "Showing the whole crew. Change feed"} data-crew-brand data-crew-filter>
          {mark}
          <ChevronDown className="-ml-0.5 h-4 w-4 shrink-0 text-muted-foreground max-[359px]:-ml-1 max-[359px]:h-3.5 max-[359px]:w-3.5" strokeWidth={2.4} />
        </button>
      </DropdownMenuTrigger>
      {/* no focus ring left on the name after picking (a tap, not a keyboard) */}
      <DropdownMenuContent align="center" sideOffset={6} className="min-w-[210px] rounded-xl" onCloseAutoFocus={(e) => e.preventDefault()}>
        {([
          ["all", "The whole crew", "Everyone's posts"],
          ["following", "Following", "Just people you follow"],
        ] as const).map(([k, title, sub]) => {
          const on = k === "following" ? following : !following;
          return (
            <DropdownMenuItem key={k} onSelect={() => onFilter(k)} className="gap-3 py-2.5" data-crew-filter-option={k}>
              <span className="min-w-0 flex-1">
                <span className="block text-[14px] font-semibold">{title}</span>
                <span className="block text-[12px] text-muted-foreground">{sub}</span>
              </span>
              {on && <Check className="h-4 w-4 shrink-0 text-primary" strokeWidth={2.6} />}
            </DropdownMenuItem>
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
