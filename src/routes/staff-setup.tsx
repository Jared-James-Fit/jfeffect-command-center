import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { getStaffInvitePreview, redeemStaffInvite } from "@/lib/staff-invites.functions";

export const Route = createFileRoute("/staff-setup")({
  validateSearch: (s: Record<string, unknown>) => ({ token: String(s.token ?? "") }),
  head: () => ({ meta: [{ title: "Set up your team account — JF Effect" }] }),
  component: StaffSetupPage,
});

function StaffSetupPage() {
  const { token } = Route.useSearch();
  const preview = useServerFn(getStaffInvitePreview);
  const redeem = useServerFn(redeemStaffInvite);
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  const { data: invite, isError, refetch } = useQuery({
    queryKey: ["staff-invite-preview", token],
    queryFn: () => preview({ data: { token } }),
    enabled: token.length >= 20,
    retry: false,
  });

  const mismatch = confirm.length > 0 && confirm !== password;
  const ready = password.length >= 8 && confirm === password;

  async function submit() {
    if (!invite?.valid || !ready) return;
    setBusy(true);
    try {
      const res = await redeem({ data: { token, password } });
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
            <h1 className="text-xl font-black">This link doesn't work</h1>
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
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Checking your invite…</div>
        )}
        {invite?.valid && (
          <form className="space-y-5" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
            <div className="space-y-1">
              <div className="inline-flex items-center rounded-full bg-primary/10 px-2.5 py-0.5 text-xs font-semibold text-primary">{invite.roleLabel}</div>
              <h1 className="text-2xl font-black">{invite.firstName ? `Welcome, ${invite.firstName}` : "Welcome to the team"}</h1>
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

            {invite.requiresAuthenticator && (
              <p className="flex gap-2 text-xs text-muted-foreground">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                Next you'll connect an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password). It takes one tap on your phone.
              </p>
            )}

            <Button type="submit" className="w-full" disabled={!ready || busy}>
              {busy ? <><Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> Setting up…</> : "Create my account"}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
