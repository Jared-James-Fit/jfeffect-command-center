import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, CheckCircle2, Play } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getExerciseVideoSource } from "@/lib/exercise-video";
import { toast } from "sonner";
import { durationRange } from "@/lib/pl-programs";
import { movementAccent } from "@/components/program-builder";
import { useAutosave, readLocalDraft, clearLocalDraft } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({ component: WorkoutDay });

const sb = supabase as any;

function WorkoutDay() {
  const { dayId } = Route.useParams();
  const portalUserId = usePortalUserId();
  const qc = useQueryClient();

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: day } = useQuery({
    queryKey: ["pl-day", dayId],
    queryFn: async () => (await sb.from("pl_days").select("*").eq("id", dayId).maybeSingle()).data,
  });

  const { data: rows = [] } = useQuery({
    queryKey: ["pl-day-rows", dayId],
    queryFn: async () => (await sb.from("pl_exercise_rows").select("*, exercises(id,name,video_url,vimeo_embed_url,thumbnail_url,cues,common_mistakes,muscle_group,category)").eq("day_id", dayId).order("sort_order")).data ?? [],
  });

  useEffect(() => {
    if (rows.length === 0) {
      toast.info("This workout is empty — no exercises have been added yet.");
    }
  }, [rows.length]);

  const { data: results = [] } = useQuery({
    queryKey: ["pl-day-results", dayId, client?.id],
    enabled: !!client?.id && (rows as any[]).length > 0,
    queryFn: async () => {
      const rowIds = (rows as any[]).map((r) => r.id);
      if (!rowIds.length) return [];
      return (await sb.from("pl_row_results").select("*").in("row_id", rowIds).eq("client_id", client!.id)).data ?? [];
    },
  });

  const { data: completion } = useQuery({
    queryKey: ["pl-day-completion", dayId, client?.id],
    enabled: !!client?.id,
    queryFn: async () => (await sb.from("pl_day_completions").select("*").eq("day_id", dayId).eq("client_id", client!.id).maybeSingle()).data,
  });

  const [notes, setNotes] = useState("");
  const [actualMin, setActualMin] = useState<string>("");

  // Restore any unsynced draft for this workout's notes/duration before render.
  const draftKey = client?.id ? `workout:${dayId}:${client.id}:meta` : null;
  const [draftHydrated, setDraftHydrated] = useState(false);
  useEffect(() => {
    if (!draftKey || draftHydrated) return;
    const draft = readLocalDraft<{ notes: string; actualMin: string }>(draftKey);
    if (draft?.value) {
      if (draft.value.notes) setNotes(draft.value.notes);
      if (draft.value.actualMin) setActualMin(draft.value.actualMin);
      toast.info("Restored unsaved workout notes");
    }
    setDraftHydrated(true);
  }, [draftKey, draftHydrated]);

  // Autosave workout-level notes + actual minutes into pl_day_completions (draft state — does NOT set completed_at).
  const metaSave = useAutosave({
    key: draftKey,
    value: { notes, actualMin },
    delay: 1000,
    enabled: !!client?.id && draftHydrated && (notes.length > 0 || actualMin.length > 0),
    onSave: async ({ notes, actualMin }) => {
      if (!client?.id) return;
      const patch: any = {
        day_id: dayId,
        client_id: client.id,
        client_notes: notes || null,
        actual_duration_min: actualMin ? parseInt(actualMin) : null,
      };
      if (completion) {
        const { error } = await sb.from("pl_day_completions").update(patch).eq("id", completion.id);
        if (error) throw error;
      } else {
        // Draft row — no completed_at. Mark Complete button sets it explicitly.
        const { error } = await sb.from("pl_day_completions").insert({ ...patch, completed_at: null });
        if (error) throw error;
        qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
      }
    },
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pl-day-results", dayId] });
    qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
  };

  if (!day) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <>
      <PageHeader
        backTo="/portal/program"
        backLabel="Back to Program"
        title={day.title || `Day ${day.day_index}`}
        subtitle={day.focus ?? ""}
      />
      <div className="p-4 md:p-8 space-y-4">
        <Link to="/portal/workouts" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> All workouts
        </Link>

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline"><Clock className="mr-1 h-3 w-3" /> {durationRange(day.duration_override_min ?? day.duration_estimate_min ?? 60)}</Badge>
          {completion && <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>}
          <div className="ml-auto"><SaveStatus state={metaSave.state} savedAt={metaSave.savedAt} /></div>
        </div>

        {day.notes && <Card className="p-4 text-sm whitespace-pre-wrap bg-secondary/30">{day.notes}</Card>}

        <div className="space-y-3">
          {(rows as any[]).map((r) => (
            <ExerciseBlock key={r.id} row={r} clientId={client?.id} existingResults={(results as any[]).filter((x) => x.row_id === r.id)} onChange={refresh} />
          ))}
        </div>

        <Card className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">Workout Notes</div>
            <SaveStatus state={metaSave.state} savedAt={metaSave.savedAt} />
          </div>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={completion?.client_notes || "How did it feel? Any pain, PRs, surprises?"}
          />
          <div className="flex items-center gap-2">
            <Input
              type="number"
              inputMode="numeric"
              className="w-32"
              placeholder={completion?.actual_duration_min ? `${completion.actual_duration_min} min` : "Actual min"}
              value={actualMin}
              onChange={(e) => setActualMin(e.target.value)}
            />
            <Button onClick={async () => {
              if (!client?.id) return;
              try {
                await metaSave.flush();
                const payload = {
                  day_id: dayId,
                  client_id: client.id,
                  client_notes: notes.length > 0 ? notes : (completion?.client_notes ?? null),
                  actual_duration_min: actualMin ? parseInt(actualMin) : (completion?.actual_duration_min ?? null),
                  completed_at: new Date().toISOString(),
                };
                if (completion) await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                else await sb.from("pl_day_completions").insert(payload);
                toast.success("Workout marked complete");
                if (draftKey) clearLocalDraft(draftKey);
                setNotes("");
                setActualMin("");
                refresh();
              } catch (e: any) { toast.error(e.message); }
            }}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Mark Workout Complete
            </Button>
          </div>
        </Card>
      </div>
    </>
  );
}

