/**
 * /activate: where an approved applicant's link lands (membership-apply.ts).
 *
 * From the email (`k`, the inbox is proven): pick a password and you're in.
 * From a link Jared DM'd or texted: we email a 6-digit code first, so a link
 * that reached the wrong person can't take someone else's inbox. Then Jared's
 * welcome, with the one first move that fits their goal, and into the app.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowRight, Loader2, MailCheck, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { AuthShell, AuthLogo } from "@/components/auth/auth-shell";
import { PasswordInput } from "@/components/ui/password-input";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SIGNUP_ACK_MISSING } from "@/lib/legal-signup";
import { AiConsentCheckbox, recordAiConsentChoice } from "@/components/ai-consent/ai-consent";
import { cn } from "@/lib/utils";
import { SOCIAL } from "@/lib/social-links";
import {
  activateMembership,
  peekActivation,
  sendActivationCode,
  verifyActivationCode,
  type ActivationView,
} from "@/lib/membership-applications.functions";
import { firstMove, welcomeNote } from "@/lib/membership-apply";
import jaredFace from "@/assets/landing/jared-face.jpg";

type Phase =
  | { kind: "loading" }
  | { kind: "view"; view: ActivationView }
  | { kind: "code"; sentTo: string | null }
  | { kind: "password"; email: string; firstName: string }
  | { kind: "welcome"; firstName: string; goal: string; experience: string; signedIn: boolean };

const BTN =
  "flex h-[54px] w-full items-center justify-center gap-2 rounded-2xl bg-primary text-[17px] font-semibold text-primary-foreground transition active:scale-[0.985] disabled:opacity-60";

export function ActivatePage({
  token,
  proof: initialProof,
}: {
  token: string | null;
  proof: string | null;
}) {
  const navigate = useNavigate();
  const peek = useServerFn(peekActivation);
  const sendCode = useServerFn(sendActivationCode);
  const verify = useServerFn(verifyActivationCode);
  const activate = useServerFn(activateMembership);
  const [phase, setPhase] = useState<Phase>({ kind: "loading" });
  const [proof, setProof] = useState<string | null>(initialProof);
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  // optional and separate from agreeing: AI processing (src/lib/ai-consent), unticked to start
  const [aiAllowed, setAiAllowed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resendIn, setResendIn] = useState(0);
  const okView = useRef<Extract<ActivationView, { state: "ok" }> | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!token) {
        setPhase({ kind: "view", view: { state: "invalid" } });
        return;
      }
      // the proof never stays in the address bar (or a screenshot of it)
      if (initialProof)
        window.history.replaceState(
          {},
          "",
          `${window.location.pathname}?a=${encodeURIComponent(token)}`,
        );
      try {
        const view = await peek({ data: { token, proof: initialProof } });
        if (cancelled) return;
        if (view.state === "ok") {
          okView.current = view;
          if (view.proven && view.email)
            setPhase({ kind: "password", email: view.email, firstName: view.firstName });
          else setPhase({ kind: "view", view });
        } else setPhase({ kind: "view", view });
      } catch {
        if (!cancelled) setPhase({ kind: "view", view: { state: "invalid" } });
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((s) => s - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const askCode = async () => {
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await sendCode({ data: { token } });
      setPhase({ kind: "code", sentTo: r.sentTo });
      setResendIn(r.waitSeconds);
    } catch (e: any) {
      setError(e?.message ?? "Couldn't send the code. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const checkCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy) return;
    setBusy(true);
    setError(null);
    try {
      const r = await verify({ data: { token, code: code.trim() } });
      setProof(r.proof);
      setPhase({ kind: "password", email: r.email, firstName: okView.current?.firstName ?? "" });
    } catch (e: any) {
      setError(e?.message ?? "That code didn't work.");
    } finally {
      setBusy(false);
    }
  };

  const finish = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token || busy || phase.kind !== "password") return;
    if (password.length < 8) return setError("Use at least 8 characters.");
    if (!agreed) return setError(SIGNUP_ACK_MISSING);
    setBusy(true);
    setError(null);
    try {
      const r = await activate({ data: { token, proof, password, agreed } });
      // never act on another account that happens to be signed in on this phone
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      const { error: signErr } = await supabase.auth.signInWithPassword({
        email: r.email,
        password,
      });
      // what the optional AI box said, saved with their own session (a new account has no answer yet)
      if (!signErr) await recordAiConsentChoice(aiAllowed);
      setPhase({
        kind: "welcome",
        firstName: r.firstName,
        goal: r.goal,
        experience: r.experience,
        signedIn: !signErr,
      });
      window.scrollTo({ top: 0 });
    } catch (e: any) {
      setError(e?.message ?? "Couldn't finish. Try again.");
    } finally {
      setBusy(false);
    }
  };

  if (phase.kind === "loading") {
    return (
      <AuthShell>
        <div className="text-center">
          <AuthLogo size={64} />
          <Loader2
            className="mx-auto mt-8 h-6 w-6 animate-spin text-muted-foreground"
            aria-label="Opening your invite"
          />
        </div>
      </AuthShell>
    );
  }

  if (phase.kind === "welcome")
    return <Welcome {...phase} onGo={(to) => navigate({ href: to, replace: true })} />;

  if (phase.kind === "password") {
    return (
      <AuthShell>
        <div className="text-center">
          <AuthLogo />
          <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
            {phase.firstName ? `You're in, ${phase.firstName}` : "You're in"}
          </h1>
          <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
            Pick a password. You'll sign in with{" "}
            <span className="font-medium text-foreground">{phase.email}</span>.
          </p>
        </div>
        <form onSubmit={finish} className="mt-7 w-full space-y-3" data-activate-password>
          <input
            type="email"
            name="email"
            autoComplete="username"
            value={phase.email}
            readOnly
            hidden
          />
          <PasswordInput
            name="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => {
              setPassword(e.target.value);
              if (error) setError(null);
            }}
            placeholder="8 or more characters"
            className="h-[54px] rounded-2xl text-[17px]"
            aria-label="Password"
          />
          <div className="flex items-start gap-3 px-1 pt-1" data-signup-agree>
            <Checkbox
              id="signup-agree"
              checked={agreed}
              onCheckedChange={(v) => {
                setAgreed(v === true);
                if (error === SIGNUP_ACK_MISSING) setError(null);
              }}
              className="mt-0.5 h-5 w-5"
              aria-describedby="signup-agree-text"
            />
            <label
              htmlFor="signup-agree"
              id="signup-agree-text"
              className="text-[13px] leading-relaxed text-muted-foreground"
            >
              I agree to the JF Effect{" "}
              <Link to="/terms" target="_blank" className="underline underline-offset-2">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link to="/privacy" target="_blank" className="underline underline-offset-2">
                Privacy Policy
              </Link>
              .
            </label>
          </div>
          <AiConsentCheckbox id="signup-ai" checked={aiAllowed} onChange={setAiAllowed} className="px-1" />
          {error && <p className="text-center text-[13px] text-destructive">{error}</p>}
          <button type="submit" disabled={busy} className={BTN}>
            {busy ? (
              <Loader2 className="h-5 w-5 animate-spin" aria-label="Setting up your account" />
            ) : (
              "Create my account"
            )}
          </button>
        </form>
      </AuthShell>
    );
  }

  if (phase.kind === "code") {
    return (
      <AuthShell>
        <div className="text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-muted">
            <MailCheck className="h-7 w-7" aria-hidden />
          </div>
          <h1 className="mt-6 text-[26px] font-semibold leading-tight tracking-[-0.02em]">
            Check your email
          </h1>
          <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
            We sent a 6-digit code to{" "}
            <span className="font-medium text-foreground">{phase.sentTo ?? "your email"}</span>.
          </p>
        </div>
        <form onSubmit={checkCode} className="mt-7 w-full space-y-3" data-activate-code>
          <Input
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
            maxLength={6}
            placeholder="123456"
            value={code}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, "").slice(0, 6));
              if (error) setError(null);
            }}
            className="h-14 rounded-2xl text-center text-[24px] tracking-[0.4em]"
            aria-label="Code from the email"
          />
          {error && <p className="text-center text-[13px] text-destructive">{error}</p>}
          <button type="submit" disabled={busy || code.length !== 6} className={BTN}>
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : "Confirm"}
          </button>
          <button
            type="button"
            onClick={askCode}
            disabled={busy || resendIn > 0}
            className="h-11 w-full rounded-2xl text-[15px] font-medium text-muted-foreground disabled:opacity-60"
          >
            {resendIn > 0 ? `Send a new code in ${resendIn}s` : "Send a new code"}
          </button>
        </form>
      </AuthShell>
    );
  }

  const view = phase.view;
  if (view.state === "ok") {
    return (
      <AuthShell>
        <div className="text-center">
          <AuthLogo />
          <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
            {view.firstName ? `Welcome, ${view.firstName}` : "Welcome"}
          </h1>
          <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
            I approved your membership. First, confirm it's you: I'll email a code to{" "}
            <span className="font-medium text-foreground">{view.emailHint ?? "your email"}</span>.
          </p>
        </div>
        <div className="mt-7 space-y-3">
          {error && <p className="text-center text-[13px] text-destructive">{error}</p>}
          <button
            type="button"
            onClick={askCode}
            disabled={busy}
            className={BTN}
            data-activate-send-code
          >
            {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : "Email me a code"}
          </button>
          <p className="text-center text-[13px] text-muted-foreground">
            Not your email? Message me and I'll fix it.
          </p>
        </div>
      </AuthShell>
    );
  }

  const copy: Record<
    Exclude<ActivationView["state"], "ok">,
    { title: string; body: string; cta: "signin" | "dm" }
  > = {
    invalid: {
      title: "This link doesn't work",
      body: "It may have expired or been replaced by a newer one. Message me and I'll send you a fresh link.",
      cta: "dm",
    },
    pending: {
      title: "Not approved yet",
      body: "I haven't approved your application yet. You'll get an email the moment I do.",
      cta: "dm",
    },
    joined: {
      title: "You're already set up",
      body: "Sign in with your email and the password you picked.",
      cta: "signin",
    },
    has_account: {
      title: "You already have an account",
      body: "That email is already a JF Effect account. Sign in to get to your training.",
      cta: "signin",
    },
    coach_record: {
      title: "Your coach already set you up",
      body: "There's an account waiting for this email. Message me and I'll send your setup link.",
      cta: "dm",
    },
  };
  const c = copy[view.state];
  return (
    <AuthShell>
      <div className="text-center" data-activate-state={view.state}>
        <AuthLogo size={64} />
        <h1 className="mt-6 text-[24px] font-semibold leading-tight tracking-[-0.02em]">
          {c.title}
        </h1>
        <p className="mx-auto mt-2 max-w-[320px] text-[15px] leading-relaxed text-muted-foreground">
          {c.body}
        </p>
        <div className="mt-7 space-y-2">
          {c.cta === "signin" ? (
            <>
              <Link to="/auth" className={BTN}>
                Sign in
              </Link>
              <Link
                to="/recover"
                className="flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-medium text-muted-foreground"
              >
                Forgot your password?
              </Link>
            </>
          ) : (
            <>
              <a href={SOCIAL.instagram.url} className={BTN}>
                Message me
              </a>
              <Link
                to="/auth"
                className="flex h-12 w-full items-center justify-center rounded-2xl text-[15px] font-medium text-muted-foreground"
              >
                Sign in
              </Link>
            </>
          )}
        </div>
      </div>
    </AuthShell>
  );
}

/** Jared's welcome: who's talking, a few lines in his voice, and the one thing to do first. */
function Welcome({
  firstName,
  goal,
  experience,
  signedIn,
  onGo,
}: {
  firstName: string;
  goal: string;
  experience: string;
  signedIn: boolean;
  onGo: (to: string) => void;
}) {
  const note = welcomeNote(firstName, goal);
  const move = firstMove(goal, experience);
  return (
    <AuthShell>
      <div data-activate-welcome>
        <div className="flex items-center gap-3">
          <img
            src={jaredFace}
            alt="Jared McIntyre"
            width={56}
            height={56}
            className="h-14 w-14 rounded-full object-cover"
          />
          <div>
            <div className="text-[16px] font-semibold">Jared McIntyre</div>
            <div className="text-[13px] text-muted-foreground">Founder & head coach</div>
          </div>
        </div>
        <h1 className="mt-6 text-[28px] font-semibold leading-tight tracking-[-0.02em]">
          {note[0]}
        </h1>
        <div className="mt-3 space-y-3 text-[16px] leading-relaxed text-muted-foreground">
          {note.slice(1).map((p) => (
            <p key={p}>{p}</p>
          ))}
        </div>

        <div className="mt-7 rounded-2xl bg-card p-5 ring-1 ring-border/70">
          <div className="text-[13px] font-semibold text-muted-foreground">Your first move</div>
          <div className="mt-1 text-[18px] font-semibold">{move.title}</div>
          <p className="mt-1 text-[15px] leading-relaxed text-muted-foreground">{move.body}</p>
          {signedIn ? (
            <button
              type="button"
              onClick={() => onGo(move.to)}
              className={cn(BTN, "mt-4")}
              data-activate-first-move
            >
              {move.cta} <ArrowRight className="h-5 w-5" aria-hidden />
            </button>
          ) : (
            <Link to="/auth" className={cn(BTN, "mt-4")}>
              Sign in to start
            </Link>
          )}
        </div>
        {signedIn && (
          <button
            type="button"
            onClick={() => onGo("/portal/community")}
            className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-medium text-muted-foreground"
          >
            <Users className="h-4 w-4" aria-hidden /> Say hi in the Crew first
          </button>
        )}
      </div>
    </AuthShell>
  );
}
