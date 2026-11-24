import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  BadgeCheck, BarChart3, ChevronLeft, Circle, Clock, Dumbbell, Flame, Image as ImageIcon, ListChecks, Lock, Pizza,
  ReceiptText, Salad, Sticker, TrendingUp, Trophy, Wheat, Zap, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TEMPLATE_LABEL, type ShareTemplate } from "@/lib/workout-share-card";
import { HOLD_TO_RECORD_MS } from "@/components/community/clip-recorder";
import { lockReach, slideLocks } from "@/lib/camera/camera-zoom";
import { feedback } from "@/lib/feedback";

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
  highday: Wheat,
  cheat: Pizza,
  plain: Circle,
};

/**
 * One circle in the row: a look on a card, Normal (no card), or a story
 * filter (`emoji` on its circle). `group`: which chip over the row it's under
 * (Today, Lock in, Train…). Keys are unique across the row.
 */
export type LookItem = { key: string; look: ShareTemplate; label: string; emoji?: string; group?: string };
/** A chip over the row: tap it and the row glides to its first filter. */
export type LookGroup = { key: string; label: string };

/** A card's looks as circles (the studio for one workout or one lock in). */
export function lookItems(looks: ShareTemplate[] | null | undefined): LookItem[] | null {
  return looks ? looks.map((t) => ({ key: t, look: t, label: TEMPLATE_LABEL[t] })) : null;
}

const ITEM = 58;
const GAP = 14;
const STEP = ITEM + GAP;

/**
 * The shutter, Instagram's way: the filters sit in a row of circles and the
 * one in the middle ring is the one you're on. Swipe and they glide, each
 * one snapping into the ring and showing on the camera as it lands; tap a
 * circle to bring it in; tap the middle one (the shutter) to take the photo.
 * One (or none): just the shutter.
 *
 * Without `onShoot` it's the same row for a photo already taken or picked
 * (the story editor, the New post screen): the ring only shows which filter
 * is on, so picking one reads exactly like the camera.
 *
 * The hold to film lives here, above the row (`useHold`), so a row that
 * changes mid-clip never drops the finger, and while it films the row is
 * held as it was.
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
  groups,
  zoom,
}: {
  looks: LookItem[] | null;
  /** The key of the one in the ring. */
  look: string | null;
  onLook: (key: string) => void;
  /** The ring is the shutter. Left out: a picker (the photo's already there), the ring just shows what's on. */
  onShoot?: () => void;
  disabled?: boolean;
  /** the self-timer is counting down: the shutter is a stop button */
  counting?: boolean;
  /** the look's name above the ring (left off where room is short: the card shows it) */
  showName?: boolean;
  /** Hold to film (Normal, no card): start / stop, slide to zoom and lock; null while it can't film. */
  hold?: Hold;
  /** Chips over the row (the filters' groups), in the row's order. */
  groups?: LookGroup[];
  /** The zoom readout while it films, shown just over the recording surface. */
  zoom?: ReactNode;
}) {
  const h = useHold(onShoot ? hold : undefined, disabled || counting);
  // filming: the row stays as it was (a list that changes mid-clip never remounts the shutter under the finger)
  const kept = useRef(looks);
  if (!h.active || !kept.current) kept.current = looks;
  const row = h.active ? kept.current : looks;
  const many = !!row && row.length > 1 && !!look && row.some((l) => l.key === look);
  if (!many) return onShoot ? <Shutter onShoot={onShoot} disabled={disabled} counting={counting} hold={hold} h={h} zoom={zoom} /> : null;
  // a new set of filters starts a fresh row, on the one you're on
  return <Glide key={row!.map((l) => l.key).join("|")} looks={row!} look={look!} onLook={onLook} onShoot={onShoot} disabled={disabled} counting={counting} showName={showName} hold={hold} h={h} groups={groups} zoom={zoom} />;
}

