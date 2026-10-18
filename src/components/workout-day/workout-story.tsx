import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, Check, CheckCircle2, ChevronLeft, ChevronRight, Clock, HelpCircle, Loader2, MessageCircle, RectangleVertical, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkoutView } from "@/lib/use-workout-view";
import { formatElapsed, isSessionAbandoned, readWorkoutSession, sessionElapsedMs } from "@/components/workout-day/WorkoutTimer";

/**
 * Focus view (stored as "story"): the workout one exercise at a time, full
 * screen. Swipe up for the next exercise and down to go back, or use ‹ / Next
 * and the bars up top (where you are and what's done). A tap never moves: in
 * a logger, a tap that misses a set box by a hair must not throw you to
 * another exercise mid-set. A sideways swipe is the card's own (swipe to
 * delete). It's the same exercise cards as the list, laid out side by side
 * (WorkoutDayView switches the list's classes), so switching view never
 * reloads a card or loses what's typed.
 */

/** Something open over Focus (a swiped-open card, a menu, a sheet): a swipe under it isn't a move. */
const OPEN_LAYER = '[data-swipe-open], [role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

/** A swipe up or down this long moves to the next / previous exercise… */
export const SWIPE_COMMIT_PX = 56;
/** …or a quick flick: at least this long, moving this fast as the finger lifts (px per ms). */
export const FLICK_MIN_PX = 24;
export const FLICK_PX_PER_MS = 0.3;
/** The flick's speed is read over the finger's last moments, not the whole drag… */
export const FLICK_WINDOW_MS = 100;
/** …and a finger that stopped this long before lifting wasn't flicking. */
export const FLICK_IDLE_MS = 120;
/** A swipe is up / down when it's at least this steep (|dy| ≥ ratio × |dx|): a thumb swiping up one-handed arcs sideways. Swipe to delete only claims |dx| ≥ 1.6 × |dy|. */
export const SWIPE_VERTICAL_RATIO = 0.8;
/** Scroll positions within this of a card's end count as the end (phones report fractions of a pixel). */
export const EDGE_SLOP_PX = 4;
/** A card with no more than this to scroll is "a little too tall": one swipe or flick scrolls it and moves on. A longer one is read first: only a deliberate swipe past its end (no flick) moves on. */
export const NEARLY_FITS_PX = 96;

/**
 * Where a swipe up or down goes: up (the finger moves up) is the next
 * exercise, down the one before; 0 stays. `speed` is how fast the finger was
 * still going that way as it lifted (px per ms). A long card scrolls first: up
 * only from its bottom, down only from its top (where it was when the finger
 * went down), so reading a long card never skips it.
 */
export function focusSwipeDirection(s: { dy: number; speed: number; atTop: boolean; atBottom: boolean }): -1 | 0 | 1 {
  if (s.dy === 0) return 0;
  const dir = s.dy < 0 ? 1 : -1;
  if (dir === 1 ? !s.atBottom : !s.atTop) return 0;
  const dist = Math.abs(s.dy);
  if (dist >= SWIPE_COMMIT_PX) return dir;
  return dist >= FLICK_MIN_PX && s.speed >= FLICK_PX_PER_MS ? dir : 0;
}

/**
 * How fast the finger was moving along dy's direction as it lifted at `liftT`
 * (px per ms): over its last FLICK_WINDOW_MS of moves, 0 if it had stopped.
 */
export function flickSpeed(samples: ReadonlyArray<{ y: number; t: number }>, dy: number, liftT: number): number {
  if (samples.length < 2 || dy === 0) return 0;
  const last = samples[samples.length - 1];
  if (liftT - last.t > FLICK_IDLE_MS) return 0;
  let first = samples[samples.length - 2];
  // pulled back before letting go: not a flick that way
  if ((last.y - first.y) * Math.sign(dy) < 0) return 0;
  for (let i = samples.length - 2; i >= 0 && last.t - samples[i].t <= FLICK_WINDOW_MS; i--) first = samples[i];
  const dt = Math.max(1, last.t - first.t);
  return Math.max(0, ((last.y - first.y) * Math.sign(dy)) / dt);
}

