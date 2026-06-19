import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Dumbbell, ListChecks, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Pinned status bar shown at the top of a workout in progress.
 * Format:  Chest Day · 5/8 Exercises · 18/27 Sets · 43:21
 *
 * Purely presentational — counters and started_at are passed in so the
 * single source of truth stays in WorkoutDayView.
 */
export function WorkoutStatusBar({
  title,
  exercisesDone,
  exercisesTotal,
  setsDone,
  setsTotal,
  startedAt,
  completedAt,
  className,
}: {
  title: string;
  exercisesDone: number;
  exercisesTotal: number;
  setsDone: number;
  setsTotal: number;
  startedAt?: string | null;
  completedAt?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  // Pause / reset state — stored in localStorage so it survives a refresh
  // and accumulates while the tab is hidden or the route is unmounted.
  // Keyed by startedAt so each workout session has its own offsets.
  const storageKey = startedAt ? `wsb-pause:${startedAt}` : null;
  type Persisted = { pausedMs: number; hiddenAt: number | null };
  const readState = useCallback((): Persisted => {
    if (!storageKey || typeof window === "undefined") return { pausedMs: 0, hiddenAt: null };
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return { pausedMs: 0, hiddenAt: null };
      const parsed = JSON.parse(raw);
      return {
        pausedMs: Number(parsed?.pausedMs) || 0,
        hiddenAt: parsed?.hiddenAt != null ? Number(parsed.hiddenAt) : null,
      };
    } catch { return { pausedMs: 0, hiddenAt: null }; }
  }, [storageKey]);
  const writeState = useCallback((s: Persisted) => {
    if (!storageKey || typeof window === "undefined") return;
    try { window.localStorage.setItem(storageKey, JSON.stringify(s)); } catch { /* ignore */ }
  }, [storageKey]);

  const [persisted, setPersisted] = useState<Persisted>(() => ({ pausedMs: 0, hiddenAt: null }));
  // Load persisted state when startedAt becomes available / changes.
  useEffect(() => { setPersisted(readState()); }, [readState]);

  const isActive = !!startedAt && !completedAt;

  // Tick once per second while active.
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

  // Pause when the tab is hidden; resume on visible. Also treat unmount
  // (route exit) as "hidden" so navigating away pauses the timer.
  const persistedRef = useRef(persisted);
  persistedRef.current = persisted;
  useEffect(() => {
    if (!isActive || typeof document === "undefined") return;
    const onVis = () => {
      const cur = persistedRef.current;
      if (document.visibilityState === "hidden") {
        if (cur.hiddenAt == null) {
          const next = { ...cur, hiddenAt: Date.now() };
          setPersisted(next); writeState(next);
        }
      } else if (document.visibilityState === "visible") {
        if (cur.hiddenAt != null) {
          const next = { pausedMs: cur.pausedMs + Math.max(0, Date.now() - cur.hiddenAt), hiddenAt: null };
          setPersisted(next); writeState(next);
        }
      }
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      // Treat unmount as hidden — accumulate on next mount.
      const cur = persistedRef.current;
      if (cur.hiddenAt == null) writeState({ ...cur, hiddenAt: Date.now() });
    };
  }, [isActive, writeState]);

  const elapsedSeconds = (() => {
    if (!startedAt) return null;
    const start = new Date(startedAt).getTime();
    if (!Number.isFinite(start)) return null;
    const end = completedAt ? new Date(completedAt).getTime() : now;
    const liveHidden = persisted.hiddenAt != null && !completedAt
      ? Math.max(0, end - persisted.hiddenAt)
      : 0;
    const ms = end - start - persisted.pausedMs - liveHidden;
    return Math.max(0, Math.floor(ms / 1000));
  })();

  const resetTimer = () => {
    if (!startedAt || completedAt) return;
    const start = new Date(startedAt).getTime();
    if (!Number.isFinite(start)) return;
    // Set pausedMs so the displayed elapsed becomes 0, keep startedAt intact.
    const next: Persisted = { pausedMs: Math.max(0, Date.now() - start), hiddenAt: null };
    setPersisted(next); writeState(next);
    setNow(Date.now());
  };

  const fmt = (s: number) => {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    const mm = String(m).padStart(2, "0");
    const ss = String(sec).padStart(2, "0");
    return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
  };

  const exercisesComplete = exercisesTotal > 0 && exercisesDone >= exercisesTotal;
  const setsComplete = setsTotal > 0 && setsDone >= setsTotal;

  return (
    <div
      className={cn(
        "sticky top-0 z-30 -mx-4 border-b border-border bg-background/95 px-4 py-2 backdrop-blur md:-mx-8 md:px-8",
        className,
      )}
      role="status"
      aria-live="polite"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3 text-sm">
        <div className="min-w-0 flex-1 truncate font-bold tracking-tight">
          {title}
        </div>
        <Stat
          icon={<Dumbbell className="h-3.5 w-3.5" />}
          label="Exercises"
          value={`${exercisesDone}/${exercisesTotal}`}
          done={exercisesComplete}
        />
        <Stat
          icon={<ListChecks className="h-3.5 w-3.5" />}
          label="Sets"
          value={`${setsDone}/${setsTotal}`}
          done={setsComplete}
        />
        {elapsedSeconds !== null && (
          <div className="flex shrink-0 items-center gap-1">
            <div
              className={cn(
                "flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-black tabular-nums",
                completedAt
                  ? "bg-emerald-500/10 text-emerald-500"
                  : "bg-primary/10 text-primary",
              )}
              aria-label={`Elapsed ${fmt(elapsedSeconds)}`}
            >
              <Clock className="h-3.5 w-3.5" />
              {fmt(elapsedSeconds)}
            </div>
            {!completedAt && (
              <button
                type="button"
                onClick={resetTimer}
                className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                aria-label="Reset timer"
                title="Reset timer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function Stat({
  icon,
  label,
  value,
  done,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  done: boolean;
}) {
  return (
    <div
      className={cn(
        "hidden shrink-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold tabular-nums sm:flex",
        done ? "bg-emerald-500/10 text-emerald-500" : "bg-secondary text-foreground",
      )}
      aria-label={`${label} ${value}`}
    >
      <span className="opacity-70">{icon}</span>
      <span>{value}</span>
      <span className="hidden text-[10px] font-semibold uppercase tracking-wider opacity-60 md:inline">
        {label}
      </span>
    </div>
  );
}