import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — JF Effect" }] }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"loading" | "ready" | "expired" | "done">("loading");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) setPhase("ready");
    });
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) setPhase("ready");
      else setTimeout(() => setPhase((p) => (p === "loading" ? "expired" : p)), 1500);
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPhase("done");
    toast.success("Password updated.");
    setTimeout(() => navigate({ to: "/portal", replace: true }), 600);
  };

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="flex min-h-screen items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-3">
            <img src="/logo.png" alt="JF Effect" className="h-11 w-11 rounded-xl shadow-glow" />
            <span className="text-lg font-black tracking-tight">JF EFFECT</span>
          </div>
          <Card className="border-border bg-card/60 p-6 backdrop-blur-sm">
            {phase === "loading" && <p className="text-sm text-muted-foreground">Verifying your link…</p>}
            {phase === "expired" && (
              <div className="space-y-4 text-center">
                <h2 className="text-xl font-black">This reset link has expired</h2>
                <p className="text-sm text-muted-foreground">Please request a new password reset link.</p>
                <a href="mailto:jaredjamesfit@gmail.com?subject=New%20password%20reset%20request">
                  <Button className="w-full bg-gradient-primary font-bold uppercase tracking-wider">
                    Request new reset link
                  </Button>
                </a>
              </div>
            )}
            {phase === "ready" && (
              <>
                <div className="text-center">
                  <h2 className="text-xl font-black tracking-tight">Reset your password</h2>
                  <p className="mt-1 text-xs text-muted-foreground">Set a new password for your coaching dashboard.</p>
                </div>
                <form onSubmit={submit} className="mt-6 w-full space-y-4">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">New password</Label>
                    <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" placeholder="Min 8 characters" />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirm new password</Label>
                    <PasswordInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5" />
                  </div>
                  <Button type="submit" disabled={busy} className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow">
                    {busy ? "Resetting…" : "Reset password"}
                  </Button>
                </form>
              </>
            )}
            {phase === "done" && <p className="text-center text-sm text-muted-foreground">Taking you to your dashboard…</p>}
          </Card>
        </div>
      </div>
    </main>
  );
}