/**
 * A swipe on a card that had more to show that way: the card scrolls to its
 * end first, and what the finger travelled past the end is the swipe (so a
 * card a little taller than the screen never takes two swipes). `travel` is
 * the finger's distance, `scrolled` how far the card moved, `room` how far it
 * could; all in the swipe's direction.
 */
export function pastEdge(travel: number, scrolled: number, room: number): number {
  return Math.max(0, travel - Math.min(Math.max(0, room), Math.max(0, scrolled)));
}

/** Where a swipe that first scrolled its card goes (see pastEdge): a card that nearly fits moves on like any swipe; a long one only on a deliberate pull past its end. */
export function pastEdgeDirection(s: { up: boolean; past: number; room: number; speed: number }): -1 | 0 | 1 {
  const dir = s.up ? 1 : -1;
  if (s.room <= NEARLY_FITS_PX) return focusSwipeDirection({ dy: s.up ? -s.past : s.past, speed: s.speed, atTop: true, atBottom: true });
  return s.past >= SWIPE_COMMIT_PX ? dir : 0;
}

/** Something between the finger and the screen that scrolls up and down by itself (a notes box): its drag is a scroll. */
function scrollsOnItsOwn(from: Element | null, slide: HTMLElement): boolean {
  for (let n = from; n && n !== slide; n = n.parentElement) {
    if (n instanceof HTMLTextAreaElement) return true;
    // more than a rounding's worth: a sideways row's 1px overflow isn't a scroller
    if (n.scrollHeight - n.clientHeight > EDGE_SLOP_PX) {
      const oy = getComputedStyle(n).overflowY;
      if (oy === "auto" || oy === "scroll") return true;
    }
  }
  return false;
}

const TYPING = 'input, textarea, select, [contenteditable="true"]';

/** Where story view opens: the exercise you were looking at, or the next one not done yet after it. */
export function pickStoryStart(order: string[], done: ReadonlySet<string>, from: string | null): number {
  if (order.length === 0) return 0;
  const start = Math.max(0, from ? order.indexOf(from) : 0);
  if (!done.has(order[start])) return start;
  for (let i = start + 1; i < order.length; i++) if (!done.has(order[i])) return i;
  for (let i = 0; i < start; i++) if (!done.has(order[i])) return i;
  return start;
}

/** The exercise card on screen in the list (null at the top of the page: start from the first). */
export function exerciseInView(list: HTMLElement | null): string | null {
  if (!list || typeof window === "undefined" || window.scrollY < 80) return null;
  for (const el of Array.from(list.querySelectorAll<HTMLElement>("[data-story-slide]"))) {
    // the first card still showing below the top bar
    if (el.getBoundingClientRect().bottom > 160) return el.dataset.storySlide ?? null;
  }
  return null;
}

/** The card inside an exercise's slide (what glides between the list and the stage). */
export function slideCard(list: HTMLElement | null, rowId: string | null | undefined): HTMLElement | null {
  if (!list || !rowId) return null;
  return (list.querySelector<HTMLElement>(`[data-story-slide="${CSS.escape(rowId)}"]`)?.firstElementChild as HTMLElement | null) ?? null;
}

/** That card, only if it's on screen right now (one off screen would fly in from nowhere). */
export function visibleCard(list: HTMLElement | null, rowId: string | null | undefined): HTMLElement | null {
  const card = slideCard(list, rowId);
  if (!card || typeof window === "undefined") return null;
  const r = card.getBoundingClientRect();
  return r.bottom > 0 && r.top < window.innerHeight ? card : null;
}

const reducedMotion = () => typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

/**
 * Switch views inside a view transition (iOS 18+, Chrome): the browser
 * snapshots both screens and cross-fades them, and `card` glides between its
 * two places. False when it can't (older phones, reduced motion): the caller
 * switches without one.
 */
export function runStoryTransition(update: () => void, card: HTMLElement | null): boolean {
  if (typeof document === "undefined" || reducedMotion()) return false;
  const doc = document as Document & { startViewTransition?: (cb: () => void) => { finished: Promise<void> } };
  if (typeof doc.startViewTransition !== "function") return false;
  const root = document.documentElement;
  root.classList.add("jf-story-vt");
  card?.style.setProperty("view-transition-name", "jf-story-card");
  try {
    const t = doc.startViewTransition(() => flushSync(update));
    void t.finished.finally(() => {
      root.classList.remove("jf-story-vt");
      card?.style.removeProperty("view-transition-name");
    });
    return true;
  } catch {
    root.classList.remove("jf-story-vt");
    card?.style.removeProperty("view-transition-name");
    return false;
  }
}

