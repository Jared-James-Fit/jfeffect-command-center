import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  FolderOpen, ExternalLink, Copy, Pencil, Trash2, Plus, Link2, Archive, Eye, EyeOff,
} from "lucide-react";
import { toast } from "sonner";

const LINK_TYPES = [
  "Google Drive Subfolder",
  "Program Sheet",
  "Check-In Folder",
  "Progress Photos Folder",
  "Agreements Folder",
  "Shared Document",
  "External Resource",
  "Custom",
] as const;

const VISIBILITY = [
  { value: "admin", label: "Admin only" },
  { value: "coach", label: "Coach visible" },
  { value: "client", label: "Client visible" },
] as const;

type QuickLink = {
  id: string;
  client_id: string;
  title: string;
  url: string;
  link_type: string;
  notes: string | null;
  visibility: "admin" | "coach" | "client";
  archived: boolean;
  sort_order: number;
};

function copyLink(url: string) {
  navigator.clipboard.writeText(url).then(
    () => toast.success("Link copied"),
    () => toast.error("Couldn't copy"),
  );
}

export function ClientQuickLinksCard({
  clientId,
  driveFolderLink,
  onChangeDriveFolderLink,
}: {
  clientId: string;
  driveFolderLink: string | null | undefined;
  onChangeDriveFolderLink: (v: string) => void;
}) {
  const qc = useQueryClient();
  const [editingDrive, setEditingDrive] = useState(false);
  const [draftDrive, setDraftDrive] = useState(driveFolderLink ?? "");
  const [linkDialog, setLinkDialog] = useState<{ open: boolean; initial: QuickLink | null }>({ open: false, initial: null });

  const { data: links = [] } = useQuery({
    queryKey: ["client-quick-links", clientId],
    queryFn: async () => {
      const { data, error } = await (supabase.from("client_quick_links") as any)
        .select("*").eq("client_id", clientId).eq("archived", false)
        .order("sort_order", { ascending: true }).order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as QuickLink[];
    },
  });

  const saveDrive = async () => {
    const trimmed = draftDrive.trim();
    const { error } = await supabase.from("clients").update({ drive_folder_link: trimmed || null }).eq("id", clientId);
    if (error) return toast.error(error.message);
    onChangeDriveFolderLink(trimmed);
    setEditingDrive(false);
    toast.success("Drive folder updated");
    qc.invalidateQueries({ queryKey: ["client", clientId] });
  };

  const archiveLink = async (l: QuickLink) => {
    const { error } = await (supabase.from("client_quick_links") as any).update({ archived: true }).eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success("Archived");
    qc.invalidateQueries({ queryKey: ["client-quick-links", clientId] });
  };

  const deleteLink = async (l: QuickLink) => {
    if (!confirm(`Delete "${l.title}"? This can't be undone.`)) return;
    const { error } = await (supabase.from("client_quick_links") as any).delete().eq("id", l.id);
    if (error) return toast.error(error.message);
    toast.success("Deleted");
    qc.invalidateQueries({ queryKey: ["client-quick-links", clientId] });
  };

  return (
    <Card className="border-border bg-card p-6 space-y-5">
      <div className="flex items-center justify-between">
        <h3 className="text-xs uppercase tracking-widest text-muted-foreground">Client Quick Links</h3>
      </div>

      {/* Main Drive folder block */}
      <div className="rounded-lg border-2 border-primary/40 bg-gradient-to-br from-primary/10 to-primary/0 p-4 space-y-3">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-start gap-3 min-w-0">
            <div className="rounded-md bg-primary/15 p-2"><FolderOpen className="h-6 w-6 text-primary" /></div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-bold">Client Google Drive Folder</span>
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary text-[10px]">Main Drive Folder</Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">All client files: lift videos, progress photos, agreements, programs.</p>
            </div>
          </div>
        </div>

        {editingDrive ? (
          <div className="space-y-2">
            <Input value={draftDrive} onChange={(e) => setDraftDrive(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" autoFocus />
            <div className="flex gap-2">
              <Button size="sm" onClick={saveDrive} className="bg-gradient-primary uppercase font-bold">Save</Button>
              <Button size="sm" variant="ghost" onClick={() => { setEditingDrive(false); setDraftDrive(driveFolderLink ?? ""); }}>Cancel</Button>
            </div>
          </div>
        ) : driveFolderLink ? (
          <div className="flex flex-wrap gap-2">
            <a href={driveFolderLink} target="_blank" rel="noreferrer">
              <Button size="sm" className="bg-gradient-primary uppercase font-bold"><ExternalLink className="mr-1 h-4 w-4" /> Open Drive Folder</Button>
            </a>
            <Button size="sm" variant="outline" onClick={() => copyLink(driveFolderLink)}><Copy className="mr-1 h-4 w-4" /> Copy Link</Button>
            <Button size="sm" variant="outline" onClick={() => { setDraftDrive(driveFolderLink); setEditingDrive(true); }}><Pencil className="mr-1 h-4 w-4" /> Edit</Button>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground italic">No Google Drive folder linked yet.</p>
            <Button size="sm" onClick={() => { setDraftDrive(""); setEditingDrive(true); }} className="bg-gradient-primary uppercase font-bold">
              <Plus className="mr-1 h-4 w-4" /> Add Drive Folder
            </Button>
          </div>
        )}
      </div>

      {/* Other quick links */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <h4 className="text-[11px] uppercase tracking-widest text-muted-foreground">Other Quick Links</h4>
          <Button size="sm" variant="outline" onClick={() => setLinkDialog({ open: true, initial: null })}>
            <Plus className="mr-1 h-4 w-4" /> Add Link
          </Button>
        </div>

        {links.length === 0 ? (
          <p className="text-xs text-muted-foreground py-2">No extra links yet. Add Drive subfolders, sheets, or external resources.</p>
        ) : (
          <ul className="space-y-2">
            {links.map((l) => (
              <li key={l.id} className="rounded-md border border-border bg-secondary/30 p-3">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div className="min-w-0 flex items-start gap-2">
                    <Link2 className="h-4 w-4 mt-0.5 text-muted-foreground shrink-0" />
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-semibold text-sm">{l.title}</span>
                        <Badge variant="outline" className="text-[10px]">{l.link_type}</Badge>
                        <VisibilityBadge visibility={l.visibility} />
                      </div>
                      <div className="text-[11px] text-muted-foreground truncate max-w-[420px]">{l.url}</div>
                      {l.notes && <p className="text-[11px] text-muted-foreground mt-1">{l.notes}</p>}
                    </div>
                  </div>
                  <div className="flex gap-1">
                    <a href={l.url} target="_blank" rel="noreferrer"><Button size="sm" variant="ghost"><ExternalLink className="h-4 w-4" /></Button></a>
                    <Button size="sm" variant="ghost" onClick={() => copyLink(l.url)}><Copy className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => setLinkDialog({ open: true, initial: l })}><Pencil className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" onClick={() => archiveLink(l)} title="Archive"><Archive className="h-4 w-4" /></Button>
                    <Button size="sm" variant="ghost" className="text-destructive" onClick={() => deleteLink(l)}><Trash2 className="h-4 w-4" /></Button>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <QuickLinkDialog
        open={linkDialog.open}
        onOpenChange={(v) => setLinkDialog((s) => ({ ...s, open: v }))}
        clientId={clientId}
        initial={linkDialog.initial}
      />
    </Card>
  );
}

function VisibilityBadge({ visibility }: { visibility: QuickLink["visibility"] }) {
  if (visibility === "client") return <Badge variant="outline" className="text-[10px] border-emerald-500/40 bg-emerald-500/10 text-emerald-300"><Eye className="mr-1 h-3 w-3" />Client visible</Badge>;
  if (visibility === "coach") return <Badge variant="outline" className="text-[10px] border-sky-500/40 bg-sky-500/10 text-sky-300"><Eye className="mr-1 h-3 w-3" />Coach visible</Badge>;
  return <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground"><EyeOff className="mr-1 h-3 w-3" />Admin only</Badge>;
}

function QuickLinkDialog({
  open, onOpenChange, clientId, initial,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string;
  initial: QuickLink | null;
}) {
  const qc = useQueryClient();
  const [title, setTitle] = useState(initial?.title ?? "");
  const [url, setUrl] = useState(initial?.url ?? "");
  const [linkType, setLinkType] = useState<string>(initial?.link_type ?? "Custom");
  const [notes, setNotes] = useState(initial?.notes ?? "");
  const [visibility, setVisibility] = useState<QuickLink["visibility"]>(initial?.visibility ?? "admin");
  const [saving, setSaving] = useState(false);

  // Reset when initial changes
  const initialKey = initial?.id ?? "new";
  const [lastKey, setLastKey] = useState(initialKey);
  if (lastKey !== initialKey) {
    setLastKey(initialKey);
    setTitle(initial?.title ?? "");
    setUrl(initial?.url ?? "");
    setLinkType(initial?.link_type ?? "Custom");
    setNotes(initial?.notes ?? "");
    setVisibility(initial?.visibility ?? "admin");
  }

  const save = async () => {
    if (!title.trim() || !url.trim()) return toast.error("Title and URL are required");
    setSaving(true);
    const payload = {
      client_id: clientId,
      title: title.trim(),
      url: url.trim(),
      link_type: linkType,
      notes: notes.trim() || null,
      visibility,
    };
    const { error } = initial
      ? await (supabase.from("client_quick_links") as any).update(payload).eq("id", initial.id)
      : await (supabase.from("client_quick_links") as any).insert(payload);
    setSaving(false);
    if (error) return toast.error(error.message);
    toast.success(initial ? "Updated" : "Added");
    qc.invalidateQueries({ queryKey: ["client-quick-links", clientId] });
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{initial ? "Edit Quick Link" : "Add Quick Link"}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title</Label><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Progress Photos Folder" /></div>
          <div><Label>URL</Label><Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Link type</Label>
              <Select value={linkType} onValueChange={setLinkType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{LINK_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Visibility</Label>
              <Select value={visibility} onValueChange={(v) => setVisibility(v as QuickLink["visibility"])}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>{VISIBILITY.map((v) => <SelectItem key={v.value} value={v.value}>{v.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div><Label>Notes (optional)</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={save} disabled={saving} className="bg-gradient-primary uppercase font-bold">{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}