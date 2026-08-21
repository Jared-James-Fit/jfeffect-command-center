import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { searchExercises, type SearchableExercise } from "@/lib/exercise-search";
import { HighlightedExerciseName } from "@/components/exercise-search-highlight";
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
import { invalidateExerciseLibrary, upsertExerciseInLibraryCaches } from "@/lib/exercise-library-cache";
import { toast } from "sonner";
import { EXERCISE_CATEGORIES, PRIMARY_MUSCLE_GROUPS as SHARED_PRIMARY_MUSCLE_GROUPS } from "@/lib/exercise-taxonomy";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { buildCleanVimeoEmbedUrl, vimeoUrlFromId, MIGRATION_STATUSES } from "@/lib/exercise-video";
import { ExerciseQuickCreateForm } from "@/components/exercises/exercise-quick-create-form";
import { useIsCoarsePointer, useVisualViewportHeight } from "@/hooks/use-touch-viewport";
import { ExerciseWarmupDialog } from "@/components/exercise-warmup-dialog";
import { ExerciseVolumeTagsDialog } from "@/components/volume/exercise-volume-tags-dialog";
import { MOVEMENT_PATTERN_LABELS, VARIATION_LABELS } from "@/lib/volume";
import { useExerciseVideoSetGlobal, setExerciseVideoSetGlobal } from "@/hooks/use-exercise-video-set";

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

const CATEGORIES: readonly string[] = EXERCISE_CATEGORIES;

const PRIMARY_MUSCLE_GROUPS: readonly string[] = SHARED_PRIMARY_MUSCLE_GROUPS;

const MIGRATION_FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "All exercises" },
  { value: "needs_volume_tags", label: "Needs volume tags" },
  { value: "needs_muscle_review", label: "Needs muscle review" },
  { value: "youtube_pending", label: "YouTube pending" },
  { value: "vimeo_uploaded", label: "Vimeo uploaded" },
  { value: "ready_for_review", label: "Ready for review" },
  { value: "published_with_vimeo", label: "Published with Vimeo" },
  { value: "missing_vimeo", label: "Missing Vimeo" },
  { value: "quality_warning", label: "Quality warning" },
  { value: "youtube_fallback_enabled", label: "YouTube fallback enabled" },
  { value: "still_youtube_client", label: "Still YouTube client-facing" },
];

const EXERCISE_LIBRARY_PAGE_SIZE = 1000;

/**
 * Supabase caps REST responses at 1,000 rows even when a larger limit is
 * requested. Page through the full accessible library so later-alphabetic
 * exercises remain discoverable in the admin search.
 */
async function fetchExerciseLibrary() {
  const rows: any[] = [];
  for (let from = 0; ; from += EXERCISE_LIBRARY_PAGE_SIZE) {
    const { data, error } = await supabase
      .from("exercises")
      .select("*")
      .order("name")
      .range(from, from + EXERCISE_LIBRARY_PAGE_SIZE - 1);
    if (error) throw error;
    const page = data ?? [];
    rows.push(...page);
    if (page.length < EXERCISE_LIBRARY_PAGE_SIZE) return rows;
  }
}

