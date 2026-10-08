import { useEffect, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { ShieldCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { InputOTP, InputOTPGroup, InputOTPSlot } from "@/components/ui/input-otp";
import { FullPageLoader } from "@/components/full-page-loader";
import { useAuth } from "@/lib/auth";
import { getMfaState, roleRequiresMfa, startTotpEnrollment, verifyTotp, type MfaState, type TotpEnrollment } from "@/lib/mfa";

/**
 * Wraps a staff area. For roles that need MFA (admin, finance) the area only
 * renders once the session is aal2: first visit enrolls an authenticator app,
 * later sign-ins ask for the 6-digit code. Other roles pass straight through.
 */
export function StaffMfaGate({ children }: { children: ReactNode }) {
  const { role, signOut } = useAuth();
  const qc = useQueryClient();
  const required = roleRequiresMfa(role);
  const [state, setState] = useState<MfaState | null>(null);
  const [enrollment, setEnrollment] = useState<TotpEnrollment | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!required) return;
    let cancelled = false;
    getMfaState()
      .then((s) => { if (!cancelled) setState(s); })
      .catch((e) => { if (!cancelled) setError(e?.message ?? "Couldn't check two-step verification"); });
    return () => { cancelled = true; };
  }, [required]);

  useEffect(() => {
    if (state?.status !== "needs_enroll" || enrollment) return;
    startTotpEnrollment().then(setEnrollment).catch((e) => setError(e?.message ?? "Couldn't start setup"));
  }, [state, enrollment]);

  if (!required || state?.status === "verified") return <>{children}</>;
  if (!state && !error) return <FullPageLoader label="Checking security…" />;

  const factorId = state?.status === "needs_verify" ? state.factorId : enrollment?.factorId;

  async function submit() {
    if (!factorId || code.length !== 6) return;
    setBusy(true);
    try {
      await verifyTotp(factorId, code);
      // Anything fetched with the old (aal1) token was refused; refetch it.
      await qc.invalidateQueries();
      setState({ status: "verified" });
    } catch (e: any) {
      setCode("");
      toast.error(e?.message ?? "That code didn't work. Try the newest one.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center bg-background p-4">
      <Card className="w-full max-w-md p-6 space-y-5">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-black">Two-step verification</h1>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}
        {state?.status === "needs_enroll" && (
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">
              Staff accounts need an authenticator app (Google Authenticator, 1Password, Authy…). Scan this code, then enter the 6 digits it shows.
            </p>
            {enrollment ? (
              <>
                <img src={enrollment.qrCode} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded-md bg-white p-2" />
                <p className="text-xs text-muted-foreground break-all">Can't scan? Enter this key: <span className="font-mono">{enrollment.secret}</span></p>
              </>
            ) : (
              <div className="grid h-44 place-items-center"><Loader2 className="h-5 w-5 animate-spin" /></div>
            )}
          </div>
        )}
        {state?.status === "needs_verify" && (
          <p className="text-sm text-muted-foreground">Enter the 6-digit code from your authenticator app.</p>
        )}
        {factorId && (
          <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <InputOTP maxLength={6} value={code} onChange={setCode} inputMode="numeric" autoFocus onComplete={() => void submit()}>
              <InputOTPGroup className="mx-auto">
                {[0, 1, 2, 3, 4, 5].map((i) => <InputOTPSlot key={i} index={i} />)}
              </InputOTPGroup>
            </InputOTP>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>
              {busy ? "Checking…" : "Verify"}
            </Button>
          </form>
        )}
        {(
          <Button variant="ghost" className="w-full" onClick={() => signOut()}>Sign out</Button>
        )}
      </Card>
    </div>
  );
}
