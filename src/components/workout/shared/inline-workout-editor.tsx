import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle, ArrowDown, ArrowUp, Loader2, Plus, Search, Trash2,
} from "lucide-react";
import { format } from "date-fns";
import { supabase } from "@/integrations/supabase/client";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { ActionButton } from "@/components/action-button";
import { updateDay, updateRow, deleteRow } from "@/lib/pl-programs";
import { syncProgramDaySchedule } from "@/lib/scheduled-workouts.functions";
import { invalidateScheduleQueries } from "@/lib/schedule-invalidate";
import { toLocalISO } from "@/lib/today";
import { searchExercises, type SearchableExercise } from "@/lib/exercise-search";
import { HighlightedExerciseName } from "@/components/exercise-search-highlight";
import { cn } from "@/lib/utils";

/* ──────────────────────────────────────────────────────────────────────────
   InlineWorkoutEditor — focused single-workout editor for coaches/admins.
   Opened from the schedule card ("Edit Workout" beside "Preview Workout").
   Edits the CANONICAL program source (pl_days + pl_exercise_rows) and routes
   Training Date changes through syncProgramDaySchedule so the calendar,
   Schedule Manager, and client portal can never desync.

   Completed-workout protection: when the client has logged sets or completed
   the workout, structural changes (add / remove / reorder) are locked so
   their logged history stays attached to the right rows.
   ────────────────────────────────────────────────────────────────────────── */

type RowData = {
  id: string;
  exercise_id: string | null;
  exercise_name_override: string | null;
  sets: number | null;
  reps_text: string | null;
  rpe: number | string | null;
  load_lb: number | null;
  load_kg: number | null;
  rest_seconds: number | null;
  notes: string | null;
  sort_order: number | null;
  measurement_type: string | null;
  duration_seconds: number | null;
  exercises: { name: string | null } | null;
};

type EditableRow = {
  _dbId: string | null;
  exercise_id: string | null;
  name: string; // display name (override ?? exercise name)
  sets: string;
  reps_text: string;
  rpe: string;
  load_lb: string;
  load_kg: string;
  rest_seconds: string;
  notes: string;
  measurement_type: "reps" | "time";
  duration_seconds: string;
};

function toEditable(r: RowData): EditableRow {
  return {
    _dbId: r.id,
    exercise_id: r.exercise_id,
    name: r.exercise_name_override || r.exercises?.name || "Exercise",
    sets: r.sets != null ? String(r.sets) : "",
    reps_text: r.reps_text ?? "",
    rpe: r.rpe != null ? String(r.rpe) : "",
    load_lb: r.load_lb != null ? String(r.load_lb) : "",
    load_kg: r.load_kg != null ? String(r.load_kg) : "",
    rest_seconds: r.rest_seconds != null ? String(r.rest_seconds) : "",
    notes: r.notes ?? "",
    measurement_type: r.measurement_type === "time" ? "time" : "reps",
    duration_seconds: r.duration_seconds != null ? String(r.duration_seconds) : "",
  };
}

