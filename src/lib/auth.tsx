import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import { useRouter } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { markClientSignedIn } from "@/lib/activity";

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
  const queryClient = useQueryClient();
  const lastUserIdRef = useRef<string | null>(null);

  useEffect(() => {
    const { data: sub } = supabase.auth.onAuthStateChange((event, sess) => {
      setSession(sess);
      setUser(sess?.user ?? null);
      if (!sess) setRole(null);
      // Fire-and-forget — RPC self-scopes to auth.uid() and ignores non-client users.
      if (sess && (event === "SIGNED_IN" || event === "TOKEN_REFRESHED" || event === "INITIAL_SESSION")) {
        void markClientSignedIn();
      }
      // Only blow away caches on a real identity change (sign-in/sign-out or
      // user-switch). TOKEN_REFRESHED and INITIAL_SESSION fire frequently and
      // were causing every page to refetch everything → slow, inconsistent loads.
      const newUid = sess?.user?.id ?? null;
      const identityChanged = newUid !== lastUserIdRef.current;
      if (identityChanged && (event === "SIGNED_IN" || event === "SIGNED_OUT" || event === "USER_UPDATED")) {
        lastUserIdRef.current = newUid;
        router.invalidate();
        queryClient.invalidateQueries();
      } else {
        lastUserIdRef.current = newUid;
      }
    });
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setUser(data.session?.user ?? null);
      lastUserIdRef.current = data.session?.user?.id ?? null;
      setLoading(false);
      if (data.session) void markClientSignedIn();
    });
    return () => sub.subscription.unsubscribe();
  }, [router, queryClient]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      const [{ data: roleRows }, { data: memberRow }] = await Promise.all([
        supabase.from("user_roles").select("role").eq("user_id", user.id),
        supabase.from("app_members").select("id").eq("user_id", user.id).maybeSingle(),
      ]);
      if (cancelled) return;
      const roles = (roleRows ?? []).map((r: any) => r.role as AppRole);
      // Admin/coach take priority. Otherwise: if the user has an app_members
      // row, they're a member; else fall back to client.
      setRole(
        roles.includes("admin") ? "admin"
        : roles.includes("coach") ? "coach"
        : roles.includes("media_manager") ? "media_manager"
        : memberRow ? "member"
        : roles.includes("client") ? "client"
        : null,
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [user]);

  const signOut = async () => {
    await supabase.auth.signOut();
    setSession(null);
    setUser(null);
    setRole(null);
  };

  return (
    <AuthCtx.Provider value={{ user, session, role, loading, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);