import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { SettingsTabs } from "@/components/settings/settings-tabs";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { ShieldAlert, FileText, Eye, History, Plus } from "lucide-react";
import { toast } from "sonner";
import {
  listLegalDocuments, listVersions, listAcceptancesForVersion,
  upsertLegalDocument, saveDraftVersion, publishVersion, archiveVersion,
} from "@/lib/legal.functions";

export const Route = createFileRoute("/_authenticated/admin/legal")({
  component: LegalAdminPage,
});

const DOC_TYPES = [
  ["terms","Terms of Service"],
  ["privacy","Privacy Policy"],
  ["coaching_disclaimer","Coaching Disclaimer"],
  ["medical_disclaimer","Medical & Injury Disclaimer"],
  ["nutrition_disclaimer","Nutrition Disclaimer"],
  ["ai_disclosure","AI-Assisted Coaching Disclosure"],
  ["waiver","Waiver & Release"],
  ["par_q","PAR-Q / Readiness"],
  ["upload_consent","Upload Consent"],
  ["media_release","Media & Testimonial Release"],
  ["communication_consent","Communication Consent"],
  ["cancellation_policy","Cancellation Policy"],
  ["custom","Custom Legal Document"],
] as const;

function LegalAdminPage() {
  const docsFn = useServerFn(listLegalDocuments);
  const upsertFn = useServerFn(upsertLegalDocument);
  const qc = useQueryClient();
  const { data: docs = [] } = useQuery({ queryKey: ["legal-admin-docs"], queryFn: () => docsFn() });

  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const createDoc = async (form: any) => {
    try {
      const row = await upsertFn({ data: form });
      toast.success("Document created. Now add the first version.");
      qc.invalidateQueries({ queryKey: ["legal-admin-docs"] });
      setSelected((row as any).id);
      setCreating(false);
    } catch (e: any) { toast.error(e?.message ?? "Failed to create"); }
  };

  return (
    <>
      <SettingsTabs />
      <PageHeader
        title="Legal & Disclaimers"
        subtitle="Versioned legal documents, contextual disclaimers, and consent records."
      />
      <div className="grid gap-6 p-6 md:p-8 lg:grid-cols-[320px_1fr]">
        <Card className="border-border bg-card p-4 space-y-2 h-fit">
          <div className="flex items-center justify-between">
            <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Documents</h3>
            <Button size="sm" variant="outline" onClick={() => { setCreating(true); setSelected(null); }}>
              <Plus className="h-3.5 w-3.5 mr-1" /> New
            </Button>
          </div>
          <ul className="space-y-1">
            {docs.map((d: any) => {
              const v = d.current_version;
              const status = v?.status === "published" ? "Published" : v ? "Draft" : "No version";
              const needsReview = v?.needs_legal_review;
              return (
                <li key={d.id}>
                  <button
                    onClick={() => { setSelected(d.id); setCreating(false); }}
                    className={`w-full text-left rounded-md px-3 py-2 hover:bg-muted/40 ${selected === d.id ? "bg-muted/60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{d.title}</span>
                      <Badge variant="outline" className={
                        status === "Published" ? "border-emerald-500/40 text-emerald-600" :
                        status === "Draft" ? "border-amber-500/40 text-amber-600" :
                        ""
                      }>{status}</Badge>
                    </div>
                    <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground mt-1">
                      <span>{d.doc_type.replace(/_/g," ")}</span>
                      {needsReview && <span className="text-amber-600">· Needs legal review</span>}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>

        <div className="space-y-6">
          {creating && <CreateDocumentForm onCreate={createDoc} onCancel={() => setCreating(false)} />}
          {selected && <DocumentDetail documentId={selected} />}
          {!creating && !selected && (
            <Card className="border-dashed border-border bg-card/40 p-10 text-center text-sm text-muted-foreground">
              Select a document on the left, or create a new one.
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function CreateDocumentForm({ onCreate, onCancel }: { onCreate: (f: any) => void; onCancel: () => void }) {
  const [doc_type, setDocType] = useState<string>("custom");
  const [title, setTitle] = useState("");
  const [slug, setSlug] = useState("");
  const [is_required, setRequired] = useState(false);
  const [is_optional_consent, setOptional] = useState(false);

  return (
    <Card className="border-border bg-card p-6 space-y-4">
      <h3 className="text-base font-bold">New legal document</h3>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Type</Label>
          <Select value={doc_type} onValueChange={setDocType}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {DOC_TYPES.map(([v, l]) => <SelectItem key={v} value={v}>{l}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Title</Label>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label>Slug</Label>
          <Input value={slug} onChange={(e) => setSlug(e.target.value.toLowerCase().replace(/[^a-z0-9-]+/g, "-"))} placeholder="my-document-slug" />
        </div>
        <label className="flex items-center gap-2"><Switch checked={is_required} onCheckedChange={setRequired} /> Required acceptance</label>
        <label className="flex items-center gap-2"><Switch checked={is_optional_consent} onCheckedChange={setOptional} /> Optional consent</label>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onCancel}>Cancel</Button>
        <Button
          disabled={!title || !slug}
          onClick={() => onCreate({ doc_type, title, slug, is_required, is_optional_consent, audience: "all_clients" })}
        >
          Create document
        </Button>
      </div>
    </Card>
  );
}

function DocumentDetail({ documentId }: { documentId: string }) {
  const versionsFn = useServerFn(listVersions);
  const saveFn = useServerFn(saveDraftVersion);
  const publishFn = useServerFn(publishVersion);
  const archiveFn = useServerFn(archiveVersion);
  const qc = useQueryClient();

  const { data: versions = [] } = useQuery({
    queryKey: ["legal-versions", documentId],
    queryFn: () => versionsFn({ data: { documentId } }),
  });

  const draft = versions.find((v: any) => v.status === "draft");
  const published = versions.find((v: any) => v.status === "published");
  const editing = draft ?? null;

  // Confirmation dialog state. Replaces the native window.confirm() which can
  // block the renderer (especially inside iframed previews) and was reported
  // to hang the page for 45s+ on publish.
  const [confirmState, setConfirmState] = useState<
    | { kind: "publish"; versionId: string }
    | { kind: "archive"; versionId: string }
    | null
  >(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

  const [form, setForm] = useState<any>(null);
  const current = form ?? editing ?? {
    document_id: documentId,
    title: "",
    summary: "",
    body: "",
    signature_method: "checkbox",
    requires_reacceptance: true,
    reacceptance_audience: "all_clients",
    needs_legal_review: true,
    legal_review_note: "Requires professional legal review before publishing.",
  };
  const set = (k: string, v: any) => setForm({ ...(form ?? editing ?? current), [k]: v });

  const save = async () => {
    try {
      await saveFn({ data: {
        id: editing?.id,
        document_id: documentId,
        title: current.title,
        summary: current.summary,
        body: current.body,
        signature_method: current.signature_method,
        requires_reacceptance: !!current.requires_reacceptance,
        reacceptance_audience: current.reacceptance_audience ?? "all_clients",
        effective_date: current.effective_date ?? null,
        needs_legal_review: !!current.needs_legal_review,
        legal_review_note: current.legal_review_note ?? null,
      }});
      toast.success("Draft saved.");
      qc.invalidateQueries({ queryKey: ["legal-versions", documentId] });
      qc.invalidateQueries({ queryKey: ["legal-admin-docs"] });
      setForm(null);
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  };

  const publish = (versionId: string) => setConfirmState({ kind: "publish", versionId });
  const archive = (versionId: string) => setConfirmState({ kind: "archive", versionId });

  const runConfirm = async () => {
    if (!confirmState || confirmBusy) return;
    setConfirmBusy(true);
    try {
      if (confirmState.kind === "publish") {
        await publishFn({ data: { versionId: confirmState.versionId, confirmLegalReview: true } });
        toast.success("Published.");
      } else {
        await archiveFn({ data: { versionId: confirmState.versionId } });
        toast.success("Archived.");
      }
      qc.invalidateQueries({ queryKey: ["legal-versions", documentId] });
      qc.invalidateQueries({ queryKey: ["legal-admin-docs"] });
      setConfirmState(null);
    } catch (e: any) {
      toast.error(e?.message ?? (confirmState.kind === "publish" ? "Publish failed" : "Archive failed"));
    } finally {
      setConfirmBusy(false);
    }
  };

  return (
    <>
      <Card className="border-border bg-card p-6 space-y-4">
        <div className="flex items-center justify-between gap-2 flex-wrap">
          <h3 className="text-base font-bold flex items-center gap-2">
            <FileText className="h-4 w-4" /> {editing ? "Edit draft" : published ? "Create next version" : "First draft"}
          </h3>
          {current.needs_legal_review && (
            <Badge variant="outline" className="border-amber-500/40 text-amber-600 flex items-center gap-1">
              <ShieldAlert className="h-3 w-3" /> Requires professional legal review before publishing
            </Badge>
          )}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label>Title (shown to users)</Label>
            <Input value={current.title} onChange={(e) => set("title", e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label>Plain-language summary</Label>
            <Textarea rows={2} value={current.summary ?? ""} onChange={(e) => set("summary", e.target.value)} placeholder="Short non-legal summary shown above the full document." />
          </div>
          <div className="sm:col-span-2">
            <Label>Document body (Markdown supported)</Label>
            <Textarea rows={14} value={current.body ?? ""} onChange={(e) => set("body", e.target.value)} className="font-mono text-xs" />
          </div>
          <div>
            <Label>Acceptance method</Label>
            <Select value={current.signature_method} onValueChange={(v) => set("signature_method", v)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="checkbox">Checkbox acknowledgement</SelectItem>
                <SelectItem value="typed_name">Typed legal name</SelectItem>
                <SelectItem value="signature">Drawn signature</SelectItem>
                <SelectItem value="link_only">Link only (informational)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Effective date</Label>
            <Input type="date" value={current.effective_date ?? ""} onChange={(e) => set("effective_date", e.target.value)} />
          </div>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!current.requires_reacceptance} onCheckedChange={(v) => set("requires_reacceptance", v)} />
            Require re-acceptance from existing clients
          </label>
          <label className="flex items-center gap-2 text-sm">
            <Switch checked={!!current.needs_legal_review} onCheckedChange={(v) => set("needs_legal_review", v)} />
            Still needs professional legal review
          </label>
          <div className="sm:col-span-2">
            <Label>Internal legal review note</Label>
            <Textarea rows={2} value={current.legal_review_note ?? ""} onChange={(e) => set("legal_review_note", e.target.value)} />
          </div>
        </div>

        <div className="flex flex-wrap gap-2 justify-end pt-2 border-t border-border/50">
          <Sheet>
            <SheetTrigger asChild>
              <Button variant="outline"><Eye className="mr-2 h-4 w-4" />Preview</Button>
            </SheetTrigger>
            <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
              <SheetHeader><SheetTitle>{current.title}</SheetTitle></SheetHeader>
              <div className="mt-4 space-y-3">
                {current.summary && <p className="text-sm text-muted-foreground">{current.summary}</p>}
                <div className="rounded-md border border-border bg-muted/20 p-4 text-sm whitespace-pre-wrap">{current.body}</div>
              </div>
            </SheetContent>
          </Sheet>
          <Button onClick={save}>Save draft</Button>
          {editing && !editing.needs_legal_review && (
            <Button onClick={() => publish(editing.id)} className="bg-emerald-600 hover:bg-emerald-700">Publish</Button>
          )}
          {editing && editing.needs_legal_review && (
            <Button disabled title="Turn off 'Still needs professional legal review' once it has been reviewed.">Publish</Button>
          )}
        </div>
      </Card>

      <Card className="border-border bg-card p-6 space-y-3">
        <h3 className="text-base font-bold flex items-center gap-2"><History className="h-4 w-4" /> Version history</h3>
        <ul className="divide-y divide-border">
          {versions.map((v: any) => (
            <li key={v.id} className="flex items-center justify-between gap-2 py-2">
              <div className="min-w-0">
                <div className="text-sm font-medium flex items-center gap-2">
                  v{v.version_number} — {v.title}
                  <Badge variant="outline" className={
                    v.status === "published" ? "border-emerald-500/40 text-emerald-600" :
                    v.status === "draft" ? "border-amber-500/40 text-amber-600" :
                    "text-muted-foreground"
                  }>{v.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {v.published_at ? `Published ${new Date(v.published_at).toLocaleString()}` : `Created ${new Date(v.created_at).toLocaleString()}`}
                </div>
              </div>
              <div className="flex gap-2">
                <AcceptancesSheet versionId={v.id} versionLabel={`v${v.version_number}`} />
                {v.status === "published" && (
                  <Button size="sm" variant="outline" onClick={() => archive(v.id)}>Archive</Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </Card>
    </>
  );
}

function AcceptancesSheet({ versionId, versionLabel }: { versionId: string; versionLabel: string }) {
  const fn = useServerFn(listAcceptancesForVersion);
  const { data = [], refetch } = useQuery({
    queryKey: ["legal-acceptances-for-version", versionId],
    queryFn: () => fn({ data: { versionId } }),
    enabled: false,
  });
  return (
    <Sheet onOpenChange={(o) => o && refetch()}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">View acceptances</Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-2xl overflow-y-auto">
        <SheetHeader><SheetTitle>{versionLabel} — Acceptance records</SheetTitle></SheetHeader>
        <div className="mt-4 space-y-2">
          {data.length === 0 && <p className="text-sm text-muted-foreground">No acceptances yet for this version.</p>}
          {data.map((a: any) => (
            <div key={a.id} className="rounded-md border border-border bg-muted/20 p-3 text-xs">
              <div className="flex items-center justify-between gap-2">
                <div className="font-medium">{a.client?.full_name ?? a.user_id}</div>
                <div className="text-muted-foreground">{new Date(a.accepted_at).toLocaleString()}</div>
              </div>
              <div className="text-muted-foreground mt-1">
                {a.context} · {a.signature_method}{a.typed_name ? ` · "${a.typed_name}"` : ""}
              </div>
              {(a.ip_address || a.user_agent) && (
                <div className="text-muted-foreground/70 mt-1 truncate">
                  {a.ip_address ?? ""} {a.user_agent ? `· ${a.user_agent}` : ""}
                </div>
              )}
              {a.revoked_at && <Badge variant="outline" className="mt-1 border-destructive/40 text-destructive">Revoked</Badge>}
            </div>
          ))}
        </div>
      </SheetContent>
    </Sheet>
  );
}