import { useEffect, useRef } from "react";
import { useServerFn } from "@tanstack/react-start";
import { updateWorkoutActivity } from "@/lib/workout-completion.functions";

/**
 * Tracks user activity during an in-progress workout so the eventual
 * `active_duration_seconds` reflects real engaged time — not just wall
 * clock from start to finish.
 *
 * Persists a rolling list of activity ISO timestamps in localStorage
 * keyed by completion id, so a refresh mid-workout doesn't lose the
 * heartbeats already accumulated. A best-effort server ping keeps
 * `pl_day_completions.last_activity_at` fresh for coach visibility.
 */

const MAX_TIMESTAMPS = 600; // ~5h at one per ~30s; bounded so localStorage stays small
const PING_INTERVAL_MS = 60 * 1000;
const COALESCE_MS = 20 * 1000;

function storageKey(completionId: string) {
  return `pl-heartbeats:${completionId}`;
}

function readStored(completionId: string): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(completionId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((s) => typeof s === "string") : [];
  } catch { return []; }
}

function writeStored(completionId: string, timestamps: string[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = timestamps.slice(-MAX_TIMESTAMPS);
    window.localStorage.setItem(storageKey(completionId), JSON.stringify(trimmed));
  } catch { /* quota / private mode — non-fatal */ }
}

export function readHeartbeatTimestamps(completionId: string | null | undefined): string[] {
  if (!completionId) return [];
  return readStored(completionId);
}

export function clearHeartbeatTimestamps(completionId: string | null | undefined) {
  if (!completionId || typeof window === "undefined") return;
  try { window.localStorage.removeItem(storageKey(completionId)); } catch { /* ignore */ }
}

type Opts =
  | { enabled: false }
  | {
      enabled: true;
      completionId: string;
      // Server-ping context — mirrors workout-completion.functions Ctx shape.
      ping:
        | { kind: "client"; dayId: string; scheduledWorkoutId?: string | null }
        | { kind: "member"; enrollmentId: string; weekIndex: number; dayIndex: number };
    };

export function useWorkoutHeartbeat(opts: Opts) {
  const pingFn = useServerFn(updateWorkoutActivity);
  const lastPushRef = useRef<number>(0);
  const lastServerPingRef = useRef<number>(0);
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Public push API — coalesces rapid calls so a flurry of input events
  // doesn't bloat localStorage.
  const push = (now = Date.now()) => {
    const o = optsRef.current;
    if (!o.enabled) return;
    if (now - lastPushRef.current < COALESCE_MS) return;
    lastPushRef.current = now;
    const iso = new Date(now).toISOString();
    const existing = readStored(o.completionId);
    existing.push(iso);
    writeStored(o.completionId, existing);
    // Best-effort server heartbeat (throttled to once per minute).
    if (now - lastServerPingRef.current >= PING_INTERVAL_MS) {
      lastServerPingRef.current = now;
      void pingFn({ data: o.ping as any }).catch(() => { /* non-fatal */ });
    }
  };

  useEffect(() => {
    if (!opts.enabled) return;
    // Initial heartbeat marks "user is here right now".
    push();

    const onVis = () => { if (document.visibilityState === "visible") push(); };
    const onFocus = () => push();
    const onInput = () => push();

    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("focus", onFocus);
    window.addEventListener("pointerdown", onInput, { passive: true });
    window.addEventListener("keydown", onInput);

    // Periodic ping while visible so an idle-but-active session still
    // accrues activity timestamps within the inactivity window.
    const interval = window.setInterval(() => {
      if (document.visibilityState === "visible") push();
    }, PING_INTERVAL_MS);

    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("pointerdown", onInput);
      window.removeEventListener("keydown", onInput);
      window.clearInterval(interval);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [opts.enabled, opts.enabled && (opts as any).completionId]);

  return { push };
}