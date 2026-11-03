/**
 * The human-readable reason behind anything that was thrown or returned as an
 * error. Supabase/PostgREST failures are plain `{ message, code, ... }` objects,
 * NOT `Error` instances, so `e instanceof Error && e.message` silently drops
 * their reason — which is how a missing database column turned into a bare
 * "Couldn't load exercises." with nothing to diagnose from.
 */
export function errorMessage(e: unknown): string | null {
  let msg: unknown = null;
  if (typeof e === "string") msg = e;
  else if (e && typeof e === "object" && "message" in e) msg = (e as { message?: unknown }).message;
  if (typeof msg !== "string") return null;
  const trimmed = msg.trim();
  return trimmed ? trimmed : null;
}
