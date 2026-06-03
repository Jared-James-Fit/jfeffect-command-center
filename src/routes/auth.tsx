import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";

export const Route = createFileRoute("/auth")({
  head: () => ({ meta: [{ title: "Sign in — JF Effect" }] }),
  component: AuthPage,
});

function AuthPage() {
  const { user, role, loading } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
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

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: window.location.origin,
        data: { full_name: name },
      },
    });
    setBusy(false);
    if (error) toast.error(error.message);
    else toast.success("Account created — check your email to confirm.");
  };

  return (
    <main className="min-h-screen bg-background text-foreground">
      <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top,oklch(0.62_0.22_25/0.15),transparent_55%)]" />
      <div className="flex min-h-screen items-center justify-center p-6">
        <div className="w-full max-w-md">
          <Link to="/" className="mb-8 flex items-center justify-center gap-3">
            <div className="grid h-12 w-12 place-items-center rounded-full bg-gradient-primary text-base font-black text-primary-foreground shadow-glow">JF</div>
            <span className="text-xl font-black tracking-tight">JF EFFECT</span>
          </Link>

          <div className="rounded-xl border border-border bg-card p-8 shadow-card-elegant">
            <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
              <TabsList className="mb-6 grid w-full grid-cols-2">
                <TabsTrigger value="signin">Sign in</TabsTrigger>
                <TabsTrigger value="signup">Sign up</TabsTrigger>
              </TabsList>

              <TabsContent value="signin">
                <form onSubmit={handleSignIn} className="space-y-4">
                  <div>
                    <Label htmlFor="si-email">Email</Label>
                    <Input id="si-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="si-pass">Password</Label>
                    <Input id="si-pass" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full bg-gradient-primary font-bold tracking-wide uppercase">
                    {busy ? "Signing in…" : "Sign in"}
                  </Button>
                </form>
              </TabsContent>

              <TabsContent value="signup">
                <form onSubmit={handleSignUp} className="space-y-4">
                  <div>
                    <Label htmlFor="su-name">Full name</Label>
                    <Input id="su-name" required value={name} onChange={(e) => setName(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="su-email">Email</Label>
                    <Input id="su-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                  </div>
                  <div>
                    <Label htmlFor="su-pass">Password</Label>
                    <Input id="su-pass" type="password" required minLength={6} value={password} onChange={(e) => setPassword(e.target.value)} />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full bg-gradient-primary font-bold tracking-wide uppercase">
                    {busy ? "Creating…" : "Create account"}
                  </Button>
                </form>
              </TabsContent>
            </Tabs>
          </div>

          <p className="mt-6 text-center text-xs text-muted-foreground">
            Private coaching portal. New clients are invited by Jared.
          </p>
        </div>
      </div>
    </main>
  );
}