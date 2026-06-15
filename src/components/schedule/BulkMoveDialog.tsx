import { useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { addDays, differenceInCalendarDays, format, parseISO, startOfToday } from "date-fns";
import { toast } from "sonner";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { ArrowRight, Loader2, ListChecks } from "lucide-react";
import { applyBulkScheduleChange } from "@/lib/schedule-bulk.functions";
import { undoScheduleChange } from "@/lib/schedule-manager.functions";
import type {
  ScheduleDay, ScheduleWeek, ScheduleBlock, ScheduleCompletion,
} from "./ScheduleCalendar";

type Scope = "single" | "week" | "pattern" | "block" | "program" | "custom";

const SCOPE_LABELS: Record<Scope, string> = {
  single: "This workout only",
  week: "This week",
  pattern: "All future matching Day N",
  block: "All remaining weeks in this block",
  program: "All remaining program weeks",
  custom: "Choose specific weeks/workouts",
};

function ymd(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;
}

interface Ctx {
  days: ScheduleDay[]; weeks: ScheduleWeek[]; blocks: ScheduleBlock[]; completions: ScheduleCompletion[];
}

function computeMoves(args: {
  ctx: Ctx; anchorDayId: string; newDate: Date; scope: Scope; customDayIds?: string[];
}): Array<{ dayId: string; newDate: string; from: string | null; meta: { title: string; weekIndex: number; dayIndex: number; blockName: string | null } }> {
  const { ctx, anchorDayId, newDate, scope, customDayIds } = args;
  const anchor = ctx.days.find((d) => d.id === anchorDayId);
  if (!anchor) return [];
  const anchorOldDate = anchor.scheduled_date ? parseISO(anchor.scheduled_date) : null;
  const delta = anchorOldDate ? differenceInCalendarDays(newDate, anchorOldDate) : 0;
  const weekById = new Map(ctx.weeks.map((w) => [w.id, w]));
  const blockById = new Map(ctx.blocks.map((b) => [b.id, b]));
  const wkAnchor = weekById.get(anchor.week_id)!;
  const blkAnchor = blockById.get(wkAnchor.block_id);

  let targetDays: ScheduleDay[] = [];
  switch (scope) {
    case "single": targetDays = [anchor]; break;
    case "week":
      targetDays = ctx.days.filter((d) => d.week_id === anchor.week_id);
      break;
    case "pattern": {
      // Same day_index in same block, current+future weeks (>= anchor.week_index).
      const weeksInBlock = ctx.weeks.filter((w) => w.block_id === wkAnchor.block_id && w.week_index >= wkAnchor.week_index);
      const weekIds = new Set(weeksInBlock.map((w) => w.id));
      targetDays = ctx.days.filter((d) => weekIds.has(d.week_id) && d.day_index === anchor.day_index);
      break;
    }
    case "block": {
      // All days in anchor's block where the week_index >= anchor.week_index.
      const weeksInBlock = ctx.weeks.filter((w) => w.block_id === wkAnchor.block_id && w.week_index >= wkAnchor.week_index);
      const weekIds = new Set(weeksInBlock.map((w) => w.id));
      targetDays = ctx.days.filter((d) => weekIds.has(d.week_id));
      break;
    }
    case "program": {
      // All days from anchor's week forward across all blocks.
      const today = startOfToday();
      targetDays = ctx.days.filter((d) => {
        if (!d.scheduled_date) return false;
        return parseISO(d.scheduled_date) >= today;
      });
      break;
    }
    case "custom":
      targetDays = ctx.days.filter((d) => (customDayIds ?? []).includes(d.id));
      break;
  }

  return targetDays.map((d) => {
    let target: Date;
    if (d.id === anchorDayId || !d.scheduled_date) {
      // For the anchor or any unscheduled day, apply the explicit newDate
      // for anchor / fallback to delta-shift from today for unscheduled.
      target = d.id === anchorDayId ? newDate : addDays(new Date(), delta);
    } else {
      target = addDays(parseISO(d.scheduled_date), delta);
    }
    const wk = weekById.get(d.week_id)!;
    const blk = blockById.get(wk.block_id);
    return {
      dayId: d.id,
      newDate: ymd(target),
      from: d.scheduled_date,
      meta: {
        title: d.title?.trim() || `Day ${d.day_index}`,
        weekIndex: wk.week_index,
        dayIndex: d.day_index,
        blockName: blk?.name ?? null,
      },
    };
  })
  .filter((m) => m.from !== m.newDate);
}

export interface BulkMoveDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  anchorDayId: string | null;
  initialTargetDate?: Date | null;
  ctx: Ctx;
}

