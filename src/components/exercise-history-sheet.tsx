import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExerciseRecordsForClient } from "@/components/records/training-records";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, CheckCircle2, Circle, StickyNote, Pencil, Loader2, ChevronDown, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import { matchingHistoryExerciseIds } from "@/lib/workout-previous-lift";
import { listenChannel } from "@/lib/realtime-channel";
import { toast } from "sonner";
import {
  HISTORY_EDIT_QUERY_KEYS,
  cardioDraftIssue,
  cardioEditDraft,
  cardioEditPatch,
  setDraftIssue,
  setEditDraft,
  setEditPatch,
  type CardioDraft,
  type SetDraft,
} from "@/lib/history-set-edit";
import { cardioClock, cardioHistorySummary, isCardioHistory } from "@/lib/cardio-history";
import { formatDistance, formatPace, isRunningExercise, paceSeconds, readDistanceUnit } from "@/lib/running/run-log";
import { LiftProgressCard, type LiftHistory } from "@/components/analytics/lift-progress-card";
import { liftHistoryFromRows } from "@/lib/analytics/exercise-progress";
import {
  dayRefOf,
  historySetOf,
  progressSince,
  relativeDay,
  sameSplit,
  sessionGroups,
  setText,
  workoutName,
  type HistoryDayRef,
} from "@/lib/workouts/exercise-history";

const sb = supabase as any;

type HistorySet = { set_index?: number | null; pl_exercise_rows?: { id?: string; sort_order?: number | null } | null };

/**
 * A day's sets in the order they were done: the exercise's place in the
 * workout (the same lift can sit on two rows, each starting at set 1), then
 * the set number. Never by when the row was saved: a weight that fills the
 * sets below saves them all at once, in whatever order the writes land.
 */
export function historySetOrder(x: HistorySet, y: HistorySet): number {
  const rx = x.pl_exercise_rows?.sort_order ?? 0;
  const ry = y.pl_exercise_rows?.sort_order ?? 0;
  if (rx !== ry) return rx - ry;
  // two rows in the same spot: keep each row's sets together
  const ix = x.pl_exercise_rows?.id ?? "";
  const iy = y.pl_exercise_rows?.id ?? "";
  if (ix !== iy) return ix < iy ? -1 : 1;
  return (x.set_index ?? 0) - (y.set_index ?? 0);
}

/**
 * Exercise history sheet.
 *
 * Shows every prior logged set for `clientId` + `exerciseId` across all
 * blocks/weeks/days. Display unit comes from the caller (`displayUnit`);
 * values are read from the normalized columns so the original entered
 * value/unit on each row is never overwritten.
 *
 * Used by both the client logger ("History" button on each exercise card)
 * and the coach client-profile history page.
 *
 * `editable`: a day's sets can be fixed right here (Edit on the day: weight,
 * its kg / lb, reps, RPE; Save writes only what changed), so the athlete or
 * the coach never leaves the workout they're in, and "Last time", records and
 * suggestions refresh at once (HISTORY_EDIT_QUERY_KEYS).
 */
