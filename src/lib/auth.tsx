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
    const fetchRole = async (attempt = 0): Promise<void> => {
      try {
        // Race the role lookup against a hard timeout so a slow DB
        // response (RLS contention, transient PgBouncer saturation) can
        // never strand the splash. On timeout we fall back to a cached
        // or default role; the next attempt re-runs in the background.
        const fetchPromise = Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", uid),
          supabase.from("app_members").select("id").eq("user_id", uid).maybeSingle(),
          supabase.from("clients").select("id").eq("user_id", uid).maybeSingle(),
        ]);
        const TIMEOUT_MS = 3000;
        const timeoutPromise = new Promise<"__timeout__">((resolve) =>
          setTimeout(() => resolve("__timeout__"), TIMEOUT_MS),
        );
        const raced = await Promise.race([fetchPromise, timeoutPromise]);
        if (cancelled) return;
        if (raced === "__timeout__") {
          // Don't strand the user. Use a cached role if present, else
          // default to "client". Do NOT mark roleLoadedForRef so the
          // in-flight query can still resolve and correct the role.
          const cached = readCachedRole(uid);
          const fallback: AppRole = cached ?? "client";
          if (!roleLoadedForRef.current) {
            setRole((prev) => prev ?? fallback);
            setLoading(false);
          }
          // Let the original fetch finish in the background and update.
          fetchPromise.then(([{ data: roleRows }, { data: memberRow }, { data: clientRow }]) => {
            if (cancelled) return;
            const roles = (roleRows ?? []).map((r: any) => r.role as AppRole);
            const resolvedRole: AppRole =
              roles.includes("admin") ? "admin"
              : roles.includes("coach") ? "coach"
              : roles.includes("media_manager") ? "media_manager"
              : roles.includes("client") ? "client"
              : memberRow ? "member"
              : clientRow ? "client"
              : "client";
            setRole(resolvedRole);
            roleLoadedForRef.current = uid;
            writeCachedRole(uid, resolvedRole);
          }).catch(() => { /* background failure; user already on a page */ });
          return;
        }
        const [{ data: roleRows, error: roleErr }, { data: memberRow }, { data: clientRow }] = raced;
        if (cancelled) return;
        if (roleErr) throw roleErr;
        const roles = (roleRows ?? []).map((r: any) => r.role as AppRole);
        const resolvedRole: AppRole =
          roles.includes("admin") ? "admin"
          : roles.includes("coach") ? "coach"
          : roles.includes("media_manager") ? "media_manager"
          : roles.includes("client") ? "client"
          : memberRow ? "member"
          : clientRow ? "client"
          : "client";
        setRole(resolvedRole);
        roleLoadedForRef.current = uid;
        writeCachedRole(uid, resolvedRole); // persist for instant PWA resume
        setLoading(false);
        // Warm the client record cache so the dashboard doesn't waterfall
        if (resolvedRole === "client") {
          queryClient.prefetchQuery({
            queryKey: ["my-client", uid],
            queryFn: async () => {
              const { data } = await supabase.from("clients").select("*").eq("user_id", uid).maybeSingle();
              return data;
            },
            staleTime: 30_000,
          });
        }
      } catch (err) {
        // Transient network failure — DO NOT sign the user out. Retry with
        // backoff. After max attempts give up but keep the auth session;
        // default the role to "client" so they at least land somewhere
        // sensible rather than getting bounced back to /auth.
        if (cancelled) return;
        if (attempt < 3) {
          const delay = 400 * Math.pow(2, attempt);
          setTimeout(() => { if (!cancelled) void fetchRole(attempt + 1); }, delay);
          return;
        }
        console.error("[auth] role load failed after retries", err);
        setRole((prev) => prev ?? "client");
        roleLoadedForRef.current = uid;
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