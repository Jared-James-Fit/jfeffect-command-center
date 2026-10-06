import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Suspense, useEffect, useRef, useState } from "react";
import { lazyWithRetry } from "@/lib/lazy-chunk";
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
import { FileSignature } from "lucide-react";
import { getAgreementSigningContext } from "@/lib/coaching-agreement.functions";
import { PASSWORD_RULES, passwordIsValid } from "@/lib/account-recovery.constants";
import { opensOnContinue, readAuthLinkSearch, supabasePreconnectLinks } from "@/lib/auth-link-page";

// The signing flow carries the full agreement text, so it only loads when this step is reached.
const AgreementSignFlow = lazyWithRetry(() =>
  import("@/components/coaching-agreement/agreement-sign-flow").then((m) => ({
    default: m.AgreementSignFlow,
  })),
);

export const Route = createFileRoute("/setup")({
  validateSearch: readAuthLinkSearch,
  head: () => ({ meta: [{ title: "Set up your account — JF Effect" }], links: supabasePreconnectLinks() }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const search = Route.useSearch();
  // A link with its token opens straight on Continue, rendered by the server, instead of
  // a "Verifying your link…" placeholder that stays up while the app loads.
  const [phase, setPhase] = useState<
    "loading" | "confirm" | "ready" | "agreement" | "social" | "expired" | "done"
  >(opensOnContinue(search) ? "confirm" : "loading");
  // Continue only works once the app has started; until then the button says so.
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [isCoachInvite, setIsCoachInvite] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [socials, setSocials] = useState<Record<string, string | null>>({});
  const acceptCoachFn = useServerFn(acceptCoachInvite);
  const getAgreementContext = useServerFn(getAgreementSigningContext);
  const [signOpen, setSignOpen] = useState(false);
  const signedRef = useRef(false);

  useEffect(() => {
    // SECURITY: Never trust a pre-existing session here. If an admin (or any
    // other user) is already signed in, using their session would let this
    // page change THEIR password / metadata via updateUser(). Always require
    // a fresh invite/magic-link token from the URL and sign out any other
    // session before consuming it.
    let cancelled = false;
    let unsubscribe: (() => void) | null = null;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const tokenHash = params.get("token_hash");
      const hash = window.location.hash || "";
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const hashType = hashParams.get("type");
      const hasInviteHash =
        !!hashParams.get("access_token") &&
        (hashType === "invite" || hashType === "magiclink" || hashType === "signup" || hashType === "recovery");

      if (!tokenHash && !hasInviteHash) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!cancelled) setPhase("expired");
        return;
      }

      if (tokenHash) {
        // Clear any other account's session; verifyTokenHash does it again right before
        // the exchange, so the Continue screen doesn't wait on it.
        void supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!cancelled) setPhase("confirm");
        return;
      }

      // Clear any other account's session before the hash exchange installs the new one.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});

      const sub = supabase.auth.onAuthStateChange((_event, session) => {
        if (cancelled) return;
        if (session?.user) {
          setEmail(session.user.email ?? "");
          setFullName((session.user.user_metadata as any)?.full_name ?? "");
          setIsCoachInvite(((session.user.user_metadata as any)?.invite_role) === "coach");
          setPhase("ready");
        }
      });
      unsubscribe = () => sub.data.subscription.unsubscribe();
      setTimeout(() => {
        if (!cancelled) setPhase((p) => (p === "loading" ? "expired" : p));
      }, 4000);
    })();
    return () => { cancelled = true; if (unsubscribe) unsubscribe(); };
  }, []);

  const verifyTokenHash = async () => {
    setVerifying(true);
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = (params.get("type") || "invite") as any;
    if (!tokenHash) { setVerifying(false); setPhase("expired"); return; }
    // Defense in depth: clear any session immediately before token exchange.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    setVerifying(false);
    if (error) { setPhase("expired"); return; }
    if (data.user) {
      setEmail(data.user.email ?? "");
      setFullName((data.user.user_metadata as any)?.full_name ?? "");
      setIsCoachInvite(((data.user.user_metadata as any)?.invite_role) === "coach");
      setPhase("ready");
    }
    // Clean the URL so a refresh doesn't try to re-use a now-spent token.
    window.history.replaceState({}, "", window.location.pathname);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordIsValid(password)) return toast.error(`Use at least ${PASSWORD_RULES.minLength} characters`);
    if (password !== confirm) return toast.error("Passwords don't match");
    // SECURITY: confirm we're operating on the user we verified, not some
    // pre-existing session.
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Your setup link is no longer valid. Please request a new one.");
    if (email && u.user.email && email.toLowerCase() !== u.user.email.toLowerCase()) {
      return toast.error("Session mismatch. Please open the setup link again.");
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) { setBusy(false); return toast.error(error.message); }
    if (isCoachInvite) {
      try { await acceptCoachFn({ data: undefined as any }); } catch { /* non-fatal */ }
    }
    toast.success("Password saved.");
    if (isCoachInvite) {
      setBusy(false);
      setPhase("done");
      setTimeout(() => navigate({ to: "/admin", replace: true }), 500);
      return;
    }
    await continueAfterPassword();
    setBusy(false);
  };

  // After the password: offer the Coaching Agreement (part of account setup). Anything
  // that isn't a client who still needs to sign carries straight on to the next step.
  const continueAfterPassword = async () => {
    try {
      const ctx = await getAgreementContext();
      if (ctx.state.state === "needs_signature") {
        setPhase("agreement");
        return;
      }
    } catch {
      /* not a client, or unavailable: carry on */
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
            disabled={verifying || !hydrated}
            className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
          >
            {!hydrated ? "Loading…" : verifying ? "Verifying…" : "Continue setup"}
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
              <PasswordInput required value={password} onChange={(e) => setPassword(e.target.value)} className="mt-1.5" placeholder={`At least ${PASSWORD_RULES.minLength} characters`} autoComplete="new-password" />
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

      {phase === "agreement" && (
        <div className="space-y-5 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-primary/10 text-primary">
            <FileSignature className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-xl font-black tracking-tight">Sign your Coaching Agreement</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every client signs one agreement. It covers every service and purchase, so you only do
              this once. It takes about 2 minutes.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => setSignOpen(true)}
              className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
            >
              Review &amp; sign
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => setPhase("social")}
              className="w-full"
            >
              I'll do this later
            </Button>
          </div>
          <p className="text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
            You'll see a reminder in the app until it's signed.
          </p>
        </div>
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

      {phase === "agreement" && (
        <Suspense fallback={null}>
          <AgreementSignFlow
            open={signOpen}
            onSigned={() => {
              signedRef.current = true;
            }}
            onOpenChange={(next) => {
              setSignOpen(next);
              // Once signed and closed, carry on to the next setup step.
              if (!next && signedRef.current) setPhase("social");
            }}
          />
        </Suspense>
      )}
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