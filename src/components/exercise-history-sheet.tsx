import { Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExerciseRecordsForClient } from "@/components/records/training-records";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { History, CheckCircle2, Circle, StickyNote, Pencil, Loader2, ChevronDown, ChevronLeft, ChevronRight, TrendingUp, TrendingDown, Minus, Trophy } from "lucide-react";
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
import { useAthleteEquipment } from "@/lib/equipment/equipment-queries";
import { comparesAcrossEquipment, equipmentName, type Equipment } from "@/lib/equipment/equipment";
import { liftHistoryFromRows } from "@/lib/analytics/exercise-progress";
import {
  blockShortName,
  dayRefOf,
  historyRoles,
  historySetOf,
  isMeetSession,
  localYmd,
  progressSince,
  relatedSince,
  relativeDay,
  repsEffort,
  sameSplit,
  sessionLines,
  topSet,
  trainedOn,
  weightView,
  workoutName,
  ymdMs,
  type HistoryDayRef,
  type HistoryRowRef,
  type HistorySet as HistorySetView,
  type RelatedLog,
  type SetRole,
} from "@/lib/workouts/exercise-history";
import { instanceDates, rowMeta, warmupsFor, type HistoryWarmup } from "@/lib/workouts/history-reads";
import { resolveMovementFamily } from "@/lib/exercise-family";
import { rangeLift } from "@/lib/workouts/pick-range";
import { fetchAllPages } from "@/lib/supabase-paginate";

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
  exerciseId: openedId,
  exerciseName: openedName,
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
  void currentDayIndex;
  // Another lift of the family opened from "since your last session" (‹ comes back).
  const [related, setRelated] = useState<{ id: string; name: string } | null>(null);
  const exerciseId = related ? related.id : openedId;
  const exerciseName = related ? related.name : openedName;
  // What was lifted: finished sets only, unless asked (a set filled in but never
  // finished isn't something they lifted).
  const [showPartial, setShowPartial] = useState(false);
  void excludePartial;
  // One day in edit mode at a time; drafts keyed by set id.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  // A day reads as its summary; its sets (warm-ups too) open on a tap, in its place.
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
  // Which machine's sessions (only offered when there's history on two or more
  // machines whose weights mean different things): "all" or an equipment id.
  const [machine, setMachine] = useState<string>("all");
  const { data: equipmentData } = useAthleteEquipment(open ? clientId : null);
  const queryClient = useQueryClient();
  // Each exercise starts at its newest sessions, folded.
  useEffect(() => {
    setOpenDays(new Set());
    setEditingKey(null);
    setShown(10);
    setOnlySplit(false);
    setMoreOpen(false);
    setMachine("all");
  }, [exerciseId, exerciseName]);
  // Closing the sheet comes back to the exercise it was opened for.
  useEffect(() => { if (!open) setRelated(null); }, [open]);

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
            id, set_index, completed_at, updated_at, created_at, scheduled_workout_id,
            actual_reps, actual_rpe, actual_rpe_num, actual_rir, mean_concentric_velocity_mps,
            completed_duration_seconds, actual_calories, actual_distance_m, actual_distance_unit,
            entered_value, entered_unit, normalized_kg, normalized_lb,
            actual_load, actual_load_unit, load_type, is_bodyweight, equipment_id,
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

  // What goes with the sets, by id: where each scheduled instance sat (a moved
  // workout's real day), each card's label / notes / planned sets (top set or
  // back-off) and the warm-ups logged on those cards.
  const instanceIds = useMemo(() => [...new Set((rows as any[]).map((r) => r.scheduled_workout_id).filter(Boolean))].sort() as string[], [rows]);
  const cardIds = useMemo(() => [...new Set((rows as any[]).map((r) => r.pl_exercise_rows?.id).filter(Boolean))].sort() as string[], [rows]);
  const { data: instDates = new Map<string, string>() } = useQuery({
    queryKey: ["exercise-history-instances", clientId, instanceIds.join(",")],
    enabled: open && instanceIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => instanceDates(instanceIds),
  });
  const { data: cards = new Map() } = useQuery({
    queryKey: ["exercise-history-cards", cardIds.join(",")],
    enabled: open && cardIds.length > 0,
    staleTime: 10 * 60_000,
    queryFn: () => rowMeta(cardIds),
  });
  const { data: warmups = [] } = useQuery({
    queryKey: ["exercise-history-warmups", clientId, cardIds.join(",")],
    enabled: open && !!clientId && cardIds.length > 0,
    staleTime: 2 * 60_000,
    queryFn: () => warmupsFor(cardIds, clientId!),
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

  const grouped = useMemo(() => {
    const filtered = rows.filter((r: any) => (showPartial ? true : !!r.completed_at));
    // One session = one workout on one day: the day, and the scheduled instance
    // it was logged in (a repeated workout is two sessions).
    const byDay = new Map<string, { day: any; week: any; block: any; instanceId: string | null; sets: any[] }>();
    for (const r of filtered) {
      const er = r.pl_exercise_rows;
      const d = er?.pl_days;
      const w = d?.pl_weeks;
      const b = w?.pl_blocks;
      if (!d) continue;
      // The workout it was opened from is on screen already: history is the ones before.
      if (currentDayId && d.id === currentDayId) continue;
      const k = `${b?.id ?? "?"}-${w?.id ?? "?"}-${d.id}-${r.scheduled_workout_id ?? ""}`;
      if (!byDay.has(k)) byDay.set(k, { day: d, week: w, block: b, instanceId: r.scheduled_workout_id ?? null, sets: [] });
      byDay.get(k)!.sets.push(r);
    }
    const list = [...byDay.entries()].map(([key, g]) => {
      g.sets.sort(historySetOrder);
      // When it was trained: the calendar's day for it, never after it was logged (trainedOn).
      const logged = g.sets.map((s: any) => s.completed_at ?? s.created_at).filter(Boolean).sort()[0] ?? null;
      const day = trainedOn({ instanceDate: g.instanceId ? instDates.get(g.instanceId) ?? null : null, dayDate: g.day?.scheduled_date ?? null, loggedAt: logged });
      // What each card of this exercise was for that day: its top set and back-offs.
      const rowIds = [...new Set(g.sets.map((s: any) => s.pl_exercise_rows?.id).filter(Boolean))] as string[];
      const refs: HistoryRowRef[] = rowIds.map((id) => {
        const meta = cards.get(id);
        const first = g.sets.find((s: any) => s.pl_exercise_rows?.id === id);
        const kgs = g.sets.filter((s: any) => s.pl_exercise_rows?.id === id).map((s: any) => Number(s.normalized_kg)).filter((n: number) => Number.isFinite(n) && n > 0);
        return {
          rowId: id,
          sortOrder: Number(first?.pl_exercise_rows?.sort_order ?? 0),
          purposeLabel: meta?.purpose_label ?? null,
          notes: meta?.notes ?? null,
          planned: meta?.sets ?? null,
          topKg: kgs.length ? Math.max(...kgs) : null,
        };
      });
      const roles = historyRoles(refs);
      const ref = dayRefOf(g.day, g.block);
      const hsets = g.sets.map((s: any) => ({ ...historySetOf(s), role: roles.get(s.pl_exercise_rows?.id) ?? null }));
      // what it was done on: the equipment most of its sets were stamped with
      const counts = new Map<string, number>();
      for (const set of g.sets) if (set.equipment_id) counts.set(set.equipment_id, (counts.get(set.equipment_id) ?? 0) + 1);
      const equipmentId = counts.size ? [...counts.entries()].sort((a, b) => b[1] - a[1])[0][0] : null;
      const rowWarmups = (warmups as HistoryWarmup[]).filter((w) => rowIds.includes(w.row_id) && (w.scheduled_workout_id ?? null) === (g.instanceId ?? w.scheduled_workout_id ?? null));
      return {
        ...g,
        key,
        dayYmd: day,
        at: ymdMs(day),
        name: workoutName(ref),
        same: sameSplit(ref, currentRef),
        meet: isMeetSession(g.day ?? {}, refs.map((x) => x.purposeLabel)),
        hsets,
        warmups: rowWarmups,
        equipmentId,
      };
    });
    // Most recent training day first; the same day by when it was logged.
    list.sort((a, b) => b.at - a.at || String(b.sets[0]?.completed_at ?? "").localeCompare(String(a.sets[0]?.completed_at ?? "")));
    return list;
  }, [rows, showPartial, currentDayId, currentRef, instDates, cards, warmups]);

  // The equipment these sessions were done on. A machine's name shows on its
  // sessions; with two or more machines (weights that mean different things),
  // a filter picks one, and the progress line and the chart read only it.
  const equipmentById = useMemo(() => new Map(equipmentData.equipment.map((e) => [e.id, e])), [equipmentData.equipment]);
  const machines = useMemo(() => {
    const seen = new Map<string, { eq: Equipment; count: number }>();
    for (const g of grouped) {
      const eq = g.equipmentId ? equipmentById.get(g.equipmentId) : undefined;
      if (!eq) continue;
      const cur = seen.get(eq.id);
      seen.set(eq.id, { eq, count: (cur?.count ?? 0) + 1 });
    }
    return [...seen.values()].sort((a, b) => b.count - a.count);
  }, [grouped, equipmentById]);
  const showEquipment = machines.length >= 2 || machines.some((m) => !comparesAcrossEquipment(m.eq.kind));
  const machineFilter = machines.filter((m) => !comparesAcrossEquipment(m.eq.kind)).length >= 2;
  const onMachine = machineFilter && machine !== "all" ? grouped.filter((g) => g.equipmentId === machine) : grouped;
  // The machine a record was set on: the logged set with its reps, weight and time.
  const recordEquipment = (best: { reps: number; load_kg: number; at: string }): string | null => {
    const at = Date.parse(best.at);
    const set = (rows as any[]).find((r) =>
      r.equipment_id && r.completed_at && Number(r.actual_reps) === best.reps &&
      Math.abs(Number(r.normalized_kg) - best.load_kg) < 0.05 &&
      (!Number.isFinite(at) || Math.abs(Date.parse(r.completed_at) - at) < 36 * 60 * 60 * 1000));
    const eq = set ? equipmentById.get(set.equipment_id) : undefined;
    return eq && !comparesAcrossEquipment(eq.kind) ? equipmentName(eq) : null;
  };
  const loadKey = (equipmentId: string | null) => {
    const eq = equipmentId ? equipmentById.get(equipmentId) : undefined;
    return eq && !comparesAcrossEquipment(eq.kind) ? eq.id : null;
  };

  // A treadmill walk or a bike is time, calories and effort, never load / reps / velocity.
  const cardio = useMemo(() => isCardioHistory(exerciseName, rows), [exerciseName, rows]);
  // This exercise's progress (the Analytics page's lift card, for one lift),
  // from the same sets the list below shows, in the range picked above.
  const progress = useMemo<LiftHistory | null>(
    // the open workout is on screen, not history: left out here as in the list
    () => (cardio ? null : liftHistoryFromRows((rows as any[]).filter((r) => {
      const id = r?.pl_exercise_rows?.pl_days?.id;
      if (!id || id === currentDayId) return false;
      // one machine picked: its sets only (another machine's weights aren't the same thing)
      return !(machineFilter && machine !== "all") || r.equipment_id === machine;
    }), exerciseName)),
    [cardio, rows, exerciseName, currentDayId, machineFilter, machine],
  );
  // A run reads by distance and pace instead of calories.
  const runHistory = useMemo(
    () => cardio && (isRunningExercise(exerciseName) || rows.some((r: any) => Number(r.actual_distance_m) > 0)),
    [cardio, exerciseName, rows],
  );
  const distanceUnit = useMemo(() => readDistanceUnit(), []);
  const cardioSummary = useMemo(() => {
    if (!cardio) return null;
    return cardioHistorySummary(grouped.map((g) => ({ date: g.dayYmd ?? "", sets: g.sets })));
  }, [cardio, grouped]);

  // The competition lift's family since its last session: what was trained
  // instead (a block on paused bench reads as that, never as lost history).
  const { data: liftInfo = null } = useQuery({
    queryKey: ["exercise-history-lift", exerciseId ?? null],
    enabled: open && !!exerciseId,
    staleTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await sb
        .from("exercises")
        .select("id, name, movement_family, competition_lift_type, is_competition_lift, equipment")
        .eq("id", exerciseId)
        .maybeSingle();
      return data ?? null;
    },
  });
  const family = liftInfo ? resolveMovementFamily(liftInfo) : null;
  const isCompLift = !!liftInfo && (!!liftInfo.competition_lift_type || liftInfo.is_competition_lift === true) && !!family && rangeLift(family, liftInfo.name, liftInfo.equipment);
  const lastDay = grouped.find((g) => g.dayYmd)?.dayYmd ?? null;
  // with no session of it at all, the family's last 12 weeks
  const sinceDay = lastDay ?? localYmd(Date.now() - 84 * 86_400_000);
  const { data: relatedLogs = [] } = useQuery({
    queryKey: ["exercise-history-related", clientId, exerciseId ?? null, family, sinceDay],
    enabled: open && !!clientId && isCompLift && !isLoading && !cardio,
    staleTime: 2 * 60_000,
    queryFn: async (): Promise<RelatedLog[]> => {
      // a day of slack: a session logged after midnight UTC still counts as the day it was trained
      const since = new Date(ymdMs(sinceDay) - 86_400_000).toISOString();
      const logs = await fetchAllPages<any>((from, to) =>
        sb
          .from("pl_row_results")
          .select(`
            id, set_index, completed_at, scheduled_workout_id,
            actual_reps, actual_rpe, actual_rpe_num, actual_rir,
            entered_value, entered_unit, normalized_kg, normalized_lb, actual_load, actual_load_unit, load_type, is_bodyweight,
            pl_exercise_rows!inner(id, exercise_id, exercise_name_override, pl_days!inner(id, scheduled_date), exercises!inner(id, name, movement_family, competition_lift_type, equipment))
          `)
          .eq("client_id", clientId)
          .not("completed_at", "is", null)
          .gte("completed_at", since)
          .eq("pl_exercise_rows.exercises.movement_family", family)
          .order("completed_at", { ascending: false })
          .order("id", { ascending: true })
          .range(from, to), { maxRows: 5000 });
      const others = logs.filter((l) => {
        const er = l.pl_exercise_rows;
        const ex = er?.exercises;
        if (!ex || identityIds.includes(ex.id) || ex.id === exerciseId) return false;
        // barbell variations of the lift, never its dumbbell or machine accessories
        return rangeLift(resolveMovementFamily(ex), ex.name, ex.equipment);
      });
      const dates = await instanceDates(others.map((l) => l.scheduled_workout_id));
      return others.map((l) => {
        const er = l.pl_exercise_rows;
        return {
          exerciseId: er.exercises.id,
          name: (er.exercise_name_override ?? "").trim() || er.exercises.name,
          sessionKey: `${er.pl_days?.id}-${l.scheduled_workout_id ?? ""}`,
          day: trainedOn({ instanceDate: l.scheduled_workout_id ? dates.get(l.scheduled_workout_id) ?? null : null, dayDate: er.pl_days?.scheduled_date ?? null, loggedAt: l.completed_at }) ?? "",
          set: historySetOf(l),
        };
      });
    },
  });
  const relatedLifts = useMemo(() => (isCompLift ? relatedSince(relatedLogs, lastDay) : []), [isCompLift, relatedLogs, lastDay]);
  const [relatedAll, setRelatedAll] = useState(false);

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
  const visible = filterable && onlySplit ? onMachine.filter((g) => g.same) : onMachine;
  const currentName = currentRef ? workoutName(currentRef) : null;
  const dated = grouped.filter((g) => g.at > 0);
  const firstAt = dated.length ? Math.min(...dated.map((g) => g.at)) : 0;
  const lastAt = dated.length ? Math.max(...dated.map((g) => g.at)) : 0;
  const thisYear = new Date().getFullYear();
  const shortDate = (ms: number) => format(new Date(ms), new Date(ms).getFullYear() === thisYear ? "MMM d" : "MMM d, yyyy");
  // The one progress line: like with like, within one program (exercise-history.ts).
  const progressLine = useMemo(
    () => (cardio ? null : progressSince(
      onMachine.map((g) => ({ key: g.key, at: g.at, blockId: g.block?.id ?? null, programId: g.block?.prep_id ?? null, sets: g.hsets, equipmentKey: loadKey(g.equipmentId) })),
      displayUnit,
    )),
    // loadKey reads equipmentById
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [cardio, onMachine, displayUnit, equipmentById],
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
  const roleWord = (r: SetRole) => (r === "top" ? "Top set" : r === "backoff" ? "Back-off" : "");
  const familyWord = family === "squat" ? "squat" : family === "deadlift" ? "deadlift" : family === "bench" ? "bench" : "lift";
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        hideCloseButton
        className="w-full overflow-y-auto p-0 sm:max-w-lg"
        style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
        data-exercise-history
      >
        {/* One bar: back (to the lift it was opened for, else out), the exercise and its span. */}
        <div
          className="sticky top-0 z-10 flex items-start gap-1 border-b border-border bg-background px-2 pb-2.5"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 0.5rem)" }}
          data-history-header
        >
          {related ? (
            <button
              type="button"
              onClick={() => setRelated(null)}
              aria-label={`Back to ${openedName}`}
              data-history-back-to
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-secondary"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </button>
          ) : (
            <SheetClose
              aria-label="Back"
              className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-foreground active:bg-secondary"
            >
              <ChevronLeft className="h-6 w-6" aria-hidden="true" />
            </SheetClose>
          )}
          <div className="min-w-0 flex-1 pr-2 pt-1.5">
            <SheetTitle className="text-[19px] font-semibold leading-tight">{exerciseName}</SheetTitle>
            <SheetDescription className="mt-0.5 text-[13px]" data-history-span>
              {isLoading
                ? "Loading your sessions…"
                : grouped.length === 0
                  ? "No sessions yet"
                  : `${grouped.length} ${grouped.length === 1 ? "session" : "sessions"}${firstAt ? ` · ${firstAt === lastAt ? shortDate(firstAt) : `${shortDate(firstAt)} – ${shortDate(lastAt)}`}` : ""}`}
            </SheetDescription>
          </div>
        </div>

        <div className="px-4">
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

        {/* The family since this lift's last session: what was trained instead. */}
        {relatedLifts.length > 0 && (
          <section className="mt-3 rounded-xl bg-muted/50 px-3 py-2.5" data-history-related>
            {/* Where the lift went: a block on paused bench reads as that, never as missing history. */}
            <p className="text-[13px] font-semibold text-foreground">
              {lastDay ? `${cap(familyWord)} work since ${shortDate(ymdMs(lastDay))}` : `${cap(familyWord)} work, last 12 weeks`}
            </p>
            <p className="text-xs text-muted-foreground">Logged under these lifts. Tap one for its history.</p>
            <ul className="mt-1">
              {(relatedAll ? relatedLifts : relatedLifts.slice(0, 3)).map((r) => {
                const top = r.top;
                const w = top ? weightView(top, displayUnit) : null;
                return (
                  <li key={r.exerciseId}>
                    <button
                      type="button"
                      onClick={() => setRelated({ id: r.exerciseId, name: r.name })}
                      data-history-related-lift={r.exerciseId}
                      className="flex min-h-11 w-full items-center gap-2 rounded-lg py-1.5 text-left active:bg-secondary"
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[15px] font-medium text-foreground">{r.name}</span>
                        <span className="block text-[13px] tabular-nums text-muted-foreground">
                          {shortDate(ymdMs(r.lastDay))}
                          {top && w ? <> · <span className="font-semibold text-foreground">{w.text}</span> {repsEffort(top)}</> : null}
                          {` · ${r.sessions} ${r.sessions === 1 ? "session" : "sessions"}`}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
            {relatedLifts.length > 3 && !relatedAll && (
              <button type="button" onClick={() => setRelatedAll(true)} className="mt-0.5 h-9 text-[13px] font-medium text-foreground">
                {relatedLifts.length - 3} more
              </button>
            )}
          </section>
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

        {machineFilter && (
          <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto px-4 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Which machine" data-history-machine-filter>
            {[{ id: "all", label: `All · ${grouped.length}` }, ...machines.filter((m) => !comparesAcrossEquipment(m.eq.kind)).map((m) => ({ id: m.eq.id, label: `${equipmentName(m.eq)} · ${m.count}` }))].map((c) => (
              <button
                key={c.id}
                type="button"
                aria-pressed={machine === c.id}
                onClick={() => setMachine(c.id)}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center rounded-full border px-3 text-[13px] font-medium transition-colors",
                  machine === c.id ? "border-foreground bg-foreground text-background" : "border-border text-foreground active:bg-muted",
                )}
              >
                {c.label}
              </button>
            ))}
          </div>
        )}

        <div className="mt-2">
          {isLoading && (
            <div className="space-y-2 pt-1">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          )}
          {!isLoading && grouped.length === 0 && (
            <div className="mt-1 rounded-xl bg-muted/50 p-5 text-center" data-history-empty>
              <div className="text-sm font-semibold">No sessions yet</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {cardio
                  ? "Log a session and it will show here next time."
                  : "Finish a set of this exercise and it will show here next time."}
              </div>
            </div>
          )}
          <ul>
            {visible.slice(0, shown).map((g, gi, arr) => {
              const dayKey = g.key;
              const isOpen = openDays.has(dayKey);
              const editing = editingKey === dayKey;
              const rel = g.at ? relativeDay(g.at) : null;
              const lines = cardio ? [] : sessionLines(g.hsets, displayUnit);
              const roled = lines.some((x) => x.role);
              const hasVelocity = g.sets.some((s: any) => s.mean_concentric_velocity_mps != null);
              // The block once, over its run of sessions, not on every session.
              const blockName = blockShortName(g.block?.name);
              const newBlock = gi === 0 || (arr[gi - 1].block?.id ?? null) !== (g.block?.id ?? null);
              const week = g.week?.week_index ? `Wk ${g.week.week_index}` : null;
              // the Meet chip says it: no 🏆 again in front of the meet's name
              const workout = g.meet ? g.name.replace(/^\s*🏆\s*/u, "") : g.name;
              return (
                <Fragment key={dayKey}>
                {newBlock && blockName && (
                  <li className={cn("pb-1 text-[13px] font-semibold text-muted-foreground", gi === 0 ? "pt-2" : "pt-4")} data-history-block>
                    {blockName}
                  </li>
                )}
                <li
                  className={cn("-mx-4 border-t border-border/60 px-4 py-3", newBlock && "border-t-0", g.same && "bg-muted/40")}
                  data-history-session
                  data-same-split={g.same || undefined}
                  data-meet={g.meet || undefined}
                >
                  <button
                    type="button"
                    onClick={() => toggleDay(dayKey)}
                    aria-expanded={isOpen}
                    data-history-day-summary
                    className="flex w-full items-start gap-2 text-left"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                        <span className="text-[15px] font-semibold text-foreground" data-history-date>
                          {g.at ? format(new Date(g.at), new Date(g.at).getFullYear() === thisYear ? "EEE, MMM d" : "EEE, MMM d, yyyy") : "—"}
                        </span>
                        {rel && <span className="text-xs text-muted-foreground">{rel}</span>}
                        {g.meet && (
                          <span className="inline-flex h-5 items-center gap-1 rounded-full bg-secondary px-1.5 text-[11px] font-medium text-foreground" data-history-meet>
                            <Trophy className="h-3 w-3" aria-hidden="true" /> Meet
                          </span>
                        )}
                      </span>
                      <span className="mt-0.5 flex min-w-0 items-center gap-1 text-[13px] leading-snug text-muted-foreground" data-history-session-workout>
                        {g.same && (
                          <span className="mr-0.5 inline-flex h-5 shrink-0 items-center rounded-full bg-background px-1.5 text-[11px] font-medium text-foreground" data-same-split-tag>
                            Same split
                          </span>
                        )}
                        <span className={cn("min-w-0 truncate", g.same && "font-medium text-foreground")}>{workout}</span>
                        {week && <span className="shrink-0">· {week}</span>}
                      </span>
                      {showEquipment && g.equipmentId && equipmentById.get(g.equipmentId) && (
                        <span className="mt-0.5 block truncate text-[13px] text-foreground" data-history-session-equipment>on {equipmentName(equipmentById.get(g.equipmentId))}</span>
                      )}
                      {/* Folded: the session in a few lines. Open: every set, in its place. */}
                      {!isOpen && !editing && (cardio ? (
                        <span className="mt-1.5 block text-[15px] font-semibold tabular-nums text-foreground">{cardioLine(g.sets)}</span>
                      ) : (
                        <span className="mt-1.5 block space-y-0.5" data-history-lines>
                          {lines.slice(0, 3).map((x, i) => (
                            <span key={i} className="flex items-baseline gap-2 text-[15px] tabular-nums" data-history-line={x.role ?? "set"}>
                              {roled && <span className="w-[4.25rem] shrink-0 text-xs text-muted-foreground">{roleWord(x.role)}</span>}
                              <span className="min-w-0">
                                <span className="font-semibold text-foreground">{x.weight}</span>
                                {x.logged && <span className="text-[13px] text-muted-foreground" data-history-logged-as> ({x.logged})</span>}
                                {x.rest && <span className="text-foreground/80"> {x.rest}</span>}
                                {x.count > 1 && <span className="text-muted-foreground"> · {x.count} sets</span>}
                              </span>
                            </span>
                          ))}
                          {lines.length > 3 && <span className="block text-xs text-muted-foreground">+{lines.length - 3} more</span>}
                        </span>
                      ))}
                    </span>
                    <ChevronDown className={cn("mt-0.5 h-5 w-5 shrink-0 text-muted-foreground transition-transform", isOpen && "rotate-180")} aria-hidden="true" />
                  </button>
                  {(isOpen || editing) && (
                    <div className="mt-2">
                      {editing && cardio ? (
                <div data-history-editor data-history-editor-cardio>
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_72px_56px] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
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
                          <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
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
                  <p className="mb-1.5 text-xs text-muted-foreground">
                    Fix what was logged. The kg | lb button relabels a number logged in the wrong unit; it never converts it.
                  </p>
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_56px_56px] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground">
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
                          <span className="text-xs tabular-nums text-muted-foreground">{i + 1}</span>
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
                            <span className="text-xs text-muted-foreground">{weightView(g.hsets[i], displayUnit).text}</span>
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
                  "grid gap-1.5 border-b border-border bg-muted/40 px-2 py-1 text-[11px] font-medium text-muted-foreground",
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
                    )}
                  >
                    <span className="tabular-nums text-muted-foreground">{i + 1}</span>
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
                        ? <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-success" />
                        : <Circle className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />}
                    </span>
                  </div>
                ))}
              </div>
                      ) : (
                        <div className="space-y-0.5" data-history-day-sets>
                          {/* Warm-ups first, quieter: logged, never counted as work. */}
                          {g.warmups.map((w) => {
                            const wset: HistorySetView = { id: w.id, completed: true, reps: w.reps, rpe: w.rpe, rir: null, loadType: "external", enteredValue: Number(w.load), enteredUnit: w.unit, kg: null, lb: null };
                            const v = weightView(wset, displayUnit);
                            return (
                              <div key={w.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-2 py-0.5 text-sm tabular-nums text-muted-foreground" data-history-warmup>
                                <span className="text-xs font-semibold text-orange-500">W</span>
                                <span className="min-w-0">
                                  {v.text}
                                  {v.logged && <span className="text-[13px]"> ({v.logged})</span>}
                                  {" "}{repsEffort({ reps: w.reps, rpe: null, rir: null })}
                                </span>
                                <span className="text-xs">Warm-up</span>
                              </div>
                            );
                          })}
                          {g.sets.map((s: any, i: number) => {
                            const h = g.hsets[i];
                            const v = weightView(h, displayUnit);
                            // a meet's singles are its attempts, in the order they were taken
                            const attempt = g.meet && h.reps === 1 && i < 3 ? ["Opener", "2nd attempt", "3rd attempt"][i] : "";
                            const tag = attempt || roleWord(h.role) || (s.completed_at ? "" : "Not finished");
                            return (
                              <div key={s.id} className="grid grid-cols-[2rem_minmax(0,1fr)_auto] items-baseline gap-2 py-0.5 text-[15px] tabular-nums" data-history-set>
                                <span className="text-xs text-muted-foreground">{i + 1}</span>
                                <span className="min-w-0">
                                  <span className="font-semibold text-foreground">{v.text}</span>
                                  {v.logged && <span className="text-[13px] text-muted-foreground" data-history-logged-as> ({v.logged})</span>}
                                  <span className="text-foreground/80"> {repsEffort(h)}</span>
                                  {hasVelocity && s.mean_concentric_velocity_mps != null && (
                                    <span className="text-xs text-muted-foreground"> · {Number(s.mean_concentric_velocity_mps).toFixed(2)} m/s</span>
                                  )}
                                </span>
                                <span className="text-xs text-muted-foreground">{tag}</span>
                              </div>
                            );
                          })}
                        </div>
                      )}
                      {editable && !editing && (
                        <div className="mt-1.5 flex justify-end">
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
                </Fragment>
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
                <ExerciseRecordsForClient
                  clientId={clientId}
                  exerciseId={exerciseId}
                  exerciseName={exerciseName}
                  unit={displayUnit}
                  equipmentOf={showEquipment ? recordEquipment : undefined}
                />
              </div>
            )}
          </section>
        )}

        <div className="mt-4 space-y-1 border-t border-border pt-3 text-xs leading-relaxed text-muted-foreground">
          {!cardio && (
            <p data-last-time-explained>
              Weights read in {displayUnit}, the unit on your card; a set logged in {displayUnit === "kg" ? "lb" : "kg"} shows that number in brackets. "Last time" on your card is the top set of your latest session here.
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