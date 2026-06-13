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
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  clientId: string | null | undefined;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  /** When true, hide sets without a completed_at timestamp. */
  excludePartial?: boolean;
}) {
  const [showPartial, setShowPartial] = useState(!excludePartial);
  const [days, setDays] = useState<number | null>(null);

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["exercise-history", clientId, exerciseId, days],
    enabled: !!clientId && !!exerciseId && open,
    queryFn: async () => {
      let q = sb
        .from("pl_row_results")
        .select(`
          id, set_index, completed_at, updated_at,
          actual_reps, actual_rpe, actual_rpe_num,
          entered_value, entered_unit, normalized_kg, normalized_lb,
          actual_load, actual_load_unit,
          pl_exercise_rows!inner(
            id, exercise_id,
            pl_days!inner(id, day_index, title, pl_weeks!inner(id, week_index, pl_blocks!inner(id, name)))
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
    for (const g of list) g.sets.sort((x, y) => (x.set_index ?? 0) - (y.set_index ?? 0));
    return list;
  }, [rows, showPartial]);

  const fmtLoad = (r: any): string => {
    const v = displayUnit === "kg" ? r.normalized_kg : r.normalized_lb;
    if (v == null) return "—";
    const n = Number(v);
    const rounded = Math.abs(n - Math.round(n)) < 0.05 ? Math.round(n) : Number(n.toFixed(1));
    return `${rounded} ${displayUnit}`;
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full sm:max-w-lg overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <History className="h-4 w-4" /> {exerciseName} history
          </SheetTitle>
          <SheetDescription>
            Past logged sets across all blocks. Loads shown in {displayUnit.toUpperCase()}; original entries are preserved.
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
          {isLoading && <p className="text-sm text-muted-foreground">Loading history…</p>}
          {!isLoading && grouped.length === 0 && (
            <Card className="p-6 text-center text-sm text-muted-foreground">
              No history yet for this exercise.
            </Card>
          )}
          {grouped.map((g) => (
            <Card key={`${g.block?.id}-${g.week?.id}-${g.day?.id}`} className="p-3">
              <div className="mb-2 flex flex-wrap items-baseline justify-between gap-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                <div className="truncate font-bold">
                  {g.block?.name ?? "Block"} · Wk {g.week?.week_index ?? "?"} · {g.day?.title || `Day ${g.day?.day_index ?? ""}`}
                </div>
                <div>
                  {(() => {
                    const ts = g.sets[g.sets.length - 1]?.completed_at ?? g.sets[g.sets.length - 1]?.updated_at;
                    return ts ? format(new Date(ts), "MMM d, yyyy") : "—";
                  })()}
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
                {g.sets.map((s: any) => (
                  <div
                    key={s.id}
                    className={cn(
                      "grid grid-cols-[36px_1fr_56px_56px_24px] items-center gap-2 border-t border-border/60 px-2 py-1.5 text-xs",
                      s.completed_at && "bg-green-500/5",
                    )}
                  >
                    <span className="font-mono text-muted-foreground">{s.set_index}</span>
                    <span className="font-medium tabular-nums">
                      {fmtLoad(s)}
                      {s.entered_unit && s.entered_unit !== displayUnit && (
                        <span className="ml-1 text-[10px] text-muted-foreground">
                          (entered {Number(s.entered_value)} {s.entered_unit})
                        </span>
                      )}
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
          ))}
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
}: {
  clientId: string | null | undefined;
  exerciseId: string | null | undefined;
  exerciseName: string;
  displayUnit?: "kg" | "lb";
  className?: string;
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
      />
    </>
  );
}

// Re-export for callers that only need the icon
export { StickyNote };