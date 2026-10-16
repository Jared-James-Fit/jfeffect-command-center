import { useEffect, useLayoutEffect, useRef } from "react";
import {
  BadgeCheck, BarChart3, Circle, Clock, Dumbbell, Flame, Image as ImageIcon, ListChecks, Lock, Pizza,
  ReceiptText, Salad, Sparkles, Sticker, TrendingUp, Trophy, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATE_LABEL, type ShareTemplate } from "@/lib/workout-share-card";
import { HOLD_TO_RECORD_MS } from "@/components/community/clip-recorder";

const ICON: Record<ShareTemplate, LucideIcon> = {
  pr: Trophy,
  photo: ImageIcon,
  stats: BarChart3,
  sticker: Sticker,
  volume: Dumbbell,
  receipt: ReceiptText,
  streak: Flame,
  progress: TrendingUp,
  lockin: Lock,
  lockclock: Clock,
  lockplan: ListChecks,
  mealprep: Salad,
  onplan: BadgeCheck,
  fuel: Zap,
  highday: Sparkles,
  cheat: Pizza,
  plain: Circle,
};

const ITEM = 58;
const GAP = 14;
const STEP = ITEM + GAP;

/**
 * The shutter, Instagram's way: the looks sit in a row of circles and the
 * one in the middle ring is the look you're on. Swipe and they glide, each
 * one snapping into the ring and showing on the camera as it lands; tap a
 * circle to bring it in; tap the middle one (the shutter) to take the photo.
 * One look (or none): just the shutter.
 */
export function LookCarousel({
  looks,
  look,
  onLook,
  onShoot,
  disabled = false,
  counting = false,
  showName = true,
  hold,
}: {
  looks: ShareTemplate[] | null;
  look: ShareTemplate | null;
  onLook: (t: ShareTemplate) => void;
  onShoot: () => void;
  disabled?: boolean;
  /** the self-timer is counting down: the shutter is a stop button */
  counting?: boolean;
  /** the look's name above the ring (left off where room is short: the card shows it) */
  showName?: boolean;
  /** Hold to film (a plain post's camera): start / stop, and how far into the clip limit it is (null: not filming). */
  hold?: { onStart: () => void; onEnd: () => void; progress: number | null; seconds: number };
}) {
  const many = !!looks && looks.length > 1 && !!look;
  if (!many) return <Shutter onShoot={onShoot} disabled={disabled} counting={counting} hold={hold} />;
  // a new set of looks (another mode) starts a fresh row, on its own look
  return <Glide key={looks!.join("|")} looks={looks!} look={look!} onLook={onLook} onShoot={onShoot} disabled={disabled} counting={counting} showName={showName} />;
}

/**
 * The plain shutter: a tap takes a photo; with `hold`, holding it films
 * (Instagram's camera), the ring filling red up to the clip limit.
 */
function Shutter({ onShoot, disabled, counting, hold }: {
  onShoot: () => void;
  disabled: boolean;
  counting: boolean;
  hold?: { onStart: () => void; onEnd: () => void; progress: number | null; seconds: number };
}) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const held = useRef(false);
  const filming = hold?.progress != null;
  const down = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (!hold || disabled || counting || filming) return;
    // the finger can drift off the button while filming: it still ends where it lifts
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not supported: fine */
    }
    held.current = false;
    timer.current = setTimeout(() => {
      timer.current = null;
      held.current = true;
      hold.onStart();
    }, HOLD_TO_RECORD_MS);
  };
  const up = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    if (held.current) hold?.onEnd();
  };
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const pct = Math.round((hold?.progress ?? 0) * 1000) / 10;
  return (
    <div className="relative flex h-[88px] items-center justify-center">
      {filming && (
        <span className="absolute -top-9 left-1/2 -translate-x-1/2 rounded-full bg-red-500 px-2.5 py-0.5 text-[13px] font-black tabular-nums text-white" data-recording-time>
          {`0:${String(hold!.seconds).padStart(2, "0")}`}
        </span>
      )}
      <button
        type="button"
        disabled={disabled}
        onPointerDown={down}
        onPointerUp={up}
        onPointerCancel={up}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          // a hold was a clip, not a photo
          if (held.current) {
            held.current = false;
            return;
          }
          onShoot();
        }}
        className={cn(
          "grid h-[78px] w-[78px] touch-none select-none place-items-center rounded-full border-[5px] [-webkit-touch-callout:none] disabled:opacity-30",
          filming ? "scale-110 border-transparent transition-transform" : "border-white active:scale-95",
        )}
        style={filming ? { background: `conic-gradient(rgb(239 68 68) ${pct}%, rgba(255,255,255,0.35) ${pct}% 100%)` } : undefined}
        aria-label={filming ? "Stop filming" : counting ? "Cancel timer" : hold ? "Take photo, or hold to film" : "Take photo"}
        data-shutter
        data-filming={filming ? "" : undefined}
      >
        <span className={cn("block rounded-full transition-all", filming ? "h-[62px] w-[62px] bg-black/30 p-[14px]" : counting ? "h-7 w-7 rounded-md bg-red-500" : "h-[60px] w-[60px] bg-white")}>
          {filming && <span className="block h-full w-full rounded-md bg-red-500" />}
        </span>
      </button>
    </div>
  );
}