function ExerciseBlock({ row, clientId, existingResults, onChange }: { row: any; clientId: string | undefined; existingResults: any[]; onChange: () => void }) {
  const name = row.exercises?.name ?? row.exercise_name_override ?? "Exercise";
  const exercise = row.exercises ?? null;
  const exerciseId = exercise?.id ?? null;
  const video = exercise?.video_url ?? exercise?.vimeo_embed_url ?? null;
  const hasGuide = Boolean(exerciseId || video);
  const cues = exercise?.cues ?? null;
  const setCount = Math.max(1, row.sets ?? 1);
  const accent = movementAccent(name);
  const [howToOpen, setHowToOpen] = useState(false);

  return (
    <Card className="relative overflow-hidden p-4 pl-5">
      <div className={`absolute left-0 top-0 h-full w-1.5 ${accent}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-bold">{name}</div>
          <div className="text-xs text-muted-foreground">
            {row.sets ?? "?"} × {row.reps_text ?? "?"}
            {row.rpe && ` @ RPE ${row.rpe}`}
            {row.rir && ` · ${row.rir} RIR`}
            {row.percentage && ` · ${row.percentage}%`}
            {row.load_kg && ` · ${row.load_kg} kg`}
            {row.tempo && ` · tempo ${row.tempo}`}
            {row.rest_seconds && ` · rest ${row.rest_seconds}s`}
          </div>
          {row.notes && <p className="mt-1 text-xs text-muted-foreground italic">{row.notes}</p>}
        </div>
        {hasGuide && (
          <Button size="sm" variant="outline" onClick={() => setHowToOpen(true)} className="shrink-0">
            <Play className="mr-1 h-3 w-3 fill-current" /> How To
          </Button>
        )}
      </div>

      {cues && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground border-l-2 border-border pl-2">
          {typeof cues === "string" ? cues : Array.isArray(cues) ? cues.join(" · ") : null}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {Array.from({ length: setCount }).map((_, i) => {
          const existing = existingResults.find((x) => x.set_index === i + 1);
          return <SetRow key={i} rowId={row.id} clientId={clientId} setIndex={i + 1} existing={existing} targetReps={row.reps_text} targetRpe={row.rpe} onChange={onChange} />;
        })}
      </div>
      <HowToSheet open={howToOpen} onOpenChange={setHowToOpen} exercise={exercise} fallbackName={name} fallbackVideo={video} />
    </Card>
  );
}

function HowToSheet({ open, onOpenChange, exercise, fallbackName, fallbackVideo }: { open: boolean; onOpenChange: (v: boolean) => void; exercise: any; fallbackName: string; fallbackVideo: string | null }) {
  const name = exercise?.name ?? fallbackName;
  const cues = exercise?.cues ?? null;
  const mistakes = exercise?.common_mistakes ?? null;
  const muscles = exercise?.muscle_group ?? null;
  const category = exercise?.category ?? null;
  const videoSrc = exercise ? getExerciseVideoSource(exercise) : null;
  const directVideo = !videoSrc && fallbackVideo ? fallbackVideo : null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[92vh] overflow-y-auto p-0 sm:max-w-xl sm:mx-auto sm:rounded-t-2xl">
        <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-5 py-3 text-left">
          <SheetTitle className="text-base font-black">{name}</SheetTitle>
          {(category || muscles) && (
            <SheetDescription className="text-xs">
              {[category, muscles].filter(Boolean).join(" · ")}
            </SheetDescription>
          )}
        </SheetHeader>
        <div className="px-5 py-4 space-y-4 pb-32">
          {videoSrc?.status === "ok" ? (
            <iframe
              src={videoSrc.url}
              title={`${name} video`}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              className="w-full aspect-video rounded-xl border border-border bg-black"
            />
          ) : directVideo ? (
            <iframe
              src={directVideo}
              title={`${name} video`}
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              className="w-full aspect-video rounded-xl border border-border bg-black"
            />
          ) : (
            <div className="grid aspect-video w-full place-items-center rounded-xl border border-dashed border-border bg-black/40 text-sm text-muted-foreground">
              Video coming soon.
            </div>
          )}

          {cues && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Coaching cues</h3>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {typeof cues === "string" ? cues : Array.isArray(cues) ? cues.join("\n• ") : null}
              </p>
            </section>
          )}

          {mistakes && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Common mistakes</h3>
              <p className="mt-1 text-sm whitespace-pre-wrap">
                {typeof mistakes === "string" ? mistakes : Array.isArray(mistakes) ? mistakes.join("\n• ") : null}
              </p>
            </section>
          )}

          {muscles && (
            <section>
              <h3 className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Muscles worked</h3>
              <p className="mt-1 text-sm">{muscles}</p>
            </section>
          )}
        </div>
        <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur px-5 py-3">
          <Button className="w-full" size="lg" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Workout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SetRow({ rowId, clientId, setIndex, existing, targetReps, targetRpe, onChange }: { rowId: string; clientId: string | undefined; setIndex: number; existing?: any; targetReps?: string | null; targetRpe?: string | null; onChange: () => void }) {
  const [load, setLoad] = useState(existing?.actual_load?.toString() ?? "");
  const [reps, setReps] = useState(existing?.actual_reps?.toString() ?? "");
  const [rpe, setRpe] = useState(existing?.actual_rpe ?? "");
  // Hydrate from any unsynced local draft on first mount for this set
  const draftKey = clientId ? `workout-set:${rowId}:${clientId}:${setIndex}` : null;
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    if (!draftKey || hydrated) return;
    const d = readLocalDraft<{ load: string; reps: string; rpe: string }>(draftKey);
    if (d?.value && (d.value.load || d.value.reps || d.value.rpe)) {
      // Only restore draft if server has nothing for this set yet
      if (!existing) {
        setLoad(d.value.load);
        setReps(d.value.reps);
        setRpe(d.value.rpe);
      }
    }
    setHydrated(true);
  }, [draftKey, hydrated, existing]);

  // Reset from server when the persisted result changes (but never while typing)
  useEffect(() => {
    setLoad(existing?.actual_load?.toString() ?? "");
    setReps(existing?.actual_reps?.toString() ?? "");
    setRpe(existing?.actual_rpe ?? "");
  }, [existing?.id, existing?.actual_load, existing?.actual_reps, existing?.actual_rpe]);

  const value = useMemo(() => ({ load, reps, rpe }), [load, reps, rpe]);
  const save = useAutosave({
    key: draftKey,
    value,
    delay: 800,
    enabled: !!clientId && hydrated && (load.length > 0 || reps.length > 0 || rpe.length > 0 || !!existing),
    onSave: async ({ load, reps, rpe }) => {
      if (!clientId) return;
      if (!load && !reps && !rpe && !existing) return;
      const payload = {
        row_id: rowId,
        client_id: clientId,
        set_index: setIndex,
        actual_load: load ? parseFloat(load) : null,
        actual_reps: reps ? parseInt(reps) : null,
        actual_rpe: rpe || null,
        completed_at: new Date().toISOString(),
      };
      if (existing) {
        const { error } = await sb.from("pl_row_results").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("pl_row_results").insert(payload);
        if (error) throw error;
      }
      onChange();
    },
  });

  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-10 font-mono text-muted-foreground">Set {setIndex}</span>
      <Input className="h-9 w-20" inputMode="decimal" placeholder="kg" value={load} onChange={(e) => setLoad(e.target.value)} onBlur={() => save.flush()} />
      <Input className="h-9 w-16" inputMode="numeric" placeholder={targetReps || "reps"} value={reps} onChange={(e) => setReps(e.target.value)} onBlur={() => save.flush()} />
      <Input className="h-9 w-16" inputMode="decimal" placeholder={targetRpe ? `@${targetRpe}` : "RPE"} value={rpe} onChange={(e) => setRpe(e.target.value)} onBlur={() => save.flush()} />
      <SaveStatus state={save.state} savedAt={save.savedAt} compact className="ml-1" />
      {existing?.completed_at && <CheckCircle2 className="h-4 w-4 text-green-500" />}
    </div>
  );
}