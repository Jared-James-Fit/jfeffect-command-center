import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMember, updateAppMember, generateSetupLink, generatePasswordResetLink,
  grantAccess, revokeAccess,
} from "@/lib/members.functions";
import { copyPovFromMember } from "@/lib/pov.functions";
import { setPovFlag } from "@/components/admin-pov";
import { useNavigate } from "@tanstack/react-router";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Link2, KeyRound, Trash2, Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { supabase } from "@/integrations/supabase/client";
import { MemberAccessSummary } from "@/components/admin/member-access-summary";
import { JfAdminBillingCard } from "@/components/billing/jf-admin-billing-card";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/membership";

export const Route = createFileRoute("/_authenticated/admin/members/$memberId")({ component: MemberProfile });

function copy(s: string) { navigator.clipboard.writeText(s).then(() => toast.success("Copied")); }

function fmtWhen(s: string | null | undefined) {
  if (!s) return "—";
  try { return new Date(s).toLocaleString(); } catch { return s; }
}

function MemberProfile() {
  const { memberId } = Route.useParams();
  const qc = useQueryClient();
  const fetch = useServerFn(getMember);
  const update = useServerFn(updateAppMember);
  const setup = useServerFn(generateSetupLink);
  const reset = useServerFn(generatePasswordResetLink);
  const grant = useServerFn(grantAccess);
  const revoke = useServerFn(revokeAccess);
  const copyPov = useServerFn(copyPovFromMember);
  const navigate = useNavigate();

  const { data } = useQuery({ queryKey: ["admin-member", memberId], queryFn: () => fetch({ data: { memberId } }) });
  const { data: levels = [] } = useQuery({
    queryKey: ["access-levels"],
    queryFn: async () => (await supabase.from("access_levels").select("*").order("sort_order")).data ?? [],
  });
  const { data: smsRows = [] } = useQuery({
    queryKey: ["member-sms-log", memberId],
    queryFn: async () => (await supabase.from("sms_log")
      .select("id, created_at, body, status, kind, to_phone, error, automation_trigger, twilio_sid")
      .eq("app_member_id", memberId)
      .order("created_at", { ascending: false })
      .limit(50)).data ?? [],
    refetchInterval: 20000,
  });

  const member = data?.member;
  const access = data?.access ?? [];
  const [newKey, setNewKey] = useState("");
  const [tab, setTab] = useState("summary");

  if (!member) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-member", memberId] });
  const acctLabel = (ACCOUNT_TYPES as any)[member.account_type]?.label ?? member.account_type;

  return (
    <div className="space-y-5">
      <PageHeader
        backTo="/admin/members"
        backLabel="Back to Members"
        breadcrumbs={[{ label: "Members", to: "/admin/members" }, { label: member.full_name || member.email }]}
        title={member.full_name || member.email}
        subtitle={member.email}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={(ACCOUNT_TYPES as any)[member.account_type]?.tone}>
            {acctLabel}
          </Badge>
          <Badge>{member.status}</Badge>
          {member.subscription_status && <Badge variant="outline">{member.subscription_status}</Badge>}
          <Button size="sm" variant="outline" onClick={async () => {
            try {
              await copyPov({ data: { memberId } });
              setPovFlag(`as:${member.full_name || member.email}`);
              toast.success("Entering member POV");
              navigate({ to: "/m" });
            } catch (e: any) { toast.error(e?.message ?? "Failed"); }
          }}>
            <Eye className="mr-1 h-3.5 w-3.5" />View as this member
          </Button>
        </div>}
      />

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList className="mb-4 flex flex-wrap h-auto">
          <TabsTrigger value="summary">Summary</TabsTrigger>
          <TabsTrigger value="subscription">Subscription</TabsTrigger>
          <TabsTrigger value="access">Access</TabsTrigger>
          <TabsTrigger value="sms">SMS Activity</TabsTrigger>
          <TabsTrigger value="notes">Notes</TabsTrigger>
        </TabsList>

        {/* ───────────── Summary ───────────── */}
        <TabsContent value="summary" className="space-y-5">
          <MemberAccessSummary member={member} access={access} />

          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Contact</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Full name</Label>
                <Input defaultValue={member.full_name ?? ""}
                  onBlur={async (e) => {
                    if (e.target.value !== (member.full_name ?? "")) {
                      await update({ data: { memberId, full_name: e.target.value } });
                      refresh();
                    }
                  }} />
              </div>
              <div>
                <Label>Email</Label>
                <Input value={member.email ?? ""} readOnly className="bg-muted/40" />
              </div>
              <div>
                <Label>Mobile phone (for SMS)</Label>
                <Input defaultValue={member.phone ?? ""} placeholder="+15551234567"
                  onBlur={async (e) => {
                    if (e.target.value !== (member.phone ?? "")) {
                      await update({ data: { memberId, phone: e.target.value || null } });
                      refresh();
                      toast.success("Phone saved");
                    }
                  }} />
              </div>
            </div>
            <div className="flex items-center gap-3 pt-1">
              <Switch checked={!!member.sms_opt_out}
                onCheckedChange={async (v) => { await update({ data: { memberId, sms_opt_out: v } }); refresh(); }} />
              <Label className="text-sm">SMS opt-out (won't receive any automations)</Label>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Status & type</div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label>Status</Label>
                <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={member.status}
                  onChange={async (e) => { await update({ data: { memberId, status: e.target.value as any } }); refresh(); }}>
                  {["Active","Trial","Past Due","Cancelled","Expired","Deactivated","Archived"].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
              <div>
                <Label>Account type</Label>
                <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={member.account_type}
                  onChange={async (e) => { await update({ data: { memberId, account_type: e.target.value as any } }); refresh(); }}>
                  {(Object.keys(ACCOUNT_TYPES) as AccountType[]).map((k) => (
                    <option key={k} value={k}>{ACCOUNT_TYPES[k].label}</option>
                  ))}
                </select>
              </div>
              <div>
                <Label>Messaging</Label>
                <select className="mt-1 block h-9 w-full rounded-md border bg-background px-3 text-sm" value={member.messaging_permission}
                  onChange={async (e) => { await update({ data: { memberId, messaging_permission: e.target.value as any } }); refresh(); }}>
                  <option value="none">None</option>
                  <option value="support_only">Support only</option>
                  <option value="upgrade_only">Upgrade inquiries</option>
                </select>
              </div>
            </div>
          </Card>

          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Account setup</div>
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" variant="outline" onClick={async () => {
                const { link } = await setup({ data: { memberId } });
                copy(link); refresh();
              }}>
                <Link2 className="mr-2 h-4 w-4" />Generate & copy setup link
              </Button>
              <Button size="sm" variant="outline" onClick={async () => {
                const { link } = await reset({ data: { memberId } });
                copy(link);
              }}>
                <KeyRound className="mr-2 h-4 w-4" />Generate & copy password reset link
              </Button>
              {!member.user_id && <Badge variant="outline">No account yet — share setup link</Badge>}
            </div>
          </Card>
        </TabsContent>

        {/* ───────────── Subscription ───────────── */}
        <TabsContent value="subscription" className="space-y-5">
          {member.account_type === "jf_member"
            ? <JfAdminBillingCard member={member} />
            : (
              <Card className="p-5 text-sm text-muted-foreground">
                This member is on the <b>{acctLabel}</b> plan — no recurring subscription is tracked here.
                Switch the account type to <b>JF Membership</b> on the Summary tab to enable Stripe billing.
              </Card>
            )}

          <Card className="p-5 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Billing snapshot</div>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div><span className="text-muted-foreground">Stripe customer:</span> <span className="font-mono">{member.stripe_customer_id ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Subscription:</span> <span className="font-mono">{member.stripe_subscription_id ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Price ID:</span> <span className="font-mono">{member.stripe_price_id ?? "—"}</span></div>
              <div><span className="text-muted-foreground">Last invoice:</span> {member.last_invoice_status ?? "—"}</div>
              <div><span className="text-muted-foreground">Trial ends:</span> {fmtWhen(member.trial_end_at)}</div>
              <div><span className="text-muted-foreground">Renews on:</span> {fmtWhen(member.current_period_end)}</div>
              <div><span className="text-muted-foreground">Cancels on:</span> {fmtWhen(member.cancel_at)}</div>
              <div><span className="text-muted-foreground">Cancelled at:</span> {fmtWhen(member.cancelled_at)}</div>
              <div><span className="text-muted-foreground">Paused until:</span> {fmtWhen(member.paused_until)}</div>
              <div><span className="text-muted-foreground">Last billing event:</span> {fmtWhen(member.last_billing_event_at)}</div>
            </div>
          </Card>
        </TabsContent>

        {/* ───────────── Access ───────────── */}
        <TabsContent value="access" className="space-y-5">
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Access grants</div>
              <div className="flex items-center gap-2">
                <select className="h-8 rounded-md border bg-background px-2 text-sm" value={newKey} onChange={(e) => setNewKey(e.target.value)}>
                  <option value="">Select access…</option>
                  {(levels as any[]).map((lv) => <option key={lv.key} value={lv.key}>{lv.label}</option>)}
                </select>
                <Button size="sm" disabled={!newKey} onClick={async () => {
                  await grant({ data: { memberId, accessKey: newKey } });
                  setNewKey(""); refresh();
                }}><Plus className="mr-1 h-3.5 w-3.5" />Grant</Button>
              </div>
            </div>
            <div className="divide-y rounded-md border">
              {access.length === 0 && <div className="p-3 text-sm text-muted-foreground">No active access.</div>}
              {access.map((a: any) => (
                <div key={a.id} className="flex items-center justify-between p-3 text-sm">
                  <div>
                    <div className="font-medium">{a.access_level_key}</div>
                    <div className="text-xs text-muted-foreground">{a.source}{a.expires_at ? ` · until ${new Date(a.expires_at).toLocaleDateString()}` : ""}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant={a.active ? "default" : "secondary"}>{a.active ? "Active" : "Revoked"}</Badge>
                    {a.active && (
                      <Button size="icon" variant="ghost" onClick={async () => { await revoke({ data: { accessId: a.id } }); refresh(); }}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </TabsContent>

        {/* ───────────── SMS Activity ───────────── */}
        <TabsContent value="sms" className="space-y-5">
          <Card className="p-5 space-y-2">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">SMS reach</div>
            <div className="text-sm">
              Phone on file: <span className="font-mono">{member.phone || <span className="text-muted-foreground">none</span>}</span>
            </div>
            <div className="text-xs text-muted-foreground">
              Automations matching the <b>account_created</b> and <b>subscription_purchased</b> triggers send to this number automatically.
              Manage automations in <span className="font-semibold">Admin → Settings → SMS</span>.
            </div>
          </Card>

          <Card className="p-5 space-y-3">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Recent SMS to this member</div>
            {smsRows.length === 0
              ? <div className="text-sm text-muted-foreground">No SMS has been sent to this member yet.</div>
              : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead className="text-left text-muted-foreground">
                      <tr>
                        <th className="p-2">When</th>
                        <th className="p-2">Trigger</th>
                        <th className="p-2">To</th>
                        <th className="p-2">Status</th>
                        <th className="p-2">Body / error</th>
                      </tr>
                    </thead>
                    <tbody>
                      {smsRows.map((r: any) => (
                        <tr key={r.id} className="border-t border-border align-top">
                          <td className="p-2 whitespace-nowrap">{fmtWhen(r.created_at)}</td>
                          <td className="p-2">{r.automation_trigger ?? r.kind}</td>
                          <td className="p-2 whitespace-nowrap">{r.to_phone || "—"}</td>
                          <td className="p-2"><Badge variant={r.status === "sent" ? "default" : r.status === "failed" ? "destructive" : "outline"}>{r.status}</Badge></td>
                          <td className="p-2 max-w-md">{r.error ? <span className="text-destructive">{r.error}</span> : <span className="text-muted-foreground">{r.body}</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </Card>
        </TabsContent>

        {/* ───────────── Notes ───────────── */}
        <TabsContent value="notes" className="space-y-5">
          <Card className="space-y-3 p-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Admin notes</div>
            <Textarea rows={8} defaultValue={member.admin_notes ?? ""} onBlur={async (e) => {
              await update({ data: { memberId, admin_notes: e.target.value } });
              toast.success("Notes saved");
            }} placeholder="Internal notes (private)" />
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}