import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState, useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import {
  Folder, FolderPlus, Upload, Search, Trash2, Star, Archive, ArchiveRestore,
  MoreHorizontal, Grid3x3, List as ListIcon, Link as LinkIcon, ExternalLink,
  Copy, Download, X, FileText, FileImage, FileVideo, FileAudio, FileArchive,
  File as FileIcon, ChevronRight, Edit2, Move, Tag, Layers, Plus, Filter, Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Label } from "@/components/ui/label";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogTitle,
  AlertDialogDescription, AlertDialogFooter, AlertDialogAction, AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuLabel,
} from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { MediaHeader } from "@/components/media/media-header";
import { detectProvider, PROVIDER_META, safeUrl, type AssetProvider } from "@/lib/asset-providers";
import {
  listFolders, listResources, createFolder, updateFolder, deleteFolder,
  createResource, updateResource, deleteResource, getSignedReadUrl, getUploadUrl,
  toggleFavourite, setArchived, moveResources, addTagsBulk, linkResources,
  deleteResourcesBulk, archiveFolder, deleteFolderSafe,
} from "@/lib/media-resource-library.functions";

export const Route = createFileRoute("/_authenticated/media/assets")({
  component: AssetLibrary,
});

const BUCKET = "media-resource-library";
const VIEW_KEY = "media.assets.view";
type View = "grid" | "list";

type FolderRow = {
  id: string; parent_id: string | null; name: string;
  color: string | null; icon: string | null;
  is_archived: boolean | null; sort_order: number | null;
};

type Resource = {
  id: string; folder_id: string | null; name: string; description: string | null;
  tags: string[]; storage_path: string | null; external_url: string | null;
  mime_type: string | null; file_size: number | null; thumbnail_path: string | null;
  created_by: string | null; created_at: string; updated_at: string;
  is_favourite: boolean | null; is_archived: boolean | null; archived_at: string | null;
  provider: string | null; campaign_id: string | null; content_id: string | null;
  visibility: string | null;
};

type SmartFolder =
  | { kind: "all" } | { kind: "unfiled" } | { kind: "favourites" }
  | { kind: "links" } | { kind: "recent" } | { kind: "archived" }
  | { kind: "folder"; id: string };

type SortKey = "newest" | "oldest" | "name_az" | "name_za" | "largest" | "smallest" | "updated";
type TypeFilter = "any" | "internal" | "link" | "image" | "video" | "audio" | "document";

