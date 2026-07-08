import { Link, useNavigate } from "@tanstack/react-router";
import { Component, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Clock, CheckCircle2, Circle, Play, StickyNote, NotebookPen, Info, Maximize2, Minimize2, AlertTriangle, RefreshCw, Send, MessageCircle, ChevronDown, ChevronUp, Move, Zap, Trophy } from "lucide-react";
import { MoveWorkoutSheet } from "@/components/schedule/MoveWorkoutSheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { getExerciseVideoSource } from "@/lib/exercise-video";
import { useExerciseVideoSetGlobal } from "@/hooks/use-exercise-video-set";
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
import { useUnsavedWarning } from "@/hooks/use-unsaved-warning";
import { useBodyScrollLock } from "@/hooks/use-body-scroll-lock";
import { SaveStatus } from "@/components/save-status";
import { ActionButton } from "@/components/action-button";
import { TrainingHelpButton } from "@/components/training-help-sheet";
import { WarmupButton } from "@/components/warmup-sheet";
import { dayScheduledDate, cleanDayTitle } from "@/lib/workout-today";
import { format, startOfDay } from "date-fns";
import { useServerFn } from "@tanstack/react-start";
import { notifyCoachOfWorkoutFailure } from "@/lib/support-alerts.functions";
import { getRowBlockSummariesFn } from "@/lib/exercise-blocks.functions";
import {
  startWorkout as startWorkoutFn,
  saveDraft as saveDraftFn,
  completeWorkout as completeWorkoutFn,
} from "@/lib/workout-completion.functions";
import { runJob } from "@/lib/progress-jobs";
import { cn } from "@/lib/utils";
import { WorkoutEmptyCard } from "@/components/workout-empty-state";
import { useAuth } from "@/lib/auth";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { writeSetEditAudit } from "@/lib/logged-set-audit";
import { resolveExerciseUnit, modeUnit, saveExerciseUnitPref, type WUnit } from "@/lib/exercise-unit-prefs";
import { persistedUnitForValue } from "@/lib/workout-unit-persistence";
import { WorkoutUndoProvider, useWorkoutUndo, UndoButton } from "@/lib/workout-undo";
import { WorkoutSyncBanner } from "@/components/workout-sync-banner";
import { writePlanCache, cachedInitialData } from "@/lib/workout-plan-cache";
import { enqueueOfflineWrite, registerQueueHandler } from "@/lib/workout-offline-queue";
import { saveOfflineCompletion } from "@/lib/offline/workout-completion-store";
import { ActiveRestTimerProvider, useRestTimer } from "@/components/active-rest-timer";
import { RestTimerButton } from "@/components/workout-day/RestTimerButton";
import { ExerciseHistoryButton } from "@/components/exercise-history-sheet";
import { QuickSwapButton } from "@/components/workout-day/QuickSwapButton";
import { convertWeight } from "@/lib/progress-metrics";
import { WorkoutCompleteSheet, type WorkoutCompletePayload } from "@/components/workout-complete-sheet";
import { submitOrEditReview } from "@/lib/workout-completion.functions";
import { DurationTimerInCard } from "@/components/workout-day/DurationTimerInCard";
import { WorkoutSubmissionSummary } from "@/components/workout-submission-summary";
import { computeWorkoutSummary, type WorkoutSummary } from "@/lib/workout-summary";
import { WorkoutTimerSheet, QuickConfirmDuration, type TimerCompletionPayload } from "@/components/workout-timer-sheet";
import { formatDuration } from "@/lib/duration";
import { Timer } from "lucide-react";
import type { WorkoutContextAdapter } from "@/lib/workout-context";
import {
  summarizeCompleteness,
  estimatedDurationLabel,
  type RequiredRowSpec,
  type LoggedSetSpec,
  type RowMetricKind,
  type EstimatedDurationRow,
} from "@/lib/workout-completeness";
import { useWorkoutHeartbeat, readHeartbeatTimestamps, clearHeartbeatTimestamps } from "@/hooks/use-workout-heartbeat";
import { computeActiveSeconds } from "@/lib/workout-duration";
import { LoggingQualityBadge } from "@/components/workout/shared/logging-quality-badge";
import { CompletedWorkoutActions } from "@/components/workout/shared/completed-workout-actions";
import { WorkoutStatusBar } from "@/components/workout-day/WorkoutStatusBar";
import { WorkoutTimer, computeActiveDurationMin } from "@/components/workout-day/WorkoutTimer";

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

/**
 * Shared workout day view.
 *
 * Phase B extraction: the entire client logger body lives here, accepting
 * `dayId` + `search` from props instead of route params. Phase C/D will
 * progressively replace internal `sb.from("pl_*")` reads/writes with
 * `adapter.*` calls so the member route can mount this same component.
 * Until then, this component is only mounted from the portal route (kind=client)
 * and behaviour is byte-identical with the previous monolith route.
 */
export type WorkoutDayViewSearch = {
  readonly?: 1;
  edit?: 1;
  review?: 1;
  recap?: 1;
  /**
   * Slice 2b: pl_scheduled_workouts.id of the calendar instance the
   * player opened. When present, the client adapter scopes completion
   * reads/writes by scheduled_workout_id.
   */
  instance?: string;
};

/**
 * Navigation paths injected by the route that mounts this view. Keeps the
 * shared component free of `/portal/...` vs `/m/...` knowledge so it can
 * mount under either the coach/portal flow or the member flow.
 */
export type WorkoutDayViewNavigation = {
  /** Back-button target in the PageHeader. */
  backTo: string;
  /** Full-list page for "All workouts" links + post-completion navigation. */
  listPath: string;
  /** Messages page for "Contact Coach" / "Message Coach" CTAs. */
  messagesPath: string;
};

const WorkoutNavigationContext = createContext<WorkoutDayViewNavigation | null>(null);

function useWorkoutNavigation(): WorkoutDayViewNavigation {
  const ctx = useContext(WorkoutNavigationContext);
  if (!ctx) {
    throw new Error("WorkoutDayView navigation context missing — wrap in <WorkoutDayView navigation={...} />");
  }
  return ctx;
}

/**
 * Optional adapter context. When `null`, write sites fall back to direct
 * `sb.from("pl_*")` calls (legacy portal path). When set, every write
 * routes through `adapter.upsertPl*Raw` — byte-identical for the client
 * adapter (passthrough), and reshaped into `member_*` tables by the
 * member adapter in turn 4c.
 */
const WorkoutAdapterContext = createContext<WorkoutContextAdapter | null>(null);
function useOptionalAdapter(): WorkoutContextAdapter | null {
  return useContext(WorkoutAdapterContext);
}

export function WorkoutDayView({
  dayId,
  search,
  adapter,
  navigation,
  children,
}: {
  dayId: string;
  search: WorkoutDayViewSearch;
  /**
   * Phase C′ (feature-gated): when provided, future read/write paths
   * route through this adapter so the same component can mount under
   * both the coach/portal and member flows. When `undefined` (the
   * default), the legacy direct-`sb.from("pl_*")` paths run unchanged,
   * keeping the portal route byte-identical. Conversion of individual
   * call sites happens incrementally in follow-up turns.
   */
  adapter?: WorkoutContextAdapter;
  navigation: WorkoutDayViewNavigation;
  children?: ReactNode;
}) {
  return (
    <WorkoutNavigationContext.Provider value={navigation}>
      <WorkoutAdapterContext.Provider value={adapter ?? null}>
        <WorkoutUndoProvider>
          <ActiveRestTimerProvider>
            <WorkoutDay dayId={dayId} search={search} adapter={adapter} navigation={navigation}>
              {children}
            </WorkoutDay>
          </ActiveRestTimerProvider>
        </WorkoutUndoProvider>
      </WorkoutAdapterContext.Provider>
    </WorkoutNavigationContext.Provider>
  );
}

const sb = supabase as any;

/**
 * Derive the swap-persistence target for an exercise row. Members
 * persist swaps in `member_exercise_swaps` keyed by (enrollment, week,
 * day, exercise_index); coaches/clients persist by mutating
 * `pl_exercise_rows`. Returns `undefined` when the adapter is missing
 * or the row id can't be decoded (defaults to the client write path).
 */
function swapContextForRow(
  adapter: WorkoutContextAdapter | undefined,
  dayId: string,
  rowId: string,
):
  | { kind: "client" }
  | { kind: "member"; enrollmentId: string; weekIndex: number; dayIndex: number; exerciseIndex: number }
  | undefined {
  if (!adapter) return undefined;
  if (adapter.kind !== "member") return { kind: "client" };
  const enrollmentId = (adapter.ref as any).enrollmentId as string | undefined;
  if (!enrollmentId) return undefined;
  const [wRaw, dRaw] = dayId.split(":");
  const weekIndex = Number(wRaw);
  const dayIndex = Number(dRaw);
  const m = /^ex:(\d+)$/.exec(rowId);
  const exerciseIndex = m ? Number(m[1]) : NaN;
  if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex) || !Number.isFinite(exerciseIndex)) {
    return undefined;
  }
  return { kind: "member", enrollmentId, weekIndex, dayIndex, exerciseIndex };
}

function withMemberWorkoutIndexes<T extends Record<string, any>>(
  payload: T,
  adapter: WorkoutContextAdapter | null | undefined,
  dayId: string | null | undefined,
): T {
  if (adapter?.kind !== "member" || !dayId) return payload;
  const [weekIndexRaw, dayIndexRaw] = String(dayId).split(":");
  const weekIndex = Number(weekIndexRaw);
  const dayIndex = Number(dayIndexRaw);
  if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return payload;
  return { ...payload, week_index: weekIndex, day_index: dayIndex };
}

