import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { CalendarIcon, AlertTriangle, ArrowRight, Loader2, RotateCcw, Replace, Eye, Trash2, Clock, CheckCircle2 } from "lucide-react";
import {
  moveWorkout,
  swapWorkouts,
  undoScheduleChange,
  getMoveContext,
} from "@/lib/schedule-manager.functions";
import {
  moveScheduledWorkout,
  updateScheduledWorkoutTime,
  removeScheduledWorkout,
} from "@/lib/scheduled-workouts.functions";
import { detectScheduleConflicts } from "@/lib/schedule-conflicts";
import { useMoveWorkout } from "@/lib/use-move-workout";
import { scheduleQueryKeys } from "@/lib/workout-move";
import { useClientImpersonation } from "@/lib/client-impersonation";

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
  /** Owning client — enables precise, minimal schedule cache invalidation. */
  clientId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Optional pre-selected target date (used when arriving from drag-drop). */
  initialTargetDate?: Date | null;
  /**
   * The date the workout currently appears on in the calling UI. Used as a
   * fallback when `pl_days.scheduled_date` is null so the modal mirrors what
   * the user saw on the workout card (e.g. derived from week + day_index).
   */
  currentScheduledDate?: Date | null;
  /**
   * Slice 2c: pl_scheduled_workouts.id of the exact instance the caller
   * wants to move. When present, every write targets this instance —
   * pl_days.scheduled_date is NEVER updated, completion is scoped by
   * scheduled_workout_id, and destination-date collisions become
   * append-as-next-order-index rather than swap. Callers that don't yet
   * thread an instance (genuine legacy program-day cards) omit this and
   * fall through to the legacy dayId path.
   */
  scheduledWorkoutId?: string | null;
  /**
   * When true, surface coach-only instance controls (change time, remove
   * future workout). Ignored on legacy dayId path.
   */
  coachControls?: boolean;
  /**
   * When provided (coach/admin viewing a client schedule), reveals a
   * "View what they logged" action on completed / in-progress workouts.
   * Clicking it enters Client POV as that client and opens the workout
   * page so the coach can see every field the client filled in.
   */
  viewWorkoutAs?: {
    clientId: string;
    clientUserId: string | null;
    clientName: string | null;
  } | null;
}

/**
 * The single, reusable bottom-sheet for moving one workout. Every entry
 * point in the schedule manager funnels through this component so the
 * confirm / conflict / undo flow stays consistent.
 */
