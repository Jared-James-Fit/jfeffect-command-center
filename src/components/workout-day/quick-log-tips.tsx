/**
 * "Fastest way to log": a short demo of the logger's quickest moves, played on
 * a small copy of an exercise card (never the real one, so nothing is saved):
 *   1. reps and RPE are already filled in from the program;
 *   2. typing set 1's weight logs the whole exercise (the sets below fill in
 *      with it and log too; change any set that went differently);
 *   3. or Suggest picks the weight, and one tap on a set's number logs it;
 *   4. the last warm-up (optional) tunes today's weight;
 *   5. (a coaching client's) the camera sends a set or warm-up to the coach.
 * It opens by itself once per account, the first time someone logs their own
 * workout after it shipped (`workout_view_prefs.logging_tips_at`, see
 * use-workout-view.ts), and any time from the logger's "Log faster" button or
 * Focus's tips. Each step loops its beats (before, the tap, after); reduced
 * motion holds each step on its last beat.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Check, Play, X, Zap } from "lucide-react";
import { cn } from "@/lib/utils";

type StepKey = "prefilled" | "type" | "suggest" | "warmup" | "video";
type Step = { key: StepKey; title: string; body: string };

const STEPS: Step[] = [
  {
    key: "prefilled",
    title: "Reps and RPE are filled in",
    body: "They come from your program, so most sets only need a weight. Tap one to change it.",
  },
  {
    key: "type",
    title: "Type set 1's weight. Done.",
    body: "Every set below fills in at that weight and logs too. A set went differently? Tap its box and change it.",
  },
  {
    key: "suggest",
    title: "Or let the app pick the weight",
    body: "Turn on Suggest and it works out today's weight from your history. Tap a set's number to log it at that weight.",
  },
  {
    key: "warmup",
    title: "Your last warm-up (optional)",
    body: "Type it before set 1 and today's weight is tuned to how you're moving. Skip it any time.",
  },
  {
    key: "video",
    title: "Film a set for your coach",
    body: "Tap the camera on any set or warm-up. It goes to your coach's chat while you keep logging.",
  },
];

/** The steps someone sees: the video step only where set videos are on (a coaching client's). */
export function quickLogSteps(videoOn: boolean): Step[] {
  return videoOn ? STEPS : STEPS.filter((s) => s.key !== "video");
}

/** Each step's loop, beat by beat (ms). The last beat is the "after" a reduced-motion phone holds. */
export const QUICK_LOG_BEATS: Record<StepKey, readonly number[]> = {
  prefilled: [2400],
  type: [1000, 750, 1900],
  suggest: [900, 600, 900, 600, 1700],
  warmup: [1000, 750, 1900],
  video: [1000, 600, 1700],
};

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return reduced;
}