export type Hold = {
  /** The hold crossed from a tap into filming. */
  onStart: () => void;
  /** The finger lifted (not locked): the clip ends. */
  onEnd: () => void;
  /** A tap on the shutter while it films hands-free: the clip ends. */
  onStop: () => void;
  /** Filming now (the recorder's up). */
  recording: boolean;
  /** When filming started (`performance.now()`): the ring fills from here to `limitMs`. */
  startedAt: number | null;
  /** The longest clip (the ring's full circle). */
  limitMs: number;
  /** The finger moving while it films (px from where filming started; `below`: the room under that point): up zooms in, down back out. */
  onSlide?: (dx: number, dy: number, below: number) => void;
  /** Slid left to the lock: filming carries on with the finger off, until the shutter's tapped. */
  onLock?: () => void;
  locked?: boolean;
};

type HoldState = ReturnType<typeof useHold>;

/**
 * Holding the shutter films: a finger down for HOLD_TO_RECORD_MS starts the
 * clip, lifting it ends it. The same finger slides up to zoom in and down to
 * zoom out, as often as it likes, and left to lock the clip hands-free.
 *
 * The finger is followed on the window by its pointer id from the moment it
 * goes down (and the button keeps it, pointer capture), so it can wander
 * anywhere on the screen without ending the clip; nothing scrolls, selects or
 * opens a menu under it. Zoom is measured from where the finger was when
 * filming started, never where it first touched, so a thumb that rolled a
 * little during the hold doesn't jump the zoom. A gesture the browser itself
 * cancels (a system swipe, a call) locks the clip rather than losing it.
 * A tap while it films hands-free stops it at once (on the touch, not the
 * click, which a moved finger never sends), and the click a hold leaves
 * behind is eaten, so it never also takes a photo.
 */
