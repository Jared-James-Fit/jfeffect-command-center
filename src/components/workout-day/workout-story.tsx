import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { flushSync } from "react-dom";
import { ArrowLeft, CheckCircle2, ChevronLeft, ChevronRight, Clock, HelpCircle, Loader2, MessageCircle, RectangleVertical, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkoutView } from "@/lib/use-workout-view";
import { formatElapsed, isSessionAbandoned, readWorkoutSession, sessionElapsedMs } from "@/components/workout-day/WorkoutTimer";

/**
 * Focus view (stored as "story"): the workout one exercise at a time, full
 * screen. Tap through the exercises like Crew's stories (the left third goes
 * back, anywhere else forward), swipe up for the next and down to go back, or
 * use ‹ / Next; the bars up top show where you are and what's done. A sideways
 * swipe is the card's own (swipe to delete). It's the same exercise cards as
 * the list, laid out side by side (WorkoutDayView switches the list's
 * classes), so switching view never reloads a card or loses what's typed.
 */

/**
 * What keeps its own tap in Focus (never "next exercise"): every control
 * (buttons, the set boxes, links, switches) and a card swiped open to Delete.
 * Everything else on the screen moves, the set table's empty space included,
 * so a tap is never silently lost.
 */
const TAP_KEEPS =
  'button, a, input, textarea, select, label, summary, [role="button"], [role="slider"], [role="switch"], ' +
  '[role="checkbox"], [role="radio"], [role="menuitem"], [role="tab"], [role="link"], [contenteditable="true"], ' +
  "[data-no-tap], [data-swipe-open]";
/** A finger can wander this far and still count as a tap. */
export const TAP_SLOP_PX = 12;
/** Held longer than this it's a press, not a tap. */
export const TAP_MAX_MS = 550;
/** Something on top of Focus that a tap should close, not move under. */
const OPEN_LAYER = '[data-swipe-open], [role="menu"][data-state="open"], [role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]';

export function focusTapIgnored(target: EventTarget | null): boolean {
  const el = typeof Element !== "undefined" && target instanceof Element ? target : null;
  return !el || !!el.closest(TAP_KEEPS);
}

/** A tap at x on a screen this wide: the left third goes back, anywhere else forward (Crew's stories). */
export function focusTapDirection(x: number, width: number): -1 | 1 {
  return x < width / 3 ? -1 : 1;
}

/** A swipe up or down this long moves to the next / previous exercise… */
export const SWIPE_COMMIT_PX = 72;
/** …or a quick flick: at least this long, moving this fast as the finger lifts (px per ms). */
export const FLICK_MIN_PX = 28;
export const FLICK_PX_PER_MS = 0.4;
/** The flick's speed is read over the finger's last moments, not the whole drag… */
export const FLICK_WINDOW_MS = 100;
/** …and a finger that stopped this long before lifting wasn't flicking. */
export const FLICK_IDLE_MS = 80;

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

