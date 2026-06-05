import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Plus, Edit2, Archive, ExternalLink, ShieldCheck, AlertTriangle, FileText, Loader2, UserPlus, Smartphone, Copy, Search } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createTemplate, updateTemplate, archiveTemplate, createAgreement } from "@/lib/agreements.functions";
import { AGREEMENT_TYPES, type AgreementTemplate, type Agreement, VERIFICATION_BADGE, type SigningMethod } from "@/lib/agreements";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { Link as RouterLink, useNavigate } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/admin/agreements/")({
  component: AgreementsAdminPage,
});

function AgreementsAdminPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<AgreementTemplate> | null>(null);
  const [actioning, setActioning] = useState<{ template: AgreementTemplate; mode: "invite" | "in-person" } | null>(null);
  const createFn = useServerFn(createTemplate);
  const updateFn = useServerFn(updateTemplate);
  const archiveFn = useServerFn(archiveTemplate);

  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates"],
    queryFn: async () => (await supabase.from("agreement_templates")
      .select("*").eq("archived", false).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: needAttention = [] } = useQuery({
    queryKey: ["agreements-needing-attention"],
    queryFn: async () => {
      const { data } = await supabase.from("agreements")
        .select("*, clients(id, full_name)")
        .or("signer_mismatch.eq.true,status.in.(Sent,Opened,Waiting on Client,Expired,Needs Resend,Needs Manual Verification,Error)")
        .order("created_at", { ascending: false }).limit(50);
      return (data ?? []) as (Agreement & { clients: { id: string; full_name: string } | null })[];
    },
  });

  async function save(payload: Partial<AgreementTemplate>) {
    if (editing?.id) {
      await updateFn({ data: { id: editing.id, ...payload } as any });
      toast.success("Template updated");
    } else {
      await createFn({ data: payload as any });
      toast.success("Template created");
    }
    qc.invalidateQueries({ queryKey: ["agreement-templates"] });
    setEditing(null);
  }

  return (
    <>
      <PageHeader title="Agreements" subtitle="Connected to SignNow. Tracks, organizes, and verifies signed copies." />
      <div className="p-6 md:p-8 space-y-6">
        <Card className="border-border bg-card p-5 space-y-3">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Agreements Needing Attention</h2>
            </div>
            <span className="text-xs text-muted-foreground">{needAttention.length}</span>
          </div>
          {needAttention.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">All agreements are signed and verified.</p>
          ) : (
            <ul className="divide-y divide-border">
              {needAttention.map((a) => (
                <li key={a.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <div className="min-w-0 flex-1 flex items-center gap-2">
                    <FileText className="h-4 w-4 text-muted-foreground" />
                    <div className="min-w-0">
                      <Link to="/admin/clients/$id" params={{ id: a.client_id }} className="font-semibold hover:underline">
                        {a.clients?.full_name ?? a.client_full_name ?? "Client"}
                      </Link>
                      <span className="text-xs text-muted-foreground"> · {a.agreement_type ?? a.template_name}</span>
                      {a.signer_mismatch && <Badge variant="outline" className="ml-2 border-amber-500/40 bg-amber-500/10 text-amber-500 text-[10px]">Mismatch</Badge>}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <AgreementStatusBadge status={a.status} />
                    <Badge variant="secondary" className={`border-0 ${VERIFICATION_BADGE[a.verification_status] ?? ""}`}>{a.verification_status}</Badge>
                    <Link to="/admin/clients/$id" params={{ id: a.client_id }} className="text-xs text-primary hover:underline">Open</Link>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Agreement Templates</h2>
            </div>
            <Button size="sm" onClick={() => setEditing({})}><Plus className="h-3.5 w-3.5 mr-1" /> Add template</Button>
          </div>

          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No templates yet. Add your SignNow templates here so you can send them from each client profile.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((t) => (
                <Card key={t.id} className="p-4 space-y-2 bg-secondary/30 border-border">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold truncate">{t.name}</p>
                      <p className="text-xs text-muted-foreground truncate">{t.agreement_type ?? "Custom type"}</p>
                    </div>
                    <Badge variant="outline" className={t.is_active ? "border-emerald-500/40 text-emerald-500" : "border-muted text-muted-foreground"}>
                      {t.is_active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  {t.signnow_template_id && <p className="text-[11px] text-muted-foreground">SignNow ID: {t.signnow_template_id}</p>}
                  {t.notes && <p className="text-xs text-muted-foreground line-clamp-2">{t.notes}</p>}
                  <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground py-1">
                    <div>Sent: <span className="text-foreground font-medium">{(t as any).times_sent ?? 0}</span></div>
                    <div>Signed: <span className="text-foreground font-medium">{(t as any).times_completed ?? 0}</span></div>
                    <div>Last: <span className="text-foreground font-medium">{(t as any).last_used_at ? new Date((t as any).last_used_at).toLocaleDateString() : "—"}</span></div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" className="flex-1 min-w-[120px]" onClick={() => setActioning({ template: t, mode: "invite" })}>
                      <UserPlus className="h-3 w-3 mr-1" /> Invite to Sign
                    </Button>
                    <Button size="sm" variant="secondary" className="flex-1 min-w-[120px]" onClick={() => setActioning({ template: t, mode: "in-person" })}>
                      <Smartphone className="h-3 w-3 mr-1" /> Sign Template
                    </Button>
                    {t.signnow_url && (
                      <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(t.signnow_url!); toast.success("Signing link copied"); }}>
                        <Copy className="h-3 w-3 mr-1" /> Copy link
                      </Button>
                    )}
                    {t.signnow_url && (
                      <Button size="sm" variant="ghost" asChild>
                        <a href={t.signnow_url} target="_blank" rel="noreferrer"><ExternalLink className="h-3 w-3 mr-1" /> SignNow</a>
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(t)}>
                      <Edit2 className="h-3 w-3 mr-1" /> Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (!confirm(`${t.is_active ? "Deactivate" : "Archive"} this template?`)) return;
                      await archiveFn({ data: { id: t.id } });
                      qc.invalidateQueries({ queryKey: ["agreement-templates"] });
                    }}><Archive className="h-3 w-3 mr-1" /> Deactivate</Button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </Card>
      </div>

      <TemplateDialog
        key={editing?.id ?? (editing ? "new" : "closed")}
        open={editing !== null}
        onOpenChange={(o) => !o && setEditing(null)}
        initial={editing ?? {}}
        onSubmit={save}
      />

      <TemplateActionDialog
        open={actioning !== null}
        action={actioning}
        onOpenChange={(o) => !o && setActioning(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["agreement-templates"] });
          qc.invalidateQueries({ queryKey: ["agreements-needing-attention"] });
          setActioning(null);
        }}
      />
    </>
  );
}

function TemplateDialog({
  open, onOpenChange, initial, onSubmit,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  initial: Partial<AgreementTemplate>;
  onSubmit: (payload: Partial<AgreementTemplate>) => Promise<void>;
}) {
  const [form, setForm] = useState<Partial<AgreementTemplate>>(initial);
  const [busy, setBusy] = useState(false);

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) setForm({}); onOpenChange(o); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader><DialogTitle>{initial.id ? "Edit template" : "New agreement template"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label className="text-xs">Template name</Label>
            <Input value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Coaching Agreement + Liability Waiver" />
          </div>
          <div>
            <Label className="text-xs">Agreement type</Label>
            <Select value={form.agreement_type ?? ""} onValueChange={(v) => setForm({ ...form, agreement_type: v })}>
              <SelectTrigger><SelectValue placeholder="Pick a type" /></SelectTrigger>
              <SelectContent>
                {AGREEMENT_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">SignNow template ID</Label>
            <Input value={form.signnow_template_id ?? ""} onChange={(e) => setForm({ ...form, signnow_template_id: e.target.value })} placeholder="From your SignNow template URL" />
          </div>
          <div>
            <Label className="text-xs">SignNow template URL (signing link)</Label>
            <Input value={form.signnow_url ?? ""} onChange={(e) => setForm({ ...form, signnow_url: e.target.value })} placeholder="https://app.signnow.com/..." />
          </div>
          <div>
            <Label className="text-xs">Version</Label>
            <Input value={form.version ?? "1"} onChange={(e) => setForm({ ...form, version: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Description</Label>
            <Textarea rows={2} value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} />
          </div>
          <div>
            <Label className="text-xs">Internal notes</Label>
            <Textarea rows={2} value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
          </div>
          <div className="flex items-center justify-between">
            <Label className="text-xs">Active</Label>
            <Switch checked={form.is_active ?? true} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => {
            if (!form.name) return toast.error("Name required");
            setBusy(true);
            try { await onSubmit(form); } finally { setBusy(false); }
          }} disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}