function useHold(hold: Hold | undefined, blocked: boolean) {
  const [armed, setArmed] = useState(false);
  const holdRef = useRef(hold);
  holdRef.current = hold;
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finger = useRef<{ id: number; x: number; y: number; ax: number; ay: number; below: number; held: boolean; locked: boolean } | null>(null);
  const eatClickUntil = useRef(0);
  const off = useRef<(() => void) | null>(null);
  const lockEl = useRef<HTMLSpanElement | null>(null);
  const recording = !!hold?.recording;
  const locked = !!hold?.locked;

  const setReach = (v: number) => lockEl.current?.style.setProperty("--reach", String(v));
  const finish = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    off.current?.();
    off.current = null;
    finger.current = null;
    setReach(0);
  };
  // leaving mid-hold lets go of the window's listeners
  useEffect(() => finish, []); // eslint-disable-line react-hooks/exhaustive-deps
  // can't film any more (another mode, the camera went): nothing stays armed
  useEffect(() => {
    if (!hold) setArmed(false);
  }, [hold]);
  // filming ended (the limit, a tap, the app away): back to the shutter
  useEffect(() => {
    if (!recording && !finger.current) setArmed(false);
  }, [recording]);

  const onPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    const h = holdRef.current;
    if (!h || blocked || finger.current) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    // filming hands-free (or kept going after the mic question): this touch stops it, right away
    if (h.recording) {
      eatClickUntil.current = performance.now() + 700;
      feedback("tap");
      h.onStop();
      return;
    }
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* not supported: the window still follows it */
    }
    const id = e.pointerId;
    finger.current = { id, x: e.clientX, y: e.clientY, ax: e.clientX, ay: e.clientY, below: window.innerHeight - e.clientY, held: false, locked: false };
    const move = (ev: PointerEvent) => {
      const f = finger.current;
      if (!f || ev.pointerId !== id) return;
      f.x = ev.clientX;
      f.y = ev.clientY;
      if (!f.held || f.locked) return;
      const hh = holdRef.current;
      const dx = f.x - f.ax;
      const dy = f.y - f.ay;
      if (hh?.onLock && !hh.locked && slideLocks(dx, dy)) {
        f.locked = true;
        setReach(1);
        feedback("detent");
        hh.onLock();
        return;
      }
      const reach = hh?.onLock ? lockReach(dx, dy) : 0;
      if (hh?.onLock) setReach(reach);
      // heading for the lock (mostly sideways, to the left): that's not a zoom, so the zoom holds where it was
      if (reach > 0.25) return;
      hh?.onSlide?.(dx, dy, f.below);
    };
    const up = (ev: PointerEvent, cancelled: boolean) => {
      const f = finger.current;
      if (!f || ev.pointerId !== id) return;
      const hh = holdRef.current;
      finish();
      if (!f.held) return;
      eatClickUntil.current = performance.now() + 700;
      if (f.locked) return;
      // the browser took the finger away (a system gesture): keep the clip, hands-free, rather than lose it
      if (cancelled && hh?.onLock) {
        hh.onLock();
        return;
      }
      setArmed(false);
      feedback("tap");
      hh?.onEnd();
    };
    const onUp = (ev: PointerEvent) => up(ev, false);
    const onCancel = (ev: PointerEvent) => up(ev, true);
    // while the finger's down nothing under it scrolls or selects (iOS honours touch-action late on a moving finger)
    const still = (ev: Event) => {
      if (ev.cancelable) ev.preventDefault();
    };
    window.addEventListener("pointermove", move, true);
    window.addEventListener("pointerup", onUp, true);
    window.addEventListener("pointercancel", onCancel, true);
    window.addEventListener("touchmove", still, { capture: true, passive: false });
    window.addEventListener("selectstart", still, true);
    off.current = () => {
      window.removeEventListener("pointermove", move, true);
      window.removeEventListener("pointerup", onUp, true);
      window.removeEventListener("pointercancel", onCancel, true);
      window.removeEventListener("touchmove", still, true);
      window.removeEventListener("selectstart", still, true);
    };
    timer.current = setTimeout(() => {
      timer.current = null;
      const f = finger.current;
      if (!f || f.id !== id) return;
      // zoom is measured from here: wherever the thumb rolled to during the hold
      f.held = true;
      f.ax = f.x;
      f.ay = f.y;
      f.below = window.innerHeight - f.y;
      setArmed(true);
      feedback("press");
      holdRef.current?.onStart();
    }, HOLD_TO_RECORD_MS);
  };

  return {
    /** The recording surface shows: the hold crossed into filming, or it's filming. */
    active: armed || recording,
    recording,
    locked,
    lockEl,
    handlers: { onPointerDown },
    /** True when the click that just came should do nothing (the end of a hold, or the tap that stopped a clip). */
    eatClick: () => performance.now() < eatClickUntil.current,
  };
}

/** The ring's colours: the brand's amber into red, the story ring's (story-ring.tsx STORY_RING_FROM / _TO). */
const STORY_RING_FROM = "#f7a53a";
const STORY_RING_TO = "#ef3340";
/** Where the shutter grows to while it films (Instagram's): a ring this wide, centred on the shutter. */
const SURFACE = 124;
/** The ring's radius and circumference (the keyframes in styles.css fill exactly this). */
const RING_R = 60;
const RING_C = 2 * Math.PI * RING_R;

/**
 * The shutter while it films (Instagram's): the button grows into a large
 * translucent circle around a white rounded-square stop, a thin gradient ring
 * (the brand's amber into red, turning slowly) fills around its edge over the
 * clip limit, and it all shrinks back to the shutter when the clip ends. It
 * sits exactly on the shutter's centre and never moves; the ring is a CSS
 * animation from `startedAt`, so nothing re-renders while it fills.
 */
