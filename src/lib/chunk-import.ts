import { holdChunkRecovery, isChunkLoadError } from "@/lib/chunk-recovery";

const RETRY_DELAY_MS = 350;

/**
 * Run a dynamic import with one quiet retry.
 *
 * A first failure is usually a flaky connection. A failure that survives the
 * retry on a live site almost always means the running bundle is older than the
 * deployed chunks (their hashed filenames are gone), so `onStale` lets the app
 * offer an update. Non-chunk errors (a module that throws while evaluating) are
 * rethrown untouched. Automatic page reloads are paused for the duration so the
 * user is never bounced to a reload screen mid-task.
 */
export async function importWithRetry<T>(
  factory: () => Promise<T>,
  onStale?: () => void,
  delayMs: number = RETRY_DELAY_MS,
): Promise<T> {
  const release = holdChunkRecovery();
  try {
    try {
      return await factory();
    } catch (first) {
      if (!isChunkLoadError(first)) throw first;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      try {
        return await factory();
      } catch (second) {
        if (isChunkLoadError(second)) onStale?.();
        throw second;
      }
    }
  } finally {
    release();
  }
}
