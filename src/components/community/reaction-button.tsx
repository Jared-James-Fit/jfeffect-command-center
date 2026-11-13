import { useCallback, useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { REACTION, REACTIONS, reactionEmoji, reactionTotal, type CommunityPost, type ReactionKey } from "@/lib/community";

/** How long a press has to be to open the other reactions. */
const HOLD_MS = 380;

/**
 * The like button: tap for ❤️ (tap again to take it back), hold for
 * 👍 ‼️ 🔥 😂. Shows your reaction once you've given one, and how many.
 */
export function ReactionButton({
  post,
  onReact,
  size = "md",
  align = "left",
  stacked = false,
}: {
  post: CommunityPost;
  onReact: (p: CommunityPost, next: ReactionKey | null) => void;
  size?: "md" | "sm";
  align?: "left" | "right";
  /** The count under the heart (a post's own screen in the feed, TikTok's right column). */
  stacked?: boolean;
}) {
  const sm = size === "sm";
  const [open, setOpen] = useState(false);
  const [pop, setPop] = useState(0);
  const timer = useRef<number | null>(null);
  const held = useRef(false);
  const mine = post.my_reaction;
  const total = reactionTotal(post);

  const cancel = () => {
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = null;
  };
  useEffect(() => cancel, []);
  const choose = (next: ReactionKey | null) => {
    setOpen(false);
    if (next) {
      setPop((n) => n + 1);
      try {
        navigator.vibrate?.(8);
      } catch {
        /* no haptics here */
      }
    }
    onReact(post, next);
  };

  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onPointerDown={() => {
          held.current = false;
          cancel();
          timer.current = window.setTimeout(() => {
            timer.current = null;
            held.current = true;
            setOpen(true);
            try {
              navigator.vibrate?.(10);
            } catch {
              /* no haptics here */
            }
          }, HOLD_MS);
        }}
        onPointerUp={cancel}
        onPointerLeave={cancel}
        onPointerCancel={cancel}
        // a long press is ours (no copy / save menu); right-click opens the reactions too
        onContextMenu={(e) => {
          e.preventDefault();
          cancel();
          held.current = true;
          setOpen(true);
        }}
        onClick={() => {
          if (held.current) {
            held.current = false;
            return;
          }
          choose(mine ? null : REACTION.key);
        }}
        aria-pressed={!!mine}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${mine ? `You reacted ${reactionEmoji(mine) ?? ""}. Tap to remove` : "Like"}${total ? `, ${total}` : ""}. Hold for more reactions`}
        className={cn(
          "flex select-none items-center justify-center rounded-full transition-transform [-webkit-touch-callout:none] [touch-action:manipulation] hover:bg-muted active:scale-90",
          stacked ? "min-h-11 min-w-11 flex-col gap-0.5 px-1 py-1" : sm ? "h-10 min-w-10 gap-1 px-2" : "h-11 min-w-11 gap-1.5 px-2.5",
        )}
      >
        <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
          {mine === "heart" ? (
            <Heart className={cn(sm ? "h-[21px] w-[21px]" : stacked ? "h-[30px] w-[30px]" : "h-[26px] w-[26px]", "fill-[#ef3340] text-[#ef3340]")} strokeWidth={2} />
          ) : mine ? (
            <span className={cn(sm ? "text-[18px]" : "text-[22px]", "leading-none")}>{reactionEmoji(mine)}</span>
          ) : (
            <Heart className={cn(sm ? "h-[21px] w-[21px]" : stacked ? "h-[30px] w-[30px] text-foreground" : "h-[26px] w-[26px]", !stacked && "text-foreground/80")} strokeWidth={2} />
          )}
        </span>
        {total > 0 && <span className={cn(sm || stacked ? "text-[12px]" : "text-[14px]", "font-bold tabular-nums", mine || stacked ? "text-foreground" : "text-muted-foreground")}>{total}</span>}
      </button>
      {open && <ReactionPicker current={mine} align={align} onPick={(k) => choose(k === mine ? null : k)} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The five, in a little pill above the heart. Tap one; tap outside to close. */
function ReactionPicker({ current, onPick, onClose, align = "left" }: { current: ReactionKey | null; onPick: (k: ReactionKey) => void; onClose: () => void; align?: "left" | "right" }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <>
      {/* closes on a new press, not on lifting the finger from the hold that opened it */}
      <button
        type="button"
        aria-label="Close reactions"
        className="fixed inset-0 z-40 cursor-default"
        onPointerDown={(e) => {
          e.preventDefault();
          onClose();
        }}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onClose()}
      />
      <div role="menu" aria-label="Reactions" className={cn("community-picker absolute bottom-full z-50 mb-1.5 flex items-center gap-0.5 rounded-full border border-border/70 bg-card px-1.5 py-1 shadow-xl", align === "right" ? "right-0" : "left-0")}>
        {REACTIONS.map((r, i) => (
          <button
            key={r.key}
            type="button"
            role="menuitemradio"
            aria-checked={current === r.key}
            aria-label={r.label}
            onClick={() => onPick(r.key)}
            className={cn("community-picker-item grid h-11 w-11 place-items-center rounded-full text-[26px] leading-none transition-transform hover:scale-125 active:scale-110", current === r.key && "bg-muted")}
            style={{ animationDelay: `${i * 30}ms` }}
          >
            {r.emoji}
          </button>
        ))}
      </div>
    </>
  );
}

/** The big reaction that pops over a post when you double-tap it. */
/** A double-tap's ❤️: how many so far, and where the finger was in its box (null: the middle). */
export type Burst = { n: number; x: number | null; y: number | null };

/**
 * A double-tap's ❤️ state. `fire(e)` shows a new one where the tap landed in
 * the element the handler sits on (the one ReactionBurst is placed in);
 * without a tap position (a key press) it's the middle.
 */
export function useBurst() {
  const [burst, setBurst] = useState<Burst>({ n: 0, x: null, y: null });
  const fire = useCallback((e?: { clientX: number; clientY: number; currentTarget: EventTarget | null } | null) => {
    let x: number | null = null;
    let y: number | null = null;
    const el = e?.currentTarget as HTMLElement | null | undefined;
    if (e && el?.getBoundingClientRect && (e.clientX || e.clientY)) {
      const r = el.getBoundingClientRect();
      x = Math.round(e.clientX - r.left);
      y = Math.round(e.clientY - r.top);
    }
    setBurst((b) => ({ n: b.n + 1, x, y }));
  }, []);
  return [burst, fire] as const;
}

/** A tilt for each ❤️, never the same twice in a row (-15° to 15°). */
export function burstTilt(n: number): number {
  return ((n * 47) % 31) - 15;
}

/**
 * The ❤️ a double-tap gives (Instagram's, TikTok's): it springs in where the
 * finger was, tilted a little, then floats up and fades. Each double-tap is
 * a new one.
 */
export function ReactionBurst({ n, emoji, x = null, y = null }: { n: number; emoji: string; x?: number | null; y?: number | null }) {
  if (n <= 0) return null;
  return (
    <span
      key={n}
      className="community-burst pointer-events-none absolute z-10 select-none text-[96px] leading-none drop-shadow-xl"
      style={{ left: x ?? "50%", top: y ?? "50%", ["--burst-r" as string]: `${burstTilt(n)}deg` }}
      aria-hidden
      data-reaction-burst
    >
      {emoji}
    </span>
  );
}

/** How many visits the double-tap tip shows on before it retires by itself. */
export const DOUBLE_TAP_TIP_VISITS = 3;
export const doubleTapTipKeys = Array.from({ length: DOUBLE_TAP_TIP_VISITS }, (_, i) => `double_tap_shown_${i + 1}`);

/**
 * The tip, kept out of the way: a small pill low on the post (a heart that
 * taps twice and pops, "Double-tap to like"). It plays for a few seconds and
 * fades out by itself; taps go straight through it.
 */
export function DoubleTapHint({ onDone }: { onDone?: () => void }) {
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-3 z-10 flex justify-center" aria-hidden>
      <div
        className="community-hint flex items-center gap-2 rounded-full bg-black/75 py-1.5 pl-1.5 pr-3.5 text-[12px] font-bold text-white shadow-lg ring-1 ring-white/10 backdrop-blur-md"
        onAnimationEnd={(e) => e.animationName === "community-hint-life" && onDone?.()}
      >
        <span className="relative grid h-7 w-7 place-items-center">
          <span className="community-ripple absolute inset-0 rounded-full border-2 border-white/70" />
          <span className="community-ripple community-ripple-late absolute inset-0 rounded-full border-2 border-white/70" />
          <Heart className="community-tap2 h-4 w-4 fill-[#ef3340] text-[#ef3340]" />
        </span>
        Double-tap to like
      </div>
    </div>
  );
}

/**
 * Double-tap detection for a post (no delay on single taps: those still do
 * whatever the post does). Returns a click handler.
 */
export function useDoubleTap(onDouble: (e: React.MouseEvent) => void, within = 280) {
  const last = useRef(0);
  return (e: React.MouseEvent) => {
    const now = Date.now();
    if (now - last.current < within) {
      last.current = 0;
      onDouble(e);
      return;
    }
    last.current = now;
  };
}