function RecordSurface({ h, hold }: { h: HoldState; hold?: Hold }) {
  const gid = `jf-rec-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  const still = typeof window !== "undefined" && !!window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
  const startedAt = hold?.recording ? hold.startedAt : null;
  const elapsed = startedAt == null ? 0 : Math.max(0, performance.now() - startedAt);
  const state = h.locked && h.recording ? "locked" : h.recording ? "recording" : h.active ? "armed" : "idle";
  const on = state !== "idle";
  return (
    <span
      aria-hidden
      className="pointer-events-none absolute left-1/2 top-1/2 z-10 -translate-x-1/2 -translate-y-1/2"
      style={{ width: SURFACE, height: SURFACE }}
      data-record-surface={state}
    >
      {/* the surface: grows out of the shutter, frosted, the picture showing through */}
      <span
        className="absolute inset-0 rounded-full bg-white/20 shadow-[0_8px_30px_rgba(0,0,0,0.18)] backdrop-blur-md transition-[transform,opacity] duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1.12)]"
        style={{ transform: `scale(${on ? 1 : 78 / SURFACE})`, opacity: on ? 1 : 0 }}
      />
      {/* the progress: a faint track and the gradient filling over it from the top */}
      <svg viewBox={`0 0 ${SURFACE} ${SURFACE}`} className="absolute inset-0 h-full w-full overflow-visible transition-opacity duration-300" style={{ opacity: on ? 1 : 0 }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor={STORY_RING_FROM} />
            <stop offset="0.55" stopColor={STORY_RING_TO} />
            <stop offset="1" stopColor={STORY_RING_FROM} />
            {!still && <animateTransform attributeName="gradientTransform" type="rotate" from="0 0.5 0.5" to="360 0.5 0.5" dur="3.2s" repeatCount="indefinite" />}
          </linearGradient>
        </defs>
        <circle cx={SURFACE / 2} cy={SURFACE / 2} r={RING_R} fill="none" stroke="rgba(255,255,255,0.28)" strokeWidth={2} />
        {startedAt != null && (
          <circle
            key={startedAt}
            cx={SURFACE / 2}
            cy={SURFACE / 2}
            r={RING_R}
            fill="none"
            stroke={`url(#${gid})`}
            strokeWidth={3.5}
            strokeLinecap="round"
            strokeDasharray={RING_C}
            transform={`rotate(-90 ${SURFACE / 2} ${SURFACE / 2})`}
            style={{ strokeDashoffset: RING_C, animation: `jf-rec-ring ${hold!.limitMs}ms linear ${-elapsed}ms forwards` }}
            data-record-ring
          />
        )}
      </svg>
      {/* the stop: the shutter's white circle closing into a rounded square */}
      <span
        className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 bg-white shadow-[0_2px_10px_rgba(0,0,0,0.25)] transition-[width,height,border-radius,opacity] duration-300 ease-[cubic-bezier(0.2,0.9,0.25,1)]"
        style={{ width: on ? 30 : 60, height: on ? 30 : 60, borderRadius: on ? 9 : 30, opacity: on ? 1 : 0 }}
        data-record-stop
      />
    </span>
  );
}

/** The zoom while it films, just over the top of the recording surface (where the eye already is). */
function SurfaceZoom({ h, zoom }: { h: HoldState; zoom?: ReactNode }) {
  if (!zoom || !h.active) return null;
  return (
    <div className="pointer-events-none absolute inset-x-0 z-20" style={{ bottom: `calc(50% + ${SURFACE / 2 + 8}px)` }} data-surface-zoom>
      {zoom}
    </div>
  );
}

/**
 * The lock, left of the filming shutter: slide there and the clip carries on
 * hands-free. It brightens as the finger nears it (`--reach`, set by the
 * gesture, no re-render) and turns solid once it's locked.
 */
function LockBadge({ h, hold }: { h: HoldState; hold?: Hold }) {
  if (!hold?.onLock || !h.active) return null;
  const on = h.locked;
  return (
    <span
      ref={h.lockEl}
      className={cn(
        "pointer-events-none absolute z-10 grid h-11 w-11 place-items-center rounded-full transition-[background-color,color,transform] duration-200 animate-in fade-in",
        on ? "bg-white text-black" : "bg-black/35 text-white backdrop-blur-md",
      )}
      style={{ right: `calc(50% + ${SURFACE / 2 + 14}px)`, top: "calc(50% - 22px)", transform: on ? "scale(1.06)" : "scale(calc(1 + var(--reach, 0) * 0.22))" }}
      data-record-lock={on ? "on" : "off"}
      aria-hidden
    >
      {!on && <ChevronLeft className="absolute -right-3.5 h-3.5 w-3.5 text-white/70" />}
      <Lock className="h-[18px] w-[18px]" strokeWidth={2.4} />
    </span>
  );
}

