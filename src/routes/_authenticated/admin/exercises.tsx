import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Search, Trash2, Youtube, Pencil, CheckCircle2, AlertTriangle, Flame, BarChart3 } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { buildCleanVimeoEmbedUrl, vimeoUrlFromId, MIGRATION_STATUSES } from "@/lib/exercise-video";
import { ExerciseWarmupDialog } from "@/components/exercise-warmup-dialog";
import { ExerciseVolumeTagsDialog } from "@/components/volume/exercise-volume-tags-dialog";
import { MOVEMENT_PATTERN_LABELS, VARIATION_LABELS } from "@/lib/volume";

export const Route = createFileRoute("/_authenticated/admin/exercises")({
  component: ExercisesRedirect,
});

function ExercisesRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate({ to: "/admin/programming", search: { tab: "exercises" } as any, replace: true });
  }, [navigate]);
  return null;
}

const CATEGORIES = ["Squat", "Bench", "Deadlift", "Upper Body", "Lower Body", "Back", "Chest", "Shoulders", "Arms", "Glutes", "Core", "Mobility", "Warm-Ups", "Powerlifting", "Bodybuilding", "Cardio"];

const MIGRATION_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All exercises" },
  { value: "needs_volume_tags", label: "Needs volume tags" },
  { value: "youtube_pending", label: "YouTube pending" },
  { value: "vimeo_uploaded", label: "Vimeo uploaded" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "published_with_vimeo", label: "Published with Vimeo" },
  { value: "missing_vimeo", label: "Missing Vimeo" },
  { value: "quality_warning", label: "Quality warning" },
  { value: "youtube_fallback_enabled", label: "YouTube fallback enabled" },
  { value: "still_youtube_client", label: "Still YouTube client-facing" },
];

export function ExercisesAdmin({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [migration, setMigration] = useState("all");
  const [editing, setEditing] = useState<any | null>(null);

  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises"],
    queryFn: async () => {
      const { data, error } = await supabase.from("exercises").select("*").order("name");
      if (error) throw error;
      return data;
    },
  });

  const filtered = exercises.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (search && !e.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (migration === "all") return true;
    if (migration === "needs_volume_tags") {
      return !e.primary_movement_pattern || !e.variation_type;
    }
    if (migration === "missing_vimeo") return !e.vimeo_video_id;
    if (migration === "quality_warning") return !!e.quality_warning;
    if (migration === "youtube_fallback_enabled") return e.youtube_fallback_allowed === true;
    if (migration === "still_youtube_client") {
      const publishedVimeo =
        e.video_provider === "vimeo" &&
        e.vimeo_embed_url &&
        e.video_migration_status === "published_with_vimeo";
      return !publishedVimeo && e.youtube_fallback_allowed === true && !!e.youtube_url;
    }
    return e.video_migration_status === migration;
  });

  const stillYouTubeCount = exercises.filter(
    (e) =>
      !(
        e.video_provider === "vimeo" &&
        e.vimeo_embed_url &&
        e.video_migration_status === "published_with_vimeo"
      ) && e.youtube_fallback_allowed === true && !!e.youtube_url,
  ).length;

  const del = async (id: string) => {
    if (!confirm("Delete exercise?")) return;
    await supabase.from("exercises").delete().eq("id", id);
    qc.invalidateQueries({ queryKey: ["exercises"] });
  };

  const [warmupTarget, setWarmupTarget] = useState<any | null>(null);

  return (
    <>
      {!embedded && <PageHeader
        title="Exercise Library"
        subtitle={`${exercises.length} exercises · ${stillYouTubeCount} still serving YouTube to clients`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> Add exercise
              </Button>
            </DialogTrigger>
            <NewExerciseDialog onClose={() => setOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["exercises"] })} />
          </Dialog>
        }
      />}
      {embedded && (
        <div className="flex justify-end px-6 pt-4 md:px-8">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> Add exercise
              </Button>
            </DialogTrigger>
            <NewExerciseDialog onClose={() => setOpen(false)} onCreated={() => qc.invalidateQueries({ queryKey: ["exercises"] })} />
          </Dialog>
        </div>
      )}
      <div className="space-y-4 p-6 md:p-8">
        <div className="sticky top-0 z-20 -mx-6 md:-mx-8 -mt-6 md:-mt-8 px-6 md:px-8 py-3 bg-background/80 backdrop-blur-md border-b border-border/50 shadow-sm">
          <div className="flex flex-wrap gap-3">
            <div className="relative flex-1 min-w-[240px]">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input className="pl-9" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
            </div>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}
              </SelectContent>
            </Select>
            <Select value={migration} onValueChange={setMigration}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Migration status" /></SelectTrigger>
              <SelectContent>
                {MIGRATION_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>{f.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((e) => (
            <Card key={e.id} className="border-border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold">{e.name}</div>
                  <div className="text-xs text-muted-foreground">{e.category} · {e.muscle_group ?? "—"}</div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(e)}><Pencil className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" title="Warm-up settings" onClick={() => setWarmupTarget(e)}><Flame className="h-3 w-3 text-orange-500" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => del(e.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
              <div className="flex flex-wrap gap-1">
                <Badge variant={e.video_provider === "vimeo" ? "default" : "secondary"} className="text-[10px]">
                  {e.video_provider ?? "—"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{e.video_migration_status ?? "—"}</Badge>
                {e.safe_to_publish && (
                  <Badge className="bg-green-600 text-[10px]"><CheckCircle2 className="mr-0.5 h-2.5 w-2.5" />safe</Badge>
                )}
                {e.vimeo_working && <Badge variant="outline" className="text-[10px]">vimeo ok</Badge>}
                {e.youtube_replaced && <Badge variant="outline" className="text-[10px]">yt replaced</Badge>}
                {e.youtube_fallback_allowed && (
                  <Badge className="bg-amber-600 text-[10px]"><AlertTriangle className="mr-0.5 h-2.5 w-2.5" />yt fallback</Badge>
                )}
                {e.quality_warning && (
                  <Badge variant="destructive" className="text-[10px]">quality</Badge>
                )}
              </div>
              {e.legacy_youtube_url && (
                <a href={e.legacy_youtube_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground">
                  <Youtube className="h-3 w-3" /> legacy YouTube (admin only)
                </a>
              )}
              {e.vimeo_url && (
                <a href={e.vimeo_url} target="_blank" rel="noreferrer" className="text-[11px] font-semibold text-primary hover:underline">
                  Open Vimeo →
                </a>
              )}
              {e.cues && <p className="text-xs text-muted-foreground line-clamp-2">{e.cues}</p>}
            </Card>
          ))}
        </div>
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <EditExerciseDialog
            exercise={editing}
            onClose={() => setEditing(null)}
            onSaved={() => qc.invalidateQueries({ queryKey: ["exercises"] })}
          />
        )}
      </Dialog>
      <ExerciseWarmupDialog
        exercise={warmupTarget}
        open={!!warmupTarget}
        onClose={() => setWarmupTarget(null)}
      />
    </>
  );
}

