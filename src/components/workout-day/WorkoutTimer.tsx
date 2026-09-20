import { useCallback, useEffect, useRef, useState } from "react";
import { Clock, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Workout wall-clock.
 *
 * Rules:
 * - starts on the first meaningful workout logging action
 * - keeps counting while navigating anywhere else inside the app
 * - keeps counting while the phone is locked or another app is in front
 * - does NOT depend on setInterval ticks for elapsed time
 * - stops only when this app/page runtime actually ends (close/force-quit)
 * - an unfinished workout can resume later without counting closed-app time
 *
 * We cannot receive a reliable "the OS killed me" callback after the process
 * is gone. Instead, we persist a background/close candidate when the page/app
 * hides. If the same JS runtime returns, that candidate is cleared and the
 * entire background gap counts. If a new runtime launches, the unresolved
 * candidate is the cutoff for the prior segment. That distinguishes normal
 * app switching from a real close as accurately as the platform allows.
 */

const SESSION_PREFIX = "wsession:";
const ACTIVE_DAY_KEY = "workout-active-day";

/**
 * In-memory runtime id. It survives SPA navigation and app backgrounding, but
 * necessarily changes on a true page/PWA process relaunch. This is deliberately
 * NOT sessionStorage: some mobile browsers restore sessionStorage after a
 * standalone PWA has been killed, which made close detection unreliable.
 */
const PAGE_RUNTIME_ID =
  typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : `runtime-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export type WorkoutSession = {
  /** Start of the current live runtime segment. */
  startedAt: number;
  /** Accumulated time from prior runtime segments. */
  carriedMs: number;
  runtimeId: string;
  /** Latest instant this runtime was known alive. */
  lastSeenAt: number;
  /**
   * Set when app/page becomes hidden or pagehide fires. It is only a candidate
   * stop time. Returning in the same runtime clears it and the full gap counts.
   */
  backgroundedAt: number | null;
  /** Set after a later runtime proves the previous runtime ended. */
  stoppedAt: number | null;

  // Legacy fields retained only so old stored sessions migrate safely.
  pausedMs?: number;
  pausedAt?: number | null;
};

function key(dayId: string) {
  return `${SESSION_PREFIX}${dayId}`;
}

function writeRaw(dayId: string, session: WorkoutSession) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key(dayId), JSON.stringify(session));
  } catch {
    // Storage failure should never block workout logging.
  }
}

function parseStored(raw: string): WorkoutSession | null {
  try {
    const p = JSON.parse(raw);
    const startedAt = Number(p?.startedAt);
    if (!Number.isFinite(startedAt) || startedAt <= 0) return null;

    return {
      startedAt,
      carriedMs: Math.max(0, Number(p?.carriedMs) || 0),
      runtimeId: typeof p?.runtimeId === "string" ? p.runtimeId : "",
      lastSeenAt: Number.isFinite(Number(p?.lastSeenAt))
        ? Number(p.lastSeenAt)
        : startedAt,
      backgroundedAt:
        p?.backgroundedAt != null && Number.isFinite(Number(p.backgroundedAt))
          ? Number(p.backgroundedAt)
          : null,
      stoppedAt:
        p?.stoppedAt != null && Number.isFinite(Number(p.stoppedAt))
          ? Number(p.stoppedAt)
          : null,
      pausedMs: Math.max(0, Number(p?.pausedMs) || 0),
      pausedAt:
        p?.pausedAt != null && Number.isFinite(Number(p.pausedAt))
          ? Number(p.pausedAt)
          : null,
    };
  } catch {
    return null;
  }
}

function segmentElapsedMs(session: WorkoutSession, end: number): number {
  // Migrate any old manually-paused duration without retaining pause behavior.
  const legacyPausedMs = Math.max(0, Number(session.pausedMs) || 0);
  let legacyOpenPauseMs = 0;
  if (session.pausedAt != null) {
    legacyOpenPauseMs = Math.max(0, end - Number(session.pausedAt));
  }
  return Math.max(0, end - session.startedAt - legacyPausedMs - legacyOpenPauseMs);
}

function normalizeForCurrentRuntime(
  dayId: string,
  session: WorkoutSession,
  now = Date.now(),
): WorkoutSession {
  // Old format: adopt into this runtime without losing elapsed time.
  if (!session.runtimeId) {
    const adopted: WorkoutSession = {
      ...session,
      runtimeId: PAGE_RUNTIME_ID,
      lastSeenAt: now,
      backgroundedAt: null,
      stoppedAt: null,
    };
    writeRaw(dayId, adopted);
    return adopted;
  }

  if (session.runtimeId === PAGE_RUNTIME_ID) return session;

  // A new JS runtime proves the previous app/page runtime ended. If the old
  // runtime hid before being killed, use that hide instant as the cutoff.
  // Otherwise use its latest heartbeat.
  if (session.stoppedAt == null) {
    const cutoffCandidate =
      session.backgroundedAt ??
      session.lastSeenAt ??
      session.startedAt;
    const cutoff = Math.max(
      session.startedAt,
      Math.min(Number(cutoffCandidate) || session.startedAt, now),
    );
    const frozen: WorkoutSession = {
      startedAt: cutoff,
      carriedMs:
        Math.max(0, session.carriedMs || 0) +
        segmentElapsedMs(session, cutoff),
      runtimeId: PAGE_RUNTIME_ID,
      lastSeenAt: cutoff,
      backgroundedAt: null,
      stoppedAt: cutoff,
      pausedMs: 0,
      pausedAt: null,
    };
    writeRaw(dayId, frozen);
    return frozen;
  }

  // Already frozen by a prior read in this runtime.
  if (session.runtimeId !== PAGE_RUNTIME_ID) {
    const normalized = { ...session, runtimeId: PAGE_RUNTIME_ID };
    writeRaw(dayId, normalized);
    return normalized;
  }
  return session;
}

export function readWorkoutSession(
  dayId: string | null | undefined,
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(key(dayId));
    if (!raw) return null;
    const parsed = parseStored(raw);
    if (!parsed) return null;
    return normalizeForCurrentRuntime(dayId, parsed);
  } catch {
    return null;
  }
}

function setActiveWorkoutDay(dayId: string, at: number) {
  if (typeof window === "undefined") return;
  try {
    const previous = window.localStorage.getItem(ACTIVE_DAY_KEY);
    if (previous && previous !== dayId) {
      stopWorkoutSession(previous, at);
    }
    window.localStorage.setItem(ACTIVE_DAY_KEY, dayId);
  } catch {}
}

/** Start or resume the same unfinished workout. */
export function beginWorkoutSession(
  dayId: string | null | undefined,
  at = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;

  const existing = readWorkoutSession(dayId);
  if (existing) {
    if (existing.stoppedAt != null) {
      const resumed: WorkoutSession = {
        startedAt: at,
        carriedMs: Math.max(0, existing.carriedMs || 0),
        runtimeId: PAGE_RUNTIME_ID,
        lastSeenAt: at,
        backgroundedAt: null,
        stoppedAt: null,
        pausedMs: 0,
        pausedAt: null,
      };
      writeRaw(dayId, resumed);
      setActiveWorkoutDay(dayId, at);
      return resumed;
    }

    const touched: WorkoutSession = {
      ...existing,
      runtimeId: PAGE_RUNTIME_ID,
      lastSeenAt: at,
      // Meaningful foreground activity proves the app returned.
      backgroundedAt: null,
      pausedMs: 0,
      pausedAt: null,
    };
    writeRaw(dayId, touched);
    setActiveWorkoutDay(dayId, at);
    return touched;
  }

  const next: WorkoutSession = {
    startedAt: at,
    carriedMs: 0,
    runtimeId: PAGE_RUNTIME_ID,
    lastSeenAt: at,
    backgroundedAt: null,
    stoppedAt: null,
    pausedMs: 0,
    pausedAt: null,
  };
  writeRaw(dayId, next);
  setActiveWorkoutDay(dayId, at);
  return next;
}

/**
 * Mark a possible close boundary. This does NOT stop the timer. If the same
 * runtime comes back, foregrounding clears the marker and the whole away-time
 * remains part of the workout.
 */
export function markWorkoutSessionBackgrounded(
  dayId: string | null | undefined,
  at = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  const session = readWorkoutSession(dayId);
  if (!session || session.stoppedAt != null) return session;
  const next: WorkoutSession = {
    ...session,
    runtimeId: PAGE_RUNTIME_ID,
    lastSeenAt: at,
    backgroundedAt: at,
  };
  writeRaw(dayId, next);
  return next;
}

/** Same runtime returned: keep counting through the entire background gap. */
export function markWorkoutSessionForegrounded(
  dayId: string | null | undefined,
  at = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  const session = readWorkoutSession(dayId);
  if (!session || session.stoppedAt != null) return session;
  const next: WorkoutSession = {
    ...session,
    runtimeId: PAGE_RUNTIME_ID,
    lastSeenAt: at,
    backgroundedAt: null,
  };
  writeRaw(dayId, next);
  return next;
}

export function touchWorkoutSession(
  dayId: string | null | undefined,
  at = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  const session = readWorkoutSession(dayId);
  if (!session || session.stoppedAt != null) return session;
  const next: WorkoutSession = {
    ...session,
    runtimeId: PAGE_RUNTIME_ID,
    lastSeenAt: at,
  };
  writeRaw(dayId, next);
  return next;
}

export function stopWorkoutSession(
  dayId: string | null | undefined,
  at = Date.now(),
): WorkoutSession | null {
  if (!dayId || typeof window === "undefined") return null;
  const session = readWorkoutSession(dayId);
  if (!session || session.stoppedAt != null) return session;

  const end = Math.max(session.startedAt, at);
  const stopped: WorkoutSession = {
    startedAt: end,
    carriedMs:
      Math.max(0, session.carriedMs || 0) +
      segmentElapsedMs(session, end),
    runtimeId: PAGE_RUNTIME_ID,
    lastSeenAt: end,
    backgroundedAt: null,
    stoppedAt: end,
    pausedMs: 0,
    pausedAt: null,
  };
  writeRaw(dayId, stopped);
  try {
    if (window.localStorage.getItem(ACTIVE_DAY_KEY) === dayId) {
      window.localStorage.removeItem(ACTIVE_DAY_KEY);
    }
  } catch {}
  return stopped;
}

export function touchActiveWorkoutSession(at = Date.now()) {
  if (typeof window === "undefined") return null;
  try {
    const dayId = window.localStorage.getItem(ACTIVE_DAY_KEY);
    return dayId ? touchWorkoutSession(dayId, at) : null;
  } catch {
    return null;
  }
}

export function markActiveWorkoutSessionBackgrounded(at = Date.now()) {
  if (typeof window === "undefined") return null;
  try {
    const dayId = window.localStorage.getItem(ACTIVE_DAY_KEY);
    return dayId ? markWorkoutSessionBackgrounded(dayId, at) : null;
  } catch {
    return null;
  }
}

export function markActiveWorkoutSessionForegrounded(at = Date.now()) {
  if (typeof window === "undefined") return null;
  try {
    const dayId = window.localStorage.getItem(ACTIVE_DAY_KEY);
    return dayId ? markWorkoutSessionForegrounded(dayId, at) : null;
  } catch {
    return null;
  }
}

export function clearWorkoutSession(dayId: string | null | undefined) {
  if (!dayId || typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(key(dayId));
    if (window.localStorage.getItem(ACTIVE_DAY_KEY) === dayId) {
      window.localStorage.removeItem(ACTIVE_DAY_KEY);
    }
  } catch {}
}

export function sessionElapsedMs(
  session: WorkoutSession,
  now = Date.now(),
): number {
  if (session.stoppedAt != null) {
    return Math.max(0, session.carriedMs || 0);
  }
  return Math.max(
    0,
    Math.max(0, session.carriedMs || 0) +
      segmentElapsedMs(session, now),
  );
}

export function sessionDurationSeconds(
  dayId: string | null | undefined,
  endsAt = Date.now(),
): number | null {
  const session = readWorkoutSession(dayId);
  if (!session) return null;
  const ms = sessionElapsedMs(session, endsAt);
  if (ms <= 0) return null;
  return Math.max(1, Math.round(ms / 1000));
}

export function sessionDurationMin(
  dayId: string | null | undefined,
  endsAt = Date.now(),
): number | null {
  const seconds = sessionDurationSeconds(dayId, endsAt);
  return seconds == null ? null : Math.max(1, Math.round(seconds / 60));
}

export function estimateDurationFromLogs(
  firstLogAt: string | Date | null | undefined,
  endsAt = Date.now(),
): number | null {
  if (!firstLogAt) return null;
  const start = new Date(firstLogAt).getTime();
  if (!Number.isFinite(start)) return null;
  const ms = endsAt - start;
  if (ms <= 0) return null;
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
  onSessionChange?: (session: WorkoutSession | null) => void;
}) {
  const [session, setSession] = useState<WorkoutSession | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const notifyRef = useRef(onSessionChange);
  notifyRef.current = onSessionChange;

  const sync = useCallback((next: WorkoutSession | null) => {
    setSession(next);
    notifyRef.current?.(next);
  }, []);

  useEffect(() => {
    sync(readWorkoutSession(dayId));
  }, [dayId, sync]);

  // setInterval is repaint-only. Elapsed time always comes from timestamps, so
  // iOS/Android throttling timers in the background cannot lose workout time.
  useEffect(() => {
    if (completedAt) return;
    const reread = () => {
      const t = Date.now();
      setNow(t);
      sync(readWorkoutSession(dayId));
    };
    const id = window.setInterval(reread, 1000);
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

  if (completedAt) {
    const saved =
      savedDurationMin != null && savedDurationMin > 0
        ? savedDurationMin
        : null;
    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-xs font-bold tabular-nums",
          saved
            ? "bg-emerald-500/10 text-emerald-500"
            : "text-muted-foreground",
          className,
        )}
      >
        <Clock className="h-3.5 w-3.5" />
        {saved
          ? `Duration · ${formatDurationMin(saved)}`
          : "No session time recorded"}
      </span>
    );
  }

  if (!session) {
    return (
      <span className={cn("inline-flex items-center gap-1.5", className)}>
        <span className="text-xs font-semibold text-muted-foreground">
          Not started
        </span>
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

  const elapsed = Math.floor(sessionElapsedMs(session, now) / 1000);
  const stopped = session.stoppedAt != null;

  return (
    <span className={cn("inline-flex items-center gap-1", className)}>
      <span
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md px-2 py-1 font-mono text-xs font-black tabular-nums",
          stopped
            ? "bg-secondary text-muted-foreground"
            : "bg-primary/10 text-primary",
        )}
        aria-label={`${stopped ? "Stopped" : "Workout session"} ${formatElapsed(elapsed)}`}
      >
        <Clock className="h-3.5 w-3.5" />
        {stopped
          ? `Stopped · ${formatElapsed(elapsed)}`
          : formatElapsed(elapsed)}
      </span>
    </span>
  );
}
