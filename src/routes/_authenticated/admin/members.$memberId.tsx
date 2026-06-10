import { createFileRoute, Link } from "@tanstack/react-router";
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
import { Copy, Link2, KeyRound, Trash2, Plus, Eye } from "lucide-react";
import { toast } from "sonner";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { MemberAccessSummary } from "@/components/admin/member-access-summary";
import { JfAdminBillingCard } from "@/components/billing/jf-admin-billing-card";
import { ACCOUNT_TYPES, type AccountType } from "@/lib/membership";

export const Route = createFileRoute("/_authenticated/admin/members/$memberId")({ component: MemberProfile });

function copy(s: string) { navigator.clipboard.writeText(s).then(() => toast.success("Copied")); }

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

  const member = data?.member;
  const access = data?.access ?? [];
  const [notes, setNotes] = useState<string>("");
  const [newKey, setNewKey] = useState("");

  if (!member) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const refresh = () => qc.invalidateQueries({ queryKey: ["admin-member", memberId] });

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
            {(ACCOUNT_TYPES as any)[member.account_type]?.label ?? member.account_type}
          </Badge>
          <Badge>{member.status}</Badge>
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

      <MemberAccessSummary member={member} access={access} />
      {member.account_type === "jf_member" && <JfAdminBillingCard member={member} />}

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
        <div className="flex items-center justify-between">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Access</div>
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

      <Card className="space-y-3 p-5">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">Admin notes</div>
        <Textarea defaultValue={member.admin_notes ?? ""} onBlur={async (e) => {
          await update({ data: { memberId, admin_notes: e.target.value } });
        }} placeholder="Internal notes (private)" />
      </Card>
    </div>
  );
}