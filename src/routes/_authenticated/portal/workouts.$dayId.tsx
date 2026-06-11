import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, CheckCircle2, Play, StickyNote, NotebookPen, Info, Lock } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getExerciseVideoSource } from "@/lib/exercise-video";
import { toast } from "sonner";
import { durationRange } from "@/lib/pl-programs";
import { movementAccent } from "@/components/program-builder";
import { listClientMaxes, buildMaxIndex, computeRowLoad } from "@/lib/pl-maxes";
import { useAutosave, readLocalDraft, clearLocalDraft } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { ActionButton } from "@/components/action-button";
import { TrainingHelpButton } from "@/components/training-help-sheet";
import { dayScheduledDate } from "@/lib/workout-today";
import { format, startOfDay } from "date-fns";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>) => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
  }),
  component: WorkoutDay,
});

const sb = supabase as any;

function WorkoutDay() {
  const { dayId } = Route.useParams();
  const search = Route.useSearch();
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

  // Resolve which block this day belongs to so block-scoped maxes apply.
  const { data: blockId = null } = useQuery({
    queryKey: ["pl-day-block", day?.week_id],
    enabled: !!day?.week_id,
    queryFn: async () => {
      const { data } = await sb.from("pl_weeks").select("block_id").eq("id", day.week_id).maybeSingle();
      return (data?.block_id as string | null) ?? null;
    },
  });

  // Resolve block + week for the outside-day notice and readonly auto-detection.
  const { data: week = null } = useQuery({
    queryKey: ["pl-week", day?.week_id],
    enabled: !!day?.week_id,
    queryFn: async () => (await sb.from("pl_weeks").select("*").eq("id", day.week_id).maybeSingle()).data,
  });
  const { data: block = null } = useQuery({
    queryKey: ["pl-block", blockId],
    enabled: !!blockId,
    queryFn: async () => (await sb.from("pl_blocks").select("*").eq("id", blockId).maybeSingle()).data,
  });

  const scheduledDate = useMemo(() => {
    if (!day) return null;
    return dayScheduledDate({ day, week, block, completion: null } as any);
  }, [day, week, block]);
  const today = startOfDay(new Date());
  const isOutsideScheduledDay = !!scheduledDate && scheduledDate.getTime() !== today.getTime();

  const blockEnded = block?.end_date ? new Date(block.end_date) < today : false;
  const blockCompleted = block?.status === "Completed" || block?.status === "Archived";
  const readonly = search.readonly === 1 || blockEnded || blockCompleted;

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

  // Exercise notes for this day
  const { data: exerciseNotes = [] } = useQuery({
    queryKey: ["pl-day-exercise-notes", dayId, client?.id],
    enabled: !!client?.id,
    queryFn: async () => (await sb.from("pl_exercise_notes").select("*").eq("client_id", client!.id).eq("day_id", dayId)).data ?? [],
  });
  const notesByRowId = useMemo(() => {
    const m = new Map<string, any>();
    for (const n of exerciseNotes as any[]) if (n.row_id) m.set(n.row_id, n);
    return m;
  }, [exerciseNotes]);

  // Auto-track: started_at on first mount (creates draft row if needed)
  const startedRef = useRef(false);
  useEffect(() => {
    if (!client?.id || startedRef.current) return;
    if (completion?.started_at) { startedRef.current = true; return; }
    startedRef.current = true;
    (async () => {
      const payload: any = { day_id: dayId, client_id: client.id, started_at: new Date().toISOString(), completed_at: null };
      if (completion) {
        if (!completion.started_at) await sb.from("pl_day_completions").update({ started_at: payload.started_at }).eq("id", completion.id);
      } else {
        await sb.from("pl_day_completions").insert(payload);
        qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
      }
    })();
  }, [client?.id, completion?.id, completion?.started_at, dayId, qc]);

  // Mark in_progress when any meaningful entry occurs
  const markInProgress = async () => {
    if (!client?.id) return;
    if (completion?.in_progress_at) return;
    const now = new Date().toISOString();
    if (completion) {
      await sb.from("pl_day_completions").update({ in_progress_at: now }).eq("id", completion.id);
    } else {
      await sb.from("pl_day_completions").insert({ day_id: dayId, client_id: client.id, in_progress_at: now, started_at: now, completed_at: null });
    }
    qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
  };

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
    markInProgress();
  };

  const refreshNotes = () => {
    qc.invalidateQueries({ queryKey: ["pl-day-exercise-notes", dayId] });
    qc.invalidateQueries({ queryKey: ["client-exercise-notes", client?.id] });
    markInProgress();
  };

  // Sticky general-notes shortcut: scroll to the bottom notes card and focus textarea
  const generalNotesRef = useRef<HTMLDivElement>(null);
  const focusGeneralNotes = () => {
    generalNotesRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => generalNotesRef.current?.querySelector("textarea")?.focus(), 350);
  };

  if (!day) return <div className="p-8 text-sm text-muted-foreground">Loading…</div>;

  return (
    <>
      <PageHeader
        backTo="/portal/workouts"
        backLabel="Back to Workouts"
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
          {readonly && <Badge variant="outline" className="border-muted-foreground/30 bg-muted/30 text-muted-foreground"><Lock className="mr-1 h-3 w-3" /> Read-only</Badge>}
          <div className="ml-auto"><SaveStatus state={metaSave.state} savedAt={metaSave.savedAt} /></div>
        </div>

        {!readonly && isOutsideScheduledDay && !completion?.completed_at && scheduledDate && (
          <Card className="flex items-start gap-2 border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>
              This workout is scheduled for <strong>{format(scheduledDate, "EEE MMM d")}</strong>,
              but you can still complete it today. Your scheduled day is saved.
            </div>
          </Card>
        )}

        {readonly && (
          <Card className="flex items-start gap-2 border-border bg-secondary/30 p-3 text-xs">
            <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div>Viewing a past workout. Logs are read-only.</div>
          </Card>
        )}

        {day.notes && <Card className="p-4 text-sm whitespace-pre-wrap bg-secondary/30">{day.notes}</Card>}

        <div className="space-y-3">
          {(rows as any[]).map((r) => (
            <ExerciseBlock
              key={r.id}
              row={r}
              dayId={dayId}
              dayTitle={day.title || `Day ${day.day_index}`}
              clientId={client?.id}
              blockId={blockId}
              existingResults={(results as any[]).filter((x) => x.row_id === r.id)}
              existingNote={notesByRowId.get(r.id)}
              readonly={readonly}
              onChange={refresh}
              onNoteChange={refreshNotes}
            />
          ))}
        </div>

        {!readonly && (
        <Card ref={generalNotesRef} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="text-sm font-bold">Workout Notes</div>
            <SaveStatus state={metaSave.state} savedAt={metaSave.savedAt} />
          </div>
          <Textarea
            value={notes}
            onChange={(e) => { setNotes(e.target.value); if (!completion?.in_progress_at) markInProgress(); }}
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
            <ActionButton
              loadingLabel="Saving…"
              successLabel="Complete"
              successToast="Workout marked complete"
              icon={<CheckCircle2 className="h-4 w-4" />}
              onAction={async () => {
                if (!client?.id) return;
                await metaSave.flush();
                const startedAt = completion?.started_at ?? new Date().toISOString();
                const completedAt = new Date().toISOString();
                const durationMin = actualMin
                  ? parseInt(actualMin)
                  : completion?.actual_duration_min ?? Math.max(1, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000));
                const payload = {
                  day_id: dayId,
                  client_id: client.id,
                  client_notes: notes.length > 0 ? notes : (completion?.client_notes ?? null),
                  actual_duration_min: durationMin,
                  started_at: startedAt,
                  completed_at: completedAt,
                  completion_method: "manual",
                };
                if (completion) await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                else await sb.from("pl_day_completions").insert(payload);
                if (draftKey) clearLocalDraft(draftKey);
                setNotes("");
                setActualMin("");
                refresh();
              }}
            >
              Mark Workout Complete
            </ActionButton>
          </div>
        </Card>
        )}

        {readonly && completion?.client_notes && (
          <Card className="p-4 space-y-2">
            <div className="text-sm font-bold">Workout Notes</div>
            <p className="whitespace-pre-wrap text-sm text-muted-foreground">{completion.client_notes}</p>
            {completion.actual_duration_min && (
              <div className="text-xs text-muted-foreground">Duration: {completion.actual_duration_min} min</div>
            )}
          </Card>
        )}
      </div>

      {/* Sticky general-notes shortcut */}
      {!readonly && (
      <div className="fixed bottom-4 right-4 z-30 md:bottom-6 md:right-6">
        <Button size="lg" variant="secondary" onClick={focusGeneralNotes} className="shadow-lg">
          <NotebookPen className="mr-2 h-4 w-4" /> Workout Notes
        </Button>
      </div>
      )}
    </>
  );
}

