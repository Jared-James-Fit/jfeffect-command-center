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
  purposeLabelBadgeClass,
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
import { getRowBlockSummariesFn } from "@/lib/exercise-blocks.functions";
import { runJob } from "@/lib/progress-jobs";
import { cn } from "@/lib/utils";
import { WorkoutEmptyCard } from "@/components/workout-empty-state";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { writeSetEditAudit } from "@/lib/logged-set-audit";
import { resolveExerciseUnit, modeUnit, saveExerciseUnitPref, type WUnit } from "@/lib/exercise-unit-prefs";
import { WorkoutUndoProvider, useWorkoutUndo, UndoButton } from "@/lib/workout-undo";
import { WorkoutSyncBanner } from "@/components/workout-sync-banner";
import { writePlanCache, cachedInitialData } from "@/lib/workout-plan-cache";
import { enqueueOfflineWrite, registerQueueHandler } from "@/lib/workout-offline-queue";
import { ActiveRestTimerProvider, useRestTimer } from "@/components/active-rest-timer";
import { ExerciseHistoryButton } from "@/components/exercise-history-sheet";
import { convertWeight } from "@/lib/progress-metrics";
import { WorkoutFeedbackSheet, WorkoutFeedbackReminder, WorkoutFeedbackEditButton } from "@/components/workout-feedback-sheet";
import { WorkoutTimerSheet, QuickConfirmDuration, type TimerCompletionPayload } from "@/components/workout-timer-sheet";
import { formatDuration } from "@/lib/duration";
import { Timer } from "lucide-react";

/* -------------------------------------------------------------------------- */
/* Target-parsing helpers (Suggested → Draft → Confirmed fast-logging)         */
/* -------------------------------------------------------------------------- */

type RangeTarget = { exact?: number; min?: number; max?: number };

function parseRepTarget(text?: string | null): RangeTarget {
  if (!text) return {};
  const s = String(text).trim();
  const range = s.match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const n = s.match(/^(\d+)$/);
  if (n) return { exact: Number(n[1]) };
  return {};
}

function parseEffortTarget(text?: string | null): RangeTarget {
  if (!text) return {};
  // Tolerate values like "RPE 8", "@8", "RIR 2", "rir: 1-2", "~8.5"
  const s = String(text)
    .replace(/rpe|rir|[@~:]/gi, " ")
    .trim();
  if (!s) return {};
  const range = s.match(/^(\d+(?:\.\d+)?)\s*[-–]\s*(\d+(?:\.\d+)?)$/);
  if (range) return { min: Number(range[1]), max: Number(range[2]) };
  const n = s.match(/^(\d+(?:\.\d+)?)$/);
  if (n) return { exact: Number(n[1]) };
  // Last resort: pull first number out of the string
  const any = s.match(/(\d+(?:\.\d+)?)/);
  if (any) return { exact: Number(any[1]) };
  return {};
}

function repChips(t: RangeTarget): number[] {
  if (t.exact != null) {
    return Array.from(new Set([t.exact - 1, t.exact, t.exact + 1].filter((x) => x > 0)));
  }
  if (t.min != null && t.max != null) {
    const span = t.max - t.min;
    if (span <= 2) return Array.from({ length: span + 1 }, (_, i) => t.min! + i);
    return [t.min, Math.round((t.min + t.max) / 2), t.max];
  }
  return [];
}

function rpeChips(t: RangeTarget): number[] {
  if (t.exact != null) {
    return [t.exact - 0.5, t.exact, t.exact + 0.5].filter((x) => x >= 5 && x <= 10);
  }
  if (t.min != null && t.max != null) {
    const out: number[] = [];
    for (let v = t.min; v <= t.max + 1e-9; v += 0.5) out.push(Math.round(v * 2) / 2);
    return out.slice(0, 4);
  }
  return [];
}

function rirChips(t: RangeTarget): number[] {
  if (t.exact != null) {
    return [t.exact - 1, t.exact, t.exact + 1].filter((x) => x >= 0 && x <= 10);
  }
  if (t.min != null && t.max != null) {
    const out: number[] = [];
    for (let v = t.min; v <= t.max; v++) out.push(v);
    return out.slice(0, 4);
  }
  return [];
}

function weightIncrement(unit: "kg" | "lb"): number {
  return unit === "kg" ? 2.5 : 5;
}

function fmtNum(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
}

/**
 * Build the standardized client-facing prescription line:
 *   "Sets × Reps @ Weight | RPE"
 * Examples: "3 × 8–12 @ 40 lb | RPE 8", "3 × 10 | RPE 8", "1 × 3 @ 82.5% | RPE 7".
 * Only includes segments that are actually prescribed — never falls back to logged
 * results or previous-session values.
 */
