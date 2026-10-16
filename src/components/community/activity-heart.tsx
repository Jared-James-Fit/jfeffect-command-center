import { useCallback, useEffect, useRef, useState } from "react";
import { Heart, MessageCircle, Repeat2, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { activityBubbleCounts, activityBubbleLabel, bubbleCount, type ActivityBubbleCounts, type ActivityItem } from "@/lib/crew-activity";
import { useCrewActivity, useMarkActivityPreviewed } from "@/lib/crew-activity.queries";

/** How long the bubble stays up before it folds back into the heart. */
export const BUBBLE_HOLD_MS = 4000;
/** A beat after the screen settles, so it rises out of a still page. */
export const BUBBLE_DELAY_MS = 650;
const BUBBLE_OUT_MS = 260;

/** The lines a bubble covered: the same ones (same latest time) never pop it twice, even before the server catches up. */
function freshSignature(items: readonly ActivityItem[] | undefined): string {
  return (items ?? [])
    .filter((i) => i.unread && (i.fresh ?? 0) > 0)
    .map((i) => `${i.key}@${i.at}`)
    .sort()
    .join("|");
}
let lastShown = "";

/** Something is up over the page (a sheet, a dialog, the story viewer): the bubble waits. */
function somethingOnTop(): boolean {
  if (typeof document === "undefined") return false;
  return !!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [vaul-drawer][data-state="open"]');
}

function reducedMotion(): boolean {
  return typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
}

/**
 * Crew's heart (Activity: likes, comments, replies, follows), Instagram style.
 * When there's activity you haven't been shown yet, a small red bubble rises
 * out of it with what's new (♥ 3 · 💬 1 · 👤 2), holds a few seconds, then
 * folds back in and leaves the red dot, which stays until Activity is read.
 *
 * - Once per batch: showing it is noted on the server (every phone), and only
 *   lines with activity after that count (`fresh`, from the same list the
 *   heart already loads: no extra request).
 * - Only from a real fetch on this visit (not the phone's saved copy), so a
 *   bubble another phone already showed never replays; coming back to the app
 *   refetches, so new activity while you were away pops it then.
 * - Folds early the moment you scroll, tap anywhere, leave or switch apps; it
 *   waits while a sheet or dialog is up, and never covers more than the corner.
 */
export function ActivityHeart({ onOpen, canPreview = true, className }: {
  onOpen: () => void;
  /** The heart is on screen and nothing else is asking for attention. */
  canPreview?: boolean;
  className?: string;
}) {
  const q = useCrewActivity(true);
  const items = q.data;
  const unread = (items ?? []).some((i) => i.unread);
  const counts = activityBubbleCounts(items);
  const signature = freshSignature(items);
  const markPreviewed = useMarkActivityPreviewed();

  const [phase, setPhase] = useState<"idle" | "open" | "closing">("idle");
  const [shown, setShown] = useState<ActivityBubbleCounts | null>(null);
  // the dot pops back in when the bubble folds into the heart
  const [dotPop, setDotPop] = useState(0);
  const bubbleRef = useRef<HTMLDivElement | null>(null);
  const heartRef = useRef<HTMLButtonElement | null>(null);
  const [retry, setRetry] = useState(0);

  const ready = canPreview && q.isFetchedAfterMount && counts.total > 0 && signature !== lastShown;
  useEffect(() => {
    if (!ready || phase !== "idle") return;
    const t = window.setTimeout(() => {
      const heart = heartRef.current?.getBoundingClientRect();
      const onScreen = !!heart && heart.bottom > 0 && heart.top < window.innerHeight;
      if (document.visibilityState !== "visible" || !onScreen || somethingOnTop()) {
        // try again shortly (a popup closing, the page settling); a hidden app waits for its return
        if (document.visibilityState === "visible") setRetry((n) => n + 1);
        return;
      }
      lastShown = signature;
      setShown(counts);
      setPhase("open");
      markPreviewed();
    }, retry ? 1500 : BUBBLE_DELAY_MS);
    return () => window.clearTimeout(t);
    // counts is derived from the same items as signature
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, phase, signature, retry, markPreviewed]);

  const phaseRef = useRef(phase);
  phaseRef.current = phase;
  const close = useCallback((animate = true) => {
    if (phaseRef.current !== "open") return;
    phaseRef.current = animate ? "closing" : "idle";
    setPhase(phaseRef.current);
    setDotPop((n) => n + 1);
  }, []);

  // fold back on its own, or the moment you do anything else
  useEffect(() => {
    if (phase !== "open") return;
    const startY = window.scrollY;
    const hold = window.setTimeout(() => close(), BUBBLE_HOLD_MS);
    const onScroll = () => {
      if (Math.abs(window.scrollY - startY) > 4) close();
    };
    const onPointer = (e: PointerEvent) => {
      if (bubbleRef.current?.contains(e.target as Node)) return;
      close();
    };
    const onKey = () => close();
    const onHidden = () => {
      if (document.visibilityState !== "visible") close(false);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.clearTimeout(hold);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, [phase, close]);

  useEffect(() => {
    if (phase !== "closing") return;
    const t = window.setTimeout(() => setPhase("idle"), reducedMotion() ? 160 : BUBBLE_OUT_MS);
    return () => window.clearTimeout(t);
  }, [phase]);

  // leaving (another Crew page, a dialog opening over it): gone at once
  useEffect(() => {
    if (!canPreview) close(false);
  }, [canPreview, close]);

  const open = () => {
    close(false);
    onOpen();
  };
  const up = phase !== "idle" && !!shown;

  return (
    <div className={cn("relative shrink-0", className)}>
      <button
        ref={heartRef}
        type="button"
        aria-label={unread ? "Activity, new" : "Activity"}
        onClick={open}
        className="relative grid h-10 w-10 place-items-center rounded-full text-foreground transition-transform active:scale-90"
        data-activity-open
      >
        <Heart className="h-[24px] w-[24px]" strokeWidth={1.9} />
        {/* the dot lands as the bubble finishes folding into the heart */}
        {unread && phase === "idle" && (
          <span
            key={dotPop}
            className={cn("absolute right-[7px] top-[7px] h-[9px] w-[9px] rounded-full bg-primary ring-2 ring-background", dotPop > 0 && "activity-dot-in")}
            data-activity-dot
          />
        )}
      </button>
      {up && shown && (
        <div role="status" aria-live="polite" className="absolute right-[-6px] top-[calc(100%+4px)] z-50 w-max">
          <div
            ref={bubbleRef}
            data-state={phase}
            data-activity-bubble
            className="activity-bubble relative"
            // grows out of the pointer, which sits under the heart's middle
            style={{ ["--bubble-origin" as string]: "calc(100% - 26px) 0" }}
          >
            <span aria-hidden className="absolute -top-[5px] right-[20px] h-3 w-3 rotate-45 rounded-[2px] bg-primary" />
            <button
              type="button"
              onClick={open}
              aria-label={`Activity: ${activityBubbleLabel(shown)}`}
              className="relative flex items-center gap-3 whitespace-nowrap rounded-[14px] bg-primary px-3.5 py-2 text-primary-foreground shadow-[0_12px_28px_-10px_color-mix(in_oklab,var(--primary)_80%,transparent),0_2px_6px_-2px_rgba(0,0,0,0.35)] active:scale-[0.97]"
            >
              {([
                ["likes", Heart],
                ["comments", MessageCircle],
                ["reposts", Repeat2],
                ["follows", UserRound],
              ] as const)
                .filter(([k]) => shown[k] > 0)
                .map(([k, Icon], i) => (
                  <span key={k} className="activity-bubble-item inline-flex items-center gap-1" style={{ animationDelay: `${140 + i * 60}ms` }} data-bubble-kind={k}>
                    {/* 🔁 is drawn in lines, the others filled */}
                    {k === "reposts" ? <Icon className="h-[17px] w-[17px] shrink-0" strokeWidth={2.8} aria-hidden /> : <Icon className="h-[17px] w-[17px] shrink-0 fill-current" strokeWidth={0} aria-hidden />}
                    <span className="text-[15px] font-bold leading-none tabular-nums">{bubbleCount(shown[k])}</span>
                  </span>
                ))}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
