import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { KeyRound, Loader2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/lib/auth";
import { decodeJwtClaims, mfaGateStep, roleRequiresMfa, verifiedFactorCount } from "@/lib/mfa-rules";
import { firstAuthenticatorId, mfaErrorMessage, verifyTotp } from "@/lib/mfa";
import { normalizeRecoveryCode } from "@/lib/mfa-recovery";
import { redeemRecoveryCode } from "@/lib/mfa-recovery.functions";
import { CodeInput } from "@/components/two-step/code-input";
import { TotpSetup } from "@/components/two-step/totp-setup";
import { RecoveryCodesPanel } from "@/components/two-step/recovery-codes";

/**
 * Two-step sign-in (mfa-rules.ts), over every signed-in page. Decided from
 * the session already in hand (its token's level and the login's verified
 * authenticators), so a client or member passes straight through with no
 * extra request. A login that has an authenticator enters its code once per
 * sign-in on each device; the admin and finance logins set one up the first
 * time, then save their recovery codes. A lost phone is a recovery code
 * (mfa-recovery.ts) or, for a teammate, the owner's reset on Team. Nothing
 * behind it renders until then: the server and the database would refuse it.
 */
export function StaffMfaGate({ children }: { children: ReactNode }) {
  const { session, accountRole, user } = useAuth();
  const aal = useMemo(() => decodeJwtClaims(session?.access_token)?.aal ?? null, [session?.access_token]);
  const step = mfaGateStep({ accountRole, aal, verifiedFactors: verifiedFactorCount(session?.user as any) });
  // Supabase's own answer overrides a session that hasn't caught up: no
  // authenticator after all (and none needed), or one just added in a
  // session that has already had its code.
  const [clearedFor, setClearedFor] = useState<string | null>(null);
  // Just turned on: the recovery codes come next, before the app.
  const [codesFor, setCodesFor] = useState<string | null>(null);
  // Setup couldn't start (Supabase refused): let them in this once rather
  // than lock them out; nothing is enforced until an authenticator exists.
  const [deferredFor, setDeferredFor] = useState<string | null>(null);

  const uid = session?.user?.id ?? null;
  if (uid && codesFor === uid) {
    return (
      <GateCard title="Save your recovery codes" email={user?.email}>
        <RecoveryCodesPanel email={user?.email} onDone={() => setCodesFor(null)} onSkip={() => setCodesFor(null)} />
      </GateCard>
    );
  }
  if (!session || step === "pass" || clearedFor === uid || deferredFor === uid) return <>{children}</>;
  return (
    <TwoStepScreen
      step={step}
      sessionVerified={aal === "aal2"}
      onNotNeeded={roleRequiresMfa(accountRole) ? undefined : () => setClearedFor(uid)}
      onAlreadyDone={() => setClearedFor(uid)}
      onEnrolled={() => setCodesFor(uid)}
      onCantSetUp={() => setDeferredFor(uid)}
    />
  );
}

function GateCard({ title, email, children }: { title: string; email?: string | null; children: ReactNode }) {
  return (
    <div className="grid min-h-[100dvh] place-items-center bg-background p-4">
      <Card className="w-full max-w-md space-y-5 rounded-2xl p-6">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-muted">
            <ShieldCheck className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <h1 className="text-xl font-semibold">{title}</h1>
            {email && <p className="truncate text-sm text-muted-foreground">{email}</p>}
          </div>
        </div>
        {children}
      </Card>
    </div>
  );
}

type Mode = "checking" | "verify" | "enroll" | "recover" | "recovered";

function TwoStepScreen({ step, sessionVerified, onNotNeeded, onAlreadyDone, onEnrolled, onCantSetUp }: {
  step: "verify" | "enroll";
  sessionVerified: boolean;
  onNotNeeded?: () => void;
  onAlreadyDone: () => void;
  onEnrolled: () => void;
  onCantSetUp: () => void;
}) {
  const { user, accountRole, signOut } = useAuth();
  const qc = useQueryClient();
  const redeem = useServerFn(redeemRecoveryCode);
  // The session's own list can be a step behind (an authenticator added on
  // another device): ask Supabase which it really is before showing either.
  const [mode, setMode] = useState<Mode>("checking");
  const [factorId, setFactorId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [recovery, setRecovery] = useState("");
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  async function afterVerified() {
    // Anything asked for with the password-only session was refused: ask again.
    await qc.invalidateQueries();
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

  async function submitRecovery() {
    if (busy) return;
    if (!normalizeRecoveryCode(recovery)) {
      setError("A recovery code is 10 letters and numbers, like k7m2p-q9tx4.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await redeem({ data: { code: recovery } });
      if (r.ok) {
        setMode("recovered");
        return;
      }
      setError(
        r.reason === "wait"
          ? "Too many tries. Wait an hour and try again."
          : r.reason === "format"
            ? "A recovery code is 10 letters and numbers, like k7m2p-q9tx4."
            : "That code didn't work. Check it, or try another one.",
      );
    } catch (e: any) {
      setError(e?.message ?? "Couldn't check the code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const noCodesHelp =
    accountRole === "finance"
      ? "No codes either? Ask Jared to reset your two-step sign-in from Team."
      : "No codes either? It can be reset from the app's database in Lovable.";

  const title =
    mode === "enroll" ? "Set up two-step sign-in"
    : mode === "recover" ? "Use a recovery code"
    : mode === "recovered" ? "You're back in"
    : "Enter your code";

  return (
    <div data-two-step-gate={mode}>
      <GateCard title={title} email={user?.email}>
        {error && mode !== "recover" && <p className="text-sm text-destructive">{error}</p>}

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
            <TotpSetup
              submitLabel="Turn it on"
              onDone={async () => {
                await afterVerified();
                toast.success("Two-step sign-in is on");
                onEnrolled();
              }}
              onCantStart={onCantSetUp}
            />
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
            <Button variant="outline" className="h-11 w-full" onClick={() => { setError(null); setMode("recover"); }}>
              <KeyRound className="mr-1.5 h-4 w-4" /> Lost your phone? Use a recovery code
            </Button>
          </>
        )}

        {mode === "recover" && (
          <>
            <p className="text-sm text-muted-foreground">
              Type one of the recovery codes you saved when you turned two-step on. It turns your old
              authenticator off and signs you out everywhere, then you set up your new phone.
            </p>
            <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void submitRecovery(); }}>
              <Input
                value={recovery}
                onChange={(e) => setRecovery(e.target.value)}
                placeholder="k7m2p-q9tx4"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                autoFocus
                className="h-12 text-center font-mono text-lg tracking-wider"
                aria-label="Recovery code"
              />
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="h-11 w-full" disabled={busy || !recovery.trim()}>
                {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Checking…</> : "Use this code"}
              </Button>
            </form>
            <p className="text-xs text-muted-foreground">{noCodesHelp}</p>
            <Button variant="ghost" className="h-10 w-full" onClick={() => { setError(null); setMode("verify"); }}>
              Back to the code from my app
            </Button>
          </>
        )}

        {mode === "recovered" && (
          <>
            <p className="text-sm text-muted-foreground">
              Your old authenticator is off and every device was signed out. Sign in again with your password and
              set up two-step on your new phone. You'll get new recovery codes then.
            </p>
            <Button className="h-11 w-full" onClick={() => void signOut()}>Sign in again</Button>
          </>
        )}

        {mode !== "recovered" && (
          <Button variant="ghost" className="h-10 w-full" onClick={() => void signOut()}>
            Sign out
          </Button>
        )}
      </GateCard>
    </div>
  );
}
