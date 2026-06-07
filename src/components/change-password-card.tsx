import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";

export function ChangePasswordCard({ className }: { className?: string }) {
  const { user } = useAuth();
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "", showCurrent: false, showNext: false });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.email) return toast.error("No signed-in user");
    if (pwd.next.length < 8) return toast.error("Password must be at least 8 characters");
    if (pwd.next !== pwd.confirm) return toast.error("Passwords don't match");
    if (pwd.next === pwd.current) return toast.error("New password must differ from current");
    setBusy(true);
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwd.current });
    if (signInErr) {
      setBusy(false);
      return toast.error("Current password is incorrect");
    }
    const { error } = await supabase.auth.updateUser({ password: pwd.next });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Password updated");
    setPwd({ current: "", next: "", confirm: "", showCurrent: false, showNext: false });
  };

  return (
    <Card className={"border-border bg-card p-6 space-y-4 " + (className ?? "")}>
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Change Password</h3>
      </div>
      <form onSubmit={submit} className="grid gap-3 md:grid-cols-3">
        <div>
          <Label>Current password</Label>
          <div className="relative">
            <Input type={pwd.showCurrent ? "text" : "password"} value={pwd.current} onChange={(e) => setPwd({ ...pwd, current: e.target.value })} required autoComplete="current-password" />
            <button type="button" onClick={() => setPwd({ ...pwd, showCurrent: !pwd.showCurrent })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {pwd.showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label>New password</Label>
          <div className="relative">
            <Input type={pwd.showNext ? "text" : "password"} value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required minLength={8} autoComplete="new-password" />
            <button type="button" onClick={() => setPwd({ ...pwd, showNext: !pwd.showNext })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {pwd.showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label>Confirm new password</Label>
          <Input type={pwd.showNext ? "text" : "password"} value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} required minLength={8} autoComplete="new-password" />
        </div>
        <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">Minimum 8 characters. Use a mix of letters and numbers. You'll stay signed in after the change.</p>
          <Button type="submit" disabled={busy} className="bg-gradient-primary uppercase font-bold">{busy ? "Updating…" : "Update password"}</Button>
        </div>
      </form>
    </Card>
  );
}