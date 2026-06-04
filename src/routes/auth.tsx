import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "JF Effect — Private Coaching OS" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user && role) {
      navigate({ to: role === "admin" ? "/admin" : "/portal", replace: true });
    }
  }, [user, role, loading, navigate]);

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Welcome back");
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      {/* subtle ambient glow top-right */}
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
        {/* Logo */}
        <div className="mb-6 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-primary text-sm font-black text-primary-foreground shadow-glow">
            JF
          </div>
          <span className="text-lg font-black tracking-tight">JF EFFECT</span>
        </div>

        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-balance text-xl font-black tracking-tight">
              JF Effect Private Coaching OS
            </h1>
            <p className="mt-2 max-w-xs text-sm text-muted-foreground">
              Your private hub for coaching, check-ins, training, nutrition, progress, payments, and communication.
            </p>

            <form onSubmit={handleSignIn} className="mt-8 w-full space-y-4 text-left">
              <div>
                <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email
                </Label>
                <Input
                  id="email"
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1.5"
                  placeholder="you@example.com"
                />
              </div>
              <div>
                <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <Input
                  id="password"
                  type="password"
                  required
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="mt-1.5"
                  placeholder="••••••••"
                />
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-gradient-primary py-6 text-sm font-bold tracking-[0.15em] uppercase shadow-glow"
              >
                {busy ? "Signing in…" : "Login"}
              </Button>
            </form>

            <p className="mt-6 text-[10px] uppercase tracking-widest text-muted-foreground/60">
              Private access for JF Effect clients only.
            </p>
          </div>
        </div>
      </div>
    </main>
  );
}