function formatPrescription(p: {
  sets: number | null | undefined;
  repsText: string | null | undefined;
  suggestedWeight: number | null | undefined;
  unit: "kg" | "lb";
  percentage: number | string | null | undefined;
  percentageBasis: string | null | undefined;
  manualOverride: boolean | null | undefined;
  rpe: string | number | null | undefined;
  rir: string | number | null | undefined;
  measurementType?: "reps" | "time";
  durationSeconds?: number | null | undefined;
}): string {
  const sets = p.sets ?? 1;
  if (p.measurementType === "time") {
    // Time-based prescription: "3 × 45 sec @ 20 lb | RPE 7"
    const dur = p.durationSeconds && p.durationSeconds > 0 ? formatDuration(p.durationSeconds) : "—";
    let load = "";
    if (p.suggestedWeight != null) load = `@ ${fmtNum(p.suggestedWeight)} ${p.unit}`;
    let effort = "";
    if (p.rpe != null && String(p.rpe).trim() !== "") effort = `| RPE ${p.rpe}`;
    else if (p.rir != null && String(p.rir).trim() !== "") effort = `| ${p.rir} RIR`;
    return [`${sets} × ${dur}`, load, effort].filter(Boolean).join(" ");
  }
  // Normalize "8-12" → "8–12" for readability; leave AMRAP / Max / other text untouched.
  const repsRaw = (p.repsText ?? "").toString().trim();
  const reps = repsRaw ? repsRaw.replace(/\s*-\s*/g, "–") : "?";
  let load = "";
  if (p.suggestedWeight != null) {
    load = `@ ${fmtNum(p.suggestedWeight)} ${p.unit}`;
  } else if (
    p.percentage &&
    !p.manualOverride &&
    p.percentageBasis &&
    p.percentageBasis !== "none" &&
    p.percentageBasis !== "manual"
  ) {
    load = `@ ${p.percentage}%`;
  }
  let effort = "";
  if (p.rpe != null && String(p.rpe).trim() !== "") effort = `| RPE ${p.rpe}`;
  else if (p.rir != null && String(p.rir).trim() !== "") effort = `| ${p.rir} RIR`;
  return [`${sets} × ${reps}`, load, effort].filter(Boolean).join(" ");
}