function bytes(n: number | null) {
  if (!n) return "—";
  const u = ["B", "KB", "MB", "GB", "TB"]; let i = 0; let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${u[i]}`;
}

function fileKind(r: Resource): "image" | "video" | "audio" | "document" | "link" | "other" {
  if (r.external_url) return "link";
  const m = (r.mime_type ?? "").toLowerCase();
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("audio/")) return "audio";
  if (m.includes("pdf") || m.startsWith("text/") || m.includes("word") || m.includes("excel") || m.includes("powerpoint") || m.includes("document") || m.includes("sheet") || m.includes("presentation")) return "document";
  return "other";
}

function FileTypeIcon({ r, className = "h-5 w-5" }: { r: Resource; className?: string }) {
  if (r.external_url) {
    const p = (r.provider as AssetProvider) || detectProvider(r.external_url);
    return <span className={className} aria-hidden>{PROVIDER_META[p]?.emoji ?? "🔗"}</span>;
  }
  const k = fileKind(r);
  if (k === "image") return <FileImage className={className} />;
  if (k === "video") return <FileVideo className={className} />;
  if (k === "audio") return <FileAudio className={className} />;
  if (k === "document") return <FileText className={className} />;
  const m = (r.mime_type ?? "").toLowerCase();
  if (m.includes("zip") || m.includes("rar") || m.includes("tar") || m.includes("7z")) return <FileArchive className={className} />;
  return <FileIcon className={className} />;
}

function AssetLibrary() {
  const qc = useQueryClient();
  const foldersFn = useServerFn(listFolders);
  const resourcesFn = useServerFn(listResources);

  const [smart, setSmart] = useState<SmartFolder>({ kind: "all" });
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("any");
  const [sort, setSort] = useState<SortKey>("newest");
  const [view, setView] = useState<View>(() => {
    if (typeof window === "undefined") return "grid";
    return (localStorage.getItem(VIEW_KEY) as View) || "grid";
  });
  useEffect(() => { try { localStorage.setItem(VIEW_KEY, view); } catch {} }, [view]);

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [linkModalOpen, setLinkModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  const [folderDeleteState, setFolderDeleteState] = useState<{ folder: FolderRow } | null>(null);
  const [bulkMoveOpen, setBulkMoveOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [uploads, setUploads] = useState<UploadJob[]>([]);
  const [dragHover, setDragHover] = useState(false);

  const { data: foldersData } = useQuery({
    queryKey: ["asset-folders"],
    queryFn: () => foldersFn(),
  });
  const folders: FolderRow[] = (foldersData?.folders ?? []) as any;

  const { data: resData, isLoading } = useQuery({
    queryKey: ["asset-resources", smart, search],
    queryFn: () => resourcesFn({ data: { search: search || undefined } }),
  });
  const allResources: Resource[] = (resData?.items ?? []) as any;

  const folderTree = useMemo(() => {
    const byParent = new Map<string | null, FolderRow[]>();
    for (const f of folders) {
      if (f.is_archived && smart.kind !== "archived") continue;
      const key = f.parent_id ?? null;
      if (!byParent.has(key)) byParent.set(key, []);
      byParent.get(key)!.push(f);
    }
    return byParent;
  }, [folders, smart.kind]);

  const filtered = useMemo(() => {
    let rows = allResources;
    // Smart folder
    if (smart.kind === "all") rows = rows.filter((r) => !r.is_archived);
    else if (smart.kind === "unfiled") rows = rows.filter((r) => !r.is_archived && !r.folder_id);
    else if (smart.kind === "favourites") rows = rows.filter((r) => !r.is_archived && r.is_favourite);
    else if (smart.kind === "links") rows = rows.filter((r) => !r.is_archived && !!r.external_url);
    else if (smart.kind === "recent") {
      const cutoff = Date.now() - 14 * 86400 * 1000;
      rows = rows.filter((r) => !r.is_archived && new Date(r.created_at).getTime() >= cutoff);
    }
    else if (smart.kind === "archived") rows = rows.filter((r) => r.is_archived);
    else if (smart.kind === "folder") rows = rows.filter((r) => !r.is_archived && r.folder_id === smart.id);

    // Type filter
    if (typeFilter !== "any") {
      rows = rows.filter((r) => {
        if (typeFilter === "internal") return !r.external_url;
        if (typeFilter === "link") return !!r.external_url;
        return fileKind(r) === typeFilter;
      });
    }

    // Sort
    const out = [...rows];
    out.sort((a, b) => {
      if (sort === "newest") return b.created_at.localeCompare(a.created_at);
      if (sort === "oldest") return a.created_at.localeCompare(b.created_at);
      if (sort === "name_az") return a.name.localeCompare(b.name);
      if (sort === "name_za") return b.name.localeCompare(a.name);
      if (sort === "largest") return (b.file_size ?? 0) - (a.file_size ?? 0);
      if (sort === "smallest") return (a.file_size ?? 0) - (b.file_size ?? 0);
      if (sort === "updated") return (b.updated_at ?? b.created_at).localeCompare(a.updated_at ?? a.created_at);
      return 0;
    });
    return out;
  }, [allResources, smart, typeFilter, sort]);

  // Selection helpers
  const toggleSel = useCallback((id: string) => {
    setSelected((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  }, []);
  const selectAllVisible = () => setSelected(new Set(filtered.map((r) => r.id)));
  const clearSelection = () => setSelected(new Set());

  // Folder operations
  const createFolderFn = useServerFn(createFolder);
  const updateFolderFn = useServerFn(updateFolder);
  const archiveFolderFn = useServerFn(archiveFolder);
  const deleteFolderSafeFn = useServerFn(deleteFolderSafe);

  async function handleCreateFolder(name: string, parentId: string | null) {
    if (!name.trim()) return;
    try {
      await createFolderFn({ data: { name: name.trim(), parent_id: parentId } });
      toast.success("Folder created");
      qc.invalidateQueries({ queryKey: ["asset-folders"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function handleRenameFolder(f: FolderRow) {
    const name = window.prompt("Rename folder", f.name);
    if (!name || !name.trim() || name === f.name) return;
    try {
      await updateFolderFn({ data: { id: f.id, name: name.trim() } });
      qc.invalidateQueries({ queryKey: ["asset-folders"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  // Bulk ops
  const favFn = useServerFn(toggleFavourite);
  const archFn = useServerFn(setArchived);
  const moveFn = useServerFn(moveResources);
  const tagsFn = useServerFn(addTagsBulk);
  const linkFn = useServerFn(linkResources);
  const bulkDelFn = useServerFn(deleteResourcesBulk);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["asset-resources"] });
    qc.invalidateQueries({ queryKey: ["asset-folders"] });
  }

  async function doFav(ids: string[], value: boolean) {
    try { await favFn({ data: { ids, value } }); refresh(); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function doArchive(ids: string[], value: boolean) {
    try { await archFn({ data: { ids, value } }); refresh(); clearSelection();
      toast.success(value ? "Archived" : "Restored");
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function doMove(ids: string[], folder_id: string | null) {
    try { await moveFn({ data: { ids, folder_id } }); refresh(); clearSelection(); toast.success("Moved"); }
    catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }
  async function doDelete(ids: string[]) {
    try { await bulkDelFn({ data: { ids } }); refresh(); clearSelection(); setConfirmDelete(null);
      toast.success(`Deleted ${ids.length} item${ids.length === 1 ? "" : "s"}`);
    } catch (e: any) { toast.error(e?.message ?? "Delete failed"); }
  }

  // ===== Uploads =====
  const getUploadFn = useServerFn(getUploadUrl);
  const createResourceFn = useServerFn(createResource);

  const startUpload = useCallback(async (file: File, folder_id: string | null) => {
    const id = crypto.randomUUID();
    setUploads((u) => [...u, { id, name: file.name, size: file.size, progress: 0, status: "uploading" }]);
    try {
      const { path, signedUrl } = await getUploadFn({
        data: { filename: file.name, contentType: file.type || "application/octet-stream" },
      });
      // Upload with XHR for progress
      await xhrUpload(signedUrl, file, (p) => {
        setUploads((u) => u.map((j) => (j.id === id ? { ...j, progress: p } : j)));
      });
      await createResourceFn({ data: {
        name: file.name, tags: [], folder_id,
        storage_path: path, external_url: null,
        mime_type: file.type || null, file_size: file.size, thumbnail_path: null,
      } });
      setUploads((u) => u.map((j) => (j.id === id ? { ...j, status: "complete", progress: 100 } : j)));
      qc.invalidateQueries({ queryKey: ["asset-resources"] });
    } catch (e: any) {
      setUploads((u) => u.map((j) => (j.id === id ? { ...j, status: "failed", error: e?.message ?? "Upload failed" } : j)));
    }
  }, [createResourceFn, getUploadFn, qc]);

  function handleFiles(files: FileList | File[]) {
    const list = Array.from(files);
    const folder_id = smart.kind === "folder" ? smart.id : null;
    list.forEach((f) => startUpload(f, folder_id));
  }

  // Drag handlers (drop files anywhere over main)
  function onMainDragOver(e: React.DragEvent) {
    if (Array.from(e.dataTransfer.types).includes("Files")) {
      e.preventDefault(); setDragHover(true);
    }
  }
  function onMainDrop(e: React.DragEvent) {
    if (e.dataTransfer.files?.length) {
      e.preventDefault(); setDragHover(false); handleFiles(e.dataTransfer.files);
    }
  }

  const open = filtered.find((r) => r.id === openId) ?? null;
  const selectedCount = selected.size;
  const selectedIds = useMemo(() => Array.from(selected), [selected]);

  return (
    <div className="space-y-4">
      <MediaHeader
        title="Asset Library"
        description="Internal files and external shared links — all in one place."
      />

      <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
        {/* LEFT — folder panel */}
        <Card className="p-2">
          <div className="space-y-0.5">
            <SmartItem icon={<Layers className="h-4 w-4" />} label="All Files" active={smart.kind === "all"} onClick={() => setSmart({ kind: "all" })} />
            <SmartItem icon={<Folder className="h-4 w-4" />} label="Unfiled" active={smart.kind === "unfiled"} onClick={() => setSmart({ kind: "unfiled" })} />
            <SmartItem icon={<Star className="h-4 w-4" />} label="Favourites" active={smart.kind === "favourites"} onClick={() => setSmart({ kind: "favourites" })} />
            <SmartItem icon={<LinkIcon className="h-4 w-4" />} label="Shared Links" active={smart.kind === "links"} onClick={() => setSmart({ kind: "links" })} />
            <SmartItem icon={<Plus className="h-4 w-4" />} label="Recently Added" active={smart.kind === "recent"} onClick={() => setSmart({ kind: "recent" })} />
            <SmartItem icon={<Archive className="h-4 w-4" />} label="Archived" active={smart.kind === "archived"} onClick={() => setSmart({ kind: "archived" })} />
          </div>
          <Separator className="my-2" />
          <div className="mb-1 flex items-center justify-between px-2 text-[11px] uppercase tracking-wide text-muted-foreground">
            <span>Folders</span>
            <button
              className="rounded p-1 hover:bg-muted"
              title="New folder"
              onClick={() => setNewFolderOpen(true)}
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="max-h-[55vh] overflow-auto pr-1">
            {(folderTree.get(null) ?? []).map((f) => (
              <FolderNode
                key={f.id} f={f} depth={0} tree={folderTree}
                activeId={smart.kind === "folder" ? smart.id : null}
                onSelect={(id) => setSmart({ kind: "folder", id })}
                onRename={handleRenameFolder}
                onArchive={async (id, value) => {
                  try { await archiveFolderFn({ data: { id, value, archiveContents: false } }); refresh(); }
                  catch (e: any) { toast.error(e?.message ?? "Failed"); }
                }}
                onDelete={(folder) => setFolderDeleteState({ folder })}
                onDropFiles={(folderId, ids) => doMove(ids, folderId)}
              />
            ))}
            {folders.length === 0 && (
              <div className="px-2 py-3 text-xs text-muted-foreground">No folders yet. Create one to start organising.</div>
            )}
          </div>
        </Card>

        {/* MAIN */}
        <div
          className="relative space-y-3"
          onDragOver={onMainDragOver}
          onDragLeave={() => setDragHover(false)}
          onDrop={onMainDrop}
        >
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[220px] flex-1">
              <Search className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                className="pl-9"
                placeholder="Search name, description, tag…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>

            <Select value={typeFilter} onValueChange={(v) => setTypeFilter(v as TypeFilter)}>
              <SelectTrigger className="w-[150px]"><Filter className="mr-1 h-3.5 w-3.5" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="any">All types</SelectItem>
                <SelectItem value="internal">Internal Files</SelectItem>
                <SelectItem value="link">Shared Links</SelectItem>
                <SelectItem value="image">Images</SelectItem>
                <SelectItem value="video">Videos</SelectItem>
                <SelectItem value="audio">Audio</SelectItem>
                <SelectItem value="document">Documents</SelectItem>
              </SelectContent>
            </Select>

            <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
              <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="newest">Newest</SelectItem>
                <SelectItem value="oldest">Oldest</SelectItem>
                <SelectItem value="name_az">Name A–Z</SelectItem>
                <SelectItem value="name_za">Name Z–A</SelectItem>
                <SelectItem value="largest">Largest</SelectItem>
                <SelectItem value="smallest">Smallest</SelectItem>
                <SelectItem value="updated">Recently Updated</SelectItem>
              </SelectContent>
            </Select>

            <div className="flex rounded-md border bg-muted/30">
              <Button variant={view === "grid" ? "secondary" : "ghost"} size="sm" className="rounded-r-none" onClick={() => setView("grid")} title="Grid">
                <Grid3x3 className="h-4 w-4" />
              </Button>
              <Button variant={view === "list" ? "secondary" : "ghost"} size="sm" className="rounded-l-none" onClick={() => setView("list")} title="List">
                <ListIcon className="h-4 w-4" />
              </Button>
            </div>

            <Button variant="outline" size="sm" onClick={selectAllVisible}>
              <Check className="mr-1 h-3.5 w-3.5" />Select all
            </Button>
            <Button variant="outline" size="sm" onClick={() => setNewFolderOpen(true)}>
              <FolderPlus className="mr-1 h-4 w-4" />New Folder
            </Button>
            <Button variant="outline" size="sm" onClick={() => setLinkModalOpen(true)}>
              <LinkIcon className="mr-1 h-4 w-4" />Add Shared Link
            </Button>
            <UploadButton onFiles={handleFiles} />
          </div>

          {/* Drop overlay */}
          {dragHover && (
            <div className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center rounded-lg border-2 border-dashed border-primary bg-primary/5 backdrop-blur-sm">
              <div className="rounded-md bg-background px-4 py-2 text-sm font-medium shadow">Drop files here to upload</div>
            </div>
          )}

          {/* Upload queue */}
          {uploads.length > 0 && <UploadQueue jobs={uploads} onClear={(id) => setUploads((u) => u.filter((j) => j.id !== id))} onRetry={(j) => { /* drop and let user re-add */ setUploads((u) => u.filter((x) => x.id !== j.id)); toast.message("Re-upload the file to retry"); }} />}

          {/* Sticky bulk toolbar */}
          {selectedCount > 0 && (
            <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-md border bg-background/95 p-2 shadow-sm backdrop-blur">
              <span className="text-sm font-medium">{selectedCount} item{selectedCount === 1 ? "" : "s"} selected</span>
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Button size="sm" variant="outline" onClick={() => setBulkMoveOpen(true)}><Move className="mr-1 h-3.5 w-3.5" />Move</Button>
                <Button size="sm" variant="outline" onClick={() => setBulkTagOpen(true)}><Tag className="mr-1 h-3.5 w-3.5" />Tags</Button>
                <Button size="sm" variant="outline" onClick={() => doFav(selectedIds, true)}><Star className="mr-1 h-3.5 w-3.5" />Favourite</Button>
                <Button size="sm" variant="outline" onClick={() => doArchive(selectedIds, true)}><Archive className="mr-1 h-3.5 w-3.5" />Archive</Button>
                <Button size="sm" variant="destructive" onClick={() => setConfirmDelete({ ids: selectedIds })}><Trash2 className="mr-1 h-3.5 w-3.5" />Delete</Button>
                <Button size="sm" variant="ghost" onClick={clearSelection}><X className="h-3.5 w-3.5" /></Button>
              </div>
            </div>
          )}

          {/* Results */}
          <div className="text-xs text-muted-foreground">
            {isLoading ? "Loading…" : `${filtered.length} item${filtered.length === 1 ? "" : "s"}`}
          </div>

          {isLoading ? (
            <div className={view === "grid" ? "grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" : "space-y-2"}>
              {[0,1,2,3,4,5,6,7].map((i) => <Skeleton key={i} className={view === "grid" ? "h-48 w-full" : "h-14 w-full"} />)}
            </div>
          ) : filtered.length === 0 ? (
            <Card className="grid place-items-center gap-3 p-12 text-center text-sm text-muted-foreground">
              <Upload className="h-7 w-7" />
              <div>No items here yet. Upload a file, add a shared link, or drop files anywhere on this panel.</div>
            </Card>
          ) : view === "grid" ? (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {filtered.map((r) => (
                <AssetGridCard
                  key={r.id} r={r}
                  selected={selected.has(r.id)}
                  onToggleSelect={() => toggleSel(r.id)}
                  onOpen={() => setOpenId(r.id)}
                  onFav={() => doFav([r.id], !r.is_favourite)}
                  onArchive={() => doArchive([r.id], !r.is_archived)}
                  onDelete={() => setConfirmDelete({ ids: [r.id] })}
                  selectedIds={selectedIds}
                />
              ))}
            </div>
          ) : (
            <div className="overflow-hidden rounded-md border">
              <div className="grid grid-cols-[28px_1fr_90px_140px_90px_140px_120px_120px_44px] items-center gap-2 border-b bg-muted/40 px-3 py-2 text-xs font-medium text-muted-foreground">
                <span></span><span>Name</span><span>Type</span><span>Folder</span><span>Size</span><span>Uploaded by</span><span>Uploaded</span><span>Updated</span><span></span>
              </div>
              {filtered.map((r) => (
                <AssetListRow
                  key={r.id} r={r}
                  folders={folders}
                  selected={selected.has(r.id)}
                  onToggleSelect={() => toggleSel(r.id)}
                  onOpen={() => setOpenId(r.id)}
                  onFav={() => doFav([r.id], !r.is_favourite)}
                  onArchive={() => doArchive([r.id], !r.is_archived)}
                  onDelete={() => setConfirmDelete({ ids: [r.id] })}
                  selectedIds={selectedIds}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Detail drawer */}
      <Sheet open={!!open} onOpenChange={(o) => { if (!o) setOpenId(null); }}>
        <SheetContent side="right" className="w-full sm:max-w-xl overflow-y-auto">
          {open && <DetailDrawer key={open.id} r={open} folders={folders} onClose={() => setOpenId(null)} refresh={refresh} />}
        </SheetContent>
      </Sheet>

      {/* New folder */}
      <NewFolderDialog
        open={newFolderOpen} onOpenChange={setNewFolderOpen}
        folders={folders}
        defaultParent={smart.kind === "folder" ? smart.id : null}
        onCreate={handleCreateFolder}
      />

      {/* Add shared link */}
      <AddSharedLinkDialog
        open={linkModalOpen} onOpenChange={setLinkModalOpen}
        folders={folders}
        defaultFolderId={smart.kind === "folder" ? smart.id : null}
        onSaved={refresh}
      />

      {/* Bulk move */}
      <BulkMoveDialog
        open={bulkMoveOpen} onOpenChange={setBulkMoveOpen} folders={folders}
        onMove={(folderId) => { doMove(selectedIds, folderId); setBulkMoveOpen(false); }}
      />

      {/* Bulk tag */}
      <BulkTagDialog
        open={bulkTagOpen} onOpenChange={setBulkTagOpen}
        onApply={async (tags) => {
          try { await tagsFn({ data: { ids: selectedIds, tags } }); refresh(); setBulkTagOpen(false); clearSelection(); toast.success("Tags added"); }
          catch (e: any) { toast.error(e?.message ?? "Failed"); }
        }}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => { if (!o) setConfirmDelete(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {confirmDelete?.ids.length} selected item{confirmDelete?.ids.length === 1 ? "" : "s"}?</AlertDialogTitle>
            <AlertDialogDescription>
              <span className="block">• Internal files will be permanently removed from storage.</span>
              <span className="block">• Shared-link records will be removed, but the external file remains where it lives.</span>
              <span className="mt-2 block font-medium text-destructive">Permanent deletion cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <Button
              variant="default"
              onClick={() => { if (confirmDelete) { doArchive(confirmDelete.ids, true); setConfirmDelete(null); } }}
            >
              <Archive className="mr-1 h-4 w-4" />Move to Archive
            </Button>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => confirmDelete && doDelete(confirmDelete.ids)}
            >
              Delete Permanently
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Folder delete (safe) */}
      <FolderDeleteDialog
        state={folderDeleteState}
        folders={folders}
        onClose={() => setFolderDeleteState(null)}
        onResolved={() => {
          setFolderDeleteState(null);
          refresh();
          if (smart.kind === "folder" && folderDeleteState && smart.id === folderDeleteState.folder.id) {
            setSmart({ kind: "all" });
          }
        }}
        deleteFolderSafeFn={deleteFolderSafeFn}
      />
    </div>
  );
}

/* =========================================================================
 *  Sidebar pieces
 * ========================================================================= */

function SmartItem({ icon, label, active, onClick }: { icon: React.ReactNode; label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${active ? "bg-muted font-medium" : ""}`}
      onClick={onClick}
    >
      <span className="text-muted-foreground">{icon}</span>{label}
    </button>
  );
}

