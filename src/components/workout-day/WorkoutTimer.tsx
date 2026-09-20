import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Pause, Play, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Workout Session timer.
 *
 * ROOT CAUSE of the old "0:00" bug: the previous implementation derived
 * elapsed time from the server `started_at` minus a "paused while hidden"
 * accumulator. On unmount it wrote `hiddenAt = now` and only cleared it on a
 * `visibilitychange -> visible` event — which never fires when the page is
 * remounted already-visible. The open hidden interval therefore grew forever
 * and swallowed the whole session, clamping the badge to 0:00. Completed
 * workouts hit the same wall whenever `started_at ≈ completed_at` (the
 * mount-time auto-start raced the Finish tap).
 *
 * The model is now an explicit, timestamp-based session persisted in
 * localStorage per dayId:
 *   { startedAt, pausedMs, pausedAt }
 * Elapsed time is always computed from stored timestamps, so it survives
 * refreshes, backgrounding and navigation. A JS interval only drives repaints.
 *
 * This is the total workout-session clock. Rest timers are a separate,
 * untouched mechanism (RestTimerButton / DurationTimerInCard).
 */

const SESSION_PREFIX = "wsession:";
const RUNTIME_KEY = "workout-runtime-id";
/** Sessions running longer than this are treated as abandoned, not real. */
export const MAX_SESSION_MS = 6 * 60 * 60 * 1000;

export type WorkoutSession = {
  /** Start of the currently-active app-runtime segment. */
  startedAt: number;
  /** Manual pause time inside the current segment (legacy-compatible). */
  pausedMs: number;
  /** Non-null while manually paused. */
  pausedAt: number | null;
  /** Time accumulated across earlier app-runtime segments. */
  carriedMs?: number;
  /** sessionStorage-scoped id: survives navigation/backgrounding, resets on full close. */
  runtimeId?: string;
  /** Last instant we know this app runtime was alive. */
  lastSeenAt?: number;
  /** Non-null when a prior runtime ended and the timer is waiting to resume. */
  stoppedAt?: number | null;
};

function key(dayId: string) { return `${SESSION_PREFIX}${dayId}`; }

