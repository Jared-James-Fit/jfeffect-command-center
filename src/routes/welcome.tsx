import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, AuthLogo } from "@/components/auth/auth-shell";
import { freeJoinMessage } from "@/lib/free-signup";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/welcome")({
  head: () => ({
    meta: [
      { title: "Welcome to JF Effect" },
      { name: "robots", content: "noindex" },
      ...shareMeta({
        title: "JF Effect",
        description: "Finish making your free account.",
        path: "/welcome",
      }),
    ],
  }),
  component: WelcomePage,
});

type Phase =
  | { kind: "confirm" }
  | { kind: "working" }
  | { kind: "message"; title: string; body: string }
  | { kind: "expired" };

/**
 * Where a free sign-up's confirmation email lands (scanner-safe: the token is
 * only spent when the person taps Continue, never by a mail scanner). Then the
 * login becomes a free member (member_free_join; the database trigger has
 * usually done it already) and the app opens where every launch does.
 */
function WelcomePage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>({ kind: "working" });
  const started = useRef(false);

  const join = async () => {
    const { data, error } = await (supabase as any).rpc("member_free_join");
    const status = error ? "signed_out" : (data?.status as string | undefined);
    const msg = freeJoinMessage(status);
    if (msg) {
      setPhase({ kind: "message", ...msg });
      return;
    }
    navigate({ href: "/app", replace: true });
  };

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const params = new URLSearchParams(window.location.search);
    if (params.get("token_hash")) {
      setPhase({ kind: "confirm" });
      return;
    }
    // A plain Supabase link signs in through the URL hash; or they're already signed in.
    (async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) await join();
      else setPhase({ kind: "expired" });
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const confirm = async () => {
    setPhase({ kind: "working" });
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = (params.get("type") || "signup") as "signup" | "magiclink" | "invite" | "recovery";
    if (!tokenHash) {
      setPhase({ kind: "expired" });
      return;
    }
    // Never act on someone else's session that happens to be on this phone.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    window.history.replaceState({}, "", window.location.pathname);
    if (error) {
      setPhase({ kind: "expired" });
      return;
    }
    await join();
  };

  return (
    <AuthShell>
      <div className="text-center">
        <AuthLogo size={64} />
        {phase.kind === "working" && (
          <div className="mt-8 flex justify-center">
            <Loader2
              className="h-6 w-6 animate-spin text-muted-foreground"
              aria-label="Setting up your account"
            />
          </div>
        )}
        {phase.kind === "confirm" && (
          <>
            <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
              You're almost in
            </h1>
            <p className="mx-auto mt-2 max-w-[300px] text-[15px] leading-relaxed text-muted-foreground">
              Tap continue to confirm your email and open the app.
            </p>
            <button
              type="button"
              onClick={confirm}
              className="mt-7 flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground transition active:scale-[0.985]"
            >
              Continue
            </button>
          </>
        )}
        {phase.kind === "message" && (
          <>
            <h1 className="mt-6 text-[24px] font-semibold leading-tight tracking-[-0.02em]">
              {phase.title}
            </h1>
            <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
              {phase.body}
            </p>
            <Link
              to="/auth"
              className="mt-7 flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground"
            >
              Go to sign in
            </Link>
          </>
        )}
        {phase.kind === "expired" && (
          <>
            <h1 className="mt-6 text-[24px] font-semibold leading-tight tracking-[-0.02em]">
              This link has expired
            </h1>
            <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
              Sign in with the email and password you made. If it says to confirm your email, start
              again to get a new link.
            </p>
            <div className="mt-7 space-y-2">
              <Link
                to="/auth"
                className="flex h-[54px] w-full items-center justify-center rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground"
              >
                Sign in
              </Link>
              <Link
                to="/join"
                className="flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-medium text-muted-foreground"
              >
                Start again
              </Link>
            </div>
          </>
        )}
      </div>
    </AuthShell>
  );
}