/** List ↔ Focus at the top of the workout. */
export function WorkoutViewToggle({ view, onChange, className, hint = false }: { view: WorkoutView; onChange: (view: WorkoutView) => void; className?: string; /** Glow on Focus while the intro invites people to try it. */ hint?: boolean }) {
  const options: Array<{ value: WorkoutView; label: string; icon: typeof Rows3 }> = [
    { value: "list", label: "List", icon: Rows3 },
    { value: "story", label: "Focus", icon: RectangleVertical },
  ];
  return (
    <div
      role="radiogroup"
      aria-label="Workout view"
      data-testid="workout-view-toggle"
      className={cn("inline-flex h-7 shrink-0 items-center rounded-full bg-secondary/70 p-0.5", className)}
    >
      {options.map(({ value, label, icon: Icon }) => {
        const on = view === value;
        return (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={value === "story" ? "Focus: one exercise at a time, full screen" : "List: every exercise on one page"}
            data-view={value}
            onClick={() => { if (!on) onChange(value); }}
            className={cn(
              "inline-flex h-6 items-center gap-1 rounded-full px-2.5 text-xs font-bold transition-colors duration-200",
              on ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground",
              hint && value === "story" && !on && "badge-pulse text-foreground",
            )}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {label}
          </button>
        );
      })}
    </div>
  );
}

/** The workout clock as plain text for Focus's top bar: only while it's running (or paused). */
export function FocusClock({ dayId }: { dayId: string }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  const session = readWorkoutSession(dayId);
  if (!session || session.stoppedAt != null || isSessionAbandoned(session, now)) return null;
  const elapsed = formatElapsed(Math.floor(sessionElapsedMs(session, now) / 1000));
  return (
    <>
      <span data-testid="focus-clock" className="inline-flex shrink-0 items-center gap-1 tabular-nums">
        <Clock className="h-3 w-3" aria-hidden />
        {session.pausedAt != null ? `Paused ${elapsed}` : elapsed}
      </span>
      <span aria-hidden>·</span>
    </>
  );
}

export type StoryFinish =
  | { kind: "finish"; review: boolean; onFinish: () => Promise<void> | void }
  | { kind: "done" };