function ExerciseBlock({ row, dayId, dayTitle, clientId, blockId, existingResults, existingNote, readonly = false, onChange, onNoteChange }: { row: any; dayId: string; dayTitle: string; clientId: string | undefined; blockId?: string | null; existingResults: any[]; existingNote?: any; readonly?: boolean; onChange: () => void; onNoteChange: () => void }) {
  const name = row.exercises?.name ?? row.exercise_name_override ?? "Exercise";
  const exercise = row.exercises ?? null;
  const exerciseId = exercise?.id ?? null;
  const video = exercise?.video_url ?? exercise?.vimeo_embed_url ?? null;
  const hasGuide = Boolean(exerciseId || video);
  const cues = exercise?.cues ?? null;
  const setCount = Math.max(1, row.sets ?? 1);
  const accent = movementAccent(name);
  const [howToOpen, setHowToOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const hasNote = Boolean(existingNote?.id);

  const { data: maxes = [] } = useQuery({
    queryKey: ["pl-client-maxes", clientId, blockId ?? null],
    enabled: !!clientId && !!row.percentage && row.percentage_basis !== "manual",
    queryFn: () => listClientMaxes(clientId as string, blockId ?? null),
  });
  const computed = useMemo(() => {
    if (!row.percentage || !row.percentage_basis || row.percentage_basis === "manual") return null;
    return computeRowLoad({
      exerciseName: name,
      basis: row.percentage_basis,
      percentage: Number(row.percentage),
      manualLoadKg: row.load_kg ? Number(row.load_kg) : null,
      manualLoadLb: row.load_lb ? Number(row.load_lb) : null,
      unit: "kg",
      maxesIndex: buildMaxIndex(maxes),
    });
  }, [row.percentage, row.percentage_basis, row.load_kg, row.load_lb, name, maxes]);

  return (
    <Card className="relative overflow-hidden p-4 pl-5">
      <div className={`absolute left-0 top-0 h-full w-1.5 ${accent}`} aria-hidden />
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <div className="font-bold">{name}</div>
            {hasNote && (
              <span title="You saved a note for this exercise" className="inline-flex items-center gap-1 rounded-full bg-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                <StickyNote className="h-2.5 w-2.5" /> Note
              </span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            {row.sets ?? "?"} × {row.reps_text ?? "?"}
            {row.rpe && ` @ RPE ${row.rpe}`}
            {row.rir && ` · ${row.rir} RIR`}
            {row.percentage && !row.manual_override && row.percentage_basis !== "none" && ` · ${row.percentage}%`}
            {row.load_kg && ` · ${row.load_kg} kg`}
            {row.tempo && ` · tempo ${row.tempo}`}
            {row.rest_seconds && ` · rest ${row.rest_seconds}s`}
          </div>
          {row.manual_override && (row.load_kg || row.load_lb) && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              Target load: {row.load_kg ?? row.load_lb} {row.load_kg ? "kg" : "lb"}
            </div>
          )}
          {!row.manual_override && computed && computed.status === "ok" && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-xs font-bold text-primary">
              Target load: {computed.load} {computed.unit}
            </div>
          )}
          {row.percentage_basis === "none" && (
            <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
              Log the load used
            </div>
          )}
          {row.notes && <p className="mt-1 text-xs text-muted-foreground italic">{row.notes}</p>}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          {hasGuide && (
            <Button size="sm" variant="outline" onClick={() => setHowToOpen(true)} className="w-full">
              <Play className="mr-1 h-3 w-3 fill-current" /> How To
            </Button>
          )}
          <Button size="sm" variant={hasNote ? "default" : "outline"} onClick={() => setNotesOpen(true)} className="w-full">
            <StickyNote className="mr-1 h-3 w-3" /> Notes
          </Button>
          <TrainingHelpButton size="sm" variant="ghost" className="w-full" />
        </div>
      </div>

      {cues && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground border-l-2 border-border pl-2">
          {typeof cues === "string" ? cues : Array.isArray(cues) ? cues.join(" · ") : null}
        </p>
      )}

      <div className="mt-3 space-y-2">
        {Array.from({ length: setCount }).map((_, i) => {
          const existing = existingResults.find((x) => x.set_index === i + 1);
          return <SetRow key={i} rowId={row.id} clientId={clientId} setIndex={i + 1} existing={existing} targetReps={row.reps_text} targetRpe={row.rpe} readonly={readonly} onChange={onChange} />;
        })}
      </div>
      <HowToSheet open={howToOpen} onOpenChange={setHowToOpen} exercise={exercise} fallbackName={name} fallbackVideo={video} />
      <ExerciseNotesSheet
        open={notesOpen}
        onOpenChange={setNotesOpen}
        clientId={clientId}
        dayId={dayId}
        dayTitle={dayTitle}
        rowId={row.id}
        exerciseId={exerciseId}
        exerciseName={name}
        existingNote={existingNote}
        onSaved={onNoteChange}
      />
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
  // Always try fallbacks if primary source is not ready
  const directVideo = fallbackVideo || exercise?.youtube_url || null;
  const hasPrimary = videoSrc && videoSrc.status !== "coming_soon" && !!videoSrc.url;

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
          {hasPrimary ? (
            <iframe
              src={videoSrc!.url!}
              title={`${name} video`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
              allowFullScreen
              className="w-full aspect-video rounded-xl border border-border bg-black"
            />
          ) : directVideo ? (
            <iframe
              src={toEmbedUrl(directVideo)}
              title={`${name} video`}
              allow="autoplay; fullscreen; picture-in-picture; encrypted-media"
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

function toEmbedUrl(url: string): string {
  // Convert common YouTube watch URLs to embed form so iframe can play on mobile
  try {
    const u = new URL(url);
    if (u.hostname.includes("youtube.com") && u.pathname === "/watch") {
      const id = u.searchParams.get("v");
      if (id) return `https://www.youtube.com/embed/${id}?playsinline=1`;
    }
    if (u.hostname === "youtu.be") {
      const id = u.pathname.replace("/", "");
      if (id) return `https://www.youtube.com/embed/${id}?playsinline=1`;
    }
    if (u.hostname.includes("vimeo.com") && !u.hostname.includes("player.")) {
      const id = u.pathname.replace("/", "");
      if (id) return `https://player.vimeo.com/video/${id}`;
    }
  } catch {}
  return url;
}

function ExerciseNotesSheet({ open, onOpenChange, clientId, dayId, dayTitle, rowId, exerciseId, exerciseName, existingNote, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string | undefined;
  dayId: string;
  dayTitle: string;
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  existingNote?: any;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(existingNote?.content ?? "");
  useEffect(() => { setDraft(existingNote?.content ?? ""); }, [existingNote?.id, existingNote?.content, open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88vh] overflow-y-auto p-0 sm:max-w-xl sm:mx-auto sm:rounded-t-2xl">
        <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-5 py-3 text-left">
          <SheetTitle className="text-base font-black">{exerciseName}</SheetTitle>
          <SheetDescription className="text-xs">{dayTitle} · Exercise notes</SheetDescription>
        </SheetHeader>
        <div className="px-5 py-4 space-y-4 pb-32">
          <div>
            <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Your note</label>
            <Textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={6}
              placeholder="How did this exercise feel? Form cues, pain, PRs, equipment notes…"
              className="mt-1"
            />
          </div>
          {existingNote && (
            <section className="rounded-md border border-border bg-secondary/30 p-3">
              <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                <StickyNote className="h-3 w-3" />
                <span>Last saved</span>
                <span>·</span>
                <span>{new Date(existingNote.updated_at).toLocaleString()}</span>
                {existingNote.status === "edited" && <Badge variant="outline" className="ml-auto text-[10px]">Edited</Badge>}
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{existingNote.content}</p>
            </section>
          )}
        </div>
        <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur px-5 py-3 space-y-2">
          <ActionButton
            className="w-full"
            size="lg"
            loadingLabel="Saving…"
            successLabel="Saved"
            successToast={existingNote ? "Note updated" : "Note saved"}
            disabled={!clientId || draft.trim().length === 0}
            onAction={async () => {
              if (!clientId) return;
              const trimmed = draft.trim();
              if (!trimmed) throw new Error("Note is empty");
              if (existingNote) {
                const { error } = await sb.from("pl_exercise_notes").update({
                  content: trimmed,
                  status: "edited",
                  coach_seen_at: null,
                }).eq("id", existingNote.id);
                if (error) throw error;
              } else {
                const { error } = await sb.from("pl_exercise_notes").insert({
                  client_id: clientId,
                  day_id: dayId,
                  row_id: rowId,
                  exercise_id: exerciseId,
                  exercise_name: exerciseName,
                  content: trimmed,
                  status: "new",
                });
                if (error) throw error;
              }
              onSaved();
            }}
          >
            <StickyNote className="mr-2 h-4 w-4" /> Save Note
          </ActionButton>
          <Button variant="outline" className="w-full" size="lg" onClick={() => onOpenChange(false)}>
            <ArrowLeft className="mr-2 h-4 w-4" /> Back to Workout
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function SetRow({ rowId, clientId, setIndex, existing, targetReps, targetRpe, readonly = false, onChange }: { rowId: string; clientId: string | undefined; setIndex: number; existing?: any; targetReps?: string | null; targetRpe?: string | null; readonly?: boolean; onChange: () => void }) {
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
    enabled: !readonly && !!clientId && hydrated && (load.length > 0 || reps.length > 0 || rpe.length > 0 || !!existing),
    onSave: async ({ load, reps, rpe }) => {
      if (readonly) return;
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
      <Input className="h-9 w-20" inputMode="decimal" placeholder="kg" value={load} onChange={(e) => setLoad(e.target.value)} onBlur={() => save.flush()} readOnly={readonly} disabled={readonly} />
      <Input className="h-9 w-16" inputMode="numeric" placeholder={targetReps || "reps"} value={reps} onChange={(e) => setReps(e.target.value)} onBlur={() => save.flush()} readOnly={readonly} disabled={readonly} />
      <Input className="h-9 w-16" inputMode="decimal" placeholder={targetRpe ? `@${targetRpe}` : "RPE"} value={rpe} onChange={(e) => setRpe(e.target.value)} onBlur={() => save.flush()} readOnly={readonly} disabled={readonly} />
      {!readonly && <SaveStatus state={save.state} savedAt={save.savedAt} compact className="ml-1" />}
      {existing?.completed_at && <CheckCircle2 className="h-4 w-4 text-green-500" />}
    </div>
  );
}