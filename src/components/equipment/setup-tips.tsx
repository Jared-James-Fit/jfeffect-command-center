/**
 * "Save your setup": a short walkthrough of Equipment & setups, played on small
 * copies of the app's own pieces (nothing here saves anything):
 *   1. save your rack height once (the setup sheet filling in);
 *   2. it's on the exercise card every time (the quiet line, a tap opens it);
 *   3. switch racks or machines in one tap;
 *   4. history and PRs say which machine (weights on two machines are kept apart).
 *
 * EquipmentIntroGate shows it once per account on the Workouts page (never in
 * a workout, never over another popup, never in View as client), to accounts
 * made before it shipped (whats-new.ts), until they've saved a setup; seen is
 * kept server-side (feature_announcement_views). It opens any time from Training
 * help's Guides and from Account → Equipment & setups ("How it works").
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Check, ChevronRight, History, MoreHorizontal, SlidersHorizontal, Trophy, X } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { useViewingAsClient } from "@/lib/client-impersonation";
import { isNewsTo } from "@/lib/whats-new";
import { cn } from "@/lib/utils";
import { useAthleteEquipment } from "@/lib/equipment/equipment-queries";

export const EQUIPMENT_FEATURE_KEY = "equipment_setups_2026_11";
/** Accounts made from here on have had Equipment & setups from day one. */
export const EQUIPMENT_NEW_SINCE = "2026-11-20T06:00:00Z";

type StepKey = "save" | "line" | "switch" | "history";
const STEPS: Array<{ key: StepKey; title: string; body: string }> = [
  {
    key: "save",
    title: "Save your rack height once",
    body: "J-hooks, safeties, seat, pulley height, grip: tap \"Add your setup\" under any exercise. It saves as you go and shows on that card every time.",
  },
  {
    key: "line",
    title: "It's on the card every time",
    body: "One quiet line under the exercise. Tap it to see or change the setup, with a photo if you took one.",
  },
  {
    key: "switch",
    title: "Another gym? One tap",
    body: "Your racks and machines are saved by gym. Switch and the rest of the workout follows to that gym's setups.",
  },
  {
    key: "history",
    title: "Your history knows the machine",
    body: "Sets and PRs remember what they were done on, and Last time reads the same machine. Weights on two machines are never mixed.",
  },
];

