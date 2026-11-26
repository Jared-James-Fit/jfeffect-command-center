import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { SlowLoadHint } from "@/components/slow-load-hint";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getStaffInvitePreview, redeemStaffInvite, sendStaffInviteCode, verifyStaffInviteCode } from "@/lib/staff-invites.functions";
import { Input } from "@/components/ui/input";
import { shareMeta } from "@/lib/share-meta";

export const Route = createFileRoute("/staff-setup")({
  validateSearch: (s: Record<string, unknown>) => ({ token: String(s.token ?? ""), p: typeof s.p === "string" ? s.p : undefined }),
  head: () => ({ meta: [{ title: "Set up your team account — JF Effect" }, ...shareMeta({ title: "Join the JF Effect team", description: "Set up your team account." })] }),
  component: StaffSetupPage,
});

function StaffSetupPage() {
  const { token, p } = Route.useSearch();
  const preview = useServerFn(getStaffInvitePreview);
  const redeem = useServerFn(redeemStaffInvite);
  const sendCode = useServerFn(sendStaffInviteCode);
  const verifyCode = useServerFn(verifyStaffInviteCode);
  // the emailed link carries the proof; a texted or copied one earns it with a code
  const [proof, setProof] = useState<string | undefined>(p);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [codeBusy, setCodeBusy] = useState(false);
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: invite, isError, refetch } = useQuery({
    queryKey: ["staff-invite-preview", token, proof ?? ""],
    queryFn: () => preview({ data: { token, proof } }),
    enabled: token.length >= 20,
    retry: false,
  });

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password;

  async function askForCode() {
    setCodeBusy(true);
    try {
      const r = await sendCode({ data: { token } });
      setSentTo(r.sentTo);
      toast.success(`Code sent to ${r.sentTo}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't send the code");
    } finally {
      setCodeBusy(false);
    }
  }

  async function confirmCode() {
    setCodeBusy(true);
    try {
      const r = await verifyCode({ data: { token, code: code.trim() } });
      setProof(r.proof);
    } catch (e: any) {
      toast.error(e?.message ?? "That code didn't work");
    } finally {
      setCodeBusy(false);
    }
  }

  async function submit() {
    if (!invite?.valid || !ready || !proof) return;
    setBusy(true);
    try {
      const res = await redeem({ data: { token, password, proof } });
      // This device may be signed in to their client account (the link
      // usually arrives in its Messenger). Switch to the new team login.
      await supabase.auth.signOut();
      const { error } = await supabase.auth.signInWithPassword({ email: res.email, password });
      if (error) {
        toast.success("Account ready. Sign in with your new email.");
        navigate({ to: "/auth", replace: true });
        return;
      }
      toast.success("You're in");
      navigate({ to: "/", replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't set up the account");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-screen place-items-center bg-background p-4">
      <Card className="w-full max-w-md space-y-5 p-6">
        {(!token || (invite && !invite.valid)) && (
          <div className="space-y-2">
            <h1 className="text-xl font-bold">This link doesn't work</h1>
            <p className="text-sm text-muted-foreground">{invite && !invite.valid ? invite.reason : "The setup link is missing. Open it again from your message."}</p>
          </div>
        )}
        {token && !invite && isError && (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">Couldn't check your invite. Check your connection and try again.</p>
            <Button variant="outline" onClick={() => void refetch()}>Try again</Button>
          </div>
        )}
        {token && !invite && !isError && (
          <div className="space-y-1">
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your invite…</div>
            <SlowLoadHint />
          </div>
        )}
        {invite?.valid && !invite.proven && (
          <div className="space-y-5">
            <div className="space-y-1">
              <div className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">{invite.roleLabel}</div>
              <h1 className="text-2xl font-bold">{invite.firstName ? `Welcome, ${invite.firstName}` : "Welcome to the team"}</h1>
              {invite.welcome && <p className="text-sm text-muted-foreground">{invite.welcome}</p>}
            </div>
            <p className="text-sm">
              First, confirm it's your email. We'll send a 6-digit code to <span className="font-semibold">{sentTo ?? invite.emailHint}</span>.
            </p>
            {!sentTo ? (
              <Button className="w-full" onClick={() => void askForCode()} disabled={codeBusy} loading={codeBusy}>
                Email me a code
              </Button>
            ) : (
              <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); void confirmCode(); }}>
                <Label htmlFor="setup-code">Code from the email</Label>
                <Input id="setup-code" inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} />
                <Button type="submit" className="w-full" disabled={code.length !== 6 || codeBusy} loading={codeBusy}>
                  Confirm
                </Button>
                <button type="button" className="w-full text-xs text-muted-foreground underline-offset-2 hover:underline" onClick={() => void askForCode()} disabled={codeBusy}>
                  Send a new code
                </button>
              </form>
            )}
          </div>
        )}
        {invite?.valid && invite.proven && (
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="space-y-1">
              <div className="inline-flex items-center rounded-full bg-secondary px-2.5 py-0.5 text-xs font-semibold">{invite.roleLabel}</div>
              <h1 className="text-2xl font-bold">{invite.firstName ? `Welcome, ${invite.firstName}` : "Welcome to the team"}</h1>
              {invite.welcome && <p className="text-sm text-muted-foreground">{invite.welcome}</p>}
            </div>

            <div className="rounded-xl border bg-secondary/40 p-3 text-sm">
              <div className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Your team login</div>
              <div className="mt-0.5 break-all font-semibold">{invite.email}</div>
              <p className="mt-1 text-xs text-muted-foreground">It's separate from any client account. To switch back to that one later, sign out and sign in with its email.</p>
            </div>

            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label htmlFor="setup-password">Create a password</Label>
                <PasswordInput id="setup-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="8+ characters" />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="setup-confirm">Type it again</Label>
                <PasswordInput id="setup-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                {mismatch && <p className="text-xs text-destructive">Those don't match yet.</p>}
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={!ready || busy}>
              {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Setting up…</> : "Create my account"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
