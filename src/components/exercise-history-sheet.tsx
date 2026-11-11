import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { ExerciseRecordsForClient } from "@/components/records/training-records";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { History, CheckCircle2, Circle, StickyNote, Pencil, Loader2 } from "lucide-react";
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
  /** Program day index of the workout the history was opened from. When present, matching days are highlighted. */
  currentDayIndex?: number | null;
  /** The viewer may fix a past day's sets here (their own, or a client they coach). */
  editable?: boolean;
}) {
  const [showPartial, setShowPartial] = useState(!excludePartial);
  // One day in edit mode at a time; drafts keyed by set id.
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, SetDraft>>({});
  const [cardioDrafts, setCardioDrafts] = useState<Record<string, CardioDraft>>({});
  const [saving, setSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [days, setDays] = useState<number | null>(null);
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

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ["exercise-history", clientId, exerciseId ?? null, exerciseName, identityIds.join(","), days],
    enabled: !!clientId && (!!exerciseId || !!exerciseName) && open,
    staleTime: 2 * 60_000,   // cache for 2 min — avoids re-fetch on every open
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      let q = sb
        .from("pl_row_results")
        .select(`
          id, set_index, completed_at, updated_at, created_at,
          actual_reps, actual_rpe, actual_rpe_num, mean_concentric_velocity_mps,
          completed_duration_seconds, actual_calories,
          entered_value, entered_unit, normalized_kg, normalized_lb,
          actual_load, actual_load_unit, load_type, is_bodyweight,
          pl_exercise_rows!inner(
            id, exercise_id, exercise_name_override, sort_order,
            pl_days!inner(id, day_index, title, scheduled_date, pl_weeks!inner(id, week_index, pl_blocks!inner(id, name)))
          )
        `)
        .eq("client_id", clientId)
        .order("updated_at", { ascending: false })
        .limit(500);
      // Match by canonical exercise identity when we have one; otherwise fall
      // back to the row's custom name override so custom-named exercises
      // (no exercise_id) still show a training history.
      const ids = identityIds.length ? identityIds : exerciseId ? [exerciseId] : [];
      if (ids.length) {
        q = q.in("pl_exercise_rows.exercise_id", ids);
      } else if (exerciseName) {
        q = q.eq("pl_exercise_rows.exercise_name_override", exerciseName);
      }
      if (days) {
        const cutoff = new Date(Date.now() - days * 86400000).toISOString();
        q = q.gte("updated_at", cutoff);
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as any[];
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
      const k = `${b?.id ?? "?"}-${w?.id ?? "?"}-${d.id}`;
      if (!byDay.has(k)) byDay.set(k, { day: d, week: w, block: b, sets: [] });
      byDay.get(k)!.sets.push(r);
    }
    // Most recent training date first, using the same resolver the header
    // renders so ordering matches the visible date on each card.
    const list = [...byDay.values()];
    list.sort((a, b) => resolveGroupDate(b) - resolveGroupDate(a));
    for (const g of list) g.sets.sort(historySetOrder);
    return list;
  }, [rows, showPartial, completionMap]);

  // A treadmill walk or a bike is time, calories and effort, never load / reps / velocity.
  const cardio = useMemo(() => isCardioHistory(exerciseName, rows), [exerciseName, rows]);
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
      nextCardio[set.id] = cardioEditDraft(set);
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

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-lg overflow-y-auto"
        style={{
          paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)",
          paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)",
        }}
      >
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> {exerciseName} history
          </SheetTitle>
          <SheetDescription>
            {cardio
              ? "Every logged session across all blocks: how long, the calories and how hard it felt (RPE)."
              : "Past logged sets across all blocks. Velocity is mean concentric velocity (m/s), so the same metric is compared session to session."}
          </SheetDescription>
        </SheetHeader>
        {!cardio && (
          <div className="px-4 pt-2 sm:px-0">
            <ExerciseRecordsForClient clientId={clientId} exerciseId={exerciseId} exerciseName={exerciseName} unit={displayUnit} />
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-center gap-2">
          {[null, 30, 90, 180, 365].map((d) => (
            <Button
              key={String(d)}
              size="sm"
              variant={days === d ? "default" : "outline"}
              className="h-7 px-2 text-[11px]"
              onClick={() => setDays(d)}
            >
              {d == null ? "All time" : `${d}d`}
            </Button>
          ))}
          <label className="ml-auto inline-flex items-center gap-1 text-[11px] text-muted-foreground">
            <input
              type="checkbox"
              checked={showPartial}
              onChange={(e) => setShowPartial(e.target.checked)}
              className="h-3.5 w-3.5"
            />
            Include partial
          </label>
        </div>

        {cardioSummary && cardioSummary.sessions > 0 && (
          <div className="mt-3 rounded-xl border border-border p-3" data-cardio-history-summary>
            <div className="grid grid-cols-4 gap-2 text-center">
              {[
                { label: "Sessions", value: String(cardioSummary.sessions) },
                { label: "Avg time", value: cardioClock(cardioSummary.avgSeconds) },
                { label: "Avg kcal", value: cardioSummary.avgCalories != null ? String(cardioSummary.avgCalories) : "—" },
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

        <div className="mt-4 space-y-3">
          {isLoading && (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-20 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          )}
          {!isLoading && grouped.length === 0 && (
            <Card className="p-6 text-center">
              <div className="text-2xl mb-2">🏋️</div>
              <div className="text-sm font-semibold mb-1">No history yet</div>
              <div className="text-xs text-muted-foreground">
                {cardio
                  ? "Nothing logged for this cardio yet. Log a session and it will show here next time."
                  : "This is your first time logging this exercise. Complete a set and it will appear here next time."}
              </div>
            </Card>
          )}
          {grouped.map((g) => {
            const dayKey = `${g.block?.id}-${g.week?.id}-${g.day?.id}`;
            const isSameTrainingDay = currentDayIndex != null && g.day?.day_index != null && g.day.day_index === currentDayIndex;
            return (
            <Card key={dayKey} className={cn("p-3", isSameTrainingDay && "border-l-4 border-l-primary/40")}>
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <div className={cn("truncate font-bold", isSameTrainingDay && "min-w-0 flex-1")}>
                  {g.block?.name ?? "Block"} · Wk {g.week?.week_index ?? "?"} · {g.day?.title || `Day ${g.day?.day_index ?? ""}`}
                </div>
                <div className={cn("flex items-baseline gap-2", isSameTrainingDay && "flex-shrink-0")}>
                  {(() => {
                    // Prefer the day's scheduled training date (what the
                    // client is meant to see on the calendar), then the
                    // workout completion timestamp, then the earliest set's
                    // created_at as a last resort. Parse YYYY-MM-DD dates
                    // as local calendar dates so JUN 30 doesn't slide to
                    // JUN 29 in negative UTC offsets.
                    const scheduled: string | null = g.day?.scheduled_date ?? null;
                    if (scheduled) {
                      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(scheduled);
                      if (m) {
                        const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
                        return format(d, "MMM d, yyyy");
                      }
                    }
                    const completionTs = completionMap.get(g.day?.id);
                    const earliestCreated = g.sets
                      .map((s: any) => s.created_at)
                      .filter(Boolean)
                      .sort()[0];
                    const ts = completionTs ?? earliestCreated ?? g.sets[0]?.completed_at ?? g.sets[0]?.updated_at;
                    return ts ? format(new Date(ts), "MMM d, yyyy") : "—";
                  })()}
                  {isSameTrainingDay && (
                    <Badge variant="outline" className="text-[10px] font-medium">Same training day</Badge>
                  )}
                  {editable && editingKey !== dayKey && (
                    <button
                      type="button"
                      onClick={() => startEdit(dayKey, g.sets)}
                      disabled={saving}
                      data-history-edit
                      aria-label={`Edit this day's ${exerciseName} sets`}
                      className="-my-2 inline-flex h-9 items-center gap-1 rounded-lg px-2 text-[12px] font-semibold normal-case tracking-normal text-foreground active:bg-secondary disabled:opacity-40"
                    >
                      <Pencil className="h-3.5 w-3.5" /> Edit
                    </button>
                  )}
                </div>
              </div>
              {editingKey === dayKey && cardio ? (
                <div data-history-editor data-history-editor-cardio>
                  <div className="overflow-hidden rounded-md border border-border">
                    <div className="grid grid-cols-[24px_minmax(0,1fr)_72px_56px] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                      <span>Set</span>
                      <span>Time</span>
                      <span>Cal</span>
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
                          <Input
                            value={d.calories}
                            onChange={(e) => patchCardioDraft(s.id, { calories: e.target.value.replace(/[^0-9]/g, "") })}
                            inputMode="numeric"
                            enterKeyHint="done"
                            placeholder="—"
                            aria-label={`Set ${i + 1} calories`}
                            className="h-10 px-1 text-center text-base tabular-nums"
                          />
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
              ) : editingKey === dayKey ? (
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
                <div className="grid grid-cols-[30px_minmax(56px,1fr)_56px_44px_20px] gap-1.5 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Set</span>
                  <span>Time</span>
                  <span>Cal</span>
                  <span>RPE</span>
                  <span></span>
                </div>
                {g.sets.map((s: any, i: number) => (
                  <div
                    key={s.id}
                    className={cn(
                      "grid grid-cols-[30px_minmax(56px,1fr)_56px_44px_20px] items-center gap-1.5 border-t border-border/60 px-2 py-1.5 text-xs",
                      s.completed_at && "bg-green-500/5",
                    )}
                  >
                    <span className="font-mono text-muted-foreground">{i + 1}</span>
                    <span className="font-medium tabular-nums">{cardioClock(s.completed_duration_seconds)}</span>
                    <span className="tabular-nums">{s.actual_calories != null ? s.actual_calories : "—"}</span>
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
              <div className="overflow-hidden rounded-md border border-border">
                <div className="grid grid-cols-[30px_minmax(64px,1fr)_40px_40px_48px_20px] gap-1.5 border-b border-border bg-muted/40 px-2 py-1 text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Set</span>
                  <span>Load</span>
                  <span>Reps</span>
                  <span>RPE</span>
                  <span title="Mean concentric velocity">Vel</span>
                  <span></span>
                </div>
                {g.sets.map((s: any, i: number) => (
                  <div
                    key={s.id}
                    className={cn(
                      "grid grid-cols-[30px_minmax(64px,1fr)_40px_40px_48px_20px] items-center gap-1.5 border-t border-border/60 px-2 py-1.5 text-xs",
                      s.completed_at && "bg-green-500/5",
                    )}
                  >
                    <span className="font-mono text-muted-foreground">{i + 1}</span>
                    <span className="font-medium tabular-nums">
                      {fmtLoad(s)}
                      {(() => {
                        // Secondary annotation: show the converted value in
                        // the caller's `displayUnit` when it differs from
                        // the entered unit, so a coach viewing in lb still
                        // sees a kg equivalent alongside a kg entry.
                        const enteredUnit =
                          s.entered_unit === "kg" || s.entered_unit === "lb"
                            ? s.entered_unit
                            : s.actual_load_unit === "kg" || s.actual_load_unit === "lb"
                              ? s.actual_load_unit
                              : null;
                        if (!enteredUnit || enteredUnit === displayUnit) return null;
                        const conv = displayUnit === "kg" ? s.normalized_kg : s.normalized_lb;
                        if (conv == null) return null;
                        const n = Number(conv);
                        const rounded = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Number(n.toFixed(1));
                        return (
                          <span className="ml-1 text-[10px] text-muted-foreground">
                            (≈ {rounded} {displayUnit})
                          </span>
                        );
                      })()}
                    </span>
                    <span className="tabular-nums">{s.actual_reps ?? "—"}</span>
                    <span className="tabular-nums">{s.actual_rpe ?? "—"}</span>
                    <span className="tabular-nums">{s.mean_concentric_velocity_mps != null ? Number(s.mean_concentric_velocity_mps).toFixed(2) : "—"}</span>
                    <span className="text-right">
                      {s.completed_at
                        ? <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500" />
                        : <Circle className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />}
                    </span>
                  </div>
                ))}
              </div>
              )}
            </Card>
          );
        })}
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