function FolderNode({
  f, depth, tree, activeId, onSelect, onRename, onArchive, onDelete, onDropFiles,
}: {
  f: FolderRow; depth: number;
  tree: Map<string | null, FolderRow[]>;
  activeId: string | null;
  onSelect: (id: string) => void;
  onRename: (f: FolderRow) => void;
  onArchive: (id: string, value: boolean) => void;
  onDelete: (f: FolderRow) => void;
  onDropFiles: (folderId: string, resourceIds: string[]) => void;
}) {
  const children = tree.get(f.id) ?? [];
  const active = activeId === f.id;
  const [over, setOver] = useState(false);
  return (
    <div>
      <div
        className={`group flex items-center gap-1 rounded-md px-2 py-1 text-sm hover:bg-muted ${active ? "bg-muted font-medium" : ""} ${over ? "ring-1 ring-primary" : ""}`}
        style={{ paddingLeft: 8 + depth * 12 }}
        onDragOver={(e) => { if (e.dataTransfer.types.includes("application/x-asset-ids")) { e.preventDefault(); setOver(true); } }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          const raw = e.dataTransfer.getData("application/x-asset-ids");
          setOver(false);
          if (raw) { e.preventDefault(); try { onDropFiles(f.id, JSON.parse(raw)); } catch {} }
        }}
      >
        <button className="flex flex-1 items-center gap-2 text-left" onClick={() => onSelect(f.id)}>
          {children.length > 0 ? <ChevronRight className="h-3 w-3 text-muted-foreground" /> : <span className="w-3" />}
          <Folder className="h-4 w-4 text-muted-foreground" />
          <span className="truncate">{f.name}</span>
          {f.is_archived && <Badge variant="outline" className="ml-1 h-4 text-[9px]">archived</Badge>}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground" onClick={(e) => e.stopPropagation()}>
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onRename(f)}><Edit2 className="mr-2 h-3.5 w-3.5" />Rename</DropdownMenuItem>
            <DropdownMenuItem onClick={() => onArchive(f.id, !f.is_archived)}>
              {f.is_archived ? <><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore</> : <><Archive className="mr-2 h-3.5 w-3.5" />Archive</>}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="text-destructive" onClick={() => onDelete(f)}>
              <Trash2 className="mr-2 h-3.5 w-3.5" />Delete…
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {children.map((c) => (
        <FolderNode key={c.id} f={c} depth={depth + 1} tree={tree} activeId={activeId}
          onSelect={onSelect} onRename={onRename} onArchive={onArchive} onDelete={onDelete} onDropFiles={onDropFiles} />
      ))}
    </div>
  );
}

