import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { z } from "zod";
import { completeJfSignup } from "@/lib/jf-billing.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Sparkles, Loader2, AlertCircle } from "lucide-react";

export const Route = createFileRoute("/m/welcome")({
  component: Welcome,
  validateSearch: (s) => z.object({ session_id: z.string().optional() }).parse(s),
  head: () => ({
    meta: [
      { title: "Welcome — JF Membership" },
      { name: "description", content: "Finalizing your JF Membership account." },
      { name: "robots", content: "noindex" },
    ],
  }),
});

type State =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "ok"; signedIn: boolean; result: any; stalled: boolean }
  | { kind: "error"; message: string };

function publicErrorMessage(raw: string | undefined): string {
  const m = (raw ?? "").toLowerCase();
  if (m.includes("not found") || m.includes("no such")) return "This checkout session is expired or invalid.";
  if (m.includes("not confirmed") || m.includes("wrong checkout")) return "Checkout has not been completed yet.";
  if (m.includes("signup data missing")) return "Account setup is already complete. Please log in.";
  return "Signup session could not be completed. Please contact support.";
}

function Welcome() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const complete = useServerFn(completeJfSignup);
  const [state, setState] = useState<State>(search.session_id ? { kind: "loading" } : { kind: "error", message: "Missing checkout session. Please contact support." });
  const ran = useRef(false);

  // Wait until Supabase has actually persisted a session (post-verifyOtp).
  async function waitForSession(timeoutMs = 4000): Promise<boolean> {
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
      const { data } = await supabase.auth.getSession();
      if (data.session) return true;
      await new Promise((r) => setTimeout(r, 150));
    }
    return false;
  }

  useEffect(() => {
    if (!search.session_id || ran.current) return;
    ran.current = true;
    let cancelled = false;
    let stalledTimer: any = null;

    (async () => {
      let lastErr: any = null;
      // Retry briefly — Stripe can take a moment to mark the session complete
      for (let i = 0; i < 5; i++) {
        try {
          const r: any = await complete({ data: { session_id: search.session_id! } });
          if (cancelled) return;

          let signedIn = false;
          if (r?.otp_token_hash && r?.email) {
            try {
              const { error } = await supabase.auth.verifyOtp({
                token_hash: r.otp_token_hash,
                type: "magiclink",
              });
              if (!error) {
                // Block until the session is actually persisted client-side,
                // otherwise /m's auth gate will bounce us to /auth.
                signedIn = await waitForSession();
              }
            } catch {
              signedIn = false;
            }
          }
          if (cancelled) return;
          setState({ kind: "ok", signedIn, result: r, stalled: false });

          if (signedIn) {
            // Auto-redirect — REPLACE so Back doesn't return to /m/welcome.
            setTimeout(() => {
              if (!cancelled) navigate({ to: "/m", replace: true });
            }, 600);
            // Fallback: if for any reason the redirect didn't take, surface
            // the "Continue to Membership" CTA prominently after 4s.
            stalledTimer = setTimeout(() => {
              if (cancelled) return;
              setState((s) => (s.kind === "ok" ? { ...s, stalled: true } : s));
            }, 4000);
          }
          return;
        } catch (e: any) {
          lastErr = e;
          await new Promise((res) => setTimeout(res, 1500));
        }
      }
      if (!cancelled) {
        console.error("[m/welcome] completeJfSignup failed", lastErr);
        setState({ kind: "error", message: publicErrorMessage(lastErr?.message) });
      }
    })();

    return () => { cancelled = true; if (stalledTimer) clearTimeout(stalledTimer); };
  }, [search.session_id, complete, navigate]);

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto max-w-2xl px-4 py-12 space-y-6">
        <Card className="border-emerald-500/30 bg-emerald-500/5 p-6">
          <div className="flex items-center gap-3">
            <Sparkles className="h-6 w-6 text-emerald-400" />
            <div>
              <h1 className="text-2xl font-bold">Welcome to JF Membership</h1>
              <p className="text-sm text-muted-foreground">Finalizing your account…</p>
            </div>
          </div>

          {state.kind === "loading" && (
            <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Setting up your membership…
            </div>
          )}

          {state.kind === "ok" && (
            <div className="mt-5 space-y-4">
              <div className="flex items-center gap-2 text-sm text-emerald-300">
                <CheckCircle2 className="h-4 w-4" /> Your membership is ready.
              </div>
              {state.result?.email && (
                <div className="text-sm"><span className="text-muted-foreground">Email:</span> {state.result.email}</div>
              )}
              {state.result?.trial_end_at && (
                <div className="text-sm">
                  <span className="text-muted-foreground">Trial ends:</span>{" "}
                  {new Date(state.result.trial_end_at).toLocaleDateString()}
                </div>
              )}
              {state.signedIn && state.stalled && (
                <p className="text-xs text-muted-foreground">
                  Taking longer than expected? Use the button below to continue.
                </p>
              )}
              <div className="flex flex-wrap gap-2 pt-2">
                {state.signedIn ? (
                  <Button onClick={() => navigate({ to: "/m", replace: true })}>
                    Continue to Membership
                  </Button>
                ) : (
                  <Link to="/auth"><Button>Log in</Button></Link>
                )}
              </div>
              {!state.signedIn && (
                <p className="text-xs text-muted-foreground">
                  Sign in with the email and password you used at signup.
                </p>
              )}
            </div>
          )}

          {state.kind === "error" && (
            <div className="mt-5 space-y-3">
              <div className="flex items-start gap-2 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div>{state.message}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Link to="/auth"><Button variant="outline">Log in</Button></Link>
                <Link to="/membership"><Button variant="ghost">Back to signup</Button></Link>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}