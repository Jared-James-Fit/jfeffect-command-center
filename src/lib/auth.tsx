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
  // Start loading=false if we have a cached session+role in localStorage.
  // This makes PWA resume instant — the splash clears immediately and the
  // user lands on their dashboard while the role re-validates in the background.
  const [loading, setLoading] = useState(() => {
    if (typeof window === "undefined") return true;
    try {
      // Supabase persists the session under this key by default
      const sessionKey = Object.keys(localStorage).find((k) => k.startsWith("sb-") && k.endsWith("-auth-token"));
      if (!sessionKey) return true;
      const raw = localStorage.getItem(sessionKey);
      if (!raw) return true;
      const parsed = JSON.parse(raw);
      const uid = parsed?.user?.id;
      if (!uid) return true;
      const cachedRole = readCachedRole(uid);
      return cachedRole === null; // if we have a cached role, start non-loading
    } catch { return true; }
  });
  const router = useRouter();

  // Dev-only: log when auth finishes resolving (role known or no session).
  useEffect(() => {
    if (!loading) logPerf("auth resolved");
  }, [loading]);

  const queryClient = useQueryClient();
  const lastUserIdRef = useRef<string | null>(null);
  const roleLoadedForRef = useRef<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      const newUid = sess?.user?.id ?? null;
      const prevUid = lastUserIdRef.current;
      const identityChanged = newUid !== prevUid;

      setSession(sess);
      setUser(sess?.user ?? null);

      if (!sess) {
        // Signed out — clear role and stop loading.
        setRole(null);
        roleLoadedForRef.current = null;
        setLoading(false);
      } else if (identityChanged) {
        // Real user change (sign-in, account switch). Need to load role.
        setLoading(true);
      }
      // For TOKEN_REFRESHED / USER_UPDATED with the SAME user id, do NOT
      // toggle loading — the role is already resolved. Toggling loading
      // here was causing the AuthSplash to flash on every token refresh
      // (hourly, on tab focus, on PWA resume).

      lastUserIdRef.current = newUid;

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
      setSession(data.session);
      setUser(data.session?.user ?? null);
      lastUserIdRef.current = data.session?.user?.id ?? null;
      if (!data.session) setLoading(false);
      if (data.session) void markClientSignedIn();
    }).catch(() => {
      // Never strand the app in `loading` if getSession itself throws.
      setLoading(false);
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

    const withTimeout = async <T,>(promise: Promise<T>): Promise<T | null> => {
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
    // Stop in-flight queries before clearing the session so they don't 401.
    try { await queryClient.cancelQueries(); } catch { /* best-effort */ }
    queryClient.clear();
    // Wipe persisted RQ cache so the next signed-in user on this device
    // never sees the previous user's cached dashboard data.
    try {
      const { clearPersistedQueryCache } = await import("@/lib/query-persister");
      clearPersistedQueryCache();
    } catch { /* best-effort */ }
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole(null);
    roleLoadedForRef.current = null;
    lastUserIdRef.current = null;
    if (uid) clearCachedRole(uid); // clear role cache on sign-out
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