function Glide({ looks, look, onLook, onShoot, disabled, counting, showName }: {
  looks: ShareTemplate[];
  look: ShareTemplate;
  onLook: (t: ShareTemplate) => void;
  onShoot: () => void;
  disabled: boolean;
  counting: boolean;
  showName: boolean;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, looks.indexOf(look));
  // the look in the ring as the row moves (ahead of React)
  const shown = useRef(at);
  // a scroll we started (a tap, or a swipe on the camera): it lands on `to`, the looks in between don't count
  const steering = useRef<number | null>(null);
  const frame = useRef(0);
  const lookRef = useRef(onLook);
  lookRef.current = onLook;

  // circles grow as they near the ring, like Instagram's
  const paint = () => {
    const el = row.current;
    if (!el) return;
    const mid = el.scrollLeft / STEP;
    items.current.forEach((b, i) => {
      if (!b) return;
      const d = Math.min(1, Math.abs(i - mid));
      b.style.transform = `scale(${1 - 0.2 * d})`;
      b.style.opacity = String(1 - 0.25 * d);
    });
  };

  // start on the look they're on, no glide
  useLayoutEffect(() => {
    const el = row.current;
    if (!el) return;
    el.scrollLeft = at * STEP;
    shown.current = at;
    paint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the look changed somewhere else (a swipe on the camera): bring its circle into the ring
  useEffect(() => {
    const el = row.current;
    if (!el || shown.current === at) return;
    steering.current = at;
    shown.current = at;
    el.scrollTo({ left: at * STEP, behavior: "smooth" });
  }, [at]);

  const onScroll = () => {
    cancelAnimationFrame(frame.current);
    frame.current = requestAnimationFrame(() => {
      const el = row.current;
      if (!el) return;
      paint();
      const i = Math.max(0, Math.min(looks.length - 1, Math.round(el.scrollLeft / STEP)));
      if (steering.current != null) {
        if (Math.abs(el.scrollLeft - steering.current * STEP) < 2) steering.current = null;
        return;
      }
      if (i !== shown.current) {
        shown.current = i;
        try {
          navigator.vibrate?.(6);
        } catch {
          /* no haptics here */
        }
        lookRef.current(looks[i]);
      }
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const bring = (i: number) => {
    const el = row.current;
    if (!el) return;
    steering.current = i;
    shown.current = i;
    lookRef.current(looks[i]);
    el.scrollTo({ left: i * STEP, behavior: "smooth" });
  };

  return (
    <div className="relative" data-look-carousel>
      {/* what the ring holds, above it */}
      <div className={cn("pointer-events-none mb-1.5 flex justify-center", !showName && "sr-only")}>
        <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[12px] font-bold backdrop-blur-sm" data-look-name>
          {TEMPLATE_LABEL[look]}
        </span>
      </div>
      <div className="relative h-[88px]">
        <div
          ref={row}
          onScroll={onScroll}
          // a finger on the row takes over from any glide we started
          onPointerDown={() => (steering.current = null)}
          onTouchStart={() => (steering.current = null)}
          className="flex h-full snap-x snap-mandatory items-center overflow-x-auto overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          style={{ gap: GAP, paddingInline: `calc(50% - ${ITEM / 2}px)` }}
          role="listbox"
          aria-label="Looks"
        >
          {looks.map((t, i) => {
            const Icon = ICON[t];
            const on = i === at;
            return (
              <button
                key={t}
                ref={(b) => {
                  items.current[i] = b;
                }}
                type="button"
                role="option"
                aria-selected={on}
                aria-label={on ? (counting ? "Cancel timer" : `Take photo, ${TEMPLATE_LABEL[t]}`) : TEMPLATE_LABEL[t]}
                disabled={on && disabled}
                onClick={() => (on ? onShoot() : bring(i))}
                className={cn(
                  "grid shrink-0 snap-center snap-always place-items-center rounded-full transition-colors duration-150 will-change-transform disabled:opacity-40",
                  on ? "bg-white text-black" : "bg-white/20 text-white backdrop-blur-md",
                )}
                style={{ width: ITEM, height: ITEM }}
                data-look={t}
                data-shutter={on ? "" : undefined}
              >
                {on && counting ? <span className="block h-6 w-6 rounded-md bg-red-500" /> : <Icon className="h-6 w-6" strokeWidth={2.2} />}
              </button>
            );
          })}
        </div>
        {/* the shutter's ring, still in the middle while the looks glide through it */}
        <span className="pointer-events-none absolute left-1/2 top-1/2 h-[80px] w-[80px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] border-white" aria-hidden />
      </div>
    </div>
  );
}