function EditExerciseDialog({
  exercise,
  onClose,
  onSaved,
}: {
  exercise: any;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    vimeo_video_id: exercise.vimeo_video_id ?? "",
    vimeo_url: exercise.vimeo_url ?? "",
    vimeo_embed_url: exercise.vimeo_embed_url ?? "",
    thumbnail_url: exercise.thumbnail_url ?? "",
    video_provider: exercise.video_provider ?? "youtube",
    video_migration_status: exercise.video_migration_status ?? "youtube_pending",
    source_type: exercise.source_type ?? "",
    source_quality: exercise.source_quality ?? "",
    quality_warning: exercise.quality_warning ?? "",
    vimeo_working: !!exercise.vimeo_working,
    safe_to_publish: !!exercise.safe_to_publish,
    youtube_fallback_allowed: !!exercise.youtube_fallback_allowed,
  });
  const [busy, setBusy] = useState(false);

  const onVimeoIdChange = (id: string) => {
    const trimmed = id.trim();
    setForm((f) => ({
      ...f,
      vimeo_video_id: trimmed,
      vimeo_url: trimmed ? vimeoUrlFromId(trimmed) : "",
      vimeo_embed_url: trimmed ? buildCleanVimeoEmbedUrl(trimmed) : "",
    }));
  };

  const publish = () => {
    setForm((f) => ({
      ...f,
      vimeo_working: true,
      safe_to_publish: true,
      video_provider: "vimeo",
      video_migration_status: "published_with_vimeo",
    }));
  };

  const save = async () => {
    setBusy(true);
    const patch: any = { ...form };
    if (
      patch.video_provider === "vimeo" &&
      patch.video_migration_status === "published_with_vimeo" &&
      patch.vimeo_embed_url
    ) {
      patch.video_url = patch.vimeo_embed_url;
      patch.youtube_replaced = true;
    }
    // backfill legacy if missing
    if (!exercise.legacy_youtube_url && exercise.youtube_url) patch.legacy_youtube_url = exercise.youtube_url;
    if (!exercise.source_youtube_url && exercise.youtube_url) patch.source_youtube_url = exercise.youtube_url;
    const { error } = await supabase.from("exercises").update(patch).eq("id", exercise.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    onSaved();
    onClose();
  };

  return (
    <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
      <DialogHeader><DialogTitle>{exercise.name} — video migration</DialogTitle></DialogHeader>
      <div className="space-y-3">
        <div className="rounded-md border border-border p-3 text-xs space-y-1">
          <div><span className="text-muted-foreground">Legacy YouTube:</span> {exercise.legacy_youtube_url ?? exercise.youtube_url ?? "—"}</div>
          <div><span className="text-muted-foreground">Source YouTube:</span> {exercise.source_youtube_url ?? "—"}</div>
        </div>
        <div>
          <Label>Vimeo video ID</Label>
          <Input value={form.vimeo_video_id} onChange={(e) => onVimeoIdChange(e.target.value)} placeholder="e.g. 123456789" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Vimeo URL</Label>
            <Input value={form.vimeo_url} onChange={(e) => setForm({ ...form, vimeo_url: e.target.value })} />
          </div>
          <div>
            <Label>Thumbnail URL</Label>
            <Input value={form.thumbnail_url} onChange={(e) => setForm({ ...form, thumbnail_url: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>Vimeo embed URL (clean)</Label>
          <Input value={form.vimeo_embed_url} onChange={(e) => setForm({ ...form, vimeo_embed_url: e.target.value })} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Provider</Label>
            <Select value={form.video_provider} onValueChange={(v) => setForm({ ...form, video_provider: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="youtube">youtube</SelectItem>
                <SelectItem value="vimeo">vimeo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Migration status</Label>
            <Select value={form.video_migration_status} onValueChange={(v) => setForm({ ...form, video_migration_status: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {MIGRATION_STATUSES.map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Source type</Label>
            <Input value={form.source_type} onChange={(e) => setForm({ ...form, source_type: e.target.value })} />
          </div>
          <div>
            <Label>Source quality</Label>
            <Input value={form.source_quality} onChange={(e) => setForm({ ...form, source_quality: e.target.value })} />
          </div>
        </div>
        <div>
          <Label>Quality warning</Label>
          <Textarea rows={2} value={form.quality_warning} onChange={(e) => setForm({ ...form, quality_warning: e.target.value })} />
        </div>
        <div className="grid grid-cols-1 gap-2 rounded-md border border-border p-3">
          <label className="flex items-center justify-between text-sm">
            Vimeo working
            <Switch checked={form.vimeo_working} onCheckedChange={(v) => setForm({ ...form, vimeo_working: v })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            Safe to publish
            <Switch checked={form.safe_to_publish} onCheckedChange={(v) => setForm({ ...form, safe_to_publish: v })} />
          </label>
          <label className="flex items-center justify-between text-sm">
            YouTube fallback allowed (clients will see YouTube)
            <Switch checked={form.youtube_fallback_allowed} onCheckedChange={(v) => setForm({ ...form, youtube_fallback_allowed: v })} />
          </label>
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={publish} disabled={!form.vimeo_embed_url}>
          Mark working + publish with Vimeo
        </Button>
      </div>
      <DialogFooter>
        <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={busy} className="bg-gradient-primary font-bold uppercase">{busy ? "Saving…" : "Save"}</Button>
      </DialogFooter>
    </DialogContent>
  );
}

function NewExerciseDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({
    name: "", category: CATEGORIES[0], muscle_group: "", equipment: "",
    youtube_url: "", cues: "", common_mistakes: "", difficulty: "Intermediate",
    default_load_unit: "lb" as "kg" | "lb",
  });
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.from("exercises").insert(form);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Added");
    onCreated();
    onClose();
  };

  return (
    <DialogContent className="max-w-lg">
      <DialogHeader><DialogTitle>New exercise</DialogTitle></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <div><Label>Name *</Label><Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label>Category</Label>
            <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          <div><Label>Muscle group</Label><Input value={form.muscle_group} onChange={(e) => setForm({ ...form, muscle_group: e.target.value })} /></div>
          <div><Label>Equipment</Label><Input value={form.equipment} onChange={(e) => setForm({ ...form, equipment: e.target.value })} /></div>
          <div><Label>Difficulty</Label><Input value={form.difficulty} onChange={(e) => setForm({ ...form, difficulty: e.target.value })} /></div>
          <div>
            <Label>Default unit</Label>
            <Select value={form.default_load_unit} onValueChange={(v) => setForm({ ...form, default_load_unit: v as "kg" | "lb" })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="lb">lb (pounds)</SelectItem>
                <SelectItem value="kg">kg (kilograms)</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
        <div><Label>YouTube URL</Label><Input value={form.youtube_url} onChange={(e) => setForm({ ...form, youtube_url: e.target.value })} /></div>
        <div><Label>Coaching cues</Label><Textarea rows={2} value={form.cues} onChange={(e) => setForm({ ...form, cues: e.target.value })} /></div>
        <div><Label>Common mistakes</Label><Textarea rows={2} value={form.common_mistakes} onChange={(e) => setForm({ ...form, common_mistakes: e.target.value })} /></div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" disabled={busy} className="bg-gradient-primary font-bold uppercase">{busy ? "Saving…" : "Add"}</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}