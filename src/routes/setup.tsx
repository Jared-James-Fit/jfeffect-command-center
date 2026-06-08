import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { acceptCoachInvite } from "@/lib/coaches.functions";
import { SocialHandlesEditor } from "@/components/social-handles-editor";
import { SOCIAL_FIELDS } from "@/lib/social-handles";

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Set up your account — JF Effect" }] }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"loading" | "confirm" | "ready" | "social" | "expired" | "done">("loading");
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [isCoachInvite, setIsCoachInvite] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [socials, setSocials] = useState<Record<string, string | null>>({});
  const acceptCoachFn = useServerFn(acceptCoachInvite);

  useEffect(() => {
    const sub = supabase.auth.onAuthStateChange((_event, session) => {
      if (session?.user) {
        setEmail(session.user.email ?? "");
        setFullName((session.user.user_metadata as any)?.full_name ?? "");
        setIsCoachInvite(((session.user.user_metadata as any)?.invite_role) === "coach");
        setPhase("ready");
      }
    });
    // Look for a token_hash query param (our copy-link flow that defeats
    // email/SMS link prefetchers). If present, wait for the user to click
    // Continue before calling verifyOtp.
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    if (tokenHash) {
      setPhase("confirm");
    } else {
      // Otherwise fall back to the hash-based magic link flow (emailed links).
      supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user) {
          setEmail(data.session.user.email ?? "");
          setFullName((data.session.user.user_metadata as any)?.full_name ?? "");
          setIsCoachInvite(((data.session.user.user_metadata as any)?.invite_role) === "coach");
          setPhase("ready");
        } else {
          setTimeout(() => {
            setPhase((p) => (p === "loading" ? "expired" : p));
          }, 1500);
        }
      });
    }
    return () => sub.data.subscription.unsubscribe();
  }, []);

  const verifyTokenHash = async () => {
    setVerifying(true);
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = (params.get("type") || "invite") as any;
    if (!tokenHash) { setVerifying(false); setPhase("expired"); return; }
    const { error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    setVerifying(false);
    if (error) { setPhase("expired"); return; }
    // Clean the URL so a refresh doesn't try to re-use a now-spent token.
    window.history.replaceState({}, "", window.location.pathname);
    // onAuthStateChange will flip phase to "ready".
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return toast.error("Please enter a password");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setBusy(false); return toast.error(error.message); }
    if (isCoachInvite) {
      try { await acceptCoachFn({ data: undefined as any }); } catch { /* non-fatal */ }
    }
    setBusy(false);
    toast.success("Password saved.");
    if (isCoachInvite) {
      setPhase("done");
      setTimeout(() => navigate({ to: "/admin", replace: true }), 500);
      return;
    }
    setPhase("social");
  };

  const finishToPortal = () => {
    setPhase("done");
    toast.success("Welcome to JF Effect.");
    setTimeout(() => navigate({ to: "/portal", replace: true }), 500);
  };

  const saveSocialsAndContinue = async () => {
    setBusy(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const uid = sessionData.session?.user?.id;
    if (!uid) { setBusy(false); finishToPortal(); return; }
    const patch: Record<string, string | null> = {};
    let hasAny = false;
    for (const f of SOCIAL_FIELDS) {
      const v = (socials[f] ?? "").toString().trim();
      if (v) { patch[f] = v; hasAny = true; } else { patch[f] = null; }
    }
    if (hasAny) {
      const { error } = await supabase.from("clients").update(patch as any).eq("user_id", uid);
      if (error) {
        setBusy(false);
        return toast.error(error.message);
      }
    }
    setBusy(false);
    finishToPortal();
  };

  return (
    <Shell>
      {phase === "loading" && <p className="text-sm text-muted-foreground">Verifying your link…</p>}

      {phase === "confirm" && (
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-black tracking-tight">Welcome to JF Effect</h2>
          <p className="text-sm text-muted-foreground">
            Tap continue to set up your account.
          </p>
          <Button
            onClick={verifyTokenHash}
            disabled={verifying}
            className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
          >
            {verifying ? "Verifying…" : "Continue setup"}
          </Button>
        </div>
      )}

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
              <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" placeholder="Pick any password" />
            </div>
            <div>
              <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirm password</Label>
              <PasswordInput required value={confirm} onChange={(e) => setConfirm(e.target.value)} className="mt-1.5" />
            </div>
            <Button type="submit" disabled={busy} className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow">
              {busy ? "Creating…" : "Create my account"}
            </Button>
          </form>
        </>
      )}

      {phase === "social" && (
        <div className="space-y-5">
          <div className="text-center">
            <h2 className="text-xl font-black tracking-tight">Social Media (optional)</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              Add just your username/handle for any platform you use. Skip any you don't.
            </p>
          </div>
          <SocialHandlesEditor
            disabled={busy}
            values={socials}
            onChange={(k, v) => setSocials((s) => ({ ...s, [k]: v }))}
          />
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={saveSocialsAndContinue}
              disabled={busy}
              className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
            >
              {busy ? "Saving…" : "Save & continue"}
            </Button>
            <Button type="button" variant="ghost" onClick={finishToPortal} disabled={busy} className="w-full">
              Skip for now
            </Button>
          </div>
          <p className="text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
            You can update these anytime in Account Settings.
          </p>
        </div>
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
            <img src="/logo.png" alt="JF Effect" className="h-11 w-11 rounded-xl shadow-glow" />
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