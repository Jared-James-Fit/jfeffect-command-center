import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useEffect, useState } from "react";
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
import { Plus, Edit2, Archive, ExternalLink, ShieldCheck, Loader2, UserPlus, Copy, Search, Power, Trash2, Info, Settings, FolderArchive } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createTemplate, updateTemplate, archiveTemplate, setTemplateActive, createAgreement, syncSignNowTemplates } from "@/lib/agreements.functions";
import { AGREEMENT_TYPES, type AgreementTemplate } from "@/lib/agreements";
import { AgreementStatusBadge } from "@/components/agreement-status-badge";
import { useNavigate } from "@tanstack/react-router";
import { SentAgreementsManager } from "@/components/sent-agreements-manager";

export const Route = createFileRoute("/_authenticated/admin/agreements/")({
  component: AgreementsAdminRedirect,
});

function AgreementsAdminRedirect() {
  const nav = useNavigate();
  useEffect(() => {
    nav({ to: "/admin/forms", search: { tab: "agreements" } as any, replace: true });
  }, [nav]);
  return null;
}

export function AgreementsAdminPage({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<AgreementTemplate> | null>(null);
  const [actioning, setActioning] = useState<{ template: AgreementTemplate } | null>(null);
  const createFn = useServerFn(createTemplate);
  const updateFn = useServerFn(updateTemplate);
  const archiveFn = useServerFn(archiveTemplate);
  const setActiveFn = useServerFn(setTemplateActive);
  const syncFn = useServerFn(syncSignNowTemplates);
  const [syncing, setSyncing] = useState(false);

  const { data: templates = [] } = useQuery({
    queryKey: ["agreement-templates"],
    queryFn: async () => (await supabase.from("agreement_templates")
      .select("*").eq("archived", false).order("created_at", { ascending: false })).data ?? [],
  });

  const { data: signnow } = useQuery({
    queryKey: ["signnow-settings"],
    queryFn: async () => (await supabase.from("signnow_settings").select("*").limit(1).maybeSingle()).data,
  });
  const apiConnected = signnow?.status === "Connected";


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
      {!embedded && (
        <PageHeader title="Agreements" subtitle="Connected to SignNow. Tracks, organizes, and verifies signed copies." />
      )}
      <div className="p-6 md:p-8 space-y-6">
        <div className="flex justify-end">
          <Link to="/admin/agreements/signed">
            <Button variant="outline" size="sm">
              <FolderArchive className="h-4 w-4 mr-1" /> Signed Documents
            </Button>
          </Link>
        </div>
        {!apiConnected && (
          <Card className="border-amber-500/40 bg-amber-500/5 p-4 flex items-start gap-3">
            <Info className="h-4 w-4 text-amber-500 mt-0.5 flex-shrink-0" />
            <div className="space-y-1 text-sm flex-1">
              <p className="font-semibold">Manual SignNow Link Mode</p>
              <p className="text-muted-foreground">
                SignNow API is not connected. Template syncing and automatic signing invites will not work.
                You can still paste SignNow signing links into templates and track signed copies manually.
                The app will not send emails on your behalf in this mode — copy the link and send it to the client yourself.
              </p>
              <Link to="/admin/settings" className="text-primary text-xs hover:underline inline-flex items-center gap-1 pt-1">
                <Settings className="h-3 w-3" /> Connect SignNow in Settings
              </Link>
            </div>
          </Card>
        )}

        <SentAgreementsManager />

        <Card className="border-border bg-card p-5 space-y-4">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-primary" />
              <h2 className="text-sm font-bold uppercase tracking-widest text-muted-foreground">Agreement Templates</h2>
            </div>
            <div className="flex gap-2 flex-wrap">
              <Button
                size="sm"
                variant="outline"
                disabled={!apiConnected || syncing}
                onClick={async () => {
                  setSyncing(true);
                  try {
                    const res = await syncFn();
                    toast.success(`Synced ${res.total} template${res.total === 1 ? "" : "s"} from SignNow (${res.created} new, ${res.updated} updated)`);
                    qc.invalidateQueries({ queryKey: ["agreement-templates"] });
                  } catch (e: any) {
                    toast.error(e?.message ?? "Sync failed");
                  } finally {
                    setSyncing(false);
                  }
                }}
                title={apiConnected ? "Pull templates from SignNow" : "Connect SignNow API to enable sync"}
              >
                {syncing ? <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" /> : <Search className="h-3.5 w-3.5 mr-1" />}
                Sync from SignNow
              </Button>
              <Button size="sm" onClick={() => setEditing({})}><Plus className="h-3.5 w-3.5 mr-1" /> Add template</Button>
            </div>
          </div>

          {templates.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4 text-center">No templates yet. Add your SignNow templates here so you can send them from each client profile.</p>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {templates.map((t) => {
                const hasLink = !!t.signnow_url;
                const hasId = !!t.signnow_template_id;
                const isApiTemplate = hasId;
                // API templates only need a SignNow ID + connected API to invite.
                // Manual templates need a signing URL.
                const ready = isApiTemplate ? apiConnected : hasLink;
                return (
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
                  <div className="flex flex-wrap gap-1">
                    {isApiTemplate ? (
                      <Badge variant="outline" className="border-primary/40 text-primary text-[10px]">SignNow API</Badge>
                    ) : (
                      <Badge variant="outline" className="border-muted text-[10px]">Manual</Badge>
                    )}
                    {ready ? (
                      <Badge variant="outline" className="border-emerald-500/40 text-emerald-500 text-[10px]">Ready</Badge>
                    ) : isApiTemplate ? (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">API Not Connected</Badge>
                    ) : (
                      <Badge variant="outline" className="border-amber-500/40 text-amber-500 text-[10px]">Missing ID</Badge>
                    )}
                  </div>
                  {!ready && (
                    <p className="text-[11px] text-amber-600 dark:text-amber-400">
                      {isApiTemplate
                        ? "SignNow API is not connected. Connect it in Settings to send invites with this template."
                        : "This template has no SignNow template ID or signing URL. Add one (or sync from SignNow) before sending."}
                    </p>
                  )}
                  {t.signnow_template_id && <p className="text-[11px] text-muted-foreground">SignNow ID: {t.signnow_template_id}</p>}
                  {t.notes && <p className="text-xs text-muted-foreground line-clamp-2">{t.notes}</p>}
                  <div className="grid grid-cols-3 gap-2 text-[10px] text-muted-foreground py-1">
                    <div>Sent: <span className="text-foreground font-medium">{(t as any).times_sent ?? 0}</span></div>
                    <div>Signed: <span className="text-foreground font-medium">{(t as any).times_completed ?? 0}</span></div>
                    <div>Last: <span className="text-foreground font-medium">{(t as any).last_used_at ? new Date((t as any).last_used_at).toLocaleDateString() : "—"}</span></div>
                  </div>
                  {t.version && <p className="text-[11px] text-muted-foreground">Version: {t.version} · Updated {new Date(t.updated_at).toLocaleDateString()}</p>}
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <Button size="sm" className="flex-1 min-w-[120px]" disabled={!ready} onClick={() => setActioning({ template: t })}>
                      <UserPlus className="h-3 w-3 mr-1" /> Invite to Sign
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
                      await setActiveFn({ data: { id: t.id, is_active: !t.is_active } });
                      qc.invalidateQueries({ queryKey: ["agreement-templates"] });
                      toast.success(t.is_active ? "Template deactivated" : "Template activated");
                    }}><Power className="h-3 w-3 mr-1" /> {t.is_active ? "Deactivate" : "Activate"}</Button>
                    <Button size="sm" variant="ghost" onClick={async () => {
                      if (!confirm(`Delete "${t.name}"? It will be hidden from the templates list. Existing signed agreements stay intact.`)) return;
                      await archiveFn({ data: { id: t.id } });
                      qc.invalidateQueries({ queryKey: ["agreement-templates"] });
                      toast.success("Template deleted");
                    }}><Trash2 className="h-3 w-3 mr-1" /> Delete</Button>
                  </div>
                </Card>
                );
              })}
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
        apiConnected={apiConnected}
        onOpenChange={(o) => !o && setActioning(null)}
        onDone={() => {
          qc.invalidateQueries({ queryKey: ["agreement-templates"] });
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

function TemplateActionDialog({
  open, action, apiConnected, onOpenChange, onDone,
}: {
  open: boolean;
  action: { template: AgreementTemplate } | null;
  apiConnected: boolean;
  onOpenChange: (o: boolean) => void;
  onDone: () => void;
}) {
  const navigate = useNavigate();
  const createAgreementFn = useServerFn(createAgreement);
  const [search, setSearch] = useState("");
  const [clientId, setClientId] = useState<string>("");
  const [linkOverride, setLinkOverride] = useState("");
  const [offerName, setOfferName] = useState("");
  const [notes, setNotes] = useState("");

  const { data: clients = [] } = useQuery({
    queryKey: ["clients-picker", search],
    enabled: open,
    queryFn: async () => {
      let q = supabase.from("clients").select("id, full_name, email").eq("archived", false).order("full_name").limit(50);
      if (search.trim()) q = q.ilike("full_name", `%${search.trim()}%`);
      const { data } = await q;
      return data ?? [];
    },
  });

  const selectedClient = clients.find((c) => c.id === clientId);
  const tpl = action?.template;
  const isApiTemplate = !!tpl?.signnow_template_id;
  const link = linkOverride.trim() || tpl?.signnow_url || null;

  const mutation = useMutation({
    mutationFn: async (vars: { tpl: AgreementTemplate; clientId: string }) => {
      const statusOverride = !apiConnected ? "Manual Action Needed" : undefined;
      // Only pass a signing link if it's a non-empty valid-looking URL.
      // The server validator rejects empty strings (z.string().url()).
      const trimmed = (linkOverride.trim() || vars.tpl.signnow_url || "").trim();
      const linkToSend = trimmed.length > 0 ? trimmed : null;
      return (await createAgreementFn({
        data: {
          client_id: vars.clientId,
          template_id: vars.tpl.id,
          agreement_type: vars.tpl.agreement_type ?? null,
          signnow_signing_link: linkToSend,
          offer_name: offerName.trim() || null,
          admin_notes: notes.trim() || null,
          send_now: true,
          signing_method: apiConnected ? "Remote Invite" : "Manual Link",
          status_override: statusOverride,
        } as any,
      })) as any;
    },
    onSuccess: (ag: any) => {
      toast.success(
        apiConnected
          ? "Invite sent to client via SignNow"
          : "Record created. Send the signing link to the client manually — the app did not email them.",
      );
      setSearch(""); setClientId(""); setLinkOverride(""); setOfferName(""); setNotes("");
      onDone();
      if (ag?.client_id) {
        navigate({ to: "/admin/clients/$id", params: { id: ag.client_id } });
      }
    },
    onError: (e: any) => {
      // Surface exact SignNow / server error verbatim. Keep dialog open.
      const msg = e?.message ?? (typeof e === "string" ? e : "Failed to create invite");
      // eslint-disable-next-line no-console
      console.error("[createAgreement] failed", e);
      toast.error(msg, { duration: 12000 });
    },
  });
  const busy = mutation.isPending;

  function go() {
    if (!tpl) { toast.error("No template selected"); return; }
    if (!clientId) { toast.error("Pick a client first"); return; }
    mutation.mutate({ tpl, clientId });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {apiConnected ? "Invite to Sign — SignNow API" : "Invite to Sign — Manual Link"}
          </DialogTitle>
          {tpl && (
            <p className="text-xs text-muted-foreground pt-1">
              {tpl.name}{tpl.agreement_type ? ` · ${tpl.agreement_type}` : ""}
            </p>
          )}
        </DialogHeader>
        <div className="space-y-3 text-sm">
          {!apiConnected && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-[11px] text-amber-700 dark:text-amber-300">
              <strong>Manual mode:</strong> SignNow API isn't connected, so the app cannot email this invite for you.
              We'll save the record and the signing link — you must send it to the client yourself (email, text, copy/paste).
            </div>
          )}
          <div>
            <Label className="text-xs">Select client</Label>
            <div className="relative">
              <Search className="h-3.5 w-3.5 absolute left-2 top-2.5 text-muted-foreground" />
              <Input className="pl-7" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search clients by name…" />
            </div>
            <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border bg-secondary/20">
              {clients.length === 0 ? (
                <p className="text-xs text-muted-foreground p-3 text-center">No clients found.</p>
              ) : clients.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setClientId(c.id)}
                  className={`w-full text-left px-3 py-2 text-xs hover:bg-accent transition border-b border-border/50 last:border-0 ${clientId === c.id ? "bg-accent" : ""}`}
                >
                  <div className="font-medium">{c.full_name}</div>
                  {c.email && <div className="text-muted-foreground">{c.email}</div>}
                </button>
              ))}
            </div>
            {selectedClient && (
              <p className="text-[11px] text-muted-foreground mt-1">
                Selected: <strong className="text-foreground">{selectedClient.full_name}</strong>
                {selectedClient.email ? ` (${selectedClient.email})` : ""}
              </p>
            )}
          </div>

          <div>
            <Label className="text-xs">Signing link override (optional)</Label>
            <Input value={linkOverride} onChange={(e) => setLinkOverride(e.target.value)} placeholder={tpl?.signnow_url ?? "https://app.signnow.com/..."} />
            {!isApiTemplate && !tpl?.signnow_url && !linkOverride && (
              <p className="text-[11px] text-amber-500 mt-1">This template has no SignNow URL saved. Paste one or edit the template.</p>
            )}
            {isApiTemplate && (
              <p className="text-[11px] text-muted-foreground mt-1">Optional. The SignNow API will generate and email the signing link using template ID <code>{tpl?.signnow_template_id}</code>.</p>
            )}
          </div>

          <div>
            <Label className="text-xs">Connect to offer / purchase (optional)</Label>
            <Input value={offerName} onChange={(e) => setOfferName(e.target.value)} placeholder="e.g. 6 Month Online Coaching" />
          </div>

          <div>
            <Label className="text-xs">Admin notes (optional)</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={go} disabled={busy || !clientId}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            {busy ? "Sending…" : "Create invite"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}