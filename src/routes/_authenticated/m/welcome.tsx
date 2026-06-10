import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { completeJfSignup } from "@/lib/jf-billing.functions";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Sparkles, Loader2 } from "lucide-react";
import { z } from "zod";

export const Route = createFileRoute("/_authenticated/m/welcome")({
  component: Welcome,
  validateSearch: (s) => z.object({ session_id: z.string().optional() }).parse(s),
});

const NEXT_STEPS = [
  { label: "Complete your profile", to: "/m/account" as const },
  { label: "Choose your first workout plan", to: "/m/plans" as const },
  { label: "Browse the exercise library", to: "/m/tools" as const },
  { label: "Check nutrition resources", to: "/m/resources" as const },
  { label: "Turn on notifications", to: "/m/account" as const },
];

function Welcome() {
  const search = Route.useSearch();
  const complete = useServerFn(completeJfSignup);
  const [state, setState] = useState<{ loading: boolean; error?: string; result?: any }>({ loading: !!search.session_id });

  useEffect(() => {
    if (!search.session_id) return;
    let cancelled = false;
    (async () => {
      try {
        // Try a few times — Stripe can take a beat to mark the session complete.
        for (let i = 0; i < 5; i++) {
          try {
            const r = await complete({ data: { session_id: search.session_id! } });
            if (!cancelled) setState({ loading: false, result: r });
            // Refresh auth so JWT picks up the new user
            await supabase.auth.refreshSession();
            return;
          } catch (e: any) {
            if (i === 4) throw e;
            await new Promise((r) => setTimeout(r, 1500));
          }
        }
      } catch (e: any) {
        if (!cancelled) setState({ loading: false, error: e?.message ?? "Couldn't finalize signup." });
      }
    })();
    return () => { cancelled = true; };
  }, [search.session_id]);

  return (
    <div className="container mx-auto max-w-3xl space-y-6 px-4 py-8">
      <Card className="border-emerald-500/30 bg-emerald-500/5 p-6">
        <div className="flex items-center gap-3">
          <Sparkles className="h-6 w-6 text-emerald-400" />
          <div>
            <h1 className="text-2xl font-bold">Welcome to JF Membership</h1>
            <p className="text-sm text-muted-foreground">Your account is ready.</p>
          </div>
        </div>
        {state.loading && (
          <div className="mt-5 flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Finalizing your membership…
          </div>
        )}
        {state.error && (
          <div className="mt-5 rounded-md border border-rose-500/30 bg-rose-500/10 p-3 text-sm text-rose-200">
            {state.error}
          </div>
        )}
        {state.result && (
          <div className="mt-5 grid gap-2 text-sm">
            <div><span className="text-muted-foreground">Email:</span> {state.result.email}</div>
            <div><span className="text-muted-foreground">Status:</span> <span className="text-emerald-300">{state.result.subscription_status}</span></div>
            {state.result.trial_end_at && (
              <div><span className="text-muted-foreground">Trial ends:</span> {new Date(state.result.trial_end_at).toLocaleDateString()}</div>
            )}
          </div>
        )}
      </Card>

      <Card className="p-6">
        <div className="text-xs uppercase tracking-wider text-muted-foreground font-semibold mb-3">Get started</div>
        <ul className="space-y-2">
          {NEXT_STEPS.map((s) => (
            <li key={s.label}>
              <Link to={s.to} className="flex items-center gap-2 rounded-md border border-border bg-background/40 px-3 py-2 text-sm hover:bg-background/70">
                <CheckCircle2 className="h-4 w-4 text-muted-foreground" />
                {s.label}
              </Link>
            </li>
          ))}
        </ul>
      </Card>

      <div className="flex gap-2">
        <Link to="/m"><Button>Go to dashboard</Button></Link>
        <Link to="/m/billing"><Button variant="ghost">Manage billing</Button></Link>
      </div>
    </div>
  );
}