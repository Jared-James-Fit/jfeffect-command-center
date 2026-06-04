import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { acceptCoachInvite } from "@/lib/coaches.functions";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Set up your account — JF Effect" }] }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"loading" | "ready" | "expired" | "done">("loading");
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [isCoachInvite, setIsCoachInvite] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const acceptCoachFn = useServerFn(acceptCoachInvite);

  useEffect(() => {
    // Supabase recovery / invite links return a session via URL hash and
    // fire onAuthStateChange with event=PASSWORD_RECOVERY or SIGNED_IN.
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setEmail(session.user.email ?? "");
        setFullName((session.user.user_metadata as any)?.full_name ?? "");
        setIsCoachInvite(((session.user.user_metadata as any)?.invite_role) === "coach");
        setPhase("ready");
      }
    });
    // If already logged in / hash already exchanged
    supabase.auth.getSession().then(({ data }) => {
      if (data.session?.user) {
        setEmail(data.session.user.email ?? "");
        setFullName((data.session.user.user_metadata as any)?.full_name ?? "");
        setIsCoachInvite(((data.session.user.user_metadata as any)?.invite_role) === "coach");
        setPhase("ready");
      } else {
        // Give the hash exchange ~1.5s, then assume the link is invalid/expired
        setTimeout(() => {
          setPhase((p) => (p === "loading" ? "expired" : p));
        }, 1500);
      }
    });
    return () => sub.data.subscription.unsubscribe();
  }, []);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setBusy(false); return toast.error(error.message); }
    if (isCoachInvite) {
      try { await acceptCoachFn({ data: undefined as any }); } catch { /* non-fatal */ }
    }
    setBusy(false);
    setPhase("done");
    toast.success("Account ready. Welcome to JF Effect.");
    setTimeout(() => navigate({ to: isCoachInvite ? "/admin" : "/portal", replace: true }), 600);
  };

  return (
    <Shell>
      {phase === "loading" && <p className="text-sm text-muted-foreground">Verifying your link…</p>}

      {phase === "expired" && (
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-black">This setup link has expired</h2>
          <p className="text-sm text-muted-foreground">
            Please contact Coach Jared or request a new setup link.
          </p>
          <a href="mailto:jaredjamesfit@gmail.com?subject=New%20setup%20link%20request">
            <Button className="w-full bg-gradient-primary font-bold uppercase tracking-wider">
              Request new setup link
            </Button>
          </a>
        </div>
      )}

      {phase === "ready" && (
        <>
          <div className="text-center">
            <h2 className="text-xl font-black tracking-tight">
              {fullName ? `Welcome, ${fullName.split(" ")[0]}` : "Welcome"}
            </h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Set a password for your private coaching dashboard.
            </p>
          </div>
          <form onSubmit={submit} className="mt-6 w-full space-y-4">
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Email</Label>
              <Input value={email} disabled className="mt-1.5" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Create password</Label>
              <Input type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" placeholder="Min 8 characters" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirm password</Label>
              <Input type="password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5" />
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow">
              {busy ? "Creating…" : "Create my account"}
            </Button>
          </form>
        </>
      )}

      {phase === "done" && <p className="text-center text-sm text-muted-foreground">Taking you to your dashboard…</p>}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="pointer-events-none absolute -bottom-40 -left-40 h-[500px] w-[500px] rounded-full bg-primary/5 blur-[120px]" />
      <div className="flex min-h-screen items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-full bg-gradient-primary text-sm font-black text-primary-foreground shadow-glow">JF</div>
            <span className="text-lg font-black tracking-tight">JF EFFECT</span>
          </div>
          <Card className="border-border bg-card/60 p-6 backdrop-blur-sm">{children}</Card>
          <p className="mt-6 text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
            Private Client Portal
          </p>
        </div>
      </div>
    </main>
  );
}