function WorkoutDay({
  dayId,
  search,
  adapter,
  navigation,
  children,
}: {
  dayId: string;
  search: WorkoutDayViewSearch;
  adapter?: WorkoutContextAdapter;
  navigation: WorkoutDayViewNavigation;
  children?: ReactNode;
}) {
  const portalUserId = usePortalUserId();
  // Phase B turn 2: day/rows/results reads route through the adapter when
  // provided. Other reads/writes still on sb.* for now (turns 3/4).
  const qc = useQueryClient();
  const undo = useWorkoutUndo();
  const cacheScope = `portal:${dayId}`;
  // Gate the workout-detail queries on a fully hydrated auth session.
  // Root cause of the Ashley Santos "No exercises assigned" bug: on cold
  // launches (mobile PWA especially) `pl_exercise_rows` was queried
  // before `auth.uid()` resolved on the network, so the RLS policy
  // silently returned 0 rows and the previous `?? []` swallowed the
  // error into a false-empty state. `useAuth()` exposes `loading` +
  // `user` so we can wait for the session before hitting Supabase.
  const { user: authUser, loading: authLoading } = useAuth();
  const authReady = !authLoading && !!authUser;

  // Register a passthrough handler so any autosave that hits its
  // permanent-failure threshold can hand the write to the durable queue.
  // The queue retries on its own schedule and escalates to coaches after 3
  // more attempts. Handler is idempotent: payload describes table + row.
  useEffect(() => {
    registerQueueHandler("portal_table_upsert", async (p: any) => {
      if (!p?.table) return;
      // Route through the active adapter when one is mounted so member
      // contexts replay queued writes against member_* tables, not pl_*.
      // Falls back to direct sb.from() for legacy portal-only deploys.
      if (adapter) {
        if (p.table === "pl_row_results") {
          await adapter.upsertPlRowResultRaw(p.payload, p.id ?? null);
          return;
        }
        if (p.table === "pl_exercise_notes") {
          await adapter.upsertPlExerciseNoteRaw(p.payload, p.id ?? null);
          return;
        }
        if (p.table === "pl_day_completions") {
          await adapter.upsertPlDayCompletionRaw(p.payload, p.id ?? null);
          return;
        }
      }
      if (p.id) {
        const { error } = await sb.from(p.table).update(p.payload).eq("id", p.id);
        if (error) throw error;
      } else if (p.table === "pl_row_results") {
        const { error } = await sb.from(p.table)
          .upsert(p.payload, { onConflict: "row_id,client_id,set_index" });
        if (error) throw error;
      } else if (p.table === "pl_day_completions") {
        const { error } = await sb.from(p.table)
          .upsert(p.payload, { onConflict: "day_id,client_id" });
        if (error) throw error;
      } else {
        const { error } = await sb.from(p.table).insert(p.payload);
        if (error) throw error;
      }
    });
  }, [adapter]);

  const { data: clientFromQuery } = useQuery({
    queryKey: [
      "workout-subject",
      adapter?.kind ?? null,
      adapter?.ref.ownerId ?? portalUserId ?? null,
    ],
    enabled: adapter ? true : !!portalUserId,
    queryFn: async () => {
      if (adapter) return await adapter.getActiveSubject();
      return (
        await supabase
          .from("clients")
          .select("id, full_name, preferred_weight_unit")
          .eq("user_id", portalUserId!)
          .maybeSingle()
      ).data;
    },
  });
  // Desktop Client POV regression fix: when a coach/admin enters Client POV
  // and `adapter.getActiveSubject()` returns null (e.g. RLS edge, transient
  // hiccup), the previous code left `client` undefined which disabled every
  // downstream `enabled: !!client?.id` query (results, completion, notes,
  // feedback) — the page rendered exercise rows but no logged values. On
  // mobile this was masked by stale localStorage plan-cache; on desktop the
  // coach saw an empty workout. The adapter already carries the canonical
  // clients.id as `adapter.ref.ownerId`, so synthesize a minimal subject
  // from it whenever the subject query has not produced one yet. Real
  // `getActiveSubject` data still wins (provides full_name + weight unit).
  const client = useMemo(() => {
    if (clientFromQuery) return clientFromQuery as any;
    // Fallback: if getActiveSubject() returned null (RLS edge, transient hiccup),
    // synthesize a minimal subject from the adapter's ownerId so downstream
    // queries (results, completion, notes, inputs) remain enabled.
    // Applies to both client POV (adapter.kind==='client') and member workouts (adapter.kind==='member').
    if (adapter && adapter.ref.ownerId) {
      return { id: adapter.ref.ownerId, full_name: null, preferred_weight_unit: null } as any;
    }
    return clientFromQuery as any;
  }, [clientFromQuery, adapter]);

  const { data: day } = useQuery({
    queryKey: ["pl-day", dayId, adapter?.kind ?? null, adapter?.ref.ownerId ?? null],
    initialData: cachedInitialData<any>(cacheScope, "day"),
    // Days don't mutate while a workout is open. Treat as fresh for the
    // whole session so remounts (tab toggles, back nav) are instant.
    staleTime: 5 * 60_000,
    enabled: authReady,
    retry: 2,
    queryFn: async () => {
      let d: any;
      if (adapter) {
        d = await adapter.getDayRaw(dayId);
      } else {
        const { data, error } = await sb.from("pl_days").select("*").eq("id", dayId).maybeSingle();
        if (error) throw error;
        d = data;
      }
      if (d) writePlanCache(cacheScope, "day", d);
      return d;
    },
  });

  // Resolve week + block in a single round-trip via the FK join.
  // Previously this was three sequential queries (day → week.block_id →
  // week → block), causing visible pop-in as each settled. Weeks/blocks
  // are immutable for an open workout, so cache for the session.
  const { data: weekWithBlock = null } = useQuery({
    queryKey: ["pl-week-with-block", day?.week_id],
    enabled: !!day?.week_id,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      const { data } = await sb
        .from("pl_weeks")
        .select("*, pl_blocks(*)")
        .eq("id", day.week_id)
        .maybeSingle();
      return data;
    },
  });
  const week = weekWithBlock
    ? (() => {
        const { pl_blocks: _pl_blocks, ...rest } = weekWithBlock as any;
        return rest;
      })()
    : null;
  const block = (weekWithBlock as any)?.pl_blocks ?? null;
  const blockId = (block as any)?.id ?? (weekWithBlock as any)?.block_id ?? null;

  const scheduledDate = useMemo(() => {
    if (!day) return null;
    return dayScheduledDate({ day, week, block, completion: null } as any);
  }, [day, week, block]);
  const today = startOfDay(new Date());
  const isOutsideScheduledDay = !!scheduledDate && scheduledDate.getTime() !== today.getTime();

  const { isImpersonating } = useClientImpersonation();
  const scheduledWorkoutId = adapter?.kind === "client"
    ? adapter.ref.scheduledWorkoutId ?? (search as any)?.instance ?? null
    : null;
  // Workouts are ALWAYS editable — past, today, future, completed. There is no
  // automatic lock based on date, block status, program status, or completion.
  // The only way a workout becomes read-only is an explicit manual lock
  // (currently none exist). Admin/coach POV mode also stays fully editable so
  // they can fix client logs in place.
  const readonly = false;

  const {
    data: rows = [],
    isSuccess: rowsLoaded,
    isFetching: rowsFetching,
    isError: rowsIsError,
    error: rowsError,
    refetch: refetchRows,
  } = useQuery({
    queryKey: ["pl-day-rows", dayId, adapter?.kind ?? null, adapter?.ref.ownerId ?? null],
    initialData: cachedInitialData<any[]>(cacheScope, "rows"),
    staleTime: 5 * 60_000,
    gcTime: 10 * 60_000,
    // Never run the exercise-rows read before Supabase has a session —
    // otherwise the RLS policy on pl_exercise_rows filters everything
    // out and we render the false-empty state.
    enabled: authReady,
    retry: 2,
    retryDelay: (attempt) => Math.min(1500 * 2 ** attempt, 6_000),
    queryFn: async () => {
      let r: any[];
      if (adapter) {
        r = await adapter.listRowsRaw(dayId);
      } else {
        const { data, error } = await sb
          .from("pl_exercise_rows")
          .select("*, exercises(id,name,video_url,vimeo_embed_url,secondary_vimeo_embed_url,active_video_set,thumbnail_url,cues,common_mistakes,muscle_group,category,pl_lift_group,warmup_protocol_id,is_powerlifting,warmup_notes,default_load_unit,exercise_category,is_competition_lift,competition_lift_type,default_measurement_type,duration_seconds)")
          .eq("day_id", dayId)
          .order("sort_order");
        // Surface RLS / network errors to react-query so the failure
        // card renders and retries kick in, instead of silently
        // collapsing to an empty array (root cause of Ashley Santos'
        // "No exercises are assigned" report).
        if (error) throw error;
        r = data ?? [];
      }
      // Secondary lookup: for rows that have exercise_name_override but no exercise_id,
      // look up the exercise by name so the How To sheet can show the Vimeo video.
      const nameOnlyRows = (r as any[]).filter((row) => !row.exercise_id && row.exercise_name_override);
      if (nameOnlyRows.length > 0) {
        const names = [...new Set(nameOnlyRows.map((row: any) => row.exercise_name_override as string))];
        const { data: exByName } = await sb.from("exercises").select("id,name,video_url,vimeo_embed_url,secondary_vimeo_embed_url,active_video_set,thumbnail_url,cues,common_mistakes,muscle_group,category,pl_lift_group,warmup_protocol_id,is_powerlifting,warmup_notes,default_load_unit,exercise_category,is_competition_lift,competition_lift_type,default_measurement_type,duration_seconds").in("name", names);
        if (exByName && exByName.length > 0) {
          const nameMap = new Map<string, any>(exByName.map((e: any) => [e.name, e]));
          for (const row of r as any[]) {
            if (!row.exercise_id && row.exercise_name_override && nameMap.has(row.exercise_name_override)) {
              row.exercises = nameMap.get(row.exercise_name_override);
            }
          }
        }
      }
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
    queryKey: ["pl-day-results", dayId, client?.id, adapter?.kind ?? null, adapter?.ref.ownerId ?? null, scheduledWorkoutId],
    enabled: !!client?.id && (rows as any[]).length > 0,
    initialData: client?.id ? cachedInitialData<any[]>(cacheScope, `results:${client.id}`) : undefined,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    // Override global refetchOnWindowFocus:false — when the user switches from
    // iPad to iPhone (app resume / tab focus) we want the latest set data.
    refetchOnWindowFocus: true,
    queryFn: async () => {
      const rowIds = (rows as any[]).map((r) => r.id);
      if (!rowIds.length) return [];
      const r = adapter
        ? await adapter.listRowResultsRaw(dayId)
        : (await sb.from("pl_row_results").select("*").in("row_id", rowIds).eq("client_id", client!.id)).data ?? [];
      writePlanCache(cacheScope, `results:${client!.id}`, r);
      return r;
    },
  });

  // ── Cross-device real-time sync ──────────────────────────────────────────
  // Subscribe to Supabase Realtime for pl_row_results so that when a set is
  // saved on one device (e.g. iPad) every other device (e.g. iPhone) gets an
  // instant cache invalidation and re-fetches the latest results within ~1 s.
  const rowIds = useMemo(() => (rows as any[]).map((r: any) => r.id as string), [rows]);
  useEffect(() => {
    if (!client?.id || rowIds.length === 0) return;
    const channelName = `workout-results:${dayId}:${client.id}`;
    const channel = supabase
      .channel(channelName)
      .on(
        // @ts-ignore — "postgres_changes" is a valid Realtime event type
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "pl_row_results",
          filter: `client_id=eq.${client.id}`,
        },
        (payload: any) => {
          // Only invalidate when the changed row belongs to this workout day.
          const changedRowId: string | undefined =
            payload?.new?.row_id ?? payload?.old?.row_id;
          if (!changedRowId || rowIds.includes(changedRowId)) {
            qc.invalidateQueries({ queryKey: ["pl-day-results", dayId] });
          }
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client?.id, dayId, rowIds.join(","), qc]);
  // ────────────────────────────────────────────────────────────────────────

  // ── Member real-time multi-device sync ──────────────────────────────────
  // Mirror the client realtime channel for member workouts: when a member
  // saves a set on one device, every other device viewing the same workout
  // refetches `listRowResults` + completion within ~1s. Filtered by
  // enrollment_id, scoped to the active (week, day) tuple.
  const memberRealtimeCtx = (() => {
    if (adapter?.kind !== "member" || !adapter.ref.enrollmentId) return null;
    const [w, d] = dayId.split(":");
    const weekIndex = Number(w);
    const dayIndex = Number(d);
    if (!Number.isFinite(weekIndex) || !Number.isFinite(dayIndex)) return null;
    return { enrollmentId: adapter.ref.enrollmentId, weekIndex, dayIndex };
  })();
  useEffect(() => {
    if (!memberRealtimeCtx) return;
    const { enrollmentId, weekIndex, dayIndex } = memberRealtimeCtx;
    const channel = supabase
      .channel(`member-workout:${enrollmentId}:${weekIndex}:${dayIndex}`)
      .on(
        // @ts-ignore — "postgres_changes" is a valid Realtime event type
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "member_set_logs",
          filter: `enrollment_id=eq.${enrollmentId}`,
        },
        (payload: any) => {
          const w = payload?.new?.week_index ?? payload?.old?.week_index;
          const d = payload?.new?.day_index ?? payload?.old?.day_index;
          if (w === weekIndex && d === dayIndex) {
            qc.invalidateQueries({ queryKey: ["pl-day-results", dayId] });
          }
        },
      )
      .on(
        // @ts-ignore
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "member_workout_completions",
          filter: `enrollment_id=eq.${enrollmentId}`,
        },
        (payload: any) => {
          const w = payload?.new?.week_index ?? payload?.old?.week_index;
          const d = payload?.new?.day_index ?? payload?.old?.day_index;
          if (w === weekIndex && d === dayIndex) {
            qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
            qc.invalidateQueries({ queryKey: ["m-completions", enrollmentId] });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberRealtimeCtx?.enrollmentId, memberRealtimeCtx?.weekIndex, memberRealtimeCtx?.dayIndex, dayId, qc]);
  // ────────────────────────────────────────────────────────────────────────

  // Slice 3 client fail-safe. A row "is unsupported" when it carries
  // any non-Straight block, or more than one block — i.e. anything the
  // legacy logger would otherwise mis-render or silently flatten. The
  // server-side activation guard prevents this state from reaching a
  // client-visible program under normal flow; the fail-safe exists for
  // exactly the rare scenario where a row slipped through (e.g. logger
  // toggled on, then a program containing unsupported blocks is opened
  // while the toggle is off again).
  const rowBlockSummariesFn = useServerFn(getRowBlockSummariesFn);
  const startWorkoutSrv = useServerFn(startWorkoutFn);
  const saveDraftSrv = useServerFn(saveDraftFn);
  const completeWorkoutSrv = useServerFn(completeWorkoutFn);
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
    queryKey: ["pl-day-completion", dayId, client?.id, adapter?.kind ?? null, scheduledWorkoutId],
    enabled: !!client?.id,
    // Completion state is critical — always fetch fresh to prevent stuck UI states
    // where the workout appears both completed and incomplete simultaneously.
    staleTime: 0,
    initialData: client?.id ? cachedInitialData<any>(cacheScope, `completion:${client.id}`) : undefined,
    queryFn: async () => {
      const c = adapter
        ? await adapter.getDayCompletionRaw(dayId)
        : (await sb.from("pl_day_completions").select("*").eq("day_id", dayId).eq("client_id", client!.id).maybeSingle()).data;
      writePlanCache(cacheScope, `completion:${client!.id}`, c);
      return c;
    },
  });

  // Exercise notes for this day
  const { data: exerciseNotes = [], isLoading: notesLoading } = useQuery({
    queryKey: ["pl-day-exercise-notes", dayId, client?.id, adapter?.kind ?? null],
    enabled: !!client?.id,
    staleTime: 60_000,
    queryFn: async () =>
      adapter
        ? await adapter.listExerciseNotesRaw(dayId)
        : (await sb.from("pl_exercise_notes").select("*").eq("client_id", client!.id).eq("day_id", dayId)).data ?? [],
  });

  // Existing review (pl_workout_feedback) for the post-completion actions card.
  // Scoped by client + day; one row per (client, day) thanks to the Phase 1 unique constraint.
  const { data: existingReview } = useQuery({
    queryKey: ["pl-workout-feedback", dayId, client?.id, adapter?.kind ?? null],
    enabled: !!client?.id && !!completion?.completed_at,
    staleTime: 60_000,
    queryFn: async () => {
      if (adapter) {
        return (await adapter.getWorkoutFeedbackRaw(dayId)) as any;
      }
      const { data } = await sb
        .from("pl_workout_feedback")
        .select("*")
        .eq("day_id", dayId)
        .eq("client_id", client!.id)
        .maybeSingle();
      return data as any;
    },
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
    // Client POV (coach/admin viewing as client) is review-only — never auto-
    // start a workout from this session. The server fn resolves clients.id
    // from auth.uid(), which in POV is the coach, not the client; calling it
    // here would either fail silently or write a pl_day_completions row
    // against the coach's own client_id. Reviewers must use the explicit
    // "Set workout status" controls instead.
    if (isImpersonating) { startedRef.current = true; return; }
    if (completion?.started_at) { startedRef.current = true; return; }
    startedRef.current = true;
    (async () => {
      try {
        const isMember = adapter?.kind === "member";
        const memberRef = isMember ? (adapter?.ref as any) : null;
        const startData = isMember && memberRef?.enrollmentId
          ? { kind: "member" as const, enrollmentId: memberRef.enrollmentId, weekIndex: Number(dayId.split(":")[0]), dayIndex: Number(dayId.split(":")[1]) }
          : { kind: "client" as const, dayId };
        await startWorkoutSrv({ data: startData });
        qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
        if (isMember) qc.invalidateQueries({ queryKey: ["member-workout-completion"] });
      } catch (err) {
        // Soft-fail: starting is best-effort; later writes will create the row.
        console.warn("startWorkout failed", err);
      }
    })();
  }, [client?.id, completion?.id, completion?.started_at, dayId, qc, startWorkoutSrv, isImpersonating, adapter]);

  // Mark in_progress when any meaningful entry occurs
  const markInProgress = async () => {
    if (!client?.id) return;
    // Same POV safety as startWorkout above — coach/admin reviewing a
    // client's workout must not flip the client's in_progress timestamp.
    if (isImpersonating) return;
    if (completion?.in_progress_at) return;
    try {
      const isMember = adapter?.kind === "member";
      const memberRef = isMember ? (adapter?.ref as any) : null;
      const startData = isMember && memberRef?.enrollmentId
        ? { kind: "member" as const, enrollmentId: memberRef.enrollmentId, weekIndex: Number(dayId.split(":")[0]), dayIndex: Number(dayId.split(":")[1]) }
        : { kind: "client" as const, dayId };
      await startWorkoutSrv({ data: startData });
      qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
      if (isMember) qc.invalidateQueries({ queryKey: ["member-workout-completion"] });
    } catch (err) {
      console.warn("markInProgress failed", err);
    }
  };

  // Heartbeat: persist activity timestamps to localStorage while the
  // workout is in-flight so the final active_duration_seconds reflects
  // real engaged time and survives a mid-workout refresh.
  const heartbeatEnabled = !!completion?.id && !completion?.completed_at && !readonly && !isImpersonating;
  // Ping shape depends on the mounted adapter: members address workouts by
  // (enrollmentId, weekIndex, dayIndex) tuples (the member adapter encodes
  // these into the `"week:day"` dayId), so the heartbeat must report the
  // tuple — there's no `pl_day_completions` row to key by on the member
  // side. Falls back to the legacy client ping when no member adapter is
  // mounted, keeping the portal route byte-identical.
  const heartbeatPing = (() => {
    if (adapter?.kind === "member" && adapter.ref.enrollmentId) {
      const [w, d] = dayId.split(":");
      const weekIndex = Number(w);
      const dayIndex = Number(d);
      if (Number.isFinite(weekIndex) && Number.isFinite(dayIndex)) {
        return {
          kind: "member" as const,
          enrollmentId: adapter.ref.enrollmentId,
          weekIndex,
          dayIndex,
        };
      }
    }
    return { kind: "client" as const, dayId };
  })();
  useWorkoutHeartbeat(
    heartbeatEnabled
      ? { enabled: true, completionId: completion!.id, ping: heartbeatPing }
      : { enabled: false },
  );

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
    queryKey: ["client-exercise-unit-prefs", adapter?.kind ?? "client", client?.id, exerciseIds.join(",")],
    enabled: !!client?.id && exerciseIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      // Route through the adapter so the member adapter can read its own
      // member_exercise_unit_prefs table (parity with client side).
      if (adapter) {
        const list = await adapter.listUnitPrefs(exerciseIds);
        return list.map((p) => ({ exercise_id: p.exerciseId, unit: p.unit }));
      }
      return (
        (await sb.from("client_exercise_unit_prefs").select("exercise_id, unit").eq("client_id", client!.id).in("exercise_id", exerciseIds)).data ?? []
      );
    },
  });

  const { data: historyRows = [] } = useQuery({
    queryKey: ["client-exercise-unit-history", client?.id, exerciseIds.join(",")],
    enabled: !!client?.id && exerciseIds.length > 0,
    staleTime: 5 * 60_000,
    queryFn: async () => (await sb
      .from("pl_row_results")
      .select("actual_load_unit, pl_exercise_rows!inner(exercise_id)")
      .eq("client_id", client!.id)
      .in("pl_exercise_rows.exercise_id", exerciseIds)
      .not("actual_load_unit", "is", null)
      .order("created_at", { ascending: false })
      // 50 is enough — we only need the most recent unit per exercise (not full history).
      .limit(50)).data ?? [],
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
      const rowKey = `row:${r.id}`;
      // Per-row override only — two cards with the same exerciseId (e.g.
      // a primary + secondary backoff of the same lift) must toggle
      // independently. The persisted client/member preference (saved by
      // exerciseId) still seeds future workouts via resolveExerciseUnit.
      const local = unitOverrides[rowKey];
      // Sensible defaults when there's no explicit preference/history:
      //   Competition squat, bench, deadlift → kg
      //   Everything else → lb
      const isCompLift =
        r.exercises?.is_competition_lift === true ||
        r.exercises?.competition_lift_type === "squat" ||
        r.exercises?.competition_lift_type === "bench" ||
        r.exercises?.competition_lift_type === "deadlift";
      const libraryDefault: WUnit | null =
        r.exercises?.default_load_unit === "kg" || r.exercises?.default_load_unit === "lb"
          ? r.exercises.default_load_unit
          : (isCompLift ? "kg" : "lb");
      map[rowKey] = local ?? resolveExerciseUnit({
        prefUnit: exId ? prefByEx[exId] ?? null : null,
        historyUnit: exId ? modeUnit(historyByEx[exId] ?? []) : null,
        rowLoadUnit: (r.load_unit === "kg" || r.load_unit === "lb") ? r.load_unit : null,
        exerciseDefault: libraryDefault,
        workoutUnit: isCompLift ? "kg" : "lb",
      });
    }
    return map;
  }, [rows, prefRows, historyRows, unitOverrides, unit]);

  const setExerciseUnit = async (exerciseId: string | null, rowId: string, next: WUnit) => {
    const key = `row:${rowId}`;
    const prevUnit = unitOverrides[key];
    setUnitOverrides((m) => ({ ...m, [key]: next }));
    if (client?.id && exerciseId) {
      try {
        if (adapter) {
          await adapter.saveExerciseUnitPref({ exerciseId, unit: next });
        } else {
          await saveExerciseUnitPref(client.id, exerciseId, next);
        }
      } catch { /* non-blocking */ }
      qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs"] });
    }
    undo.push({
      label: `Set exercise unit to ${next.toUpperCase()}`,
      coalesceKey: `ex-unit:${key}`,
      undo: async () => {
        setUnitOverrides((m) => ({ ...m, [key]: prevUnit as WUnit }));
        if (client?.id && exerciseId && (prevUnit === "kg" || prevUnit === "lb")) {
          try {
            if (adapter) {
              await adapter.saveExerciseUnitPref({ exerciseId, unit: prevUnit as WUnit });
            } else {
              await saveExerciseUnitPref(client.id, exerciseId, prevUnit);
            }
          } catch {}
          qc.invalidateQueries({ queryKey: ["client-exercise-unit-prefs"] });
        }
      },
    });
  };

  const unitForRow = (r: any): WUnit => {
    return resolvedUnitMap[`row:${r.id}`] ?? unit;
  };

  // Focus / full-screen logging mode.
  const [focusMode, setFocusMode] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);
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

  // After local-draft hydration, seed notes/actualMin from the saved completion
  // when the field is still empty. Without this, editing a past completed
  // workout's notes would autosave `actual_duration_min: null` and clobber the
  // previously-saved duration (and vice-versa).
  const [completionHydrated, setCompletionHydrated] = useState(false);
  useEffect(() => {
    if (!draftHydrated || completionHydrated) return;
    if (completion === undefined) return; // query still loading
    if (completion) {
      setNotes((prev) => (prev.length === 0 && completion.client_notes ? String(completion.client_notes) : prev));
      setActualMin((prev) => (prev.length === 0 && completion.actual_duration_min != null ? String(completion.actual_duration_min) : prev));
    }
    setCompletionHydrated(true);
  }, [draftHydrated, completionHydrated, completion]);

  // Autosave workout-level notes + actual minutes into pl_day_completions (draft state — does NOT set completed_at).
  const metaSave = useAutosave({
    key: draftKey,
    value: { notes, actualMin },
    delay: 1000,
    // Only autosave once both local-draft and server-completion hydration
    // have run AND the current value actually differs from what's persisted
    // on the completion row. Without this, opening a completed workout
    // hydrates the fields from the server and then immediately re-saves
    // the same values back — producing a constant "Saving…/Saved" flicker.
    enabled:
      !!client?.id &&
      draftHydrated &&
      completionHydrated &&
      (
        notes !== (completion?.client_notes ?? "") ||
        actualMin !== (completion?.actual_duration_min != null ? String(completion.actual_duration_min) : "")
      ),
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
      await saveDraftSrv({
        data: {
          kind: "client",
          dayId,
          clientNotes: notes || null,
          actualDurationMin: actualMin ? parseInt(actualMin) : null,
          actAsClientId: isImpersonating && client?.id ? client.id : null,
        } as any,
      });
      if (!completion) qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
    },
  });

  // Defer PWA updates while the workout has unsaved meta (notes / actual minutes).
  // No beforeunload prompt — set rows persist via their own autosaves and would
  // otherwise nag every time the member taps away from the page.
  useUnsavedWarning(
    metaSave.state === "saving" || metaSave.state === "offline" || metaSave.state === "error",
    { warnOnUnload: false },
  );

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pl-day-results", dayId] });
    qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
    markInProgress();
  };

  // Quick "Workout Complete" sheet state. The long review flow has been removed.
  const navigate = useNavigate();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [completeSubmitting, setCompleteSubmitting] = useState(false);
  const [summaryOpen, setSummaryOpen] = useState(false);
  const [lastSummary, setLastSummary] = useState<WorkoutSummary | null>(null);
  const [lastSessionRating, setLastSessionRating] = useState<number | null>(null);
  // Notifications can deep-link with ?review=1 to nudge the member to finish
  // an in-progress workout. Auto-open the quick popup once it lands.
  const reviewParam = search.review === 1;
  const autoOpenedReviewRef = useRef(false);
  useEffect(() => {
    if (!reviewParam) { autoOpenedReviewRef.current = false; return; }
    if (autoOpenedReviewRef.current) return;
    if (completion?.completed_at) return;
    autoOpenedReviewRef.current = true;
    setCompleteOpen(true);
  }, [reviewParam, completion?.completed_at]);

  // ?recap=1 deep-link → open the workout score/recap dialog for an
  // already-completed workout (read-only). Reuses the same summary modal
  // shown right after submission so coaches and clients see the same view.
  const recapParam = search.recap === 1;
  const autoOpenedRecapRef = useRef(false);
  const recapFromSubmitRef = useRef(false);

  // Build a summary from the current rows/results snapshot. Shared by the
  // ?recap=1 deep-link, the post-submit celebration, and the "View Score"
  // button on the completed workout page.
  const openRecapSummary = () => {
    const displayUnit: "kg" | "lb" =
      ((client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb");
    const computed = computeWorkoutSummary(
      rows as any[],
      results as any[],
      {
        displayUnit,
        hasNote: !!completion?.client_notes,
      },
    );
    setLastSummary(computed);
    recapFromSubmitRef.current = false;
    setSummaryOpen(true);
  };

  useEffect(() => {
    if (!recapParam) { autoOpenedRecapRef.current = false; return; }
    if (autoOpenedRecapRef.current) return;
    if (!completion?.completed_at) return;
    if ((rows as any[]).length === 0) return;
    autoOpenedRecapRef.current = true;
    recapFromSubmitRef.current = false;
    const displayUnit: "kg" | "lb" =
      ((client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb");
    const computed = computeWorkoutSummary(
      rows as any[],
      results as any[],
      {
        displayUnit,
        hasNote: !!completion?.client_notes,
      },
    );
    setLastSummary(computed);
    setSummaryOpen(true);
  }, [recapParam, completion?.completed_at, completion?.client_notes, rows, results, client]);

  // NOTE: useBodyScrollLock was removed here.
  // ROOT CAUSE FIX 2026-06-26: useBodyScrollLock applies position:fixed to the
  // body which conflicts with Radix's own scroll management on Sheet/Dialog
  // components. When a second Radix overlay (e.g. ExerciseHistorySheet) opens
  // while the body is already position:fixed, Radix's cleanup on close leaves
  // the body in an inconsistent state — pointer-events frozen, page unresponsive.
  // Radix Sheet and Dialog components already manage their own scroll locking
  // internally. The manual lock is redundant and causes the freeze bug.
  // void completeOpen; // keep reference to avoid lint warning

  const refreshNotes = () => {
    qc.invalidateQueries({ queryKey: ["pl-day-exercise-notes", dayId] });
    qc.invalidateQueries({ queryKey: ["client-exercise-notes", client?.id] });
    markInProgress();
  };


  if (!day) {
    return (
      <div className="mx-auto w-full max-w-3xl space-y-3 p-6" aria-busy="true" aria-label="Loading workout">
        <div className="h-7 w-2/3 animate-pulse rounded bg-muted" />
        <div className="h-4 w-1/3 animate-pulse rounded bg-muted" />
        <div className="mt-2 flex gap-2">
          <div className="h-6 w-20 animate-pulse rounded-full bg-muted" />
          <div className="h-6 w-24 animate-pulse rounded-full bg-muted" />
        </div>
        <div className="space-y-2 pt-3">
          <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
          <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
          <div className="h-24 w-full animate-pulse rounded-lg bg-muted" />
        </div>
      </div>
    );
  }

  // Shared workout summary for the pinned status bar AND the inline quality badge.
  const statusSummary = (() => {
    try {
      const detectTimed = (r: any): boolean => {
        if (r?.tracking_type === "time" || r?.measurement_type === "time") return true;
        if ((r as any)?.exercises?.default_measurement_type === "time") return true;
        if (r?.duration_seconds != null && Number(r.duration_seconds) > 0) return true;
        return /\b(sec(onds?)?|min(utes?)?)\b/i.test(String(r?.reps_text ?? ""));
      };
      const required: RequiredRowSpec[] = (rows as any[])
        .filter((r: any) => !r?.skipped)
        .map((r: any) => ({
          rowId: String(r.id),
          prescribedSets: Math.max(1, Number(r.sets) || 1),
          skipped: !!r.skipped,
          metricKind: (detectTimed(r) ? "timed" : "load_reps") as RowMetricKind,
        }));
      const logged: LoggedSetSpec[] = (results as any[]).map((x: any) => ({
        rowId: String(x.row_id),
        setIndex: x.set_index ?? 0,
        reps: x.actual_reps,
        loadLb: x.actual_load_unit === "kg" ? null : x.actual_load,
        loadKg: x.actual_load_unit === "kg" ? x.actual_load : null,
        rpe: x.actual_rpe_num ?? x.actual_rpe,
        completedDurationSeconds: x.completed_duration_seconds ?? null,
      }));
      const sum = required.length > 0 ? summarizeCompleteness(required, logged) : null;
      // Per-row sets logged → derive exercises done.
      const loggedByRow = new Map<string, number>();
      for (const s of logged) {
        // Only count confirmed (completed_at) sets toward exercise-done.
        const raw = (results as any[]).find(
          (x: any) => String(x.row_id) === s.rowId && (x.set_index ?? 0) === s.setIndex,
        );
        if (!raw?.completed_at) continue;
        // A set is only "done" if it actually has the values its kind requires.
        // A green completed_at flag without a weight / duration / reps does not
        // count — otherwise blank sets show up as completed in the status bar.
        const kind = required.find((r) => r.rowId === s.rowId)?.metricKind ?? "load_reps";
        const num = (v: any) => v != null && Number.isFinite(Number(v)) && Number(v) > 0;
        // Load of 0 is a valid log (bodyweight / unloaded). Reps still required.
        const numOrZero = (v: any) => v != null && Number.isFinite(Number(v)) && Number(v) >= 0;
        const meaningful =
          kind === "timed"
            ? num(s.completedDurationSeconds)
            : kind === "bodyweight"
              ? num(s.reps)
              : num(s.reps) && (numOrZero(s.loadLb) || numOrZero(s.loadKg));
        if (!meaningful) continue;
        loggedByRow.set(s.rowId, (loggedByRow.get(s.rowId) ?? 0) + 1);
      }
      let exercisesDone = 0;
      for (const r of required) {
        const need = Math.max(1, Number(r.prescribedSets) || 1);
        if ((loggedByRow.get(r.rowId) ?? 0) >= need) exercisesDone++;
      }
      // Confirmed sets count (for the status bar).
      let confirmedSets = 0;
      for (const n of loggedByRow.values()) confirmedSets += n;
      return {
        summary: sum,
        exercisesDone,
        exercisesTotal: required.length,
        setsDone: confirmedSets,
        setsTotal: sum?.requiredSets ?? 0,
      };
    } catch {
      return { summary: null, exercisesDone: 0, exercisesTotal: 0, setsDone: 0, setsTotal: 0 };
    }
  })();

  const statusBarVisible =
    !readonly &&
    statusSummary.exercisesTotal > 0 &&
    (!!completion?.started_at || !!completion?.in_progress_at || !!completion?.completed_at);

  return (
    <>
      {focusMode && (
        <div
          className="fixed inset-0 z-40 overflow-y-auto overflow-x-hidden bg-background workout-scroll-container"
          data-workout-focus
        >
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border bg-background/95 px-4 py-3 backdrop-blur">
            <div className="font-bold">{cleanDayTitle(day.title, day.day_index)} · Full Screen</div>
            {/* Global KG/LB toggle removed — each exercise carries its own
                authoritative unit control. */}
            <Button size="sm" variant="outline" onClick={() => setFocusMode(false)}>
              <Minimize2 className="mr-1 h-4 w-4" /> Exit Full Screen
            </Button>
          </div>
          {statusBarVisible && (
            <WorkoutStatusBar
              exercisesDone={statusSummary.exercisesDone}
              exercisesTotal={statusSummary.exercisesTotal}
              setsDone={statusSummary.setsDone}
              setsTotal={statusSummary.setsTotal}
              className="top-[52px]"
            />
          )}
          <div className="mx-auto max-w-3xl p-4 md:p-6">
            <WorkoutLoadBoundary clientId={client?.id ?? null} clientName={(client as any)?.full_name ?? null} dayId={dayId} route={`/portal/workouts/${dayId}`}>
              <div className="space-y-4 rounded-lg bg-builder-canvas p-3 sm:p-4 ring-1 ring-builder-card-border/40 workout-snap-list">
              {rowsIsError ? (
                <WorkoutLoadFailureCard
                  clientId={client?.id ?? null}
                  clientName={(client as any)?.full_name ?? null}
                  dayId={dayId}
                  route={`/portal/workouts/${dayId}`}
                  error={(rowsError as Error) ?? null}
                  onRetry={() => { void refetchRows(); }}
                />
              ) : authReady && rowsLoaded && !rowsFetching && (rows as any[]).length === 0 ? (
                <WorkoutEmptyCard
                  clientId={client?.id ?? null}
                  clientName={(client as any)?.full_name ?? null}
                  workoutId={dayId}
                  route={`/portal/workouts/${dayId}`}
                  onRetry={() => Promise.all([
                    qc.refetchQueries({ queryKey: ["pl-day-rows", dayId] }),
                    qc.refetchQueries({ queryKey: ["pl-day", dayId] }),
                    qc.refetchQueries({ queryKey: ["pl-day-results", dayId] }),
                    qc.refetchQueries({ queryKey: ["pl-day-completion", dayId] }),
                  ])}
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
                  dayTitle={cleanDayTitle(day.title, day.day_index)}
                  dayIndex={day?.day_index ?? null}
                  clientId={client?.id}
                  blockId={blockId}
                  existingResults={(results as any[]).filter((x) => x.row_id === r.id)}
                  existingNote={notesByRowId.get(r.id)}
                  notesLoading={notesLoading}
                  readonly={readonly}
                  unit={unitForRow(r)}
                  onUnitChange={(u) => setExerciseUnit(r.exercises?.id ?? null, r.id, u)}
                  focusMode
                  onChange={refresh}
                  onNoteChange={refreshNotes}
                  purposeLabel={purposeLabelById.get(r.id) ?? null}
                  swapContext={swapContextForRow(adapter, dayId, r.id)}
                />
                )
              ))}
              </div>
            </WorkoutLoadBoundary>

            {/* Finish Workout + Completed Actions inside fullscreen mode.
                 Mirror the primary Finish gate: only render once rows have
                 successfully loaded and there is at least one exercise, so a
                 transient load-failure or empty-rows state cannot complete a
                 workout. */}
            {!readonly && !completion?.completed_at && !rowsIsError && authReady && rowsLoaded && (rows as any[]).length > 0 && (
              <div className="mx-auto max-w-3xl px-4 pb-4">
                <Card className="p-4">
                  <ActionButton
                    className="w-full"
                    loadingLabel="Saving…"
                    successLabel="Finish Workout"
                    successToast="Tap to finish"
                    icon={<CheckCircle2 className="h-4 w-4" />}
                    onAction={async () => {
                      if (!client?.id) return;
                      if (completion?.completed_at) {
                        qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
                        return;
                      }
                      await metaSave.flush();
                      try {
                        await startWorkoutSrv({
                          data: {
                            kind: "client",
                            dayId,
                            actAsClientId: isImpersonating && client?.id ? client.id : null,
                          } as any,
                        });
                      } catch {}
                      if (draftKey) clearLocalDraft(draftKey);
                      refresh();
                      setFocusMode(false);
                      setCompleteOpen(true);
                    }}
                  >
                    Finish Workout
                  </ActionButton>
                </Card>
              </div>
            )}
            {completion?.completed_at && client?.id && (
              <div className="mx-auto max-w-3xl px-4 pb-4">
                <CompletedWorkoutActions
                  ctx={{ kind: "client", dayId }}
                  hasCoach
                  actAsClientId={isImpersonating ? client.id : null}
                  initialReview={
                    existingReview
                      ? {
                          overallRating: existingReview.overall_rating ?? null,
                          sessionRpe: existingReview.session_rpe ?? null,
                          pain: existingReview.pain ?? false,
                          painLevel: existingReview.pain_level ?? null,
                          painArea: existingReview.pain_area ?? null,
                          painNote: existingReview.pain_note ?? null,
                          clientNote: existingReview.client_note ?? null,
                          strengthFeel: existingReview.strength_feel ?? null,
                          fatigueFeel: existingReview.fatigue_feel ?? null,
                          hitTarget: existingReview.hit_target ?? null,
                          editCount: existingReview.review_edit_count ?? 0,
                          submittedAt: existingReview.review_submitted_at ?? existingReview.created_at ?? null,
                        }
                      : null
                  }
                  onReviewSaved={() =>
                    qc.invalidateQueries({ queryKey: ["pl-workout-feedback", dayId, client.id] })
                  }
                  onViewScore={(rating) => {
                    setLastSessionRating(rating);
                    setTimeout(() => openRecapSummary(), 350);
                  }}
                />
              </div>
            )}
          </div>
        </div>
      )}
      <PageHeader
        backTo={navigation.backTo}
        backLabel="Back to Workouts"
        title={cleanDayTitle(day.title, day.day_index)}
        subtitle={[
          block?.name,
          week?.week_index != null ? `Week ${week.week_index}` : null,
          (week as any)?.phase || null,
          day.focus || null,
        ].filter(Boolean).join(" · ")}
        actions={
          !readonly ? (
            <div className="flex items-center gap-2">
              <WorkoutTimer
                startedAt={completion?.started_at ?? completion?.in_progress_at ?? null}
                completedAt={completion?.completed_at ?? null}
              />
              <UndoButton />
            </div>
          ) : undefined
        }
      />
      <div className="p-4 md:p-8 space-y-4 pb-[calc(var(--bottom-nav-clearance,96px)+env(safe-area-inset-bottom)+24px)] md:pb-8">

        {statusBarVisible && (
          <WorkoutStatusBar
            exercisesDone={statusSummary.exercisesDone}
            exercisesTotal={statusSummary.exercisesTotal}
            setsDone={statusSummary.setsDone}
            setsTotal={statusSummary.setsTotal}
          />
        )}

        <WorkoutSyncBanner
          clientId={client?.id ?? null}
          workoutId={dayId}
          pageRoute={`/portal/workouts/${dayId}`}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="outline"><Clock className="mr-1 h-3 w-3" /> {(() => {
            // Prefer a coach-set override; otherwise derive from prescribed
            // sets + per-row rest so the pill matches what's actually
            // programmed instead of a stale 60-min default. Hardened with a
            // try/catch so a malformed row never crashes the whole workout
            // screen — fall back to the static estimate on any failure.
            try {
              if (day.duration_override_min) return durationRange(day.duration_override_min);
              const safeRows = Array.isArray(rows) ? (rows as any[]) : [];
              const estRows: EstimatedDurationRow[] = safeRows.map((r: any) => ({
                prescribedSets: Number(r?.sets) || 1,
                restSeconds: r?.rest_seconds ?? null,
                category: r?.exercises?.category ?? r?.category ?? null,
                skipped: !!r?.skipped,
              }));
              const derived = estimatedDurationLabel(estRows);
              if (derived) return derived;
            } catch (e) {
              // eslint-disable-next-line no-console
              console.warn("[WorkoutDayView] duration pill fallback:", e);
            }
            return durationRange(day.duration_estimate_min ?? 60);
          })()}</Badge>
          {completion?.completed_at && (
            <>
              <Badge variant="outline" className="text-green-500 border-green-500/30 bg-green-500/10"><CheckCircle2 className="mr-1 h-3 w-3" /> Completed</Badge>
              <Button
                size="sm"
                variant="outline"
                className="h-7 gap-1.5 border-primary/40 bg-primary/10 px-2.5 text-xs font-bold text-primary hover:bg-primary/20"
                onClick={openRecapSummary}
              >
                <Trophy className="h-3.5 w-3.5" /> View Score
              </Button>
            </>
          )}
          {completion && !completion.completed_at && (completion.in_progress_at || completion.started_at) && (
            <Badge variant="outline" className="border-amber-500/30 bg-amber-500/10 text-amber-500">In progress</Badge>
          )}
          {(() => {
            try {
              const required: RequiredRowSpec[] = (rows as any[]).map((r: any) => ({
                rowId: String(r.id),
                prescribedSets: Math.max(1, Number(r.sets) || 1),
                skipped: !!r.skipped,
                metricKind: ((
                  r?.tracking_type === "time" ||
                  r?.measurement_type === "time" ||
                  (r as any)?.exercises?.default_measurement_type === "time" ||
                  (r?.duration_seconds != null && Number(r.duration_seconds) > 0) ||
                  /\b(sec(onds?)?|min(utes?)?)\b/i.test(String(r?.reps_text ?? ""))
                ) ? "timed" : "load_reps") as RowMetricKind,
              }));
              const logged: LoggedSetSpec[] = (results as any[]).map((x: any) => ({
                rowId: String(x.row_id),
                setIndex: x.set_index ?? 0,
                reps: x.actual_reps,
                loadLb: x.actual_load_unit === "kg" ? null : x.actual_load,
                loadKg: x.actual_load_unit === "kg" ? x.actual_load : null,
                rpe: x.actual_rpe_num ?? x.actual_rpe,
                completedDurationSeconds: x.completed_duration_seconds ?? null,
              }));
              if (required.length === 0) return null;
              const sum = summarizeCompleteness(required, logged);
              return <LoggingQualityBadge quality={sum.loggingQuality} percentage={sum.loggingPercentage} />;
            } catch { return null; }
          })()}
          <div className="ml-auto flex items-center gap-2">
            {/* Global KG/LB toggle removed — per-exercise unit controls remain
                the single source of truth for unit selection. */}
            {!readonly && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => setMoveOpen(true)}
                className="h-9 gap-1"
                aria-label="Move workout to another date"
              >
                <Move className="h-4 w-4" /> Move
              </Button>
            )}
            {!readonly && (
              <Button
                size="lg"
                onClick={() => setFocusMode(true)}
                className="h-11 gap-2 bg-gradient-to-r from-primary to-primary/80 px-5 text-base font-bold text-primary-foreground shadow-lg shadow-primary/30 hover:from-primary/90 hover:to-primary/70 hover:shadow-primary/40"
              >
                <Maximize2 className="h-5 w-5" /> Full Screen
              </Button>
            )}
          </div>
        </div>

        {isImpersonating && client?.id && (!adapter || adapter.kind !== "member") && (
          <Card className="border-primary/30 bg-primary/5 p-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-primary/40 bg-primary/10 text-primary">Admin</Badge>
                <div className="text-sm font-semibold">Set workout status</div>
              </div>
              <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-border bg-background shadow-sm">
                {([
                  { key: "not_started", label: "Not started", active: !completion?.started_at && !completion?.in_progress_at && !completion?.completed_at },
                  { key: "in_progress", label: "In progress", active: !!(completion && !completion.completed_at && (completion.in_progress_at || completion.started_at)) },
                  { key: "completed", label: "Completed", active: !!completion?.completed_at },
                ] as const).map((opt) => (
                  <button
                    key={opt.key}
                    type="button"
                    onClick={async () => {
                      const now = new Date().toISOString();
                      try {
                        if (opt.key === "not_started") {
                          if (completion?.id) {
                            const payload = { started_at: null, in_progress_at: null, completed_at: null };
                            if (adapter) await adapter.upsertPlDayCompletionRaw(payload, completion.id);
                            else await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                          }
                        } else if (opt.key === "in_progress") {
                          if (completion?.id) {
                            const payload = { started_at: completion.started_at ?? now, in_progress_at: now, completed_at: null };
                            if (adapter) await adapter.upsertPlDayCompletionRaw(payload, completion.id);
                            else await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                          } else {
                            const payload = { day_id: dayId, client_id: client.id, started_at: now, in_progress_at: now, completed_at: null };
                            if (adapter) await adapter.upsertPlDayCompletionRaw(payload, null);
                            else await sb.from("pl_day_completions").insert(payload);
                          }
                        } else if (opt.key === "completed") {
                          if (completion?.id) {
                            const payload = { started_at: completion.started_at ?? now, in_progress_at: completion.in_progress_at ?? now, completed_at: now };
                            if (adapter) await adapter.upsertPlDayCompletionRaw(payload, completion.id);
                            else await sb.from("pl_day_completions").update(payload).eq("id", completion.id);
                          } else {
                            const payload = { day_id: dayId, client_id: client.id, started_at: now, in_progress_at: now, completed_at: now };
                            if (adapter) await adapter.upsertPlDayCompletionRaw(payload, null);
                            else await sb.from("pl_day_completions").insert(payload);
                          }
                        }
                        await qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
                        if (client?.id) {
                          await Promise.all([
                            qc.invalidateQueries({ queryKey: ["my-workouts", client.id] }),
                            qc.invalidateQueries({ queryKey: ["workouts-experience-client", client.id] }),
                            qc.invalidateQueries({ queryKey: ["workouts-priority-rows", client.id] }),
                            qc.invalidateQueries({ queryKey: ["portal-workouts-client"] }),
                            qc.invalidateQueries({ queryKey: ["schedule"] }),
                            qc.invalidateQueries({ queryKey: ["resolved-client-days"] }),
                          ]);
                        }
                        toast.success(`Status set: ${opt.label}`);
                      } catch (err: any) {
                        toast.error("Could not update status", { description: err?.message });
                      }
                    }}
                    className={
                      "px-3 py-1.5 text-xs font-semibold transition-colors " +
                      (opt.active
                        ? (opt.key === "completed"
                            ? "bg-emerald-500 text-white"
                            : opt.key === "in_progress"
                              ? "bg-amber-500 text-white"
                              : "bg-muted-foreground text-background")
                        : "text-muted-foreground hover:bg-secondary hover:text-foreground")
                    }
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-1.5 text-[11px] text-muted-foreground">
              Changes the client's progress for this workout. Visible only to admins/coaches in POV mode.
            </div>
          </Card>
        )}

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

        {/* Workouts are always editable — no date/block/program lock banners. */}

        {!focusMode && (
        <WorkoutLoadBoundary clientId={client?.id ?? null} clientName={(client as any)?.full_name ?? null} dayId={dayId} route={`/portal/workouts/${dayId}`}>
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-builder-canvas p-3 sm:p-4 ring-1 ring-builder-card-border/40 lg:grid-cols-2 lg:items-start">
            {rowsIsError ? (
              <WorkoutLoadFailureCard
                clientId={client?.id ?? null}
                clientName={(client as any)?.full_name ?? null}
                dayId={dayId}
                route={`/portal/workouts/${dayId}`}
                error={(rowsError as Error) ?? null}
                onRetry={() => { void refetchRows(); }}
              />
            ) : authReady && rowsLoaded && !rowsFetching && (rows as any[]).length === 0 ? (
              <WorkoutEmptyCard
                clientId={client?.id ?? null}
                clientName={(client as any)?.full_name ?? null}
                workoutId={dayId}
                route={`/portal/workouts/${dayId}`}
                onRetry={() => Promise.all([
                  qc.refetchQueries({ queryKey: ["pl-day-rows", dayId] }),
                  qc.refetchQueries({ queryKey: ["pl-day", dayId] }),
                  qc.refetchQueries({ queryKey: ["pl-day-results", dayId] }),
                  qc.refetchQueries({ queryKey: ["pl-day-completion", dayId] }),
                ])}
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
                dayTitle={cleanDayTitle(day.title, day.day_index)}
                dayIndex={day?.day_index ?? null}
                clientId={client?.id}
                blockId={blockId}
                existingResults={(results as any[]).filter((x) => x.row_id === r.id)}
                existingNote={notesByRowId.get(r.id)}
                notesLoading={notesLoading}
                readonly={readonly}
                unit={unitForRow(r)}
                onUnitChange={(u) => setExerciseUnit(r.exercises?.id ?? null, r.id, u)}
                onChange={refresh}
                onNoteChange={refreshNotes}
                purposeLabel={purposeLabelById.get(r.id) ?? null}
                swapContext={swapContextForRow(adapter, dayId, r.id)}
              />
              )
            ))}
          </div>
        </WorkoutLoadBoundary>
        )}

        {/* Finish Workout card — only show when workout is NOT yet completed.
             Guard: !completion?.completed_at prevents the glitchy state where
             both the completion card and the finish button are visible at once.
             This was the root cause of the Nicolas Galli stuck-state bug. */}
        {!readonly && !completion?.completed_at && !rowsIsError && authReady && rowsLoaded && (rows as any[]).length > 0 && (
          <Card className="p-4">
            <ActionButton
              className="w-full"
              loadingLabel="Saving…"
              successLabel="Finish Workout"
              successToast="Tap to finish"
              icon={<CheckCircle2 className="h-4 w-4" />}
              onAction={async () => {
                if (!client?.id) return;
                // Guard: if already completed, open Edit Review instead of re-completing
                if (completion?.completed_at) {
                  qc.invalidateQueries({ queryKey: ["pl-day-completion", dayId] });
                  return;
                }
                await metaSave.flush();
                // Ensure a draft row + started_at/in_progress_at exist before the
                // complete sheet opens. startWorkout is idempotent.
                try {
                  await startWorkoutSrv({
                    data: {
                      kind: "client",
                      dayId,
                      actAsClientId: isImpersonating && client?.id ? client.id : null,
                    } as any,
                  });
                } catch (err) {
                  console.warn("pre-complete startWorkout failed", err);
                }
                if (draftKey) clearLocalDraft(draftKey);
                refresh();
                setCompleteOpen(true);
              }}
            >
              Finish Workout
            </ActionButton>
          </Card>
        )}

        {completion?.completed_at && client?.id && (
          <CompletedWorkoutActions
            ctx={{ kind: "client", dayId }}
            hasCoach
            actAsClientId={isImpersonating ? client.id : null}
            initialReview={
              existingReview
                ? {
                    overallRating: existingReview.overall_rating ?? null,
                    sessionRpe: existingReview.session_rpe ?? null,
                    pain: existingReview.pain ?? false,
                    painLevel: existingReview.pain_level ?? null,
                    painArea: existingReview.pain_area ?? null,
                    painNote: existingReview.pain_note ?? null,
                    clientNote: existingReview.client_note ?? null,
                    strengthFeel: existingReview.strength_feel ?? null,
                    fatigueFeel: existingReview.fatigue_feel ?? null,
                    hitTarget: existingReview.hit_target ?? null,
                    editCount: existingReview.review_edit_count ?? 0,
                    submittedAt:
                      existingReview.review_submitted_at ??
                      existingReview.created_at ??
                      null,
                  }
                : null
            }
            onReviewSaved={() =>
              qc.invalidateQueries({ queryKey: ["pl-workout-feedback", dayId, client.id] })
            }
            onViewScore={(rating) => {
              setLastSessionRating(rating);
              setTimeout(() => openRecapSummary(), 350);
            }}
          />
        )}
        {children}
      </div>

      {/* Minimal post-workout completion sheet. Readonly (admin POV) never opens it. */}
      {client?.id && !isImpersonating && (
        <WorkoutCompleteSheet
          open={completeOpen}
          onOpenChange={setCompleteOpen}
          submitting={completeSubmitting}
          initial={completion ? {
            session_rating: (completion as any).session_rating ?? undefined,
            client_notes: completion.client_notes ?? undefined,
            // Pre-fill from existing review if available
            strength_feel: existingReview?.strength_feel ?? undefined,
            fatigue_feel: existingReview?.fatigue_feel ?? undefined,
            pain: existingReview?.pain ?? undefined,
            hit_target: existingReview?.hit_target ?? undefined,
          } : undefined}
          onSubmit={async (payload: WorkoutCompletePayload) => {
            if (!client?.id) return;
            setCompleteSubmitting(true);
            try {
              await metaSave.flush();
              const displayUnit: "kg" | "lb" =
                ((client as any)?.preferred_weight_unit === "kg" ? "kg" : "lb");
              const computed = computeWorkoutSummary(
                rows as any[],
                results as any[],
                {
                  displayUnit,
                  hasNote: !!(payload.client_notes && payload.client_notes.trim()),
                },
              );
              const requiredRows: RequiredRowSpec[] = (rows as any[]).map((r: any) => ({
                rowId: String(r.id),
                prescribedSets: Math.max(1, Number(r.sets) || 1),
                skipped: !!r.skipped,
                metricKind: ((
                  r?.tracking_type === "time" ||
                  r?.measurement_type === "time" ||
                  (r as any)?.exercises?.default_measurement_type === "time" ||
                  (r?.duration_seconds != null && Number(r.duration_seconds) > 0) ||
                  /\b(sec(onds?)?|min(utes?)?)\b/i.test(String(r?.reps_text ?? ""))
                ) ? "timed" : "load_reps") as RowMetricKind,
              }));
              const heartbeats = readHeartbeatTimestamps(completion?.id ?? null);
              // Prefer the value the user just typed into the duration input
              // over the (possibly stale) completion query snapshot, so edits
              // to a past workout's actual minutes actually persist.
              const typedMin = Number.parseInt(actualMin, 10);
              // Prefer active app-open time (pauses when the workout view is
              // backgrounded/hidden — same math as the live WorkoutTimer
              // badge) over wall-clock so the recap matches what the client
              // actually experienced.
              const activeMin = computeActiveDurationMin(
                completion?.started_at ?? completion?.in_progress_at ?? null,
              );
              const resolvedDurationMin = Number.isFinite(typedMin) && typedMin > 0
                ? typedMin
                : activeMin ?? completion?.actual_duration_min ?? null;
              // Phase 2: offline-safe completion. If the client is offline,
              // persist the completion payload locally so it survives reload.
              // Phase 3 will register a sync handler that drains this store.
              if (typeof navigator !== "undefined" && navigator.onLine === false) {
                saveOfflineCompletion({
                  id: `${dayId}:${client.id}`,
                  dayId,
                  clientId: client.id,
                  payload: {
                    kind: "client",
                    dayId,
                    requiredRows,
                    activityTimestamps: heartbeats,
                    completionMethod: "manual",
                    completionSource: "workout_view",
                    sessionRating: payload.session_rating ?? null,
                    notes: payload.client_notes ?? completion?.client_notes ?? null,
                    actualDurationMin: resolvedDurationMin,
                    sessionWeightTotal: computed.totalLifted > 0 ? computed.totalLifted : null,
                    sessionWeightUnit: computed.totalLifted > 0 ? displayUnit : null,
                    confirmedMissingLogs: true,
                  },
                });
                setCompleteOpen(false);
                setLastSummary(computed);
                setLastSessionRating(payload.session_rating ?? null);
                recapFromSubmitRef.current = true;
                // Defer opening the summary dialog until the sheet's exit
                // animation has finished. Stacking two Radix overlays in the
                // same tick leaves body pointer-events frozen and the dialog
                // never appears.
                 // Release the body scroll lock from the completion sheet
                 // before opening the summary, then defer opening one frame
                 // so the next Radix overlay mounts cleanly.
                 setTimeout(() => {
                   try {
                     document.body.style.overflow = "";
                     document.body.style.pointerEvents = "";
                     document.body.style.position = "";
                     document.body.style.top = "";
                   } catch {}
                   setSummaryOpen(true);
                 }, 350);
                toast.message("Workout saved offline", {
                  description: "We'll sync it when you're back online.",
                });
                return;
              }
              // ROOT CAUSE FIX 2026-06-26: completeWorkoutSrv was always
              // called with kind:"client" even for member workouts. For members,
              // dayId is "week:day" (not a UUID), so the server function failed
              // silently — the Finish Workout button appeared to do nothing.
              const isMember = adapter?.kind === "member";
              const memberEnrollmentId = isMember ? (adapter?.ref as any)?.enrollmentId : null;
              const [memberWeekRaw, memberDayRaw] = isMember ? String(dayId).split(":") : [];
              const memberWeekIndex = isMember ? Number(memberWeekRaw) : null;
              const memberDayIndex = isMember ? Number(memberDayRaw) : null;
              await completeWorkoutSrv({
                data: isMember && memberEnrollmentId && Number.isFinite(memberWeekIndex) && Number.isFinite(memberDayIndex)
                  ? {
                      kind: "member" as const,
                      enrollmentId: memberEnrollmentId,
                      weekIndex: memberWeekIndex!,
                      dayIndex: memberDayIndex!,
                      requiredRows,
                      activityTimestamps: heartbeats,
                      completionMethod: "manual",
                      completionSource: "workout_view",
                      sessionRating: payload.session_rating ?? null,
                      notes: payload.client_notes ?? null,
                      actualDurationMin: resolvedDurationMin,
                      sessionWeightTotal: computed.totalLifted > 0 ? computed.totalLifted : null,
                      sessionWeightUnit: computed.totalLifted > 0 ? displayUnit : null,
                      confirmedMissingLogs: true,
                    }
                  : {
                      kind: "client" as const,
                      dayId,
                      requiredRows,
                      activityTimestamps: heartbeats,
                      completionMethod: "manual",
                      completionSource: "workout_view",
                      sessionRating: payload.session_rating ?? null,
                      notes: payload.client_notes ?? completion?.client_notes ?? null,
                      actualDurationMin: resolvedDurationMin,
                      sessionWeightTotal: computed.totalLifted > 0 ? computed.totalLifted : null,
                      sessionWeightUnit: computed.totalLifted > 0 ? displayUnit : null,
                      confirmedMissingLogs: true,
                      strengthFeel: payload.strength_feel ?? null,
                      fatigueFeel: payload.fatigue_feel ?? null,
                      pain: payload.pain ?? null,
                      hitTarget: payload.hit_target ?? null,
                      actAsClientId: isImpersonating && client?.id ? client.id : null,
                    },
              });
              if (draftKey) clearLocalDraft(draftKey);
              clearHeartbeatTimestamps(completion?.id ?? null);
              setNotes("");
              setActualMin("");
              // Use refetchQueries (not invalidateQueries) so the UI updates
              // immediately — prevents the stuck state where Finish Workout
              // button remains visible after completion.
              await qc.refetchQueries({ queryKey: ["pl-day-completion", dayId] });
              // Broaden invalidation so the outer workout list, dashboard
              // today card, and schedule surfaces flip to "Completed"
              // immediately after submit — not on next reload.
              if (client?.id) {
                await Promise.all([
                  qc.invalidateQueries({ queryKey: ["my-workouts", client.id] }),
                  qc.invalidateQueries({ queryKey: ["workouts-experience-client", client.id] }),
                  qc.invalidateQueries({ queryKey: ["workouts-priority-rows", client.id] }),
                  qc.invalidateQueries({ queryKey: ["portal-workouts-client"] }),
                  qc.invalidateQueries({ queryKey: ["schedule"] }),
                  qc.invalidateQueries({ queryKey: ["resolved-client-days"] }),
                ]);
              }

              // Submit the post-workout review if any review fields were filled in
              const hasReviewData = payload.strength_feel || payload.fatigue_feel ||
                payload.pain != null || payload.hit_target;
              // Review save: only for client kind — member reviews are stored
              // inside completeWorkout for the member path.
              if (hasReviewData && !isMember) {
                try {
                  await submitOrEditReview({
                    data: {
                      kind: "client",
                      dayId,
                      overallRating: payload.session_rating,
                      sessionRpe: payload.session_rating * 2, // map 1-5 → 2-10
                      pain: payload.pain ?? false,
                      strengthFeel: payload.strength_feel ?? null,
                      fatigueFeel: payload.fatigue_feel ?? null,
                      hitTarget: payload.hit_target ?? null,
                      clientNote: payload.client_notes ?? null,
                      actAsClientId: isImpersonating && client?.id ? client.id : null,
                    },
                  });
                } catch {
                  // Review save is best-effort — don't fail the completion
                }
              }

              setCompleteOpen(false);
              setLastSummary(computed);
              setLastSessionRating(payload.session_rating ?? null);
              recapFromSubmitRef.current = true;
              // Wait 350ms for Radix's sheet exit animation to fully complete
              // and release its pointer-events lock before opening the summary.
              // 50ms was not enough — Radix's cleanup fires at ~300ms.
              setTimeout(() => {
                try {
                  document.body.style.overflow = "";
                  document.body.style.pointerEvents = "";
                  document.body.style.position = "";
                  document.body.style.top = "";
                } catch {}
                setSummaryOpen(true);
              }, 350);
              toast.success(
                `Workout submitted — Score: ${computed.score}/100`,
                {
                  description: computed.totalLifted > 0
                    ? `Total lifted: ${computed.totalLiftedFmt}`
                    : undefined,
                },
              );
            } catch (err: any) {
              toast.error("Could not submit workout", { description: err?.message });
            } finally {
              setCompleteSubmitting(false);
            }
          }}
        />
      )}
      {lastSummary && (
        <WorkoutSubmissionSummary
          open={summaryOpen}
          onOpenChange={setSummaryOpen}
          summary={lastSummary}
          workoutTitle={day?.title ?? null}
          durationMin={
            // For completed workouts use the stored value; for the in-app
            // recap (and offline saves) prefer the active app-open time so
            // the duration tile reflects time the workout view was actually
            // open — matching the live timer badge and the value persisted
            // on Finish.
            computeActiveDurationMin(
              completion?.started_at ?? completion?.in_progress_at ?? null,
              completion?.completed_at ?? undefined,
            ) ?? completion?.actual_duration_min ?? null
          }
          workoutDate={completion?.completed_at ?? scheduledDate ?? null}
          sessionRating={
            lastSessionRating ??
            (completion as any)?.session_rating ??
            existingReview?.overall_rating ??
            null
          }
          onClose={() => {
            // Only navigate to the list when the summary was opened as the
            // post-submission celebration. When opened from the "View workout
            // recap" deep link (?recap=1), keep the user on the workout page.
            if (recapFromSubmitRef.current) {
              recapFromSubmitRef.current = false;
              navigate({ to: navigation.listPath });
            }
          }}
        />
      )}
      <MoveWorkoutSheet
        dayId={dayId}
        open={moveOpen}
        onOpenChange={setMoveOpen}
        currentScheduledDate={scheduledDate}
        scheduledWorkoutId={(search as any)?.instance ?? null}
      />
    </>
  );
}

