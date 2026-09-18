import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { markClientSignedIn } from "@/lib/activity";
import { logPerf } from "@/lib/perf-timing";
import { clearLastRoute } from "@/lib/route-persistence";

export type AppRole = "admin" | "coach" | "media_manager" | "client" | "member";

// ── Role cache helpers ────────────────────────────────────────────────────────
// Persist the resolved role to localStorage so PWA resume is instant.
// The cache is keyed by user ID and expires after 24 hours.
const ROLE_CACHE_PREFIX = "jf:role:";
const ROLE_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

function readCachedRole(uid: string): AppRole | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(ROLE_CACHE_PREFIX + uid);
    if (!raw) return null;
    const { role, ts } = JSON.parse(raw) as { role: AppRole; ts: number };
    if (Date.now() - ts > ROLE_CACHE_TTL_MS) { localStorage.removeItem(ROLE_CACHE_PREFIX + uid); return null; }
    return role;
  } catch { return null; }
}

function writeCachedRole(uid: string, role: AppRole): void {
  if (typeof window === "undefined") return;
  try { localStorage.setItem(ROLE_CACHE_PREFIX + uid, JSON.stringify({ role, ts: Date.now() })); } catch { /* storage full */ }
}

function clearCachedRole(uid: string): void {
  if (typeof window === "undefined") return;
  try { localStorage.removeItem(ROLE_CACHE_PREFIX + uid); } catch {}
}

