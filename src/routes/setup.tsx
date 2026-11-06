import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SlowLoadHint } from "@/components/slow-load-hint";
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
import { requestNewSetupLink } from "@/lib/clients.functions";
import { FileSignature } from "lucide-react";
import { getAgreementSigningContext } from "@/lib/coaching-agreement.functions";
import { shareMeta } from "@/lib/share-meta";
import { SetupInviteStep } from "@/components/setup-invite-step";
import { cleanInviteParam } from "@/lib/setup-invite";
import type { User } from "@supabase/supabase-js";

// The signing flow carries the full agreement text, so it only loads when this step is reached.
const AgreementSignFlow = lazyWithRetry(() =>
  import("@/components/coaching-agreement/agreement-sign-flow").then((m) => ({
    default: m.AgreementSignFlow,
  })),
);

export const Route = createFileRoute("/setup")({
  head: () => ({ meta: [{ title: "Set up your account — JF Effect" }, ...shareMeta({ title: "Set up your JF Effect account", description: "Finish setting up your account to get started." })] }),
  component: SetupPage,
});

function SetupPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<
    "loading" | "invite" | "confirm" | "ready" | "agreement" | "expired" | "done"
  >("loading");
  // Every setup link carries the client's invite (setup-invite.ts): it starts the
  // setup, and takes over when an emailed one-time token has run out.
  const [inviteToken, setInviteToken] = useState<string | null>(null);
  const [autoContinue, setAutoContinue] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [email, setEmail] = useState<string>("");
  const [fullName, setFullName] = useState<string>("");
  const [isCoachInvite, setIsCoachInvite] = useState(false);
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
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
      const invite = cleanInviteParam(params.get("invite"));
      if (invite && !cancelled) setInviteToken(invite);
      const hash = window.location.hash || "";
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const hashType = hashParams.get("type");
      const hasInviteHash =
        !!hashParams.get("access_token") &&
        (hashType === "invite" || hashType === "magiclink" || hashType === "signup" || hashType === "recovery");

      if (!tokenHash && !hasInviteHash) {
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!cancelled) setPhase(invite ? "invite" : "expired");
        return;
      }

      // Clear any other account's session before exchanging the token.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});

      if (tokenHash) {
        if (!cancelled) setPhase("confirm");
        return;
      }

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
    if (error || !data.user) {
      // Expired or already used (an email scanner, an earlier tap): the invite carries on.
      if (inviteToken) {
        window.history.replaceState({}, "", `${window.location.pathname}?invite=${encodeURIComponent(inviteToken)}`);
        setAutoContinue(true);
        setPhase("invite");
      } else {
        setPhase("expired");
      }
      return;
    }
    signedIn(data.user);
  };

  const signedIn = (user: User) => {
    setEmail(user.email ?? "");
    setFullName((user.user_metadata as any)?.full_name ?? "");
    setIsCoachInvite(((user.user_metadata as any)?.invite_role) === "coach");
    setPhase("ready");
    // Clean the URL so a refresh doesn't try to re-use a now-spent token.
    window.history.replaceState({}, "", window.location.pathname);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password) return toast.error("Please enter a password");
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
    finishToPortal();
  };

  const finishToPortal = () => {
    setPhase("done");
    toast.success("Welcome to JF Effect.");
    setTimeout(() => navigate({ to: "/portal", replace: true }), 500);
  };

  return (
    <Shell>
      {phase === "loading" && (
              <div className="space-y-1">
                <p className="text-sm text-muted-foreground">Verifying your link…</p>
                <SlowLoadHint />
              </div>
            )}

      {phase === "invite" && inviteToken && (
        <SetupInviteStep
          token={inviteToken}
          autoContinue={autoContinue}
          onInvalid={() => setPhase("expired")}
          onSignedIn={signedIn}
        />
      )}

      {phase === "confirm" && (
        <div className="space-y-4 text-center">
          <h2 className="text-xl font-bold tracking-tight">Welcome to JF Effect</h2>
          <p className="text-sm text-muted-foreground">
            Tap continue to set up your account.
          </p>
          <Button
            onClick={verifyTokenHash}
            disabled={verifying}
            className="w-full bg-primary py-6 text-sm font-semibold"
          >
            {verifying ? "Verifying…" : "Continue setup"}
          </Button>
        </div>
      )}

      {phase === "expired" && <NewLinkForm />}

      {phase === "ready" && (
        <>
          <div className="text-center">
            <h2 className="text-xl font-semibold tracking-tight">
              {fullName ? `Welcome, ${fullName.split(" ")[0]}` : "Welcome"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Pick a password. You'll use it with {email || "your email"} to sign in.
            </p>
          </div>
          <form onSubmit={submit} className="mt-6 w-full space-y-4">
            {/* The email rides along hidden so the phone's password manager saves the pair. */}
            <input type="email" name="email" autoComplete="username" value={email} readOnly hidden />
            <div>
              <Label htmlFor="setup-password">Password</Label>
              <PasswordInput
                id="setup-password"
                name="password"
                autoComplete="new-password"
                autoFocus
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1.5 h-12 text-base"
                placeholder="Pick any password"
              />
            </div>
            <Button type="submit" disabled={busy} className="min-h-[48px] w-full font-semibold">
              {busy ? "Creating…" : "Create my account"}
            </Button>
          </form>
        </>
      )}

      {phase === "agreement" && (
        <div className="space-y-5 text-center">
          <div className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-muted">
            <FileSignature className="h-7 w-7" />
          </div>
          <div>
            <h2 className="text-xl font-bold tracking-tight">Sign your Coaching Agreement</h2>
            <p className="mt-2 text-sm text-muted-foreground">
              Every client signs one agreement. It covers every service and purchase, so you only do
              this once. It takes about 2 minutes.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => setSignOpen(true)}
              className="w-full bg-primary py-6 text-sm font-semibold"
            >
              Review &amp; sign
            </Button>
            <Button
              type="button"
              variant="ghost"
              onClick={finishToPortal}
              className="min-h-10 w-full"
            >
              I'll do this later
            </Button>
          </div>
          <p className="text-center text-[10px] uppercase tracking-widest text-muted-foreground/60">
            You'll see a reminder in the app until it's signed.
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
              // Once signed and closed, straight into the app.
              if (!next && signedRef.current) finishToPortal();
            }}
          />
        </Suspense>
      )}
    </Shell>
  );
}

/**
 * A setup link that has run out: they ask for a fresh one by email. Always the
 * same answer, so it never says whether an email is on an account.
 */
function NewLinkForm() {
  const request = useServerFn(requestNewSetupLink);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await request({ data: { email: email.trim() } });
      setSent(true);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };
  if (sent) {
    return (
      <div className="space-y-3 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          If {email.trim()} is on a JF Effect account, a new link is on its way. Not there in a minute? Check Junk or Spam.
        </p>
      </div>
    );
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">This link has run out</h2>
        <p className="mt-1 text-sm text-muted-foreground">Enter your email and we'll send you a new one.</p>
      </div>
      <div>
        <Label htmlFor="new-link-email">Email</Label>
        <Input
          id="new-link-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          className="mt-1.5 h-12 text-base"
        />
      </div>
      <Button type="submit" disabled={busy} className="min-h-[48px] w-full font-semibold">
        {busy ? "Sending…" : "Email me a new link"}
      </Button>
      {error && <p className="text-center text-sm text-destructive" role="alert">{error}</p>}
      <p className="text-center text-xs text-muted-foreground">Or ask your coach to text you a new one.</p>
    </form>
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
            <span className="text-lg font-bold tracking-tight">JF EFFECT</span>
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