/* =========================================================================
 *  Grid / list cells
 * ========================================================================= */

function useSignedThumb(r: Resource) {
  const signFn = useServerFn(getSignedReadUrl);
  const isImage = !r.external_url && (r.mime_type ?? "").startsWith("image/");
  const path = r.thumbnail_path || r.storage_path;
  const { data } = useQuery({
    queryKey: ["asset-thumb", r.id, path],
    enabled: isImage && !!path,
    staleTime: 50 * 60 * 1000,
    queryFn: () => signFn({ data: { path: path! } }),
  });
  return data?.url ?? null;
}

function AssetGridCard({
  r, selected, onToggleSelect, onOpen, onFav, onArchive, onDelete, selectedIds,
}: {
  r: Resource; selected: boolean;
  onToggleSelect: () => void; onOpen: () => void;
  onFav: () => void; onArchive: () => void; onDelete: () => void;
  selectedIds: string[];
}) {
  const thumb = useSignedThumb(r);
  const isLink = !!r.external_url;
  const onDragStart = (e: React.DragEvent) => {
    const ids = selected && selectedIds.length > 0 ? selectedIds : [r.id];
    e.dataTransfer.setData("application/x-asset-ids", JSON.stringify(ids));
    e.dataTransfer.effectAllowed = "move";
  };
  return (
    <Card
      className={`group relative overflow-hidden transition hover:border-primary/50 ${selected ? "ring-2 ring-primary" : ""}`}
      draggable
      onDragStart={onDragStart}
    >
      <div className="absolute left-2 top-2 z-10">
        <Checkbox checked={selected} onCheckedChange={onToggleSelect} aria-label="Select" className="bg-background" />
      </div>
      <button className="absolute right-2 top-2 z-10 rounded-full bg-background/80 p-1 text-muted-foreground hover:text-amber-500" onClick={onFav} title="Favourite">
        <Star className={`h-4 w-4 ${r.is_favourite ? "fill-amber-400 text-amber-500" : ""}`} />
      </button>
      <button className="grid h-32 w-full place-items-center overflow-hidden bg-muted" onClick={onOpen}>
        {thumb
          ? <img loading="lazy" src={thumb} alt={r.name} className="h-full w-full object-cover" />
          : <FileTypeIcon r={r} className="h-10 w-10 text-muted-foreground" />}
      </button>
      <div className="space-y-2 p-3">
        <div className="flex items-start gap-2">
          <FileTypeIcon r={r} className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <button className="min-w-0 flex-1 truncate text-left text-sm font-medium hover:underline" title={r.name} onClick={onOpen}>{r.name}</button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onOpen}><Edit2 className="mr-2 h-3.5 w-3.5" />Open / Edit</DropdownMenuItem>
              {isLink && r.external_url && (
                <>
                  <DropdownMenuItem onClick={() => window.open(r.external_url!, "_blank", "noopener,noreferrer")}>
                    <ExternalLink className="mr-2 h-3.5 w-3.5" />Open Link
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(r.external_url!); toast.success("Link copied"); }}>
                    <Copy className="mr-2 h-3.5 w-3.5" />Copy Link
                  </DropdownMenuItem>
                </>
              )}
              <DropdownMenuItem onClick={onFav}>
                <Star className="mr-2 h-3.5 w-3.5" />{r.is_favourite ? "Unfavourite" : "Favourite"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={onArchive}>
                {r.is_archived
                  ? <><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore</>
                  : <><Archive className="mr-2 h-3.5 w-3.5" />Archive</>}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span className="truncate">
            {isLink
              ? <Badge variant="secondary" className="h-5 text-[10px]">Shared Link</Badge>
              : bytes(r.file_size)}
          </span>
          <span>{new Date(r.created_at).toLocaleDateString()}</span>
        </div>
        {r.tags?.length ? (
          <div className="flex flex-wrap gap-1">
            {r.tags.slice(0, 3).map((t) => <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>)}
            {r.tags.length > 3 && <span className="text-[10px] text-muted-foreground">+{r.tags.length - 3}</span>}
          </div>
        ) : null}
      </div>
    </Card>
  );
}

