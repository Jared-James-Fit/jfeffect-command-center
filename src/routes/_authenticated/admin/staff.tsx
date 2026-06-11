import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  listStaff, inviteMediaManager, resendStaffInvite, revokeStaffInvite, deactivateMediaManager,
} from "@/lib/media-manager.functions";

export const Route = createFileRoute("/_authenticated/admin/staff")({
  component: StaffPage,
});

function StaffPage() {
  const list = useServerFn(listStaff);
  const invite = useServerFn(inviteMediaManager);
  const resend = useServerFn(resendStaffInvite);
  const revoke = useServerFn(revokeStaffInvite);
  const deactivate = useServerFn(deactivateMediaManager);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["staff"], queryFn: () => list() });

  const [form, setForm] = useState({ email: "", first_name: "", last_name: "", phone: "" });

  async function handleInvite() {
    if (!form.email || !form.first_name || !form.last_name) return toast.error("Name and email required");
    try {
      const res = await invite({ data: { ...form, phone: form.phone || null } });
      await navigator.clipboard.writeText(res.link);
      toast.success("Invite created — setup link copied to clipboard");
      setForm({ email: "", first_name: "", last_name: "", phone: "" });
      qc.invalidateQueries({ queryKey: ["staff"] });
    } catch (e: any) { toast.error(e.message); }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <header>
        <h1 className="text-2xl md:text-3xl font-black tracking-tight">Staff & Media Manager Access</h1>
        <p className="text-sm text-muted-foreground">Invite a Media Manager. They will get a setup link to create their password.</p>
      </header>

      <Card className="p-4 space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Invite Media Manager</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          <Input placeholder="First name" value={form.first_name} onChange={(e) => setForm({ ...form, first_name: e.target.value })} />
          <Input placeholder="Last name" value={form.last_name} onChange={(e) => setForm({ ...form, last_name: e.target.value })} />
          <Input placeholder="Email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
          <Input placeholder="Phone (optional)" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </div>
        <Button onClick={handleInvite}>Send Invite</Button>
      </Card>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Active Media Managers</h2>
        {(data?.members ?? []).length === 0 && <div className="text-sm text-muted-foreground">No media managers yet.</div>}
        {data?.members?.map((m: any) => (
          <Card key={m.user_id} className="p-3 flex items-center justify-between">
            <div>
              <div className="font-medium">{m.profile?.full_name || m.profile?.email || m.user_id}</div>
              <div className="text-xs text-muted-foreground">{m.profile?.email}</div>
            </div>
            <Button size="sm" variant="outline" onClick={async () => {
              if (!confirm("Revoke this Media Manager's access?")) return;
              try { await deactivate({ data: { userId: m.user_id } }); qc.invalidateQueries({ queryKey: ["staff"] }); toast.success("Access revoked"); }
              catch (e: any) { toast.error(e.message); }
            }}>Revoke access</Button>
          </Card>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Pending Invites</h2>
        {isLoading && <div className="text-sm text-muted-foreground">Loading…</div>}
        {(data?.invites ?? []).filter((i: any) => i.status === "pending").map((i: any) => (
          <Card key={i.id} className="p-3 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <div className="font-medium truncate">{i.first_name} {i.last_name}</div>
              <div className="text-xs text-muted-foreground">{i.email}</div>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{i.status}</Badge>
              <Button size="sm" variant="outline" onClick={async () => {
                try {
                  const r = await resend({ data: { inviteId: i.id } });
                  await navigator.clipboard.writeText(r.link);
                  toast.success("New setup link copied");
                  qc.invalidateQueries({ queryKey: ["staff"] });
                } catch (e: any) { toast.error(e.message); }
              }}>Resend</Button>
              <Button size="sm" variant="destructive" onClick={async () => {
                try { await revoke({ data: { inviteId: i.id } }); qc.invalidateQueries({ queryKey: ["staff"] }); toast.success("Revoked"); }
                catch (e: any) { toast.error(e.message); }
              }}>Revoke</Button>
            </div>
          </Card>
        ))}
      </section>
    </div>
  );
}