/** Each step's loop, beat by beat (ms); the last beat is what reduced motion holds. */
export const SETUP_TIP_BEATS: Record<StepKey, readonly number[]> = {
  save: [900, 650, 650, 1800],
  line: [1100, 700, 1700],
  switch: [1000, 700, 1800],
  history: [2600],
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

export function EquipmentSetupTips({
  onClose,
  onStart,
  unit = "lb",
}: {
  onClose: () => void;
  /** The last step's main button ("Save my first setup"); without it, "Got it". */
  onStart?: () => void;
  unit?: "kg" | "lb";
}) {
  const [i, setI] = useState(0);
  const step = STEPS[i];
  const last = i === STEPS.length - 1;
  const reduced = useReducedMotion();
  const beats = SETUP_TIP_BEATS[step.key];
  const [beat, setBeat] = useState(0);
  useEffect(() => {
    if (reduced) {
      setBeat(beats.length - 1);
      return;
    }
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

  const boxRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    boxRef.current?.focus({ preventScroll: true });
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowRight" && !last) setI((n) => n + 1);
      else if (e.key === "ArrowLeft" && i > 0) setI((n) => n - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [i, last, onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Save your setup"
      data-testid="setup-tips"
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
            <SlidersHorizontal className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold leading-tight">Equipment & setups</div>
            <div className="text-xs text-muted-foreground">
              {i + 1} of {STEPS.length}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Skip"
            data-testid="setup-tips-close"
            className="-mr-1 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-muted"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <MockScene step={step.key} beat={beat} unit={unit} />

        <div className="mt-3 min-h-[76px]" aria-live="polite">
          <div className="text-base font-semibold leading-snug" data-testid="setup-tips-title">{step.title}</div>
          <p className="mt-1 text-[13px] leading-snug text-muted-foreground">{step.body}</p>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <div className="flex flex-1 items-center gap-1.5" aria-hidden>
            {STEPS.map((s, k) => (
              <span key={s.key} className={cn("h-1.5 rounded-full transition-all", k === i ? "w-5 bg-foreground" : "w-1.5 bg-muted-foreground/30")} />
            ))}
          </div>
          {i > 0 ? (
            <button type="button" onClick={() => setI((n) => n - 1)} className="h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground">
              Back
            </button>
          ) : (
            <button type="button" onClick={onClose} className="h-11 rounded-lg px-3 text-sm font-medium text-muted-foreground hover:text-foreground" data-testid="setup-tips-skip">
              Not now
            </button>
          )}
          <button
            type="button"
            data-testid="setup-tips-next"
            onClick={() => (last ? (onStart ? onStart() : onClose()) : setI((n) => n + 1))}
            className="h-11 min-w-[96px] rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground transition active:scale-[0.98]"
          >
            {last ? (onStart ? "Save my first setup" : "Got it") : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}

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

/** A small exercise card in the logger's look, then whatever the step shows. */
function MockScene({ step, beat, unit }: { step: StepKey; beat: number; unit: "kg" | "lb" }) {
  const after = beat === SETUP_TIP_BEATS[step].length - 1;
  const atHome = step === "switch" && beat >= 2;
  const hooks = step === "save" ? (beat >= 1 ? "9" : "") : atHome ? "11" : "9";
  const safeties = step === "save" ? (beat >= 2 ? "4" : "") : atHome ? "5" : "4";
  const rack = atHome ? "Home rack" : "Rogue rack";
  const showLine = step !== "save" || after;
  const w = unit === "kg" ? "84" : "185";
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-border bg-background" aria-hidden data-testid="setup-tips-mock">
      <div className="px-3 pb-2 pt-2.5">
        <div className="flex items-start justify-between">
          <div className="text-[15px] font-semibold">{step === "history" ? "Machine Row" : "Competition Squat"}</div>
          <span className="relative grid h-7 w-7 place-items-center rounded-full text-muted-foreground">
            <MoreHorizontal className="h-4 w-4" />
            <Finger on={step === "save" && beat === 0} />
          </span>
        </div>
        <div className="text-[12px] text-muted-foreground">{step === "history" ? "Accessory" : "Primary squat"}</div>
        {showLine && step !== "history" && (
          <div
            className={cn(
              "relative mt-1 inline-flex items-center gap-1.5 rounded-md px-1 text-[12px] text-muted-foreground transition-colors duration-300",
              step === "line" && beat === 1 && "bg-muted",
            )}
            data-testid="setup-tips-line"
          >
            <SlidersHorizontal className="h-3 w-3" />
            {rack} · J-hooks {hooks} · Safeties {safeties}
            <Finger on={step === "line" && beat === 1} />
          </div>
        )}
        {step === "history" && (
          <div className="mt-1 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground">
            <SlidersHorizontal className="h-3 w-3" /> Hammer row · Seat 4
          </div>
        )}
      </div>

      {step === "save" && (
        <div className="mx-2 mb-2 rounded-xl border border-border bg-card p-2.5 transition-all duration-300">
          <div className="mb-1.5 flex items-center justify-between text-[12px]">
            <span className="font-semibold">Setup</span>
            <span className="text-muted-foreground">{after ? "Saved" : ""}</span>
          </div>
          {[
            ["J-hooks", hooks],
            ["Safeties", safeties],
          ].map(([label, value], k) => (
            <div key={label} className="mt-1 flex items-center justify-between gap-2 text-[13px]">
              <span>{label}</span>
              <span className={cn("relative grid h-8 w-16 place-items-center rounded-md border text-sm font-semibold tabular-nums transition-colors duration-300", (k === 0 && beat === 1) || (k === 1 && beat === 2) ? "border-primary ring-2 ring-primary/30" : "border-border")}>
                {value || "—"}
              </span>
            </div>
          ))}
        </div>
      )}

      {step === "line" && (
        <div className={cn("mx-2 mb-2 rounded-xl border border-border bg-card p-2.5 text-[12px] transition-all duration-300", beat >= 2 ? "opacity-100" : "opacity-0")}>
          <div className="flex items-center gap-2">
            <span className="h-9 w-9 rounded-lg bg-muted" />
            <div className="min-w-0 flex-1">
              <div className="font-semibold">Rogue rack</div>
              <div className="text-muted-foreground">Gold's Gym · Rack</div>
            </div>
            <span className="rounded-md border border-border px-2 py-1 font-semibold">Change</span>
          </div>
        </div>
      )}

      {step === "switch" && (
        <div className="mx-2 mb-2 flex gap-1.5 overflow-hidden text-[12px]">
          <span className={cn("inline-flex h-8 items-center rounded-full border px-2.5 font-medium", !atHome ? "border-foreground bg-foreground text-background" : "border-border")}>
            Rogue rack · Gold's
          </span>
          <span className={cn("relative inline-flex h-8 items-center rounded-full border px-2.5 font-medium transition-colors", atHome ? "border-foreground bg-foreground text-background" : "border-border")}>
            Home rack · Home
            <Finger on={beat === 1} />
          </span>
        </div>
      )}

      {step === "history" && (
        <div className="space-y-1.5 border-t border-border/70 px-3 py-2 text-[12px]">
          <div className="flex items-center justify-between">
            <span className="inline-flex items-center gap-1 text-muted-foreground"><History className="h-3 w-3" /> Last time · on Hammer row</span>
            <ChevronRight className="h-3 w-3 text-muted-foreground" />
          </div>
          <div className="font-semibold tabular-nums">{w} {unit} × 10 @ 8</div>
          <div className="inline-flex items-center gap-1 rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[11px] font-semibold">
            <Trophy className="h-3 w-3 text-warning" /> 10-rep all-time PR · on Hammer row
          </div>
          <div className="flex gap-1.5 pt-0.5">
            {["All · 9", "Hammer row · 6", "Life Fitness · 3"].map((c, k) => (
              <span key={c} className={cn("inline-flex h-7 items-center rounded-full border px-2 text-[11px] font-medium", k === 1 ? "border-foreground bg-foreground text-background" : "border-border")}>
                {k === 1 && <Check className="mr-1 h-3 w-3" />}
                {c}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

const db = supabase as any;

/** Record the walkthrough as seen (idempotent), retried a few times. */
async function saveSeen(userId: string) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { error } = await db
      .from("feature_announcement_views")
      .upsert({ user_id: userId, feature_key: EQUIPMENT_FEATURE_KEY }, { onConflict: "user_id,feature_key", ignoreDuplicates: true });
    if (!error) return true;
    await new Promise((r) => setTimeout(r, 800 * 2 ** attempt));
  }
  return false;
}

/** Shows the walkthrough once (see the file's header). Mount it on the Workouts page only. */
export function EquipmentIntroGate({ clientId, unit = "lb" }: { clientId: string | null | undefined; unit?: "kg" | "lb" }) {
  const { user } = useAuth();
  const viewingAsClient = useViewingAsClient();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const userId = user && !viewingAsClient && isNewsTo(user.created_at, EQUIPMENT_NEW_SINCE) ? user.id : null;
  const { data: equipment, loaded } = useAthleteEquipment(userId ? clientId : null);
  const hasSetup = useMemo(() => equipment.setups.some((s) => s.settings.length > 0 || !!s.equipment_id), [equipment.setups]);
  const [open, setOpen] = useState(false);
  const [closed, setClosed] = useState(false);

  const { data: seen, isFetchedAfterMount } = useQuery({
    queryKey: ["feature-announcement", EQUIPMENT_FEATURE_KEY, userId],
    enabled: !!userId,
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
    retry: 2,
    queryFn: async () => {
      const { data, error } = await db
        .from("feature_announcement_views")
        .select("feature_key")
        .eq("user_id", userId)
        .eq("feature_key", EQUIPMENT_FEATURE_KEY)
        .maybeSingle();
      if (error) return true; // can't tell: never nag
      return !!data;
    },
  });

  useEffect(() => {
    if (!userId || !clientId || !isFetchedAfterMount || seen !== false || !loaded || hasSetup || closed || open) return;
    let tries = 0;
    const id = window.setInterval(() => {
      tries++;
      // never over another popup or sheet, and only once the page has settled
      const busy = document.querySelector('[role="dialog"], [role="alertdialog"], [data-vaul-drawer]');
      if (!busy && tries >= 2) {
        setOpen(true);
        window.clearInterval(id);
      } else if (tries > 40) {
        window.clearInterval(id);
      }
    }, 1500);
    return () => window.clearInterval(id);
  }, [userId, clientId, seen, isFetchedAfterMount, loaded, hasSetup, closed, open]);

  const finish = () => {
    setOpen(false);
    setClosed(true);
    if (userId) {
      qc.setQueryData(["feature-announcement", EQUIPMENT_FEATURE_KEY, userId], true);
      void saveSeen(userId);
    }
  };

  if (!open) return null;
  return (
    <EquipmentSetupTips
      unit={unit}
      onClose={finish}
      onStart={() => {
        finish();
        void navigate({ to: "/portal/account", hash: "equipment" } as any);
      }}
    />
  );
}