export function QuickLogTips({
  onClose,
  videoOn = false,
  unit = "lb",
}: {
  onClose: () => void;
  /** Set videos are on for this athlete (a coaching client): show the camera step. */
  videoOn?: boolean;
  unit?: "kg" | "lb";
}) {
  const steps = useMemo(() => quickLogSteps(videoOn), [videoOn]);
  const [i, setI] = useState(0);
  const step = steps[i];
  const last = i === steps.length - 1;
  const reduced = useReducedMotion();
  const beats = QUICK_LOG_BEATS[step.key];
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduced) { setBeat(beats.length - 1); return; }
    setBeat(0);
    let b = 0;
    let t = 0;
    const tick = () => {
      t = window.setTimeout(() => {
        b = (b + 1) % beats.length;
        setBeat(b);
        tick();
      }, beats[b]);
    };
    tick();
    return () => window.clearTimeout(t);
  }, [i, reduced, beats]);

  const nextRef = useRef<HTMLButtonElement>(null);
  // focus moves into the dialog once (screen readers start here), never a ring on a button
  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => { boxRef.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.preventDefault(); onClose(); }
      else if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, last, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Fastest way to log"
      data-testid="quick-log-tips"
      data-state="open"
      className="fixed inset-0 z-[60] flex items-end justify-center animate-in fade-in-0 duration-200 sm:items-center"
    >
      <button type="button" aria-label="Close" tabIndex={-1} className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div
        ref={boxRef}
        tabIndex={-1}
        className="relative mx-3 mb-[calc(env(safe-area-inset-bottom,0px)+12px)] w-full max-w-md rounded-2xl border border-border bg-card p-4 text-foreground shadow-2xl outline-none animate-in slide-in-from-bottom-4 duration-300 sm:mb-0"
      >
        <div className="flex items-center gap-2">
          <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-muted">
            <Zap className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight">Fastest way to log</div>
            <div className="text-xs text-muted-foreground">
              {i + 1} of {steps.length}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close tips"
            data-testid="quick-log-tips-close"
            className="-mr-1 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <MockCard step={step.key} beat={beat} unit={unit} videoOn={videoOn} />

        <div className="mt-3 min-h-[76px]" aria-live="polite">
          <div className="text-base font-semibold leading-snug" data-testid="quick-log-tips-title">{step.title}</div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{step.body}</p>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5" aria-hidden>
            {steps.map((s, k) => (
              <span
                key={s.key}
                className={cn("h-1.5 rounded-full transition-all", k === i ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30")}
              />
            ))}
          </div>
          {i > 0 && (
            <button
              type="button"
              onClick={() => setI((n) => n - 1)}
              className="h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Back
            </button>
          )}
          <button
            ref={nextRef}
            type="button"
            data-testid="quick-log-tips-next"
            onClick={() => (last ? onClose() : setI((n) => n + 1))}
            className="h-11 min-w-[96px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98]"
          >
            {last ? "Got it" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A finger's tap on whatever it sits in (the cell is `relative`). */
function Finger({ on }: { on: boolean }) {
  return (
    <span
      aria-hidden
      className={cn(
        "pointer-events-none absolute left-1/2 top-1/2 z-10 h-9 w-9 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-foreground/70 bg-foreground/15 transition-all duration-200",
        on ? "scale-100 opacity-100" : "scale-150 opacity-0",
      )}
    />
  );
}

const CELL = "relative flex h-9 items-center justify-center rounded-md border text-sm font-medium tabular-nums transition-colors duration-300";
const WELL = "border-border/60 bg-muted/40 text-foreground";
const FOCUSED = "border-primary bg-background ring-2 ring-primary/30";

/**
 * A small exercise card in the logger's own look: the Last time · Suggested
 * strip, the set table's header, the last warm-up row and two sets.
 */
function MockCard({ step, beat, unit, videoOn }: { step: StepKey; beat: number; unit: "kg" | "lb"; videoOn: boolean }) {
  const kg = unit === "kg";
  const n = (lb: number, kgv: number) => String(kg ? kgv : lb);
  const suggested = n(185, 85);
  const tuned = n(190, 87.5);
  const warm = n(165, 75);
  const typed = n(190, 87.5);
  const finalBeat = QUICK_LOG_BEATS[step].length - 1;
  const after = beat === finalBeat;

  // Suggest: off until the finger turns it on (the suggest step), else on
  const suggestOn = step !== "suggest" || beat >= 2;
  const warmLogged = step === "warmup" && after;
  const shownSuggested = warmLogged ? tuned : suggested;
  // set 1 (and, for a typed weight, set 2 with it)
  const typing = step === "type" && beat === 1;
  const typedAll = step === "type" && after;
  const tapped = step === "suggest" && after;
  const setState = (k: number): { weight: string; done: boolean; focused: boolean } => {
    if (typedAll) return { weight: typed, done: true, focused: false };
    if (k === 1 && typing) return { weight: typed.slice(0, -1), done: false, focused: true };
    if (k === 1 && tapped) return { weight: suggested, done: true, focused: false };
    return { weight: "", done: false, focused: false };
  };
  const warmWeight = step === "warmup" && beat >= 1 ? (beat === 1 ? warm.slice(0, -1) : warm) : "";
  const filmed = step === "video" && after;
  const grid = videoOn ? "30px 1fr 1fr 1.35fr 28px" : "30px 1fr 1fr 1.35fr";
  const ring = "ring-2 ring-foreground/40 ring-offset-1 ring-offset-card";

  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background" aria-hidden data-testid="quick-log-mock">
      <div className="px-3 pt-2.5">
        <div className="text-[15px] font-semibold">Competition Squat</div>
        <div className="text-lg font-semibold tabular-nums">3 × 5 @ RPE 8</div>
      </div>
      <div className="mx-3 mt-1.5 flex items-stretch rounded-lg bg-muted/50 text-[12px]">
        <div className="flex-1 px-2.5 py-1.5">
          <div className="text-muted-foreground">Last time</div>
          <div className="font-medium tabular-nums">{n(180, 82.5)} {unit} × 5 @ 8</div>
        </div>
        <div className="my-1.5 w-px bg-border" />
        <div className="relative flex flex-1 items-center px-2.5 py-1.5">
          {suggestOn ? (
            <div>
              <div className="flex items-center gap-1 text-muted-foreground">
                Suggested
                {warmLogged && <span className="h-1.5 w-1.5 rounded-full bg-success" data-testid="mock-tuned" />}
              </div>
              <div className={cn("inline-flex rounded-md px-1.5 font-semibold tabular-nums transition-colors duration-300", warmLogged ? "bg-success/15 text-success" : "bg-blue-500/10 text-blue-700 dark:text-blue-300")}>
                {shownSuggested} {unit}
              </div>
            </div>
          ) : (
            <span className="relative inline-flex items-center gap-1.5 rounded-full border border-border px-2.5 py-1 font-semibold" data-testid="mock-suggest-off">
              Suggest
              <span className="h-3.5 w-6 rounded-full bg-muted-foreground/30" />
              <Finger on={step === "suggest" && beat === 1} />
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 grid gap-1.5 px-2 text-[11px] text-muted-foreground" style={{ gridTemplateColumns: grid }}>
        <span className="text-center">Set</span>
        <span className="text-center">Reps</span>
        <span className="text-center">RPE</span>
        <span className="text-center">Weight ({unit})</span>
        {videoOn && <span className="flex justify-center"><Camera className="h-3 w-3" /></span>}
      </div>

      {/* the last warm-up, open and optional */}
      <div className={cn("mt-1 border-t border-border/70 transition-colors", step === "warmup" && "bg-muted/30")}>
        <div className="grid items-center gap-1.5 px-2 py-1.5" style={{ gridTemplateColumns: grid }}>
          <span className={cn("text-center text-sm font-semibold", warmLogged ? "text-orange-500" : "text-muted-foreground")}>W</span>
          <span className={cn(CELL, WELL)}>3</span>
          <span className={cn(CELL, WELL)}>7</span>
          <span className={cn(CELL, step === "warmup" && beat === 1 ? FOCUSED : WELL, !warmWeight && "text-muted-foreground/60")}>
            {warmWeight || "—"}
            <Finger on={step === "warmup" && beat === 1} />
          </span>
          {videoOn && (
            <span className="relative grid h-9 place-items-center text-muted-foreground/70">
              <Camera className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className="px-2 pb-1.5 pl-[42px] text-[11px] text-muted-foreground">
          {warmLogged ? <span className="font-medium text-success">✓ Suggested is tuned from this warm-up</span> : "Last warm-up · optional"}
        </div>
      </div>

      {[1, 2].map((k) => {
        const st = setState(k);
        return (
          <div key={k} className={cn("border-t border-border/70 transition-colors duration-300", st.done && "bg-success/[0.06]")}>
            <div className="grid items-center gap-1.5 px-2 py-1.5" style={{ gridTemplateColumns: grid }}>
              <span className="relative flex h-9 items-center justify-center">
                <span
                  className={cn(
                    "inline-flex h-7 w-7 items-center justify-center rounded-full border text-xs font-semibold tabular-nums transition-colors duration-300",
                    st.done ? "border-success bg-success text-white" : "border-transparent bg-muted text-muted-foreground",
                    k === 1 && step === "suggest" && beat === 2 && ring,
                  )}
                  data-testid={`mock-set-${k}`}
                  data-done={st.done ? "true" : "false"}
                >
                  {st.done ? <Check className="h-3.5 w-3.5" /> : k}
                </span>
                {k === 1 && <Finger on={step === "suggest" && beat === 3} />}
              </span>
              <span className={cn(CELL, WELL, step === "prefilled" && ring)}>5</span>
              <span className={cn(CELL, WELL, step === "prefilled" && ring)}>8</span>
              <span
                className={cn(
                  CELL,
                  st.focused ? FOCUSED : st.weight ? WELL : "border-blue-500/40 bg-blue-500/10 text-muted-foreground",
                )}
                data-testid={`mock-weight-${k}`}
              >
                {st.weight || "—"}
                {k === 1 && <Finger on={typing} />}
              </span>
              {videoOn && (
                <span className="relative grid h-9 place-items-center">
                  {k === 1 && filmed ? (
                    <span className="grid h-7 w-7 place-items-center rounded-md border border-border bg-muted-foreground/40 text-white">
                      <Play className="h-3 w-3 fill-current" />
                    </span>
                  ) : (
                    <Camera className={cn("h-4 w-4 text-muted-foreground/70", k === 1 && step === "video" && !after && "text-foreground")} />
                  )}
                  {k === 1 && <Finger on={step === "video" && beat === 1} />}
                </span>
              )}
            </div>
          </div>
        );
      })}
      <div className="h-1.5" />
    </div>
  );
}
