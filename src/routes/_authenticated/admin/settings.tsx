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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { sendTestEmail } from "@/lib/email-sender.functions";
import { Mail, Send } from "lucide-react";

export const Route = createFileRoute("/_authenticated/admin/settings")({ component: SettingsPage });

function SettingsPage() {
  const { user } = useAuth();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const qc = useQueryClient();
  const testFn = useServerFn(sendTestEmail);
  const [testTo, setTestTo] = useState("");
  const [testing, setTesting] = useState(false);

  const { data: settings } = useQuery({
    queryKey: ["email-sender-settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("email_sender_settings").select("*").eq("singleton", true).maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  const [form, setForm] = useState<any>(null);
  const current = form ?? settings;
  const set = (k: string, v: any) => setForm({ ...(form ?? settings ?? {}), [k]: v });

  const saveSender = async () => {
    if (!current) return;
    const patch = {
      sender_name: current.sender_name,
      sender_email: current.sender_email,
      reply_to_email: current.reply_to_email,
      provider: current.provider,
      smtp_host: current.smtp_host,
      smtp_port: current.smtp_port,
      smtp_user: current.smtp_user,
      smtp_secure: current.smtp_secure,
      notes: current.notes,
    };
    const { error } = await supabase
      .from("email_sender_settings").update(patch).eq("singleton", true);
    if (error) return toast.error(error.message);
    toast.success("Sender settings saved");
    qc.invalidateQueries({ queryKey: ["email-sender-settings"] });
  };

  const sendTest = async () => {
    if (!testTo) return toast.error("Enter a recipient email");
    setTesting(true);
    try {
      await testFn({ data: { to: testTo, subject: "JF Effect — Test email", body: "Test from your command center. Reply to confirm reply-to works." } });
      toast.success("Test email sent");
      qc.invalidateQueries({ queryKey: ["email-sender-settings"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to send");
      qc.invalidateQueries({ queryKey: ["email-sender-settings"] });
    } finally {
      setTesting(false);
    }
  };

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

        <Card className="border-border bg-card p-6 space-y-4 md:col-span-2">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <h3 className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
              <Mail className="h-4 w-4" /> Email Sender — Purchase Confirmations
            </h3>
            <Badge variant="outline" className={current?.status?.startsWith("Connected") ? "border-primary/40 text-primary" : "border-amber-500/40 text-amber-500"}>
              {current?.status ?? "Loading…"}
            </Badge>
          </div>
          <p className="text-xs text-muted-foreground">
            Purchase confirmation emails will send using these details. Gmail addresses can't be used as the From header by generic providers (Resend / SendGrid) without owning the domain, so to actually send <em>from</em> jaredjamesfit@gmail.com choose <strong>Gmail</strong> and connect your Gmail account. Reply-to always works regardless of provider.
          </p>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-1">
              <Label>Sender name</Label>
              <Input value={current?.sender_name ?? ""} onChange={(e) => set("sender_name", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Sender email</Label>
              <Input type="email" value={current?.sender_email ?? ""} onChange={(e) => set("sender_email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Reply-to email</Label>
              <Input type="email" value={current?.reply_to_email ?? ""} onChange={(e) => set("reply_to_email", e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label>Email provider</Label>
              <Select value={current?.provider ?? "gmail"} onValueChange={(v) => set("provider", v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="gmail">Gmail (connect account)</SelectItem>
                  <SelectItem value="smtp">SMTP</SelectItem>
                  <SelectItem value="resend">Resend</SelectItem>
                  <SelectItem value="sendgrid">SendGrid</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(current?.provider === "smtp") && (
              <>
                <div className="space-y-1">
                  <Label>SMTP host</Label>
                  <Input value={current?.smtp_host ?? ""} onChange={(e) => set("smtp_host", e.target.value)} placeholder="smtp.gmail.com" />
                </div>
                <div className="space-y-1">
                  <Label>SMTP port</Label>
                  <Input type="number" value={current?.smtp_port ?? ""} onChange={(e) => set("smtp_port", Number(e.target.value))} placeholder="587" />
                </div>
                <div className="space-y-1">
                  <Label>SMTP username</Label>
                  <Input value={current?.smtp_user ?? ""} onChange={(e) => set("smtp_user", e.target.value)} placeholder="jaredjamesfit@gmail.com" />
                </div>
                <div className="space-y-1 flex items-end">
                  <p className="text-xs text-muted-foreground">SMTP password is stored as a secret — ask Lovable to add an SMTP_PASSWORD secret when ready.</p>
                </div>
              </>
            )}

            <div className="md:col-span-2 space-y-1">
              <Label>Internal notes</Label>
              <Textarea value={current?.notes ?? ""} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes for yourself…" />
            </div>
          </div>

          <div className="flex items-center gap-2 pt-2 border-t border-border/50 flex-wrap">
            <Button onClick={saveSender} className="bg-gradient-primary uppercase font-bold">Save sender settings</Button>
            {current?.provider === "gmail" && (
              <Button variant="outline" asChild>
                <a href="/admin/apps">Connect Gmail account</a>
              </Button>
            )}
          </div>

          <div className="pt-4 border-t border-border/50 space-y-2">
            <Label>Test email recipient</Label>
            <div className="flex gap-2 flex-wrap">
              <Input className="flex-1 min-w-[200px]" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
              <Button onClick={sendTest} disabled={testing} variant="outline"><Send className="mr-2 h-4 w-4" />{testing ? "Sending…" : "Send test email"}</Button>
            </div>
            {current?.last_test_at && (
              <p className="text-xs text-muted-foreground">
                Last test: {new Date(current.last_test_at).toLocaleString()} — {current.last_test_result}
              </p>
            )}
          </div>
        </Card>
      </div>
    </>
  );
}