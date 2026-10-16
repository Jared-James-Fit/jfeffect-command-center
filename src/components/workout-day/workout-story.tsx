import { useEffect, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { CheckCircle2, ChevronLeft, ChevronRight, Clock, Loader2, MessageCircle, RectangleVertical, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkoutView } from "@/lib/use-workout-view";
import { formatElapsed, isSessionAbandoned, readWorkoutSession, sessionElapsedMs } from "@/components/workout-day/WorkoutTimer";

/**
 * Focus view (stored as "story"): the workout one exercise at a time, full
 * screen. Swipe (or Next ›) through the exercises; the bars up top show where
 * you are and what's done. It's the same exercise cards as the list, laid out
 * side by side (WorkoutDayView switches the list's classes), so switching view
 * never reloads a card or loses what's typed into it.
 */

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
export function WorkoutViewToggle({ view, onChange, className }: { view: WorkoutView; onChange: (view: WorkoutView) => void; className?: string }) {
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
    <span data-testid="focus-clock" className="inline-flex shrink-0 items-center gap-1 tabular-nums">
      <Clock className="h-3 w-3" aria-hidden />
      {session.pausedAt != null ? `Paused ${elapsed}` : elapsed}
    </span>
  );
}

export type StoryFinish =
  | { kind: "finish"; review: boolean; onFinish: () => Promise<void> | void }
  | { kind: "done" };

/** Focus's top (progress bars, where you are, List) and bottom (‹ and Next ›) bars. */
export function StoryChrome({
  names,
  done,
  index,
  title,
  timer,
  finish,
  onJump,
  onExit,
  onDone,
}: {
  /** Exercise names in order. */
  names: string[];
  /** Per exercise: every set logged. */
  done: boolean[];
  index: number;
  title: string;
  /** The workout clock (FocusClock), while the workout is open. */
  timer?: ReactNode;
  /** What the last exercise's button does. */
  finish: StoryFinish;
  onJump: (index: number) => void;
  /** The List button: back to the list, and the list is the saved choice again. */
  onExit: () => void;
  /** "Back to the list" at the end of a finished workout: just for now. */
  onDone: () => void;
}) {
  const count = names.length;
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
          <div className="mt-1.5 flex items-center gap-3">
            <div className="min-w-0 flex-1">
              <div data-testid="story-count" className="text-base font-bold leading-tight tabular-nums text-foreground">
                Exercise {index + 1} of {count}
              </div>
              <div className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {timer}
                {timer && <span aria-hidden>·</span>}
                <span className="truncate">{title}</span>
              </div>
            </div>
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
          {primary}
        </div>
      </div>
    </>
  );
}
