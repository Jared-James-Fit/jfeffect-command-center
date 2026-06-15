import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, parseISO, addDays, startOfToday } from "date-fns";
import { toast } from "sonner";
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
} from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, AlertTriangle, ArrowRight, Loader2, RotateCcw, Replace } from "lucide-react";
import {
  moveWorkout,
  swapWorkouts,
  undoScheduleChange,
  getMoveContext,
} from "@/lib/schedule-manager.functions";
import { detectScheduleConflicts } from "@/lib/schedule-conflicts";

const WEEKDAY_TO_INT: Record<string, number> = {
  sun: 0, sunday: 0,
  mon: 1, monday: 1,
  tue: 2, tuesday: 2,
  wed: 3, wednesday: 3,
  thu: 4, thursday: 4,
  fri: 5, friday: 5,
  sat: 6, saturday: 6,
};

function toYMD(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export interface MoveWorkoutSheetProps {
  dayId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-selected target date (used when arriving from drag-drop). */
  initialTargetDate?: Date | null;
}

/**
 * The single, reusable bottom-sheet for moving one workout. Every entry
 * point in the schedule manager funnels through this component so the
 * confirm / conflict / undo flow stays consistent.
 */
export function MoveWorkoutSheet({
  dayId,
  open,
  onOpenChange,
  initialTargetDate,
}: MoveWorkoutSheetProps) {
  const queryClient = useQueryClient();
  const fetchCtx = useServerFn(getMoveContext);
  const move = useServerFn(moveWorkout);
  const swap = useServerFn(swapWorkouts);
  const undo = useServerFn(undoScheduleChange);

  const ctxQuery = useQuery({
    queryKey: ["schedule-move-context", dayId],
    enabled: !!dayId && open,
    queryFn: () => fetchCtx({ data: { dayId: dayId! } }),
  });

  const today = startOfToday();
  const ctx = ctxQuery.data;

  const [target, setTarget] = useState<Date | null>(initialTargetDate ?? null);
  const [confirmCompleted, setConfirmCompleted] = useState(false);

  // Reset target when the sheet closes so the next open uses fresh data.
  // Using useMemo for derived state is cleaner than an effect here.
  const initialFromCtx = useMemo(() => {
    if (initialTargetDate) return initialTargetDate;
    if (ctx?.day?.scheduled_date) return parseISO(ctx.day.scheduled_date);
    return null;
  }, [ctx?.day?.scheduled_date, initialTargetDate]);

  const effectiveTarget = target ?? initialFromCtx;

  const conflicts = useMemo(() => {
    if (!ctx || !effectiveTarget) return [];
    return detectScheduleConflicts({
      dayId: ctx.day.id,
      newDate: effectiveTarget,
      allBlockDays: ctx.allBlockDays,
      appointments: [],
      blockRange: {
        start: ctx.block.start_date ? parseISO(ctx.block.start_date) : null,
        end: ctx.block.end_date ? parseISO(ctx.block.end_date) : null,
      },
    });
  }, [ctx, effectiveTarget]);

  const sameDayConflict = conflicts.find((c) => c.kind === "sameDayWorkout");
  const isCompleted = !!ctx?.completion?.completed_at;
  const inProgress = !isCompleted && !!ctx?.completion?.in_progress_at;

  // Suggested chips: client's training-day weekdays in the next 14 days.
  const suggestions = useMemo(() => {
    if (!ctx) return [] as Date[];
    const wantedInts = new Set<number>(
      (ctx.week?.training_days ?? [])
        .map((w: string) => WEEKDAY_TO_INT[w.toLowerCase().slice(0, 3)])
        .filter((n: number | undefined): n is number => typeof n === "number"),
    );
    if (!wantedInts.size) return [];
    const out: Date[] = [];
    for (let i = 0; i < 14 && out.length < 4; i++) {
      const d = addDays(today, i);
      if (wantedInts.has(d.getDay())) out.push(d);
    }
    return out;
  }, [ctx, today]);

  const moveMutation = useMutation({
    mutationFn: async (args: { newDate: Date; confirmCompletedMove: boolean }) => {
      const res = await move({
        data: {
          dayId: dayId!,
          newDate: toYMD(args.newDate),
          confirmCompletedMove: args.confirmCompletedMove,
        },
      });
      return res;
    },
    onSuccess: (res) => {
      if (!res.ok) {
        if (res.requiresCompletedConfirmation) {
          setConfirmCompleted(true);
          toast.warning(res.message);
          return;
        }
        return;
      }
      if (res.noop) {
        toast.info("That workout was already on that date.");
        onOpenChange(false);
        return;
      }
      void queryClient.invalidateQueries();
      toast.success("Workout moved.", {
        action: res.batchId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await undo({ data: { batchId: res.batchId! } });
                  toast.success("Move undone.");
                  void queryClient.invalidateQueries();
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not undo.");
                }
              },
            }
          : undefined,
        duration: 6000,
      });
      onOpenChange(false);
    },
    onError: (e: any) => {
      toast.error(e?.message ?? "Could not save the new date.");
    },
  });

  const swapMutation = useMutation({
    mutationFn: async (otherDayId: string) => {
      return swap({ data: { dayIdA: dayId!, dayIdB: otherDayId } });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries();
      toast.success("Workouts swapped.", {
        action: res.batchId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await undo({ data: { batchId: res.batchId! } });
                  toast.success("Swap undone.");
                  void queryClient.invalidateQueries();
                } catch (e: any) {
                  toast.error(e?.message ?? "Could not undo.");
                }
              },
            }
          : undefined,
        duration: 6000,
      });
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not swap workouts."),
  });

  const handleConfirm = () => {
    if (!effectiveTarget) return;
    moveMutation.mutate({
      newDate: effectiveTarget,
      confirmCompletedMove: confirmCompleted || !isCompleted,
    });
  };

  const title = ctx?.day?.title?.trim() || (ctx ? `Day ${ctx.day.day_index}` : "Workout");
  const currentDateLabel = ctx?.day?.scheduled_date
    ? format(parseISO(ctx.day.scheduled_date), "EEE, MMM d")
    : "Unscheduled";

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent className="px-2 pb-[max(env(safe-area-inset-bottom),1rem)] sm:max-w-md sm:left-1/2 sm:-translate-x-1/2">
        <DrawerHeader className="text-left">
          <DrawerTitle className="flex items-center gap-2">
            <CalendarIcon className="h-5 w-5" /> Move workout
          </DrawerTitle>
          <DrawerDescription className="space-y-1">
            <div className="font-semibold text-foreground">{title}</div>
            {ctx && (
              <div className="text-xs">
                Block {ctx.block.name ? `· ${ctx.block.name}` : ""} · Week {ctx.week.week_index} · Day {ctx.day.day_index}
              </div>
            )}
            <div className="text-xs text-muted-foreground">
              Currently scheduled for <span className="font-medium">{currentDateLabel}</span>
            </div>
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-4 max-h-[60vh] overflow-y-auto">
          {ctxQuery.isLoading && (
            <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading…
            </div>
          )}

          {/* Quick chips */}
          {ctx && (
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant={effectiveTarget && toYMD(effectiveTarget) === toYMD(today) ? "default" : "outline"}
                onClick={() => setTarget(today)}
              >
                Today
              </Button>
              <Button
                size="sm"
                variant={effectiveTarget && toYMD(effectiveTarget) === toYMD(addDays(today, 1)) ? "default" : "outline"}
                onClick={() => setTarget(addDays(today, 1))}
              >
                Tomorrow
              </Button>
              {suggestions.map((d) => {
                const isSel = effectiveTarget && toYMD(effectiveTarget) === toYMD(d);
                return (
                  <Button
                    key={d.toISOString()}
                    size="sm"
                    variant={isSel ? "default" : "outline"}
                    onClick={() => setTarget(d)}
                  >
                    {format(d, "EEE MMM d")}
                  </Button>
                );
              })}
            </div>
          )}

          {/* Calendar */}
          {ctx && (
            <div className="rounded-lg border border-border bg-card">
              <Calendar
                mode="single"
                selected={effectiveTarget ?? undefined}
                onSelect={(d) => d && setTarget(d)}
                className="pointer-events-auto p-3"
              />
            </div>
          )}

          {/* Completion / in-progress warning */}
          {(isCompleted || inProgress) && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  {isCompleted
                    ? "This workout is already completed. Moving it changes only the scheduled date — your logged sets stay attached and editable."
                    : "This workout is in progress. Moving its scheduled date won't lose your current set logs."}
                  {isCompleted && (
                    <label className="mt-2 flex items-center gap-2">
                      <input
                        type="checkbox"
                        checked={confirmCompleted}
                        onChange={(e) => setConfirmCompleted(e.target.checked)}
                        className="h-4 w-4"
                      />
                      I understand. Allow this move.
                    </label>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Conflicts */}
          {conflicts.length > 0 && (
            <div className="space-y-2">
              {conflicts.map((c, i) => (
                <div
                  key={i}
                  className="flex items-start gap-2 rounded-md border border-border bg-secondary/40 p-3 text-xs"
                >
                  <AlertTriangle className="mt-0.5 h-4 w-4 text-amber-500" />
                  <div className="flex-1">
                    <div>{c.message}</div>
                    {c.kind === "sameDayWorkout" && c.payload?.otherDayId && (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7"
                        onClick={() => swapMutation.mutate(String(c.payload!.otherDayId))}
                        disabled={swapMutation.isPending}
                      >
                        <Replace className="mr-1 h-3.5 w-3.5" /> Swap workouts
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}

          {effectiveTarget && ctx && (
            <div className="rounded-md bg-secondary/40 p-3 text-xs">
              <span className="text-muted-foreground">{currentDateLabel}</span>
              <ArrowRight className="mx-2 inline h-3.5 w-3.5" />
              <span className="font-semibold">{format(effectiveTarget, "EEE, MMM d, yyyy")}</span>
              {sameDayConflict && <Badge variant="outline" className="ml-2">Conflict</Badge>}
            </div>
          )}
        </div>

        <DrawerFooter className="flex flex-row gap-2 pt-2">
          <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
            <RotateCcw className="mr-1 h-4 w-4" /> Cancel
          </Button>
          <Button
            className="flex-1"
            disabled={
              !effectiveTarget ||
              moveMutation.isPending ||
              swapMutation.isPending ||
              (isCompleted && !confirmCompleted)
            }
            onClick={handleConfirm}
          >
            {moveMutation.isPending ? (
              <Loader2 className="mr-1 h-4 w-4 animate-spin" />
            ) : (
              <CalendarIcon className="mr-1 h-4 w-4" />
            )}
            Move workout
          </Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}