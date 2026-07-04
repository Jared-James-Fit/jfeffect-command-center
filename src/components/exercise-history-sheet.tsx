import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { History, CheckCircle2, Circle, StickyNote } from "lucide-react";
import { format } from "date-fns";
import { cn } from "@/lib/utils";

const sb = supabase as any;

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
}) {
  const [showPartial, setShowPartial] = useState(!excludePartial);
  const [days, setDays] = useState<number | null>(null);

  const { data: rows = [], isLoading, isFetching } = useQuery({
    queryKey: ["exercise-history", clientId, exerciseId, days],
    enabled: !!clientId && !!exerciseId && open,
    staleTime: 2 * 60_000,   // cache for 2 min — avoids re-fetch on every open
    gcTime: 10 * 60_000,
    retry: 1,
    queryFn: async () => {
      let q = sb
        .from("pl_row_results")
        .select(`
          id, set_index, completed_at, updated_at, created_at,
          actual_reps, actual_rpe, actual_rpe_num,
          entered_value, entered_unit, normalized_kg, normalized_lb,
          actual_load, actual_load_unit,
          pl_exercise_rows!inner(
            id, exercise_id,
            pl_days!inner(id, day_index, title, scheduled_date, pl_weeks!inner(id, week_index, pl_blocks!inner(id, name)))
          )
        `)
        .eq("client_id", clientId)
        .eq("pl_exercise_rows.exercise_id", exerciseId)
        .order("updated_at", { ascending: false })
        .limit(500);
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
    // Most recent day first; sets ascending within day.
    const list = [...byDay.values()];
    list.sort((a, b) => {
      const ad = a.sets[0]?.completed_at ?? a.sets[0]?.updated_at ?? "";
      const bd = b.sets[0]?.completed_at ?? b.sets[0]?.updated_at ?? "";
      return ad < bd ? 1 : -1;
    });
    for (const g of list) {
      g.sets.sort((x, y) => {
        // Sort by created_at first (chronological order they were logged),
        // falling back to set_index. This fixes ordering when the same
        // exercise appears on multiple rows in one day (each row restarts
        // set_index at 1), so we display them in the order performed.
        const ax = x.created_at ?? x.completed_at ?? x.updated_at ?? "";
        const bx = y.created_at ?? y.completed_at ?? y.updated_at ?? "";
        if (ax && bx && ax !== bx) return ax < bx ? -1 : 1;
        return (x.set_index ?? 0) - (y.set_index ?? 0);
      });
    }
    return list;
  }, [rows, showPartial]);

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
            Past logged sets across all blocks. Each set is shown in the unit it was originally logged.
          </SheetDescription>
        </SheetHeader>

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
                This is your first time logging this exercise. Complete a set and it will appear here next time.
              </div>
            </Card>
          )}
          {grouped.map((g) => {
            const isSameTrainingDay = currentDayIndex != null && g.day?.day_index != null && g.day.day_index === currentDayIndex;
            return (
            <Card key={`${g.block?.id}-${g.week?.id}-${g.day?.id}`} className={cn("p-3", isSameTrainingDay && "border-l-4 border-l-primary/40")}>
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
                </div>
              </div>
              <div className="overflow-hidden rounded-md border border-border">
                <div className="grid grid-cols-[36px_1fr_56px_56px_24px] gap-2 border-b border-border bg-muted/40 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                  <span>Set</span>
                  <span>Load</span>
                  <span>Reps</span>
                  <span>RPE</span>
                  <span></span>
                </div>
                {g.sets.map((s: any, i: number) => (
                  <div
                    key={s.id}
                    className={cn(
                      "grid grid-cols-[36px_1fr_56px_56px_24px] items-center gap-2 border-t border-border/60 px-2 py-1.5 text-xs",
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
                    <span className="text-right">
                      {s.completed_at
                        ? <CheckCircle2 className="ml-auto h-3.5 w-3.5 text-green-500" />
                        : <Circle className="ml-auto h-3.5 w-3.5 text-muted-foreground/60" />}
                    </span>
                  </div>
                ))}
              </div>
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
}: {
  clientId: string | null | undefined;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  className?: string;
  currentDayIndex?: number | null;
}) {
  const [open, setOpen] = useState(false);
  if (!clientId || !exerciseId) return null;
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
      />
    </>
  );
}

// Re-export for callers that only need the icon
export { StickyNote };