/**
 * /setup?invite=… (setup-invite.ts): the start of every setup link.
 *
 * - continue: the coach entered their email, so Continue signs them in at once.
 * - email: no email yet; they type theirs and we email it a code.
 * - code: they enter that code (or tap the email's button); only the code or
 *   the link signs them in, so a mistyped email never gets into the account.
 *
 * Signed in, the page moves on to picking a password (`onSignedIn`).
 */
import { useEffect, useRef, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import type { User } from "@supabase/supabase-js";
import { MailCheck } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  changeSetupEmail,
  peekSetupInvite,
  startSetupFromInvite,
  verifySetupCode,
  type SetupStartResult,
} from "@/lib/clients.functions";
import type { SetupInviteState } from "@/lib/setup-invite";

type Ok = Extract<SetupInviteState, { state: "ok" }>;

export function SetupInviteStep({
  token,
  autoContinue = false,
  onInvalid,
  onSignedIn,
}: {
  token: string;
  /** Carry straight on (an emailed link whose own token had expired). */
  autoContinue?: boolean;
  onInvalid: () => void;
  onSignedIn: (user: User) => void;
}) {
  const peek = useServerFn(peekSetupInvite);
  const start = useServerFn(startSetupFromInvite);
  const verify = useServerFn(verifySetupCode);
  const change = useServerFn(changeSetupEmail);

  const [info, setInfo] = useState<SetupInviteState | null>(null);
  const [step, setStep] = useState<Ok["step"]>("continue");
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [changing, setChanging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resent, setResent] = useState(false);
  const autoRan = useRef(false);

  const load = () => {
    setLoadFailed(false);
    peek({ data: { token } })
      .then((res) => {
        if (res.state === "invalid") return onInvalid();
        setInfo(res);
        if (res.state === "ok") {
          setStep(res.step);
          setSentTo(res.emailHint);
        }
      })
      .catch(() => setLoadFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  const run = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  const afterStart = async (res: SetupStartResult) => {
    if (res.kind === "code") {
      setStep("code");
      setSentTo(res.sentTo);
      setCode("");
      setChanging(false);
      return;
    }
    // Never act on whoever else might be signed in on this browser.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const { data, error: vErr } = await supabase.auth.verifyOtp({ token_hash: res.tokenHash, type: res.type });
    if (vErr || !data.user) throw new Error("Couldn't sign you in. Tap Continue to try again.");
    onSignedIn(data.user);
  };

  const continueNow = () => run(async () => afterStart(await start({ data: { token } })));

  const sendEmail = (e?: React.FormEvent) => {
    e?.preventDefault();
    return run(async () => {
      const res = changing
        ? await change({ data: { token, email: email.trim() } })
        : await start({ data: { token, email: email.trim() } });
      await afterStart(res);
    });
  };

  const submitCode = (value: string) =>
    run(async () => {
      const { accessToken, refreshToken } = await verify({ data: { token, code: value } });
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});
      const { data, error: sErr } = await supabase.auth.setSession({ access_token: accessToken, refresh_token: refreshToken });
      if (sErr || !data.user) throw new Error("Couldn't sign you in. Enter the code again.");
      onSignedIn(data.user);
    });

  const resend = () =>
    run(async () => {
      await afterStart(await start({ data: { token } }));
      setResent(true);
    });

  // An emailed link whose own token had run out: carry on as if they'd tapped Continue.
  useEffect(() => {
    if (!autoContinue || autoRan.current || info?.state !== "ok" || step !== "continue") return;
    autoRan.current = true;
    void continueNow();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoContinue, info, step]);

  if (loadFailed) {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold tracking-tight">Couldn't open your link</h2>
        <p className="text-sm text-muted-foreground">Check your connection and try again.</p>
        <Button onClick={load} className="min-h-[48px] w-full font-semibold">Try again</Button>
      </div>
    );
  }

  if (!info) return <p className="text-center text-sm text-muted-foreground">Opening your link…</p>;

  if (info.state === "signed_in_before") {
    return (
      <div className="space-y-4 text-center">
        <h2 className="text-xl font-semibold tracking-tight">You already have an account</h2>
        <p className="text-sm text-muted-foreground">Sign in with your email and password. Forgot it? Tap Forgot password on the sign-in screen.</p>
        <Button asChild className="min-h-[48px] w-full font-semibold">
          <Link to="/auth">Sign in</Link>
        </Button>
      </div>
    );
  }

  if (info.state !== "ok") return null;
  const hello = info.firstName ? `Welcome, ${info.firstName}` : "Welcome to JF Effect";
  const errorLine = error ? <p className="text-center text-sm text-destructive" role="alert">{error}</p> : null;

  if (step === "code" && !changing) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submitCode(code);
        }}
        className="space-y-4"
      >
        <div className="text-center">
          <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-muted">
            <MailCheck className="h-6 w-6" />
          </div>
          <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter the code we sent{sentTo ? <> to <span className="font-medium text-foreground">{sentTo}</span></> : null}, or tap Set up my account in the email.
          </p>
        </div>
        <div>
          <Label htmlFor="setup-code">Code</Label>
          <Input
            id="setup-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={10}
            autoFocus
            value={code}
            onChange={(e) => {
              const next = e.target.value.replace(/\D/g, "").slice(0, 10);
              // Filled in at once (the phone's code autofill or a paste): go.
              const filled = next.length >= 6 && next.length - code.length > 1;
              setCode(next);
              if (filled) void submitCode(next);
            }}
            placeholder="123456"
            className="mt-1.5 h-12 text-center text-lg tracking-[0.3em]"
          />
        </div>
        <Button type="submit" disabled={busy || code.length < 6} className="min-h-[48px] w-full font-semibold">
          {busy ? "Checking…" : "Continue"}
        </Button>
        {errorLine}
        <div className="flex items-center justify-between gap-2 text-sm">
          <Button type="button" variant="ghost" className="min-h-10 px-2" disabled={busy} onClick={() => void resend()}>
            {resent ? "Sent again" : "Send a new code"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="min-h-10 px-2"
            disabled={busy}
            onClick={() => {
              setChanging(true);
              setError(null);
              setEmail("");
            }}
          >
            Use a different email
          </Button>
        </div>
        <p className="text-center text-xs text-muted-foreground">Not there in a minute? Check Junk or Spam.</p>
      </form>
    );
  }

  if (step === "email" || changing) {
    return (
      <form onSubmit={sendEmail} className="space-y-4">
        <div className="text-center">
          <h2 className="text-xl font-semibold tracking-tight">{hello}</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Add your email to set up your account. We'll send you a code to confirm it.
          </p>
        </div>
        <div>
          <Label htmlFor="setup-invite-email">Email</Label>
          <Input
            id="setup-invite-email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            autoFocus
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            className="mt-1.5 h-12 text-base"
          />
        </div>
        <Button type="submit" disabled={busy} className="min-h-[48px] w-full font-semibold">
          {busy ? "Sending…" : "Send my code"}
        </Button>
        {changing && (
          <Button type="button" variant="ghost" className="min-h-10 w-full" disabled={busy} onClick={() => setChanging(false)}>
            Back
          </Button>
        )}
        {errorLine}
      </form>
    );
  }

  return (
    <div className="space-y-4 text-center">
      <h2 className="text-xl font-semibold tracking-tight">{hello}</h2>
      <p className="text-sm text-muted-foreground">Your account is ready. Tap Continue and pick a password.</p>
      <Button onClick={() => void continueNow()} disabled={busy} className="min-h-[48px] w-full font-semibold">
        {busy ? "Opening…" : "Continue"}
      </Button>
      {errorLine}
    </div>
  );
}
