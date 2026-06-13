import { createFileRoute, Link } from "@tanstack/react-router";
import { Component, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, CheckCircle2, Play, StickyNote, NotebookPen, Info, Lock, Maximize2, Minimize2, AlertTriangle, RefreshCw, Send, MessageCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getExerciseVideoSource } from "@/lib/exercise-video";
import { toast } from "sonner";
import { durationRange } from "@/lib/pl-programs";
import { exerciseAccent } from "@/components/program-builder";
import {
  derivePurposeLabels,
  effectiveRestSeconds,
  resolveCategory,
  type ExerciseMeta,
} from "@/lib/exercise-metadata";
import { listClientMaxes, buildMaxIndex, computeRowLoad } from "@/lib/pl-maxes";
import { useAutosave, readLocalDraft, clearLocalDraft } from "@/hooks/use-autosave";
import { SaveStatus } from "@/components/save-status";
import { ActionButton } from "@/components/action-button";
import { TrainingHelpButton } from "@/components/training-help-sheet";
import { WarmupButton } from "@/components/warmup-sheet";
import { dayScheduledDate } from "@/lib/workout-today";
import { format, startOfDay } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { notifyCoachOfWorkoutFailure } from "@/lib/support-alerts.functions";
import { runJob } from "@/lib/progress-jobs";
import { cn } from "@/lib/utils";
import { WorkoutEmptyCard } from "@/components/workout-empty-state";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { writeSetEditAudit } from "@/lib/logged-set-audit";
import { resolveExerciseUnit, modeUnit, saveExerciseUnitPref, saveExerciseUnitPrefsBulk, type WUnit } from "@/lib/exercise-unit-prefs";
import { WorkoutUndoProvider, useWorkoutUndo, UndoButton } from "@/lib/workout-undo";
import { WorkoutSyncBanner } from "@/components/workout-sync-banner";
import { writePlanCache, cachedInitialData } from "@/lib/workout-plan-cache";
import { enqueueOfflineWrite, registerQueueHandler } from "@/lib/workout-offline-queue";
import { ActiveRestTimerProvider, useRestTimer } from "@/components/active-rest-timer";
import { ExerciseHistoryButton } from "@/components/exercise-history-sheet";

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>) => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
  }),
  component: () => (
    <WorkoutUndoProvider>
      <ActiveRestTimerProvider>
        <WorkoutDay />
      </ActiveRestTimerProvider>
    </WorkoutUndoProvider>
  ),
});

const sb = supabase as any;

