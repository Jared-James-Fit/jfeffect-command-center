import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Crown, Dumbbell, Landmark, Pause, Play, Trophy } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import { cn } from "@/lib/utils";
import { leagueToday } from "@/lib/league-boost";
import { previousLeagueMonth } from "@/lib/league-recap";
import { usePerformanceLeague } from "@/lib/use-performance-league";
import { defaultDivision, useMeetBoard, useStrengthBoard } from "@/components/portal/strength-board";
import {
  SPOTLIGHT_HOLD_MS,
  SPOTLIGHT_MS,
  SPOTLIGHT_PAUSED_KEY,
  spotlightSlides,
  type SpotlightKey,
  type SpotlightPerson,
  type SpotlightSlide,
} from "@/lib/rankings-spotlight";

/** Each board's look: an icon and a tint, so you know which podium you're on at a glance. */
const LOOK: Record<SpotlightKey, { Icon: typeof Trophy; tint: string; text: string }> = {
  monthly: { Icon: Trophy, tint: "from-primary/20", text: "text-primary" },
  strength: { Icon: Dumbbell, tint: "from-amber-400/20", text: "text-amber-500" },
  competition: { Icon: Landmark, tint: "from-sky-400/20", text: "text-sky-500" },
  fame: { Icon: Crown, tint: "from-violet-500/20", text: "text-violet-500" },
};

const RING = ["ring-amber-400", "ring-zinc-300 dark:ring-zinc-400", "ring-orange-400/80"];
const MEDAL = ["🥇", "🥈", "🥉"];

function readPaused() {
  try {
    return localStorage.getItem(SPOTLIGHT_PAUSED_KEY) === "1";
  } catch {
    return false;
  }
}

/** Motion is reduced: nothing moves by itself (the app shortens every animation to ~0ms). */
function useReducedMotion() {
  // read up front: one render with motion on would already skip a podium
  const [reduced, setReduced] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => {
    const mq = window.matchMedia?.("(prefers-reduced-motion: reduce)");
    if (!mq) return;
    const sync = () => setReduced(mq.matches);
    mq.addEventListener?.("change", sync);
    return () => mq.removeEventListener?.("change", sync);
  }, []);
  return reduced;
}

/**
 * Crew → Rankings: every board's podium in one card at the top, flipping
 * every few seconds: this month's League, the Hall of Strength, the
 * Competition record, the Hall of Fame (last month's champions). Tap a podium
 * to open that board. It only moves while you're looking (on screen, app in
 * front, not touching it, motion not reduced); ⏸ stops it for good on this
 * device, swipe or tap the dots to move yourself. The progress line is the
 * clock: its fill finishing is what moves it on, so pausing pauses exactly.
 */
