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
import { setupDriveRoot, testDriveConnection } from "@/lib/drive.functions";
import { updateSignNowSettings, testSignNowConnection } from "@/lib/agreements.functions";
import { Mail, Send, FolderOpen, ExternalLink, ShieldCheck } from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { AccountProfileSettings } from "@/components/account-profile-settings";

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
        <AccountProfileSettings title="Your Profile" roleLabel="Admin / Owner" />

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

         <DriveIntegrationCard />
         <SignNowIntegrationCard />
       </div>
     </>
   );
 }

function DriveIntegrationCard() {
  const qc = useQueryClient();
  const setupFn = useServerFn(setupDriveRoot);
  const testFn = useServerFn(testDriveConnection);
  const { data: drive } = useQuery({
    queryKey: ["media-drive-settings"],
    queryFn: async () => {
      const { data } = await supabase.from("media_drive_settings" as any).select("*").limit(1).maybeSingle();
      return data;
    },
  });
  const [folderName, setFolderName] = useState("JF Effect Client Files");
  const [existingId, setExistingId] = useState("");
  const [busy, setBusy] = useState(false);
  const [testing, setTesting] = useState(false);

  async function run() {
    setBusy(true);
    try {
      await setupFn({ data: { folderName, existingFolderId: existingId || undefined } });
      toast.success("Drive folder is Ready");
      qc.invalidateQueries({ queryKey: ["media-drive-settings"] });
    } catch (e: any) { toast.error(e?.message || "Drive setup failed"); }
    finally { setBusy(false); }
  }

  async function test() {
    setTesting(true);
    try {
      const res = await testFn({ data: {} as any });
      if (res.ok) toast.success(res.message);
      else toast.error(res.message);
      qc.invalidateQueries({ queryKey: ["media-drive-settings"] });
      qc.invalidateQueries({ queryKey: ["media-drive-settings-banner"] });
    } catch (e: any) {
      toast.error(e?.message || "Drive test failed");
    } finally { setTesting(false); }
  }

  async function toggleShare(v: boolean) {
    const { error } = await supabase.from("media_drive_settings" as any).update({ share_uploads_with_link: v }).eq("singleton", true);
    if (error) return toast.error(error.message);
    qc.invalidateQueries({ queryKey: ["media-drive-settings"] });
  }

  return (
    <Card className="border-border bg-card p-5 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <FolderOpen className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold">Google Drive (media storage)</h2>
        </div>
        <Badge variant="outline">{(drive as any)?.status ?? "Not Connected"}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        Client videos and photos are stored in your Google Drive — the app only saves metadata, comments, and review status. Each client gets their own folder with subfolders for Lift Videos, Check-Ins, Progress Photos, and more.
      </p>
      {(drive as any)?.root_folder_id ? (
        <div className="rounded border border-border bg-secondary/40 p-3 text-sm">
          <div className="flex items-center justify-between gap-2">
            <div>
              <div className="font-semibold">{(drive as any).root_folder_name}</div>
              <div className="text-xs text-muted-foreground">Root folder ID: {(drive as any).root_folder_id}</div>
            </div>
            {(drive as any).root_folder_url && (
              <Button asChild size="sm" variant="outline">
                <a href={(drive as any).root_folder_url} target="_blank" rel="noopener noreferrer">Open <ExternalLink className="ml-1 h-3 w-3" /></a>
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <div>
            <Label className="text-xs">Create new root folder named</Label>
            <Input value={folderName} onChange={(e) => setFolderName(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">…or reuse existing folder ID</Label>
            <Input value={existingId} onChange={(e) => setExistingId(e.target.value)} placeholder="(only folders the app created)" />
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-3">
        {!(drive as any)?.root_folder_id && (
          <Button onClick={run} disabled={busy}>Create root folder</Button>
        )}
        {(drive as any)?.root_folder_id && (
          <Button onClick={test} disabled={testing} variant="outline">{testing ? "Testing…" : "Test connection"}</Button>
        )}
        <label className="flex items-center gap-2 text-xs">
          <Switch checked={!!(drive as any)?.share_uploads_with_link} onCheckedChange={toggleShare} />
          Share uploaded files with link (lets clients view their own videos)
        </label>
      </div>
      {(drive as any)?.last_test_at && (
        <p className="text-xs text-muted-foreground">
          Last test: {new Date((drive as any).last_test_at).toLocaleString()} — {(drive as any).last_test_result}
        </p>
      )}
    </Card>
  );
}

function SignNowIntegrationCard() {
  const qc = useQueryClient();
  const updateFn = useServerFn(updateSignNowSettings);
  const testFn = useServerFn(testSignNowConnection);
  const { data: s } = useQuery({
    queryKey: ["signnow-settings"],
    queryFn: async () => (await supabase.from("signnow_settings").select("*").limit(1).maybeSingle()).data,
  });
  const { data: templates = [] } = useQuery({
    queryKey: ["signnow-templates-pick"],
    queryFn: async () => (await supabase.from("agreement_templates").select("id, name").eq("archived", false).eq("is_active", true).order("name")).data ?? [],
  });
  const [form, setForm] = useState<any>(null);
  const cur: any = form ?? s ?? {};
  const setK = (k: string, v: any) => setForm({ ...(form ?? s ?? {}), [k]: v });
  const [busy, setBusy] = useState(false);

  async function save() {
    setBusy(true);
    try {
      await updateFn({ data: {
        status: cur.status, account_email: cur.account_email || null,
        default_template_id: cur.default_template_id || null,
        auto_reminders_enabled: !!cur.auto_reminders_enabled,
        signnow_dashboard_url: cur.signnow_dashboard_url || null,
        notes: cur.notes || null,
        api_client_id: cur.api_client_id || null,
        api_basic_auth_token: cur.api_basic_auth_token || null,
        redirect_uri: cur.redirect_uri || null,
        app_mode_note: cur.app_mode_note || null,
      }});
      toast.success("SignNow settings saved");
      qc.invalidateQueries({ queryKey: ["signnow-settings"] });
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
    finally { setBusy(false); }
  }

  async function test() {
    setBusy(true);
    try {
      const r: any = await testFn({});
      if (r.ok) toast.success(r.message); else toast.error(r.message);
      qc.invalidateQueries({ queryKey: ["signnow-settings"] });
    } catch (e: any) { toast.error(e?.message ?? "Test failed"); }
    finally { setBusy(false); }
  }

  const status = cur.status ?? "Manual Mode Only";
  const tone = status === "Connected" ? "border-emerald-500/40 text-emerald-500"
    : status === "Error" ? "border-destructive/40 text-destructive"
    : status === "Manual Mode Only" ? "border-amber-500/40 text-amber-500"
    : "border-border text-muted-foreground";

  return (
    <Card className="border-border bg-card p-5 space-y-3 md:col-span-2">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-5 w-5 text-primary" />
          <h2 className="text-base font-bold">SignNow Integration</h2>
        </div>
        <Badge variant="outline" className={tone}>{status}</Badge>
      </div>
      <p className="text-xs text-muted-foreground">
        SignNow handles signing. The app tracks, organizes, labels, and verifies signed agreements per client. In <strong>Manual Mode Only</strong>, paste signing links and upload signed copies directly. To enable automatic API mode, fill in OAuth fields below, add the <code>SIGNNOW_CLIENT_SECRET</code>, <code>SIGNNOW_USERNAME</code>, and <code>SIGNNOW_PASSWORD</code> secrets, then run "Test connection".
      </p>

      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label>Account email</Label>
          <Input type="email" value={cur.account_email ?? ""} onChange={(e) => setK("account_email", e.target.value)} placeholder="you@example.com" />
        </div>
        <div className="space-y-1">
          <Label>Default template</Label>
          <Select value={cur.default_template_id ?? ""} onValueChange={(v) => setK("default_template_id", v)}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              {(templates as any[]).map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>SignNow dashboard URL</Label>
          <Input value={cur.signnow_dashboard_url ?? ""} onChange={(e) => setK("signnow_dashboard_url", e.target.value)} placeholder="https://app.signnow.com" />
        </div>
        <div className="space-y-1">
          <Label>Integration status</Label>
          <Select value={cur.status ?? "Manual Mode Only"} onValueChange={(v) => setK("status", v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["Not Connected","Connected","Error","Manual Mode Only"].map((v) => <SelectItem key={v} value={v}>{v}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>

        <div className="md:col-span-2 pt-2 border-t border-border/50">
          <h4 className="text-xs uppercase tracking-widest text-muted-foreground mb-2">OAuth / API credentials</h4>
          <p className="text-[11px] text-muted-foreground mb-3">
            Non-secret values live here. Secrets (<code>SIGNNOW_CLIENT_SECRET</code>, <code>SIGNNOW_USERNAME</code>, <code>SIGNNOW_PASSWORD</code>, or a static <code>SIGNNOW_API_TOKEN</code>) must be added via the Lovable Cloud Secrets manager — never paste them into a database field.
          </p>
        </div>
        <div className="space-y-1">
          <Label>API client ID</Label>
          <Input value={cur.api_client_id ?? ""} onChange={(e) => setK("api_client_id", e.target.value)} placeholder="signnow application client id" />
        </div>
        <div className="space-y-1">
          <Label>Basic Authorization token (optional)</Label>
          <Input value={cur.api_basic_auth_token ?? ""} onChange={(e) => setK("api_basic_auth_token", e.target.value)} placeholder="base64(client_id:client_secret)" />
          <p className="text-[10px] text-muted-foreground">Only paste here if you cannot store the client secret as a secret. Prefer the Secrets manager.</p>
        </div>
        <div className="space-y-1 md:col-span-2">
          <Label>OAuth redirect URI</Label>
          <Input value={cur.redirect_uri ?? ""} onChange={(e) => setK("redirect_uri", e.target.value)} placeholder="https://jfeffect.com/api/public/signnow/callback" />
        </div>

        <div className="md:col-span-2 grid gap-2 sm:grid-cols-2 rounded-md border border-border bg-secondary/30 p-3">
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Access token status</Label>
            <Badge variant="outline" className={cur.access_token_status === "Valid" ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
              {cur.access_token_status ?? "Missing"}
            </Badge>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label className="text-xs">Refresh token status</Label>
            <Badge variant="outline" className={cur.refresh_token_status === "Valid" ? "border-emerald-500/40 text-emerald-500" : "border-amber-500/40 text-amber-500"}>
              {cur.refresh_token_status ?? "Missing"}
            </Badge>
          </div>
          <div className="text-[11px] text-muted-foreground">
            Last tested at: {cur.last_test_at ? new Date(cur.last_test_at).toLocaleString() : "Never"}
          </div>
          <div className="text-[11px] text-muted-foreground">
            Last synced at: {cur.last_synced_at ? new Date(cur.last_synced_at).toLocaleString() : "Never"}
          </div>
          {cur.last_error && (
            <div className="sm:col-span-2 text-[11px] text-destructive">Last error: {cur.last_error}</div>
          )}
        </div>

        <div className="md:col-span-2 space-y-1">
          <Label>App mode note</Label>
          <Input value={cur.app_mode_note ?? ""} onChange={(e) => setK("app_mode_note", e.target.value)} placeholder="e.g. Running manually until SignNow OAuth approved" />
        </div>

        <div className="md:col-span-2 flex items-center justify-between rounded-md border border-border bg-secondary/30 px-3 py-2">
          <div>
            <Label className="text-xs">Auto reminders (1d / 3d / 7d)</Label>
            <p className="text-[11px] text-muted-foreground">Sends reminders for unsigned agreements. Requires API mode.</p>
          </div>
          <Switch checked={!!cur.auto_reminders_enabled} onCheckedChange={(v) => setK("auto_reminders_enabled", v)} />
        </div>
        <div className="md:col-span-2 space-y-1">
          <Label>Internal notes</Label>
          <Textarea value={cur.notes ?? ""} onChange={(e) => setK("notes", e.target.value)} rows={2} />
        </div>
      </div>

      <div className="flex flex-wrap gap-2 pt-2 border-t border-border/50">
        <Button onClick={save} disabled={busy} className="bg-gradient-primary uppercase font-bold">Save SignNow settings</Button>
        <Button onClick={test} disabled={busy} variant="outline"><Send className="mr-2 h-4 w-4" />Test connection</Button>
        {cur.signnow_dashboard_url && (
          <Button asChild variant="ghost">
            <a href={cur.signnow_dashboard_url} target="_blank" rel="noreferrer">Open SignNow <ExternalLink className="ml-1 h-3 w-3" /></a>
          </Button>
        )}
      </div>
      {cur.last_test_at && (
        <p className="text-xs text-muted-foreground">Last test: {new Date(cur.last_test_at).toLocaleString()} — {cur.last_test_result}</p>
      )}
    </Card>
  );
}