import { createFileRoute } from "@tanstack/react-router";
import { useAuth } from "@/lib/auth";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/admin/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);

  const promoteSelfToAdmin = async () => {
    if (!user) return;
    setBusy(true);
    const { error } = await supabase.from("user_roles").insert({ user_id: user.id, role: "admin" });
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("You are now an admin. Refresh the page.");
  };

  const inviteAsAdmin = async () => {
    toast.info("Invite a user by sharing the signup link; then promote them from this screen once they sign up.");
    if (email) {
      const { data: prof } = await supabase.from("profiles").select("id").eq("email", email).maybeSingle();
      if (!prof) return toast.error("No user with that email yet.");
      const { error } = await supabase.from("user_roles").insert({ user_id: prof.id, role: "admin" });
      if (error) return toast.error(error.message);
      toast.success("Promoted to admin");
    }
  };

  return (
    <>
      <PageHeader title="Settings" subtitle="Account & access" />
      <div className="grid gap-6 p-6 md:grid-cols-2 md:p-8">
        <Card className="border-border bg-card p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Your Account</h3>
          <div className="text-sm"><span className="text-muted-foreground">Email:</span> {user?.email}</div>
          <div className="text-sm"><span className="text-muted-foreground">User ID:</span> <code className="text-xs">{user?.id}</code></div>
        </Card>

        <Card className="border-primary/30 bg-primary/5 p-6 space-y-3">
          <h3 className="text-xs uppercase tracking-widest text-primary">Admin Access</h3>
          <p className="text-xs text-muted-foreground">First-time setup: promote yourself to admin to unlock the full command center.</p>
          <Button onClick={promoteSelfToAdmin} disabled={busy} className="w-full bg-gradient-primary font-bold uppercase">Make me admin</Button>
          <div className="pt-4 border-t border-border/50 space-y-2">
            <Label>Promote another user (by email)</Label>
            <Input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="user@example.com" />
            <Button variant="outline" onClick={inviteAsAdmin} className="w-full">Promote to admin</Button>
          </div>
        </Card>
      </div>
    </>
  );
}