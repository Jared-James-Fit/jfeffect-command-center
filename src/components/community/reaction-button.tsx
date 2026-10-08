import { useEffect, useRef, useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { REACTION, REACTIONS, reactionEmoji, reactionTotal, type CommunityPost, type ReactionKey } from "@/lib/community";

/** How long a press has to be to open the other reactions. */
const HOLD_MS = 380;

/**
 * The like button: tap for ❤️ (tap again to take it back), hold for
 * 👍 ‼️ 🔥 😂. Shows your reaction once you've given one, and how many.
 */
export function ReactionButton({ post, onReact }: { post: CommunityPost; onReact: (p: CommunityPost, next: ReactionKey | null) => void }) {
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
    if (next) setPop((n) => n + 1);
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
        className="flex h-11 min-w-11 select-none items-center justify-center gap-1.5 rounded-full px-2.5 transition-transform [-webkit-touch-callout:none] [touch-action:manipulation] hover:bg-muted active:scale-90"
      >
        <span key={pop} className={cn("inline-flex", pop > 0 && "community-pop")}>
          {mine === "heart" ? (
            <Heart className="h-[26px] w-[26px] fill-[#ef3340] text-[#ef3340]" strokeWidth={2} />
          ) : mine ? (
            <span className="text-[22px] leading-none">{reactionEmoji(mine)}</span>
          ) : (
            <Heart className="h-[26px] w-[26px] text-foreground/80" strokeWidth={2} />
          )}
        </span>
        {total > 0 && <span className={cn("text-[14px] font-black tabular-nums", mine ? "text-foreground" : "text-muted-foreground")}>{total}</span>}
      </button>
      {open && <ReactionPicker current={mine} onPick={(k) => choose(k === mine ? null : k)} onClose={() => setOpen(false)} />}
    </div>
  );
}

/** The five, in a little pill above the heart. Tap one; tap outside to close. */
function ReactionPicker({ current, onPick, onClose }: { current: ReactionKey | null; onPick: (k: ReactionKey) => void; onClose: () => void }) {
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
      <div role="menu" aria-label="Reactions" className="community-picker absolute bottom-full left-0 z-50 mb-1.5 flex items-center gap-0.5 rounded-full border border-border/70 bg-card px-1.5 py-1 shadow-xl">
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
export function ReactionBurst({ n, emoji }: { n: number; emoji: string }) {
  if (n <= 0) return null;
  return (
    <span key={n} className="community-burst pointer-events-none absolute inset-0 z-10 grid place-items-center text-[88px] drop-shadow-xl" aria-hidden>
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
export function useDoubleTap(onDouble: () => void, within = 280) {
  const last = useRef(0);
  return () => {
    const now = Date.now();
    if (now - last.current < within) {
      last.current = 0;
      onDouble();
      return;
    }
    last.current = now;
  };
}