export function ExerciseHistorySheet({
  open,
  onOpenChange,
  clientId,
  exerciseId,
  exerciseName,
  displayUnit = "kg",
  excludePartial = false,
  currentDayIndex,
  currentDayId = null,
  editable = false,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string | null | undefined;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  /** When true, hide sets without a completed_at timestamp. */
  excludePartial?: boolean;
  /** Program day index of the workout the history was opened from (kept for older callers; currentDayId decides). */
  currentDayIndex?: number | null;
  /** The workout the history was opened from: it's left out of the list (it's on screen), and its split is marked. */
  currentDayId?: string | null;
  /** The viewer may fix a past day's sets here (their own, or a client they coach). */
  editable?: boolean;
}) {
  // What was lifted: finished sets only, unless asked (a set filled in but never
  // finished isn't something they lifted).
  const [showPartial, setShowPartial] = useState(false);
  void excludePartial;
  // One day in edit mode at a time; drafts keyed by set id.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // A day reads as one line of coach shorthand; its set table opens on a tap.
  const [openDays, setOpenDays] = useState<Set<string>>(() => new Set());
  const toggleDay = (k: string) => setOpenDays((cur) => {
    const next = new Set(cur);
    if (next.has(k)) next.delete(k);
    else next.add(k);
    return next;
  });
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [cardioDrafts, setCardioDrafts] = useState<Record<string, CardioDraft>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  // Sessions shown before "Show older sessions".
  const [shown, setShown] = useState(10);
  const [moreOpen, setMoreOpen] = useState(false);
  const [onlySplit, setOnlySplit] = useState(false);
  const queryClient = useQueryClient();

  // Realtime: refetch when this client's logged sets or day completions
  // change so the history stays in sync across devices/coach view without
  // the user needing to reopen the sheet.
  useEffect(() => {
    if (!open || !clientId) return;
    const channel = (listenChannel(`exercise-history-${clientId}-${exerciseId ?? "all"}`) as any)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pl_row_results", filter: `client_id=eq.${clientId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["exercise-history", clientId, exerciseId] });
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "pl_day_completions", filter: `client_id=eq.${clientId}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ["exercise-history-completions", clientId] });
        },
      )
      .subscribe();
    return () => {
      sb.removeChannel(channel);
    };
  }, [open, clientId, exerciseId, queryClient]);

  // Canonical identity for this exercise, shared with the LAST TIME badge:
  // the row's own exercise id plus any library duplicates/renames whose name
  // normalizes identically. Similar-but-different exercises never merge.
  const { data: identityIds = [] } = useQuery({
    queryKey: ["exercise-history-identity", exerciseId ?? null, exerciseName],
    enabled: open && (!!exerciseId || !!exerciseName),
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const token = String(exerciseName ?? "").split(/[^A-Za-z0-9]+/).filter(Boolean)[0] ?? "";
      let catalog: { id: string; name: string | null }[] = [];
      if (token) {
        const { data } = await sb.from("exercises").select("id, name").ilike("name", `%${token}%`).limit(300);
        catalog = (data ?? []) as { id: string; name: string | null }[];
      }
      return matchingHistoryExerciseIds(exerciseId, exerciseName, catalog);
    },
  });

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["exercise-history", clientId, exerciseId ?? null, exerciseName, identityIds.join(",")],
    enabled: !!clientId && (!!exerciseId || !!exerciseName) && open,
    staleTime: 2 * 60_000,   // cache for 2 min — avoids re-fetch on every open
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      // Match by canonical exercise identity when we have one; otherwise fall
      // back to the row's custom name override so custom-named exercises
      // (no exercise_id) still show a training history.
      const ids = identityIds.length ? identityIds : exerciseId ? [exerciseId] : [];
      // Read whole, page by page: a long history is never cut off silently.
      const PAGE = 1000;
      const out: any[] = [];
      for (let from = 0; from < 10 * PAGE; from += PAGE) {
        let q = sb
          .from("pl_row_results")
          .select(`
            id, set_index, completed_at, updated_at, created_at,
            actual_reps, actual_rpe, actual_rpe_num, actual_rir, mean_concentric_velocity_mps,
            completed_duration_seconds, actual_calories, actual_distance_m, actual_distance_unit,
            entered_value, entered_unit, normalized_kg, normalized_lb,
            actual_load, actual_load_unit, load_type, is_bodyweight,
            pl_exercise_rows!inner(
              id, exercise_id, exercise_name_override, sort_order,
              pl_days!inner(id, day_index, title, subtitle, source_day_id, scheduled_date, pl_weeks!inner(id, week_index, pl_blocks!inner(id, name, prep_id)))
            )
          `)
          .eq("client_id", clientId)
          .order("updated_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, from + PAGE - 1);
        if (ids.length) q = q.in("pl_exercise_rows.exercise_id", ids);
        else if (exerciseName) q = q.eq("pl_exercise_rows.exercise_name_override", exerciseName);
        const { data, error } = await q;
        if (error) throw error;
        out.push(...(data ?? []));
        if (!data || data.length < PAGE) break;
      }
      return out;
    },
  });

  // The workout the sheet was opened from, by its stable ids (its block, its
  // program, the day it was copied from), so the same split is marked by what
  // it is, never by being day 2 of some other program's week.
  const { data: currentRef = null } = useQuery({
    queryKey: ["exercise-history-current-day", currentDayId],
    enabled: open && !!currentDayId,
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<HistoryDayRef | null> => {
      const { data } = await sb
        .from("pl_days")
        .select("id, day_index, title, subtitle, source_day_id, pl_weeks!inner(pl_blocks!inner(id, prep_id))")
        .eq("id", currentDayId)
        .maybeSingle();
      return data ? dayRefOf(data, data.pl_weeks?.pl_blocks) : null;
    },
  });

  // Pull the canonical workout-completion timestamps for every day shown so
  // we display the actual workout date, not the last-autosave timestamp on
  // an individual set row.
  const dayIds = useMemo(() => {
    const s = new Set<string>();
    for (const r of rows) {
      const id = r?.pl_exercise_rows?.pl_days?.id;
      if (id) s.add(id);
    }
    return [...s];
  }, [rows]);

  const { data: completions = [] } = useQuery({
    queryKey: ["exercise-history-completions", clientId, dayIds],
    enabled: !!clientId && dayIds.length > 0 && open,
    staleTime: 2 * 60_000,
    gcTime: 10 * 60_000,
    queryFn: async () => {
      const { data, error } = await sb
        .from("pl_day_completions")
        .select("day_id, completed_at")
        .eq("client_id", clientId)
        .in("day_id", dayIds);
      if (error) throw error;
      return (data ?? []) as { day_id: string; completed_at: string }[];
    },
  });
  const completionMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of completions) m.set(c.day_id, c.completed_at);
    return m;
  }, [completions]);

  // Resolve the canonical "training date" for a group. Prefer the day's
  // scheduled_date (parsed as a local calendar date), then the workout
  // completion timestamp, then the earliest set's created_at, then any
  // set-level timestamp as a last resort.
  const resolveGroupDate = (g: { day: any; sets: any[] }): number => {
    const scheduled: string | null = g.day?.scheduled_date ?? null;
    if (scheduled) {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduled);
      if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
      const t = Date.parse(scheduled);
      if (!Number.isNaN(t)) return t;
    }
    const completionTs = completionMap.get(g.day?.id);
    if (completionTs) {
      const t = Date.parse(completionTs);
      if (!Number.isNaN(t)) return t;
    }
    const earliestCreated = g.sets
      .map((s: any) => s.created_at)
      .filter(Boolean)
      .sort()[0];
    const fallback = earliestCreated ?? g.sets[0]?.completed_at ?? g.sets[0]?.updated_at;
    return fallback ? Date.parse(fallback) : 0;
  };

  const grouped = useMemo(() => {
    const filtered = rows.filter((r: any) => (showPartial ? true : !!r.completed_at));
    const byDay = new Map<string, { day: any; week: any; block: any; sets: any[] }>();
    for (const r of filtered) {
      const er = r.pl_exercise_rows;
      const d = er?.pl_days;
      const w = d?.pl_weeks;
      const b = w?.pl_blocks;
      if (!d) continue;
      // The workout it was opened from is on screen already: history is the ones before.
      if (currentDayId && d.id === currentDayId) continue;
      const k = `${b?.id ?? "?"}-${w?.id ?? "?"}-${d.id}`;
      if (!byDay.has(k)) byDay.set(k, { day: d, week: w, block: b, sets: [] });
      byDay.get(k)!.sets.push(r);
    }
    // Most recent training date first, using the same resolver the header
    // renders so ordering matches the visible date on each card.
    const list = [...byDay.values()];
    list.sort((a, b) => resolveGroupDate(b) - resolveGroupDate(a));
    for (const g of list) g.sets.sort(historySetOrder);
    return list.map((g) => {
      const ref = dayRefOf(g.day, g.block);
      return {
        ...g,
        key: `${g.block?.id ?? "?"}-${g.week?.id ?? "?"}-${g.day?.id}`,
        at: resolveGroupDate(g),
        name: workoutName(ref),
        same: sameSplit(ref, currentRef),
        hsets: g.sets.map(historySetOf),
      };
    });
    // resolveGroupDate reads completionMap
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, showPartial, completionMap, currentDayId, currentRef]);

  // A treadmill walk or a bike is time, calories and effort, never load / reps / velocity.
  const cardio = useMemo(() => isCardioHistory(exerciseName, rows), [exerciseName, rows]);
  // This exercise's progress (the Analytics page's lift card, for one lift),
  // from the same sets the list below shows, in the range picked above.
  const progress = useMemo<LiftHistory | null>(
    // the open workout is on screen, not history: left out here as in the list
    () => (cardio ? null : liftHistoryFromRows((rows as any[]).filter((r) => { const id = r?.pl_exercise_rows?.pl_days?.id; return !!id && id !== currentDayId; }), exerciseName)),
    [cardio, rows, exerciseName, currentDayId],
  );
  // A run reads by distance and pace instead of calories.
  const runHistory = useMemo(
    () => cardio && (isRunningExercise(exerciseName) || rows.some((r: any) => Number(r.actual_distance_m) > 0)),
    [cardio, exerciseName, rows],
  );
  const distanceUnit = useMemo(() => readDistanceUnit(), []);
  const cardioSummary = useMemo(() => {
    if (!cardio) return null;
    const ymd = (t: number) => (t ? format(new Date(t), "yyyy-MM-dd") : "");
    return cardioHistorySummary(grouped.map((g) => ({ date: ymd(resolveGroupDate(g)), sets: g.sets })));
    // resolveGroupDate reads completionMap, which `grouped` already depends on
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cardio, grouped]);

  const fmtLoad = (r: any): string => {
    // Always show the load in the unit the client actually entered on
    // that set. Converting historical entries into the caller's current
    // `displayUnit` produced misleading rows like "54.4 kg (orig 120 lb)"
    // — the client trained in pounds, they should see pounds.
    const enteredUnit: "kg" | "lb" | null =
      r.entered_unit === "kg" || r.entered_unit === "lb"
        ? r.entered_unit
        : r.actual_load_unit === "kg" || r.actual_load_unit === "lb"
          ? r.actual_load_unit
          : null;
    const unit: "kg" | "lb" = enteredUnit ?? displayUnit;
    // Prefer the raw entered value; fall back to the matching normalized
    // column so pre-migration rows without entered_value still render.
    let n: number | null = null;
    if (r.entered_value != null && enteredUnit) n = Number(r.entered_value);
    else if (r.actual_load != null && enteredUnit) n = Number(r.actual_load);
    else {
      const v = unit === "kg" ? r.normalized_kg : r.normalized_lb;
      if (v == null) return "—";
      n = Number(v);
    }
    if (n == null || Number.isNaN(n)) return "—";
    const rounded = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Number(n.toFixed(1));
    return `${rounded} ${unit}`;
  };

  const startEdit = (key: string, sets: any[]) => {
    const next: Record<string, SetDraft> = {};
    const nextCardio: Record<string, CardioDraft> = {};
    for (const set of sets) {
      next[set.id] = setEditDraft(set, displayUnit);
      nextCardio[set.id] = cardioEditDraft(set, distanceUnit);
    }
    setDrafts(next);
    setCardioDrafts(nextCardio);
    setEditError(null);
    setEditingKey(key);
  };
  const cancelEdit = () => {
    setEditingKey(null);
    setDrafts({});
    setCardioDrafts({});
    setEditError(null);
  };
  const patchDraft = (id: string, change: Partial<SetDraft>) => {
    setEditError(null);
    setDrafts((d) => (d[id] ? { ...d, [id]: { ...d[id], ...change } } : d));
  };
  const patchCardioDraft = (id: string, change: Partial<CardioDraft>) => {
    setEditError(null);
    setCardioDrafts((d) => (d[id] ? { ...d, [id]: { ...d[id], ...change } } : d));
  };
  const saveEdit = async (sets: any[]) => {
    for (const set of sets) {
      const issue = cardio
        ? cardioDrafts[set.id] ? cardioDraftIssue(cardioDrafts[set.id]) : null
        : drafts[set.id] ? setDraftIssue(drafts[set.id]) : null;
      if (issue) {
        setEditError(`Set ${sets.indexOf(set) + 1}: ${issue}`);
        return;
      }
    }
    const writes = sets
      .map((set) => ({
        id: set.id as string,
        patch: cardio
          ? cardioDrafts[set.id] ? cardioEditPatch(set, cardioDrafts[set.id]) : null
          : drafts[set.id] ? setEditPatch(set, drafts[set.id], displayUnit) : null,
      }))
      .filter((w) => w.patch);
    if (!writes.length) {
      cancelEdit();
      return;
    }
    setSaving(true);
    try {
      for (const w of writes) {
        // .select() so a row RLS didn't let through reads as a failure, never as saved.
        const { data, error } = await sb.from("pl_row_results").update(w.patch).eq("id", w.id).select("id");
        if (error) throw error;
        if (!data?.length) throw new Error("You can't change this set");
      }
      // Everything this history feeds refreshes now: "Last time", records,
      // suggestions and, when it's today's, the open workout's own sets.
      await Promise.all(HISTORY_EDIT_QUERY_KEYS.map((queryKey) => queryClient.invalidateQueries({ queryKey: [...queryKey] })));
      toast.success(writes.length === 1 ? "Set updated" : `${writes.length} sets updated`);
      cancelEdit();
    } catch (e: any) {
      setEditError(e?.message ? `Couldn't save: ${e.message}` : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  // What's on screen: every session, or only the open workout's split when picked.
  const splitCount = grouped.filter((g) => g.same).length;
  const filterable = splitCount > 0 && splitCount < grouped.length;
  const visible = filterable && onlySplit ? grouped.filter((g) => g.same) : grouped;
  const currentName = currentRef ? workoutName(currentRef) : null;
  const firstAt = grouped.length ? Math.min(...grouped.map((g) => g.at).filter((t) => t > 0)) : 0;
  const thisYear = new Date().getFullYear();
  // The one progress line: like with like, within one program (exercise-history.ts).
  const progressLine = useMemo(
    () => (cardio ? null : progressSince(
      grouped.map((g) => ({ key: g.key, at: g.at, blockId: g.block?.id ?? null, programId: g.block?.prep_id ?? null, sets: g.hsets })),
      displayUnit,
    )),
    [cardio, grouped, displayUnit],
  );
  // A cardio session in one line: its time, distance or calories, and the hardest RPE.
  const cardioLine = (sets: any[]): string => {
    const secs = sets.reduce((t, s) => t + (Number(s.completed_duration_seconds) > 0 ? Number(s.completed_duration_seconds) : 0), 0);
    const meters = sets.reduce((t, s) => t + (Number(s.actual_distance_m) > 0 ? Number(s.actual_distance_m) : 0), 0);
    const cals = sets.reduce((t, s) => t + (Number(s.actual_calories) > 0 ? Number(s.actual_calories) : 0), 0);
    const rpes = sets.map((s) => Number(s.actual_rpe_num ?? s.actual_rpe)).filter((n) => Number.isFinite(n) && n > 0);
    return [
      secs > 0 ? cardioClock(secs) : null,
      runHistory && meters > 0 ? formatDistance(meters, distanceUnit) : null,
      !runHistory && cals > 0 ? `${cals} kcal` : null,
      rpes.length ? `RPE ${Math.max(...rpes)}` : null,
    ].filter(Boolean).join(" · ") || "—";
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-lg"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        }}
        data-exercise-history
      >
        <SheetHeader>
          <SheetTitle className="text-xl leading-tight">{exerciseName}</SheetTitle>
          <SheetDescription className="text-[13px]">
            {isLoading
              ? "Loading your sessions…"
              : grouped.length === 0
                ? "No sessions yet"
                : `${grouped.length} ${grouped.length === 1 ? "session" : "sessions"}${firstAt ? ` · since ${format(new Date(firstAt), new Date(firstAt).getFullYear() === thisYear ? "MMM d" : "MMM d, yyyy")}` : ""}`}
          </SheetDescription>
        </SheetHeader>

        {progressLine && (
          <p className="mt-3 flex items-start gap-2 text-sm leading-snug text-foreground" data-history-progress-line={progressLine.direction}>
            {progressLine.direction === "up"
              ? <TrendingUp className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              : progressLine.direction === "down"
                ? <TrendingDown className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                : <Minus className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
            <span>{progressLine.text}</span>
          </p>
        )}

        {cardioSummary && cardioSummary.sessions > 0 && (
          <div className="mt-3 rounded-xl bg-muted/50 p-3" data-cardio-history-summary>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Sessions", value: String(cardioSummary.sessions) },
                { label: "Avg time", value: cardioClock(cardioSummary.avgSeconds) },
                runHistory
                  ? { label: "Avg distance", value: formatDistance(cardioSummary.avgMeters, distanceUnit) || "—" }
                  : { label: "Avg kcal", value: cardioSummary.avgCalories != null ? String(cardioSummary.avgCalories) : "—" },
                { label: "Avg RPE", value: cardioSummary.avgRpe != null ? String(cardioSummary.avgRpe) : "—" },
              ].map((x) => (
                <div key={x.label} className="min-w-0">
                  <div className="text-base font-semibold tabular-nums text-foreground">{x.value}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{x.label}</div>
                </div>
              ))}
            </div>
            {cardioSummary.effort && (
              <p className="mt-2 border-t border-border pt-2 text-xs text-muted-foreground" data-cardio-history-effort={cardioSummary.effort.direction}>
                {cardioSummary.effort.text}
              </p>
            )}
          </div>
        )}

        {/* The open workout's split, one tap to see only it (only when there's both). */}
        {filterable && (
          <div className="mt-3 flex gap-1 rounded-lg bg-muted/60 p-1" role="group" aria-label="Which sessions" data-history-split-filter>
            <button
              type="button"
              aria-pressed={!onlySplit}
              onClick={() => setOnlySplit(false)}
              className={cn("h-9 shrink-0 rounded-md px-3 text-[13px] font-medium transition-colors", !onlySplit ? "bg-background text-foreground" : "text-muted-foreground")}
            >
              All · {grouped.length}
            </button>
            <button
              type="button"
              aria-pressed={onlySplit}
              onClick={() => setOnlySplit(true)}
              className={cn("h-9 min-w-0 flex-1 truncate rounded-md px-3 text-[13px] font-medium transition-colors", onlySplit ? "bg-background text-foreground" : "text-muted-foreground")}
            >
              {currentName ?? "This workout"} · {splitCount}
            </button>
          </div>
        )}

        <div className="mt-3">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          )}
          {!isLoading && grouped.length === 0 && (
            <div className="rounded-xl bg-muted/50 p-5 text-center" data-history-empty>
              <div className="text-sm font-semibold">No sessions yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {cardio
                  ? "Log a session and it will show here next time."
                  : "Finish a set of this exercise and it will show here next time."}
              </div>
            </div>
          )}
          <ul className="space-y-1">
            {visible.slice(0, shown).map((g) => {
              const dayKey = g.key;
              const isOpen = openDays.has(dayKey);
              const editing = editingKey === dayKey;
              const rel = g.at ? relativeDay(g.at) : null;
              const groups = cardio ? [] : sessionGroups(g.hsets, displayUnit);
              const hasVelocity = g.sets.some((s: any) => s.mean_concentric_velocity_mps != null);
              return (
                <li
                  key={dayKey}
                  className={cn("rounded-xl px-3 py-2.5", g.same && "bg-muted/60")}
                  data-history-session
                  data-same-split={g.same || undefined}
                >
                  <button
                    type="button"
                    onClick={() => toggleDay(dayKey)}
                    aria-expanded={isOpen}
                    data-history-day-summary
                    className="flex w-full items-start gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-[15px] font-semibold text-foreground">
                          {g.at ? format(new Date(g.at), new Date(g.at).getFullYear() === thisYear ? "EEE, MMM d" : "EEE, MMM d, yyyy") : "—"}
                        </span>
                        {rel && <span className="text-xs text-muted-foreground">{rel}</span>}
                      </span>
                      <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground" data-history-session-workout>
                        {g.same && (
                          <span className="mr-1.5 inline-flex h-5 items-center rounded-full bg-background px-1.5 align-[1px] text-[11px] font-medium text-foreground" data-same-split-tag>
                            Same split
                          </span>
                        )}
                        <span className={g.same ? "font-medium text-foreground" : undefined}>{g.name}</span>
                        {g.block?.name ? ` · ${g.block.name}` : ""}
                        {g.week?.week_index ? ` · Week ${g.week.week_index}` : ""}
                      </span>
                      {cardio ? (
                        <span className="mt-1.5 block text-[15px] font-semibold tabular-nums text-foreground">{cardioLine(g.sets)}</span>
                      ) : (
                        <span className="mt-1.5 block space-y-0.5">
                          {groups.slice(0, 3).map((x, i) => (
                            <span key={i} className="block text-[15px] tabular-nums text-foreground">
                              <span className="font-semibold">{x.text}</span>
                              {x.count > 1 && <span className="text-muted-foreground"> · {x.count} sets</span>}
                            </span>
                          ))}
                          {groups.length > 3 && <span className="block text-xs text-muted-foreground">+{groups.length - 3} more</span>}
                        </span>
                      )}
                    </span>
                    <ChevronDown className={cn("mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                  </button>
                  {(isOpen || editing) && (
                    <div className="mt-2.5">
                      {editing && cardio ? (
                <div data-history-editor data-history-editor-cardio>
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_72px_56px] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Set</span>
                      <span>Time</span>
                      <span>{runHistory ? (cardioDrafts[g.sets[0]?.id]?.distanceUnit ?? distanceUnit) : "Cal"}</span>
                      <span>RPE</span>
                    </div>
                    {g.sets.map((s: any, i: number) => {
                      const d = cardioDrafts[s.id];
                      if (!d) return null;
                      return (
                        <div key={s.id} className="grid grid-cols-[24px_minmax(0,1fr)_72px_56px] items-center gap-2 border-t border-border/60 px-2 py-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                          <Input
                            value={d.time}
                            onChange={(e) => patchCardioDraft(s.id, { time: e.target.value.replace(/[^0-9:.]/g, "") })}
                            inputMode="decimal"
                            enterKeyHint="done"
                            placeholder="mm:ss"
                            aria-label={`Set ${i + 1} time`}
                            className="h-10 min-w-0 px-2 text-center text-base tabular-nums"
                          />
                          {runHistory ? (
                            <Input
                              value={d.distance ?? ""}
                              onChange={(e) => patchCardioDraft(s.id, { distance: e.target.value.replace(/[^0-9.,]/g, "") })}
                              inputMode="decimal"
                              enterKeyHint="done"
                              placeholder="—"
                              aria-label={`Set ${i + 1} distance in ${d.distanceUnit === "mi" ? "miles" : "kilometres"}`}
                              data-history-distance
                              className="h-10 px-1 text-center text-base tabular-nums"
                            />
                          ) : (
                            <Input
                              value={d.calories}
                              onChange={(e) => patchCardioDraft(s.id, { calories: e.target.value.replace(/[^0-9]/g, "") })}
                              inputMode="numeric"
                              enterKeyHint="done"
                              placeholder="—"
                              aria-label={`Set ${i + 1} calories`}
                              className="h-10 px-1 text-center text-base tabular-nums"
                            />
                          )}
                          <Input
                            value={d.rpe}
                            onChange={(e) => patchCardioDraft(s.id, { rpe: e.target.value.replace(/[^0-9.]/g, "") })}
                            inputMode="decimal"
                            enterKeyHint="done"
                            placeholder="—"
                            aria-label={`Set ${i + 1} RPE`}
                            className="h-10 px-1 text-center text-base tabular-nums"
                          />
                        </div>
                      );
                    })}
                  </div>
                  {editError && <p className="mt-2 text-xs font-medium text-destructive" role="alert">{editError}</p>}
                  <div className="mt-2 flex gap-2">
                    <Button type="button" variant="outline" className="h-10 flex-1" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="button" className="h-10 flex-1" onClick={() => void saveEdit(g.sets)} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
                      ) : editing ? (
                <div data-history-editor>
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_56px_56px] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Set</span>
                      <span>Weight</span>
                      <span>Reps</span>
                      <span>RPE</span>
                    </div>
                    {g.sets.map((s: any, i: number) => {
                      const d = drafts[s.id];
                      if (!d) return null;
                      return (
                        <div key={s.id} className="grid grid-cols-[24px_minmax(0,1fr)_56px_56px] items-center gap-2 border-t border-border/60 px-2 py-1.5">
                          <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                          {d.loadEditable ? (
                            <div className="flex min-w-0 items-center gap-1">
                              <Input
                                value={d.load}
                                onChange={(e) => patchDraft(s.id, { load: e.target.value.replace(/[^0-9.]/g, "") })}
                                inputMode="decimal"
                                enterKeyHint="done"
                                placeholder="—"
                                aria-label={`Set ${i + 1} weight`}
                                className="h-10 min-w-0 flex-1 px-2 text-center text-base tabular-nums"
                              />
                              {/* The unit is a label on the number: flipping it never converts. */}
                              <button
                                type="button"
                                onClick={() => patchDraft(s.id, { unit: d.unit === "kg" ? "lb" : "kg" })}
                                aria-label={`Set ${i + 1} unit: ${d.unit}. Tap to change to ${d.unit === "kg" ? "lb" : "kg"}`}
                                data-history-unit
                                className="h-10 w-10 shrink-0 rounded-lg border border-border text-[13px] font-semibold text-foreground active:bg-secondary"
                              >
                                {d.unit}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground">{fmtLoad(s)}</span>
                          )}
                          <Input
                            value={d.reps}
                            onChange={(e) => patchDraft(s.id, { reps: e.target.value.replace(/[^0-9]/g, "") })}
                            inputMode="numeric"
                            enterKeyHint="done"
                            placeholder="—"
                            aria-label={`Set ${i + 1} reps`}
                            className="h-10 px-1 text-center text-base tabular-nums"
                          />
                          <Input
                            value={d.rpe}
                            onChange={(e) => patchDraft(s.id, { rpe: e.target.value.replace(/[^0-9.]/g, "") })}
                            inputMode="decimal"
                            enterKeyHint="done"
                            placeholder="—"
                            aria-label={`Set ${i + 1} RPE`}
                            className="h-10 px-1 text-center text-base tabular-nums"
                          />
                        </div>
                      );
                    })}
                  </div>
                  {editError && <p className="mt-2 text-xs font-medium text-destructive" role="alert">{editError}</p>}
                  <div className="mt-2 flex gap-2">
                    <Button type="button" variant="outline" className="h-10 flex-1" onClick={cancelEdit} disabled={saving}>
                      Cancel
                    </Button>
                    <Button type="button" className="h-10 flex-1" onClick={() => void saveEdit(g.sets)} disabled={saving}>
                      {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                    </Button>
                  </div>
                </div>
                      ) : cardio ? (
              <div className="overflow-hidden rounded-md border border-border" data-history-cardio>
                <div className={cn(
                  "grid gap-1.5 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground",
                  runHistory ? "grid-cols-[30px_minmax(52px,1fr)_60px_64px_36px_20px]" : "grid-cols-[30px_minmax(56px,1fr)_56px_44px_20px]",
                )}>
                  <span>Set</span>
                  <span>Time</span>
                  {runHistory ? <><span>Dist</span><span>Pace</span></> : <span>Cal</span>}
                  <span>RPE</span>
                  <span></span>
                </div>
                {g.sets.map((s: any, i: number) => (
                  <div
                    key={s.id}
                    className={cn(
                      "grid items-center gap-1.5 border-t border-border/60 px-2 py-1.5 text-xs",
                      runHistory ? "grid-cols-[30px_minmax(52px,1fr)_60px_64px_36px_20px]" : "grid-cols-[30px_minmax(56px,1fr)_56px_44px_20px]",
                      s.completed_at && "bg-green-500/5",
                    )}
                  >
                    <span className="font-mono text-muted-foreground">{i + 1}</span>
                    <span className="font-medium tabular-nums">{cardioClock(s.completed_duration_seconds)}</span>
                    {runHistory ? (
                      <>
                        <span className="tabular-nums" data-history-run-distance>{formatDistance(s.actual_distance_m, s.actual_distance_unit === "mi" ? "mi" : distanceUnit) || "—"}</span>
                        <span className="tabular-nums">{formatPace(paceSeconds(s.completed_duration_seconds, s.actual_distance_m, s.actual_distance_unit === "mi" ? "mi" : distanceUnit), s.actual_distance_unit === "mi" ? "mi" : distanceUnit) || "—"}</span>
                      </>
                    ) : (
                      <span className="tabular-nums">{s.actual_calories != null ? s.actual_calories : "—"}</span>
                    )}
                    <span className="tabular-nums">{s.actual_rpe ?? "—"}</span>
                    <span className="text-right">
                      {s.completed_at
                        ? <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500" />
                        : <Circle className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />}
                    </span>
                  </div>
                ))}
              </div>
                      ) : (
                        <div className="space-y-1.5" data-history-day-sets>
                          {g.sets.map((s: any, i: number) => {
                            const h = g.hsets[i];
                            const converted = h.loadType !== "bodyweight" && h.enteredUnit && h.enteredUnit !== displayUnit
                              ? (() => {
                                  const v = displayUnit === "kg" ? h.kg : h.lb;
                                  if (v == null) return null;
                                  return `≈ ${Math.round(Number(v) * 2) / 2} ${displayUnit}`;
                                })()
                              : null;
                            return (
                              <div key={s.id} className="flex items-center gap-3 text-sm tabular-nums">
                                <span className="w-11 shrink-0 text-xs text-muted-foreground">Set {i + 1}</span>
                                <span className="min-w-0 flex-1 text-foreground">
                                  {setText(h, displayUnit)}
                                  {converted && <span className="ml-1.5 text-xs text-muted-foreground">({converted})</span>}
                                </span>
                                {hasVelocity && (
                                  <span className="shrink-0 text-xs text-muted-foreground">
                                    {s.mean_concentric_velocity_mps != null ? `${Number(s.mean_concentric_velocity_mps).toFixed(2)} m/s` : ""}
                                  </span>
                                )}
                                {s.completed_at
                                  ? <CheckCircle2 className="h-4 w-4 shrink-0 text-success" aria-label="Finished" />
                                  : <Circle className="h-4 w-4 shrink-0 text-muted-foreground/60" aria-label="Not finished" />}
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {editable && !editing && (
                        <div className="mt-2 flex justify-end">
                          <button
                            type="button"
                            onClick={() => startEdit(dayKey, g.sets)}
                            disabled={saving}
                            data-history-edit
                            aria-label={`Edit this day's ${exerciseName} sets`}
                            className="inline-flex h-10 items-center gap-1.5 rounded-lg px-3 text-[13px] font-semibold text-foreground active:bg-secondary disabled:opacity-40"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Edit sets
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          {visible.length > shown && (
            <Button type="button" variant="outline" className="mt-2 h-10 w-full" onClick={() => setShown((n) => n + 20)} data-history-more>
              Show older sessions ({visible.length - shown})
            </Button>
          )}
        </div>

        {/* Deeper analytics, on demand: the chart, best sets and rep records. */}
        {!cardio && grouped.length > 0 && (
          <section className="mt-4 border-t border-border pt-2">
            <button
              type="button"
              onClick={() => setMoreOpen((v) => !v)}
              aria-expanded={moreOpen}
              data-history-progress-toggle
              className="flex min-h-12 w-full items-center gap-2 text-left"
            >
              <span className="min-w-0 flex-1">
                <span className="block text-[15px] font-semibold text-foreground">Progress and records</span>
                <span className="block text-xs text-muted-foreground">Chart, best sets and rep records</span>
              </span>
              <ChevronDown className={cn("h-5 w-5 shrink-0 text-muted-foreground transition-transform", moreOpen && "rotate-180")} aria-hidden="true" />
            </button>
            {moreOpen && (
              <div className="mt-1 space-y-3" data-history-progress>
                {progress && (
                  <LiftProgressCard
                    single
                    history={[progress]}
                    displayUnit={displayUnit}
                    conv={(lb) => (displayUnit === "kg" ? lb / 2.2046226218 : lb)}
                  />
                )}
                <ExerciseRecordsForClient clientId={clientId} exerciseId={exerciseId} exerciseName={exerciseName} unit={displayUnit} />
              </div>
            )}
          </section>
        )}

        <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          {!cardio && (
            <p data-last-time-explained>
              "Last time" on your workout card is the heaviest set from your most recent session of this exercise, in the same role when it has one (top set or back-off).
            </p>
          )}
          <label className="inline-flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              checked={showPartial}
              onChange={(e) => setShowPartial(e.target.checked)}
              className="h-4 w-4"
            />
            Show sets that weren't finished
          </label>
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Compact "History" trigger button for use in exercise cards. */
export function ExerciseHistoryButton({
  clientId,
  exerciseId,
  exerciseName,
  displayUnit,
  className,
  currentDayIndex,
  editable,
}: {
  clientId: string | null | undefined;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  className?: string;
  currentDayIndex?: number | null;
  editable?: boolean;
}) {
  const [open, setOpen] = useState(false);
  if (!clientId || (!exerciseId && !exerciseName)) return null;
  return (
    <>
      <Button size="sm" variant="outline" className={cn("w-full", className)} onClick={() => setOpen(true)}>
        <History className="mr-1 h-3 w-3" /> History
      </Button>
      <ExerciseHistorySheet
        open={open}
        onOpenChange={setOpen}
        clientId={clientId}
        exerciseId={exerciseId}
        exerciseName={exerciseName}
        displayUnit={displayUnit}
        currentDayIndex={currentDayIndex}
        editable={editable}
      />
    </>
  );
}

// Re-export for callers that only need the icon
export { StickyNote };