export function ExercisesAdmin({ embedded = false }: { embedded?: boolean } = {}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("all");
  const [migration, setMigration] = useState("all");
  const [muscleFilter, setMuscleFilter] = useState("all");
  const [editing, setEditing] = useState<any | null>(null);

  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises"],
    // This library is an operational authoring surface. A new exercise must
    // become searchable after a reload, a tab switch, or a reconnect; never
    // let a hydrated snapshot mask a database row that was successfully saved.
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: true,
    refetchOnReconnect: "always",
    queryFn: fetchExerciseLibrary,
  });

  const preFiltered = exercises.filter((e) => {
    if (category !== "all" && e.category !== category) return false;
    if (muscleFilter !== "all") {
      const mg = (e as any).primary_muscle_group ?? "Other";
      if (mg !== muscleFilter) return false;
    }
    if (migration === "all") return true;
    if (migration === "needs_volume_tags") {
      return !e.primary_movement_pattern || !e.variation_type;
    }
    if (migration === "needs_muscle_review") {
      return (e as any).needs_muscle_review === true;
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

  // Keyword search runs after the structured filters so filters + search
  // always combine. Shared helper → same behaviour as the client library,
  // the swap picker and the program builder.
  const searched = useMemo(
    () => searchExercises(preFiltered as unknown as SearchableExercise[], search, { limit: 5000 }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [preFiltered.length, search, category, migration, muscleFilter, exercises],
  );
  const filtered = searched.results.map((r) => r.exercise) as unknown as typeof exercises;
  const highlightTerms = searched.highlightTerms;

  // Windowed rendering. The full library is ~1700 rows and every admin card
  // mounts a Radix Select + badge cluster; rendering them all made iOS/PWA
  // spike memory and let WebKit jettison the tab the moment a dialog mounted
  // — which relaunched the PWA into the "Loading your dashboard…" splash.
  const ADMIN_PAGE = 60;
  const [visibleCount, setVisibleCount] = useState(ADMIN_PAGE);
  useEffect(() => { setVisibleCount(ADMIN_PAGE); }, [search, category, migration, muscleFilter]);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((c) => Math.min(c + ADMIN_PAGE, filtered.length));
      }
    }, { rootMargin: "600px 0px" });
    io.observe(node);
    return () => io.disconnect();
  }, [filtered.length]);
  const visible = filtered.slice(0, visibleCount);


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
    void invalidateExerciseLibrary(qc);
  };

  const [warmupTarget, setWarmupTarget] = useState<any | null>(null);
  const [volumeTarget, setVolumeTarget] = useState<any | null>(null);

  const setPrimaryMuscle = async (id: string, value: string) => {
    const { error } = await supabase
      .from("exercises")
      .update({ primary_muscle_group: value, needs_muscle_review: false })
      .eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Muscle group updated");
    void invalidateExerciseLibrary(qc);
  };

  const needsTagsCount = exercises.filter(
    (e: any) => !e.primary_movement_pattern || !e.variation_type,
  ).length;
  const needsMuscleCount = exercises.filter(
    (e: any) => e.needs_muscle_review === true,
  ).length;

  const { data: globalSet } = useExerciseVideoSetGlobal();
  const onChangeGlobal = async (v: string) => {
    try {
      await setExerciseVideoSetGlobal(v === "none" ? null : (v as "primary" | "secondary"));
      toast.success(v === "none" ? "Global override cleared" : `Library switched to ${v}`);
      qc.invalidateQueries({ queryKey: ["app_settings", "exercise_video_set"] });
    } catch (err: any) {
      toast.error(err?.message ?? "Failed to update");
    }
  };

  return (
    <>
      {!embedded && <PageHeader
        title="Exercise Library"
        subtitle={`${exercises.length} exercises · ${needsMuscleCount} need muscle review · ${stillYouTubeCount} still on YouTube · ${needsTagsCount} need volume tags`}
        actions={
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              {/* type="button" — never submit an ancestor form; opening the
                  quick-create dialog is local UI state only. */}
              <Button type="button" className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> Add exercise
              </Button>
            </DialogTrigger>
            <NewExerciseDialog onClose={() => setOpen(false)} onCreated={() => void invalidateExerciseLibrary(qc)} />
          </Dialog>
        }
      />}
      {embedded && (
        <div className="flex justify-end px-6 pt-4 md:px-8">
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button type="button" className="bg-gradient-primary font-bold uppercase tracking-wide">
                <Plus className="mr-2 h-4 w-4" /> Add exercise
              </Button>
            </DialogTrigger>
            <NewExerciseDialog onClose={() => setOpen(false)} onCreated={() => void invalidateExerciseLibrary(qc)} />
          </Dialog>
        </div>
      )}

      <div className="space-y-4 p-6 md:p-8">
        <Card className="border-primary/30 bg-card p-3 flex flex-wrap items-center gap-3">
          <div className="text-xs font-bold uppercase tracking-widest text-muted-foreground">
            Global video set
          </div>
          <Select value={globalSet ?? "none"} onValueChange={onChangeGlobal}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Per-exercise (default)</SelectItem>
              <SelectItem value="primary">Force Primary (all)</SelectItem>
              <SelectItem value="secondary">Force Secondary (all)</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-[11px] text-muted-foreground">
            One-click swap for the entire library. Overrides each exercise's own setting.
          </div>
        </Card>
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
            <Select value={muscleFilter} onValueChange={setMuscleFilter}>
              <SelectTrigger className="w-56"><SelectValue placeholder="Primary muscle" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All muscle groups</SelectItem>
                {PRIMARY_MUSCLE_GROUPS.map((m) => (
                  <SelectItem key={m} value={m}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {visible.map((e) => (

            <Card key={e.id} className="border-border bg-card p-4 space-y-2">
              <div className="flex items-start justify-between">
                <div>
                  <div className="font-bold">
                    <HighlightedExerciseName text={e.name} terms={highlightTerms} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {e.category} · <span className={(e as any).needs_muscle_review ? "text-amber-500 font-semibold" : "text-primary font-semibold"}>{(e as any).primary_muscle_group ?? "—"}</span>
                    {(e as any).needs_muscle_review && <span className="ml-1 text-amber-500">⚠ review</span>}
                  </div>
                </div>
                <div className="flex gap-1">
                  <Button variant="ghost" size="sm" onClick={() => setEditing(e)}><Pencil className="h-3 w-3" /></Button>
                  <Button variant="ghost" size="sm" title="Volume tags" onClick={() => setVolumeTarget(e)}><BarChart3 className="h-3 w-3 text-primary" /></Button>
                  <Button variant="ghost" size="sm" title="Warm-up settings" onClick={() => setWarmupTarget(e)}><Flame className="h-3 w-3 text-orange-500" /></Button>
                  <Button variant="ghost" size="sm" onClick={() => del(e.id)}><Trash2 className="h-3 w-3" /></Button>
                </div>
              </div>
              <div>
                <Select
                  value={(e as any).primary_muscle_group ?? ""}
                  onValueChange={(v) => setPrimaryMuscle(e.id, v)}
                >
                  <SelectTrigger className="h-7 text-[11px]"><SelectValue placeholder="Set primary muscle…" /></SelectTrigger>
                  <SelectContent>
                    {PRIMARY_MUSCLE_GROUPS.map((m) => (
                      <SelectItem key={m} value={m}>{m}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex flex-wrap gap-1">
                {e.primary_movement_pattern ? (
                  <Badge variant="secondary" className="text-[10px]">
                    {(MOVEMENT_PATTERN_LABELS as any)[e.primary_movement_pattern] ?? e.primary_movement_pattern}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-amber-500/40 text-amber-600 dark:text-amber-400">
                    no pattern
                  </Badge>
                )}
                {e.variation_type && (
                  <Badge variant="outline" className="text-[10px]">
                    {(VARIATION_LABELS as any)[e.variation_type] ?? e.variation_type}
                    {e.volume_multiplier != null ? ` ×${Number(e.volume_multiplier)}` : ""}
                  </Badge>
                )}
                <Badge variant={e.video_provider === "vimeo" ? "default" : "secondary"} className="text-[10px]">
                  {e.video_provider ?? "—"}
                </Badge>
                <Badge variant="outline" className="text-[10px]">{e.video_migration_status ?? "—"}</Badge>
                {e.secondary_vimeo_embed_url ? (
                  <Badge
                    className={
                      (e.active_video_set === "secondary"
                        ? "bg-purple-600"
                        : "bg-slate-600") + " text-[10px]"
                    }
                    title="Video set active for this exercise"
                  >
                    {e.active_video_set === "secondary" ? "Secondary" : "Primary"}
                  </Badge>
                ) : (
                  <Badge variant="outline" className="text-[10px] border-dashed">
                    No Secondary
                  </Badge>
                )}
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
        {visibleCount < filtered.length && (
          <div ref={sentinelRef} className="h-10 w-full" aria-hidden="true" />
        )}
      </div>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <EditExerciseDialog
            exercise={editing}
            onClose={() => setEditing(null)}
            onSaved={() => void invalidateExerciseLibrary(qc)}
          />
        )}
      </Dialog>
      <ExerciseWarmupDialog
        exercise={warmupTarget}
        open={!!warmupTarget}
        onClose={() => setWarmupTarget(null)}
      />
      <Dialog open={!!volumeTarget} onOpenChange={(o) => !o && setVolumeTarget(null)}>
        {volumeTarget && (
          <ExerciseVolumeTagsDialog
            exercise={volumeTarget}
            onClose={() => setVolumeTarget(null)}
            onSaved={() => void invalidateExerciseLibrary(qc)}
          />
        )}
      </Dialog>
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
    secondary_vimeo_id: exercise.secondary_vimeo_id ?? "",
    secondary_vimeo_embed_url: exercise.secondary_vimeo_embed_url ?? "",
    active_video_set: (exercise.active_video_set ?? "primary") as "primary" | "secondary",
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

  const onSecondaryVimeoIdChange = (id: string) => {
    const trimmed = id.trim();
    setForm((f) => ({
      ...f,
      secondary_vimeo_id: trimmed,
      secondary_vimeo_embed_url: trimmed ? buildCleanVimeoEmbedUrl(trimmed) : "",
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
        <div className="space-y-3 rounded-md border border-primary/30 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <div className="text-xs font-bold uppercase tracking-widest text-primary">
              Secondary video (female / variant)
            </div>
            <label className="flex items-center gap-2 text-xs">
              Active set
              <Select
                value={form.active_video_set}
                onValueChange={(v) => setForm({ ...form, active_video_set: v as "primary" | "secondary" })}
              >
                <SelectTrigger className="h-8 w-32"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="primary">Primary</SelectItem>
                  <SelectItem value="secondary" disabled={!form.secondary_vimeo_embed_url}>Secondary</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          <div>
            <Label>Secondary Vimeo video ID</Label>
            <Input
              value={form.secondary_vimeo_id}
              onChange={(e) => onSecondaryVimeoIdChange(e.target.value)}
              placeholder="e.g. 987654321"
            />
          </div>
          <div>
            <Label>Secondary Vimeo embed URL (clean)</Label>
            <Input
              value={form.secondary_vimeo_embed_url}
              onChange={(e) => setForm({ ...form, secondary_vimeo_embed_url: e.target.value })}
            />
          </div>
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
  const coarsePointer = useIsCoarsePointer();
  const viewportHeight = useVisualViewportHeight();
  return (
    <DialogContent
      className="max-w-lg overflow-y-auto pb-[env(safe-area-inset-bottom)]"
      // Visual-viewport sizing keeps the form scrollable above the Android
      // keyboard; no auto-focus on touch so typing works on first tap.
      style={viewportHeight ? { maxHeight: Math.max(240, viewportHeight - 32) } : { maxHeight: "90dvh" }}
      onOpenAutoFocus={(e) => { if (coarsePointer) e.preventDefault(); }}
    >
      <DialogHeader><DialogTitle>New exercise</DialogTitle></DialogHeader>
      <ExerciseQuickCreateForm
        onCancel={onClose}
        onCreated={() => { onCreated(); onClose(); }}
      />
    </DialogContent>
  );
}
