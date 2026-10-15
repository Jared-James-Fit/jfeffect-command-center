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

/**
 * The saved session itself (sync, no network): who is signed in and when the
 * access token runs out. For decisions that must not wait on Supabase (the
 * first frame, a tab switch); anything that matters is still checked by the
 * server.
 */
export type StoredSession = { userId: string; expiresAt: number | null };

export function readStoredSession(): StoredSession | null {
  if (typeof window === "undefined") return null;
  try {
    const ls = window.localStorage;
    let key: string | null = null;
    for (let i = 0; i < ls.length; i++) {
      const k = ls.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        key = k;
        break;
      }
    }
    const raw = key ? ls.getItem(key) : null;
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const userId = parsed?.user?.id;
    if (typeof userId !== "string" || !userId) return null;
    const exp = Number(parsed?.expires_at);
    return { userId, expiresAt: Number.isFinite(exp) && exp > 0 ? exp * 1000 : null };
  } catch {
    return null;
  }
}