export function RankingsSpotlight({ onOpen, skip }: {
  onOpen: (key: SpotlightKey) => void;
  /** The board already open right under it: its podium isn't repeated up here. */
  skip?: SpotlightKey;
}) {
  const { data: monthly = [] } = usePerformanceLeague("current");
  const { data: previous = [] } = usePerformanceLeague("previous");
  const { data: strength = [] } = useStrengthBoard();
  const { data: meets = [] } = useMeetBoard();
  const slides = useMemo(
    () =>
      spotlightSlides({
        monthly,
        previous,
        strength,
        meets,
        division: defaultDivision(strength),
        monthStart: monthly[0]?.month_start ?? `${leagueToday().slice(0, 7)}-01`,
        previousMonthStart: previous[0]?.month_start ?? previousLeagueMonth(),
      }).filter((s) => s.key !== skip),
    [monthly, previous, strength, meets, skip],
  );

  const n = slides.length;
  const [at, setAt] = useState(0);
  const [dir, setDir] = useState<1 | -1>(1);
  const i = n ? at % n : 0;
  const slide = slides[i];

  const root = useRef<HTMLDivElement | null>(null);
  const reduced = useReducedMotion();
  const [stopped, setStopped] = useState(readPaused);
  const [onScreen, setOnScreen] = useState(false);
  const [appVisible, setAppVisible] = useState(true);
  const [touching, setTouching] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [held, setHeld] = useState(false);
  const holdTimer = useRef<number | null>(null);

  const hasSlides = n > 0;
  useEffect(() => {
    const el = root.current;
    if (!el || typeof IntersectionObserver === "undefined") return setOnScreen(true);
    const io = new IntersectionObserver(([e]) => setOnScreen(!!e?.isIntersecting && e.intersectionRatio >= 0.6), { threshold: [0, 0.6, 1] });
    io.observe(el);
    return () => io.disconnect();
  }, [hasSlides]);
  useEffect(() => {
    const sync = () => setAppVisible(document.visibilityState !== "hidden");
    sync();
    document.addEventListener("visibilitychange", sync);
    return () => document.removeEventListener("visibilitychange", sync);
  }, []);
  useEffect(() => () => {
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
  }, []);

  const hold = useCallback(() => {
    setHeld(true);
    if (holdTimer.current) window.clearTimeout(holdTimer.current);
    holdTimer.current = window.setTimeout(() => setHeld(false), SPOTLIGHT_HOLD_MS);
  }, []);
  const go = useCallback((d: 1 | -1) => {
    if (n < 2) return;
    setDir(d);
    setAt((x) => ((((x % n) + d) % n) + n) % n);
  }, [n]);
  const jump = (to: number) => {
    if (to !== i) {
      setDir(to > i ? 1 : -1);
      setAt(to);
    }
    hold();
  };
  const toggle = () => {
    const next = !stopped;
    setStopped(next);
    try {
      localStorage.setItem(SPOTLIGHT_PAUSED_KEY, next ? "1" : "0");
    } catch {
      /* private mode: just this visit */
    }
  };

  const cycling = n > 1 && !reduced;
  const playing = cycling && !stopped && onScreen && appVisible && !touching && !hovered && !held;

  // Swipe sideways to move; a tap still opens the board (a swipe never does).
  const start = useRef<{ x: number; y: number } | null>(null);
  const swiped = useRef(false);
  const end = (e: React.PointerEvent) => {
    const s = start.current;
    start.current = null;
    setTouching(false);
    if (!s || n < 2) return;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      swiped.current = true;
      go(dx < 0 ? 1 : -1);
      hold();
    }
  };

  if (!slide) return null;
  const look = LOOK[slide.key];
  // 2nd · 1st · 3rd, like a real podium
  const order: [SpotlightPerson | undefined, number][] = [[slide.people[1], 1], [slide.people[0], 0], [slide.people[2], 2]];
  return (
    <section
      ref={root}
      data-rankings-spotlight={slide.key}
      data-playing={playing ? "" : undefined}
      aria-roledescription="carousel"
      aria-label="Podiums"
      className={cn("relative overflow-hidden rounded-2xl border bg-card bg-gradient-to-b to-transparent to-70% transition-colors duration-500", look.tint)}
    >
      <div
        // its own sideways swipe: not the page's swipe-back
        data-no-swipe-back
        data-swipe-ignore
        onPointerDown={(e) => {
          start.current = { x: e.clientX, y: e.clientY };
          swiped.current = false;
          setTouching(true);
        }}
        onPointerUp={end}
        onPointerCancel={() => {
          start.current = null;
          setTouching(false);
        }}
        onPointerEnter={(e) => e.pointerType === "mouse" && setHovered(true)}
        onPointerLeave={(e) => {
          if (e.pointerType !== "mouse") return;
          start.current = null;
          setTouching(false);
          setHovered(false);
        }}
        onClickCapture={(e) => {
          if (!swiped.current) return;
          swiped.current = false;
          e.preventDefault();
          e.stopPropagation();
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(1);
          else if (e.key === "ArrowLeft") go(-1);
          else return;
          hold();
        }}
        className="select-none [touch-action:pan-y]"
      >
        <button
          key={`${slide.key}:${at}`}
          type="button"
          onClick={() => onOpen(slide.key)}
          aria-label={`${slide.title}: ${slide.people.map((p, k) => `${k + 1}. ${p.me ? "You" : p.name}, ${p.value}`).join("; ")}. Open the board`}
          className={cn(
            "block w-full px-3.5 pb-2 pt-3 text-left animate-in fade-in duration-300",
            dir === 1 ? "slide-in-from-right-4" : "slide-in-from-left-4",
          )}
        >
          <div className="min-w-0 pr-9">
            <div className="flex min-w-0 items-center gap-1.5">
              <look.Icon className={cn("h-4 w-4 shrink-0", look.text)} aria-hidden />
              <span className="truncate text-[15px] font-black leading-5 tracking-tight">{slide.title}</span>
            </div>
            <div className="truncate pl-[22px] text-[11px] font-semibold leading-4 text-muted-foreground">{slide.sub}</div>
          </div>
          {/* room for the winner's crown under the title */}
          <div className="mt-4 grid grid-cols-3 items-end gap-2">
            {order.map(([p, place]) => (
              <Step key={place} person={p} place={place} />
            ))}
          </div>
        </button>
      </div>

      {/* stop it (remembered on this device) or let it run */}
      {cycling && (
        <button
          type="button"
          onClick={toggle}
          aria-pressed={stopped}
          aria-label={stopped ? "Play the podiums" : "Pause the podiums"}
          className="absolute right-1.5 top-1.5 grid h-9 w-9 place-items-center rounded-full text-muted-foreground active:bg-muted"
        >
          {stopped ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
        </button>
      )}

      {n > 1 && (
        <div className="flex gap-1 px-3.5 pb-2.5" aria-label={`Podium ${i + 1} of ${n}`}>
          {slides.map((s, k) => (
            <button key={s.key} type="button" onClick={() => jump(k)} aria-label={`Show ${s.title}`} aria-current={k === i ? "true" : undefined} className="flex h-4 flex-1 items-center">
              <span className="relative h-[3px] w-full overflow-hidden rounded-full bg-muted-foreground/20">
                {k < i && <span className="absolute inset-0 rounded-full bg-foreground/40" />}
                {k === i &&
                  (cycling && !stopped ? (
                    <span
                      key={`${s.key}:${at}`}
                      className="jf-spotlight-fill absolute inset-0 origin-left rounded-full bg-foreground/70"
                      style={{ animationDuration: `${SPOTLIGHT_MS}ms`, animationPlayState: playing ? "running" : "paused" }}
                      onAnimationEnd={() => go(1)}
                    />
                  ) : (
                    <span className="absolute inset-0 rounded-full bg-foreground/70" />
                  ))}
              </span>
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/** One place on the podium: the face, the name, the number, on a step as high as the place. */
function Step({ person, place }: { person: SpotlightPerson | undefined; place: number }) {
  const first = place === 0;
  return (
    <div className="flex min-w-0 flex-col items-center">
      {person ? (
        <>
          <span className={cn("relative rounded-full ring-2 ring-offset-2 ring-offset-card", RING[place])}>
            <UserAvatar src={person.avatar_url} name={person.name} size={first ? 52 : 40} expandable={false} />
            {first && <Crown className="absolute -top-3.5 left-1/2 h-4 w-4 -translate-x-1/2 fill-amber-400 text-amber-500" aria-hidden />}
          </span>
          <span className={cn("mt-1.5 w-full truncate text-center text-[12px] font-bold leading-4", person.me && "text-primary")}>{person.me ? "You" : person.name}</span>
          <span className="w-full truncate text-center text-[11px] font-black tabular-nums leading-4 text-muted-foreground">{person.value}</span>
        </>
      ) : (
        <span className="h-10" />
      )}
      <span
        className={cn(
          "mt-1.5 grid w-full place-items-center rounded-t-lg text-[12px] leading-none",
          first ? "h-7 bg-amber-400/25" : place === 1 ? "h-5 bg-muted" : "h-4 bg-muted/70",
        )}
        aria-hidden
      >
        {person ? MEDAL[place] : ""}
      </span>
    </div>
  );
}
