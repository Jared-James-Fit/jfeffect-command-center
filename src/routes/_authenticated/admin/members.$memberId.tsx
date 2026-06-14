import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  getMember, updateAppMember, generateSetupLink, generatePasswordResetLink,
  grantAccess, revokeAccess, deleteAdminMember,
} from "@/lib/members.functions";
import { copyPovFromMember } from "@/lib/pov.functions";
import { adminUpdateMemberSetup } from "@/lib/member-setup.functions";
import { setPovFlag } from "@/components/pov-quick-toggle";
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
import { MemberFeatureToggles } from "@/components/admin/member-feature-toggles";
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
  const deleteMemberFn = useServerFn(deleteAdminMember);
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
      {member.account_type === "jf_member" && member.profile_picture_required && !member.avatar_url && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs font-semibold text-amber-300">
          Setup incomplete — profile picture required.
        </div>
      )}
      <PageHeader
        backTo="/admin/members"
        backLabel="Back to Members"
        breadcrumbs={[{ label: "Members", to: "/admin/members" }, { label: member.full_name || member.email }]}
        title={member.full_name || member.email}
        subtitle={member.email}
        actions={<div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline" className="bg-emerald-500/10 text-emerald-300 border-emerald-500/30 font-bold uppercase tracking-wider">
            JF Membership
          </Badge>
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
          <TabsTrigger value="setup">Setup Info</TabsTrigger>
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
          <MemberFeatureToggles memberId={memberId} levels={levels as any} access={access as any} />
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">Manual access grants (advanced)</div>
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

        {/* ───────────── Setup Info ───────────── */}
        <TabsContent value="setup" className="space-y-5">
          <MemberSetupInfoCard member={member} memberId={memberId} />
        </TabsContent>
      </Tabs>

      <DangerZone
        memberEmail={member.email}
        onDelete={async () => {
          await deleteMemberFn({ data: { memberId } });
          toast.success("Member account deleted");
          await qc.invalidateQueries({ queryKey: ["admin-members"] });
          navigate({ to: "/admin/members" });
        }}
      />
    </div>
  );
}

function DangerZone({ memberEmail, onDelete }: { memberEmail: string; onDelete: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [confirmEmail, setConfirmEmail] = useState("");
  const [deleting, setDeleting] = useState(false);
  const matches = confirmEmail.trim().toLowerCase() === (memberEmail ?? "").trim().toLowerCase();

  async function handleDelete() {
    if (!matches) return;
    setDeleting(true);
    try {
      await onDelete();
    } catch (e: any) {
      toast.error(e?.message ?? "Delete failed");
      setDeleting(false);
    }
  }

  return (
    <Card className="space-y-4 border-destructive/40 bg-destructive/5 p-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-destructive">Danger zone</div>
        <p className="mt-1 text-sm text-muted-foreground">
          Permanently deletes the member row and removes their auth account. This cannot be undone.
        </p>
      </div>
      {!open ? (
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2 className="mr-2 h-4 w-4" /> Delete Account
        </Button>
      ) : (
        <div className="space-y-3">
          <div>
            <Label className="text-xs">
              Type <span className="font-mono">{memberEmail}</span> to confirm
            </Label>
            <Input
              autoFocus
              value={confirmEmail}
              onChange={(e) => setConfirmEmail(e.target.value)}
              placeholder={memberEmail}
              className="mt-1"
              disabled={deleting}
            />
          </div>
          <div className="flex gap-2">
            <Button variant="destructive" disabled={!matches || deleting} onClick={handleDelete}>
              {deleting ? "Deleting…" : "Permanently delete account"}
            </Button>
            <Button variant="ghost" disabled={deleting} onClick={() => { setOpen(false); setConfirmEmail(""); }}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}

function MemberSetupInfoCard({ member, memberId }: { member: any; memberId: string }) {
  const save = useServerFn(adminUpdateMemberSetup);
  const qc = useQueryClient();
  const [form, setForm] = useState<any>({});
  const v = (k: string) => (form[k] ?? member[k] ?? "");
  const set = (k: string, val: any) => setForm((f: any) => ({ ...f, [k]: val }));
  const flush = async (patch: any) => {
    try {
      await save({ data: { memberId, ...patch } });
      await qc.invalidateQueries({ queryKey: ["admin-member", memberId] });
      toast.success("Saved");
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };
  return (
    <Card className="space-y-4 p-5">
      <div>
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Required setup fields</div>
        <p className="mt-1 text-xs text-muted-foreground">
          These mirror the client intake. Members are blocked from /m until all required fields are completed.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Phone</Label>
          <Input defaultValue={member.phone ?? ""} onBlur={(e) => e.target.value !== (member.phone ?? "") && flush({ phone: e.target.value })} />
        </div>
        <div>
          <Label>Date of birth</Label>
          <Input type="date" defaultValue={member.date_of_birth ?? ""} onBlur={(e) => e.target.value !== (member.date_of_birth ?? "") && flush({ date_of_birth: e.target.value || null })} />
        </div>
        <div className="sm:col-span-2">
          <Label>Street address</Label>
          <Input defaultValue={member.address_line1 ?? ""} onBlur={(e) => flush({ address_line1: e.target.value })} />
        </div>
        <div><Label>City</Label><Input defaultValue={member.address_city ?? ""} onBlur={(e) => flush({ address_city: e.target.value })} /></div>
        <div><Label>State</Label><Input defaultValue={member.address_state ?? ""} onBlur={(e) => flush({ address_state: e.target.value })} /></div>
        <div><Label>ZIP</Label><Input defaultValue={member.address_zip ?? ""} onBlur={(e) => flush({ address_zip: e.target.value })} /></div>
        <div><Label>Country</Label><Input defaultValue={member.address_country ?? ""} onBlur={(e) => flush({ address_country: e.target.value })} /></div>
        <div><Label>Emergency contact name</Label><Input defaultValue={member.emergency_contact_name ?? ""} onBlur={(e) => flush({ emergency_contact_name: e.target.value })} /></div>
        <div><Label>Emergency contact phone</Label><Input defaultValue={member.emergency_contact_phone ?? ""} onBlur={(e) => flush({ emergency_contact_phone: e.target.value })} /></div>
        <div className="sm:col-span-2">
          <Label>Goals</Label>
          <Textarea rows={3} defaultValue={member.goals ?? ""} onBlur={(e) => flush({ goals: e.target.value })} />
        </div>
        <div className="sm:col-span-2">
          <Label>Training background</Label>
          <Textarea rows={3} defaultValue={member.training_background ?? ""} onBlur={(e) => flush({ training_background: e.target.value })} />
        </div>
      </div>
      <div className="flex items-center gap-2 pt-2 text-xs">
        <span className="text-muted-foreground">Setup complete:</span>
        <Badge variant={member.setup_completed_at ? "default" : "outline"}>
          {member.setup_completed_at ? new Date(member.setup_completed_at).toLocaleString() : "Not yet"}
        </Badge>
      </div>
    </Card>
  );
}