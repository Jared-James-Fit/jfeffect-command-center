import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
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
import { Plus, Star, Pencil, Trash2 } from "lucide-react";
import {
  listAllGifsAdmin, createGif, updateGif, deleteGif,
  GIF_CATEGORIES, type ChatGif,
} from "@/lib/chat-gifs";

export const Route = createFileRoute("/_authenticated/admin/chat-gifs")({
  component: ChatGifsPage,
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
  media_type: string;
  is_featured: boolean;
  active: boolean;
};

function emptyForm(): FormState {
  return {
    title: "", category: "Hype", tags: "",
    media_url: "", media_type: "image/gif",
    is_featured: false, active: true,
  };
}

function ChatGifsPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState<string>("all");
  const [editing, setEditing] = useState<FormState | null>(null);
  const { data: gifs = [] } = useQuery({
    queryKey: ["admin-chat-gifs"],
    queryFn: listAllGifsAdmin,
  });

  const filtered = filter === "all" ? gifs : gifs.filter((g) => g.category === filter);

  const save = async () => {
    if (!editing) return;
    if (!editing.title.trim() || !editing.media_url.trim()) {
      toast.error("Title and media URL are required");
      return;
    }
    const payload: Partial<ChatGif> = {
      title: editing.title.trim(),
      category: editing.category,
      tags: editing.tags.split(",").map((t) => t.trim()).filter(Boolean),
      media_url: editing.media_url.trim(),
      media_type: editing.media_type,
      is_featured: editing.is_featured,
      active: editing.active,
    };
    try {
      if (editing.id) await updateGif(editing.id, payload);
      else await createGif(payload);
      qc.invalidateQueries({ queryKey: ["admin-chat-gifs"] });
      qc.invalidateQueries({ queryKey: ["chat-gifs"] });
      setEditing(null);
      toast.success("Saved");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to save");
    }
  };

  const remove = async (g: ChatGif) => {
    if (!confirm(`Delete "${g.title}"?`)) return;
    try {
      await deleteGif(g.id);
      qc.invalidateQueries({ queryKey: ["admin-chat-gifs"] });
      qc.invalidateQueries({ queryKey: ["chat-gifs"] });
      toast.success("Deleted");
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to delete");
    }
  };

  const toggleArchived = async (g: ChatGif) => {
    try {
      await updateGif(g.id, { archived: !g.archived });
      qc.invalidateQueries({ queryKey: ["admin-chat-gifs"] });
      qc.invalidateQueries({ queryKey: ["chat-gifs"] });
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  return (
    <div className="p-4 sm:p-6">
      <PageHeader
        title="Chat GIF Library"
        subtitle="Curated GIFs and effects for chat reactions"
        actions={
          <Button onClick={() => setEditing(emptyForm())}>
            <Plus className="mr-2 h-4 w-4" /> Add GIF
          </Button>
        }
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Label className="text-xs">Filter:</Label>
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="h-8 w-48"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            {GIF_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
          </SelectContent>
        </Select>
        <span className="text-xs text-muted-foreground">{filtered.length} gif(s)</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((g) => (
          <Card key={g.id} className="overflow-hidden">
            <div className="aspect-square bg-secondary/40">
              <img src={g.thumb_url || g.media_url} alt={g.title}
                className="h-full w-full object-cover" loading="lazy" />
            </div>
            <div className="space-y-1 p-2">
              <div className="flex items-center justify-between gap-1">
                <span className="truncate text-sm font-medium">{g.title}</span>
                {g.is_featured && <Star className="h-3 w-3 shrink-0 fill-warning text-warning" />}
              </div>
              <div className="text-[10px] text-muted-foreground">
                {g.category}{g.archived && " · Archived"}{!g.active && " · Inactive"}
              </div>
              <div className="flex items-center gap-1 pt-1">
                <Button size="sm" variant="ghost" className="h-7 px-2"
                  onClick={() => setEditing({
                    id: g.id, title: g.title, category: g.category,
                    tags: g.tags.join(", "), media_url: g.media_url,
                    media_type: g.media_type, is_featured: g.is_featured, active: g.active,
                  })}
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Button size="sm" variant="ghost" className="h-7 px-2 text-xs"
                  onClick={() => toggleArchived(g)}
                >
                  {g.archived ? "Unarchive" : "Archive"}
                </Button>
                <Button size="sm" variant="ghost"
                  className="ml-auto h-7 px-2 text-destructive"
                  onClick={() => remove(g)}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            </div>
          </Card>
        ))}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(null); }}>
        <DialogContent>
          <DialogHeader><DialogTitle>{editing?.id ? "Edit GIF" : "Add GIF"}</DialogTitle></DialogHeader>
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
                    {GIF_CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Media URL</Label>
                <Input value={editing.media_url} onChange={(e) => setEditing({ ...editing, media_url: e.target.value })}
                  placeholder="https://… .gif / .webp / .mp4" />
              </div>
              <div className="grid gap-1.5">
                <Label>Media Type</Label>
                <Select value={editing.media_type} onValueChange={(v) => setEditing({ ...editing, media_type: v })}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="image/gif">image/gif</SelectItem>
                    <SelectItem value="image/webp">image/webp</SelectItem>
                    <SelectItem value="image/png">image/png</SelectItem>
                    <SelectItem value="video/mp4">video/mp4</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="grid gap-1.5">
                <Label>Tags (comma-separated)</Label>
                <Input value={editing.tags} onChange={(e) => setEditing({ ...editing, tags: e.target.value })}
                  placeholder="hype, pr, fire" />
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
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
            <Button onClick={save}>Save</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}