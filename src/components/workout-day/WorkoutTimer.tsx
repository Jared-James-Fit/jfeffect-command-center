import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Read the cumulative paused-while-hidden duration (in ms) the WorkoutTimer
 * has persisted for a given workout session. Includes any currently-open
 * hidden interval up to `endsAt` (defaults to now), so callers compute the
 * same "active app time" the live timer badge displays.
 *
 * Used by the post-workout summary so the "Duration" stat reflects time the
 * client actually had the workout open — not wall-clock — and pauses
 * whenever the tab is hidden or the app is backgrounded.
 */
export function readWorkoutPausedMs(
  startedAt: string | Date | null | undefined,
  endsAt: number = Date.now(),
): number {
  if (!startedAt || typeof window === "undefined") return 0;
  const startKey = typeof startedAt === "string" ? startedAt : new Date(startedAt).toISOString();
  try {
    const raw = window.localStorage.getItem(`wsb-pause:${startKey}`);
    if (!raw) return 0;
    const parsed = JSON.parse(raw);
    const pausedMs = Number(parsed?.pausedMs) || 0;
    const hiddenAt = parsed?.hiddenAt != null ? Number(parsed.hiddenAt) : null;
    const live = hiddenAt != null ? Math.max(0, endsAt - hiddenAt) : 0;
    return Math.max(0, pausedMs + live);
  } catch {
    return 0;
  }
}

/**
 * Active duration in minutes between `startedAt` and `endsAt` (defaults to
 * now), excluding any paused-while-hidden time tracked by WorkoutTimer.
 * Returns null when no valid start timestamp is available.
 */
export function computeActiveDurationMin(
  startedAt: string | Date | null | undefined,
  endsAt?: string | Date | null,
): number | null {
  if (!startedAt) return null;
  const start = new Date(startedAt).getTime();
  if (!Number.isFinite(start)) return null;
  const end = endsAt ? new Date(endsAt).getTime() : Date.now();
  if (!Number.isFinite(end) || end < start) return null;
  const wallMs = Math.max(0, end - start);
  const paused = readWorkoutPausedMs(startedAt, end);
  // Only trust the paused-while-hidden tracker when it stayed under the full
  // wall-clock window. The Page Visibility API is unreliable in PWAs (iOS
  // Safari, backgrounded standalone apps, page reloads mid-session), so a
  // paused value that swallows most/all of the session almost always means
  // the tracker missed a "visible" event and we should fall back to wall
  // clock — otherwise the summary reports "1 min" for a real hour-long
  // workout. We keep the subtraction only when the paused window is a
  // sensible fraction (<75%) of wall time.
  const trustedPause = paused > 0 && paused < wallMs * 0.75 ? paused : 0;
  const activeMs = Math.max(0, wallMs - trustedPause);
  return Math.max(1, Math.round(activeMs / 60000));
}

/**
 * Standalone workout elapsed-time badge with pause-on-hidden and reset.
 */
export function WorkoutTimer({
  startedAt,
  completedAt,
  className,
}: {
  startedAt?: string | null;
  completedAt?: string | null;
  className?: string;
}) {
  const [now, setNow] = useState(() => Date.now());

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
  useEffect(() => { setPersisted(readState()); }, [readState]);

  const isActive = !!startedAt && !completedAt;

  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isActive]);

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

  if (elapsedSeconds === null) return null;

  return (
    <div className={cn("flex shrink-0 items-center gap-1", className)}>
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
  );
}
