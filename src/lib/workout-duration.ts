/**
 * Shared workout duration math.
 *
 * Two values are tracked per workout:
 *   - elapsed: started_at → completed_at, real wall-clock.
 *   - active : sum of contiguous activity windows where the user wasn't
 *              idle for longer than `INACTIVITY_THRESHOLD_SECONDS`.
 *
 * The active calculation is intentionally simple and deterministic. The
 * live UI only needs to surface activity heartbeats (`last_activity_at`);
 * the final stored value is computed once on completion so historical
 * summaries don't drift.
 *
 * Overnight clamp: if elapsed exceeds 12h we treat it as a forgotten
 * session and clamp to 4h so analytics aren't poisoned.
 */

export const INACTIVITY_THRESHOLD_SECONDS = 5 * 60;        // 5 min
export const ELAPSED_CLAMP_SECONDS = 12 * 60 * 60;         // 12 h
export const ELAPSED_CLAMP_FALLBACK_SECONDS = 4 * 60 * 60; // 4 h

/** Elapsed wall-clock between two ISO timestamps, with overnight clamp. */
export function computeElapsedSeconds(
  startedAt: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
): number | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  const seconds = Math.round((end - start) / 1000);
  if (seconds > ELAPSED_CLAMP_SECONDS) return ELAPSED_CLAMP_FALLBACK_SECONDS;
  return seconds;
}

/**
 * Active duration from a sorted-or-unsorted list of activity heartbeats
 * (any timestamp that proves the user was using the app — set save,
 * timer tick, page focus, etc.). Gaps larger than the inactivity
 * threshold are excluded.
 */
export function computeActiveSeconds(
  startedAt: string | Date | null | undefined,
  completedAt: string | Date | null | undefined,
  activityTimestamps: ReadonlyArray<string | Date> = [],
): number | null {
  if (!startedAt || !completedAt) return null;
  const start = new Date(startedAt).getTime();
  const end = new Date(completedAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;

  const ms = (v: string | Date) => new Date(v).getTime();
  const points = [
    start,
    ...activityTimestamps.map(ms).filter((n) => Number.isFinite(n) && n >= start && n <= end),
    end,
  ].sort((a, b) => a - b);

  let active = 0;
  for (let i = 1; i < points.length; i++) {
    const gap = (points[i] - points[i - 1]) / 1000;
    if (gap <= INACTIVITY_THRESHOLD_SECONDS) active += gap;
    else active += INACTIVITY_THRESHOLD_SECONDS; // credit one threshold per gap
  }
  return Math.round(active);
}

/** Human format: "42 min", "1 hr 8 min", "—" for null/0. */
export function formatDurationSeconds(seconds: number | null | undefined): string {
  if (!seconds || !Number.isFinite(seconds) || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.round((total % 3600) / 60);
  if (h === 0) return `${Math.max(1, m)} min`;
  if (m === 0) return `${h} hr`;
  return `${h} hr ${m} min`;
}

/** Convenience for the active-workout UI: minutes elapsed since start. */
export function minutesSince(startedAt: string | Date | null | undefined, now: Date = new Date()): number {
  if (!startedAt) return 0;
  const t = new Date(startedAt).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.round((now.getTime() - t) / 60000));
}