function runtimeId(): string {
  if (typeof window === "undefined") return "ssr";
  try {
    const existing = window.sessionStorage.getItem(RUNTIME_KEY);
    if (existing) return existing;
    const next =
      typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
        ? crypto.randomUUID()
        : `rt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    window.sessionStorage.setItem(RUNTIME_KEY, next);
    return next;
  } catch {
    // sessionStorage can be unavailable in restrictive/private modes. A
    // per-page fallback still keeps wall-clock math correct while mounted.
    return "runtime-unavailable";
  }
}

function writeWorkoutSessionRaw(dayId: string, s: WorkoutSession) {
  if (typeof window === "undefined") return;
  try { window.localStorage.setItem(key(dayId), JSON.stringify(s)); } catch { /* quota */ }
}

function normalizeForRuntime(
  dayId: string,
  s: WorkoutSession,
  now: number = Date.now(),
): WorkoutSession {
  const currentRuntime = runtimeId();

  // Older stored sessions did not have runtime metadata. Adopt them into the
  // current app runtime rather than truncating an in-progress workout.
  if (!s.runtimeId) {
    const adopted: WorkoutSession = {
      ...s,
      carriedMs: Math.max(0, Number(s.carriedMs) || 0),
      runtimeId: currentRuntime,
      lastSeenAt: now,
      stoppedAt: null,
    };
    writeWorkoutSessionRaw(dayId, adopted);
    return adopted;
  }

  // A different sessionStorage runtime means the PWA/tab was fully closed and
  // later relaunched. Freeze the old segment at its last known alive instant.
  // App switching/backgrounding does NOT change runtimeId, so that time keeps
  // counting exactly as requested.
  if (s.runtimeId !== currentRuntime && s.stoppedAt == null) {
    const stopAt = Math.max(
      s.startedAt,
      Math.min(Number(s.lastSeenAt) || now, now),
    );
    const segmentEnd = s.pausedAt != null ? Math.min(s.pausedAt, stopAt) : stopAt;
    const segmentMs = Math.max(0, segmentEnd - s.startedAt - Math.max(0, s.pausedMs || 0));
    const stopped: WorkoutSession = {
      startedAt: stopAt,
      pausedMs: 0,
      pausedAt: null,
      carriedMs: Math.max(0, Number(s.carriedMs) || 0) + segmentMs,
      runtimeId: currentRuntime,
      lastSeenAt: stopAt,
      stoppedAt: stopAt,
    };
    writeWorkoutSessionRaw(dayId, stopped);
    return stopped;
  }

  return s;
}

export function readWorkoutSession(dayId: string | null | undefined): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(dayId));
    if (!raw) return null;
    const p = JSON.parse(raw);
    const startedAt = Number(p?.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;
    const parsed: WorkoutSession = {
      startedAt,
      pausedMs: Math.max(0, Number(p?.pausedMs) || 0),
      pausedAt: p?.pausedAt != null && Number.isFinite(Number(p.pausedAt)) ? Number(p.pausedAt) : null,
      carriedMs: Math.max(0, Number(p?.carriedMs) || 0),
      runtimeId: typeof p?.runtimeId === "string" ? p.runtimeId : undefined,
      lastSeenAt: Number.isFinite(Number(p?.lastSeenAt)) ? Number(p.lastSeenAt) : undefined,
      stoppedAt: p?.stoppedAt != null && Number.isFinite(Number(p.stoppedAt)) ? Number(p.stoppedAt) : null,
    };
    return normalizeForRuntime(dayId, parsed);
  } catch { return null; }
}

function writeWorkoutSession(dayId: string, s: WorkoutSession) {
  writeWorkoutSessionRaw(dayId, s);
}

/** Idempotent start — safe to call from every meaningful logging action. */
export function beginWorkoutSession(
  dayId: string | null | undefined,
  at: number = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  const existing = readWorkoutSession(dayId);
  if (existing) {
    // Relaunch after a true app close: resume from the previously accumulated
    // workout time, but do not count the time while the app was closed.
    if (existing.stoppedAt != null) {
      const resumed: WorkoutSession = {
        startedAt: at,
        pausedMs: 0,
        pausedAt: null,
        carriedMs: Math.max(0, Number(existing.carriedMs) || 0),
        runtimeId: runtimeId(),
        lastSeenAt: at,
        stoppedAt: null,
      };
      writeWorkoutSession(dayId, resumed);
      return resumed;
    }
    const touched = {
      ...existing,
      runtimeId: runtimeId(),
      lastSeenAt: at,
    };
    writeWorkoutSession(dayId, touched);
    return touched;
  }
  const next: WorkoutSession = {
    startedAt: at,
    pausedMs: 0,
    pausedAt: null,
    carriedMs: 0,
    runtimeId: runtimeId(),
    lastSeenAt: at,
    stoppedAt: null,
  };
  writeWorkoutSession(dayId, next);
  return next;
}

export function pauseWorkoutSession(dayId: string, at: number = Date.now()): WorkoutSession | null {
  const s = readWorkoutSession(dayId);
  if (!s || s.pausedAt != null || s.stoppedAt != null) return s;
  const next = { ...s, pausedAt: at, lastSeenAt: at, runtimeId: runtimeId() };
  writeWorkoutSession(dayId, next);
  return next;
}

export function resumeWorkoutSession(dayId: string, at: number = Date.now()): WorkoutSession | null {
  const s = readWorkoutSession(dayId);
  if (!s) return s;
  if (s.stoppedAt != null) return beginWorkoutSession(dayId, at);
  if (s.pausedAt == null) return s;
  const next: WorkoutSession = {
    ...s,
    pausedMs: s.pausedMs + Math.max(0, at - s.pausedAt),
    pausedAt: null,
    runtimeId: runtimeId(),
    lastSeenAt: at,
  };
  writeWorkoutSession(dayId, next);
  return next;
}

/** Restart the clock from now (used by the abandoned-session guard). */
export function resetWorkoutSession(dayId: string, at: number = Date.now()): WorkoutSession {
  const next: WorkoutSession = {
    startedAt: at,
    pausedMs: 0,
    pausedAt: null,
    carriedMs: 0,
    runtimeId: runtimeId(),
    lastSeenAt: at,
    stoppedAt: null,
  };
  writeWorkoutSession(dayId, next);
  return next;
}

export function clearWorkoutSession(dayId: string | null | undefined) {
  if (!dayId || typeof window === "undefined") return;
  try { window.localStorage.removeItem(key(dayId)); } catch { /* ignore */ }
}

export function sessionElapsedMs(s: WorkoutSession, now: number = Date.now()): number {
  const end =
    s.stoppedAt != null
      ? s.stoppedAt
      : s.pausedAt != null
        ? s.pausedAt
        : now;
  const segment = Math.max(0, end - s.startedAt - Math.max(0, s.pausedMs || 0));
  return Math.max(0, Math.max(0, Number(s.carriedMs) || 0) + segment);
}

/** Keep the current app runtime's last-alive instant fresh without changing elapsed math. */
export function touchWorkoutSession(
  dayId: string | null | undefined,
  at: number = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  const s = readWorkoutSession(dayId);
  if (!s || s.stoppedAt != null) return s;
  const next: WorkoutSession = {
    ...s,
    runtimeId: runtimeId(),
    lastSeenAt: at,
  };
  writeWorkoutSession(dayId, next);
  return next;
}

/** True when a session has been running implausibly long (app left open). */
export function isSessionAbandoned(s: WorkoutSession, now: number = Date.now()): boolean {
  return sessionElapsedMs(s, now) > MAX_SESSION_MS;
}

/**
 * Duration to persist on completion, in whole minutes.
 * Returns null when nothing trustworthy was captured (never 0).
 */
export function sessionDurationMin(
  dayId: string | null | undefined,
  endsAt: number = Date.now(),
): number | null {
  const s = readWorkoutSession(dayId);
  if (!s) return null;
  const ms = sessionElapsedMs(s, endsAt);
  if (ms <= 0 || ms > MAX_SESSION_MS) return null;
  return Math.max(1, Math.round(ms / 60000));
}

/** Exact elapsed seconds for persistence/analytics. */
export function sessionDurationSeconds(
  dayId: string | null | undefined,
  endsAt: number = Date.now(),
): number | null {
  const s = readWorkoutSession(dayId);
  if (!s) return null;
  const ms = sessionElapsedMs(s, endsAt);
  if (ms <= 0 || ms > MAX_SESSION_MS) return null;
  return Math.max(1, Math.round(ms / 1000));
}

/**
 * Fallback used when the session timer never started: estimate from the
 * first logged action to the completion time. Returns null when unusable.
 */
export function estimateDurationFromLogs(
  firstLogAt: string | Date | null | undefined,
  endsAt: number = Date.now(),
): number | null {
  if (!firstLogAt) return null;
  const start = new Date(firstLogAt).getTime();
  if (!Number.isFinite(start)) return null;
  const ms = endsAt - start;
  if (ms <= 0 || ms > MAX_SESSION_MS) return null;
  return Math.max(1, Math.round(ms / 60000));
}

export function formatElapsed(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

export function formatDurationMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m} min`;
}

/**
 * Live Workout Session badge with Start / Pause / Resume controls.
 * Completed workouts render the saved duration instead.
 */
export function WorkoutTimer({
  dayId,
  completedAt,
  savedDurationMin,
  readonly,
  className,
  onSessionChange,
}: {
  dayId: string;
  completedAt?: string | null;
  savedDurationMin?: number | null;
  readonly?: boolean;
  className?: string;
  onSessionChange?: (s: WorkoutSession | null) => void;
}) {
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const notifyRef = useRef(onSessionChange);
  notifyRef.current = onSessionChange;

  const sync = useCallback((s: WorkoutSession | null) => {
    setSession(s);
    notifyRef.current?.(s);
  }, []);

  // Hydrate from storage (client-only, so SSR renders the neutral state).
  useEffect(() => {
    sync(readWorkoutSession(dayId));
  }, [dayId, sync]);

  // Pick up sessions started elsewhere in the page (auto-start on logging)
  // and re-read after refocus. Elapsed time is timestamp-based, so switching
  // apps or navigating elsewhere in the PWA never pauses the workout.
  useEffect(() => {
    if (completedAt) return;
    // Recompute from stored timestamps on every return path (app switch,
    // phone unlock, PWA reopen, bfcache restore) so elapsed time includes
    // time spent away.
    const reread = () => {
      setNow(Date.now());
      sync(readWorkoutSession(dayId));
    };
    const id = window.setInterval(() => {
      setNow(Date.now());
      reread();
    }, 1000);
    window.addEventListener("focus", reread);
    window.addEventListener("pageshow", reread);
    document.addEventListener("visibilitychange", reread);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", reread);
      window.removeEventListener("pageshow", reread);
      document.removeEventListener("visibilitychange", reread);
    };
  }, [dayId, completedAt, sync]);

  // ── Completed workout: show the stored duration, never a live clock. ──
  if (completedAt) {
    const saved = savedDurationMin != null && savedDurationMin > 0 ? savedDurationMin : null;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold tabular-nums",
          saved ? "bg-emerald-500/10 text-emerald-500" : "text-muted-foreground",
          className,
        )}
      >
        <Clock className="h-3.5 w-3.5" />
        {saved ? `Duration · ${formatDurationMin(saved)}` : "No session time recorded"}
      </span>
    );
  }

  const abandoned = session ? isSessionAbandoned(session, now) : false;

  // ── Abandoned guard: never silently report a 19-hour workout. ──
  if (session && abandoned) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="text-xs font-semibold text-muted-foreground">Workout started earlier</span>
        {!readonly && (
          <button
            type="button"
            onClick={() => sync(resetWorkoutSession(dayId))}
            className="inline-flex h-7 items-center gap-1 rounded-md bg-secondary px-2 text-[11px] font-bold text-foreground"
          >
            <RotateCcw className="h-3 w-3" /> Restart
          </button>
        )}
      </span>
    );
  }

  // ── Not started ──
  if (!session) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="text-xs font-semibold text-muted-foreground">Not started</span>
        {!readonly && (
          <button
            type="button"
            onClick={() => sync(beginWorkoutSession(dayId))}
            className="inline-flex h-7 min-h-[28px] items-center gap-1 rounded-md bg-primary/10 px-2 text-[11px] font-black uppercase tracking-wide text-primary"
            aria-label="Start workout session"
          >
            <Play className="h-3 w-3" /> Start
          </button>
        )}
      </span>
    );
  }

  const stopped = session.stoppedAt != null;
  const paused = session.pausedAt != null;
  const elapsed = Math.floor(sessionElapsedMs(session, now) / 1000);

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-black tabular-nums",
          stopped || paused ? "bg-secondary text-muted-foreground" : "bg-primary/10 text-primary",
        )}
        aria-label={`${stopped ? "Stopped" : paused ? "Paused" : "Workout session"} ${formatElapsed(elapsed)}`}
      >
        <Clock className="h-3.5 w-3.5" />
        {stopped ? `Stopped · ${formatElapsed(elapsed)}` : paused ? `Paused · ${formatElapsed(elapsed)}` : formatElapsed(elapsed)}
      </span>
      {!readonly && !stopped && (
        <button
          type="button"
          onClick={() => sync(paused ? resumeWorkoutSession(dayId) : pauseWorkoutSession(dayId))}
          className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
          aria-label={paused ? "Resume workout session" : "Pause workout session"}
          title={paused ? "Resume" : "Pause"}
        >
          {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
        </button>
      )}
    </span>
  );
}