/** Focus's top (progress bars, ← Workouts, ? and List, where you are) and bottom (‹ and Next ›) bars. */
export function StoryChrome({
  names,
  done,
  listRef,
  initialIndex,
  onIndex,
  title,
  timer,
  finish,
  onJump,
  onExit,
  onDone,
  onHelp,
  back,
}: {
  /** Exercise names in order. */
  names: string[];
  /** Per exercise: every set logged. */
  done: boolean[];
  /** The list laid out side by side: the bars follow its scroll. */
  listRef: RefObject<HTMLDivElement | null>;
  initialIndex: number;
  /** Told when the exercise on screen changes (no re-render of the page). */
  onIndex: (index: number) => void;
  title: string;
  /** The workout clock (FocusClock), while the workout is open. */
  timer?: ReactNode;
  /** What the last exercise's button does. */
  finish: StoryFinish;
  /** Move to an exercise (`instant`: no sideways glide, a swipe brings its own). */
  onJump: (index: number, opts?: { instant?: boolean }) => void;
  /** The List button: back to the list, and the list is the saved choice again. */
  onExit: () => void;
  /** "Back to the list" at the end of a finished workout: just for now. */
  onDone: () => void;
  /** The ? in the top bar: how Focus works (the tips). */
  onHelp?: () => void;
  /** Leaving the workout, like the list page's own back button (Focus stays the saved view). */
  back?: { label: string; onBack: () => void };
}) {
  const count = names.length;
  const [rawIndex, setIndex] = useState(initialIndex);
  const index = Math.max(0, Math.min(rawIndex, count - 1));
  const onIndexRef = useRef(onIndex);
  onIndexRef.current = onIndex;
  // Follow the row of screens here, so only these bars re-render as it moves.
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let raf = 0;
    let current = -1;
    const read = () => {
      raf = 0;
      if (!el.clientWidth) return;
      const i = Math.round(el.scrollLeft / el.clientWidth);
      if (i === current) return;
      current = i;
      setIndex(i);
      onIndexRef.current(i);
    };
    const onScroll = () => { if (!raf) raf = requestAnimationFrame(read); };
    el.addEventListener("scroll", onScroll, { passive: true });
    read();
    return () => {
      el.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [listRef]);

  // Swipe up / down (touch): the card follows the finger, and a long enough
  // swipe or a quick flick moves on, the next card rising in from where the
  // finger went. A long card scrolls first (focusSwipeDirection). Quick swipes
  // queue: each moves on from where the last one was heading. At either end
  // the card holds, a chevron nudges and the bottom button pulses. Arrow keys
  // on a keyboard.
  const latest = useRef({ index, count, onJump });
  // the bars are part of the swipe area too (the thumb rests on the bottom one)
  const topRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);
  latest.current = { index, count, onJump };
  // at either end: a chevron nudges on that side (and Next / Finish pulses)
  const [nudge, setNudge] = useState<{ dir: -1 | 1; k: number } | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let heading: number | null = null; // where the last move sent us, until we get there
    let settle: number | undefined;
    const go = (dir: -1 | 1, how: "key" | "swipe"): boolean => {
      const { index: i, count: n, onJump: jump } = latest.current;
      const to = (heading ?? i) + dir;
      if (to < 0 || to >= n) {
        setNudge({ dir, k: Date.now() });
        if (dir === 1) setBump(Date.now());
        return false;
      }
      heading = to;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { heading = null; }, 900);
      if (how === "key") {
        jump(to);
        return true;
      }
      // a swipe: straight there, and the card comes in from where the finger went
      jump(to, { instant: true });
      const card = el.querySelectorAll<HTMLElement>("[data-story-slide]")[to]?.firstElementChild as HTMLElement | null;
      if (card && !reducedMotion()) {
        card.animate(
          [{ transform: `translateY(${dir * 64}px)`, opacity: 0 }, { transform: "none", opacity: 1 }],
          { duration: 260, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" },
        );
      }
      return true;
    };
    // ── Swipe up / down ──
    // A swipe starts anywhere on the card's screen or on Focus's own bars (the
    // thumb rests on the bottom one). "drag": the card fits that way, so it
    // follows the finger; "scroll": it had more to show, so it scrolls to its
    // end and what the finger travels past the end is the swipe (pastEdge).
    const swipe = {
      on: false, decided: false, mode: "drag" as "drag" | "scroll", x: 0, y: 0, dy: 0,
      atTop: false, atBottom: false, card: null as HTMLElement | null, slide: null as HTMLElement | null,
      startScroll: 0, maxScroll: 0,
      samples: [] as Array<{ y: number; t: number }>,
    };
    const zones = [el, topRef.current, bottomRef.current].filter((z): z is HTMLDivElement => !!z);
    const slideOnScreen = () => {
      const { index: i } = latest.current;
      return el.querySelectorAll<HTMLElement>("[data-story-slide]")[heading ?? i] ?? null;
    };
    let swallowUntil = 0; // the click a swipe's release would land on the new card
    const dragTo = (card: HTMLElement, dy: number) => {
      const { index: i, count: n } = latest.current;
      const dir = dy < 0 ? 1 : -1;
      const edge = (heading ?? i) + dir < 0 || (heading ?? i) + dir >= n;
      card.style.transition = "none";
      card.style.transform = dy ? `translateY(${dy * (edge ? 0.15 : 0.4)}px)` : "";
      card.style.opacity = dy && !edge ? String(1 - Math.min(0.35, Math.abs(dy) / 700)) : "";
    };
    const settleBack = (card: HTMLElement | null) => {
      if (!card) return;
      card.style.transition = "transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease-out";
      card.style.transform = "";
      card.style.opacity = "";
      window.setTimeout(() => { card.style.transition = ""; }, 240);
    };
    const onTouchStart = (e: TouchEvent) => {
      swipe.on = false;
      if (e.touches.length !== 1 || document.querySelector(OPEN_LAYER)) return;
      // keyboard up: a drag is reading the card, not moving on (Done closes it first)
      if (document.activeElement?.closest?.(TYPING)) return;
      const target = e.target instanceof Element ? e.target : null;
      let slide = target?.closest<HTMLElement>("[data-story-slide]") ?? null;
      if (slide && el.contains(slide)) {
        if (scrollsOnItsOwn(target, slide)) return;
      } else {
        // on the top or bottom bar: the exercise on screen
        slide = slideOnScreen();
        if (!slide) return;
      }
      const t = e.touches[0];
      swipe.on = true;
      swipe.decided = false;
      swipe.mode = "drag";
      swipe.x = t.clientX;
      swipe.y = t.clientY;
      swipe.samples = [{ y: t.clientY, t: e.timeStamp }];
      swipe.dy = 0;
      swipe.slide = slide;
      swipe.startScroll = slide.scrollTop;
      swipe.maxScroll = Math.max(0, slide.scrollHeight - slide.clientHeight);
      swipe.atTop = swipe.startScroll <= EDGE_SLOP_PX;
      swipe.atBottom = swipe.startScroll >= swipe.maxScroll - EDGE_SLOP_PX;
      swipe.card = slide.firstElementChild as HTMLElement | null;
    };
    const onTouchMove = (e: TouchEvent) => {
      if (!swipe.on || e.touches.length !== 1) { swipe.on = false; return; }
      const t = e.touches[0];
      const dx = t.clientX - swipe.x;
      const dy = t.clientY - swipe.y;
      swipe.samples.push({ y: t.clientY, t: e.timeStamp });
      if (swipe.samples.length > 12) swipe.samples.shift();
      if (!swipe.decided) {
        if (Math.hypot(dx, dy) < 10) return;
        swipe.decided = true;
        // sideways is the card's own (swipe to delete)
        if (Math.abs(dy) < Math.abs(dx) * SWIPE_VERTICAL_RATIO) { swipe.on = false; return; }
        // toward more of the card: it scrolls (natively) first
        swipe.mode = (dy < 0 ? swipe.atBottom : swipe.atTop) ? "drag" : "scroll";
      }
      if (swipe.mode === "scroll") return;
      if (e.cancelable) e.preventDefault();
      // only the way it can go: back past the start toward more card is nothing
      swipe.dy = dy < 0 ? (swipe.atBottom ? dy : 0) : (swipe.atTop ? dy : 0);
      if (swipe.card) dragTo(swipe.card, swipe.dy);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!swipe.on || !swipe.decided) { swipe.on = false; return; }
      swipe.on = false;
      if (swipe.mode === "scroll") {
        // the card scrolled; if it reached its end, the rest of the travel is the swipe
        const slide = swipe.slide;
        const lift = e.changedTouches[0];
        if (!slide || !lift) return;
        const fingerDy = lift.clientY - swipe.y;
        const up = fingerDy < 0;
        const atEnd = up ? slide.scrollTop >= swipe.maxScroll - EDGE_SLOP_PX : slide.scrollTop <= EDGE_SLOP_PX;
        if (!atEnd || fingerDy === 0) return;
        const room = up ? swipe.maxScroll - swipe.startScroll : swipe.startScroll;
        const past = pastEdge(Math.abs(fingerDy), up ? slide.scrollTop - swipe.startScroll : swipe.startScroll - slide.scrollTop, room);
        const dir = pastEdgeDirection({ up, past, room, speed: flickSpeed(swipe.samples, fingerDy, e.timeStamp) });
        if (dir !== 0) {
          swallowUntil = performance.now() + 300;
          go(dir, "swipe");
        }
        return;
      }
      const dir = focusSwipeDirection({ dy: swipe.dy, speed: flickSpeed(swipe.samples, swipe.dy, e.timeStamp), atTop: swipe.atTop, atBottom: swipe.atBottom });
      const card = swipe.card;
      if (dir !== 0) {
        swallowUntil = performance.now() + 300;
        if (card) { card.style.transition = ""; card.style.transform = ""; card.style.opacity = ""; }
        if (go(dir, "swipe")) return;
      }
      settleBack(card);
    };
    const onTouchCancel = () => {
      if (swipe.on && swipe.decided && swipe.mode === "drag") settleBack(swipe.card);
      swipe.on = false;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector(OPEN_LAYER)) return;
      if (e.key === "ArrowRight") go(1, "key");
      else if (e.key === "ArrowLeft") go(-1, "key");
    };
    for (const z of zones) {
      z.addEventListener("touchstart", onTouchStart, { passive: true });
      // not passive: a swipe holds the screen still (no rubber band) while the card follows
      z.addEventListener("touchmove", onTouchMove, { passive: false });
      z.addEventListener("touchend", onTouchEnd, { passive: true });
      z.addEventListener("touchcancel", onTouchCancel, { passive: true });
      z.addEventListener("click", onClickCapture, true);
    }
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(settle);
      for (const z of zones) {
        z.removeEventListener("touchstart", onTouchStart);
        z.removeEventListener("touchmove", onTouchMove);
        z.removeEventListener("touchend", onTouchEnd);
        z.removeEventListener("touchcancel", onTouchCancel);
        z.removeEventListener("click", onClickCapture, true);
      }
      window.removeEventListener("keydown", onKey);
    };
  }, [listRef]);

  const last = index >= count - 1;
  const currentDone = !!done[index];
  // An exercise that becomes done while Focus is open: its bar fills green
  // once and "Done" pops by "Exercise N of M". Ones already done when Focus
  // opened just show green.
  const prevDoneRef = useRef<boolean[] | null>(null);
  const [justDone, setJustDone] = useState<{ i: number; k: number } | null>(null);
  useEffect(() => {
    const prev = prevDoneRef.current;
    prevDoneRef.current = done;
    if (!prev || prev.length !== done.length) return;
    const i = done.findIndex((d, j) => d && !prev[j]);
    if (i >= 0) setJustDone({ i, k: Date.now() });
  }, [done]);
  // once played, it's just green: coming back to that exercise doesn't replay it
  useEffect(() => {
    if (!justDone) return;
    const t = window.setTimeout(() => setJustDone(null), 900);
    return () => window.clearTimeout(t);
  }, [justDone]);
  const [finishing, setFinishing] = useState(false);
  const anim = "animate-in fade-in-0 duration-300";

  let primary: ReactNode;
  if (!last) {
    primary = (
      <button
        type="button"
        data-testid="story-next"
        onClick={() => onJump(index + 1)}
        className={cn(
          "flex h-12 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-full px-4 text-sm font-bold transition-colors duration-300 active:scale-[0.98]",
          // the exercise is done: Next lights up
          currentDone ? "bg-primary text-primary-foreground shadow-md shadow-primary/25" : "bg-secondary text-foreground",
        )}
      >
        <span className="shrink-0">Next:</span>
        <span className="truncate">{names[index + 1]}</span>
        <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
      </button>
    );
  } else if (finish.kind === "finish") {
    primary = (
      <button
        type="button"
        data-testid="story-finish"
        disabled={finishing}
        onClick={async () => {
          setFinishing(true);
          try { await finish.onFinish(); } finally { setFinishing(false); }
        }}
        className={cn(
          "flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full px-4 text-sm font-bold active:scale-[0.98] disabled:opacity-70",
          finish.review ? "bg-amber-500 text-black" : "bg-primary text-primary-foreground shadow-md shadow-primary/25",
        )}
      >
        {finishing ? <Loader2 className="h-4 w-4 animate-spin" /> : finish.review ? <MessageCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
        {finish.review ? "Review to Finish" : "Finish Workout"}
      </button>
    );
  } else {
    primary = (
      <button
        type="button"
        data-testid="story-done"
        onClick={onDone}
        className="flex h-12 min-w-0 flex-1 items-center justify-center gap-2 rounded-full bg-secondary px-4 text-sm font-bold text-foreground active:scale-[0.98]"
      >
        <Rows3 className="h-4 w-4" /> Back to the list
      </button>
    );
  }

  return (
    <>
      {nudge && (
        <div
          key={nudge.k}
          aria-hidden
          data-testid="focus-end-nudge"
          className={cn(
            "jf-tap-end pointer-events-none fixed top-[calc(50%-24px)] z-[42] grid h-12 w-12 place-items-center rounded-full bg-foreground/15 text-foreground",
            nudge.dir === 1 ? "right-3" : "left-3",
          )}
        >
          {nudge.dir === 1 ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />}
        </div>
      )}
      <div
        ref={topRef}
        data-testid="story-top"
        className={cn("fixed inset-x-0 top-0 z-[41] border-b border-border/60 bg-background px-3 pb-2.5 pt-[calc(var(--focus-top)+6px)]", anim)}
      >
        <div className="mx-auto max-w-xl">
          <div className="flex gap-1" role="group" aria-label="Exercises">
            {names.map((name, i) => (
              <button
                key={i}
                type="button"
                onClick={() => onJump(i)}
                aria-label={`${name}${done[i] ? ", done" : ""}`}
                aria-current={i === index ? "step" : undefined}
                className="flex h-4 min-w-0 flex-1 items-center"
              >
                {/* done is green; the one you're on is a little thicker */}
                <span
                  data-done={done[i] ? "" : undefined}
                  className={cn(
                    "relative w-full rounded-full bg-foreground/20 transition-[height] duration-300",
                    i === index ? "h-1.5" : "h-1",
                  )}
                >
                  {(done[i] || i === index) && (
                    <span
                      key={justDone?.i === i ? justDone.k : "fill"}
                      className={cn(
                        "absolute inset-0 rounded-full transition-colors duration-300",
                        done[i] ? "bg-emerald-500" : "bg-foreground",
                        done[i] && justDone?.i === i && "jf-bar-fill",
                      )}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>
          {/* the way out where the list has it (top left), then help and the switch to the list */}
          <div className="mt-2 flex items-center gap-2">
            {back && (
              <button
                type="button"
                data-testid="focus-leave"
                onClick={back.onBack}
                aria-label={`Leave the workout: back to ${back.label}`}
                className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-3 text-[13px] font-bold text-foreground transition active:scale-95"
              >
                <ArrowLeft className="h-4 w-4" aria-hidden />
                {back.label}
              </button>
            )}
            <div className="flex-1" />
            {onHelp && (
              <button
                type="button"
                data-testid="focus-help"
                onClick={onHelp}
                aria-label="How Focus works"
                className="grid h-9 w-9 shrink-0 place-items-center rounded-full border border-border bg-secondary text-muted-foreground transition active:scale-95"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              data-testid="focus-exit"
              onClick={onExit}
              aria-label="Back to the list of all exercises"
              className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border border-border bg-secondary px-3.5 text-[13px] font-bold text-foreground transition active:scale-95"
            >
              <Rows3 className="h-4 w-4" aria-hidden />
              List
            </button>
          </div>
          <div className="mt-1.5 flex min-w-0 items-baseline gap-2">
            <div data-testid="story-count" className="shrink-0 text-base font-bold leading-tight tabular-nums text-foreground">
              Exercise {index + 1} of {count}
            </div>
            {currentDone && (
              <span
                key={justDone?.i === index ? justDone.k : "done"}
                data-testid="story-done"
                className={cn(
                  "inline-flex shrink-0 items-center gap-1 self-center rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-bold text-emerald-500",
                  justDone?.i === index && "jf-done-pop",
                )}
              >
                <Check className="h-3 w-3" strokeWidth={3} aria-hidden />
                Done
              </span>
            )}
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {/* the clock brings its own "·", so nothing dangles before it starts */}
              {timer}
              <span className="truncate">{title}</span>
            </div>
          </div>
        </div>
      </div>
      <div
        ref={bottomRef}
        data-testid="story-bottom"
        className={cn(
          "fixed inset-x-0 bottom-0 z-[41] border-t border-border/60 bg-background px-3 pb-[calc(env(safe-area-inset-bottom,0px)+10px)] pt-2.5",
          anim,
        )}
      >
        <div className="mx-auto flex max-w-xl items-center gap-2">
          <button
            type="button"
            data-testid="story-prev"
            aria-label="Previous exercise"
            disabled={index === 0}
            onClick={() => onJump(index - 1)}
            className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-border bg-background text-foreground transition active:scale-95 disabled:opacity-35"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          {/* at the end, a tap forward pulses this: it's the way on */}
          <div key={bump} data-testid="story-primary" className={cn("flex min-w-0 flex-1", bump > 0 && "jf-bump")}>
            {primary}
          </div>
        </div>
      </div>
    </>
  );
}
