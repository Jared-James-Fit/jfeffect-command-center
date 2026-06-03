import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Private Client Portal — JF Effect" }] }),
  component: AuthPage,
});

const statCards = [
  { top: "1:1", bottom: "COACHING" },
  { top: "PRIVATE", bottom: "ACCESS" },
  { top: "CLIENT", bottom: "PORTAL" },
  { top: "JF", bottom: "EFFECT" },
];

function AuthPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [showForm, setShowForm] = useState(false);
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
        <Link to="/" className="mb-10 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-primary text-sm font-black text-primary-foreground shadow-glow">
            JF
          </div>
          <span className="text-lg font-black tracking-tight">JF EFFECT</span>
        </Link>

        <div className="w-full max-w-sm">
          {!showForm ? (
            <div className="flex flex-col items-center text-center">
              {/* Top label */}
              <span className="mb-5 inline-flex items-center gap-2 rounded-full border border-border bg-card/60 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                <span className="h-1.5 w-1.5 rounded-full bg-primary" />
                Private Client Portal
              </span>

              {/* Headline */}
              <h1 className="text-balance text-3xl font-black tracking-tight md:text-4xl">
                JF Effect Private Coaching
              </h1>

              {/* Subheadline */}
              <p className="mt-3 text-sm text-muted-foreground">
                Client access only.
              </p>

              {/* Stat grid */}
              <div className="mx-auto mt-10 grid w-full grid-cols-2 gap-2">
                {statCards.map((card) => (
                  <div
                    key={card.top + card.bottom}
                    className="flex flex-col items-center justify-center rounded-xl border border-border bg-card/40 px-4 py-6 text-center backdrop-blur-sm transition-colors hover:bg-card/60"
                  >
                    <span className="text-lg font-black tracking-tight">
                      {card.top}
                    </span>
                    <span className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                      {card.bottom}
                    </span>
                  </div>
                ))}
              </div>

              {/* Primary login button */}
              <Button
                onClick={() => setShowForm(true)}
                className="mt-10 w-full bg-gradient-primary py-6 text-sm font-bold tracking-[0.15em] uppercase shadow-glow transition-all hover:shadow-[0_0_50px_-8px_color-mix(in_oklab,var(--primary)_55%,transparent)]"
              >
                Login
              </Button>

              <p className="mt-6 text-[10px] uppercase tracking-widest text-muted-foreground/60">
                Invited members only
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center">
              <button
                onClick={() => setShowForm(false)}
                className="mb-6 flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              >
                <ArrowLeft className="h-3.5 w-3.5" />
                Back
              </button>

              <h2 className="text-xl font-black tracking-tight">
                Client Login
              </h2>
              <p className="mt-1 text-xs text-muted-foreground">
                Enter your credentials to continue.
              </p>

              <form onSubmit={handleSignIn} className="mt-8 w-full space-y-4">
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
            </div>
          )}
        </div>
      </div>
    </main>
  );
}