function AssetListRow({
  r, folders, selected, onToggleSelect, onOpen, onFav, onArchive, onDelete, selectedIds,
}: {
  r: Resource; folders: FolderRow[]; selected: boolean;
  onToggleSelect: () => void; onOpen: () => void;
  onFav: () => void; onArchive: () => void; onDelete: () => void;
  selectedIds: string[];
}) {
  const folderName = folders.find((f) => f.id === r.folder_id)?.name ?? "—";
  const onDragStart = (e: React.DragEvent) => {
    const ids = selected && selectedIds.length > 0 ? selectedIds : [r.id];
    e.dataTransfer.setData("application/x-asset-ids", JSON.stringify(ids));
  };
  return (
    <div
      draggable onDragStart={onDragStart}
      className={`grid grid-cols-[28px_1fr_90px_140px_90px_140px_120px_120px_44px] items-center gap-2 border-b px-3 py-2 text-sm last:border-0 hover:bg-muted/30 ${selected ? "bg-primary/5" : ""}`}
    >
      <Checkbox checked={selected} onCheckedChange={onToggleSelect} />
      <button className="flex min-w-0 items-center gap-2 text-left" onClick={onOpen}>
        <FileTypeIcon r={r} className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="truncate hover:underline">{r.name}</span>
        {r.is_favourite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-500" />}
        {r.external_url && <Badge variant="secondary" className="ml-1 h-4 text-[9px]">Link</Badge>}
      </button>
      <span className="truncate text-xs text-muted-foreground">{r.external_url ? PROVIDER_META[(r.provider as AssetProvider) || detectProvider(r.external_url)].label : (r.mime_type ?? "—")}</span>
      <span className="truncate text-xs text-muted-foreground">{folderName}</span>
      <span className="text-xs text-muted-foreground">{r.external_url ? "—" : bytes(r.file_size)}</span>
      <span className="truncate text-xs text-muted-foreground">{r.created_by ? r.created_by.slice(0, 8) : "—"}</span>
      <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString()}</span>
      <span className="text-xs text-muted-foreground">{new Date(r.updated_at).toLocaleDateString()}</span>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="h-4 w-4" /></button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem onClick={onOpen}><Edit2 className="mr-2 h-3.5 w-3.5" />Open / Edit</DropdownMenuItem>
          {r.external_url && (
            <>
              <DropdownMenuItem onClick={() => window.open(r.external_url!, "_blank", "noopener,noreferrer")}>
                <ExternalLink className="mr-2 h-3.5 w-3.5" />Open Link
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => { navigator.clipboard.writeText(r.external_url!); toast.success("Link copied"); }}>
                <Copy className="mr-2 h-3.5 w-3.5" />Copy Link
              </DropdownMenuItem>
            </>
          )}
          <DropdownMenuItem onClick={onFav}><Star className="mr-2 h-3.5 w-3.5" />{r.is_favourite ? "Unfavourite" : "Favourite"}</DropdownMenuItem>
          <DropdownMenuItem onClick={onArchive}>{r.is_archived ? <><ArchiveRestore className="mr-2 h-3.5 w-3.5" />Restore</> : <><Archive className="mr-2 h-3.5 w-3.5" />Archive</>}</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className="text-destructive" onClick={onDelete}><Trash2 className="mr-2 h-3.5 w-3.5" />Delete</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}