export function BulkMoveDialog({ open, onOpenChange, anchorDayId, initialTargetDate, ctx }: BulkMoveDialogProps) {
  const qc = useQueryClient();
  const apply = useServerFn(applyBulkScheduleChange);
  const undo = useServerFn(undoScheduleChange);

  const [scope, setScope] = useState<Scope>("single");
  const [newDate, setNewDate] = useState<Date | null>(initialTargetDate ?? null);
  const [step, setStep] = useState<"scope" | "preview">("scope");
  const [customIds, setCustomIds] = useState<string[]>([]);
  const [confirmCompleted, setConfirmCompleted] = useState(false);

  const moves = useMemo(() => {
    if (!anchorDayId || !newDate) return [];
    return computeMoves({ ctx, anchorDayId, newDate, scope, customDayIds: customIds });
  }, [ctx, anchorDayId, newDate, scope, customIds]);

  const mutation = useMutation({
    mutationFn: async () => apply({
      data: {
        moves: moves.map((m) => ({ dayId: m.dayId, newDate: m.newDate })),
        scope: scope === "single" ? "single" : (scope as any),
        confirmCompletedMove: confirmCompleted,
      },
    }),
    onSuccess: (res: any) => {
      if (!res?.ok) {
        if (res?.requiresCompletedConfirmation) {
          setConfirmCompleted(true);
          toast.warning(res.message);
          return;
        }
        return;
      }
      if (res.noop) { toast.info("Nothing to change — already on those dates."); onOpenChange(false); return; }
      void qc.invalidateQueries();
      toast.success(`Moved ${res.applied} workout${res.applied === 1 ? "" : "s"}.`, {
        duration: 6000,
        action: res.batchId ? {
          label: "Undo",
          onClick: async () => {
            try { await undo({ data: { batchId: res.batchId } }); toast.success("Undone."); void qc.invalidateQueries(); }
            catch (e: any) { toast.error(e?.message ?? "Could not undo."); }
          },
        } : undefined,
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not apply the change."),
  });

  const anchor = anchorDayId ? ctx.days.find((d) => d.id === anchorDayId) : null;
  const allDaysSorted = useMemo(
    () => [...ctx.days].sort((a,b) => (a.scheduled_date ?? "").localeCompare(b.scheduled_date ?? "")),
    [ctx.days],
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><ListChecks className="h-5 w-5" /> Reschedule workouts</DialogTitle>
          <DialogDescription>
            {anchor && (<>Anchor: <span className="font-medium text-foreground">{anchor.title?.trim() || `Day ${anchor.day_index}`}</span>{" "}— current date{" "}
              <span className="font-medium text-foreground">{anchor.scheduled_date ?? "unscheduled"}</span></>)}
          </DialogDescription>
        </DialogHeader>

        {step === "scope" && (
          <div className="space-y-4">
            <div>
              <Label className="mb-2 block">New date for the anchor workout</Label>
              <div className="rounded-md border border-border bg-card">
                <Calendar mode="single" selected={newDate ?? undefined}
                  onSelect={(d) => d && setNewDate(d)} className="p-3 pointer-events-auto" />
              </div>
            </div>
            <div>
              <Label className="mb-2 block">Apply to</Label>
              <RadioGroup value={scope} onValueChange={(v) => setScope(v as Scope)} className="space-y-2">
                {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
                  <div key={s} className="flex items-start gap-2 rounded-md border border-border p-2">
                    <RadioGroupItem value={s} id={`scope-${s}`} className="mt-0.5" />
                    <Label htmlFor={`scope-${s}`} className="font-normal cursor-pointer flex-1">
                      {SCOPE_LABELS[s]}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {scope === "custom" && (
              <div className="rounded-md border border-border p-2 max-h-60 overflow-y-auto space-y-1">
                <div className="flex items-center gap-2 pb-2 border-b">
                  <Button size="sm" variant="outline" onClick={() => setCustomIds(allDaysSorted.map((d) => d.id))}>Select all</Button>
                  <Button size="sm" variant="outline" onClick={() => setCustomIds([])}>Clear</Button>
                  <span className="text-xs text-muted-foreground ml-auto">{customIds.length} selected</span>
                </div>
                {allDaysSorted.map((d) => {
                  const checked = customIds.includes(d.id);
                  return (
                    <label key={d.id} className="flex items-center gap-2 text-xs py-1 cursor-pointer">
                      <Checkbox checked={checked} onCheckedChange={(v) => {
                        setCustomIds((prev) => v ? Array.from(new Set([...prev, d.id])) : prev.filter((x) => x !== d.id));
                      }} />
                      <span className="text-muted-foreground w-20">{d.scheduled_date ?? "—"}</span>
                      <span className="font-medium flex-1 truncate">{d.title?.trim() || `Day ${d.day_index}`}</span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {step === "preview" && (
          <div className="space-y-3">
            <div className="text-sm">
              <span className="font-medium">{moves.length}</span> workout{moves.length === 1 ? "" : "s"} will move.
            </div>
            <div className="max-h-80 overflow-y-auto rounded-md border border-border divide-y">
              {moves.length === 0 && (
                <div className="p-4 text-sm text-muted-foreground text-center">No changes to apply.</div>
              )}
              {moves.map((m) => (
                <div key={m.dayId} className="flex items-center gap-2 p-2 text-xs">
                  <div className="flex-1 min-w-0">
                    <div className="font-medium truncate">{m.meta.title}</div>
                    <div className="text-muted-foreground">
                      {m.meta.blockName ? `${m.meta.blockName} · ` : ""}W{m.meta.weekIndex} · D{m.meta.dayIndex}
                    </div>
                  </div>
                  <div className="text-muted-foreground">{m.from ?? "unscheduled"}</div>
                  <ArrowRight className="h-3 w-3 text-muted-foreground" />
                  <div className="font-semibold">{m.newDate}</div>
                </div>
              ))}
            </div>
            <label className="flex items-center gap-2 text-xs text-muted-foreground">
              <Checkbox checked={confirmCompleted} onCheckedChange={(v) => setConfirmCompleted(!!v)} />
              I understand any completed workouts in this batch will be rescheduled (logs preserved).
            </label>
          </div>
        )}

        <DialogFooter className="gap-2">
          {step === "preview" && (
            <Button variant="outline" onClick={() => setStep("scope")} disabled={mutation.isPending}>Back</Button>
          )}
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={mutation.isPending}>Cancel</Button>
          {step === "scope" ? (
            <Button onClick={() => setStep("preview")} disabled={!newDate || (scope === "custom" && customIds.length === 0)}>
              Preview <Badge variant="secondary" className="ml-2">{moves.length}</Badge>
            </Button>
          ) : (
            <Button onClick={() => mutation.mutate()} disabled={mutation.isPending || moves.length === 0}>
              {mutation.isPending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}
              Apply {moves.length} change{moves.length === 1 ? "" : "s"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
