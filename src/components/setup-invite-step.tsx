/**
 * /setup?invite=… : a setup link the coach sent before there was an email on
 * file (setup-invite.ts). The person adds their email (or confirms the one on
 * file, shown masked) and we send the usual setup email; its link is what
 * signs them in, so the email is theirs.
 */
import { useEffect, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MailCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { peekSetupInvite, requestSetupFromInvite } from "@/lib/clients.functions";
import type { SetupInviteState } from "@/lib/setup-invite";

export function SetupInviteStep({ token, onInvalid }: { token: string; onInvalid: () => void }) {
  const peek = useServerFn(peekSetupInvite);
  const request = useServerFn(requestSetupFromInvite);
  const [info, setInfo] = useState<SetupInviteState | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<string | null>(null);

  const load = () => {
    setLoadFailed(false);
    peek({ data: { token } })
      .then((res) => {
        if (res.state === "invalid") onInvalid();
        else setInfo(res);
      })
      .catch(() => setLoadFailed(true));
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(load, [token]);

  const send = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await request({ data: { token, email: email.trim() || undefined } });
      setSentTo(res.sentTo ?? null);
    } catch (err: any) {
      setError(err?.message ?? "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

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

  if (sentTo) {
    return (
      <div className="space-y-4 text-center">
        <div className="mx-auto grid h-12 w-12 place-items-center rounded-2xl bg-muted">
          <MailCheck className="h-6 w-6" />
        </div>
        <h2 className="text-xl font-semibold tracking-tight">Check your email</h2>
        <p className="text-sm text-muted-foreground">
          We sent your setup link to <span className="font-medium text-foreground">{sentTo}</span>. Tap it to set your password.
        </p>
        <p className="text-xs text-muted-foreground">Not there in a minute? Check Junk or Spam.</p>
        <Button variant="outline" disabled={busy} onClick={() => void send()} className="min-h-[48px] w-full">
          {busy ? "Sending…" : "Send it again"}
        </Button>
        {error && <p className="text-sm text-destructive" role="alert">{error}</p>}
      </div>
    );
  }

  const hello = info.firstName ? `Welcome, ${info.firstName}` : "Welcome to JF Effect";
  return (
    <form onSubmit={send} className="space-y-4">
      <div className="text-center">
        <h2 className="text-xl font-semibold tracking-tight">{hello}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {info.emailHint
            ? <>We'll email your setup link to <span className="font-medium text-foreground">{info.emailHint}</span>.</>
            : "Add your email to set up your account. We'll send you a link to set your password."}
        </p>
      </div>
      {!info.emailHint && (
        <div>
          <Label htmlFor="setup-invite-email">Email</Label>
          <Input
            id="setup-invite-email"
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
      )}
      <Button type="submit" disabled={busy} className="min-h-[48px] w-full font-semibold">
        {busy ? "Sending…" : info.emailHint ? "Email me my setup link" : "Send my setup link"}
      </Button>
      {error && <p className="text-center text-sm text-destructive" role="alert">{error}</p>}
    </form>
  );
}