/**
 * The clip's time while it films: a small pill with a softly blinking dot
 * (the camera's top, where the flash sits; the ring around the shutter is
 * the progress). Its own clock, so only it re-renders.
 */
export function RecordingClock({ startedAt, locked = false }: { startedAt: number; locked?: boolean }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const t = setInterval(() => setNow(performance.now()), 250);
    return () => clearInterval(t);
  }, []);
  const s = Math.max(0, Math.floor((now - startedAt) / 1000));
  return (
    <span className="inline-flex h-8 items-center gap-1.5 rounded-full bg-black/40 px-3 text-[13px] font-semibold tabular-nums text-white backdrop-blur-md" data-recording-time>
      <span className="jf-rec-dot h-2 w-2 rounded-full" style={{ background: STORY_RING_TO }} aria-hidden />
      {`${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`}
      {locked && <Lock className="h-3 w-3 text-white/80" aria-label="Hands-free" />}
    </span>
  );
}

/**
 * The plain shutter: a tap takes a photo; with `hold`, holding it films
 * (Instagram's camera) and it becomes the recording surface.
 */
function Shutter({ onShoot, disabled, counting, hold, h, zoom }: { onShoot: () => void; disabled: boolean; counting: boolean; hold?: Hold; h: HoldState; zoom?: ReactNode }) {
  const active = h.active;
  return (
    <div className="relative flex h-[88px] items-center justify-center">
      <SurfaceZoom h={h} zoom={zoom} />
      <LockBadge h={h} hold={hold} />
      <RecordSurface h={h} hold={hold} />
      <button
        type="button"
        disabled={disabled}
        {...h.handlers}
        draggable={false}
        onContextMenu={(e) => e.preventDefault()}
        onClick={() => {
          // a hold was a clip, not a photo; the tap that stopped a clip was only that
          if (h.eatClick()) return;
          if (hold?.recording) return hold.onStop();
          onShoot();
        }}
        className={cn(
          "grid h-[78px] w-[78px] touch-none select-none place-items-center rounded-full border-[5px] transition-[border-color,transform] duration-200 [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] [-webkit-user-select:none] disabled:opacity-30",
          active ? "border-transparent" : "border-white active:scale-95",
        )}
        aria-label={active ? "Stop filming" : counting ? "Cancel timer" : hold ? "Take photo, or hold to film (slide up to zoom, left to lock)" : "Take photo"}
        data-shutter
        data-filming={hold?.recording ? "" : undefined}
      >
        <span className={cn("block rounded-full transition-[opacity,width,height,border-radius] duration-200", active ? "h-[60px] w-[60px] opacity-0" : counting ? "h-7 w-7 rounded-md bg-red-500" : "h-[60px] w-[60px] bg-white")} />
      </button>
    </div>
  );
}