/* =========================================================================
 *  Upload helpers
 * ========================================================================= */

type UploadJob = {
  id: string; name: string; size: number;
  progress: number;
  status: "uploading" | "complete" | "failed" | "cancelled";
  error?: string;
};

function xhrUpload(url: string, file: File, onProgress: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    if (file.type) xhr.setRequestHeader("Content-Type", file.type);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`HTTP ${xhr.status}`));
    xhr.onerror = () => reject(new Error("Network error"));
    xhr.send(file);
  });
}

function UploadButton({ onFiles }: { onFiles: (files: FileList) => void }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <Button size="sm" onClick={() => ref.current?.click()}>
        <Upload className="mr-1 h-4 w-4" />Upload Files
      </Button>
      <input
        ref={ref} type="file" className="hidden" multiple
        onChange={(e) => { if (e.target.files?.length) { onFiles(e.target.files); e.currentTarget.value = ""; } }}
      />
    </>
  );
}

function UploadQueue({ jobs, onClear, onRetry }: { jobs: UploadJob[]; onClear: (id: string) => void; onRetry: (j: UploadJob) => void }) {
  const active = jobs.some((j) => j.status === "uploading");
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center gap-2 text-sm font-medium">
        <Upload className="h-4 w-4" />
        Uploads {active ? "in progress" : "complete"}
        <span className="ml-auto text-xs text-muted-foreground">{jobs.length} item{jobs.length === 1 ? "" : "s"}</span>
      </div>
      <div className="space-y-2">
        {jobs.map((j) => (
          <div key={j.id} className="flex items-center gap-2 text-xs">
            <span className="min-w-0 flex-1 truncate" title={j.name}>{j.name}</span>
            <span className="w-12 text-right text-muted-foreground">{bytes(j.size)}</span>
            <div className="h-1.5 w-32 overflow-hidden rounded bg-muted">
              <div
                className={`h-full ${j.status === "failed" ? "bg-destructive" : j.status === "complete" ? "bg-emerald-500" : "bg-primary"}`}
                style={{ width: `${j.progress}%` }}
              />
            </div>
            <span className="w-12 text-right text-muted-foreground">
              {j.status === "failed" ? "Failed" : j.status === "complete" ? "Done" : `${j.progress}%`}
            </span>
            {j.status === "failed" && (
              <Button size="sm" variant="outline" className="h-6 px-2" onClick={() => onRetry(j)}>Retry</Button>
            )}
            <button className="text-muted-foreground hover:text-foreground" onClick={() => onClear(j.id)}><X className="h-3.5 w-3.5" /></button>
          </div>
        ))}
      </div>
    </Card>
  );
}

/* =========================================================================
 *  Dialogs
 * ========================================================================= */

