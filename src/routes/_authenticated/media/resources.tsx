import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { PageHeader } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";
import {
  Folder, FolderPlus, Upload, Search, Trash2, FileText, FileImage,
  FileVideo, FileAudio, FileArchive, File as FileIcon, MessageSquare,
  ExternalLink,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import {
  listFolders, listResources, createFolder, deleteFolder,
  createResource, updateResource, deleteResource,
  getSignedReadUrl, getUploadUrl,
  listComments, addComment, deleteComment,
} from "@/lib/media-resource-library.functions";

export const Route = createFileRoute("/_authenticated/media/resources")({
  component: ResourceLibrary,
});

type FolderRow = { id: string; parent_id: string | null; name: string; color: string | null; icon: string | null };
type Resource = {
  id: string; folder_id: string | null; name: string; description: string | null;
  tags: string[]; storage_path: string | null; external_url: string | null;
  mime_type: string | null; file_size: number | null; thumbnail_path: string | null;
  created_at: string;
};

function bytes(n: number | null) {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function FileTypeIcon({ mime, className = "h-5 w-5" }: { mime: string | null; className?: string }) {
  const m = (mime ?? "").toLowerCase();
  if (m.startsWith("image/")) return <FileImage className={className} />;
  if (m.startsWith("video/")) return <FileVideo className={className} />;
  if (m.startsWith("audio/")) return <FileAudio className={className} />;
  if (m.includes("zip") || m.includes("rar") || m.includes("7z") || m.includes("tar")) return <FileArchive className={className} />;
  if (m.includes("pdf") || m.startsWith("text/") || m.includes("word") || m.includes("excel") || m.includes("powerpoint") || m.includes("document")) return <FileText className={className} />;
  return <FileIcon className={className} />;
}

function ResourceLibrary() {
  const qc = useQueryClient();
  const foldersFn = useServerFn(listFolders);
  const resourcesFn = useServerFn(listResources);
  const createFolderFn = useServerFn(createFolder);
  const deleteFolderFn = useServerFn(deleteFolder);
  const createResourceFn = useServerFn(createResource);
  const deleteResourceFn = useServerFn(deleteResource);
  const getUploadFn = useServerFn(getUploadUrl);

  const [folderId, setFolderId] = useState<string | null | undefined>(undefined); // undefined=all, null=unfiled
  const [search, setSearch] = useState("");
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [openResource, setOpenResource] = useState<Resource | null>(null);

  const { data: foldersData } = useQuery({ queryKey: ["mrl-folders"], queryFn: () => foldersFn() });
  const folders: FolderRow[] = foldersData?.folders ?? [];

  const { data: resData, isLoading } = useQuery({
    queryKey: ["mrl-resources", folderId, search],
    queryFn: () => resourcesFn({ data: { folder_id: folderId === undefined ? undefined : folderId, search: search || undefined } }),
  });
  const resources: Resource[] = resData?.items ?? [];

  const folderTree = useMemo(() => {
    const byParent = new Map<string | null, FolderRow[]>();
    for (const f of folders) {
      const key = f.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(f);
    }
    return byParent;
  }, [folders]);

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    try {
      await createFolderFn({ data: { name: newFolderName.trim(), parent_id: typeof folderId === "string" ? folderId : null } });
      toast.success("Folder created");
      setNewFolderName(""); setNewFolderOpen(false);
      qc.invalidateQueries({ queryKey: ["mrl-folders"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function handleDeleteFolder(id: string) {
    if (!confirm("Delete this folder? Files inside will become unfiled.")) return;
    try {
      await deleteFolderFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["mrl-folders"] });
      qc.invalidateQueries({ queryKey: ["mrl-resources"] });
      if (folderId === id) setFolderId(undefined);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function handleUpload(file: File) {
    const tid = toast.loading(`Uploading ${file.name}…`);
    try {
      const { path, token } = await getUploadFn({ data: { filename: file.name, contentType: file.type || "application/octet-stream" } });
      const { error } = await supabase.storage.from("media-resource-library").uploadToSignedUrl(path, token, file);
      if (error) throw error;
      await createResourceFn({ data: {
        name: file.name,
        description: null,
        tags: [],
        folder_id: typeof folderId === "string" ? folderId : null,
        storage_path: path,
        external_url: null,
        mime_type: file.type || null,
        file_size: file.size,
        thumbnail_path: null,
      } });
      toast.dismiss(tid);
      toast.success(`Uploaded ${file.name}`);
      qc.invalidateQueries({ queryKey: ["mrl-resources"] });
    } catch (e: any) {
      toast.dismiss(tid);
      toast.error(e?.message ?? "Upload failed");
    }
  }

  async function handleDeleteResource(id: string) {
    if (!confirm("Delete this file?")) return;
    try {
      await deleteResourceFn({ data: { id } });
      qc.invalidateQueries({ queryKey: ["mrl-resources"] });
      setOpenResource(null);
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  function FolderNode({ f, depth }: { f: FolderRow; depth: number }) {
    const children = folderTree.get(f.id) ?? [];
    const active = folderId === f.id;
    return (
      <div>
        <div
          className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted ${active ? "bg-muted font-medium" : ""}`}
          style={{ paddingLeft: 8 + depth * 12 }}
        >
          <button className="flex flex-1 items-center gap-2 text-left" onClick={() => setFolderId(f.id)}>
            <Folder className="h-4 w-4 text-muted-foreground" />
            <span className="truncate">{f.name}</span>
          </button>
          <button
            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
            onClick={(e) => { e.stopPropagation(); handleDeleteFolder(f.id); }}
            title="Delete folder"
          ><Trash2 className="h-3.5 w-3.5" /></button>
        </div>
        {children.map((c) => <FolderNode key={c.id} f={c} depth={depth + 1} />)}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <PageHeader
        title="Resource Library"
        subtitle="Private files for the media manager team."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="mr-1 h-4 w-4" /> New Folder
            </Button>
            <label className="inline-flex">
              <input
                type="file" className="hidden"
                onChange={(e) => { const f = e.target.files?.[0]; if (f) { handleUpload(f); e.currentTarget.value = ""; } }}
              />
              <Button asChild size="sm"><span><Upload className="mr-1 h-4 w-4" /> Upload File</span></Button>
            </label>
          </div>
        }
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* Sidebar */}
        <Card className="p-2">
          <div className="space-y-0.5">
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${folderId === undefined ? "bg-muted font-medium" : ""}`}
              onClick={() => setFolderId(undefined)}
            >
              <Folder className="h-4 w-4 text-muted-foreground" /> All files
            </button>
            <button
              className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${folderId === null ? "bg-muted font-medium" : ""}`}
              onClick={() => setFolderId(null)}
            >
              <Folder className="h-4 w-4 text-muted-foreground" /> Unfiled
            </button>
          </div>
          <Separator className="my-2" />
          <ScrollArea className="h-[55vh] pr-1">
            {(folderTree.get(null) ?? []).map((f) => <FolderNode key={f.id} f={f} depth={0} />)}
            {folders.length === 0 && <div className="px-2 py-3 text-xs text-muted-foreground">No folders yet</div>}
          </ScrollArea>
        </Card>

        {/* Main */}
        <div className="space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="Search by name, description, or tag…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {isLoading ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[0,1,2,3,4,5].map((i) => <Skeleton key={i} className="h-44 w-full" />)}
            </div>
          ) : resources.length === 0 ? (
            <Card className="grid place-items-center gap-3 p-12 text-center text-sm text-muted-foreground">
              <Upload className="h-7 w-7" />
              <div>No files here yet. Upload one or pick a different folder.</div>
            </Card>
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {resources.map((r) => (
                <ResourceCard key={r.id} r={r} onOpen={() => setOpenResource(r)} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* New folder dialog */}
      <Dialog open={newFolderOpen} onOpenChange={setNewFolderOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>New folder</DialogTitle></DialogHeader>
          <div className="space-y-2">
            <Label>Name</Label>
            <Input
              autoFocus value={newFolderName} onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="e.g. Website assets"
              onKeyDown={(e) => { if (e.key === "Enter") handleCreateFolder(); }}
            />
            {typeof folderId === "string" && (
              <div className="text-xs text-muted-foreground">
                Will be created inside: {folders.find((f) => f.id === folderId)?.name}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewFolderOpen(false)}>Cancel</Button>
            <Button onClick={handleCreateFolder}>Create</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Detail dialog */}
      {openResource && (
        <ResourceDetailDialog
          resource={openResource}
          folders={folders}
          onClose={() => setOpenResource(null)}
          onDelete={() => handleDeleteResource(openResource.id)}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["mrl-resources"] });
          }}
        />
      )}
    </div>
  );
}

function ResourceCard({ r, onOpen }: { r: Resource; onOpen: () => void }) {
  const signFn = useServerFn(getSignedReadUrl);
  const isImage = (r.mime_type ?? "").startsWith("image/");
  const { data: signed } = useQuery({
    queryKey: ["mrl-thumb", r.id, r.storage_path, r.thumbnail_path],
    enabled: isImage && !!r.storage_path,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signFn({ data: { path: r.thumbnail_path || r.storage_path! } }),
  });
  return (
    <Card
      className="group cursor-pointer overflow-hidden transition hover:border-primary/50"
      onClick={onOpen}
    >
      <div className="grid h-32 place-items-center overflow-hidden bg-muted">
        {isImage && signed?.url
          ? <img src={signed.url} alt={r.name} className="h-full w-full object-cover" />
          : <FileTypeIcon mime={r.mime_type} className="h-10 w-10 text-muted-foreground" />}
      </div>
      <div className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <FileTypeIcon mime={r.mime_type} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1 truncate text-sm font-medium" title={r.name}>{r.name}</div>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>{bytes(r.file_size)}</span>
          <span>{new Date(r.created_at).toLocaleDateString()}</span>
        </div>
        {r.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {r.tags.slice(0, 4).map((t) => <Badge key={t} variant="secondary" className="text-[10px]">{t}</Badge>)}
            {r.tags.length > 4 && <span className="text-[10px] text-muted-foreground">+{r.tags.length - 4}</span>}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function ResourceDetailDialog({
  resource, folders, onClose, onDelete, onSaved,
}: {
  resource: Resource; folders: FolderRow[];
  onClose: () => void; onDelete: () => void; onSaved: () => void;
}) {
  const qc = useQueryClient();
  const signFn = useServerFn(getSignedReadUrl);
  const updateFn = useServerFn(updateResource);
  const listCommentsFn = useServerFn(listComments);
  const addCommentFn = useServerFn(addComment);
  const deleteCommentFn = useServerFn(deleteComment);

  const [name, setName] = useState(resource.name);
  const [description, setDescription] = useState(resource.description ?? "");
  const [tagInput, setTagInput] = useState(resource.tags.join(", "));
  const [folderId, setFolderId] = useState<string | null>(resource.folder_id);
  const [commentBody, setCommentBody] = useState("");

  const { data: signed } = useQuery({
    queryKey: ["mrl-preview", resource.id, resource.storage_path],
    enabled: !!resource.storage_path,
    queryFn: () => signFn({ data: { path: resource.storage_path! } }),
  });

  const { data: commentsData, refetch: refetchComments } = useQuery({
    queryKey: ["mrl-comments", resource.id],
    queryFn: () => listCommentsFn({ data: { resource_id: resource.id } }),
  });
  const comments = commentsData?.items ?? [];

  async function saveMeta() {
    try {
      await updateFn({ data: {
        id: resource.id,
        name: name.trim(),
        description: description || null,
        tags: tagInput.split(",").map((s) => s.trim()).filter(Boolean),
        folder_id: folderId,
      } });
      toast.success("Saved");
      onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Save failed"); }
  }

  async function postComment() {
    if (!commentBody.trim()) return;
    try {
      await addCommentFn({ data: { resource_id: resource.id, body: commentBody.trim() } });
      setCommentBody("");
      refetchComments();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  async function removeComment(id: string) {
    try {
      await deleteCommentFn({ data: { id } });
      refetchComments();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  const mime = (resource.mime_type ?? "").toLowerCase();
  const isImage = mime.startsWith("image/");
  const isVideo = mime.startsWith("video/");
  const isAudio = mime.startsWith("audio/");
  const isPDF = mime.includes("pdf");

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] max-w-5xl overflow-hidden p-0">
        <div className="grid h-[88vh] grid-cols-1 lg:grid-cols-[1.5fr_1fr]">
          {/* Preview */}
          <div className="flex h-full flex-col overflow-hidden border-b lg:border-b-0 lg:border-r">
            <div className="flex items-center gap-2 border-b p-3">
              <FileTypeIcon mime={resource.mime_type} />
              <div className="min-w-0 flex-1 truncate text-sm font-medium" title={resource.name}>{resource.name}</div>
              {signed?.url && (
                <a href={signed.url} target="_blank" rel="noreferrer" className="inline-flex">
                  <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3.5 w-3.5" />Open</Button>
                </a>
              )}
              <Button size="sm" variant="destructive" onClick={onDelete}><Trash2 className="h-3.5 w-3.5" /></Button>
            </div>
            <div className="flex-1 overflow-auto bg-muted/30">
              {!signed?.url ? (
                <div className="grid h-full place-items-center text-sm text-muted-foreground">Loading preview…</div>
              ) : isImage ? (
                <img src={signed.url} alt={resource.name} className="mx-auto max-h-full" />
              ) : isVideo ? (
                <video src={signed.url} controls className="h-full w-full bg-black" />
              ) : isAudio ? (
                <div className="grid h-full place-items-center p-6"><audio src={signed.url} controls className="w-full max-w-md" /></div>
              ) : isPDF ? (
                <iframe src={signed.url} className="h-full w-full" title={resource.name} />
              ) : (
                <div className="grid h-full place-items-center gap-3 p-6 text-center text-sm text-muted-foreground">
                  <FileTypeIcon mime={resource.mime_type} className="h-12 w-12" />
                  <div>No inline preview for this file type.</div>
                  <a href={signed.url} target="_blank" rel="noreferrer">
                    <Button size="sm" variant="outline"><ExternalLink className="mr-1 h-3.5 w-3.5" />Download</Button>
                  </a>
                </div>
              )}
            </div>
          </div>

          {/* Side panel */}
          <div className="flex h-full flex-col overflow-hidden">
            <DialogHeader className="border-b p-4">
              <DialogTitle>Details</DialogTitle>
            </DialogHeader>
            <ScrollArea className="flex-1">
              <div className="space-y-4 p-4">
                <div>
                  <Label>Name</Label>
                  <Input value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label>Description / notes</Label>
                  <Textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} />
                </div>
                <div>
                  <Label>Tags (comma-separated)</Label>
                  <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="branding, contract, pdf" />
                </div>
                <div>
                  <Label>Folder</Label>
                  <select
                    className="mt-1 flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                    value={folderId ?? ""}
                    onChange={(e) => setFolderId(e.target.value || null)}
                  >
                    <option value="">Unfiled</option>
                    {folders.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
                  </select>
                </div>
                <div className="text-xs text-muted-foreground">
                  {bytes(resource.file_size)} · {resource.mime_type ?? "unknown"} · added {new Date(resource.created_at).toLocaleString()}
                </div>
                <Button className="w-full" onClick={saveMeta}>Save details</Button>

                <Separator />

                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm font-medium">
                    <MessageSquare className="h-4 w-4" /> Comments ({comments.length})
                  </div>
                  <div className="space-y-3">
                    {comments.map((c: any) => (
                      <div key={c.id} className="group rounded-md border p-2.5">
                        <div className="flex items-center justify-between text-xs">
                          <span className="font-medium">{c.author_name}</span>
                          <button
                            className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive"
                            onClick={() => removeComment(c.id)}
                          ><Trash2 className="h-3 w-3" /></button>
                        </div>
                        <div className="mt-1 whitespace-pre-wrap text-sm">{c.body}</div>
                        <div className="mt-1 text-[10px] text-muted-foreground">{new Date(c.created_at).toLocaleString()}</div>
                      </div>
                    ))}
                    {comments.length === 0 && <div className="text-xs text-muted-foreground">No comments yet.</div>}
                  </div>
                  <Textarea
                    rows={3} value={commentBody} onChange={(e) => setCommentBody(e.target.value)}
                    placeholder="Add a comment…"
                  />
                  <Button size="sm" className="w-full" onClick={postComment} disabled={!commentBody.trim()}>
                    Post comment
                  </Button>
                </div>
              </div>
            </ScrollArea>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}