function Glide({ looks, look, onLook, onShoot, disabled, counting, showName, hold, h, groups, zoom }: {
  groups?: LookGroup[];
  zoom?: ReactNode;
  looks: LookItem[];
  look: string;
  onLook: (key: string) => void;
  onShoot?: () => void;
  disabled: boolean;
  counting: boolean;
  showName: boolean;
  /** Hold to film: only while the one in the ring can film (Normal). */
  hold?: Hold;
  h: HoldState;
}) {
  const row = useRef<HTMLDivElement | null>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const at = Math.max(0, looks.findIndex((l) => l.key === look));
  // a picker (no shutter): the ring shows what's on, the circle in it isn't a button to take a photo
  const pick = !onShoot;
  const active = !pick && h.active;
  const filming = active;
  // the look in the ring as the row moves (ahead of React)
  const shown = useRef(at);
  // a scroll we started (a tap, or a swipe on the camera): it lands on `to`, the looks in between don't count
  const steering = useRef<number | null>(null);
  const frame = useRef(0);
  const lookRef = useRef(onLook);
  lookRef.current = onLook;

  // circles grow as they near the ring, like Instagram's; while it films the others step back out of the way
  const paint = () => {
    const el = row.current;
    if (!el) return;
    const mid = el.scrollLeft / STEP;
    items.current.forEach((b, i) => {
      if (!b) return;
      const d = Math.min(1, Math.abs(i - mid));
      b.style.transform = `scale(${1 - 0.2 * d})`;
      b.style.opacity = active && i !== at ? "0" : String(1 - 0.25 * d);
    });
  };
  useEffect(() => paint(), [active, at]); // eslint-disable-line react-hooks/exhaustive-deps

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
        // each look a detent, the iPhone camera's filter wheel
        feedback("detent");
        lookRef.current(looks[i].key);
      }
    });
  };
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const bring = (i: number) => {
    const el = row.current;
    if (!el) return;
    steering.current = i;
    shown.current = i;
    lookRef.current(looks[i].key);
    el.scrollTo({ left: i * STEP, behavior: "smooth" });
  };

  // the chips: only groups that have a filter in this row
  const chips = (groups ?? []).filter((g) => looks.some((l) => l.group === g.key));
  const onGroup = looks[at]?.group ?? null;
  return (
    <div className="relative" data-look-carousel={pick ? "pick" : "shoot"}>
      {/* while it films the chips and the name keep their room (nothing above the shutter moves), just unseen */}
      {chips.length > 1 && <GroupChips chips={chips} on={onGroup} hidden={filming} onPick={(k) => bring(Math.max(0, looks.findIndex((l) => l.group === k)))} />}
      {/* what the ring holds, above it */}
      <div className={cn("pointer-events-none mb-1.5 flex justify-center transition-opacity duration-200", !showName && "sr-only", active && "invisible opacity-0")}>
        <span className="rounded-full bg-black/35 px-2.5 py-0.5 text-[12px] font-bold backdrop-blur-sm" data-look-name>
          {looks[at]?.label}
        </span>
      </div>
      <div className="relative h-[88px]">
        <div
          ref={row}
          onScroll={onScroll}
          // a finger on the row takes over from any glide we started
          onPointerDown={() => (steering.current = null)}
          onTouchStart={() => (steering.current = null)}
          // filming: the row holds still (a swipe mid-clip can't change the filter)
          className={cn(
            "flex h-full snap-x snap-mandatory items-center overscroll-x-contain [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
            active ? "overflow-x-hidden" : "overflow-x-auto",
          )}
          style={{ gap: GAP, paddingInline: `calc(50% - ${ITEM / 2}px)` }}
          role="listbox"
          aria-label="Filters"
        >
          {looks.map((l, i) => {
            const Icon = ICON[l.look];
            const on = i === at;
            return (
              <button
                key={l.key}
                ref={(b) => {
                  items.current[i] = b;
                }}
                type="button"
                role="option"
                aria-selected={on}
                aria-label={pick ? l.label : on ? (active ? "Stop filming" : counting ? "Cancel timer" : `Take photo, ${l.label}${hold ? ", or hold to film" : ""}`) : l.label}
                disabled={!pick && ((on && disabled) || (!on && active))}
                {...(on && !pick ? h.handlers : {})}
                draggable={false}
                onContextMenu={(e) => e.preventDefault()}
                onClick={() => {
                  if (!on) return bring(i);
                  if (pick) return;
                  // a hold on the ring was a clip, not a photo; the tap that stopped a clip was only that
                  if (h.eatClick()) return;
                  if (hold?.recording) return hold.onStop();
                  onShoot?.();
                }}
                className={cn(
                  "grid shrink-0 snap-center snap-always place-items-center rounded-full transition-[background-color,color,opacity] duration-150 will-change-transform [-webkit-tap-highlight-color:transparent] [-webkit-touch-callout:none] disabled:opacity-40",
                  on ? (active ? "bg-transparent text-transparent" : "bg-white text-black") : "bg-white/20 text-white backdrop-blur-md",
                  on && !pick && "touch-none select-none [-webkit-user-select:none]",
                )}
                style={{ width: ITEM, height: ITEM }}
                data-look={l.look}
                data-look-key={l.key}
                data-shutter={on && !pick ? "" : undefined}
                data-filming={on && hold?.recording ? "" : undefined}
              >
                {on && active ? null : on && counting ? (
                  <span className="block h-6 w-6 rounded-md bg-red-500" />
                ) : on && l.look === "plain" && !l.emoji ? (
                  // no filter in the ring: just the shutter, like Instagram's (a picker: an empty circle, "none")
                  pick ? <span className="h-6 w-6 rounded-full border-2 border-current" aria-hidden /> : <span className="sr-only">{l.label}</span>
                ) : l.emoji ? (
                  <span className="text-[26px] leading-none" aria-hidden>
                    {l.emoji}
                  </span>
                ) : (
                  <Icon className="h-6 w-6" strokeWidth={2.2} />
                )}
              </button>
            );
          })}
        </div>
        {!pick && <SurfaceZoom h={h} zoom={zoom} />}
        {!pick && <LockBadge h={h} hold={hold} />}
        {!pick && <RecordSurface h={h} hold={hold} />}
        {/* the shutter's ring, still in the middle while the looks glide through it */}
        <span className={cn("pointer-events-none absolute left-1/2 top-1/2 h-[80px] w-[80px] -translate-x-1/2 -translate-y-1/2 rounded-full border-[5px] transition-[border-color] duration-200", active ? "border-transparent" : "border-white")} aria-hidden />
      </div>
    </div>
  );
}