export const Route = createFileRoute("/_authenticated/portal/workouts/$dayId")({
  validateSearch: (s: Record<string, unknown>) => ({
    readonly: s.readonly === 1 || s.readonly === "1" || s.readonly === true ? 1 : undefined,
    // Coach- or client-initiated "open in edit mode" — auto-unlocks past workouts
    // and auto-opens the feedback sheet when the user wants to edit a review.
    edit: s.edit === 1 || s.edit === "1" || s.edit === true ? 1 : undefined,
    review: s.review === 1 || s.review === "1" || s.review === true ? 1 : undefined,
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
  const { isImpersonating } = useClientImpersonation();
  // "Auto" readonly = past/closed workouts the client would otherwise be locked
  // out of. The client can opt-in to editing a past workout via the Edit button
  // below (`unlocked` flips this off). Impersonation always stays read-only so
  // coaches don't edit while viewing as the client.
  const [unlocked, setUnlocked] = useState<boolean>(search.edit === 1);
  const autoReadonly = search.readonly === 1 || blockEnded || blockCompleted;
  const readonly = (autoReadonly && !unlocked) || isImpersonating;
  // Reset the unlock when navigating to a different workout.
  useEffect(() => { setUnlocked(search.edit === 1); }, [dayId, search.edit]);

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

  // Slice 3 client fail-safe. A row "is unsupported" when it carries
  // any non-Straight block, or more than one block — i.e. anything the
  // legacy logger would otherwise mis-render or silently flatten. The
  // server-side activation guard prevents this state from reaching a
  // client-visible program under normal flow; the fail-safe exists for
  // exactly the rare scenario where a row slipped through (e.g. logger
  // toggled on, then a program containing unsupported blocks is opened
  // while the toggle is off again).
  const rowBlockSummariesFn = useServerFn(getRowBlockSummariesFn);
  const { data: unsupportedRows = {} } = useQuery<Record<string, boolean>>({
    queryKey: ["pl-day-row-block-summaries", dayId, (rows as any[]).map((r) => r.id).sort().join(",")],
    enabled: (rows as any[]).length > 0,
    queryFn: async () => {
      const rowIds = (rows as any[]).map((r) => r.id);
      if (!rowIds.length) return {} as Record<string, boolean>;
      const summary = await rowBlockSummariesFn({ data: { rowIds } });
      // Best-effort client diagnosis log: any unsupported row reaching
      // a client is an error condition that admin needs to see.
      const bad = Object.entries(summary as Record<string, boolean>)
        .filter(([, v]) => v)
        .map(([k]) => k);
      if (bad.length) {
        // eslint-disable-next-line no-console
        console.warn("[pl-block-failsafe] Unsupported block rows in this workout", {
          dayId,
          rowIds: bad,
        });
      }
      return summary;
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
    // Hide the mobile bottom nav while in full-screen logging so it can't
    // overlap controls and so opened Sheets (z-50) are not trapped behind it.
    document.body.setAttribute("data-workout-focus", "1");
    const navEls = document.querySelectorAll<HTMLElement>("[data-mobile-bottom-nav]");
    const restores: Array<() => void> = [];
    navEls.forEach((el) => {
      const prevDisplay = el.style.display;
      el.style.display = "none";
      restores.push(() => { el.style.display = prevDisplay; });
    });
    return () => {
      document.body.style.overflow = prev;
      document.body.removeAttribute("data-workout-focus");
      restores.forEach((fn) => fn());
    };
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

  // Post-workout feedback sheet state.
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  // When the client clicks "Finish", we stage the completion payload and
  // open the feedback sheet. The workout is NOT marked complete until the
  // feedback is actually submitted — feedback is now a hard gate.
  const [pendingFinalize, setPendingFinalize] = useState<null | {
    completionId?: string;
    startedAt: string;
    durationMin: number;
    notes: string | null;
  }>(null);
  const { data: existingFeedback } = useQuery({
    queryKey: ["pl-workout-feedback", completion?.id],
    enabled: !!completion?.id,
    queryFn: async () =>
      (await (sb as any)
        .from("pl_workout_feedback")
        .select("id, overall_rating, session_rpe, pain, pain_level, pain_area, pain_note, client_note, reviewed_at, reviewed_by")
        .eq("completion_id", completion!.id)
        .maybeSingle()).data,
  });
  const hasFeedback = !!existingFeedback;
  const feedbackLocked = !!(existingFeedback?.reviewed_at || existingFeedback?.reviewed_by);
  // Honor ?review=1 by auto-opening the feedback sheet as soon as we have
  // a completion row to attach it to. Notification deep-links use this.
  const reviewParam = search.review === 1;
  const autoOpenedReviewRef = useRef(false);
  useEffect(() => {
    if (!reviewParam) { autoOpenedReviewRef.current = false; return; }
    if (autoOpenedReviewRef.current) return;
    if (!completion?.id) return;
    if (feedbackLocked) return;
    autoOpenedReviewRef.current = true;
    setFeedbackOpen(true);
  }, [reviewParam, completion?.id, feedbackLocked]);
  const feedbackSkipped = !!(completion?.id && typeof window !== "undefined"
    && localStorage.getItem(`lov.wfb.skip:${completion.id}`));

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
        <div
          className="fixed inset-0 z-40 overflow-y-auto bg-background"
          data-workout-focus
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
            <div className="font-bold">{day.title || `Day ${day.day_index}`} · Full Screen</div>
            {/* Global KG/LB toggle removed — each exercise carries its own
                authoritative unit control. */}
            <Button size="sm" variant="outline" onClick={() => setFocusMode(false)}>
              <Minimize2 className="mr-1 h-4 w-4" /> Exit Full Screen
            </Button>
          </div>
          <div className="mx-auto max-w-3xl p-4 md:p-6">
            <WorkoutLoadBoundary clientId={client?.id ?? null} clientName={(client as any)?.full_name ?? null} dayId={dayId} route={`/portal/workouts/${dayId}`}>
              <div className="space-y-4 rounded-lg bg-builder-canvas p-3 sm:p-4 ring-1 ring-builder-card-border/40">
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
                unsupportedRows[r.id] ? (
                  <UnsupportedExerciseCard key={r.id} row={r} />
                ) : (
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
                )
              ))}
              </div>
            </WorkoutLoadBoundary>
          </div>
        </div>
      )}
      <PageHeader
        backTo="/portal/workouts"
        backLabel="Back to Workouts"
        title={day.title || `Day ${day.day_index}`}
        subtitle={[
          block?.name,
          week?.week_index != null ? `Week ${week.week_index}` : null,
          (week as any)?.phase || null,
          day.focus || null,
        ].filter(Boolean).join(" · ")}
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
          {autoReadonly && !isImpersonating && !unlocked && (
            <Button size="sm" variant="outline" onClick={() => { setUnlocked(true); toast.success("Editing enabled — your changes will save"); }}>
              Edit previous workout
            </Button>
          )}
          {autoReadonly && !isImpersonating && unlocked && (
            <Button size="sm" variant="ghost" onClick={() => setUnlocked(false)}>
              <Lock className="mr-1 h-3 w-3" /> Lock again
            </Button>
          )}
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
            <div>
              Viewing a past workout. Logs are read-only.
              {autoReadonly && !isImpersonating && (
                <> Tap <strong>Edit previous workout</strong> above to update any set.</>
              )}
            </div>
          </Card>
        )}
        {autoReadonly && unlocked && !isImpersonating && (
          <Card className="flex items-start gap-2 border-amber-500/30 bg-amber-500/5 p-3 text-xs">
            <Info className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <div>You're editing a previous workout. Changes save automatically.</div>
          </Card>
        )}

        <WorkoutLoadBoundary clientId={client?.id ?? null} clientName={(client as any)?.full_name ?? null} dayId={dayId} route={`/portal/workouts/${dayId}`}>
          <div className="space-y-4 rounded-lg bg-builder-canvas p-3 sm:p-4 ring-1 ring-builder-card-border/40">
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
              unsupportedRows[r.id] ? (
                <UnsupportedExerciseCard key={r.id} row={r} />
              ) : (
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
              )
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
              successLabel="Submit Feedback"
              successToast="Submit feedback to mark complete"
              icon={<CheckCircle2 className="h-4 w-4" />}
              onAction={async () => {
                if (!client?.id) return;
                await metaSave.flush();
                const startedAt = completion?.started_at ?? new Date().toISOString();
                const completedAt = new Date().toISOString();
                const durationMin = actualMin
                  ? parseInt(actualMin)
                  : completion?.actual_duration_min ?? Math.max(1, Math.round((new Date(completedAt).getTime() - new Date(startedAt).getTime()) / 60000));
                // Stage the completion as in-progress (NOT completed_at yet).
                // The workout is finalized only after feedback is submitted.
                const noteValue = notes.length > 0 ? notes : (completion?.client_notes ?? null);
                const payload = {
                  day_id: dayId,
                  client_id: client.id,
                  client_notes: noteValue,
                  actual_duration_min: durationMin,
                  started_at: startedAt,
                  in_progress_at: completion?.in_progress_at ?? startedAt,
                  completed_at: null,
                };
                let cid = completion?.id ?? null;
                if (completion) {
                  await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                } else {
                  const { data: inserted } = await sb.from("pl_day_completions").insert(payload).select("id").maybeSingle();
                  cid = inserted?.id ?? null;
                }
                if (draftKey) clearLocalDraft(draftKey);
                refresh();
                // Stash everything the feedback-submit handler needs to flip
                // completed_at on, then open the sheet.
                setPendingFinalize({
                  completionId: cid ?? undefined,
                  startedAt,
                  durationMin,
                  notes: noteValue,
                });
                setFeedbackOpen(true);
                toast.info("One more step — submit your feedback to mark this workout complete.");
              }}
            >
              Finish & Submit Feedback
            </ActionButton>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Submitting your feedback marks the workout as complete. If you skip it, we'll remind you in your notification bell.
          </p>
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

        {/* Subtle reminder when the client completed but skipped feedback. */}
        {!readonly && completion?.completed_at && !hasFeedback && feedbackSkipped && (
          <WorkoutFeedbackReminder onOpen={() => setFeedbackOpen(true)} />
        )}
        {/* Always offer view/edit after feedback has been submitted. */}
        {!readonly && completion?.completed_at && hasFeedback && (
          <WorkoutFeedbackEditButton locked={feedbackLocked} onOpen={() => setFeedbackOpen(true)} />
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

      {/* Post-workout feedback sheet. Client POV (readonly) never opens it. */}
      {!readonly && client?.id && (
        <WorkoutFeedbackSheet
          open={feedbackOpen && !!completion?.id}
          onOpenChange={setFeedbackOpen}
          completionId={completion?.id ?? null}
          clientId={client.id}
          dayId={dayId}
          existing={existingFeedback ?? null}
          onSubmitted={async () => {
            qc.invalidateQueries({ queryKey: ["pl-workout-feedback", completion?.id] });
            // Feedback is the gate — flip completed_at on once it lands.
            const targetId = pendingFinalize?.completionId ?? completion?.id ?? null;
            if (targetId && !completion?.completed_at) {
              const completedAt = new Date().toISOString();
              await sb.from("pl_day_completions").update({
                completed_at: completedAt,
                completion_method: "manual",
                ...(pendingFinalize ? {
                  actual_duration_min: pendingFinalize.durationMin,
                  client_notes: pendingFinalize.notes,
                  started_at: pendingFinalize.startedAt,
                } : {}),
              }).eq("id", targetId);
              setPendingFinalize(null);
              setNotes("");
              setActualMin("");
              refresh();
              toast.success("Workout marked complete");
            }
          }}
        />
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

/**
 * Slice 3 client fail-safe card. Rendered in place of `<ExerciseBlock />`
 * for any row whose pl_exercise_blocks contain anything the legacy logger
 * does not understand (multi-block prescriptions, drop sets, ascending sets,
 * etc.). Server-side guards prevent this state from reaching client-visible
 * programs under normal flow — this card exists as a defensive fail-safe so
 * a client never sees broken legacy inputs, can never fake completion, and
 * never creates incorrect set logs. The rest of the workout remains
 * loggable as normal.
 */
function UnsupportedExerciseCard({ row }: { row: any }) {
  const name = row.exercises?.name ?? row.exercise_name_override ?? "Exercise";
  return (
    <Card className="border-amber-500/40 bg-amber-500/5 p-4">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div className="space-y-1">
          <div className="text-sm font-bold">{name}</div>
          <p className="text-sm text-foreground/90">
            This exercise prescription needs an updated logging format. Contact your coach before completing this exercise.
          </p>
          <Link
            to="/portal/messages"
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
          >
            <MessageCircle className="h-3 w-3" /> Message Coach
          </Link>
        </div>
      </div>
    </Card>
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

  // Resolved suggested weight in the *active display unit*. Priority:
  // 1) coach manual_override exact load   2) computed % weight (rounded)
  // 3) raw load_kg/load_lb prescription   4) null (no safe suggestion).
  // This is "Suggested" only — it never auto-confirms a set.
  const suggestedWeight: number | null = useMemo(() => {
    if (row.manual_override) {
      if (unit === "kg" && row.load_kg) return Number(row.load_kg);
      if (unit === "lb" && row.load_lb) return Number(row.load_lb);
    }
    if (computed && computed.status === "ok" && computed.load != null) {
      const inUnit = unit === "kg" ? computed.load : computed.load * 2.2046226218;
      const step = weightIncrement(unit);
      return Math.round(inUnit / step) * step;
    }
    if (unit === "kg" && row.load_kg) return Number(row.load_kg);
    if (unit === "lb" && row.load_lb) return Number(row.load_lb);
    return null;
  }, [row.manual_override, row.load_kg, row.load_lb, computed, unit]);

  const repTarget = useMemo(() => parseRepTarget(row.reps_text), [row.reps_text]);
  const rpeTarget = useMemo(() => parseEffortTarget(row.rpe), [row.rpe]);
  const rirTarget = useMemo(() => parseEffortTarget(row.rir), [row.rir]);
  // When the program prescribes RIR and not RPE, the input column behaves as RIR.
  const showRir = !!row.rir && !row.rpe;

  // "Apply to remaining" — runs from a completed SetRow, pushes Draft values
  // into all later un-completed sets of this same exercise. Never overwrites
  // a confirmed (completed_at != null) set.
  const qc = useQueryClient();
  const applyToRemaining = async (fromSetIndex: number, payload: { load: string; reps: string; rpe: string; unit: "kg" | "lb" }) => {
    if (!clientId) return;
    const loadNum = payload.load ? Number(payload.load) : null;
    const repsNum = payload.reps ? parseInt(payload.reps, 10) : null;
    const rpeNum = payload.rpe ? Number(payload.rpe) : null;
    const tasks: Array<Promise<any>> = [];
    for (let i = fromSetIndex + 1; i <= setCount; i++) {
      const ex = existingResults.find((x) => x.set_index === i);
      if (ex?.completed_at) continue; // never touch confirmed sets
      const body: Record<string, any> = {
        row_id: row.id,
        client_id: clientId,
        set_index: i,
        actual_load: loadNum,
        actual_load_unit: payload.unit,
        entered_value: loadNum,
        entered_unit: payload.unit,
        actual_reps: repsNum,
        actual_rpe: payload.rpe || null,
        actual_rpe_num: rpeNum,
        completed_at: null, // Draft only — must be confirmed per set
      };
      if (ex?.id) tasks.push(sb.from("pl_row_results").update(body).eq("id", ex.id));
      else tasks.push(sb.from("pl_row_results").insert(body));
    }
    if (!tasks.length) return;
    await Promise.all(tasks);
    onChange();
    qc.invalidateQueries({ queryKey: ["pl-day-results"] });
    toast.success(`Applied to ${tasks.length} remaining set${tasks.length === 1 ? "" : "s"} as draft`);
  };

  return (
    <Card className="relative overflow-hidden border border-builder-card-border bg-builder-card p-4 pl-5 shadow-builder-card transition-colors hover:border-builder-card-border-strong sm:p-5 sm:pl-6">
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
        <Badge variant="outline" className={cn("h-4 px-1 text-[10px] font-bold uppercase tracking-wider", purposeLabelBadgeClass(purposeLabel))}>
          {purposeLabel || category}
        </Badge>
        {hasNote && (
          <span title="You saved a note for this exercise" className="inline-flex h-4 items-center gap-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
            <StickyNote className="h-2.5 w-2.5" /> Note
          </span>
        )}
        <span className="ml-auto inline-flex items-center gap-1 rounded-md bg-secondary/40 px-1.5 py-0.5 font-semibold text-foreground">
          <Clock className="h-3 w-3" /> Rest: {restDisplay}
        </span>
      </div>
      {/* Standardized prescription line: Sets × Reps @ Weight | RPE */}
      <div className="mt-1 text-sm font-semibold text-foreground leading-snug break-words">
        {formatPrescription({
          sets: row.sets,
          repsText: row.reps_text,
          suggestedWeight,
          unit,
          percentage: row.percentage,
          percentageBasis: row.percentage_basis,
          manualOverride: row.manual_override,
          rpe: row.rpe,
          rir: row.rir,
          measurementType: (row as any).measurement_type === "time" ? "time" : "reps",
          durationSeconds: (row as any).duration_seconds ?? null,
        })}
        {row.tempo && <span className="ml-2 text-xs font-normal text-muted-foreground">tempo {row.tempo}</span>}
      </div>
      {/* Suggested load badges */}
      {row.manual_override && (row.load_kg || row.load_lb) && (
        <SuggestedLoadBadge
          load={Number(
            convertWeight(
              (row.load_kg ?? row.load_lb) as number,
              row.load_kg ? "kg" : "lb",
              unit,
            ).toFixed(1),
          )}
          unit={unit}
          exerciseName={name}
        />
      )}
      {!row.manual_override && computed && computed.status === "ok" && computed.load != null && (
        <SuggestedLoadBadge
          load={Number(convertWeight(computed.load, computed.unit, unit).toFixed(1))}
          unit={unit}
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

      <div className={cn("mt-3 overflow-hidden rounded-md border border-builder-card-border bg-builder-inset", focusMode && "text-base")}>
        <div className={cn("grid items-center gap-1.5 border-b border-builder-card-border bg-builder-card/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground", focusMode ? "grid-cols-[36px_1.1fr_1.1fr_1fr_52px] text-xs" : "grid-cols-[28px_1.1fr_1.1fr_1fr_44px]")}>
          <span>Set</span>
          <span>{(row as any).measurement_type === "time" ? "Time" : "Reps"}</span>
          <span className="truncate">Wt ({unit.toUpperCase()})</span>
          <span>{showRir ? "RIR" : "RPE"}</span>
          <span className="text-right">Status</span>
        </div>
        {Array.from({ length: setCount }).map((_, i) => {
          const existing = existingResults.find((x) => x.set_index === i + 1);
          const prevExisting = i > 0 ? existingResults.find((x) => x.set_index === i) : undefined;
          const hasUncompletedAfter = Array.from({ length: setCount - (i + 1) }).some((_, k) => {
            const ex = existingResults.find((x) => x.set_index === i + 2 + k);
            return !ex?.completed_at;
          });
          return (
            <SetRow
              key={i}
              rowId={row.id}
              workoutId={dayId}
              exerciseId={exerciseId ?? null}
              exerciseName={name}
              clientId={clientId}
              setIndex={i + 1}
              setCount={setCount}
              measurementType={((row as any).measurement_type === "time") ? "time" : "reps"}
              prescribedDurationSeconds={(row as any).duration_seconds ?? null}
              existing={existing}
              prevExisting={prevExisting}
              targetReps={row.reps_text}
              targetRpe={row.rpe}
              targetRir={row.rir}
              suggestedWeight={suggestedWeight}
              repTarget={repTarget}
              rpeTarget={rpeTarget}
              rirTarget={rirTarget}
              hasUncompletedAfter={hasUncompletedAfter}
              onApplyToRemaining={applyToRemaining}
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

function SetRow({
  rowId, workoutId, exerciseId, exerciseName, clientId, setIndex, existing, prevExisting,
  targetReps, targetRpe, targetRir, suggestedWeight,
  repTarget, rpeTarget, rirTarget,
  hasUncompletedAfter, onApplyToRemaining,
  readonly = false, unit = "kg", focusMode = false, onChange, onSetCompleted,
  setCount, measurementType = "reps", prescribedDurationSeconds = null,
}: {
  rowId: string;
  workoutId?: string | null;
  exerciseId?: string | null;
  exerciseName?: string | null;
  clientId: string | undefined;
  setIndex: number;
  setCount?: number;
  measurementType?: "reps" | "time";
  prescribedDurationSeconds?: number | null;
  existing?: any;
  prevExisting?: any;
  targetReps?: string | null;
  targetRpe?: string | null;
  targetRir?: string | null;
  suggestedWeight?: number | null;
  repTarget?: RangeTarget;
  rpeTarget?: RangeTarget;
  rirTarget?: RangeTarget;
  hasUncompletedAfter?: boolean;
  onApplyToRemaining?: (fromSetIndex: number, payload: { load: string; reps: string; rpe: string; unit: "kg" | "lb" }) => Promise<void> | void;
  readonly?: boolean;
  unit?: "kg" | "lb";
  focusMode?: boolean;
  onChange: () => void;
  onSetCompleted?: (setIndex: number) => void;
}) {
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

  // State labels: Suggested (no draft, no confirm), Draft (typed but not all valid yet
  // OR explicitly saved with completed_at=null), Confirmed (existing.completed_at set).
  const isConfirmed = Boolean(existing?.completed_at);
  const hasAnyEntry = load.length > 0 || reps.length > 0 || rpe.length > 0;
  const isDraft = !isConfirmed && (hasAnyEntry || (existing && !existing.completed_at));

  // Quick-fill helpers — these only update local state, never auto-confirm.
  const applySuggestedWeight = () => { if (suggestedWeight != null) setLoad(fmtNum(suggestedWeight)); };
  const bumpWeight = (delta: number) => {
    const base = load ? Number(load) : (suggestedWeight ?? 0);
    const next = Math.max(0, base + delta);
    setLoad(fmtNum(Math.round(next / weightIncrement(unit)) * weightIncrement(unit)));
  };
  const useTargets = () => {
    if (suggestedWeight != null) setLoad(fmtNum(suggestedWeight));
    if (repTarget?.exact != null) setReps(String(repTarget.exact));
    else if (repTarget?.min != null) setReps(String(repTarget.min));
    if (rpeTarget?.exact != null) setRpe(String(rpeTarget.exact));
    else if (rpeTarget?.min != null) setRpe(String(rpeTarget.min));
    else if (rirTarget?.exact != null) setRpe(String(Math.min(10, Math.max(0, 10 - rirTarget.exact))));
    else if (rirTarget?.max != null) setRpe(String(Math.min(10, Math.max(0, 10 - rirTarget.max))));
    else if (rirTarget?.min != null) setRpe(String(Math.min(10, Math.max(0, 10 - rirTarget.min))));
  };
  const copyPrevious = () => {
    if (!prevExisting) return;
    const pkg = unit === "kg" ? (prevExisting.actual_load_kg ?? prevExisting.actual_load) : (prevExisting.actual_load_lb ?? prevExisting.actual_load);
    if (pkg != null) setLoad(String(pkg));
    if (prevExisting.actual_reps != null) setReps(String(prevExisting.actual_reps));
    const prevRpe = prevExisting.actual_rpe_num ?? prevExisting.actual_rpe;
    if (prevRpe != null) setRpe(String(prevRpe));
  };

  const repChipValues = useMemo(() => (repTarget ? repChips(repTarget) : []), [repTarget]);
  const rpeChipValues = useMemo(() => (rpeTarget ? rpeChips(rpeTarget) : []), [rpeTarget]);
  const rirChipValues = useMemo(() => (rirTarget ? rirChips(rirTarget) : []), [rirTarget]);
  const showRir = !!targetRir && !targetRpe;

  const hasAnyTarget = suggestedWeight != null || repChipValues.length > 0 || rpeChipValues.length > 0 || rirChipValues.length > 0;

  // ── Time-based completion (per-set countdown timer + quick-confirm) ────
  const isTime = measurementType === "time";
  const prescribedSec = prescribedDurationSeconds ?? null;
  const completedSec = (existing as any)?.completed_duration_seconds as number | null | undefined;
  const [timerOpen, setTimerOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);

  const saveTimeCompletion = async (completedSeconds: number, opts: {
    method: "countdown_timer" | "stopwatch" | "prescribed_quick_confirm" | "manual_entry";
    startedAt?: string | null;
    completedAt?: string;
    finishedEarly?: boolean;
  }) => {
    if (readonly || !clientId || !prescribedSec) return;
    const nowIso = opts.completedAt ?? new Date().toISOString();
    const payload: Record<string, any> = {
      row_id: rowId,
      client_id: clientId,
      set_index: setIndex,
      completed_duration_seconds: completedSeconds,
      timer_started_at: opts.startedAt ?? null,
      timer_completed_at: nowIso,
      completion_method: opts.method,
      completed_at: nowIso,
    };
    try {
      if (existing?.id) {
        const { error } = await sb.from("pl_row_results").update(payload).eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await sb.from("pl_row_results").insert(payload);
        if (error) throw error;
      }
      onChange();
      if (!existing?.completed_at) onSetCompleted?.(setIndex);
      toast.success(
        opts.finishedEarly
          ? `Saved ${formatDuration(completedSeconds)} of ${formatDuration(prescribedSec)}`
          : `Set ${setIndex} complete · ${formatDuration(completedSeconds)}`,
      );
    } catch (e: any) {
      // Fall through to offline queue so the completion isn't lost.
      enqueueOfflineWrite({
        id: `portal_set_time:${rowId}:${clientId}:${setIndex}`,
        label: `Saved set ${setIndex}`,
        handlerKey: "portal_table_upsert",
        payload: { table: "pl_row_results", id: existing?.id ?? null, payload },
      });
      toast.message(`Saved set ${setIndex} offline — will sync`);
    }
  };

  const onTimerComplete = (p: TimerCompletionPayload) => {
    void saveTimeCompletion(p.completedSeconds, {
      method: p.method === "stopwatch" ? "stopwatch" : "countdown_timer",
      startedAt: p.startedAt,
      completedAt: p.completedAt,
      finishedEarly: p.finishedEarly,
    });
  };

  return (
    <div className={cn(
      "border-t border-builder-card-border/70 transition-colors",
      isConfirmed && "bg-emerald-500/[0.07] border-l-2 border-l-emerald-500/70",
      isDraft && "bg-amber-500/[0.07] border-l-2 border-l-amber-500/60",
    )}>
    <div className={cn(
      "grid items-center gap-1.5 px-2.5 py-1.5",
      focusMode ? "grid-cols-[36px_1.1fr_1.1fr_1fr_52px]" : "grid-cols-[28px_1.1fr_1.1fr_1fr_44px]",
    )}>
      <span className={cn("font-mono text-muted-foreground", focusMode ? "text-sm" : "text-xs")}>{setIndex}</span>
      {isTime ? (
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={readonly || !prescribedSec}
            onClick={() => setTimerOpen(true)}
            aria-label={`Start countdown for set ${setIndex}${prescribedSec ? ` (${formatDuration(prescribedSec)})` : ""}`}
            className={cn(
              "inline-flex flex-1 items-center justify-center gap-1 rounded-md border px-2 font-bold tabular-nums transition-colors",
              focusMode ? "h-9 text-sm" : "h-8 text-xs",
              isConfirmed
                ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-600"
                : "border-primary/40 bg-primary/10 text-primary hover:bg-primary/20",
              (!prescribedSec || readonly) && "cursor-not-allowed opacity-60",
            )}
          >
            <Timer className="h-3.5 w-3.5" />
            {isConfirmed && completedSec != null
              ? formatDuration(completedSec)
              : (prescribedSec ? formatDuration(prescribedSec) : "—")}
          </button>
          {!readonly && !isConfirmed && prescribedSec ? (
            <button
              type="button"
              onClick={() => setQuickOpen(true)}
              aria-label="Mark complete without timer"
              className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground hover:bg-secondary",
                focusMode ? "h-9 w-9" : "h-8 w-8",
              )}
              title="Mark complete without timer"
            >
              <CheckCircle2 className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      ) : (
      <Input
        className={cn(focusMode ? "h-9 text-base px-2" : "h-8 text-sm px-2", "bg-white text-black placeholder:text-gray-500")}
        inputMode="numeric"
        type="text"
        pattern="[0-9]*"
        placeholder="reps"
        aria-label={`Set ${setIndex} reps`}
        value={reps}
        onChange={(e) => setReps(e.target.value.replace(/[^0-9]/g, ""))}
        onKeyDown={onEnter}
        onBlur={() => save.flush()}
        readOnly={readonly}
        disabled={readonly}
      />
      )}
      <Input
        className={cn(focusMode ? "h-9 text-base px-2" : "h-8 text-sm px-2", "bg-white text-black placeholder:text-gray-500")}
        inputMode="decimal"
        type="text"
        pattern="[0-9]*\.?[0-9]*"
        placeholder={unit}
        aria-label={`Set ${setIndex} weight in ${unit}`}
        value={load}
        onChange={(e) => setLoad(e.target.value.replace(/[^0-9.]/g, ""))}
        onKeyDown={onEnter}
        onBlur={() => save.flush()}
        readOnly={readonly}
        disabled={readonly}
      />
      <Input
        className={cn(focusMode ? "h-9 text-base px-2" : "h-8 text-sm px-2", "bg-white text-black placeholder:text-gray-500")}
        inputMode="decimal"
        type="text"
        pattern="[0-9]*\.?[0-9]*"
        placeholder={showRir ? "rir" : "rpe"}
        aria-label={`Set ${setIndex} ${showRir ? "RIR" : "RPE"}`}
        value={showRir && rpe !== "" ? String(Math.max(0, 10 - Number(rpe))) : rpe}
        onChange={(e) => {
          const cleaned = e.target.value.replace(/[^0-9.]/g, "");
          if (showRir && cleaned !== "") {
            const n = Number(cleaned);
            if (isFinite(n)) {
              setRpe(String(Math.max(0, Math.min(10, 10 - n))));
              return;
            }
          }
          setRpe(cleaned);
        }}
        onKeyDown={onEnter}
        onBlur={() => save.flush()}
        readOnly={readonly}
        disabled={readonly}
      />
      <div className="flex items-center justify-end gap-1">
        {!readonly && <SaveStatus state={save.state} savedAt={save.savedAt} compact />}
        {isConfirmed && <CheckCircle2 className="h-4 w-4 text-green-500" />}
      </div>
    </div>

    {/* Quick-fill chip row — Suggested values are visible but never auto-confirm */}
    {!readonly && !isConfirmed && hasAnyTarget && (
      <div className="px-3 pb-2 space-y-1.5">
        {/* Weight quick controls */}
        {suggestedWeight != null && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">Weight</span>
            <button type="button" onClick={() => bumpWeight(-weightIncrement(unit))}
              aria-label={`Decrease weight by ${weightIncrement(unit)} ${unit}`}
              className="h-7 min-w-[36px] rounded-md border border-border bg-background px-2 text-xs font-bold hover:bg-secondary">
              −{weightIncrement(unit)}
            </button>
            <button type="button" onClick={applySuggestedWeight}
              aria-label={`Use suggested ${suggestedWeight} ${unit} — programmed target`}
              className="h-7 rounded-md border border-primary/40 bg-primary/10 px-2 text-xs font-bold text-primary hover:bg-primary/20">
              Use {fmtNum(suggestedWeight)} {unit}
            </button>
            <button type="button" onClick={() => bumpWeight(weightIncrement(unit))}
              aria-label={`Increase weight by ${weightIncrement(unit)} ${unit}`}
              className="h-7 min-w-[36px] rounded-md border border-border bg-background px-2 text-xs font-bold hover:bg-secondary">
              +{weightIncrement(unit)}
            </button>
          </div>
        )}

        {/* Reps quick controls */}
        {repChipValues.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">Reps</span>
            {repChipValues.map((v) => {
              const isTarget = repTarget?.exact === v;
              return (
                <button key={v} type="button" onClick={() => setReps(String(v))}
                  aria-label={`Select ${v} reps${isTarget ? " — programmed target" : ""}`}
                  className={cn(
                    "h-7 min-w-[34px] rounded-md border px-2 text-xs font-bold hover:bg-secondary",
                    isTarget ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background",
                  )}>
                  {v}{isTarget && <span className="ml-1 text-[9px] font-normal opacity-70">★</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* RPE quick controls */}
        {rpeChipValues.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">RPE</span>
            {rpeChipValues.map((v) => {
              const isTarget = rpeTarget?.exact === v;
              return (
                <button key={v} type="button" onClick={() => setRpe(String(v))}
                  aria-label={`Select RPE ${v}${isTarget ? " — programmed target" : ""}`}
                  className={cn(
                    "h-7 min-w-[34px] rounded-md border px-2 text-xs font-bold hover:bg-secondary",
                    isTarget ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background",
                  )}>
                  {fmtNum(v)}{isTarget && <span className="ml-1 text-[9px] font-normal opacity-70">★</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* RIR quick controls (only when RIR is programmed and RPE isn't) */}
        {showRir && rirChipValues.length > 0 && (
          <div className="flex flex-wrap items-center gap-1">
            <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mr-1">RIR</span>
            {rirChipValues.map((v) => {
              const isTarget = rirTarget?.exact === v;
              return (
                <button key={v} type="button" onClick={() => setRpe(String(Math.max(0, 10 - v)))}
                  aria-label={`Select ${v} RIR${isTarget ? " — programmed target" : ""}`}
                  className={cn(
                    "h-7 min-w-[34px] rounded-md border px-2 text-xs font-bold hover:bg-secondary",
                    isTarget ? "border-primary/40 bg-primary/10 text-primary" : "border-border bg-background",
                  )}>
                  {v}{isTarget && <span className="ml-1 text-[9px] font-normal opacity-70">★</span>}
                </button>
              );
            })}
          </div>
        )}

        {/* Row actions */}
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          <Button size="sm" variant="outline" onClick={useTargets} className="h-7 px-2 text-[11px]">
            Quick Inputs
          </Button>
          {setIndex > 1 && prevExisting?.completed_at && (
            <Button size="sm" variant="outline" onClick={copyPrevious} className="h-7 px-2 text-[11px]">
              Copy Previous
            </Button>
          )}
        </div>
      </div>
    )}

    {/* Apply to remaining sets (visible after this set is confirmed) */}
    {!readonly && isConfirmed && hasUncompletedAfter && onApplyToRemaining && (
      <div className="px-3 pb-2">
        <Button
          size="sm"
          variant="ghost"
          className="h-7 px-2 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={async () => {
            const ok = typeof window !== "undefined" ? window.confirm("Apply this result to the remaining sets as drafts?") : true;
            if (!ok) return;
            await onApplyToRemaining(setIndex, { load, reps, rpe, unit });
          }}>
            Apply to remaining sets
        </Button>
      </div>
    )}

    {isTime && prescribedSec && (
      <>
        <WorkoutTimerSheet
          open={timerOpen}
          onOpenChange={setTimerOpen}
          exerciseName={exerciseName ?? "Exercise"}
          setIndex={setIndex}
          setCount={setCount ?? 1}
          prescribedSeconds={prescribedSec}
          resumeKey={`${rowId}:${setIndex}:${clientId ?? "anon"}`}
          onComplete={onTimerComplete}
        />
        <QuickConfirmDuration
          open={quickOpen}
          onOpenChange={setQuickOpen}
          prescribedSeconds={prescribedSec}
          onConfirm={(secs, method) => {
            setQuickOpen(false);
            void saveTimeCompletion(secs, { method });
          }}
        />
      </>
    )}
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