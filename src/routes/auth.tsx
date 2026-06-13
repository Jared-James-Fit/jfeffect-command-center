import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  Mail,
  Lock,
  ShieldCheck,
  Dumbbell,
  ClipboardCheck,
  Apple,
  MessageSquare,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { AuthSplash } from "@/components/auth-splash";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "JF Effect — Private Coaching OS" }] }),
  component: AuthPage,
});

const FEATURES = [
  { icon: Dumbbell, label: "Training" },
  { icon: ClipboardCheck, label: "Check-ins" },
  { icon: Apple, label: "Nutrition" },
  { icon: MessageSquare, label: "Messages" },
];

function AuthPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && user && role) {
      const to = role === "member" ? "/m" : role === "client" ? "/portal" : "/admin";
      navigate({ to, replace: true });
    }
  }, [user, role, loading, navigate]);

  // Avoid flashing the login form while the session is still restoring,
  // or while an authenticated user is being routed to their dashboard.
  if (loading || user) {
    return <AuthSplash />;
  }

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
      {/* ambient glow */}
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />

      <div className="flex min-h-screen flex-col items-center justify-center px-6 py-16">
        {/* Logo */}
        <div className="mb-6 flex items-center gap-3">
          <img src="/logo.png" alt="JF Effect" className="h-11 w-11 rounded-xl shadow-glow" />
          <span className="text-lg font-black tracking-tight">JF EFFECT</span>
        </div>

        <div className="w-full max-w-sm">
          <div className="flex flex-col items-center text-center">
            <h1 className="text-balance text-xl font-black tracking-tight">
              Private Coaching Hub
            </h1>
            <p className="mt-1.5 max-w-[260px] text-sm text-muted-foreground leading-relaxed">
              Training, nutrition, check-ins & coaching — all in one place.
            </p>

            {/* Feature icons */}
            <div className="mt-5 flex items-center gap-5">
              {FEATURES.map(({ icon: Icon, label }) => (
                <div key={label} className="flex flex-col items-center gap-1">
                  <div className="grid h-8 w-8 place-items-center rounded-lg bg-muted/60">
                    <Icon className="h-3.5 w-3.5 text-muted-foreground" />
                  </div>
                  <span className="text-[9px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                    {label}
                  </span>
                </div>
              ))}
            </div>

            <form onSubmit={handleSignIn} className="mt-8 w-full space-y-4 text-left">
              <div>
                <Label htmlFor="email" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Email
                </Label>
                <div className="relative mt-1.5">
                  <Mail className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none" />
                  <Input
                    id="email"
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="pl-10"
                    placeholder="you@example.com"
                  />
                </div>
              </div>
              <div>
                <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Password
                </Label>
                <div className="relative mt-1.5">
                  <Lock className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground pointer-events-none z-10" />
                  <PasswordInput
                    id="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="pl-10"
                    placeholder="••••••••"
                  />
                </div>
              </div>
              <Button
                type="submit"
                disabled={busy}
                className="w-full bg-gradient-primary py-6 text-sm font-bold tracking-[0.15em] uppercase shadow-glow"
              >
                {busy ? "Signing in…" : "Login"}
              </Button>
            </form>

            {/* Private access badge */}
            <div className="mt-6 inline-flex items-center gap-1.5 rounded-full border border-border/60 bg-muted/30 px-3 py-1.5">
              <ShieldCheck className="h-3 w-3 text-primary" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Private Client Access
              </span>
            </div>
            <div className="mt-4 text-xs text-muted-foreground">
              New here?{" "}
              <Link to="/join" className="text-primary underline-offset-2 hover:underline">
                Join JF Membership
              </Link>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
