import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/lib/auth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Eye, EyeOff, KeyRound } from "lucide-react";
import { toast } from "sonner";
import { ActionButton } from "@/components/action-button";

export function ChangePasswordCard({ className }: { className?: string }) {
  const { user } = useAuth();
  const [pwd, setPwd] = useState({ current: "", next: "", confirm: "", showCurrent: false, showNext: false });

  const submit = async () => {
    if (!user?.email) throw new Error("No signed-in user");
    if (!pwd.next) throw new Error("Please enter a new password");
    if (pwd.next !== pwd.confirm) throw new Error("Passwords don't match");
    if (pwd.next === pwd.current) throw new Error("New password must differ from current");
    const { error: signInErr } = await supabase.auth.signInWithPassword({ email: user.email, password: pwd.current });
    if (signInErr) throw new Error("Current password is incorrect");
    const { error } = await supabase.auth.updateUser({ password: pwd.next });
    if (error) throw new Error(error.message);
    setPwd({ current: "", next: "", confirm: "", showCurrent: false, showNext: false });
    toast.success("Password updated");
  };

  return (
    <Card className={"border-border bg-card p-6 space-y-4 " + (className ?? "")}>
      <div className="flex items-center gap-2">
        <KeyRound className="h-4 w-4 text-primary" />
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Change Password</h3>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
        }}
        className="grid gap-3 md:grid-cols-3"
      >
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
            <Input type={pwd.showNext ? "text" : "password"} value={pwd.next} onChange={(e) => setPwd({ ...pwd, next: e.target.value })} required autoComplete="new-password" />
            <button type="button" onClick={() => setPwd({ ...pwd, showNext: !pwd.showNext })} className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground">
              {pwd.showNext ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </button>
          </div>
        </div>
        <div>
          <Label>Confirm new password</Label>
          <Input type={pwd.showNext ? "text" : "password"} value={pwd.confirm} onChange={(e) => setPwd({ ...pwd, confirm: e.target.value })} required autoComplete="new-password" />
        </div>
        <div className="md:col-span-3 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">Minimum 8 characters. Use a mix of letters and numbers. You'll stay signed in after the change.</p>
          <ActionButton
            type="submit"
            onAction={submit}
            loadingLabel="Updating…"
            successLabel="Updated"
            errorToast
            successToast={false}
            className="bg-gradient-primary uppercase font-bold"
          >
            Update password
          </ActionButton>
        </div>
      </form>
    </Card>
  );
}