function WorkoutDay() {
  const { dayId } = Route.useParams();
  const search = Route.useSearch();
  const portalUserId = usePortalUserId();
  const qc = useQueryClient();
  const undo = useWorkoutUndo();
  const cacheScope = `portal:${dayId}`;

  // Register a passthrough handler so any autosave that hits its
  // permanent-failure threshold can hand the write to the durable queue.
  // The queue retries on its own schedule and escalates to coaches after 3
  // more attempts. Handler is idempotent: payload describes table + row.
  useEffect(() => {
    registerQueueHandler("portal_table_upsert", async (p: any) => {
      if (!p?.table) return;
      if (p.id) {
        const { error } = await sb.from(p.table).update(p.payload).eq("id", p.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from(p.table).insert(p.payload);
        if (error) throw error;
      }
    });
  }, []);

  const { data: client } = useQuery({
    queryKey: ["my-client", portalUserId],
    enabled: !!portalUserId,
    queryFn: async () => (await supabase.from("clients").select("id, full_name, preferred_weight_unit").eq("user_id", portalUserId!).maybeSingle()).data,
  });

  const { data: day } = useQuery({
    queryKey: ["pl-day", dayId],
    initialData: cachedInitialData<any>(cacheScope, "day"),
    queryFn: async () => {
      const d = (await sb.from("pl_days").select("*").eq("id", dayId).maybeSingle()).data;
      if (d) writePlanCache(cacheScope, "day", d);
      return d;
    },
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

  const { data: rows = [], isSuccess: rowsLoaded } = useQuery({
    queryKey: ["pl-day-rows", dayId],
    initialData: cachedInitialData<any[]>(cacheScope, "rows"),
    queryFn: async () => {
      const r = (await sb.from("pl_exercise_rows").select("*, exercises(id,name,video_url,vimeo_embed_url,thumbnail_url,cues,common_mistakes,muscle_group,category,pl_lift_group,warmup_protocol_id,is_powerlifting,warmup_notes,default_load_unit,exercise_category,is_competition_lift,competition_lift_type)").eq("day_id", dayId).order("sort_order")).data ?? [];
      writePlanCache(cacheScope, "rows", r);
      return r;
    },
  });

  useEffect(() => {
    // Empty state is now rendered inline (see WorkoutEmptyCard below) so we
    // no longer fire the misleading "empty workout" toast — that read like a
    // crash to clients. Failed loads are still caught by WorkoutLoadBoundary.
  }, [rowsLoaded, rows.length]);

  const { data: results = [] } = useQuery({
    queryKey: ["pl-day-results", dayId, client?.id],
    enabled: !!client?.id && (rows as any[]).length > 0,
    initialData: client?.id ? cachedInitialData<any[]>(cacheScope, `results:${client.id}`) : undefined,
    queryFn: async () => {
      const rowIds = (rows as any[]).map((r) => r.id);
      if (!rowIds.length) return [];
      const r = (await sb.from("pl_row_results").select("*").in("row_id", rowIds).eq("client_id", client!.id)).data ?? [];
      writePlanCache(cacheScope, `results:${client!.id}`, r);
      return r;
    },
  });

  const { data: completion } = useQuery({
    queryKey: ["pl-day-completion", dayId, client?.id],
    enabled: !!client?.id,
    initialData: client?.id ? cachedInitialData<any>(cacheScope, `completion:${client.id}`) : undefined,
    queryFn: async () => {
      const c = (await sb.from("pl_day_completions").select("*").eq("day_id", dayId).eq("client_id", client!.id).maybeSingle()).data;
      writePlanCache(cacheScope, `completion:${client!.id}`, c);
      return c;
    },
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

  // Derive ordered purpose labels (Primary/Secondary/.../Assistance) for the day.
  const purposeLabels = useMemo(
    () => derivePurposeLabels(rows as any[], (r: any) => (r.exercises as ExerciseMeta | null) ?? null),
    [rows],
  );
  const purposeLabelById = useMemo(() => {
    const m = new Map<string, string>();
    (rows as any[]).forEach((r, i) => m.set(r.id, purposeLabels[i]));
    return m;
  }, [rows, purposeLabels]);

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

  // Weight unit preference: client choice persists to clients.preferred_weight_unit.
  // Falls back to the builder's load_kg/load_lb shape (kg if any row has load_kg).
  const builderDefaultUnit: "kg" | "lb" = useMemo(() => {
    const r = (rows as any[]).find((x) => x.load_kg || x.load_lb);
    if (r?.load_lb && !r?.load_kg) return "lb";
    return "kg";
  }, [rows]);
  const [unit, setUnit] = useState<"kg" | "lb">("kg");
  const [unitHydrated, setUnitHydrated] = useState(false);
  useEffect(() => {
    if (unitHydrated) return;
    const pref = (client as any)?.preferred_weight_unit as "kg" | "lb" | undefined;
    setUnit(pref ?? builderDefaultUnit);
    setUnitHydrated(true);
  }, [client, builderDefaultUnit, unitHydrated]);

  const persistUnit = async (next: "kg" | "lb") => {
    const prev = unit;
    setUnit(next);
    if (!client?.id) return;
    await sb.from("clients").update({ preferred_weight_unit: next }).eq("id", client.id);
    qc.invalidateQueries({ queryKey: ["my-client", portalUserId] });
    undo.push({
      label: `Changed unit to ${next.toUpperCase()}`,
      coalesceKey: "unit-toggle",
      undo: async () => {
        setUnit(prev);
        if (client?.id) {
          await sb.from("clients").update({ preferred_weight_unit: prev }).eq("id", client.id);
          qc.invalidateQueries({ queryKey: ["my-client", portalUserId] });
        }
      },
    });
  };

  // ----------------------------------------------------------------
  // Per-exercise unit overrides (client preference + history detection)
  // ----------------------------------------------------------------
  const exerciseIds = useMemo(
    () => Array.from(new Set((rows as any[]).map((r) => r.exercises?.id).filter(Boolean) as string[])),
    [rows],
  );

  const { data: prefRows = [] } = useQuery({
    queryKey: ["client-exercise-unit-prefs", client?.id, exerciseIds.join(",")],
    enabled: !!client?.id && exerciseIds.length > 0,
    queryFn: async () => (await sb.from("client_exercise_unit_prefs").select("exercise_id, unit").eq("client_id", client!.id).in("exercise_id", exerciseIds)).data ?? [],
  });

  const { data: historyRows = [] } = useQuery({
    queryKey: ["client-exercise-unit-history", client?.id, exerciseIds.join(",")],
    enabled: !!client?.id && exerciseIds.length > 0,
    queryFn: async () => (await sb
      .from("pl_row_results")
      .select("actual_load_unit, pl_exercise_rows!inner(exercise_id)")
      .eq("client_id", client!.id)
      .in("pl_exercise_rows.exercise_id", exerciseIds)
      .not("actual_load_unit", "is", null)
      .order("created_at", { ascending: false })
      .limit(500)).data ?? [],
  });

  // Map exercise_id -> resolved unit, recomputed when inputs change.
  const [unitOverrides, setUnitOverrides] = useState<Record<string, WUnit>>({});
  const resolvedUnitMap = useMemo(() => {
    const prefByEx: Record<string, WUnit> = {};
    for (const p of prefRows as any[]) {
      if (p.exercise_id && (p.unit === "kg" || p.unit === "lb")) prefByEx[p.exercise_id] = p.unit;
    }
    const historyByEx: Record<string, string[]> = {};
    for (const h of historyRows as any[]) {
      const exId = h.pl_exercise_rows?.exercise_id;
      if (!exId) continue;
      (historyByEx[exId] ||= []).push(h.actual_load_unit);
    }
    const map: Record<string, WUnit> = {};
    for (const r of rows as any[]) {
      const exId = r.exercises?.id;
      const key = exId ?? `row:${r.id}`;
      const local = exId ? unitOverrides[exId] : undefined;
      map[key] = local ?? resolveExerciseUnit({
        prefUnit: exId ? prefByEx[exId] ?? null : null,
        historyUnit: exId ? modeUnit(historyByEx[exId] ?? []) : null,
        rowLoadUnit: (r.load_unit === "kg" || r.load_unit === "lb") ? r.load_unit : null,
        exerciseDefault: (r.exercises?.default_load_unit === "kg" || r.exercises?.default_load_unit === "lb") ? r.exercises.default_load_unit : null,
        workoutUnit: unit,
      });
    }
    return map;
  }, [rows, prefRows, historyRows, unitOverrides, unit]);

  const setExerciseUnit = async (exerciseId: string | null, rowId: string, next: WUnit) => {
    const key = exerciseId ?? `row:${rowId}`;
    const prevUnit = exerciseId ? unitOverrides[exerciseId] : (unitOverrides as any)[key];
    if (exerciseId) setUnitOverrides((m) => ({ ...m, [exerciseId]: next }));
    else setUnitOverrides((m) => ({ ...m, [key]: next } as any));
    if (client?.id && exerciseId) {
      try { await saveExerciseUnitPref(client.id, exerciseId, next); } catch { /* non-blocking */ }
      qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs", client.id] });
    }
    undo.push({
      label: `Set exercise unit to ${next.toUpperCase()}`,
      coalesceKey: `ex-unit:${key}`,
      undo: async () => {
        if (exerciseId) setUnitOverrides((m) => ({ ...m, [exerciseId]: prevUnit as WUnit }));
        else setUnitOverrides((m) => ({ ...m, [key]: prevUnit as WUnit } as any));
        if (client?.id && exerciseId && (prevUnit === "kg" || prevUnit === "lb")) {
          try { await saveExerciseUnitPref(client.id, exerciseId, prevUnit); } catch {}
          qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs", client.id] });
        }
      },
    });
  };

  // Global toggle: change workout-level pref AND bulk-set every exercise in this
  // workout — but only for exercises WITHOUT an explicit per-exercise override
  // (either a saved pref or a session override). Per-exercise picks stay
  // authoritative until the client clears them. This matches the
  // unit-controls spec: "Global changes should update exercises that do not
  // have an explicit override."
  const handleGlobalUnitChange = async (next: WUnit) => {
    await persistUnit(next);
    const prefMap = new Map<string, string>();
    for (const p of (prefRows as any[] | undefined) ?? []) {
      if (p?.exercise_id && p?.unit) prefMap.set(p.exercise_id, p.unit);
    }
    const targetIds = exerciseIds.filter((id) => !unitOverrides[id] && !prefMap.has(id));
    if (client?.id && targetIds.length > 0) {
      try { await saveExerciseUnitPrefsBulk(client.id, targetIds, next); } catch { /* non-blocking */ }
      qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs", client.id] });
    }
  };

  const unitForRow = (r: any): WUnit => {
    const exId = r.exercises?.id;
    return resolvedUnitMap[exId ?? `row:${r.id}`] ?? unit;
  };

  // Focus / full-screen logging mode.
  const [focusMode, setFocusMode] = useState(false);
  useEffect(() => {
    if (!focusMode) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, [focusMode]);

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
    onPermanentFailure: ({ value }) => {
      if (!client?.id) return;
      enqueueOfflineWrite({
        id: `portal_meta:${dayId}:${client.id}`,
        label: "Workout notes",
        handlerKey: "portal_table_upsert",
        payload: {
          table: "pl_day_completions",
          id: completion?.id ?? null,
          payload: {
            day_id: dayId,
            client_id: client.id,
            client_notes: value.notes || null,
            actual_duration_min: value.actualMin ? parseInt(value.actualMin) : null,
          },
        },
      });
    },
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
      {focusMode && (
        <div className="fixed inset-0 z-[60] overflow-y-auto bg-background">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
            <div className="font-bold">{day.title || `Day ${day.day_index}`} · Full Screen</div>
            {/* Global KG/LB toggle removed — each exercise carries its own
                authoritative unit control. */}
            <Button size="sm" variant="outline" onClick={() => setFocusMode(false)}>
              <Minimize2 className="mr-1 h-4 w-4" /> Exit Full Screen
            </Button>
          </div>
          <div className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
            <WorkoutLoadBoundary clientId={client?.id ?? null} clientName={(client as any)?.full_name ?? null} dayId={dayId} route={`/portal/workouts/${dayId}`}>
              {rowsLoaded && (rows as any[]).length === 0 ? (
                <WorkoutEmptyCard
                  clientId={client?.id ?? null}
                  clientName={(client as any)?.full_name ?? null}
                  workoutId={dayId}
                  route={`/portal/workouts/${dayId}`}
                  onRetry={() => qc.invalidateQueries({ queryKey: ["pl-day-rows", dayId] })}
                />
              ) : null}
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
                  unit={unitForRow(r)}
                  onUnitChange={(u) => setExerciseUnit(r.exercises?.id ?? null, r.id, u)}
                  focusMode
                  onChange={refresh}
                  onNoteChange={refreshNotes}
                  purposeLabel={purposeLabelById.get(r.id) ?? null}
                />
              ))}
            </WorkoutLoadBoundary>
          </div>
        </div>
      )}
      <PageHeader
        backTo="/portal/workouts"
        backLabel="Back to Workouts"
        title={day.title || `Day ${day.day_index}`}
        subtitle={day.focus ?? ""}
        actions={!readonly ? <UndoButton /> : undefined}
      />
      <div className="p-4 md:p-8 space-y-4">
        <Link to="/portal/workouts" className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="mr-1 h-4 w-4" /> All workouts
        </Link>

        <WorkoutSyncBanner
          clientId={client?.id ?? null}
          workoutId={dayId}
          pageRoute={`/portal/workouts/${dayId}`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline"><Clock className="mr-1 h-3 w-3" /> {durationRange(day.duration_override_min ?? day.duration_estimate_min ?? 60)}</Badge>
          {completion && <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>}
          {readonly && <Badge variant="outline" className="border-muted-foreground/30 bg-muted/30 text-muted-foreground"><Lock className="mr-1 h-3 w-3" /> Read-only</Badge>}
          <div className="ml-auto flex items-center gap-2">
            {/* Global KG/LB toggle removed — per-exercise unit controls remain
                the single source of truth for unit selection. */}
            {!readonly && (
              <Button size="sm" variant="outline" onClick={() => setFocusMode(true)}>
                <Maximize2 className="mr-1 h-4 w-4" /> Full Screen
              </Button>
            )}
            <SaveStatus state={metaSave.state} savedAt={metaSave.savedAt} />
          </div>
        </div>

        {client?.id && (
          <div className="flex flex-wrap gap-2">
            <WarmupButton
              dayId={dayId}
              blockId={blockId}
              clientId={client.id}
              warmupMode={(day as any).warmup_mode}
              dayProtocolId={(day as any).warmup_protocol_id}
              exerciseRows={rows as any[]}
            />
            <TrainingHelpButton size="sm" variant="outline" />
          </div>
        )}

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

        <WorkoutLoadBoundary clientId={client?.id ?? null} clientName={(client as any)?.full_name ?? null} dayId={dayId} route={`/portal/workouts/${dayId}`}>
          <div className="space-y-3">
            {rowsLoaded && (rows as any[]).length === 0 ? (
              <WorkoutEmptyCard
                clientId={client?.id ?? null}
                clientName={(client as any)?.full_name ?? null}
                workoutId={dayId}
                route={`/portal/workouts/${dayId}`}
                onRetry={() => qc.invalidateQueries({ queryKey: ["pl-day-rows", dayId] })}
              />
            ) : null}
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
                unit={unitForRow(r)}
                onUnitChange={(u) => setExerciseUnit(r.exercises?.id ?? null, r.id, u)}
                onChange={refresh}
                onNoteChange={refreshNotes}
                purposeLabel={purposeLabelById.get(r.id) ?? null}
              />
            ))}
          </div>
        </WorkoutLoadBoundary>

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

function SuggestedLoadBadge({ load, unit, exerciseName }: { load: number; unit: "kg" | "lb"; exerciseName: string }) {
  // Cheap suspicious-load heuristic: extreme absolute values flag a likely unit / data error.
  // We deliberately keep this client-side and non-blocking — clients must always stop and
  // contact their coach if anything looks wrong.
  const SUSP_KG = 350;   // very few lifters program above this for any single exercise
  const SUSP_LB = 770;
  const suspicious = (unit === "kg" && load >= SUSP_KG) || (unit === "lb" && load >= SUSP_LB);
  return (
    <div className="mt-1 flex flex-wrap items-center gap-1.5">
      <div className={cn(
        "inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold",
        suspicious ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-primary/10 text-primary",
      )}>
        Suggested Load: {load} {unit}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label="What does Suggested Load mean?" className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full hover:bg-foreground/10">
              <Info className="h-3 w-3" />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-72 text-xs leading-relaxed">
            <p className="font-semibold mb-1">What is Suggested Load?</p>
            <p className="text-muted-foreground">
              Suggested Load is the starting weight programmed by your coach for <span className="font-medium text-foreground">{exerciseName}</span>. Adjust only when your plan or coach allows it. If the weight looks incorrect, unusually high, or you feel uncomfortable lifting it, stop and contact your coach before continuing.
            </p>
            <div className="mt-2 flex gap-2">
              <Link to="/portal/messages" className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">
                <MessageCircle className="h-3 w-3" /> Contact Coach
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      </div>
      {suspicious && (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-400">
              <AlertTriangle className="h-3 w-3" /> Check suggested load
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" className="w-72 text-xs leading-relaxed">
            <p className="font-semibold mb-1">Check this weight before lifting</p>
            <p className="text-muted-foreground">
              {load} {unit} is much higher than expected for most lifters on this exercise. Confirm the unit (kg vs lb) and contact your coach before lifting if it looks incorrect. Never lift a weight you believe is unsafe.
            </p>
            <div className="mt-2 flex gap-2">
              <Link to="/portal/messages" className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">
                <MessageCircle className="h-3 w-3" /> Contact Coach
              </Link>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

function ExerciseBlock({ row, dayId, dayTitle, clientId, blockId, existingResults, existingNote, readonly = false, unit = "kg", onUnitChange, focusMode = false, onChange, onNoteChange, purposeLabel = null }: { row: any; dayId: string; dayTitle: string; clientId: string | undefined; blockId?: string | null; existingResults: any[]; existingNote?: any; readonly?: boolean; unit?: "kg" | "lb"; onUnitChange?: (u: "kg" | "lb") => void; focusMode?: boolean; onChange: () => void; onNoteChange: () => void; purposeLabel?: string | null }) {
  const name = row.exercises?.name ?? row.exercise_name_override ?? "Exercise";
  const exercise = row.exercises ?? null;
  const exerciseId = exercise?.id ?? null;
  const video = exercise?.video_url ?? exercise?.vimeo_embed_url ?? null;
  const hasGuide = Boolean(exerciseId || video);
  const cues = exercise?.cues ?? null;
  const setCount = Math.max(1, row.sets ?? 1);
  const exMeta: ExerciseMeta | null = exercise
    ? {
        exercise_category: exercise.exercise_category ?? null,
        is_competition_lift: exercise.is_competition_lift ?? null,
        competition_lift_type: exercise.competition_lift_type ?? null,
        name: exercise.name ?? null,
      }
    : null;
  const accent = exerciseAccent(exMeta, row.card_color);
  const category = resolveCategory(exMeta);
  const effectiveRest = effectiveRestSeconds(
    { rest_seconds_override: row.rest_seconds_override, rest_seconds: row.rest_seconds },
    exMeta,
  );
  // Always show the resolved rest value (programmed or category default), never
  // a vague range. "Auto · 4 min" makes it obvious when the value comes from
  // the category default rather than an explicit programmed rest.
  const fmtRest = (s: number) => (s >= 60 ? `${Math.round(s / 60)} min` : `${s} sec`);
  const restIsExplicit = row.rest_seconds_override != null || row.rest_seconds != null;
  const restDisplay = effectiveRest != null
    ? (restIsExplicit ? fmtRest(effectiveRest) : `Auto · ${fmtRest(effectiveRest)}`)
    : "Auto";
  const categoryBadgeClass =
    category === "competition"
      ? "border-primary/30 bg-primary/10 text-primary"
      : category === "variation"
        ? "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-muted-foreground/30 bg-muted text-muted-foreground";
  const [howToOpen, setHowToOpen] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [cuesOpen, setCuesOpen] = useState(false);
  const hasNote = Boolean(existingNote?.id);

  // Rest timer trigger: SetRow calls bumpRestTimer() when a set is marked complete,
  // which auto-starts the single page-level active rest timer.
  const { startRestTimer } = useRestTimer();
  const bumpRestTimer = (setIndex: number) => {
    startRestTimer({
      exerciseName: name,
      setIndex,
      seconds: effectiveRest,
      category,
      // signalKey must change for each genuinely-newly-completed set so the
      // provider can dedupe idempotent re-saves of the same set.
      signalKey: `${row.id}:${setIndex}:${Date.now()}`,
    });
  };

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
    <Card className="relative overflow-hidden p-3 pl-4 sm:p-4 sm:pl-5">
      <div className={`absolute left-0 top-0 h-full w-1.5 ${accent}`} aria-hidden />
      {/* Row 1 — name + unit toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 font-bold leading-snug break-words text-sm sm:text-base">{name}</div>
        {!readonly && onUnitChange && (
          <div className="shrink-0">
            <UnitToggle unit={unit} onChange={onUnitChange} compact />
          </div>
        )}
      </div>
      {/* Row 2 — badges + sets×reps + rest (compact, single line on mobile when possible) */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        {purposeLabel && (
          <Badge variant="outline" className={cn("h-4 px-1 text-[10px] font-bold uppercase tracking-wider", categoryBadgeClass)}>
            {purposeLabel}
          </Badge>
        )}
        <Badge variant="outline" className="h-4 px-1 text-[10px] font-bold uppercase tracking-wider capitalize">
          {category}
        </Badge>
        {hasNote && (
          <span title="You saved a note for this exercise" className="inline-flex h-4 items-center gap-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
            <StickyNote className="h-2.5 w-2.5" /> Note
          </span>
        )}
        <span className="font-semibold text-foreground">
          {row.sets ?? "?"} × {row.reps_text ?? "?"}
        </span>
        {row.rpe && <span>@ RPE {row.rpe}</span>}
        {row.rir && <span>· {row.rir} RIR</span>}
        {row.percentage && !row.manual_override && row.percentage_basis !== "none" && <span>· {row.percentage}%</span>}
        {row.tempo && <span>· tempo {row.tempo}</span>}
        <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-secondary/40 px-1.5 py-0.5 font-semibold text-foreground">
          <Clock className="h-3 w-3" /> Rest: {restDisplay}
        </span>
      </div>
      {/* Suggested load badges */}
      {row.manual_override && (row.load_kg || row.load_lb) && (
        <SuggestedLoadBadge
          load={(row.load_kg ?? row.load_lb) as number}
          unit={row.load_kg ? "kg" : "lb"}
          exerciseName={name}
        />
      )}
      {!row.manual_override && computed && computed.status === "ok" && computed.load != null && (
        <SuggestedLoadBadge
          load={computed.load}
          unit={computed.unit}
          exerciseName={name}
        />
      )}
      {row.percentage_basis === "none" && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Log the load used
        </div>
      )}
      {row.notes && <p className="mt-1 text-xs text-muted-foreground italic">{row.notes}</p>}
      {/* Row 3 — compact horizontal action row */}
      <div className="mt-2 flex flex-wrap items-center gap-1">
        {clientId && exerciseId && (
          <ExerciseHistoryButton
            clientId={clientId}
            exerciseId={exerciseId}
            exerciseName={name}
            displayUnit={unit}
          />
        )}
        {hasGuide && (
          <Button size="sm" variant="outline" onClick={() => setHowToOpen(true)} className="h-7 px-2 text-xs">
            <Play className="mr-1 h-3 w-3 fill-current" /> How&nbsp;To
          </Button>
        )}
        <Button size="sm" variant={hasNote ? "default" : "outline"} onClick={() => setNotesOpen(true)} className="h-7 px-2 text-xs">
          <StickyNote className="mr-1 h-3 w-3" /> Notes
        </Button>
        {cues && (
          <Button size="sm" variant="ghost" onClick={() => setCuesOpen((v) => !v)} className="h-7 px-2 text-xs">
            {cuesOpen ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
            {cuesOpen ? "Hide cues" : "Show cues"}
          </Button>
        )}
        <TrainingHelpButton size="sm" variant="ghost" className="h-7 px-2 text-xs ml-auto" />
      </div>

      {cues && cuesOpen && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground border-l-2 border-border pl-2">
          {typeof cues === "string" ? cues : Array.isArray(cues) ? cues.join(" · ") : null}
        </p>
      )}

      <div className={cn("mt-3 overflow-hidden rounded-md border border-border", focusMode && "text-base")}>
        <div className={cn("grid items-center gap-2 border-b border-border bg-muted/40 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground", focusMode ? "grid-cols-[44px_1fr_1fr_1fr_64px] text-xs" : "grid-cols-[36px_1fr_1fr_1fr_56px]")}>
          <span>Set</span>
          <span>Weight ({unit})</span>
          <span>Reps</span>
          <span>RPE</span>
          <span className="text-right">Status</span>
        </div>
        {Array.from({ length: setCount }).map((_, i) => {
          const existing = existingResults.find((x) => x.set_index === i + 1);
          return (
            <SetRow
              key={i}
              rowId={row.id}
              workoutId={dayId}
              exerciseId={exerciseId ?? null}
              exerciseName={name}
              clientId={clientId}
              setIndex={i + 1}
              existing={existing}
              targetReps={row.reps_text}
              targetRpe={row.rpe}
              readonly={readonly}
              unit={unit}
              focusMode={focusMode}
              onChange={onChange}
              onSetCompleted={bumpRestTimer}
            />
          );
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

function SetRow({ rowId, workoutId, exerciseId, exerciseName, clientId, setIndex, existing, targetReps, targetRpe, readonly = false, unit = "kg", focusMode = false, onChange, onSetCompleted }: { rowId: string; workoutId?: string | null; exerciseId?: string | null; exerciseName?: string | null; clientId: string | undefined; setIndex: number; existing?: any; targetReps?: string | null; targetRpe?: string | null; readonly?: boolean; unit?: "kg" | "lb"; focusMode?: boolean; onChange: () => void; onSetCompleted?: (setIndex: number) => void }) {
  const { user } = useAuth();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  // Display weight is always shown in the active unit.
  // existing stores normalized kg + lb columns (Stage 1 trigger keeps them in sync),
  // plus the original actual_load/actual_load_unit pair. We pick whichever matches `unit`.
  const initialDisplayLoad = (() => {
    if (!existing) return "";
    const kg = existing.actual_load_kg;
    const lb = existing.actual_load_lb;
    if (unit === "kg" && kg != null) return String(kg);
    if (unit === "lb" && lb != null) return String(lb);
    // Fallback to raw actual_load when normalized columns aren't populated yet.
    return existing.actual_load != null ? String(existing.actual_load) : "";
  })();
  const [load, setLoad] = useState(initialDisplayLoad);
  const [reps, setReps] = useState(existing?.actual_reps?.toString() ?? "");
  const [rpe, setRpe] = useState(existing?.actual_rpe_num != null ? String(existing.actual_rpe_num) : (existing?.actual_rpe ?? ""));
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
    const kg = existing?.actual_load_kg;
    const lb = existing?.actual_load_lb;
    const display = unit === "kg"
      ? (kg != null ? String(kg) : (existing?.actual_load != null ? String(existing.actual_load) : ""))
      : (lb != null ? String(lb) : (existing?.actual_load != null ? String(existing.actual_load) : ""));
    setLoad(display);
    setReps(existing?.actual_reps?.toString() ?? "");
    setRpe(existing?.actual_rpe_num != null ? String(existing.actual_rpe_num) : (existing?.actual_rpe ?? ""));
  }, [existing?.id, existing?.actual_load_kg, existing?.actual_load_lb, existing?.actual_load, existing?.actual_reps, existing?.actual_rpe_num, existing?.actual_rpe, unit]);

  const value = useMemo(() => ({ load, reps, rpe, unit }), [load, reps, rpe, unit]);
  const save = useAutosave({
    key: draftKey,
    value,
    delay: 800,
    enabled: !readonly && !!clientId && hydrated && (load.length > 0 || reps.length > 0 || rpe.length > 0 || !!existing),
    onPermanentFailure: ({ value }) => {
      if (!clientId) return;
      const loadNum = value.load ? Number(value.load) : null;
      const repsNum = value.reps ? parseInt(value.reps, 10) : null;
      const rpeNum = value.rpe ? Number(value.rpe) : null;
      const allValid =
        loadNum != null && isFinite(loadNum) && loadNum >= 0 &&
        repsNum != null && isFinite(repsNum) && repsNum > 0 &&
        rpeNum != null && isFinite(rpeNum) && rpeNum >= 0 && rpeNum <= 10;
      enqueueOfflineWrite({
        id: `portal_set:${rowId}:${clientId}:${setIndex}`,
        label: `Saved set ${setIndex}`,
        handlerKey: "portal_table_upsert",
        payload: {
          table: "pl_row_results",
          id: existing?.id ?? null,
          payload: {
            row_id: rowId,
            client_id: clientId,
            set_index: setIndex,
            actual_load: loadNum,
            actual_load_unit: value.unit,
            entered_value: loadNum,
            entered_unit: value.unit,
            actual_reps: repsNum,
            actual_rpe: value.rpe || null,
            actual_rpe_num: rpeNum,
            completed_at: allValid ? new Date().toISOString() : null,
          },
        },
      });
    },
    onSave: async ({ load, reps, rpe, unit }) => {
      if (readonly) return;
      if (!clientId) return;
      if (!load && !reps && !rpe && !existing) return;
      // Validate numerics; silently skip persistence for invalid values (input stays).
      const loadNum = load ? Number(load) : null;
      const repsNum = reps ? parseInt(reps, 10) : null;
      const rpeNum = rpe ? Number(rpe) : null;
      if (load && (loadNum == null || !isFinite(loadNum) || loadNum < 0)) throw new Error("Weight must be a number");
      if (reps && (repsNum == null || !isFinite(repsNum) || repsNum < 0)) throw new Error("Reps must be a whole number");
      if (rpe && (rpeNum == null || !isFinite(rpeNum) || rpeNum < 0 || rpeNum > 10)) throw new Error("RPE must be 0–10");
      const allValid =
        loadNum != null && loadNum >= 0 &&
        repsNum != null && repsNum > 0 &&
        rpeNum != null && rpeNum >= 0 && rpeNum <= 10;
      const payload = {
        row_id: rowId,
        client_id: clientId,
        set_index: setIndex,
        actual_load: loadNum,
        actual_load_unit: unit,
        entered_value: loadNum,
        entered_unit: unit,
        actual_reps: repsNum,
        actual_rpe: rpe || null,
        actual_rpe_num: rpeNum,
        completed_at: allValid ? new Date().toISOString() : null,
      };
      let savedId: string | null = existing?.id ?? null;
      // Snapshot "before" in the display unit so the audit diff is meaningful.
      const before = existing
        ? {
            weight: unit === "kg"
              ? (existing.actual_load_kg ?? existing.actual_load ?? null)
              : (existing.actual_load_lb ?? existing.actual_load ?? null),
            reps: existing.actual_reps ?? null,
            rpe: existing.actual_rpe_num ?? existing.actual_rpe ?? null,
            unit: existing.actual_load_unit ?? null,
            status: existing.completed_at ? "completed" : null,
          }
        : { weight: null, reps: null, rpe: null, unit: null, status: null };
      if (existing) {
        const { error } = await sb.from("pl_row_results").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await sb.from("pl_row_results").insert(payload).select("id").maybeSingle();
        if (error) throw error;
        savedId = inserted?.id ?? null;
      }
      onChange();
      // Auto-start the per-exercise rest timer when this set transitions
      // into a fully-valid completed state. Avoid re-triggering on idempotent
      // updates that were already completed.
      const wasCompleted = Boolean(existing?.completed_at);
      if (allValid && !wasCompleted) onSetCompleted?.(setIndex);
      // Coach/admin POV audit trail. Only writes when impersonating, only the
      // fields that actually changed, only after the save succeeds.
      if (isImpersonating && user?.id && povClient?.id === clientId) {
        const after = {
          weight: loadNum,
          reps: repsNum,
          rpe: rpeNum,
          unit,
          status: allValid ? "completed" : "saved",
        };
        void writeSetEditAudit(before, after, {
          setLogId: savedId,
          clientId,
          workoutId: workoutId ?? null,
          exerciseId: exerciseId ?? null,
          exerciseName: exerciseName ?? null,
          editedByUserId: user.id,
          editedByRole: "coach_pov",
          editSource: "coach_pov",
          pageRoute: typeof window !== "undefined" ? window.location.pathname : null,
        });
      }
    },
  });

  const onEnter: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); save.flush(); }
  };

  return (
    <div className={cn(
      "grid items-center gap-2 border-t border-border/60 px-3 py-2",
      focusMode ? "grid-cols-[44px_1fr_1fr_1fr_64px]" : "grid-cols-[36px_1fr_1fr_1fr_56px]",
      existing?.completed_at && "bg-green-500/5",
    )}>
      <span className={cn("font-mono text-muted-foreground", focusMode ? "text-sm" : "text-xs")}>{setIndex}</span>
      <Input
        className={cn(focusMode ? "h-11 text-base" : "h-9 text-sm")}
        inputMode="decimal"
        type="text"
        pattern="[0-9]*\.?[0-9]*"
        placeholder="—"
        aria-label={`Set ${setIndex} weight in ${unit}`}
        value={load}
        onChange={(e) => setLoad(e.target.value.replace(/[^0-9.]/g, ""))}
        onKeyDown={onEnter}
        onBlur={() => save.flush()}
        readOnly={readonly}
        disabled={readonly}
      />
      <Input
        className={cn(focusMode ? "h-11 text-base" : "h-9 text-sm")}
        inputMode="numeric"
        type="text"
        pattern="[0-9]*"
        placeholder={targetReps || "—"}
        aria-label={`Set ${setIndex} reps`}
        value={reps}
        onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={onEnter}
        onBlur={() => save.flush()}
        readOnly={readonly}
        disabled={readonly}
      />
      <Input
        className={cn(focusMode ? "h-11 text-base" : "h-9 text-sm")}
        inputMode="decimal"
        type="text"
        pattern="[0-9]*\.?[0-9]*"
        placeholder={targetRpe ? String(targetRpe) : "—"}
        aria-label={`Set ${setIndex} RPE`}
        value={rpe}
        onChange={(e) => setRpe(e.target.value.replace(/[^0-9.]/g, ""))}
        onKeyDown={onEnter}
        onBlur={() => save.flush()}
        readOnly={readonly}
        disabled={readonly}
      />
      <div className="flex items-center justify-end gap-1">
        {!readonly && <SaveStatus state={save.state} savedAt={save.savedAt} compact />}
        {existing?.completed_at && <CheckCircle2 className="h-4 w-4 text-green-500" />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* kg/lb toggle                                                                */
/* -------------------------------------------------------------------------- */

function UnitToggle({ unit, onChange, label, compact = false }: { unit: "kg" | "lb"; onChange: (u: "kg" | "lb") => void; label?: string; compact?: boolean }) {
  return (
    <div className="inline-flex items-center gap-1.5">
      {label && (
        <span className="hidden sm:inline text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
      )}
      <div className={cn("inline-flex items-center overflow-hidden rounded-md border border-border bg-secondary/40", compact ? "text-[11px]" : "text-xs")}
           role="group"
           aria-label={label ?? "Unit toggle"}>
      {(["kg", "lb"] as const).map((u) => (
        <button
          key={u}
          type="button"
          onClick={() => unit !== u && onChange(u)}
          aria-pressed={unit === u}
          className={cn(
            "font-bold uppercase tracking-wider transition-colors",
            compact ? "px-2 py-1 min-w-[34px]" : "px-3 py-1.5",
            unit === u ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {u}
        </button>
      ))}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Workout load-failure boundary                                               */
/* -------------------------------------------------------------------------- */

class WorkoutLoadBoundary extends Component<
  { children: ReactNode; clientId: string | null; clientName: string | null; dayId: string; route: string },
  { hasError: boolean; error: Error | null }
> {
  state = { hasError: false, error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error };
  }
  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("[workout-load] error", error, info);
  }
  reset = () => this.setState({ hasError: false, error: null });
  render() {
    if (!this.state.hasError) return this.props.children as any;
    return (
      <WorkoutLoadFailureCard
        clientId={this.props.clientId}
        clientName={this.props.clientName}
        dayId={this.props.dayId}
        route={this.props.route}
        error={this.state.error}
        onRetry={this.reset}
      />
    );
  }
}

function WorkoutLoadFailureCard({
  clientId, clientName, dayId, route, error, onRetry,
}: {
  clientId: string | null;
  clientName: string | null;
  dayId: string;
  route: string;
  error: Error | null;
  onRetry: () => void;
}) {
  const notifyFn = useServerFn(notifyCoachOfWorkoutFailure);
  return (
    <Card className="border-destructive/40 bg-destructive/5 p-6 space-y-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-1 h-6 w-6 shrink-0 text-destructive" />
        <div className="space-y-1">
          <div className="text-base font-bold">Workout didn’t load properly.</div>
          <div className="text-sm text-muted-foreground">Please contact your coach so we can fix this fast.</div>
        </div>
      </div>
      {error?.message && (
        <div className="rounded border border-border/60 bg-background/60 p-2 font-mono text-[11px] text-muted-foreground">
          {error.message}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <ActionButton
          jobLabel="Notifying coach"
          jobDescription={clientName ?? undefined}
          loadingLabel="Notifying…"
          successLabel="Coach notified"
          icon={<Send className="h-4 w-4" />}
          onAction={async () => {
            await runJob(
              { title: "Notifying coach", description: clientName ?? "Workout load failure", steps: ["Capturing context", "Creating alert", "Sending SMS", "Done"], successToast: "Coach has been notified" },
              async (job) => {
                job.completeStep(0);
                const device = typeof navigator !== "undefined" ? { userAgent: navigator.userAgent } : null;
                job.completeStep(1);
                const res: any = await notifyFn({ data: {
                  client_id: clientId ?? undefined,
                  workout_id: dayId,
                  page_route: route,
                  error_type: "workout_load_failure",
                  error_message: error?.message ?? null,
                  device_info: device,
                  details: { stack: error?.stack ?? null },
                } });
                job.completeStep(2);
                job.completeStep(3);
                return res;
              },
            );
          }}
        >
          Notify Coach
        </ActionButton>
        <Button variant="outline" onClick={onRetry}>
          <RefreshCw className="mr-2 h-4 w-4" /> Try Again
        </Button>
      </div>
    </Card>
  );
}