function NewFolderDialog({
  open, onOpenChange, folders, defaultParent, onCreate,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  folders: FolderRow[]; defaultParent: string | null;
  onCreate: (name: string, parentId: string | null) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [parent, setParent] = useState<string | "root">(defaultParent ?? "root");
  useEffect(() => { if (open) { setName(""); setParent(defaultParent ?? "root"); } }, [open, defaultParent]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>New folder</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Brand assets" />
          </div>
          <div className="space-y-1.5">
            <Label>Parent</Label>
            <Select value={parent} onValueChange={(v) => setParent(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="root">(top level)</SelectItem>
                {folders.filter((f) => !f.is_archived).map((f) => (
                  <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={async () => { await onCreate(name, parent === "root" ? null : parent); onOpenChange(false); }}>Create</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddSharedLinkDialog({
  open, onOpenChange, folders, defaultFolderId, onSaved,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  folders: FolderRow[]; defaultFolderId: string | null;
  onSaved: () => void;
}) {
  const createFn = useServerFn(createResource);
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [folderId, setFolderId] = useState<string | "none">(defaultFolderId ?? "none");
  const [provider, setProvider] = useState<AssetProvider>("link");
  const [visibility, setVisibility] = useState<"team" | "private" | "shared">("team");

  useEffect(() => {
    if (open) {
      setUrl(""); setName(""); setDescription(""); setTagInput("");
      setFolderId(defaultFolderId ?? "none"); setProvider("link"); setVisibility("team");
    }
  }, [open, defaultFolderId]);

  useEffect(() => {
    if (url) setProvider(detectProvider(url));
  }, [url]);

  async function save() {
    const clean = safeUrl(url);
    if (!clean) { toast.error("Enter a valid http(s) URL"); return; }
    try {
      await createFn({ data: {
        name: name.trim() || clean,
        description: description || null,
        tags: tagInput.split(",").map((t) => t.trim().toLowerCase()).filter(Boolean),
        folder_id: folderId === "none" ? null : folderId,
        storage_path: null,
        external_url: clean,
        mime_type: null,
        file_size: null,
        thumbnail_path: null,
        provider,
        visibility,
      } as any });
      onOpenChange(false);
      toast.success("Shared link added");
      onSaved();
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add shared link</DialogTitle>
          <DialogDescription>Add a Google Drive, Canva, YouTube, or any other link.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>URL</Label>
            <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" />
            {url && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <span>{PROVIDER_META[provider].emoji}</span>
                <span>Detected: <strong className="font-medium">{PROVIDER_META[provider].label}</strong></span>
              </div>
            )}
          </div>
          <div className="space-y-1.5">
            <Label>Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Optional — defaults to URL" />
          </div>
          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Folder</Label>
              <Select value={folderId} onValueChange={(v) => setFolderId(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">(unfiled)</SelectItem>
                  {folders.filter((f) => !f.is_archived).map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as any)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="team">Team</SelectItem>
                  <SelectItem value="shared">Shared</SelectItem>
                  <SelectItem value="private">Private</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label>Tags</Label>
            <Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="comma, separated" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save}>Add link</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkMoveDialog({
  open, onOpenChange, folders, onMove,
}: {
  open: boolean; onOpenChange: (o: boolean) => void;
  folders: FolderRow[]; onMove: (folderId: string | null) => void;
}) {
  const [v, setV] = useState<string>("none");
  useEffect(() => { if (open) setV("none"); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Move selected items</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Destination</Label>
          <Select value={v} onValueChange={setV}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">(unfiled)</SelectItem>
              {folders.filter((f) => !f.is_archived).map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onMove(v === "none" ? null : v)}>Move</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkTagDialog({ open, onOpenChange, onApply }: { open: boolean; onOpenChange: (o: boolean) => void; onApply: (tags: string[]) => void }) {
  const [v, setV] = useState("");
  useEffect(() => { if (open) setV(""); }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add tags to selected</DialogTitle></DialogHeader>
        <div className="space-y-2">
          <Label>Tags (comma separated)</Label>
          <Input autoFocus value={v} onChange={(e) => setV(e.target.value)} placeholder="brand, q4-launch" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={() => onApply(v.split(",").map((s) => s.trim()).filter(Boolean))}>Add tags</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function FolderDeleteDialog({
  state, folders, onClose, onResolved, deleteFolderSafeFn,
}: {
  state: { folder: FolderRow } | null;
  folders: FolderRow[];
  onClose: () => void;
  onResolved: () => void;
  deleteFolderSafeFn: (args: any) => Promise<any>;
}) {
  const [mode, setMode] = useState<"unfile" | "move" | "archive">("unfile");
  const [target, setTarget] = useState<string>("");
  useEffect(() => { setMode("unfile"); setTarget(""); }, [state?.folder.id]);
  if (!state) return null;
  const others = folders.filter((f) => f.id !== state.folder.id && !f.is_archived);
  return (
    <AlertDialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete folder "{state.folder.name}"?</AlertDialogTitle>
          <AlertDialogDescription>
            This folder may contain files. Pick what should happen to them first.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="space-y-2 text-sm">
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "unfile"} onChange={() => setMode("unfile")} />Move contents to Unfiled</label>
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "move"} onChange={() => setMode("move")} />Move contents to another folder</label>
          {mode === "move" && (
            <Select value={target} onValueChange={setTarget}>
              <SelectTrigger><SelectValue placeholder="Choose folder…" /></SelectTrigger>
              <SelectContent>
                {others.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <label className="flex items-center gap-2"><input type="radio" checked={mode === "archive"} onChange={() => setMode("archive")} />Archive folder and contents</label>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={async () => {
              try {
                await deleteFolderSafeFn({ data: {
                  id: state.folder.id, mode,
                  target_folder_id: mode === "move" ? target || null : null,
                } });
                onResolved();
                toast.success(mode === "archive" ? "Folder archived" : "Folder deleted");
              } catch (e: any) { toast.error(e?.message ?? "Failed"); }
            }}
            disabled={mode === "move" && !target}
          >
            {mode === "archive" ? "Archive folder" : "Delete folder"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/* =========================================================================
 *  Detail drawer
 * ========================================================================= */

function DetailDrawer({
  r, folders, onClose, refresh,
}: { r: Resource; folders: FolderRow[]; onClose: () => void; refresh: () => void }) {
  const updateFn = useServerFn(updateResource);
  const deleteFn = useServerFn(deleteResource);
  const signFn = useServerFn(getSignedReadUrl);
  const favFn = useServerFn(toggleFavourite);
  const archFn = useServerFn(setArchived);

  const [name, setName] = useState(r.name);
  const [description, setDescription] = useState(r.description ?? "");
  const [tagInput, setTagInput] = useState(r.tags.join(", "));
  const [folderId, setFolderId] = useState<string | "none">(r.folder_id ?? "none");
  const [visibility, setVisibility] = useState<string>(r.visibility ?? "team");
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");

  const isLink = !!r.external_url;
  const kind = fileKind(r);
  const { data: signed } = useQuery({
    queryKey: ["asset-preview", r.id, r.storage_path],
    enabled: !isLink && !!r.storage_path,
    queryFn: () => signFn({ data: { path: r.storage_path! } }),
  });

  // Autosave (debounced)
  useEffect(() => {
    const dirty =
      name !== r.name ||
      (description ?? "") !== (r.description ?? "") ||
      tagInput !== r.tags.join(", ") ||
      (folderId === "none" ? null : folderId) !== r.folder_id ||
      visibility !== (r.visibility ?? "team");
    if (!dirty) return;
    setSaveState("saving");
    const t = setTimeout(async () => {
      try {
        await updateFn({ data: {
          id: r.id,
          name: name.trim(),
          description: description || null,
          tags: tagInput.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
          folder_id: folderId === "none" ? null : folderId,
        } as any });
        setSaveState("saved");
        refresh();
        setTimeout(() => setSaveState("idle"), 1500);
      } catch { setSaveState("error"); }
    }, 700);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, description, tagInput, folderId, visibility]);

  return (
    <div className="space-y-4">
      <SheetHeader>
        <SheetTitle className="flex items-center gap-2 text-base">
          <FileTypeIcon r={r} />
          <span className="truncate">{r.name}</span>
        </SheetTitle>
      </SheetHeader>

      {/* Preview */}
      <div className="overflow-hidden rounded-md border bg-muted/30">
        {isLink ? (
          <div className="grid place-items-center gap-2 p-8 text-center">
            <span className="text-4xl">{PROVIDER_META[(r.provider as AssetProvider) || detectProvider(r.external_url!)].emoji}</span>
            <span className="text-sm font-medium">{PROVIDER_META[(r.provider as AssetProvider) || detectProvider(r.external_url!)].label}</span>
            <a className="break-all text-xs text-primary underline" href={r.external_url!} target="_blank" rel="noopener noreferrer">{r.external_url}</a>
          </div>
        ) : !signed?.url ? (
          <div className="grid h-48 place-items-center text-xs text-muted-foreground">Loading preview…</div>
        ) : kind === "image" ? (
          <img src={signed.url} alt={r.name} className="mx-auto max-h-[40vh] w-auto" />
        ) : kind === "video" ? (
          <video controls className="w-full" src={signed.url} />
        ) : kind === "audio" ? (
          <audio controls className="w-full p-3" src={signed.url} />
        ) : (r.mime_type ?? "").includes("pdf") ? (
          <iframe src={signed.url} className="h-[40vh] w-full" title={r.name} />
        ) : (
          <div className="grid place-items-center gap-2 p-8 text-center text-sm text-muted-foreground">
            <FileTypeIcon r={r} className="h-8 w-8" />
            <span>No inline preview for this file type.</span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-2">
        {isLink ? (
          <>
            <Button size="sm" onClick={() => window.open(r.external_url!, "_blank", "noopener,noreferrer")}><ExternalLink className="mr-1 h-3.5 w-3.5" />Open Link</Button>
            <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(r.external_url!); toast.success("Copied"); }}><Copy className="mr-1 h-3.5 w-3.5" />Copy Link</Button>
          </>
        ) : signed?.url && (
          <a href={signed.url} target="_blank" rel="noopener noreferrer" download={r.name}>
            <Button size="sm" variant="outline"><Download className="mr-1 h-3.5 w-3.5" />Download</Button>
          </a>
        )}
        <Button size="sm" variant="outline" onClick={async () => { await favFn({ data: { ids: [r.id], value: !r.is_favourite } }); refresh(); }}>
          <Star className={`mr-1 h-3.5 w-3.5 ${r.is_favourite ? "fill-amber-400 text-amber-500" : ""}`} />
          {r.is_favourite ? "Unfavourite" : "Favourite"}
        </Button>
        <Button size="sm" variant="outline" onClick={async () => { await archFn({ data: { ids: [r.id], value: !r.is_archived } }); refresh(); onClose(); }}>
          {r.is_archived ? <><ArchiveRestore className="mr-1 h-3.5 w-3.5" />Restore</> : <><Archive className="mr-1 h-3.5 w-3.5" />Archive</>}
        </Button>
        <Button size="sm" variant="destructive" className="ml-auto" onClick={async () => {
          if (!window.confirm("Delete this item permanently?")) return;
          try { await deleteFn({ data: { id: r.id } }); refresh(); onClose(); toast.success("Deleted"); }
          catch (e: any) { toast.error(e?.message ?? "Failed"); }
        }}>
          <Trash2 className="mr-1 h-3.5 w-3.5" />Delete
        </Button>
      </div>

      <Separator />

      <div className="text-xs text-muted-foreground">
        {saveState === "saving" && "Saving…"}
        {saveState === "saved" && "Saved"}
        {saveState === "error" && <span className="text-destructive">Save failed</span>}
        {saveState === "idle" && "Autosaves on change"}
      </div>

      <div className="space-y-3">
        <Field label="Name"><Input value={name} onChange={(e) => setName(e.target.value)} /></Field>
        <Field label="Description"><Textarea rows={3} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
        <Field label="Folder">
          <Select value={folderId} onValueChange={(v) => setFolderId(v as any)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">(unfiled)</SelectItem>
              {folders.filter((f) => !f.is_archived).map((f) => (
                <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
        <Field label="Tags"><Input value={tagInput} onChange={(e) => setTagInput(e.target.value)} placeholder="comma, separated" /></Field>
        <Field label="Visibility">
          <Select value={visibility} onValueChange={setVisibility}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="team">Team</SelectItem>
              <SelectItem value="shared">Shared</SelectItem>
              <SelectItem value="private">Private</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      <Separator />

      <div className="space-y-1.5 text-xs text-muted-foreground">
        <Meta label="Type" value={isLink ? PROVIDER_META[(r.provider as AssetProvider) || detectProvider(r.external_url!)].label : (r.mime_type ?? "—")} />
        {!isLink && <Meta label="Size" value={bytes(r.file_size)} />}
        <Meta label="Uploaded" value={new Date(r.created_at).toLocaleString()} />
        <Meta label="Updated" value={new Date(r.updated_at).toLocaleString()} />
        {r.created_by && <Meta label="Uploaded by" value={r.created_by.slice(0, 8) + "…"} />}
        {isLink && r.external_url && <Meta label="URL" value={r.external_url} />}
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}
function Meta({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className="truncate text-right text-foreground">{value}</span>
    </div>
  );
}
