import { useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery } from "@tanstack/react-query";
import { adminCreateResource, adminUpdateResource, adminGetUploadUrl } from "@/lib/member-resources.functions";
import { listAccessLevels } from "@/lib/product-access.functions";
import { supabase } from "@/integrations/supabase/client";
import { runJob } from "@/lib/progress-jobs";
import { uploadFileToSignedUrlWithProgress, formatBytes } from "@/lib/upload-with-progress";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { toast } from "sonner";
import { Upload } from "lucide-react";

type Initial = Partial<{
  id: string; title: string; slug: string; description: string | null; kind: "resource"|"tool";
  format: string; url: string | null; storage_path: string | null; thumbnail_url: string | null;
  body_md: string | null; required_access_level: string; status: "Draft"|"Published"|"Archived";
  featured: boolean; sort_order: number;
}>;

export function MemberResourceForm({ initial }: { initial?: Initial }) {
  const navigate = useNavigate();
  const createFn = useServerFn(adminCreateResource);
  const updateFn = useServerFn(adminUpdateResource);
  const signUpload = useServerFn(adminGetUploadUrl);
  const fetchLevels = useServerFn(listAccessLevels);
  const { data: lvls } = useQuery({ queryKey: ["access-levels"], queryFn: () => fetchLevels() });
  const levels: any[] = lvls?.levels ?? [];

  const [form, setForm] = useState({
    title: initial?.title ?? "",
    slug: initial?.slug ?? "",
    description: initial?.description ?? "",
    kind: (initial?.kind ?? "resource") as "resource"|"tool",
    format: (initial?.format ?? "link") as string,
    url: initial?.url ?? "",
    storage_path: initial?.storage_path ?? "",
    thumbnail_url: initial?.thumbnail_url ?? "",
    body_md: initial?.body_md ?? "",
    required_access_level: initial?.required_access_level ?? "app_membership",
    status: (initial?.status ?? "Draft") as "Draft"|"Published"|"Archived",
    featured: initial?.featured ?? false,
    sort_order: initial?.sort_order ?? 0,
  });
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);

  const uploadFile = async (file: File) => {
    setUploading(true);
    try {
      await runJob(
        {
          title: "Uploading file",
          description: `${file.name} · ${formatBytes(file.size)}`,
          initialPercent: 0,
          successToast: "Uploaded",
        },
        async (job) => {
          job.setStatusText("Preparing upload");
          const { path, signedUrl, token } = await signUpload({ data: { filename: file.name, contentType: file.type || "application/octet-stream" } });
          job.setStatusText("Uploading");
          await uploadFileToSignedUrlWithProgress({
            bucket: "member-resources",
            path, signedUrl, token, file,
            contentType: file.type || "application/octet-stream",
            onProgress: ({ loaded, total, percent }) => {
              job.setPercent(percent);
              job.setStatusText(`${formatBytes(loaded)} of ${formatBytes(total)}`);
            },
          });
          setForm((f) => ({ ...f, storage_path: path, format: file.type.startsWith("video/") ? "video" : file.type.startsWith("image/") ? "image" : "pdf" }));
        },
      );
    } catch { /* runJob already surfaced toast + retry */ }
    finally { setUploading(false); }
  };

  const save = async () => {
    if (busy) return;
    if (!form.title.trim()) { toast.error("Title is required"); return; }
    setBusy(true);
    try {
      const payload: any = {
        title: form.title.trim(),
        slug: form.slug.trim() || undefined,
        description: form.description || null,
        kind: form.kind,
        format: form.format,
        url: form.url || null,
        storage_path: form.storage_path || null,
        thumbnail_url: form.thumbnail_url || null,
        body_md: form.body_md || null,
        required_access_level: form.required_access_level,
        status: form.status,
        featured: form.featured,
        sort_order: Number(form.sort_order) || 0,
      };
      if (initial?.id) {
        await updateFn({ data: { id: initial.id, ...payload } });
        toast.success("Saved");
      } else {
        await createFn({ data: payload });
        toast.success("Created");
      }
      navigate({ to: "/admin/member-resources" });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
    finally { setBusy(false); }
  };

  return (
    <Card className="space-y-4 p-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div>
          <Label>Title</Label>
          <Input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
        </div>
        <div>
          <Label>Slug (optional)</Label>
          <Input value={form.slug} onChange={(e) => setForm({ ...form, slug: e.target.value })} placeholder="auto-generated from title" />
        </div>
        <div>
          <Label>Type</Label>
          <Select value={form.kind} onValueChange={(v) => setForm({ ...form, kind: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="resource">Resource</SelectItem>
              <SelectItem value="tool">Tool</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Format</Label>
          <Select value={form.format} onValueChange={(v) => setForm({ ...form, format: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["pdf","video","link","article","calculator","embed","image"].map((f) =>
                <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Required access level</Label>
          <Select value={form.required_access_level} onValueChange={(v) => setForm({ ...form, required_access_level: v })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {levels.map((l: any) => <SelectItem key={l.key} value={l.key}>{l.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Status</Label>
          <Select value={form.status} onValueChange={(v) => setForm({ ...form, status: v as any })}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {["Draft","Published","Archived"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div>
        <Label>Short description</Label>
        <Input value={form.description ?? ""} onChange={(e) => setForm({ ...form, description: e.target.value })} maxLength={500} />
      </div>
      <div>
        <Label>External URL (link, video, embed)</Label>
        <Input value={form.url ?? ""} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
      </div>
      <div>
        <Label>File upload (PDF / video / image)</Label>
        <div className="flex items-center gap-3">
          <input type="file" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadFile(f); }}
            className="block w-full text-sm file:mr-3 file:rounded-md file:border file:bg-muted file:px-3 file:py-1.5 file:text-sm" />
          {uploading && <span className="text-xs text-muted-foreground"><Upload className="mr-1 inline h-3 w-3" />Uploading…</span>}
        </div>
        {form.storage_path && <div className="mt-1 truncate text-xs text-muted-foreground">Stored: {form.storage_path}</div>}
      </div>
      <div>
        <Label>Body (markdown)</Label>
        <Textarea rows={8} value={form.body_md ?? ""} onChange={(e) => setForm({ ...form, body_md: e.target.value })} />
      </div>
      <div className="flex items-center gap-3">
        <Switch checked={form.featured} onCheckedChange={(c) => setForm({ ...form, featured: c })} />
        <Label>Featured</Label>
        <div className="ml-auto w-32">
          <Label>Sort order</Label>
          <Input type="number" value={form.sort_order} onChange={(e) => setForm({ ...form, sort_order: Number(e.target.value) })} />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => navigate({ to: "/admin/member-resources" })}>Cancel</Button>
        <Button onClick={save} disabled={busy}>{initial?.id ? "Save changes" : "Create"}</Button>
      </div>
    </Card>
  );
}