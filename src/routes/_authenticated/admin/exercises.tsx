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
import { Plus, Search, Trash2, Youtube, Pencil, CheckCircle2, AlertTriangle, Flame, BarChart3, MoreVertical, Archive, RotateCcw, CalendarClock } from "lucide-react";
import { invalidateExerciseLibrary, upsertExerciseInLibraryCaches, reconcileExerciseLibraryChange } from "@/lib/exercise-library-cache";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ARCHIVE_SCOPES,
  EXERCISE_SORTS,
  filterByArchiveScope,
  sortExercises,
  formatAddedDate,
  formatAddedDateTime,
  describeReferences,
  type ArchiveScope,
  type ExerciseSort,
} from "@/lib/exercise-admin";
import {
  setExerciseArchived,
  deleteExercisePermanently,
  getExerciseReferenceCounts,
} from "@/lib/exercise-admin.functions";
import { useServerFn } from "@tanstack/react-start";
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
import { ExerciseLibraryControlCenter } from "@/components/exercises/library/exercise-library-control-center";
import { useAuth } from "@/lib/auth";

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
  const { role } = useAuth();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);

  const { data: exercises = [] } = useQuery({
    queryKey: ["exercises"],
    // This library is an operational authoring surface. A new exercise must
    // become searchable after a reload, a tab switch, or a reconnect; never
    // let a hydrated snapshot mask a database row that was successfully saved.
    staleTime: 0,
    refetchOnMount: "always",
    // While the quick-create dialog is open, a focus refetch would re-render
    // the whole library underneath it (iOS fires focus events when the soft
    // keyboard opens). Pause it until the dialog closes.
    refetchOnWindowFocus: !open,

    refetchOnReconnect: "always",
    queryFn: fetchExerciseLibrary,
  });

  const archiveFn = useServerFn(setExerciseArchived);
  const deleteFn = useServerFn(deleteExercisePermanently);
  const referencesFn = useServerFn(getExerciseReferenceCounts);
  const [busyId, setBusyId] = useState<string | null>(null);

  /**
   * Archive is the safe removal path: history, PRs and analytics keep their
   * exercise link, but no picker offers it any more.
   */
  const toggleArchived = async (row: any, archived: boolean) => {
    setBusyId(row.id);
    try {
      const updated: any = await archiveFn({ data: { exerciseId: row.id, archived } });
      reconcileExerciseLibraryChange(qc, {
        eventType: "UPDATE",
        newRow: updated ?? { ...row, archived },
        oldRow: { id: row.id },
      });
      toast.success(archived ? `Archived ${row.name}` : `Restored ${row.name}`);
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update this exercise");
    } finally {
      setBusyId(null);
    }
  };

  /**
   * Permanent delete is only offered when nothing references the exercise.
   * Several foreign keys are ON DELETE SET NULL, so an unguarded delete would
   * silently detach logged sets and program rows from their exercise.
   */
  const del = async (row: any) => {
    setBusyId(row.id);
    try {
      const refs: any = await referencesFn({ data: { exerciseId: row.id } });
      if (!refs?.safeToDelete) {
        toast.error("Used in training history — archive it instead", {
          description: describeReferences(refs?.counts ?? {}),
        });
        return;
      }
      if (!confirm(`Permanently delete “${row.name}”? This cannot be undone.`)) return;
      await deleteFn({ data: { exerciseId: row.id } });
      reconcileExerciseLibraryChange(qc, { eventType: "DELETE", newRow: null, oldRow: { id: row.id } });
      toast.success("Exercise deleted");
    } catch (err: any) {
      toast.error(err?.message ?? "Could not delete this exercise");
    } finally {
      setBusyId(null);
    }
  };

  const [warmupTarget, setWarmupTarget] = useState<any | null>(null);
  const [volumeTarget, setVolumeTarget] = useState<any | null>(null);

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
      {!embedded && <PageHeader title="Exercise Library" subtitle="Family → canonical exercise → aliases." />}
      <Dialog open={open} onOpenChange={setOpen}>
        <NewExerciseDialog onClose={() => setOpen(false)} onCreated={() => { void invalidateExerciseLibrary(qc); qc.invalidateQueries({ queryKey: ["exercise-aliases"] }); }} />
      </Dialog>

      <ExerciseLibraryControlCenter
        exercises={exercises as any[]}
        isAdmin={role === "admin"}
        actions={{
          onAdd: () => setOpen(true),
          onEditVideo: (e) => setEditing(e),
          onWarmups: (e) => setWarmupTarget(e),
          onVolumeTags: (e) => setVolumeTarget(e),
          onArchive: (e, archived) => void toggleArchived(e, archived),
          onDelete: (e) => void del(e),
          busyId,
        }}
      />

      <details className="mx-3 mb-6 rounded-xl border border-border bg-card p-3 text-sm sm:mx-6 md:mx-8">
        <summary className="cursor-pointer text-xs font-bold uppercase tracking-widest text-muted-foreground">Library settings</summary>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <div className="text-xs font-semibold">Global video set</div>
          <Select value={globalSet ?? "none"} onValueChange={onChangeGlobal}>
            <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Per-exercise (default)</SelectItem>
              <SelectItem value="primary">Force Primary (all)</SelectItem>
              <SelectItem value="secondary">Force Secondary (all)</SelectItem>
            </SelectContent>
          </Select>
          <div className="text-[11px] text-muted-foreground">One-click swap for the entire library. Overrides each exercise's own setting.</div>
        </div>
      </details>

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
        librarySetup
        onCancel={onClose}
        onCreated={() => { onCreated(); onClose(); }}
      />
    </DialogContent>
  );
}