/** Something between the finger and the screen that scrolls up and down by itself (a notes box): its drag is a scroll. */
function scrollsOnItsOwn(from: Element | null, slide: HTMLElement): boolean {
  for (let n = from; n && n !== slide; n = n.parentElement) {
    if (n instanceof HTMLTextAreaElement) return true;
    if (n.scrollHeight > n.clientHeight + 1) {
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

  // Tap to move, like Crew's stories; arrow keys on a keyboard. Read from the
  // finger itself (down → up, a little wander allowed), not the browser's
  // click, which phones drop after a tiny drag or while a scroll settles.
  // Quick taps queue: each one moves on from where the last one was going.
  // A chevron flashes on the side that was tapped; at either end it nudges and
  // the bottom button pulses, so a tap always shows it landed.
  // Swipe up / down (touch): the card follows the finger, and a long enough
  // swipe or a quick flick moves on, the next card rising in from where the
  // finger went. A long card scrolls first (focusSwipeDirection).
  const latest = useRef({ index, count, onJump });
  latest.current = { index, count, onJump };
  const [flash, setFlash] = useState<{ dir: -1 | 1; k: number; end: boolean } | null>(null);
  const [bump, setBump] = useState(0);
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    let heading: number | null = null; // where the last tap sent us, until we get there
    let settle: number | undefined;
    const go = (dir: -1 | 1, how: "tap" | "swipe" = "tap"): boolean => {
      const { index: i, count: n, onJump: jump } = latest.current;
      const to = (heading ?? i) + dir;
      if (to < 0 || to >= n) {
        setFlash({ dir, k: Date.now(), end: true });
        if (dir === 1) setBump(Date.now());
        return false;
      }
      heading = to;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => { heading = null; }, 900);
      if (how === "tap") {
        setFlash({ dir, k: Date.now(), end: false });
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
    const press = { id: -1, x: 0, y: 0, t: 0, moved: false, skip: false };
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary || (e.pointerType === "mouse" && e.button !== 0)) { press.id = -1; return; }
      press.id = e.pointerId;
      press.x = e.clientX;
      press.y = e.clientY;
      press.t = performance.now();
      press.moved = false;
      // a control, or something open on top (a swiped card, a menu), keeps this tap
      press.skip = focusTapIgnored(e.target) || !!document.querySelector(OPEN_LAYER);
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerId === press.id && Math.hypot(e.clientX - press.x, e.clientY - press.y) > TAP_SLOP_PX) press.moved = true;
    };
    const onUp = (e: PointerEvent) => {
      if (e.pointerId !== press.id) return;
      press.id = -1;
      if (press.skip || press.moved || performance.now() - press.t > TAP_MAX_MS) return;
      // typing a number: the first tap just puts the keyboard away
      const typing = document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]') as HTMLElement | null;
      if (typing) { typing.blur(); return; }
      go(focusTapDirection(e.clientX, window.innerWidth));
    };
    const onCancel = (e: PointerEvent) => { if (e.pointerId === press.id) press.id = -1; };

    // ── Swipe up / down ──
    const swipe = {
      on: false, decided: false, x: 0, y: 0, dy: 0,
      atTop: false, atBottom: false, card: null as HTMLElement | null,
      samples: [] as Array<{ y: number; t: number }>,
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
      // keyboard up: a drag is reading the card, not moving on (a tap closes it first)
      if (document.activeElement?.closest?.(TYPING)) return;
      const target = e.target instanceof Element ? e.target : null;
      const slide = target?.closest<HTMLElement>("[data-story-slide]") ?? null;
      if (!slide || !el.contains(slide) || scrollsOnItsOwn(target, slide)) return;
      const t = e.touches[0];
      swipe.on = true;
      swipe.decided = false;
      swipe.x = t.clientX;
      swipe.y = t.clientY;
      swipe.samples = [{ y: t.clientY, t: e.timeStamp }];
      swipe.dy = 0;
      swipe.atTop = slide.scrollTop <= 1;
      swipe.atBottom = slide.scrollTop + slide.clientHeight >= slide.scrollHeight - 1;
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
        // sideways is the card's own (swipe to delete); toward more of a long card is a scroll
        if (Math.abs(dy) < Math.abs(dx) * 1.2 || !(dy < 0 ? swipe.atBottom : swipe.atTop)) { swipe.on = false; return; }
      }
      if (e.cancelable) e.preventDefault();
      // only the way it can go: back past the start toward more card is nothing
      swipe.dy = dy < 0 ? (swipe.atBottom ? dy : 0) : (swipe.atTop ? dy : 0);
      if (swipe.card) dragTo(swipe.card, swipe.dy);
    };
    const onTouchEnd = (e: TouchEvent) => {
      if (!swipe.on || !swipe.decided) { swipe.on = false; return; }
      swipe.on = false;
      const dir = focusSwipeDirection({ dy: swipe.dy, speed: flickSpeed(swipe.samples, swipe.dy, e.timeStamp), atTop: swipe.atTop, atBottom: swipe.atBottom });
      const card = swipe.card;
      if (dir !== 0) {
        swallowUntil = performance.now() + 400;
        if (card) { card.style.transition = ""; card.style.transform = ""; card.style.opacity = ""; }
        if (go(dir, "swipe")) return;
      }
      settleBack(card);
    };
    const onTouchCancel = () => {
      if (swipe.on && swipe.decided) settleBack(swipe.card);
      swipe.on = false;
    };
    const onClickCapture = (e: MouseEvent) => {
      if (performance.now() < swallowUntil) { e.preventDefault(); e.stopPropagation(); }
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.metaKey || e.ctrlKey) return;
      if (document.activeElement?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector(OPEN_LAYER)) return;
      if (e.key === "ArrowRight") go(1);
      else if (e.key === "ArrowLeft") go(-1);
    };
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: true });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onCancel, { passive: true });
    el.addEventListener("touchstart", onTouchStart, { passive: true });
    // not passive: a swipe holds the screen still (no rubber band) while the card follows
    el.addEventListener("touchmove", onTouchMove, { passive: false });
    el.addEventListener("touchend", onTouchEnd, { passive: true });
    el.addEventListener("touchcancel", onTouchCancel, { passive: true });
    el.addEventListener("click", onClickCapture, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.clearTimeout(settle);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      el.removeEventListener("touchstart", onTouchStart);
      el.removeEventListener("touchmove", onTouchMove);
      el.removeEventListener("touchend", onTouchEnd);
      el.removeEventListener("touchcancel", onTouchCancel);
      el.removeEventListener("click", onClickCapture, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [listRef]);

  const last = index >= count - 1;
  const currentDone = !!done[index];
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
      {flash && (
        <div
          key={flash.k}
          aria-hidden
          data-testid="focus-tap-flash"
          data-end={flash.end ? "" : undefined}
          className={cn(
            "pointer-events-none fixed top-[calc(50%-24px)] z-[42] grid h-12 w-12 place-items-center rounded-full bg-foreground/15 text-foreground",
            flash.end ? "jf-tap-end" : "jf-tap-flash",
            flash.dir === 1 ? "right-3" : "left-3",
          )}
        >
          {flash.dir === 1 ? <ChevronRight className="h-6 w-6" /> : <ChevronLeft className="h-6 w-6" />}
        </div>
      )}
      <div
        data-testid="story-top"
        className={cn("fixed inset-x-0 top-0 z-[41] border-b border-border/60 bg-background px-3 pb-2.5 pt-[calc(env(safe-area-inset-top,0px)+6px)]", anim)}
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
                <span
                  className={cn(
                    "h-1 w-full rounded-full transition-colors duration-300",
                    i === index ? (done[i] ? "bg-primary" : "bg-foreground") : done[i] ? "bg-primary/70" : "bg-foreground/20",
                  )}
                />
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
            <div className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {/* the clock brings its own "·", so nothing dangles before it starts */}
              {timer}
              <span className="truncate">{title}</span>
            </div>
          </div>
        </div>
      </div>
      <div
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
