import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Loader2, Plus, Copy, FileText, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { createTemplate, duplicateTemplate } from "@/lib/agreements.functions";
import { loadPdf } from "@/lib/pdf-render";

export const Route = createFileRoute("/_authenticated/admin/agreements/")({
  component: AgreementsListPage,
});

function AgreementsListPage() {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [name, setName] = useState("");
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const create = useServerFn(createTemplate);
  const dup = useServerFn(duplicateTemplate);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["agreement-templates"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreement_templates")
        .select("*").eq("archived", false).order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: instances = [] } = useQuery({
    queryKey: ["agreement-instances-admin"],
    queryFn: async () => {
      const { data, error } = await supabase.from("agreements")
        .select("id, template_name, status, sent_at, completed_at, client_id, clients(full_name)")
        .order("created_at", { ascending: false }).limit(50);
      if (error) throw error;
      return data as any[];
    },
  });

  async function handleUpload(file: File) {
    setPendingFile(file);
    setName(file.name.replace(/\.pdf$/i, ""));
  }

  async function confirmCreate() {
    if (!pendingFile || !name.trim()) return;
    setUploading(true);
    try {
      const bytes = await pendingFile.arrayBuffer();
      const doc = await loadPdf(bytes);
      const pageCount = doc.numPages;
      const path = `templates/${crypto.randomUUID()}/source.pdf`;
      const up = await supabase.storage.from("agreements").upload(path, pendingFile, {
        contentType: "application/pdf", upsert: false,
      });
      if (up.error) throw new Error(up.error.message);
      const tpl = await create({ data: { name: name.trim(), pdf_storage_path: path, page_count: pageCount } });
      qc.invalidateQueries({ queryKey: ["agreement-templates"] });
      setPendingFile(null);
      navigate({ to: "/admin/agreements/$id", params: { id: (tpl as any).id } });
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader title="Agreements" subtitle="Upload, build, send, and track signed agreements." />
      <div className="flex gap-2">
        <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
          onChange={(e) => e.target.files?.[0] && handleUpload(e.target.files[0])} />
        <Button onClick={() => fileInputRef.current?.click()}><Plus className="h-4 w-4 mr-1" /> Upload PDF template</Button>
      </div>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Templates</h2>
        {isLoading ? <p className="text-sm text-muted-foreground">Loading…</p> : templates.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No templates yet. Upload a PDF to get started.</Card>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {templates.map((t: any) => (
              <Card key={t.id} className="p-4 space-y-2">
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 mt-1 text-muted-foreground" />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium truncate">{t.name}</p>
                    <p className="text-xs text-muted-foreground">v{t.version} · {t.page_count} page{t.page_count === 1 ? "" : "s"}</p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Link to="/admin/agreements/$id" params={{ id: t.id }} className="flex-1">
                    <Button variant="outline" size="sm" className="w-full">Edit</Button>
                  </Link>
                  <Button variant="ghost" size="icon" onClick={async () => {
                    await dup({ data: { template_id: t.id } });
                    qc.invalidateQueries({ queryKey: ["agreement-templates"] });
                    toast.success("Duplicated");
                  }}><Copy className="h-4 w-4" /></Button>
                  <Button variant="ghost" size="icon" onClick={async () => {
                    if (!confirm("Archive this template?")) return;
                    await supabase.from("agreement_templates").update({ archived: true }).eq("id", t.id);
                    qc.invalidateQueries({ queryKey: ["agreement-templates"] });
                  }}><Trash2 className="h-4 w-4" /></Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <h2 className="text-sm font-semibold text-muted-foreground mb-2">Recent sent agreements</h2>
        {instances.length === 0 ? (
          <Card className="p-6 text-sm text-muted-foreground">No agreements sent yet.</Card>
        ) : (
          <Card className="divide-y">
            {instances.map((a: any) => (
              <Link key={a.id} to="/admin/agreements/instance/$id" params={{ id: a.id }} className="block p-3 hover:bg-muted">
                <div className="flex items-center justify-between text-sm">
                  <div>
                    <p className="font-medium">{a.template_name}</p>
                    <p className="text-xs text-muted-foreground">{a.clients?.full_name ?? "—"}</p>
                  </div>
                  <span className="text-xs text-muted-foreground">{a.status}</span>
                </div>
              </Link>
            ))}
          </Card>
        )}
      </section>

      <Dialog open={!!pendingFile} onOpenChange={(o) => !o && setPendingFile(null)}>
        <DialogContent>
          <DialogHeader><DialogTitle>Name this template</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Coaching Agreement + Liability Waiver" />
            <p className="text-xs text-muted-foreground">{pendingFile?.name}</p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingFile(null)}>Cancel</Button>
            <Button onClick={confirmCreate} disabled={uploading || !name.trim()}>
              {uploading && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Create & open builder
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}