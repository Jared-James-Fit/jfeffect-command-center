import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/lib/auth";
import { decodeJwtClaims, mfaGateStep, roleRequiresMfa, verifiedFactorCount } from "@/lib/mfa-rules";
import { firstAuthenticatorId, mfaErrorMessage, verifyTotp } from "@/lib/mfa";
import { CodeInput } from "@/components/two-step/code-input";
import { TotpSetup } from "@/components/two-step/totp-setup";

/**
 * Two-step sign-in (mfa-rules.ts), over every signed-in page. Decided from
 * the session already in hand (its token's level and the login's verified
 * authenticators), so a client or member passes straight through with no
 * extra request. A login that has an authenticator enters its code once per
 * sign-in on each device; the admin and finance logins set one up the first
 * time. Nothing behind it renders until then: the server and the database
 * would refuse it anyway.
 */
export function StaffMfaGate({ children }: { children: ReactNode }) {
  const { session, accountRole } = useAuth();
  const aal = useMemo(() => decodeJwtClaims(session?.access_token)?.aal ?? null, [session?.access_token]);
  const step = mfaGateStep({ accountRole, aal, verifiedFactors: verifiedFactorCount(session?.user as any) });
  // Supabase's own answer overrides a session that hasn't caught up: no
  // authenticator after all (and none needed), or one just added in a
  // session that has already had its code.
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  if (!session || step === "pass" || clearedFor === session.user.id) return <>{children}</>;
  return (
    <TwoStepScreen
      step={step}
      sessionVerified={aal === "aal2"}
      onNotNeeded={roleRequiresMfa(accountRole) ? undefined : () => setClearedFor(session.user.id)}
      onAlreadyDone={() => setClearedFor(session.user.id)}
    />
  );
}

function TwoStepScreen({ step, sessionVerified, onNotNeeded, onAlreadyDone }: {
  step: "verify" | "enroll";
  sessionVerified: boolean;
  onNotNeeded?: () => void;
  onAlreadyDone: () => void;
}) {
  const { user, accountRole, signOut } = useAuth();
  const qc = useQueryClient();
  // The session's own list can be a step behind (an authenticator added on
  // another device): ask Supabase which it really is before showing either.
  const [mode, setMode] = useState<"checking" | "verify" | "enroll">("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    firstAuthenticatorId()
      .then((id) => {
        if (cancelled) return;
        if (!id && onNotNeeded) return onNotNeeded();
        // One just added, in a session that has had its code: nothing to ask.
        if (id && sessionVerified) return onAlreadyDone();
        setFactorId(id);
        setMode(id ? "verify" : "enroll");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(mfaErrorMessage(e, "Couldn't check two-step sign-in. Check your connection and try again."));
        setMode(step);
      });
    return () => { cancelled = true; };
  }, [step]);

  async function afterVerified(message?: string) {
    // Anything asked for with the password-only session was refused: ask again.
    await qc.invalidateQueries();
    if (message) toast.success(message);
  }

  async function submit(value = code) {
    if (!factorId || value.length !== 6 || busy) return;
    setBusy(true);
    try {
      await verifyTotp(factorId, value);
      await afterVerified();
    } catch (e) {
      setCode("");
      toast.error(mfaErrorMessage(e, "That code didn't work. Type the newest one from the app."));
    } finally {
      setBusy(false);
    }
  }

  const lostHelp =
    accountRole === "finance"
      ? "Lost your phone? A backup authenticator works too. If you've lost every one, ask Jared to reset it."
      : "Lost your phone? A backup authenticator works too. If you've lost every one, it can be reset from the app's database in Lovable.";

  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background p-4" data-two-step-gate={mode}>
      <Card className="w-full max-w-md space-y-5 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{mode === "enroll" ? "Set up two-step sign-in" : "Enter your code"}</h1>
            {user?.email && <p className="truncate text-sm text-muted-foreground">{user.email}</p>}
          </div>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}

        {mode === "checking" && (
          <div className="grid h-24 place-items-center" aria-busy="true">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {mode === "enroll" && (
          <>
            <p className="text-sm text-muted-foreground">
              Your login can see every client's records and the business's money, so it needs a code from an
              authenticator app as well as your password. You'll enter a code when you sign in on a new device,
              not every time you open the app.
            </p>
            <TotpSetup submitLabel="Turn it on" onDone={() => afterVerified("Two-step sign-in is on")} />
          </>
        )}

        {mode === "verify" && (
          <>
            <p className="text-sm text-muted-foreground">Open your authenticator app and type the 6-digit code for JF Effect.</p>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
              <CodeInput value={code} onChange={setCode} onComplete={(v) => void submit(v)} disabled={busy} />
              <Button type="submit" className="h-11 w-full" disabled={busy || code.length !== 6}>
                {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Checking…</> : "Continue"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{lostHelp}</p>
          </>
        )}

        <Button variant="ghost" className="h-10 w-full" onClick={() => void signOut()}>
          Sign out
        </Button>
      </Card>
    </div>
  );
}
