/**
 * A login with no athlete record (no member, no coaching client): someone
 * who isn't approved yet, or made a login some other way. Free membership is
 * by application (membership-apply.ts), so the app says where they stand
 * instead of opening empty screens. The database is the real gate
 * (`_member_free_join` makes nothing until Jared approves them).
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, AuthLogo } from "@/components/auth/auth-shell";
import { useAuth } from "@/lib/auth";
import { freeJoinMessage } from "@/lib/free-signup";
import { SOCIAL } from "@/lib/social-links";

export function MembershipPendingGate() {
  const { user, signOut } = useAuth();
  const q = useQuery({
    queryKey: ["member-join-status", user?.id ?? null],
    enabled: !!user?.id,
    staleTime: 60_000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("member_free_join");
      if (error) return "unknown";
      return String(data?.status ?? "unknown");
    },
  });
  const status = q.data;
  // made a member just now (approved since the last look): the app picks it up on reload
  if ((status === "member" || status === "athlete") && typeof window !== "undefined") {
    try {
      if (!window.sessionStorage.getItem("jf_member_join_reload")) {
        window.sessionStorage.setItem("jf_member_join_reload", "1");
        window.setTimeout(() => window.location.reload(), 300);
      }
    } catch {
      /* storage blocked: they can pull to refresh */
    }
  }
  const msg = freeJoinMessage(status) ?? {
    title: "We couldn't find your membership",
    body: "Your login works, but there's no JF Effect membership on it yet. Message Jared and he'll sort it out.",
  };
  return (
    <AuthShell>
      <div className="text-center" data-membership-pending={status ?? "loading"}>
        <AuthLogo size={64} />
        {q.isLoading || status === "member" || status === "athlete" ? (
          <Loader2
            className="mx-auto mt-8 h-6 w-6 animate-spin text-muted-foreground"
            aria-label="Checking your membership"
          />
        ) : (
          <>
            <h1 className="mt-6 text-[24px] font-semibold leading-tight tracking-[-0.02em]">
              {msg.title}
            </h1>
            <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
              {msg.body}
            </p>
            <div className="mt-7 space-y-2">
              {status === "not_approved" ? (
                <Link
                  to="/join"
                  className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground"
                >
                  Apply free
                </Link>
              ) : (
                <a
                  href={SOCIAL.instagram.url}
                  className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-secondary text-[17px] font-semibold"
                >
                  Message Jared
                </a>
              )}
              <button
                type="button"
                onClick={() => void signOut()}
                className="h-12 w-full rounded-2xl text-[15px] font-medium text-muted-foreground"
              >
                Sign out
              </button>
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}