function readPersistedSessionTokens(): { access_token: string; refresh_token: string } | null {
  if (typeof window === "undefined") return null;
  try {
    const sessionKey = Object.keys(localStorage).find(
      (key) => key.startsWith("sb-") && key.endsWith("-auth-token"),
    );
    if (!sessionKey) return null;
    const raw = localStorage.getItem(sessionKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const access_token = parsed?.access_token;
    const refresh_token = parsed?.refresh_token;
    return typeof access_token === "string" && typeof refresh_token === "string"
      ? { access_token, refresh_token }
      : null;
  } catch {
    return null;
  }
}

function isRetryableAuthError(error: unknown): boolean {
  const candidate = error as { status?: number; name?: string; message?: string } | null;
  const status = Number(candidate?.status ?? 0);
  const name = String(candidate?.name ?? "");
  const message = String(candidate?.message ?? "");
  return (
    name.includes("Retryable") ||
    status === 429 ||
    status >= 500 ||
    /(failed to fetch|network|timeout|temporar)/i.test(message)
  );
}
// ─────────────────────────────────────────────────────────────────────────────

interface AuthState {
  user: User | null;
  session: Session | null;
  role: AppRole | null;
  loading: boolean;
  signOut: () => Promise<void>;
}

const AuthCtx = createContext<AuthState>({
  user: null,
  session: null,
  role: null,
  loading: true,
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  // Initialize role from localStorage cache for instant PWA resume.
  const [role, setRole] = useState<AppRole | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const sessionKey = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (!sessionKey) return null;
      const raw = localStorage.getItem(sessionKey);
      if (!raw) return null;
      const uid = JSON.parse(raw)?.user?.id;
      return uid ? readCachedRole(uid) : null;
    } catch { return null; }
  });
  // Always keep the auth splash up until Supabase has performed its first
  // session read. Previously a cached role could set loading=false before
  // `user` was restored, briefly showing returning PWA users the login form
  // even though they still had a valid refresh session.
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // Dev-only: log when auth finishes resolving (role known or no session).
  useEffect(() => {
    if (!loading) logPerf("auth resolved");
  }, [loading]);

  const queryClient = useQueryClient();
  const lastUserIdRef = useRef<string | null>(null);
  const roleLoadedForRef = useRef<string | null>(null);
  const lastSessionRef = useRef<Session | null>(null);
  const explicitSignOutRef = useRef(false);
  const sessionRecoveryInFlightRef = useRef(false);
  const sessionRecoveryBlockedRef = useRef(false);

  const clearResolvedAuth = () => {
    setSession(null);
    setUser(null);
    setRole(null);
    roleLoadedForRef.current = null;
    lastUserIdRef.current = null;
    lastSessionRef.current = null;
    setLoading(false);
  };

  const recoverPersistedSession = async (attempt = 0) => {
    if (
      explicitSignOutRef.current ||
      sessionRecoveryInFlightRef.current ||
      sessionRecoveryBlockedRef.current
    ) return;

    const previous = lastSessionRef.current;
    const persisted = readPersistedSessionTokens();
    const tokens = previous?.access_token && previous?.refresh_token
      ? { access_token: previous.access_token, refresh_token: previous.refresh_token }
      : persisted;

    if (!tokens) {
      clearResolvedAuth();
      return;
    }

    const keepWarmUserOnTransientFailure = () => {
      if (!lastSessionRef.current?.user) return false;
      // A suspended iPhone PWA can briefly lose network exactly when its token
      // needs refreshing. Keep the already-validated identity in memory and
      // let the next resume/route check retry instead of showing Login.
      setLoading(false);
      return true;
    };

    const scheduleRetry = (nextAttempt: number) => {
      const delay = 400 * nextAttempt;
      setTimeout(() => void recoverPersistedSession(nextAttempt), delay);
    };

    sessionRecoveryInFlightRef.current = true;
    try {
      const { data, error } = await supabase.auth.setSession(tokens);
      if (error || !data.session?.user) {
        if (error && isRetryableAuthError(error)) {
          if (attempt < 2) {
            scheduleRetry(attempt + 1);
            return;
          }
          if (keepWarmUserOnTransientFailure()) return;
        }

        // A non-retryable auth rejection (revoked/invalid refresh token) is a
        // real logout condition. Never preserve a stale authenticated shell.
        sessionRecoveryBlockedRef.current = true;
        clearResolvedAuth();
        return;
      }

      lastSessionRef.current = data.session;
      lastUserIdRef.current = data.session.user.id;
      setSession(data.session);
      setUser(data.session.user);
      const cached = readCachedRole(data.session.user.id);
      if (cached) setRole((prev) => prev ?? cached);
      setLoading(false);
    } catch (err) {
      if (isRetryableAuthError(err)) {
        if (attempt < 2) {
          scheduleRetry(attempt + 1);
          return;
        }
        if (keepWarmUserOnTransientFailure()) return;
      }

      console.warn("[auth] persisted session recovery failed", err);
      sessionRecoveryBlockedRef.current = true;
      clearResolvedAuth();
    } finally {
      sessionRecoveryInFlightRef.current = false;
    }
  };

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      const newUid = sess?.user?.id ?? null;
      const prevUid = lastUserIdRef.current;
      const identityChanged = newUid !== prevUid;

      if (!sess) {
        // Explicit logout should be immediate. A spontaneous SIGNED_OUT /
        // transient INITIAL_SESSION null on iOS PWA resume gets one bounded
        // recovery attempt from the persisted refresh session instead of
        // throwing the user back to Login.
        const canAttemptRecovery =
          !explicitSignOutRef.current &&
          !sessionRecoveryBlockedRef.current &&
          !!(lastSessionRef.current?.refresh_token || readPersistedSessionTokens());

        if (canAttemptRecovery) {
          setLoading(true);
          setTimeout(() => void recoverPersistedSession(), 0);
          return;
        }

        clearResolvedAuth();
      } else {
        sessionRecoveryBlockedRef.current = false;
        lastSessionRef.current = sess;
        setSession(sess);
        setUser(sess.user);

        if (identityChanged) {
          // Real user change (sign-in, account switch). A cached role can make
          // session restoration instant, but never expose the login form before
          // the user object itself has been restored.
          const cached = newUid ? readCachedRole(newUid) : null;
          if (cached) {
            setRole((prev) => prev ?? cached);
            setLoading(false);
          } else {
            setLoading(true);
          }
        }
        // For TOKEN_REFRESHED / USER_UPDATED with the SAME user id, do NOT
        // toggle loading — the role is already resolved.
        lastUserIdRef.current = newUid;
      }

      if (sess && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        void markClientSignedIn();
      }
      // Only invalidate caches on a real identity change.
      if (identityChanged && (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED")) {
        router.invalidate();
        queryClient.invalidateQueries();
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      const restoredUid = data.session?.user?.id ?? null;
      if (!data.session) {
        if (readPersistedSessionTokens()) {
          setLoading(true);
          void recoverPersistedSession();
        } else {
          clearResolvedAuth();
        }
        return;
      }

      lastSessionRef.current = data.session;
      setSession(data.session);
      setUser(data.session.user);
      lastUserIdRef.current = restoredUid;
      sessionRecoveryBlockedRef.current = false;

      const cached = restoredUid ? readCachedRole(restoredUid) : null;
      if (cached) {
        setRole((prev) => prev ?? cached);
        // Session + cached role are now both known. Let the role effect
        // revalidate in the background without blocking the dashboard.
        setLoading(false);
      }
      void markClientSignedIn();
    }).catch(() => {
      // A transient getSession exception on PWA resume should try the persisted
      // refresh session once before exposing the Login screen.
      if (readPersistedSessionTokens()) {
        setLoading(true);
        void recoverPersistedSession();
      } else {
        clearResolvedAuth();
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  useEffect(() => {
    const uid = user?.id ?? null;
    if (!uid) {
      setLoading(false);
      return;
    }
    // Don't re-fetch the role for the same user across token refreshes.
    if (roleLoadedForRef.current === uid) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    const ROLE_QUERY_TIMEOUT_MS = 2500;

    const withTimeout = async <T,>(promise: PromiseLike<T>): Promise<T | null> => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          promise,
          new Promise<null>((resolve) => {
            timer = setTimeout(() => resolve(null), ROLE_QUERY_TIMEOUT_MS);
          }),
        ]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };

    const commitRole = (resolvedRole: AppRole) => {
      if (cancelled) return;
      setRole(resolvedRole);
      roleLoadedForRef.current = uid;
      writeCachedRole(uid, resolvedRole);
      setLoading(false);

      // Warm the client record cache so the dashboard doesn't waterfall.
      if (resolvedRole === "client") {
        queryClient.prefetchQuery({
          queryKey: ["my-client", uid],
          queryFn: async () => {
            const { data } = await supabase
              .from("clients")
              .select("*")
              .eq("user_id", uid)
              .maybeSingle();
            return data;
          },
          staleTime: 30_000,
        });
      }
    };

    const fetchRole = async (attempt = 0): Promise<void> => {
      try {
        // Resolve explicit app roles FIRST. Almost every coaching user has a
        // user_roles row, so login should not wait on unrelated membership and
        // client-table queries before routing.
        const roleResult = await withTimeout(
          supabase.from("user_roles").select("role").eq("user_id", uid),
        );
        if (cancelled) return;
        if (!roleResult) throw new Error("role_lookup_timeout");
        if (roleResult.error) throw roleResult.error;

        const roles = (roleResult.data ?? []).map((r: any) => r.role as AppRole);
        const explicitRole: AppRole | null =
          roles.includes("admin") ? "admin"
          : roles.includes("coach") ? "coach"
          : roles.includes("media_manager") ? "media_manager"
          : roles.includes("client") ? "client"
          : null;

        if (explicitRole) {
          commitRole(explicitRole);
          return;
        }

        // Only accounts without an explicit role need the membership/client
        // fallback. Keep this bounded too so a single slow RLS query can never
        // strand the login splash.
        const fallback = await withTimeout(Promise.all([
          supabase.from("app_members").select("id").eq("user_id", uid).maybeSingle(),
          supabase.from("clients").select("id").eq("user_id", uid).maybeSingle(),
        ]));
        if (cancelled) return;
        if (!fallback) throw new Error("account_kind_lookup_timeout");

        const [
          { data: memberRow, error: memberErr },
          { data: clientRow, error: clientErr },
        ] = fallback;

        if (memberErr && clientErr) throw memberErr;

        const resolvedRole: AppRole =
          memberRow && !clientRow ? "member"
          : clientRow ? "client"
          : memberRow ? "member"
          : "client";

        commitRole(resolvedRole);
      } catch (err) {
        if (cancelled) return;

        // A known cached role is always safer than guessing and lets returning
        // users through immediately during a transient DB slowdown.
        const cached = readCachedRole(uid);
        if (cached) {
          commitRole(cached);
          return;
        }

        // Retry every bounded lookup instead of leaving an unresolved promise
        // running forever in the background.
        if (attempt < 3) {
          const delay = 350 * Math.pow(2, attempt);
          setTimeout(() => {
            if (!cancelled) void fetchRole(attempt + 1);
          }, delay);
          return;
        }

        // Last-resort classification for uncached users: independently check
        // the self-readable client/member rows. This avoids defaulting an
        // admin/coach to client just because user_roles was temporarily slow.
        try {
          const clientResult = await withTimeout(
            supabase.from("clients").select("id").eq("user_id", uid).maybeSingle(),
          );
          if (cancelled) return;
          if (clientResult && !clientResult.error && clientResult.data) {
            commitRole("client");
            return;
          }

          const memberResult = await withTimeout(
            supabase.from("app_members").select("id").eq("user_id", uid).maybeSingle(),
          );
          if (cancelled) return;
          if (memberResult && !memberResult.error && memberResult.data) {
            commitRole("member");
            return;
          }
        } catch {
          // Fall through to the explicit retry state below.
        }

        console.error("[auth] role load failed after bounded retries", err);
        // Keep the authenticated session, but never leave the app in an
        // endless splash. /auth renders a clear retry/sign-out state when
        // user exists and role is still null.
        setLoading(false);
      }
    };
    void fetchRole();
    return () => { cancelled = true; };
  }, [user?.id]);

  const signOut = async () => {
    // Capture the user id before clearing state.
    const uid = user?.id ?? null;
    explicitSignOutRef.current = true;
    sessionRecoveryBlockedRef.current = true;
    lastSessionRef.current = null;

    // Stop in-flight queries before clearing the session so they don't 401.
    try { await queryClient.cancelQueries(); } catch { /* best-effort */ }
    queryClient.clear();
    // Wipe persisted RQ cache so the next signed-in user on this device
    // never sees the previous user's cached dashboard data.
    try {
      const { clearPersistedQueryCache } = await import("@/lib/query-persister");
      clearPersistedQueryCache();
    } catch { /* best-effort */ }

    try {
      await supabase.auth.signOut();
    } finally {
      clearResolvedAuth();
      if (uid) clearCachedRole(uid); // clear role cache on explicit sign-out
      explicitSignOutRef.current = false;
    }

    // Remove the persisted last-route so the next user on this device
    // never lands in a previous user's workout or profile.
    if (uid) clearLastRoute(uid);
    // Clear app-shell caches and offline drafts so the next signed-in user
    // never sees the previous user's cached data.
    try {
      const { clearAllAppCaches } = await import("@/lib/pwa/register-sw");
      await clearAllAppCaches();
    } catch { /* best-effort */ }
  };

  return (
    <AuthCtx.Provider value={{ user, session, role, loading, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);