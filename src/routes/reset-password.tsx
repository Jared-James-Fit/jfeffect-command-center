import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Check, X } from "lucide-react";
import { validatePassword, passwordIsValid } from "@/lib/account-recovery.constants";
import {
  consumeRecoveryToken,
  validateRecoveryToken,
} from "@/lib/account-recovery.functions";

export const Route = createFileRoute("/reset-password")({
  head: () => ({ meta: [{ title: "Reset password — JF Effect" }] }),
  component: ResetPage,
});

function ResetPage() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<
    "loading" | "confirm" | "ready" | "expired" | "done"
  >("loading");
  const [verifying, setVerifying] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [recoveryEmail, setRecoveryEmail] = useState<string>("");
  // SMS-token flow state
  const [smsToken, setSmsToken] = useState<string | null>(null);
  const validate = useServerFn(validateRecoveryToken);
  const consume = useServerFn(consumeRecoveryToken);

  useEffect(() => {
    // SECURITY: Never trust a pre-existing session on this page. If an admin
    // (or anyone else) is already signed in, falling through to that session
    // would let the page change THEIR password via updateUser(). Require a
    // fresh recovery token from the URL, and sign out any other session first.
    let cancelled = false;
    (async () => {
      const params = new URLSearchParams(window.location.search);
      const hasQueryToken = !!params.get("token_hash");
      const rt = params.get("rt");
      const hash = window.location.hash || "";
      const hashParams = new URLSearchParams(hash.startsWith("#") ? hash.slice(1) : hash);
      const isRecoveryHash = hashParams.get("type") === "recovery" && !!hashParams.get("access_token");

      if (!hasQueryToken && !isRecoveryHash && !rt) {
        // No valid recovery token in the URL — do not allow password change.
        await supabase.auth.signOut({ scope: "local" }).catch(() => {});
        if (!cancelled) setPhase("expired");
        return;
      }

      // Clear any existing session so verifyOtp / hash exchange installs the
      // correct user, never the previously-signed-in one.
      await supabase.auth.signOut({ scope: "local" }).catch(() => {});

      if (rt) {
        // SMS recovery token path — validate server-side.
        try {
          const res = await validate({ data: { token: rt } });
          if (!cancelled) {
            if (res.valid) {
              setSmsToken(rt);
              setPhase("ready");
            } else {
              setPhase("expired");
            }
          }
        } catch {
          if (!cancelled) setPhase("expired");
        }
        return;
      }

      if (hasQueryToken) {
        if (!cancelled) setPhase("confirm");
        return;
      }

      // Hash-based emailed-link flow: Supabase consumes the fragment and
      // sets a session for the correct (recovery) user. Wait for it.
      const sub = supabase.auth.onAuthStateChange((event, session) => {
        if (cancelled) return;
        if (event === "PASSWORD_RECOVERY" || (event === "SIGNED_IN" && session?.user)) {
          setRecoveryEmail(session?.user?.email ?? "");
          setPhase("ready");
        }
      });
      setTimeout(() => {
        if (!cancelled && phase === "loading") setPhase("expired");
      }, 4000);
      return () => sub.data.subscription.unsubscribe();
    })();
    return () => { cancelled = true; };
  }, []);

  const verifyTokenHash = async () => {
    setVerifying(true);
    const params = new URLSearchParams(window.location.search);
    const tokenHash = params.get("token_hash");
    const type = (params.get("type") || "recovery") as any;
    if (!tokenHash) { setVerifying(false); setPhase("expired"); return; }
    // Belt and braces: clear session immediately before exchange.
    await supabase.auth.signOut({ scope: "local" }).catch(() => {});
    const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type });
    setVerifying(false);
    if (error) { setPhase("expired"); return; }
    setRecoveryEmail(data.user?.email ?? "");
    setPhase("ready");
    window.history.replaceState({}, "", window.location.pathname);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordIsValid(password)) {
      return toast.error("Password does not meet all requirements");
    }
    if (password !== confirm) return toast.error("Passwords don't match");

    // SMS token branch — call server fn to consume + update password.
    if (smsToken) {
      setBusy(true);
      try {
        await consume({ data: { token: smsToken, newPassword: password } });
        setPhase("done");
        toast.success(
          "Your password has been updated. You can now log in with your new password.",
        );
        setTimeout(() => navigate({ to: "/auth", replace: true }), 800);
      } catch (err: any) {
        toast.error(err?.message ?? "Reset failed");
        setPhase("expired");
      } finally {
        setBusy(false);
      }
      return;
    }

    // SECURITY: Make sure the current session is the recovery session we just
    // installed. Refuse if no user, or if the email unexpectedly changed.
    const { data: u } = await supabase.auth.getUser();
    if (!u.user) return toast.error("Your reset link is no longer valid. Please request a new one.");
    if (recoveryEmail && u.user.email && recoveryEmail.toLowerCase() !== u.user.email.toLowerCase()) {
      return toast.error("Session mismatch. Please open the reset link again.");
    }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) return toast.error(error.message);
    // Revoke other devices for the email flow as well.
    try {
      await supabase.auth.signOut({ scope: "others" as any });
    } catch {
      /* non-fatal */
    }
    setPhase("done");
    toast.success(
      "Your password has been updated. You can now log in with your new password.",
    );
    setTimeout(() => navigate({ to: "/auth", replace: true }), 800);
  };

  const rules = validatePassword(password);
  const allOk = rules.length && rules.upper && rules.lower && rules.digit && rules.special;
  const matches = password.length > 0 && password === confirm;

  return (
    <main className="relative min-h-screen overflow-hidden bg-background text-foreground">
      <div className="pointer-events-none absolute -top-40 -right-40 h-[500px] w-[500px] rounded-full bg-primary/8 blur-[120px]" />
      <div className="flex min-h-screen items-center justify-center px-6 py-16">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center justify-center gap-3">
            <img src="/logo.png" alt="JF Effect" className="h-11 w-11 rounded-xl shadow-glow" />
            <span className="text-lg font-black tracking-tight">JF EFFECT</span>
          </div>
          <Card className="border-border bg-card/60 p-6 backdrop-blur-sm">
            {phase === "loading" && <p className="text-sm text-muted-foreground">Verifying your link…</p>}
            {phase === "confirm" && (
              <div className="space-y-4 text-center">
                <h2 className="text-xl font-black tracking-tight">Reset your password</h2>
                <p className="text-sm text-muted-foreground">Tap continue to verify your link.</p>
                <Button
                  onClick={verifyTokenHash}
                  disabled={verifying}
                  className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
                >
                  {verifying ? "Verifying…" : "Continue"}
                </Button>
              </div>
            )}
            {phase === "expired" && (
              <div className="space-y-4 text-center">
                <h2 className="text-xl font-black">Link no longer valid</h2>
                <p className="text-sm text-muted-foreground">
                  This recovery link is no longer valid. Request a new password reset to continue.
                </p>
                <Link to="/recover">
                  <Button className="w-full bg-gradient-primary py-6 font-bold uppercase tracking-[0.15em] shadow-glow">
                    Send a New Recovery Link
                  </Button>
                </Link>
              </div>
            )}
            {phase === "ready" && (
              <>
                <div className="text-center">
                  <h2 className="text-xl font-black tracking-tight">Create a New Password</h2>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Pick something strong — at least 10 characters with a mix of letters, numbers and symbols.
                  </p>
                </div>
                <form onSubmit={submit} className="mt-6 w-full space-y-4">
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">New password</Label>
                    <PasswordInput
                      required
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="mt-1.5 py-6"
                      autoComplete="new-password"
                    />
                  </div>
                  <div>
                    <Label className="text-[10px] uppercase tracking-wider text-muted-foreground">Confirm new password</Label>
                    <PasswordInput
                      required
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      className="mt-1.5 py-6"
                      autoComplete="new-password"
                    />
                    {confirm.length > 0 && !matches && (
                      <p className="mt-1 text-[11px] text-destructive">Passwords must match.</p>
                    )}
                  </div>
                  <ul className="space-y-1 rounded-md border border-border/60 bg-muted/30 p-3 text-[11px]">
                    {[
                      { ok: rules.length, label: "At least 10 characters" },
                      { ok: rules.upper, label: "One uppercase letter" },
                      { ok: rules.lower, label: "One lowercase letter" },
                      { ok: rules.digit, label: "One number" },
                      { ok: rules.special, label: "One special character" },
                    ].map((r) => (
                      <li key={r.label} className="flex items-center gap-2">
                        {r.ok ? (
                          <Check className="h-3 w-3 text-primary" />
                        ) : (
                          <X className="h-3 w-3 text-muted-foreground/60" />
                        )}
                        <span className={r.ok ? "text-foreground" : "text-muted-foreground"}>
                          {r.label}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <Button
                    type="submit"
                    disabled={busy || !allOk || !matches}
                    className="w-full bg-gradient-primary py-6 text-sm font-bold uppercase tracking-[0.15em] shadow-glow"
                  >
                    {busy ? "Updating…" : "Update Password"}
                  </Button>
                </form>
              </>
            )}
            {phase === "done" && (
              <div className="space-y-3 text-center">
                <h2 className="text-xl font-black tracking-tight">All set</h2>
                <p className="text-sm text-muted-foreground">
                  Your password has been updated. You can now log in with your new password.
                </p>
              </div>
            )}
          </Card>
        </div>
      </div>
    </main>
  );
}