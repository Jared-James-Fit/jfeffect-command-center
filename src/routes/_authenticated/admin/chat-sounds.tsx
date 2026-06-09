import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Plus, Star, Pencil, Trash2, Play, Pause, Volume2 } from "lucide-react";
import {
  listAllSoundsAdmin, createSound, updateSound, deleteSound, uploadSoundFile,
  SOUND_CATEGORIES, type ChatSound,
} from "@/lib/chat-sounds";
import { playSound, stopSound, subscribeSound } from "@/lib/sound-player";

export const Route = createFileRoute("/_authenticated/admin/chat-sounds")({
  component: ChatSoundsPage,
  errorComponent: ({ error, reset }) => {
    const router = useRouter();
    return (
      <div className="p-6">
        <p className="text-sm text-destructive">Couldn't load: {String(error)}</p>
        <Button onClick={() => { reset(); router.invalidate(); }}>Retry</Button>
      </div>
    );
  },
  notFoundComponent: () => <div className="p-6 text-sm">Not found.</div>,
});

type FormState = {
  id?: string;
  title: string;
  category: string;
  tags: string;
  media_url: string;
  mime: string;
  duration_ms: number | null;
  is_featured: boolean;
  active: boolean;
};

function emptyForm(): FormState {
  return {
    title: "", category: "Hype", tags: "",
    media_url: "", mime: "audio/mpeg", duration_ms: null,
    is_featured: false, active: true,
  };
}

function ChatSoundsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<FormState | null>(null);
  const [uploading, setUploading] = useState(false);
  const { data: sounds = [] } = useQuery({
    queryKey: ["admin-chat-sounds"],
    queryFn: listAllSoundsAdmin,
  });

  const filtered = filter === "all" ? sounds : sounds.filter((s) => s.category === filter);

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.media_url.trim()) {
      toast.error("Title and media URL are required"); return;
    }
    const payload: Partial<ChatSound> = {
      title: editing.title.trim(),
      category: editing.category,
      tags: editing.tags.split(",").map((t) => t.trim()).filter(Boolean),
      media_url: editing.media_url.trim(),
      mime: editing.mime,
      duration_ms: editing.duration_ms,
      is_featured: editing.is_featured,
      active: editing.active,
    };
    try {
      if (editing.id) await updateSound(editing.id, payload);
      else await createSound(payload);
      qc.invalidateQueries({ queryKey: ["admin-chat-sounds"] });
      qc.invalidateQueries({ queryKey: ["chat-sounds"] });
      setEditing(null); toast.success("Saved");
    } catch (e: any) { toast.error(e?.message ?? "Failed to save"); }
  };

  const remove = async (s: ChatSound) => {
    if (!confirm(`Delete "${s.title}"?`)) return;
    try {
      await deleteSound(s.id);
      qc.invalidateQueries({ queryKey: ["admin-chat-sounds"] });
      qc.invalidateQueries({ queryKey: ["chat-sounds"] });
      toast.success("Deleted");
    } catch (e: any) { toast.error(e?.message ?? "Failed to delete"); }
  };

  const toggleArchived = async (s: ChatSound) => {
    try {
      await updateSound(s.id, { archived: !s.archived });
      qc.invalidateQueries({ queryKey: ["admin-chat-sounds"] });
      qc.invalidateQueries({ queryKey: ["chat-sounds"] });
    } catch (e: any) { toast.error(e?.message ?? "Failed"); }
  };

  const onPickFile = async (file: File) => {
    if (!editing) return;
    if (file.size > 300 * 1024) {
      toast.error("Sound files must be under 300KB"); return;
    }
    setUploading(true);
    try {
      // Measure duration client-side
      const tmpUrl = URL.createObjectURL(file);
      const dur = await new Promise<number | null>((resolve) => {
        const a = new Audio();
        a.preload = "metadata";
        a.onloadedmetadata = () => resolve(isFinite(a.duration) ? Math.round(a.duration * 1000) : null);
        a.onerror = () => resolve(null);
        a.src = tmpUrl;
      });
      URL.revokeObjectURL(tmpUrl);
      if (dur && dur > 6000) {
        toast.error("Sounds must be 6 seconds or less");
        setUploading(false);
        return;
      }
      const { url, mime } = await uploadSoundFile(file);
      setEditing({ ...editing, media_url: url, mime, duration_ms: dur });
      toast.success("Uploaded");
    } catch (e: any) { toast.error(e?.message ?? "Upload failed"); }
    finally { setUploading(false); }
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Chat Sound Library"
        subtitle="Curated short sound effects for chat — hype, PRs, coach reactions, gym humour"
        actions={
          <Button onClick={() => setEditing(emptyForm())}>
            <Plus className="mr-2 h-4 w-4" /> Add Sound
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Label className="text-xs">Filter:</Label>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {SOUND_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} sound(s)</span>
      </div>

      <div className="mt-4 grid gap-2">
        {filtered.map((s) => <AdminSoundRow key={s.id} sound={s} onEdit={() => setEditing({
          id: s.id, title: s.title, category: s.category, tags: s.tags.join(", "),
          media_url: s.media_url, mime: s.mime, duration_ms: s.duration_ms,
          is_featured: s.is_featured, active: s.active,
        })} onArchive={() => toggleArchived(s)} onDelete={() => remove(s)} />)}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) { stopSound(); setEditing(null); } }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Sound" : "Add Sound"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-3">
              <div className="grid gap-1.5">
                <Label>Title</Label>
                <Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
              </div>
              <div className="grid gap-1.5">
                <Label>Category</Label>
                <Select value={editing.category} onValueChange={(v) => setEditing({ ...editing, category: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {SOUND_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Upload file (≤6s, ≤300KB)</Label>
                <input
                  type="file"
                  accept="audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/mp4,audio/m4a"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onPickFile(f);
                  }}
                  className="text-xs"
                  disabled={uploading}
                />
              </div>
              <div className="grid gap-1.5">
                <Label>Media URL</Label>
                <Input value={editing.media_url} onChange={(e) => setEditing({ ...editing, media_url: e.target.value })}
                  placeholder="Paste URL or upload above" />
                {editing.media_url && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => playSound(editing.media_url)}>
                    <Play className="mr-2 h-3 w-3" /> Preview
                  </Button>
                )}
              </div>
              <div className="grid gap-1.5">
                <Label>Tags (comma-separated)</Label>
                <Input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                  placeholder="pr, bell, win" />
              </div>
              <div className="flex items-center justify-between">
                <Label>Featured</Label>
                <Switch checked={editing.is_featured}
                  onCheckedChange={(v) => setEditing({ ...editing, is_featured: v })} />
              </div>
              <div className="flex items-center justify-between">
                <Label>Active</Label>
                <Switch checked={editing.active}
                  onCheckedChange={(v) => setEditing({ ...editing, active: v })} />
              </div>
              {editing.duration_ms != null && (
                <p className="text-xs text-muted-foreground">Duration: {(editing.duration_ms/1000).toFixed(1)}s</p>
              )}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => { stopSound(); setEditing(null); }}>Cancel</Button>
            <Button onClick={save} disabled={uploading}>{uploading ? "Uploading…" : "Save"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function AdminSoundRow({
  sound, onEdit, onArchive, onDelete,
}: {
  sound: ChatSound;
  onEdit: () => void; onArchive: () => void; onDelete: () => void;
}) {
  const [playing, setPlaying] = useState(false);
  useEffect(() => subscribeSound((st) => setPlaying(st.url === sound.media_url && st.playing)), [sound.media_url]);
  return (
    <Card className="flex items-center gap-3 p-3">
      <button
        type="button"
        onClick={() => playSound(sound.media_url)}
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground"
        aria-label={playing ? "Pause" : "Play"}
      >
        {playing ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
      </button>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-muted-foreground">
          <Volume2 className="h-3 w-3" />
          {sound.category}
          {sound.duration_ms != null && <span>· {(sound.duration_ms/1000).toFixed(1)}s</span>}
          {sound.is_featured && <Star className="h-3 w-3 fill-warning text-warning" />}
          {sound.archived && <span className="ml-1">· Archived</span>}
          {!sound.active && <span className="ml-1">· Inactive</span>}
        </div>
        <div className="truncate text-sm font-medium">{sound.title}</div>
      </div>
      <Button size="sm" variant="ghost" onClick={onEdit}><Pencil className="h-3 w-3" /></Button>
      <Button size="sm" variant="ghost" className="text-xs" onClick={onArchive}>
        {sound.archived ? "Unarchive" : "Archive"}
      </Button>
      <Button size="sm" variant="ghost" className="text-destructive" onClick={onDelete}>
        <Trash2 className="h-3 w-3" />
      </Button>
    </Card>
  );
}