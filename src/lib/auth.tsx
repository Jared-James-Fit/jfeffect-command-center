import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { markClientSignedIn } from "@/lib/activity";
import { logPerf } from "@/lib/perf-timing";

export type AppRole = "admin" | "coach" | "media_manager" | "client" | "member";

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
  const [role, setRole] = useState<AppRole | null>(null);
  const [loading, setLoading] = useState(true);
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
        const [{ data: roleRows, error: roleErr }, { data: memberRow }, { data: clientRow }] = await Promise.all([
          supabase.from("user_roles").select("role").eq("user_id", uid),
          supabase.from("app_members").select("id").eq("user_id", uid).maybeSingle(),
          supabase.from("clients").select("id").eq("user_id", uid).maybeSingle(),
        ]);
        if (cancelled) return;
        if (roleErr) throw roleErr;
        const roles = (roleRows ?? []).map((r: any) => r.role as AppRole);
        setRole(
          roles.includes("admin") ? "admin"
          : roles.includes("coach") ? "coach"
          : roles.includes("media_manager") ? "media_manager"
          : memberRow ? "member"
          : roles.includes("client") || clientRow ? "client"
          : "client",
        );
        roleLoadedForRef.current = uid;
        setLoading(false);
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