/**
 * The filters' groups over the row (Today · Lock in · Train · Block · Fuel ·
 * Time · Mindset · Vibe): the one the ring is in is lit as you swipe, and a
 * tap glides the row to that group's first filter. Scrolls on a narrow
 * phone, keeping the lit one in view.
 */
function GroupChips({ chips, on, onPick, hidden = false }: { chips: LookGroup[]; on: string | null; onPick: (key: string) => void; hidden?: boolean }) {
  const row = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const el = row.current;
    const lit = el?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!el || !lit) return;
    const left = lit.offsetLeft - (el.clientWidth - lit.offsetWidth) / 2;
    el.scrollTo({ left: Math.max(0, left), behavior: "smooth" });
  }, [on]);
  return (
    <div
      ref={row}
      className={cn(
        "mb-2 flex gap-1.5 overflow-x-auto px-4 [mask-image:linear-gradient(90deg,transparent,#000_16px,#000_calc(100%-16px),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden",
        hidden && "invisible",
      )}
      aria-hidden={hidden || undefined}
      role="group"
      aria-label="Filter groups"
      data-filter-groups
    >
      {chips.map((g) => (
        <button
          key={g.key}
          type="button"
          aria-pressed={g.key === on}
          onClick={() => {
            feedback("tap");
            onPick(g.key);
          }}
          className={cn(
            "h-8 shrink-0 rounded-full px-3 text-[13px] font-bold transition-colors duration-200 active:scale-95",
            g.key === on ? "bg-white text-black" : "bg-black/40 text-white/85 backdrop-blur-md",
          )}
          data-filter-group={g.key}
        >
          {g.label}
        </button>
      ))}
    </div>
  );
}

/** A filter's glyph, as on its circle: its emoji, else its card's icon (Normal: an empty ring). */
export function LookGlyph({ item, className }: { item: LookItem; className?: string }) {
  if (item.emoji)
    return (
      <span className={cn("leading-none", className)} aria-hidden>
        {item.emoji}
      </span>
    );
  const Icon = ICON[item.look];
  return <Icon className={className} aria-hidden />;
}
