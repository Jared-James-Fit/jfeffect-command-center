import { createFileRoute, useNavigate, useSearch } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { redeemSetupToken } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { toast } from "sonner";

export const Route = createFileRoute("/member-setup")({
  validateSearch: z.object({ token: z.string().optional() }),
  head: () => ({ meta: [{ title: "Set up your account — JF Effect" }] }),
  component: MemberSetupPage,
});

function MemberSetupPage() {
  const { token } = useSearch({ from: Route.id });
  const navigate = useNavigate();
  const redeem = useServerFn(redeemSetupToken);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <main className="grid min-h-screen place-items-center p-6 text-center">
        <div className="max-w-sm">
          <h1 className="text-xl font-black">Setup link missing</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            This setup link is incomplete. Ask the admin for a new one.
          </p>
        </div>
      </main>
    );
  }

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) return toast.error("Password must be at least 8 characters");
    if (password !== confirm) return toast.error("Passwords don't match");
    setBusy(true);
    try {
      const { email } = await redeem({ data: { token, password } });
      const { error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) throw error;
      toast.success("Welcome!");
      navigate({ to: "/m", replace: true });
    } catch (e: any) {
      toast.error(e?.message ?? "Setup failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="grid min-h-screen place-items-center bg-background px-6 py-12 text-foreground">
      <div className="w-full max-w-sm">
        <div className="mb-6 flex items-center justify-center gap-3">
          <img src="/logo.png" alt="JF Effect" className="h-10 w-10 rounded-xl" />
          <span className="text-base font-black tracking-tight">JF EFFECT</span>
        </div>
        <h1 className="text-balance text-center text-xl font-black">Set your password</h1>
        <p className="mt-1 text-center text-sm text-muted-foreground">
          Create a password to access your membership.
        </p>
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <Label htmlFor="pw">New password</Label>
            <PasswordInput id="pw" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
          </div>
          <div>
            <Label htmlFor="pw2">Confirm password</Label>
            <PasswordInput id="pw2" value={confirm} onChange={(e) => setConfirm(e.target.value)} required minLength={8} />
          </div>
          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Setting up…" : "Create account & sign in"}
          </Button>
        </form>
      </div>
    </main>
  );
}