export function MoveWorkoutSheet({
  dayId,
  clientId,
  open,
  onOpenChange,
  initialTargetDate,
  currentScheduledDate,
  scheduledWorkoutId,
  coachControls,
  viewWorkoutAs,
}: MoveWorkoutSheetProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const impersonation = useClientImpersonation();
  const fetchCtx = useServerFn(getMoveContext);
  const move = useServerFn(moveWorkout);
  const swap = useServerFn(swapWorkouts);
  const undo = useServerFn(undoScheduleChange);
  const moveInstanceFn = useServerFn(moveScheduledWorkout);
  const updateInstanceTimeFn = useServerFn(updateScheduledWorkoutTime);
  const removeInstanceFn = useServerFn(removeScheduledWorkout);

  const ctxQuery = useQuery({
    queryKey: ["schedule-move-context", dayId, scheduledWorkoutId ?? null],
    enabled: !!dayId && open,
    queryFn: () =>
      fetchCtx({
        data: {
          dayId: dayId!,
          ...(scheduledWorkoutId ? { scheduledWorkoutId } : {}),
        },
      }),
  });

  const today = startOfToday();
  const ctx = ctxQuery.data;
  const effectiveScheduledWorkoutId = scheduledWorkoutId ?? (ctx?.instance?.id ? String(ctx.instance.id) : null);
  const isInstanceMode = !!effectiveScheduledWorkoutId;

  const [target, setTarget] = useState<Date | null>(null);
  const [timeInput, setTimeInput] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    setTarget(initialTargetDate ?? null);
    setTimeInput((ctx?.instance?.scheduled_time as string | null) ?? "");
  }, [dayId, scheduledWorkoutId, initialTargetDate, open, ctx?.instance?.scheduled_time]);

  const initialFromCtx = useMemo(() => {
    if (initialTargetDate) return initialTargetDate;
    if (ctx?.day?.scheduled_date) return parseISO(ctx.day.scheduled_date);
    if (currentScheduledDate) return currentScheduledDate;
    return null;
  }, [ctx?.day?.scheduled_date, initialTargetDate, currentScheduledDate]);

  const effectiveTarget = target ?? initialFromCtx;

  const conflicts = useMemo(() => {
    if (!ctx || !effectiveTarget) return [];
    // In instance mode the app already supports "many workouts on one date"
    // by appending order_index — we do not surface same-day swap conflicts.
    // Other conflicts (block-range, adjacency) are still detected via the
    // legacy day-based checker; that's read-only and safe here.
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
  // Instance mode: same-day is a valid "add to date" (append), NOT a swap.
  const showSwapButton = !isInstanceMode;
  const isCompleted = !!ctx?.completion?.completed_at;
  const completedOnLabel = ctx?.completion?.completed_at
    ? format(new Date(ctx.completion.completed_at), "EEE, MMM d, yyyy")
    : null;
  const inProgress = !isCompleted && !!ctx?.completion?.in_progress_at;

  const canViewLogged =
    !!viewWorkoutAs &&
    !!viewWorkoutAs.clientUserId &&
    !!dayId &&
    (isCompleted || inProgress);

  const handleViewLogged = () => {
    if (!viewWorkoutAs || !viewWorkoutAs.clientUserId || !dayId) return;
    impersonation.start(
      {
        id: viewWorkoutAs.clientId,
        user_id: viewWorkoutAs.clientUserId,
        full_name: viewWorkoutAs.clientName,
      },
      typeof window !== "undefined"
        ? window.location.pathname + window.location.search
        : null,
    );
    onOpenChange(false);
    navigate({
      to: "/portal/workouts/$dayId",
      params: { dayId },
    });
  };

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

  // Canonical shared reschedule mutation (optimistic + minimal invalidation).
  // Drag/drop on the calendar uses the exact same hook.
  const sharedMove = useMoveWorkout(clientId ?? ((ctx?.block as any)?.client_id as string | undefined) ?? null);

  const moveMutation = useMutation({
    mutationFn: async (args: { newDate: Date }) => {
      const res = await sharedMove.mutateAsync({
        target: {
          scheduledWorkoutId: effectiveScheduledWorkoutId,
          dayId: dayId!,
          fromDate: (ctx?.instance?.scheduled_date as string | null) ?? null,
        },
        newDate: toYMD(args.newDate),
      });
      return res as any;
    },
    onSuccess: (res) => {
      if (!res?.ok) return;
      if ((res as any).noop) {
        toast.info("That workout was already on that date.");
        onOpenChange(false);
        return;
      }

      // Instance-scoped undo — restore date/time/orderIndex on the same
      // instance id. Never touches pl_days.scheduled_date.
      if (res.__instance && (res as any).previous && effectiveScheduledWorkoutId) {
        const prev = (res as any).previous as {
          scheduledDate: string;
          scheduledTime: string | null;
          orderIndex: number;
        };
        const capturedInstanceId = effectiveScheduledWorkoutId;
        toast.success("Workout moved.", {
          action: {
            label: "Undo",
            onClick: () => {
              sharedMove.mutate({
                target: {
                  scheduledWorkoutId: capturedInstanceId,
                  dayId: dayId!,
                  fromDate: null,
                },
                newDate: prev.scheduledDate,
                time: prev.scheduledTime,
                orderIndex: prev.orderIndex,
              });
            },
          },
          duration: 6000,
        });
        onOpenChange(false);
        return;
      }

      const batchId = (res as any).batchId as string | undefined;
      toast.success("Workout moved.", {
        action: batchId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await undo({ data: { batchId } });
                  toast.success("Move undone.");
                  for (const key of scheduleQueryKeys(clientId ?? null)) {
                    void queryClient.invalidateQueries({ queryKey: key });
                  }
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
  });


  const swapMutation = useMutation({
    mutationFn: async (otherDayId: string) => {
      if (isInstanceMode) {
        // Should never fire: swap button is hidden in instance mode.
        throw new Error("Swap not supported for scheduled instances — move to append instead.");
      }
      return swap({ data: { dayIdA: dayId!, dayIdB: otherDayId } });
    },
    onSuccess: (res) => {
      void queryClient.invalidateQueries();
      void queryClient.invalidateQueries({ queryKey: ["client-cardio-resolved"] });
      void queryClient.invalidateQueries({ queryKey: ["cal-client-cardio"] });
      void queryClient.invalidateQueries({ queryKey: ["week-sched-data"] });
      toast.success("Workouts swapped.", {
        action: res.batchId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await undo({ data: { batchId: res.batchId! } });
                  toast.success("Swap undone.");
                  void queryClient.invalidateQueries();
                  void queryClient.invalidateQueries({ queryKey: ["client-cardio-resolved"] });
                  void queryClient.invalidateQueries({ queryKey: ["cal-client-cardio"] });
                  void queryClient.invalidateQueries({ queryKey: ["week-sched-data"] });
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

  const changeTimeMutation = useMutation({
    mutationFn: async (t: string | null) =>
      updateInstanceTimeFn({ data: { instanceId: effectiveScheduledWorkoutId!, time: t } }),
    onSuccess: () => {
      toast.success("Time updated.");
      void queryClient.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update time."),
  });

  const removeMutation = useMutation({
    mutationFn: async () =>
      removeInstanceFn({ data: { instanceId: effectiveScheduledWorkoutId! } }),
    onSuccess: () => {
      toast.success("Removed from schedule.");
      void queryClient.invalidateQueries();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not remove."),
  });

  const handleConfirm = () => {
    if (!effectiveTarget) return;
    moveMutation.mutate({ newDate: effectiveTarget });
  };

  const title = ctx?.day?.title?.trim() || (ctx ? `Day ${ctx.day.day_index}` : "Workout");
  const currentDateLabel = ctx?.day?.scheduled_date
    ? format(parseISO(ctx.day.scheduled_date), "EEE, MMM d")
    : currentScheduledDate
      ? format(currentScheduledDate, "EEE, MMM d")
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

          {!ctxQuery.isLoading && ctxQuery.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                <div className="flex-1">
                  <div className="font-medium">Unable to load available dates.</div>
                  <div className="mt-1 text-xs text-muted-foreground">
                    {(ctxQuery.error as any)?.message ?? "Something went wrong."}
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2 h-7"
                    onClick={() => ctxQuery.refetch()}
                  >
                    <RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry
                  </Button>
                </div>
              </div>
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

          {/* Completed workouts can be re-placed on the calendar. Only the
             scheduled date/time/order changes — completion history and
             logged results are untouched. */}
          {isCompleted && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3 text-xs text-emerald-900 dark:text-emerald-200">
              <div className="flex items-start gap-2">
                <CheckCircle2 className="mt-0.5 h-4 w-4" />
                <div>
                  <div className="font-semibold">Completed workout</div>
                  <div>
                    This changes where the workout appears on the schedule.
                    The completed workout history and logged results stay
                    unchanged
                    {completedOnLabel ? ` (completed ${completedOnLabel})` : ""}.
                  </div>
                </div>
              </div>
            </div>
          )}
          {!isCompleted && inProgress && (
            <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4" />
                <div>
                  This workout is in progress. Moving its scheduled date
                  won't lose your current set logs.
                </div>
              </div>
            </div>
          )}

          {canViewLogged && (
            <Button
              variant="outline"
              className="w-full justify-center gap-2"
              onClick={handleViewLogged}
            >
              <Eye className="h-4 w-4" />
              View what {viewWorkoutAs?.clientName?.split(" ")[0] ?? "they"} logged
            </Button>
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
                    {c.kind === "sameDayWorkout" && typeof c.payload?.otherDayId === "string" && (
                      showSwapButton ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="mt-2 h-7"
                        onClick={() => swapMutation.mutate(c.payload!.otherDayId as string)}
                        disabled={swapMutation.isPending}
                      >
                        <Replace className="mr-1 h-3.5 w-3.5" /> Swap workouts
                      </Button>
                      ) : (
                        <div className="mt-1 text-[11px] text-muted-foreground">
                          Another workout is already on that date. Moving here will add this one as an additional workout for that day.
                        </div>
                      )
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

          {/* Coach-only instance controls (change time / remove). */}
          {isInstanceMode && coachControls && ctx?.instance && (
            <div className="rounded-md border border-border p-3 space-y-2">
              <div className="text-xs font-semibold uppercase text-muted-foreground">
                Instance actions
              </div>
              <div className="flex items-end gap-2">
                <div className="flex-1">
                  <Label className="text-xs flex items-center gap-1"><Clock className="h-3 w-3" /> Time</Label>
                  <Input
                    type="time"
                    value={timeInput}
                    onChange={(e) => setTimeInput(e.target.value)}
                  />
                </div>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={changeTimeMutation.isPending}
                  onClick={() => changeTimeMutation.mutate(timeInput || null)}
                >
                  {changeTimeMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save time"}
                </Button>
                {timeInput && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => { setTimeInput(""); changeTimeMutation.mutate(null); }}
                  >
                    Clear
                  </Button>
                )}
              </div>
              {!isCompleted && (
                <Button
                  size="sm"
                  variant="destructive"
                  className="w-full"
                  disabled={removeMutation.isPending}
                  onClick={() => {
                    if (confirm("Remove this scheduled workout? Program structure and past logs are preserved.")) {
                      removeMutation.mutate();
                    }
                  }}
                >
                  <Trash2 className="mr-1 h-3.5 w-3.5" /> Remove future workout
                </Button>
              )}
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
                !!ctxQuery.isError ||
                moveMutation.isPending ||
                swapMutation.isPending
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