function SuggestedLoadBadge({ load, unit, exerciseName }: { load: number; unit: "kg" | "lb"; exerciseName: string }) {
  const nav = useWorkoutNavigation();
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
              <Link to={nav.messagesPath} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">
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
              <Link to={nav.messagesPath} className="inline-flex items-center gap-1 rounded-md bg-primary px-2 py-1 text-[11px] font-semibold text-primary-foreground">
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
  const nav = useWorkoutNavigation();
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
            to={nav.messagesPath}
            className="mt-2 inline-flex items-center gap-1 rounded-md bg-primary px-2.5 py-1 text-xs font-semibold text-primary-foreground"
          >
            <MessageCircle className="h-3 w-3" /> Message Coach
          </Link>
        </div>
      </div>
    </Card>
  );
}

/**
 * Compact "Last time" chip — shows the top set (heaviest × reps) the client
 * logged the last time they trained this exercise on a *different* day.
 * Intentionally small so it doesn't outshine the coach's prescribed load,
 * but explicit ("Last time" label + date) so the client can't mistake it
 * for today's target.
 */
function PreviousLiftChip({
  clientId,
  exerciseId,
  currentDayId,
  displayUnit,
}: {
  clientId: string | undefined | null;
  exerciseId: string | null;
  currentDayId: string;
  displayUnit: "kg" | "lb";
}) {
  const { data } = useQuery({
    queryKey: ["previous-lift", clientId, exerciseId, currentDayId],
    enabled: !!clientId && !!exerciseId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data: rows } = await (supabase as any)
        .from("pl_row_results")
        .select(
          `id, set_index, completed_at, created_at, actual_reps,
           entered_value, entered_unit, normalized_kg, normalized_lb,
           actual_load, actual_load_unit, completed_duration_seconds,
           pl_exercise_rows!inner(
             exercise_id,
             pl_days!inner(id, day_index, scheduled_date, pl_weeks!inner(week_index))
           )`,
        )
        .eq("client_id", clientId)
        .eq("pl_exercise_rows.exercise_id", exerciseId)
        .not("completed_at", "is", null)
        .order("completed_at", { ascending: false })
        .limit(60);
      const list = (rows ?? []) as any[];
      // Skip the current day (any set logged today shouldn't count as
      // "last time"). Pick the most recent day, then the heaviest set on it.
      const otherDay = list.find((r) => r?.pl_exercise_rows?.pl_days?.id !== currentDayId);
      if (!otherDay) return null;
      const dayId = otherDay.pl_exercise_rows.pl_days.id;
      const daySets = list.filter((r) => r?.pl_exercise_rows?.pl_days?.id === dayId);
      const scoreOf = (s: any) => {
        const kg = s.normalized_kg != null ? Number(s.normalized_kg) : null;
        const reps = s.actual_reps != null ? Number(s.actual_reps) : 0;
        return kg != null ? kg * Math.max(1, reps) : reps;
      };
      const top = daySets.slice().sort((a, b) => scoreOf(b) - scoreOf(a))[0];
      return { top, day: otherDay.pl_exercise_rows.pl_days };
    },
  });
  if (!data?.top) return null;
  const s = data.top;
  const enteredUnit: "kg" | "lb" | null =
    s.entered_unit === "kg" || s.entered_unit === "lb"
      ? s.entered_unit
      : s.actual_load_unit === "kg" || s.actual_load_unit === "lb"
        ? s.actual_load_unit
        : null;
  let loadStr = "";
  if (s.completed_duration_seconds != null && s.actual_reps == null) {
    loadStr = `${s.completed_duration_seconds}s`;
  } else {
    let n: number | null = null;
    let unit: "kg" | "lb" = enteredUnit ?? displayUnit;
    if (enteredUnit && s.entered_value != null) n = Number(s.entered_value);
    else if (enteredUnit && s.actual_load != null) n = Number(s.actual_load);
    else {
      const v = displayUnit === "kg" ? s.normalized_kg : s.normalized_lb;
      if (v != null) { n = Number(v); unit = displayUnit; }
    }
    if (n != null && !Number.isNaN(n)) {
      const rounded = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Number(n.toFixed(1));
      loadStr = `${rounded} ${unit}`;
    }
  }
  const repsStr = s.actual_reps != null ? ` × ${s.actual_reps}` : "";
  if (!loadStr && !repsStr) return null;
  const scheduled: string | null = data.day?.scheduled_date ?? null;
  let when = "";
  if (scheduled) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduled);
    if (m) {
      const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      const now = new Date();
      const days = Math.round((now.getTime() - d.getTime()) / 86400000);
      when = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days}d ago` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    }
  } else if (s.completed_at) {
    const d = new Date(s.completed_at);
    const days = Math.round((Date.now() - d.getTime()) / 86400000);
    when = days <= 0 ? "today" : days === 1 ? "yesterday" : days < 14 ? `${days}d ago` : d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }
  return (
    <div
      className="mt-1 inline-flex max-w-full items-center gap-1 rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground"
      title="Your top set the last time you trained this exercise"
    >
      <span className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/70">Last time</span>
      <span className="font-semibold tabular-nums text-foreground/80">{loadStr}{repsStr}</span>
      {when && <span className="text-[10px] text-muted-foreground/70">· {when}</span>}
    </div>
  );
}

function ExerciseBlock({ row, dayId, dayTitle, dayIndex, clientId, blockId, existingResults, existingNote, notesLoading = false, readonly = false, unit = "kg", onUnitChange, focusMode = false, onChange, onNoteChange, purposeLabel = null, swapContext = undefined }: { row: any; dayId: string; dayTitle: string; dayIndex?: number | null; clientId: string | undefined; blockId?: string | null; existingResults: any[]; existingNote?: any; notesLoading?: boolean; readonly?: boolean; unit?: "kg" | "lb"; onUnitChange?: (u: "kg" | "lb") => void; focusMode?: boolean; onChange: () => void; onNoteChange: () => void; purposeLabel?: string | null; swapContext?: { kind: "client" } | { kind: "member"; enrollmentId: string; weekIndex: number; dayIndex: number; exerciseIndex: number } | undefined }) {
  const adapter = useOptionalAdapter();
  const name = row.exercises?.name ?? row.exercise_name_override ?? "Exercise";
  const exercise = row.exercises ?? null;
  const exerciseId = exercise?.id ?? null;
  // Local mirror of the active unit so the per-exercise KG/LB toggle is always
  // instantly responsive — even if the parent's resolved-unit state takes a
  // tick to recompute or the persistence call is slow. Stays in sync with the
  // incoming prop so external changes (history hydration, undo) still apply.
  const [activeUnit, setActiveUnit] = useState<"kg" | "lb">(unit);
  useEffect(() => { setActiveUnit(unit); }, [unit]);
  const handleUnitToggle = (u: "kg" | "lb") => {
    setActiveUnit(u);
    onUnitChange?.(u);
  };
  const video = exercise?.video_url ?? exercise?.vimeo_embed_url ?? null;
  // Always show the How To button for every exercise.
  // Previously this was Boolean(exerciseId || video) which hid the button for
  // exercises added via exercise_name_override without an exercise_id (e.g. Dead Bug,
  // Leg Press). HowToSheet already handles the no-video case with "Video coming soon."
  const hasGuide = true;
  const cues = exercise?.cues ?? null;
  const setCount = Math.max(1, row.sets ?? 1);
  // Tracking type resolution priority:
  //   1. Explicit row.tracking_type (set by coach in the builder)
  //   2. row.measurement_type (legacy field, same table)
  //   3. exercise.default_measurement_type (auto-detect from exercise definition)
  //   4. Default: reps_weight
  //
  // This ensures time-based exercises (planks, carries, holds) automatically
  // show the duration timer without the coach having to manually configure
  // each row. Coaches can still override by setting tracking_type explicitly.
  const exerciseDefaultMeasurementType = (exercise as any)?.default_measurement_type ?? null;
  const trackingType: "reps_weight" | "reps" | "time" =
    (row as any).tracking_type === "reps"
      ? "reps"
      : ((row as any).tracking_type === "time" || (row as any).measurement_type === "time")
        ? "time"
        : exerciseDefaultMeasurementType === "time"
          ? "time"
          // Auto-detect via duration_seconds: if the row has a duration
          // prescribed, it's time-based even without explicit tracking_type.
          : ((row as any).duration_seconds != null && Number((row as any).duration_seconds) > 0)
            ? "time"
            // Auto-detect via reps_text: if the coach typed "30 seconds",
            // "45 sec", "1 min" etc. in the reps field, treat as time-based.
            : /\b(sec(onds?)?|min(utes?)?)\b/i.test(String((row as any).reps_text ?? ""))
              ? "time"
              : "reps_weight";
  const effectiveMeasurementType: "reps" | "time" = trackingType === "time" ? "time" : "reps";
  // When the row is time-based but duration_seconds is null (coach typed
  // "30 seconds" in reps_text instead of using the duration field), parse
  // the numeric value from reps_text as the prescribed seconds.
  const repsTextParsedSec: number | null = (() => {
    if (trackingType !== "time") return null;
    const rt = String((row as any).reps_text ?? "");
    const m = rt.match(/(\d+(?:\.\d+)?)\s*(min(utes?)?|sec(onds?)?)/);
    if (!m) return null;
    const n = Number(m[1]);
    return /min/i.test(m[2]) ? Math.round(n * 60) : Math.round(n);
  })();
  const effectivePrescribedDurationSec: number | null =
    trackingType === "time" ? ((row as any).duration_seconds ?? repsTextParsedSec ?? null) : null;
  // Hide the weight column for reps-only and time-only prescriptions.
  const hideWeight = trackingType !== "reps_weight";
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
      if (activeUnit === "kg" && row.load_kg) return Number(row.load_kg);
      if (activeUnit === "lb" && row.load_lb) return Number(row.load_lb);
    }
    if (computed && computed.status === "ok" && computed.load != null) {
      const inUnit = activeUnit === "kg" ? computed.load : computed.load * 2.2046226218;
      const step = weightIncrement(activeUnit);
      return Math.round(inUnit / step) * step;
    }
    if (activeUnit === "kg" && row.load_kg) return Number(row.load_kg);
    if (activeUnit === "lb" && row.load_lb) return Number(row.load_lb);
    return null;
  }, [row.manual_override, row.load_kg, row.load_lb, computed, activeUnit]);

  const repTarget = useMemo(() => parseRepTarget(row.reps_text), [row.reps_text]);
  const rpeTarget = useMemo(() => parseEffortTarget(row.rpe), [row.rpe]);
  const rirTarget = useMemo(() => parseEffortTarget(row.rir), [row.rir]);
  // When the program prescribes RIR and not RPE, the input column behaves as RIR.
  const showRir = !!row.rir && !row.rpe;

  // "Apply to remaining" — runs from a completed SetRow, pushes Draft values
  // into all later un-completed sets of this same exercise. Never overwrites
  // a confirmed (completed_at != null) set.
  const qc = useQueryClient();

  // ── Quick-fill loading state for the "Fill All Sets" button ──
  const [quickFillLoading, setQuickFillLoading] = useState(false);
  // Bumped after "Fill All Sets" / "Apply to remaining" persists so child
  // SetRows force-hydrate from the freshly-written server values even if
  // their post-save guard would otherwise block the refresh. Without this,
  // re-running Fill on the same exercise (especially after an autosave on a
  // later set) leaves the later sets visually empty even though the DB has
  // the new draft values.
  const [fillToken, setFillToken] = useState(0);
  // Snapshot of the load/reps/rpe/unit just written by Fill All Sets so
  // child SetRows can display the freshly-filled values without waiting
  // on the React Query cache refetch (which can race the token bump).
  const [fillSnapshot, setFillSnapshot] = useState<{
    load: string;
    reps: string;
    rpe: string;
    unit: "kg" | "lb";
  } | null>(null);

  const applyToRemaining = async (fromSetIndex: number, payload: { load: string; reps: string; rpe: string; unit: "kg" | "lb" }) => {
    if (!clientId) return;
    const loadNum = payload.load ? Number(payload.load) : null;
    const repsNum = payload.reps ? parseInt(payload.reps, 10) : null;
    const rpeNum = payload.rpe ? Number(payload.rpe) : null;
    const tasks: Array<Promise<any>> = [];
    for (let i = fromSetIndex + 1; i <= setCount; i++) {
      const ex = existingResults.find((x) => x.set_index === i);
      if (ex?.completed_at) continue; // never touch confirmed sets
      const body: Record<string, any> = withMemberWorkoutIndexes({
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
      }, adapter, dayId);
      if (adapter) {
        tasks.push(adapter.upsertPlRowResultRaw(body, ex?.id ?? null));
      } else {
        if (ex?.id) tasks.push(sb.from("pl_row_results").update(body).eq("id", ex.id));
        else tasks.push(sb.from("pl_row_results").upsert(body, { onConflict: "client_id,row_id,set_index" }));
      }
    }
    if (!tasks.length) return;
    await Promise.all(tasks);
    onChange();
    await qc.refetchQueries({ queryKey: ["pl-day-results", dayId] });
    setFillSnapshot({
      load: loadNum != null ? String(loadNum) : "",
      reps: repsNum != null ? String(repsNum) : "",
      rpe: payload.rpe ?? "",
      unit: payload.unit,
    });
    setFillToken((t) => t + 1);
    toast.success(`Applied to ${tasks.length} remaining set${tasks.length === 1 ? "" : "s"} as draft`);
  };

  return (
    <Card className="relative overflow-hidden border border-builder-card-border bg-card p-4 pl-5 shadow-builder-card transition-colors hover:border-builder-card-border-strong sm:p-5 sm:pl-6 rounded-[18px]">
      {/* Left stripe: inset top/bottom so it doesn't visually connect between cards */}
      <div className={`absolute left-0 top-2 bottom-2 w-1.5 rounded-full ${accent}`} aria-hidden />
      {/* Row 1 — name + unit toggle */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1 font-bold leading-snug break-words text-sm sm:text-base">{name}</div>
        {!readonly && onUnitChange && (
          <div className="shrink-0">
            <UnitToggle unit={activeUnit} onChange={handleUnitToggle} compact />
          </div>
        )}
      </div>
      {/* Row 2 — badges */}
      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <Badge variant="outline" className={cn("h-4 px-1 text-[10px] font-bold uppercase tracking-wider", purposeLabelBadgeClass(purposeLabel))}>
          {purposeLabel || category}
        </Badge>
        {hasNote && (
          <span title="You saved a note for this exercise" className="inline-flex h-4 items-center gap-1 rounded-full bg-primary/15 px-1.5 text-[10px] font-bold text-primary">
            <StickyNote className="h-2.5 w-2.5" /> Note
          </span>
        )}
      </div>
      {/* Standardized prescription line: Sets × Reps @ Weight | RPE */}
      <div className="mt-1 text-sm font-semibold text-foreground leading-snug break-words">
        {formatPrescription({
          sets: row.sets,
          repsText: row.reps_text,
          suggestedWeight,
          unit: activeUnit,
          percentage: row.percentage,
          percentageBasis: row.percentage_basis,
          manualOverride: row.manual_override,
          rpe: row.rpe,
          rir: row.rir,
          measurementType: effectiveMeasurementType,
          durationSeconds: effectivePrescribedDurationSec,
        })}
        {row.tempo && <span className="ml-2 text-xs font-normal text-muted-foreground">tempo {row.tempo}</span>}
      </div>
      {/* Compact "Last time" chip — subtle so it never outshines today's prescription. */}
      {clientId && exerciseId && (
        <PreviousLiftChip
          clientId={clientId}
          exerciseId={exerciseId}
          currentDayId={dayId}
          displayUnit={activeUnit}
        />
      )}
      {/* Big, dummy-proof rest timer — tap to start, auto-resets at 0 */}
      <div className="mt-2">
        <RestTimerButton seconds={effectiveRest ?? null} label={restDisplay} />
      </div>
      {/* Suggested load badges */}
      {row.manual_override && (row.load_kg || row.load_lb) && (
        <SuggestedLoadBadge
          load={Number(
            convertWeight(
              (row.load_kg ?? row.load_lb) as number,
              row.load_kg ? "kg" : "lb",
              activeUnit,
            ).toFixed(1),
          )}
          unit={activeUnit}
          exerciseName={name}
        />
      )}
      {!row.manual_override && computed && computed.status === "ok" && computed.load != null && (
        <SuggestedLoadBadge
          load={Number(convertWeight(computed.load, computed.unit, activeUnit).toFixed(1))}
          unit={activeUnit}
          exerciseName={name}
        />
      )}
      {row.percentage_basis === "none" && (
        <div className="mt-1 inline-flex items-center gap-1 rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">
          Log the load used
        </div>
      )}
      {row.notes && <p className="mt-1 text-xs text-muted-foreground italic">{row.notes}</p>}
      {/* Row 3 — compact horizontal action row (secondary controls: lighter weight) */}
      <div className="mt-2 flex flex-wrap items-center gap-1 opacity-70 hover:opacity-100 transition-opacity">
        {clientId && exerciseId && (
          <ExerciseHistoryButton
            clientId={clientId}
            exerciseId={exerciseId}
            exerciseName={name}
            displayUnit={activeUnit}
            currentDayIndex={dayIndex}
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
        <QuickSwapButton
          rowId={row.id}
          exerciseId={exerciseId}
          exerciseName={name}
          muscleGroup={exercise?.muscle_group ?? null}
          category={exercise?.category ?? null}
          equipment={(exercise as any)?.equipment ?? null}
          difficulty={(exercise as any)?.difficulty ?? null}
          swapContext={swapContext}
        />
        {cues && (
          <Button size="sm" variant="ghost" onClick={() => setCuesOpen((v) => !v)} className="h-7 px-2 text-xs">
            {cuesOpen ? <ChevronUp className="mr-1 h-3 w-3" /> : <ChevronDown className="mr-1 h-3 w-3" />}
            {cuesOpen ? "Hide cues" : "Show cues"}
          </Button>
        )}
        <TrainingHelpButton size="sm" variant="ghost" className="h-7 px-2 text-xs ml-auto" />
      </div>

      {/* Quick-fill weight button — only show when not readonly and there are uncompleted sets */}
      {!readonly && !trackingType.includes("time") && clientId && (() => {
        const firstSet = existingResults.find((x: any) => x.set_index === 1);
        const firstLoad = firstSet?.actual_load;
        const hasFirstWeight = firstLoad != null && isFinite(Number(firstLoad));
        const uncompletedAfterFirst = Array.from({ length: setCount }, (_, i) => i + 1)
          .filter((i) => i > 1 && !existingResults.find((x: any) => x.set_index === i && x.completed_at)).length;
        if (uncompletedAfterFirst === 0) return null;
        const firstUnit = (firstSet?.actual_load_unit as "kg" | "lb" | undefined) ?? activeUnit;
        const displayLoad = Number(Number(firstLoad ?? 0).toFixed(2));
        const onFill = async () => {
          // Refetch fresh results before reading Set 1 so the second fill always
          // uses the current Set 1 value, not a stale cached snapshot.
          await qc.refetchQueries({ queryKey: ["pl-day-results", dayId] });
          const freshResults = (qc.getQueryData([
            "pl-day-results",
            dayId,
            clientId,
            adapter?.kind ?? null,
            adapter?.ref.ownerId ?? null,
          ]) as any[]) ?? existingResults;
          const freshFirstSet = freshResults.find((x: any) => x.set_index === 1);
          const freshFirstLoad = freshFirstSet?.actual_load;
          const freshHasFirstWeight = freshFirstLoad != null && isFinite(Number(freshFirstLoad));
          if (!freshHasFirstWeight) return;
          const freshFirstUnit = (freshFirstSet?.actual_load_unit as "kg" | "lb" | undefined) ?? activeUnit;
          setQuickFillLoading(true);
          try {
            await applyToRemaining(1, {
              load: String(freshFirstLoad),
              reps: freshFirstSet?.actual_reps != null ? String(freshFirstSet.actual_reps) : "",
              rpe: freshFirstSet?.actual_rpe_num != null
                ? String(freshFirstSet.actual_rpe_num)
                : freshFirstSet?.actual_rpe != null ? String(freshFirstSet.actual_rpe) : "",
              unit: freshFirstUnit,
            });
          } finally {
            setQuickFillLoading(false);
          }
        };
        return (
          <div className="mt-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => void onFill()}
              disabled={!hasFirstWeight || quickFillLoading}
              className="w-full h-9 text-xs font-bold border-primary/30 text-primary hover:bg-primary/10 disabled:opacity-50 gap-1.5"
              title={hasFirstWeight
                ? `Copy ${displayLoad} ${firstUnit} from Set 1 into the remaining ${uncompletedAfterFirst} set${uncompletedAfterFirst !== 1 ? "s" : ""}`
                : "Enter a weight in Set 1 first"}
            >
              <Zap className="h-3.5 w-3.5" />
              {hasFirstWeight
                ? `Fill All Sets with ${displayLoad} ${firstUnit}`
                : "Fill All Sets (enter Set 1 weight first)"}
            </Button>
          </div>
        );
      })()}

      {cues && cuesOpen && (
        <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground border-l-2 border-border pl-2">
          {typeof cues === "string" ? cues : Array.isArray(cues) ? cues.join(" · ") : null}
        </p>
      )}

      <div className={cn("mt-3 overflow-hidden rounded-md border border-builder-card-border bg-builder-inset", focusMode && "text-base")}>
        <div className={cn(
          "grid items-center gap-1.5 border-b border-builder-card-border bg-builder-card/60 px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground",
          effectiveMeasurementType === "time"
            ? (focusMode ? "grid-cols-[36px_1fr_44px] text-xs" : "grid-cols-[28px_1fr_36px]")
            : hideWeight
              ? (focusMode ? "grid-cols-[36px_1.6fr_1fr_52px] text-xs" : "grid-cols-[28px_1.6fr_1fr_44px]")
              : (focusMode ? "grid-cols-[36px_1fr_1fr_1.3fr_52px] text-xs" : "grid-cols-[28px_1fr_1fr_1.3fr_44px]"),
        )}>
          <span>Set</span>
          <span>{effectiveMeasurementType === "time" ? "Time" : "Reps"}</span>
          {effectiveMeasurementType !== "time" && <span>{showRir ? "RIR" : "RPE"}</span>}
          {effectiveMeasurementType !== "time" && !hideWeight && <span className="truncate">Wt ({activeUnit.toUpperCase()})</span>}
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
              measurementType={effectiveMeasurementType}
              prescribedDurationSeconds={effectivePrescribedDurationSec}
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
              forceHydrateToken={fillToken}
              forcedFill={fillSnapshot}
              readonly={readonly}
              unit={activeUnit}
              hideWeight={hideWeight}
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
        loading={notesLoading}
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
  const { data: globalSet } = useExerciseVideoSetGlobal();
  const videoSrc = exercise
    ? getExerciseVideoSource(exercise, { globalOverride: globalSet ?? null })
    : null;
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

/**
 * Save an exercise note with a single automatic retry when the database
 * connection reports "current transaction is aborted, commands ignored
 * until end of transaction block" (Postgres SQLSTATE 25P02). That state
 * is left behind on a pooled connection when a prior statement on the
 * same transaction failed; the next request on the same connection will
 * keep failing until the transaction is rolled back. PostgREST resets
 * the connection between requests, so a short delay + one retry is
 * enough to land the upsert cleanly.
 */
async function saveExerciseNoteWithRetry(doSave: () => Promise<void>) {
  const isAbortError = (err: unknown) => {
    const e = err as { code?: string; message?: string } | null | undefined;
    if (!e) return false;
    if (e.code === "25P02") return true;
    const msg = String(e.message ?? "").toLowerCase();
    return msg.includes("current transaction is aborted");
  };
  try {
    await doSave();
  } catch (err) {
    if (!isAbortError(err)) throw err;
    // Give the pooled connection a beat to roll back before retrying.
    await new Promise((r) => setTimeout(r, 200));
    try {
      await doSave();
    } catch (retryErr) {
      // Surface a friendlier message; original error is preserved upstream
      // via console for debugging.
      // eslint-disable-next-line no-console
      console.error("Exercise note save failed after retry", retryErr);
      throw retryErr;
    }
  }
}

function ExerciseNotesSheet({ open, onOpenChange, clientId, dayId, dayTitle, rowId, exerciseId, exerciseName, existingNote, loading = false, onSaved }: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string | undefined;
  dayId: string;
  dayTitle: string;
  rowId: string;
  exerciseId: string | null;
  exerciseName: string;
  existingNote?: any;
  loading?: boolean;
  onSaved: () => void;
}) {
  const [draft, setDraft] = useState(existingNote?.content ?? "");
  // Only re-hydrate the draft when the sheet (re)opens or the underlying
  // note row changes identity. Resetting on every `content` change wiped
  // out user edits whenever a refetch came back with the previous saved
  // content, making it feel like the note couldn't be edited.
  useEffect(() => { setDraft(existingNote?.content ?? ""); }, [existingNote?.id, open]);
  const adapter = useOptionalAdapter();

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="h-[88vh] overflow-y-auto p-0 sm:max-w-xl sm:mx-auto sm:rounded-t-2xl">
        <SheetHeader className="sticky top-0 z-10 bg-background/95 backdrop-blur border-b border-border px-5 py-3 text-left">
          <SheetTitle className="text-base font-black">{exerciseName}</SheetTitle>
          <SheetDescription className="text-xs">{dayTitle} · Exercise notes</SheetDescription>
        </SheetHeader>
        <div className="px-5 py-4 space-y-4 pb-32">
          <div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-xs font-bold uppercase tracking-widest text-muted-foreground">Your note</label>
              {existingNote && (
                <span className="text-[10px] text-muted-foreground">
                  Last saved {new Date(existingNote.updated_at).toLocaleString()}
                  {existingNote.status === "edited" && " · edited"}
                </span>
              )}
            </div>
            {loading && !existingNote ? (
              <div className="mt-1 h-[140px] w-full animate-pulse rounded-md border border-border bg-muted/40" aria-busy="true" aria-label="Loading note" />
            ) : (
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                rows={6}
                placeholder="How did this exercise feel? Form cues, pain, PRs, equipment notes… (tap to edit anytime)"
                className="mt-1"
              />
            )}
            {existingNote && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                Edit your note anytime — tap above to change it, then tap Save Note.
              </p>
            )}
          </div>
        </div>
        <div className="sticky bottom-0 left-0 right-0 border-t border-border bg-background/95 backdrop-blur px-5 py-3 space-y-2">
          <ActionButton
            className="w-full"
            size="lg"
            loadingLabel="Saving…"
            successLabel={existingNote ? "Updated" : "Saved"}
            successToast={existingNote ? "Note updated" : "Note saved"}
            disabled={!clientId || (draft.trim() === (existingNote?.content ?? "").trim())}
            onAction={async () => {
              if (!clientId) return;
              const trimmed = draft.trim();
              const doSave = async () => {
                if (existingNote) {
                  const payload = { content: trimmed, status: "edited", coach_seen_at: null };
                  if (adapter) {
                    await adapter.upsertPlExerciseNoteRaw(payload, existingNote.id);
                  } else {
                    const { error } = await sb.from("pl_exercise_notes").update(payload).eq("id", existingNote.id);
                    if (error) throw error;
                  }
                } else {
                  if (!trimmed) throw new Error("Note is empty");
                  const payload = {
                    client_id: clientId,
                    day_id: dayId,
                    row_id: rowId,
                    exercise_id: exerciseId,
                    exercise_name: exerciseName,
                    content: trimmed,
                    status: "new",
                  };
                  if (adapter) {
                    await adapter.upsertPlExerciseNoteRaw(payload, null);
                  } else {
                    const { error } = await sb.from("pl_exercise_notes").insert(payload);
                    if (error) throw error;
                  }
                }
              };
              await saveExerciseNoteWithRetry(doSave);
              onSaved();
            }}
          >
            <StickyNote className="mr-2 h-4 w-4" /> {existingNote ? "Update Note" : "Save Note"}
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
  hasUncompletedAfter, onApplyToRemaining, forceHydrateToken = 0,
  forcedFill = null,
  readonly = false, unit = "kg", hideWeight = false, focusMode = false, onChange, onSetCompleted,
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
  /** Bumped by parent after a "Fill All Sets" write to force re-hydration
   *  from the freshly-saved `existing` even if the recent-save guard would
   *  otherwise block it. */
  forceHydrateToken?: number;
  /** Snapshot of values just written by Fill All Sets — used to bypass
   *  the cache race when force-hydrating. */
  forcedFill?: { load: string; reps: string; rpe: string; unit: "kg" | "lb" } | null;
  readonly?: boolean;
  unit?: "kg" | "lb";
  hideWeight?: boolean;
  focusMode?: boolean;
  onChange: () => void;
  onSetCompleted?: (setIndex: number) => void;
}) {
  const { user } = useAuth();
  const { isImpersonating, client: povClient } = useClientImpersonation();
  const adapter = useOptionalAdapter();
  const qc = useQueryClient();
  // Display weight is the raw value the client typed. The KG/LB toggle is
  // display-only: it changes labels/preferences, never the saved number.
  // Helper to format a weight value for display — rounds to 4 sig figs and
  // strips trailing zeros to avoid showing '110.0001' instead of '110'.
  const fmtLoad = (v: number | null | undefined): string => {
    if (v == null) return "";
    const rounded = Math.round(v * 10000) / 10000; // 4 decimal places max
    return fmtNum(rounded);
  };
  const initialDisplayLoad = (() => {
    if (!existing) return "";
    return existing.actual_load != null ? fmtLoad(existing.actual_load) : "";
  })();
  const [load, setLoad] = useState(initialDisplayLoad);
  // Derive the prescribed reps/RPE for Quick Log auto-fill.
  const prescribedRepsStr = (() => {
    if (repTarget?.exact != null) return String(repTarget.exact);
    if (repTarget?.min != null) return String(repTarget.min);
    // Extract only the FIRST number from the reps_text. Patterns like "12, 6, 12"
    // (drop sets) must not be stripped of commas and concatenated — that turns
    // "12, 6, 12" into "126" which is then displayed as the pre-filled reps value.
    if (targetReps) { const m = String(targetReps).match(/(\d+)/); return m ? m[1] : ""; }
    return "";
  })();
  const prescribedRpeStr = (() => {
    if (rpeTarget?.exact != null) return String(rpeTarget.exact);
    if (rpeTarget?.min != null) return String(rpeTarget.min);
    if (targetRpe) return String(targetRpe).replace(/[^0-9.]/g, "").slice(0, 4);
    if (rirTarget?.exact != null) return String(Math.min(10, Math.max(0, 10 - rirTarget.exact)));
    if (rirTarget?.max != null) return String(Math.min(10, Math.max(0, 10 - rirTarget.max)));
    return "";
  })();
  // Initialize reps/RPE from actual (if logged) OR fall back to prescribed (Quick Log).
  const [reps, setReps] = useState(existing?.actual_reps?.toString() ?? prescribedRepsStr);
  const [rpe, setRpe] = useState(existing?.actual_rpe_num != null ? String(existing.actual_rpe_num) : (existing?.actual_rpe ?? prescribedRpeStr));
  // Track whether the client has manually edited reps/RPE away from the prescription.
  const [repsEdited, setRepsEdited] = useState(Boolean(existing?.actual_reps));
  const [rpeEdited, setRpeEdited] = useState(Boolean(existing?.actual_rpe_num != null || existing?.actual_rpe));
  // Chip open state — when false, show tappable chip; when true, show inline input.
  const [repsChipOpen, setRepsChipOpen] = useState(false);
  const [rpeChipOpen, setRpeChipOpen] = useState(false);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);
  useEffect(() => { setStatusError(null); }, [existing?.id, existing?.completed_at]);
  // Hydrate from any unsynced local draft on first mount for this set
  const draftKey = clientId ? `workout-set:${rowId}:${clientId}:${setIndex}` : null;
  const [hydrated, setHydrated] = useState(false);
  // CORRUPTION GUARD (2026-06-25): autosave must not fire until server data has
  // been received and the display state set from it. Without this, autosave fires
  // on mount with empty/stale state and overwrites stored values with null/wrong unit.
  // If !existing there is no server data to wait for, so start as true.
  // DO NOT remove this guard — it prevents the weight corruption regression.
  const [serverHydrated, setServerHydrated] = useState(!existing);
  // Track which field (if any) is currently focused so we never overwrite
  // what the user is actively typing with a stale server refetch.
  const [focusedField, setFocusedField] = useState<"load" | "reps" | "rpe" | null>(null);
  // iOS / mobile safety: blur events occasionally fail to fire when an input
  // is removed from the DOM, the keyboard auto-dismisses, or the page loses
  // focus. If focus stays set for too long we'll never autosave because the
  // enabled guard blocks. Clear stale focus after 6s of no activity.
  const focusClearTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clearEditGuard = () => {
    setFocusedField(null);
  };
  useEffect(() => {
    if (focusClearTimerRef.current) clearTimeout(focusClearTimerRef.current);
    if (!focusedField) return;
    focusClearTimerRef.current = setTimeout(() => {
      clearEditGuard();
    }, 6000);
    return () => {
      if (focusClearTimerRef.current) clearTimeout(focusClearTimerRef.current);
    };
  }, [focusedField, load, reps, rpe]);
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

  // Reset from server when the persisted result changes (but never while typing).
  // Weight always hydrates from actual_load only. Normalized kg/lb columns are
  // for analytics/history, not for changing the user's logged raw value.
  const lastUnitRef = useRef<"kg" | "lb">(unit);
  // Ref to the current focused field — used in the effect below without
  // causing the effect to re-run when focus changes.
  const focusedFieldRef = useRef<"load" | "reps" | "rpe" | null>(null);
  // After a successful save, block the server-reset effect for 3 s so a fast
  // server response can never overwrite what the user is still typing.
  const recentlySavedRef = useRef(false);
  const recentlySavedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Keep a live reference to the latest server result so the force-hydrate
  // effect can never read a stale closure when parent bumps fillToken.
  const latestExistingRef = useRef(existing);
  useEffect(() => { latestExistingRef.current = existing; }, [existing]);
  useEffect(() => { focusedFieldRef.current = focusedField; }, [focusedField]);
  useEffect(() => {
    // Never overwrite a field the user is actively typing in, and never
    // overwrite within 8 s of a save completing (prevents server responses
    // and window-focus refetches from clobbering typed values on mobile).
    // 8s covers: save latency + Realtime invalidation + window-focus refetch.
    const focused = focusedFieldRef.current;
    if (recentlySavedRef.current) return;
    const display = existing?.actual_load != null ? fmtLoad(existing.actual_load) : "";
    if (focused !== "load") setLoad(display);
    if (focused !== "reps") {
      // If the server has a stored reps value, hydrate from it. If the
      // server has null AND the user has explicitly edited (e.g. cleared
      // the field), keep their current value — don't re-fill with the
      // prescribed default, that would undo the clear. Only fall back to
      // the prescription for sets the user hasn't touched yet.
      if (existing?.actual_reps != null) setReps(existing.actual_reps.toString());
      else if (!repsEdited) setReps(prescribedRepsStr);
    }
    if (focused !== "rpe") {
      if (existing?.actual_rpe_num != null) setRpe(String(existing.actual_rpe_num));
      else if (existing?.actual_rpe != null) setRpe(existing.actual_rpe);
      else if (!rpeEdited) setRpe(prescribedRpeStr);
    }
    // Track the display unit at hydration so later preference changes can be
    // recognized without touching the raw displayed load.
    lastUnitRef.current = unit;
    // Signal that server data has arrived — autosave is now safe to fire
    setServerHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing?.id, existing?.actual_load, existing?.actual_reps, existing?.actual_rpe_num, existing?.actual_rpe]);

  useEffect(() => {
    if (lastUnitRef.current === unit) return;
    lastUnitRef.current = unit;
    // UNIT TOGGLE IS DISPLAY-ONLY — stored weight must never be converted on
    // toggle. Regression fix 2026-06-25. If you remove this, the weight
    // corruption bug returns (stored values get divided/multiplied by 2.2046
    // on every toggle via the pl_row_results normalization trigger).
    //
    // Unit changes are preference/label only. Do not convert the displayed
    // number and do not write pl_row_results; just adopt the current value as
    // clean so the toggle cannot trigger an autosave.
    queueMicrotask(() => { saveRef.current?.markClean(); });
  }, [unit]);

  // Parent-initiated "Fill All Sets" / "Apply to remaining" — force-hydrate
  // from the freshly-written `existing` regardless of the recent-save guard
  // and the focused-field guard. This is an explicit user action that must
  // win over those defensive heuristics; otherwise re-filling after an
  // autosave on a later set leaves it visually empty. We read from a ref so
  // the effect always sees the latest `existing` prop, not a stale closure.
  useEffect(() => {
    if (!forceHydrateToken) return;
    const latest = latestExistingRef.current;
    // Cancel any pending autosave so it can't immediately overwrite the
    // values we're about to display.
    recentlySavedRef.current = false;
    setFocusedField(null);
    // Prefer the freshly-written snapshot from the parent: it bypasses the
    // React Query cache race (refetch may not have landed by the time this
    // effect runs, so `latest` can still hold a stale value like 90 lb from
    // a previous session).
    //
    // FIX 2026-06-27: applyToRemaining explicitly SKIPS sets that already
    // have completed_at (it never overwrites confirmed sets in the DB).
    // So forcedFill must also skip them visually — otherwise the display
    // shows the fill value (e.g. "330 lb") while the DB still holds the
    // original entry (e.g. "110 kg"), producing the history-vs-input
    // mismatch reported on Jared McIntyre's Block 1 / Wk 2 / Day 1.
    if (forcedFill && setIndex !== 1 && !latest?.completed_at) {
      // forcedFill wins for uncompleted sets — it's the value just written to the DB
      setLoad(forcedFill.load);
      if (forcedFill.reps) setReps(forcedFill.reps);
      if (forcedFill.rpe) setRpe(forcedFill.rpe);
    } else {
      const display = latest?.actual_load != null ? fmtLoad(latest.actual_load) : "";
      setLoad(display);
      if (latest?.actual_reps != null) setReps(String(latest.actual_reps));
      if (latest?.actual_rpe_num != null) setRpe(String(latest.actual_rpe_num));
      else if (latest?.actual_rpe != null) setRpe(latest.actual_rpe);
    }
    queueMicrotask(() => { saveRef.current?.markClean(); });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [forceHydrateToken]);

  const value = useMemo(() => ({ load, reps, rpe, unit }), [load, reps, rpe, unit]);
  // Forward-ref to the autosave handle so effects defined above can call
  // markClean() without a TDZ error.
  const saveRef = useRef<ReturnType<typeof useAutosave<typeof value>> | null>(null);
  // persistedUnitForValue is a pure helper — see src/lib/workout-unit-persistence.ts
  // for the full contract and regression-test coverage.
  const save = useAutosave({
    key: draftKey,
    value,
    delay: 1000, // fast enough that filled sets sync and turn green without feeling delayed
    // Unit-only changes are display/preference only. The raw typed load is
    // the saved value, so the set row is dirty only when load/reps/RPE change.
    equals: (a, b) => {
      if (a.reps !== b.reps || a.rpe !== b.rpe) return false;
      return a.load === b.load;
    },
    // NOTE: hydrated is intentionally excluded from this condition.
    // hydrated only gates the draft-restore optimization; it must not
    // gate whether saves work. If a user types before the draft-restore
    // effect fires (common on fast mobile taps), their value would never
    // save because enabled=false means the baseline is never established.
    // CORRUPTION GUARD: serverHydrated must be true before autosave fires.
    // Prevents autosave from running on mount before server data arrives.
    // Root cause of weight corruption bug — fixed 2026-06-25. DO NOT remove.
    //
    // Autosave even while a field remains focused so mobile keyboards / sticky
    // focus cannot leave workout inputs unsaved. The server hydration effect
    // still refuses to overwrite the focused field, so active typing is safe.
    enabled: !readonly && !!clientId && serverHydrated && (load.length > 0 || reps.length > 0 || rpe.length > 0 || !!existing),
    onPermanentFailure: ({ value }) => {
      if (!clientId) return;
      const loadNum = value.load ? Number(value.load) : null;
      const repsNum = value.reps ? parseInt(value.reps, 10) : null;
      const rpeNum = value.rpe ? Number(value.rpe) : null;
      const loadUnit = persistedUnitForValue(value.load, value.unit, existing);
      const completedAt = hideWeight
        ? (repsNum != null && Number.isFinite(repsNum) && repsNum > 0 ? new Date().toISOString() : null)
        : (repsNum != null && Number.isFinite(repsNum) && repsNum > 0 && loadNum != null && Number.isFinite(loadNum) && loadNum > 0 ? new Date().toISOString() : null);
      enqueueOfflineWrite({
        id: `portal_set:${rowId}:${clientId}:${setIndex}`,
        label: `Saved set ${setIndex}`,
        handlerKey: "portal_table_upsert",
        payload: {
          table: "pl_row_results",
          id: existing?.id ?? null,
          payload: withMemberWorkoutIndexes({
            row_id: rowId,
            client_id: clientId,
            set_index: setIndex,
            actual_load: loadNum,
            actual_load_unit: loadUnit,
            entered_value: loadNum,
            entered_unit: loadUnit,
            actual_reps: repsNum,
            actual_rpe: value.rpe || null,
            actual_rpe_num: rpeNum,
            completed_at: completedAt,
          }, adapter, workoutId),
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
      const loadUnit = persistedUnitForValue(load, unit, existing);
      const completedAt = hideWeight
        ? (repsNum != null && Number.isFinite(repsNum) && repsNum > 0 ? new Date().toISOString() : null)
        : (repsNum != null && Number.isFinite(repsNum) && repsNum > 0 && loadNum != null && Number.isFinite(loadNum) && loadNum > 0 ? new Date().toISOString() : null);
      const payload = withMemberWorkoutIndexes({
        row_id: rowId,
        client_id: clientId,
        set_index: setIndex,
        actual_load: loadNum,
        actual_load_unit: loadUnit,
        entered_value: loadNum,
        entered_unit: loadUnit,
        actual_reps: repsNum,
        actual_rpe: rpe || null,
        actual_rpe_num: rpeNum,
        completed_at: completedAt,
      }, adapter, workoutId);
      let savedId: string | null = existing?.id ?? null;
      // PostgREST keeps a pooled connection in "current transaction is
      // aborted" (SQLSTATE 25P02) state if a prior statement on the same
      // connection failed. Detect that and retry exactly once after a brief
      // pause so the pool can roll back; if it still fails, surface the
      // error so the autosave's backoff / timeout path takes over.
      const isAbortError = (err: any) => {
        if (!err) return false;
        if (err.code === "25P02") return true;
        return String(err.message ?? "").toLowerCase().includes("current transaction is aborted");
      };
      const writeWithAbortRetry = async (fn: () => Promise<any>) => {
        try {
          return await fn();
        } catch (err) {
          if (!isAbortError(err)) throw err;
          await new Promise((r) => setTimeout(r, 200));
          return await fn();
        }
      };
      // Snapshot "before" in the display unit so the audit diff is meaningful.
      const before = existing
        ? {
            weight: existing.actual_load ?? null,
            reps: existing.actual_reps ?? null,
            rpe: existing.actual_rpe_num ?? existing.actual_rpe ?? null,
            unit: existing.actual_load_unit ?? null,
            status: existing.completed_at ? "completed" : null,
          }
        : { weight: null, reps: null, rpe: null, unit: null, status: null };
      if (existing) {
        if (adapter) {
          await writeWithAbortRetry(() => adapter.upsertPlRowResultRaw(payload, existing.id));
        } else {
          await writeWithAbortRetry(async () => {
            const { error } = await sb.from("pl_row_results").update(payload).eq("id", existing.id);
            if (error) throw error;
          });
        }
      } else {
        if (adapter) {
          const res = await writeWithAbortRetry(() => adapter.upsertPlRowResultRaw(payload, null));
          savedId = (res as any)?.id ?? null;
        } else {
          const inserted = await writeWithAbortRetry(async () => {
            const { data, error } = await sb.from("pl_row_results").upsert(payload, { onConflict: "client_id,row_id,set_index" }).select("id").maybeSingle();
            if (error) throw error;
            return data;
          });
          savedId = (inserted as any)?.id ?? null;
        }
      }
      await qc.refetchQueries({ queryKey: ["pl-day-results", workoutId] });
      onChange();
      // Block the server-reset effect for 3 s after a successful save so the
      // query refetch triggered by onChange() can never overwrite what the
      // user is still typing (e.g. typing '110' — save fires at '1', server
      // responds, reset effect would clobber '10' back to '1').
      recentlySavedRef.current = true;
      if (recentlySavedTimerRef.current) clearTimeout(recentlySavedTimerRef.current);
      recentlySavedTimerRef.current = setTimeout(() => { recentlySavedRef.current = false; }, 8000);
      // Coach/admin POV audit trail. Only writes when impersonating, only the
      // fields that actually changed, only after the save succeeds.
      if (isImpersonating && user?.id && povClient?.id === clientId) {
        const after = {
          weight: loadNum,
          reps: repsNum,
          rpe: rpeNum,
          unit: loadUnit,
          status: existing?.completed_at ? "completed" : "saved",
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

  // Keep the forward-ref synced with the latest autosave handle so the
  // unit-toggle effect above can call markClean() / retry() safely.
  saveRef.current = save;

  const flushSaveAfterEdit = () => {
    clearEditGuard();
    setTimeout(() => { void save.flush(); }, 0);
  };

  const onEnter: React.KeyboardEventHandler<HTMLInputElement> = (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      (e.target as HTMLInputElement).blur();
      flushSaveAfterEdit();
    }
  };

  // State labels: Suggested (no draft, no confirm), Draft (typed but not all valid yet
  // OR explicitly saved with completed_at=null), Confirmed (existing.completed_at set).
  // A set is "confirmed" (green) only when completed_at is set AND the row
  // actually has the value its kind requires. Without this guard, sets that
  // were marked complete with no weight (legacy data, fat-finger taps, or
  // status-only saves) render as fully logged green rows even though the WT
  // column is blank. Applies app-wide for every client.
  const isTimeKind = measurementType === "time";
  const existingLoadNum = existing?.actual_load != null ? Number(existing.actual_load) : NaN;
  const existingDurNum = (existing as any)?.completed_duration_seconds != null ? Number((existing as any).completed_duration_seconds) : NaN;
  const existingRepsNum = existing?.actual_reps != null ? Number(existing.actual_reps) : NaN;
  const hasLoggedValue = isTimeKind
    ? Number.isFinite(existingDurNum) && existingDurNum > 0
    : hideWeight
      ? Number.isFinite(existingRepsNum) && existingRepsNum > 0
      // Load of 0 is valid (bodyweight / unloaded). Reps still required.
      : Number.isFinite(existingRepsNum) && existingRepsNum > 0 && Number.isFinite(existingLoadNum) && existingLoadNum >= 0;
  const isConfirmed = Boolean(existing?.completed_at) && hasLoggedValue;
  // hasAnyEntry only counts weight (the field the client must enter) and
  // manually-edited reps/RPE. Pre-filled prescription values do NOT count
  // as draft data — otherwise every unlogged set shows the amber border.
  const hasAnyEntry = load.length > 0 || repsEdited || rpeEdited;
  const isDraft = !isConfirmed && (hasAnyEntry || (existing && !existing.completed_at));

  const isAbortError = (err: unknown) => {
    const e = err as { code?: string; message?: string } | null | undefined;
    if (!e) return false;
    if (e.code === "25P02") return true;
    return String(e.message ?? "").toLowerCase().includes("current transaction is aborted");
  };

  const writeStatusWithAbortRetry = async (fn: () => Promise<any>) => {
    try {
      return await fn();
    } catch (err) {
      if (!isAbortError(err)) throw err;
      await new Promise((r) => setTimeout(r, 200));
      return await fn();
    }
  };

  const withStatusTimeout = async (promise: Promise<any>) => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    try {
      return await Promise.race([
        promise,
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error("Set status save timed out")), 8000);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  const saveCompletionStatus = async () => {
    if (readonly || !clientId || statusSaving) return;
    const nextCompletedAt = isConfirmed ? null : new Date().toISOString();
    const loadNum = load ? Number(load) : null;
    const repsNum = reps ? parseInt(reps, 10) : null;
    const rpeNum = rpe ? Number(rpe) : null;
    const loadUnit = persistedUnitForValue(load, unit, existing);
    const currentHasRequiredValues = isTimeKind
      ? Number.isFinite(existingDurNum) && existingDurNum > 0
      : hideWeight
        ? repsNum != null && Number.isFinite(repsNum) && repsNum > 0
        : repsNum != null && Number.isFinite(repsNum) && repsNum > 0 && loadNum != null && Number.isFinite(loadNum) && loadNum >= 0;
    if (nextCompletedAt && !currentHasRequiredValues) {
      toast.error(isTimeKind ? "Complete the timer first" : hideWeight ? "Enter reps before marking complete" : "Enter reps and weight before marking complete (use 0 for bodyweight)");
      return;
    }
    let payload: Record<string, any> = {
        row_id: rowId,
        client_id: clientId,
        set_index: setIndex,
        actual_load: loadNum,
        actual_load_unit: loadUnit,
        entered_value: loadNum,
        entered_unit: loadUnit,
        actual_reps: repsNum,
        actual_rpe: rpe || null,
        actual_rpe_num: rpeNum,
      completed_at: nextCompletedAt,
    };
      payload = withMemberWorkoutIndexes(payload, adapter, workoutId);
    setStatusSaving(true);
    setStatusError(null);
    try {
      if (existing?.id) {
        if (adapter) {
          await withStatusTimeout(writeStatusWithAbortRetry(() => adapter.upsertPlRowResultRaw(payload, existing.id)));
        } else {
          await withStatusTimeout(writeStatusWithAbortRetry(async () => {
            const { error } = await sb.from("pl_row_results").update(payload).eq("id", existing.id);
            if (error) throw error;
          }));
        }
      } else if (adapter) {
        await withStatusTimeout(writeStatusWithAbortRetry(() => adapter.upsertPlRowResultRaw(payload, null)));
      } else {
        await withStatusTimeout(writeStatusWithAbortRetry(async () => {
          const { error } = await sb
            .from("pl_row_results")
            .upsert(payload, { onConflict: "client_id,row_id,set_index" });
          if (error) throw error;
        }));
      }
      await qc.refetchQueries({ queryKey: ["pl-day-results", workoutId] });
      onChange();
      if (nextCompletedAt) onSetCompleted?.(setIndex);
    } catch (err: any) {
      const message = err?.message ?? "Set status failed to save";
      setStatusError(message);
      toast.error("Set status didn’t save — tap the status icon to retry");
    } finally {
      setStatusSaving(false);
    }
  };

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
    const pkg = prevExisting.actual_load;
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
    // Allow saving even when prescribedSec is null (e.g. reps_text-detected time exercises)
    if (readonly || !clientId) return;
    const nowIso = opts.completedAt ?? new Date().toISOString();
      const payload: Record<string, any> = withMemberWorkoutIndexes({
      row_id: rowId,
      client_id: clientId,
      set_index: setIndex,
      completed_duration_seconds: completedSeconds,
      timer_started_at: opts.startedAt ?? null,
      timer_completed_at: nowIso,
      completion_method: opts.method,
      completed_at: nowIso,
      }, adapter, workoutId);
    try {
      if (existing?.id) {
        if (adapter) {
          await adapter.upsertPlRowResultRaw(payload, existing.id);
        } else {
          const { error } = await sb.from("pl_row_results").update(payload).eq("id", existing.id);
          if (error) throw error;
        }
      } else {
        if (adapter) {
          await adapter.upsertPlRowResultRaw(payload, null);
        } else {
          const { error } = await sb.from("pl_row_results").upsert(payload, { onConflict: "client_id,row_id,set_index" });
          if (error) throw error;
        }
      }
      await qc.refetchQueries({ queryKey: ["pl-day-results", workoutId] });
      onChange();
      if (!existing?.completed_at) onSetCompleted?.(setIndex);
      toast.success(
        opts.finishedEarly && prescribedSec
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
      statusError && "bg-destructive/10 border-l-2 border-l-destructive ring-1 ring-destructive/40",
    )}>
    <div className={cn(
      "grid items-start gap-1.5 px-2.5 py-1.5",
      isTime
        ? (focusMode ? "grid-cols-[36px_1fr_44px]" : "grid-cols-[28px_1fr_36px]")
        : hideWeight
          ? (focusMode ? "grid-cols-[36px_1.6fr_1fr_52px]" : "grid-cols-[28px_1.6fr_1fr_44px]")
          : (focusMode ? "grid-cols-[36px_1fr_1fr_1.3fr_52px]" : "grid-cols-[28px_1fr_1fr_1.3fr_44px]"),
    )}>
      <span className={cn("font-mono text-muted-foreground pt-1.5", focusMode ? "text-sm" : "text-xs")}>{setIndex}</span>
      {isTime ? (
        <DurationTimerInCard
          prescribedSeconds={prescribedSec}
          isConfirmed={isConfirmed}
          completedSeconds={completedSec}
          readonly={readonly}
          focusMode={focusMode}
          onComplete={(secs, method) => void saveTimeCompletion(secs, { method })}
        />
      ) : (
      /* Quick Log reps chip — tap to edit */
      repsChipOpen ? (
        <Input
          autoFocus
          className={cn(focusMode ? "h-9 text-base px-2" : "h-8 text-sm px-2")}
          inputMode="numeric"
          type="text"
          pattern="[0-9]*"
          placeholder="reps"
          aria-label={`Set ${setIndex} reps`}
          value={reps}
          onChange={(e) => { setReps(e.target.value.replace(/[^0-9]/g, "")); setRepsEdited(true); }}
          onFocus={() => setFocusedField("reps")}
          onKeyDown={onEnter}
          onBlur={() => {
            // Block server-reset effect immediately (optimistic guard) so the
            // refetch triggered by flush() can never overwrite what was typed.
            recentlySavedRef.current = true;
            if (recentlySavedTimerRef.current) clearTimeout(recentlySavedTimerRef.current);
            recentlySavedTimerRef.current = setTimeout(() => { recentlySavedRef.current = false; }, 8000);
            flushSaveAfterEdit();
            setRepsChipOpen(false);
          }}
          readOnly={readonly}
          disabled={readonly}
        />
      ) : (
        <button
          type="button"
          onClick={() => { if (!readonly) setRepsChipOpen(true); }}
          aria-label={`Set ${setIndex} reps — tap to edit`}
          className={cn(
            "flex items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors whitespace-nowrap",
            focusMode ? "h-9 text-base" : "h-8",
            !reps
              ? "border-blue-500/40 bg-blue-500/10 text-foreground"
              : "border-border/60 bg-muted/40 text-muted-foreground",
            !readonly && !reps && "hover:border-blue-500/60 hover:bg-blue-500/10 cursor-pointer",
            !readonly && !!reps && "hover:bg-muted/60 cursor-pointer",
            readonly && "cursor-default",
          )}
        >
          {reps || "—"}
        </button>
      )
      )}
      {/* Quick Log RPE chip — tap to edit (hidden for time rows: timer handles the full middle column) */}
      {!isTime && rpeChipOpen ? (
        <Input autoFocus
          className={cn(focusMode ? "h-9 text-base px-2" : "h-8 text-sm px-2")}
          inputMode="decimal" type="text" pattern="[0-9]*\.?[0-9]*"
          placeholder={showRir ? "rir" : "rpe"}
          aria-label={`Set ${setIndex} ${showRir ? "RIR" : "RPE"}`}
          value={showRir && rpe !== "" ? String(Math.max(0, 10 - Number(rpe))) : rpe}
          onChange={(e) => {
            const cleaned = e.target.value.replace(/[^0-9.]/g, "");
            setRpeEdited(true);
            if (showRir && cleaned !== "") {
              const n = Number(cleaned);
              if (isFinite(n)) { setRpe(String(Math.max(0, Math.min(10, 10 - n)))); return; }
            }
            setRpe(cleaned);
          }}
          onFocus={() => setFocusedField("rpe")}
          onKeyDown={onEnter}
          onBlur={() => {
            recentlySavedRef.current = true;
            if (recentlySavedTimerRef.current) clearTimeout(recentlySavedTimerRef.current);
            recentlySavedTimerRef.current = setTimeout(() => { recentlySavedRef.current = false; }, 8000);
            flushSaveAfterEdit();
            setRpeChipOpen(false);
          }}
          readOnly={readonly} disabled={readonly}
        />
      ) : (
        <button type="button"
          onClick={() => { if (!readonly) setRpeChipOpen(true); }}
          aria-label={`Set ${setIndex} ${showRir ? "RIR" : "RPE"} — tap to edit`}
          className={cn(
            "flex items-center justify-center rounded-md border px-2 text-sm font-medium transition-colors whitespace-nowrap",
            focusMode ? "h-9 text-base" : "h-8",
            !rpe
              ? "border-blue-500/40 bg-blue-500/10 text-foreground"
              : "border-border/60 bg-muted/40 text-muted-foreground",
            !readonly && !rpe && "hover:border-blue-500/60 hover:bg-blue-500/10 cursor-pointer",
            !readonly && !!rpe && "hover:bg-muted/60 cursor-pointer",
            readonly && "cursor-default",
          )}
        >
          {rpe ? (showRir ? String(Math.max(0, 10 - Number(rpe))) : rpe) : "—"}
        </button>
      )}
      {!isTime && !hideWeight && (
      <Input
        className={cn(
          focusMode ? "h-9 text-base px-2" : "h-8 text-sm px-2",
          load === "" || load == null
            ? "border-blue-500/40 bg-blue-500/10 text-foreground"
            : "border-border/60 bg-muted/40 text-muted-foreground",
        )}
        inputMode="decimal"
        type="text"
        pattern="[0-9]*\.?[0-9]*"
        placeholder={unit}
        aria-label={`Set ${setIndex} weight in ${unit}`}
        value={load}
        onChange={(e) => setLoad(e.target.value.replace(/[^0-9.]/g, ""))}
        onFocus={() => {
          setFocusedField("load");
          // Set guard on focus too — prevents window-focus refetches from
          // overwriting the value while the user is actively typing weight.
          recentlySavedRef.current = true;
          if (recentlySavedTimerRef.current) clearTimeout(recentlySavedTimerRef.current);
          recentlySavedTimerRef.current = setTimeout(() => { recentlySavedRef.current = false; }, 8000);
        }}
        onKeyDown={onEnter}
        onBlur={() => {
          flushSaveAfterEdit();
        }}
        readOnly={readonly}
        disabled={readonly}
      />
      )}
      <div className="flex items-center justify-end gap-1">
        {/* Compact indicator — smooth pencil (pending) → spinner (saving) →
            check (saved) transition so the row reflects sync status in real
            time. Full error label renders below the row to avoid overlapping
            the weight input. */}
        {(() => {
          if (readonly || isConfirmed) return null;
          const dirty = save.hasPending();
          const displayState: typeof save.state =
            save.state === "saving" || save.state === "offline" || save.state === "saved"
              ? save.state
              : dirty
                ? "idle"
                : null as any;
          if (!displayState) return null;
          return <SaveStatus state={displayState} savedAt={save.savedAt} compact />;
        })()}
        {!readonly ? (
          <button
            type="button"
            onClick={() => void saveCompletionStatus()}
            disabled={statusSaving}
            title={statusError ? "Status failed to save — tap to retry" : isConfirmed ? "Mark set incomplete" : "Mark set complete"}
            aria-label={statusError ? `Retry saving set ${setIndex} status` : isConfirmed ? `Mark set ${setIndex} incomplete` : `Mark set ${setIndex} complete`}
            className={cn(
              "inline-flex h-7 w-7 items-center justify-center rounded-full border transition-colors",
              isConfirmed
                ? "border-green-500/40 bg-green-500/10 text-green-500"
                : "border-border bg-background text-muted-foreground hover:border-green-500/50 hover:text-green-500",
              statusError && "border-destructive bg-destructive/10 text-destructive hover:text-destructive",
              statusSaving && "cursor-wait opacity-70",
            )}
          >
            {statusSaving ? (
              <RefreshCw className="h-4 w-4 animate-spin" />
            ) : statusError ? (
              <AlertTriangle className="h-4 w-4" />
            ) : isConfirmed ? (
              <CheckCircle2 className="h-4 w-4" />
            ) : (
              <Circle className="h-4 w-4" />
            )}
          </button>
        ) : (
          isConfirmed && <CheckCircle2 className="h-4 w-4 text-green-500" />
        )}
      </div>
    </div>
    {!readonly && !isConfirmed && save.state === "error" && (
      <div className="flex items-center justify-between gap-2 px-3 pb-1.5">
        <SaveStatus
          state={save.state}
          savedAt={save.savedAt}
          onRetry={save.retry}
        />
      </div>
    )}
    {statusError && (
      <div className="px-3 pb-1.5 text-[11px] font-medium text-destructive">
        Status failed to save. Tap the status icon to retry.
      </div>
    )}

    {/* Quick-fill chip row — Suggested values are visible but never auto-confirm */}
    {/* Copy Previous — compact secondary action for set 2+ */}
    {!readonly && !isConfirmed && setIndex > 1 && prevExisting?.completed_at && (() => {
      const prevWeight = prevExisting.actual_load;
      if (prevWeight == null) return null;
      return (
        <div className="px-3 pb-1.5">
          <button
            type="button"
            onClick={copyPrevious}
            className="h-7 rounded-md border border-border/60 bg-transparent px-2.5 text-[11px] text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
          >
            Copy Previous ({fmtNum(Number(prevWeight))} {unit})
          </button>
        </div>
      );
    })()}

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

    {/* WorkoutTimerSheet replaced by DurationTimerInCard (in-card timer, no overlay) */}
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