function numOrNull(s: string): number | null {
  const t = s.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function strOrNull(s: string): string | null {
  const t = s.trim();
  return t ? t : null;
}

export function InlineWorkoutEditor({
  open,
  onOpenChange,
  dayId,
  clientId,
  blockId = null,
  scheduledDate = null,
  completed = false,
  loggedSets = 0,
  clientName = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dayId: string;
  clientId: string;
  blockId?: string | null;
  /** Date shown on the schedule card — used as fallback when the day has no stored date. */
  scheduledDate?: Date | null;
  completed?: boolean;
  loggedSets?: number;
  clientName?: string | null;
}) {
  const qc = useQueryClient();
  const locked = completed || loggedSets > 0;

  const { data, isLoading } = useQuery({
    queryKey: ["inline-workout-editor", dayId],
    enabled: open && !!dayId,
    staleTime: 0,
    queryFn: async () => {
      const dayRes = await supabase
        .from("pl_days")
        .select("id, title, subtitle, notes, scheduled_date, day_index")
        .eq("id", dayId)
        .single();
      if (dayRes.error) throw dayRes.error;
      const rowsRes = await supabase
        .from("pl_exercise_rows")
        .select(
          "id, exercise_id, exercise_name_override, sets, reps_text, rpe, load_lb, load_kg, rest_seconds, notes, sort_order, exercises(name)",
        )
        .eq("day_id", dayId)
        .order("sort_order", { ascending: true });
      if (rowsRes.error) throw rowsRes.error;
      return {
        day: dayRes.data as any,
        rows: ((rowsRes.data ?? []) as unknown) as RowData[],
      };
    },
  });

  // ── Local editable state, hydrated from the query ──────────────────────
  const [hydrated, setHydrated] = useState(false);
  const [title, setTitle] = useState("");
  const [subtitle, setSubtitle] = useState("");
  const [dayNotes, setDayNotes] = useState("");
  const [dateStr, setDateStr] = useState("");
  const [rows, setRows] = useState<EditableRow[]>([]);
  // Snapshot of what the server holds, for diffing on save.
  const origDayRef = useRef<any>(null);
  const origRowsRef = useRef<RowData[]>([]);

  useEffect(() => {
    if (!open) { setHydrated(false); return; }
    if (!data || hydrated) return;
    const d = data.day;
    origDayRef.current = d;
    origRowsRef.current = data.rows;
    setTitle(d.title ?? "");
    setSubtitle(d.subtitle ?? "");
    setDayNotes(d.notes ?? "");
    setDateStr(d.scheduled_date ?? (scheduledDate ? toLocalISO(scheduledDate) : ""));
    setRows(data.rows.map(toEditable));
    setHydrated(true);
  }, [open, data, hydrated, scheduledDate]);

  const dirty = useMemo(() => {
    if (!hydrated || !origDayRef.current) return false;
    const d = origDayRef.current;
    if ((title ?? "") !== (d.title ?? "")) return true;
    if ((subtitle ?? "") !== (d.subtitle ?? "")) return true;
    if ((dayNotes ?? "") !== (d.notes ?? "")) return true;
    if (dateStr !== (d.scheduled_date ?? (scheduledDate ? toLocalISO(scheduledDate) : ""))) return true;
    const orig = origRowsRef.current;
    if (orig.length !== rows.length) return true;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!r._dbId) return true;
      const o = orig.find((x) => x.id === r._dbId);
      if (!o) return true;
      if ((o.sort_order ?? 0) !== i) return true;
      if (strOrNull(r.sets) !== (o.sets != null ? String(o.sets) : null)) return true;
      if (strOrNull(r.reps_text) !== (o.reps_text ?? null)) return true;
      if (strOrNull(r.rpe) !== (o.rpe != null ? String(o.rpe) : null)) return true;
      if (strOrNull(r.load_lb) !== (o.load_lb != null ? String(o.load_lb) : null)) return true;
      if (strOrNull(r.load_kg) !== (o.load_kg != null ? String(o.load_kg) : null)) return true;
      if (strOrNull(r.rest_seconds) !== (o.rest_seconds != null ? String(o.rest_seconds) : null)) return true;
      if (strOrNull(r.notes) !== (o.notes ?? null)) return true;
    }
    return false;
  }, [hydrated, title, subtitle, dayNotes, dateStr, rows, scheduledDate]);

  const patchRow = (idx: number, patch: Partial<EditableRow>) =>
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));

  const moveRow = (idx: number, dir: -1 | 1) =>
    setRows((rs) => {
      const j = idx + dir;
      if (j < 0 || j >= rs.length) return rs;
      const next = rs.slice();
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const removeRow = (idx: number) => setRows((rs) => rs.filter((_, i) => i !== idx));

  // ── Exercise search for adding a row ───────────────────────────────────
  const [search, setSearch] = useState("");
  // Pool is loaded once and cached; ranking happens locally with the shared
  // exercise search engine (aliases, out-of-order words, typo tolerance).
  const { data: searchPool = [] } = useQuery({
    queryKey: ["exercise-search-pool-lite"],
    enabled: open,
    staleTime: 10 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const { data: ex, error } = await supabase
        .from("exercises")
        .select("id, name, category, muscle_group, equipment, tags")
        .eq("archived", false)
        .order("name", { ascending: true })
        .limit(5000);
      if (error) throw error;
      return (ex ?? []) as SearchableExercise[];
    },
  });

  const searchOutcome = useMemo(
    () => searchExercises(searchPool, search, { limit: 8 }),
    [searchPool, search],
  );
  const searchResults = searchOutcome.results.map((r) => r.exercise) as Array<{
    id: string;
    name: string;
  }>;

  const addExercise = (ex: { id: string; name: string }) => {
    setRows((rs) => [
      ...rs,
      {
        _dbId: null,
        exercise_id: ex.id,
        name: ex.name,
        sets: "3",
        reps_text: "8",
        rpe: "",
        load_lb: "",
        load_kg: "",
        rest_seconds: "",
        notes: "",
        measurement_type: "reps",
        duration_seconds: "",
      },
    ]);
    setSearch("");
  };

  // ── Save: canonical writes, instance-first schedule sync, convergence ──
  const save = async () => {
    const orig = origDayRef.current;
    if (!orig) return;

    // 1) Day-level fields
    const dPatch: any = {};
    if ((title ?? "") !== (orig.title ?? "")) dPatch.title = title.trim() || null;
    if ((subtitle ?? "") !== (orig.subtitle ?? "")) dPatch.subtitle = subtitle.trim() || null;
    if ((dayNotes ?? "") !== (orig.notes ?? "")) dPatch.notes = dayNotes.trim() || null;
    if (Object.keys(dPatch).length) await updateDay(dayId, dPatch);

    // 2) Training Date — route through the canonical schedule sync
    //    (instance-first + legacy mirror) so the calendar never desyncs.
    const origDate = orig.scheduled_date ?? (scheduledDate ? toLocalISO(scheduledDate) : "");
    if (dateStr !== origDate) {
      if (clientId) {
        await syncProgramDaySchedule({
          data: { clientId, dayId, newDate: dateStr || null },
        });
      } else {
        await updateDay(dayId, { scheduled_date: dateStr || null });
      }
    }

    // 3) Rows — delete removed, update changed, insert new, normalize order
    const origRows = origRowsRef.current;
    const keepIds = new Set(rows.filter((r) => r._dbId).map((r) => r._dbId));
    for (const or of origRows) {
      if (!keepIds.has(or.id)) await deleteRow(or.id);
    }
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const desired: any = {
        sort_order: i,
        sets: numOrNull(r.sets),
        reps_text: strOrNull(r.reps_text),
        rpe: strOrNull(r.rpe),
        load_lb: numOrNull(r.load_lb),
        load_kg: numOrNull(r.load_kg),
        rest_seconds: numOrNull(r.rest_seconds),
        notes: strOrNull(r.notes),
      };
      if (r._dbId) {
        const o = origRows.find((x) => x.id === r._dbId);
        const patch: any = {};
        if (o) {
          if ((o.sort_order ?? 0) !== desired.sort_order) patch.sort_order = desired.sort_order;
          if ((o.sets ?? null) !== desired.sets) patch.sets = desired.sets;
          if ((o.reps_text ?? null) !== desired.reps_text) patch.reps_text = desired.reps_text;
          if ((o.rpe != null ? String(o.rpe) : null) !== desired.rpe) patch.rpe = desired.rpe;
          if ((o.load_lb ?? null) !== desired.load_lb) patch.load_lb = desired.load_lb;
          if ((o.load_kg ?? null) !== desired.load_kg) patch.load_kg = desired.load_kg;
          if ((o.rest_seconds ?? null) !== desired.rest_seconds) patch.rest_seconds = desired.rest_seconds;
          if ((o.notes ?? null) !== desired.notes) patch.notes = desired.notes;
        }
        if (Object.keys(patch).length) await updateRow(r._dbId, patch);
      } else {
        const { data: ins, error } = await supabase
          .from("pl_exercise_rows")
          .insert({
            day_id: dayId,
            exercise_id: r.exercise_id,
            exercise_name_override: null,
            time_profile: "accessory_compound",
            ...desired,
          })
          .select("id")
          .single();
        if (error) throw error;
        r._dbId = ins.id;
      }
    }

    // 4) Converge every surface that renders this workout
    qc.invalidateQueries({ queryKey: ["inline-workout-preview-rows", dayId] });
    qc.invalidateQueries({ queryKey: ["inline-workout-preview-results", dayId] });
    qc.invalidateQueries({ queryKey: ["inline-workout-editor", dayId] });
    qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
    qc.invalidateQueries({ queryKey: ["workouts-experience-client", clientId] });
    qc.invalidateQueries({ queryKey: ["pl-block-tree"] });
    invalidateScheduleQueries(qc, { clientId, blockId });

    // 5) Refresh the local diff baseline so a second save only sends changes
    origDayRef.current = { ...orig, title, subtitle, notes: dayNotes, scheduled_date: dateStr || null };
    origRowsRef.current = rows.map((r, i) => ({
      id: r._dbId as string,
      exercise_id: r.exercise_id,
      exercise_name_override: null,
      sets: numOrNull(r.sets),
      reps_text: strOrNull(r.reps_text),
      rpe: strOrNull(r.rpe),
      load_lb: numOrNull(r.load_lb),
      load_kg: numOrNull(r.load_kg),
      rest_seconds: numOrNull(r.rest_seconds),
      notes: strOrNull(r.notes),
      sort_order: i,
      exercises: { name: r.name },
    }));
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="flex w-full flex-col sm:max-w-lg">
        <SheetHeader>
          <SheetTitle>Edit Workout</SheetTitle>
          <SheetDescription>
            {clientName ? `${clientName}'s workout` : "Client workout"}
            {scheduledDate ? ` · ${format(scheduledDate, "EEE MMM d")}` : ""}
            {" — changes save directly to the client's program."}
          </SheetDescription>
        </SheetHeader>

        {isLoading || !hydrated ? (
          <div className="flex flex-1 items-center justify-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading workout…
          </div>
        ) : (
          <div className="flex-1 space-y-4 overflow-y-auto px-1 py-2">
            {locked && (
              <div className="flex items-start gap-2 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <div>
                  <div className="font-semibold text-amber-700 dark:text-amber-400">
                    {completed ? "This workout is completed." : `${loggedSets} set${loggedSets === 1 ? "" : "s"} already logged.`}
                  </div>
                  <div className="mt-0.5 text-muted-foreground">
                    Prescription edits apply to the client's record immediately. Add / remove /
                    reorder are locked to protect the logged history.
                  </div>
                </div>
              </div>
            )}

            {/* Day details */}
            <div className="space-y-3 rounded-lg border border-border/60 p-3">
              <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                Workout details
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label className="text-xs">Day label</Label>
                  <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Day 1" />
                </div>
                <div>
                  <Label className="text-xs">Subtitle (optional)</Label>
                  <Input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} placeholder="Lower Body" />
                </div>
              </div>
              <div>
                <Label className="text-xs">Training date</Label>
                <Input type="date" value={dateStr} onChange={(e) => setDateStr(e.target.value)} />
              </div>
              <div>
                <Label className="text-xs">Coach notes (client-visible)</Label>
                <Textarea
                  value={dayNotes}
                  onChange={(e) => setDayNotes(e.target.value)}
                  rows={4}
                  placeholder="Long-form guidance the client can expand from the workout page…"
                />
              </div>
            </div>

            {/* Exercise rows */}
            <div className="space-y-2">
              <div className="text-[11px] font-black uppercase tracking-wider text-muted-foreground">
                Exercises ({rows.length})
              </div>
              {rows.map((r, i) => (
                <div key={r._dbId ?? `new-${i}`} className="space-y-2 rounded-lg border border-border/60 p-3">
                  <div className="flex items-center gap-1">
                    <span className="text-xs font-bold text-muted-foreground">{i + 1}.</span>
                    <span className="min-w-0 flex-1 truncate text-sm font-semibold">{r.name}</span>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      disabled={locked || i === 0}
                      onClick={() => moveRow(i, -1)}
                      aria-label="Move up"
                    >
                      <ArrowUp className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon" variant="ghost" className="h-7 w-7"
                      disabled={locked || i === rows.length - 1}
                      onClick={() => moveRow(i, 1)}
                      aria-label="Move down"
                    >
                      <ArrowDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button
                      size="icon" variant="ghost"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      disabled={locked}
                      onClick={() => removeRow(i)}
                      aria-label="Remove exercise"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                  <div className="grid grid-cols-4 gap-2">
                    <div>
                      <Label className="text-[10px]">Sets</Label>
                      <Input inputMode="numeric" value={r.sets} onChange={(e) => patchRow(i, { sets: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Reps</Label>
                      <Input value={r.reps_text} onChange={(e) => patchRow(i, { reps_text: e.target.value })} placeholder="8-10" />
                    </div>
                    <div>
                      <Label className="text-[10px]">RPE</Label>
                      <Input inputMode="decimal" value={r.rpe} onChange={(e) => patchRow(i, { rpe: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Rest (s)</Label>
                      <Input inputMode="numeric" value={r.rest_seconds} onChange={(e) => patchRow(i, { rest_seconds: e.target.value })} />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-[10px]">Load (lb)</Label>
                      <Input inputMode="decimal" value={r.load_lb} onChange={(e) => patchRow(i, { load_lb: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px]">Load (kg)</Label>
                      <Input inputMode="decimal" value={r.load_kg} onChange={(e) => patchRow(i, { load_kg: e.target.value })} />
                    </div>
                  </div>
                  <div>
                    <Label className="text-[10px]">Exercise notes</Label>
                    <Textarea
                      value={r.notes}
                      onChange={(e) => patchRow(i, { notes: e.target.value })}
                      rows={2}
                      placeholder="Cues, tempo, substitutions…"
                    />
                  </div>
                </div>
              ))}

              {/* Add exercise */}
              {!locked && (
                <div className="rounded-lg border border-dashed border-border p-3">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search exercises to add…"
                      className="pl-8"
                    />
                  </div>
                  {search.trim().length >= 2 && (
                    <div className="mt-2 space-y-1">
                      {searchResults.length === 0 ? (
                        <div className="text-xs text-muted-foreground">No matches.</div>
                      ) : (
                        searchResults.map((ex) => (
                          <button
                            key={ex.id}
                            type="button"
                            onClick={() => addExercise(ex)}
                            className={cn(
                              "flex w-full items-center gap-2 rounded-md border border-border/60 px-2.5 py-1.5 text-left text-sm",
                              "hover:border-primary/50 hover:bg-secondary/60",
                            )}
                          >
                            <Plus className="h-3.5 w-3.5 shrink-0 text-primary" />
                            <span className="truncate">
                              <HighlightedExerciseName
                                text={ex.name}
                                terms={searchOutcome.highlightTerms}
                              />
                            </span>
                          </button>
                        ))
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        <SheetFooter className="flex-row gap-2 border-t border-border/60 pt-3">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <ActionButton
            className="flex-1"
            onAction={save}
            disabled={!dirty || isLoading || !hydrated}
            loadingLabel="Saving…"
            successLabel="Saved"
            errorLabel="Save failed"
            successToast="Workout updated — the client sees the changes immediately."
          >
            Save changes
          </ActionButton>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
