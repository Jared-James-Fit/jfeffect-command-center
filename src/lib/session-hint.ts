/**
 * Synchronous, network-free hint: does this browser hold a saved Supabase
 * session? Lets routes send a genuine first-time / signed-out visitor straight
 * to sign-in without waiting for the app shell to hydrate and auth to resolve.
 *
 * Only a hint — a stale token still goes through the normal auth flow.
 */
export function hasPersistedAuthSession(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return Object.keys(window.localStorage).some(
      (key) =>
        key.startsWith("sb-") &&
        key.endsWith("-auth-token") &&
        !!window.localStorage.getItem(key),
    );
  } catch {
    // Storage blocked (private mode, etc.): treat as "unknown" so the normal
    // auth flow decides instead of bouncing someone who might be signed in.
    return true;
  }
}
