/** Retry an async operation with exponential backoff for transient errors. */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    retries?: number;
    baseDelayMs?: number;
    maxDelayMs?: number;
    /** Return false to abort retrying (e.g. permanent error). */
    shouldRetry?: (err: unknown, attempt: number) => boolean;
    onRetry?: (err: unknown, attempt: number) => void;
  } = {}
): Promise<T> {
  const { retries = 2, baseDelayMs = 600, maxDelayMs = 4000, shouldRetry, onRetry } = opts;
  let attempt = 0;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= retries) throw err;
      if (shouldRetry && !shouldRetry(err, attempt)) throw err;
      onRetry?.(err, attempt);
      const delay = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt)) + Math.random() * 200;
      await new Promise((r) => setTimeout(r, delay));
      attempt++;
    }
  }
}

/** Best-effort detection of transient network errors that are safe to retry. */
export function isTransientError(err: unknown): boolean {
  const msg = (err as { message?: string })?.message?.toLowerCase() ?? "";
  if (!msg) return true;
  if (msg.includes("network") || msg.includes("fetch") || msg.includes("timeout")) return true;
  if (msg.includes("failed to fetch") || msg.includes("load failed")) return true;
  if (/\b5\d\d\b/.test(msg)) return true; // 5xx
  if (msg.includes("429")) return true;
  return false;
}