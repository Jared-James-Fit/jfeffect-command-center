import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useNavigate } from "@tanstack/react-router";
import { format, parseISO, addDays, addMonths, startOfMonth, startOfToday, startOfWeek, isSameDay, isSameMonth } from "date-fns";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CalendarIcon, AlertTriangle, Loader2, RotateCcw, Replace, Eye, Trash2, Clock, CheckCircle2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
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

  /** Schedule-only invalidation: never refetch programs/analytics/library. */
  const invalidateScheduleOnly = () => {
    for (const key of scheduleQueryKeys(clientId ?? null)) {
      void queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
    }
    void queryClient.invalidateQueries({ queryKey: ["client-cardio-resolved"] });
    void queryClient.invalidateQueries({ queryKey: ["cal-client-cardio"] });
  };

  const ctxQuery = useQuery({
    queryKey: ["schedule-move-context", dayId, scheduledWorkoutId ?? null],
    enabled: !!dayId && open,
    // The sheet renders instantly from already-known state; this context is
    // only an enhancement (conflicts / suggested days / instance actions).
    staleTime: 60_000,
    gcTime: 5 * 60_000,
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

  // Nothing is picked until the athlete taps a day (a drag-drop arrival
  // pre-picks its drop date). Pre-selecting the workout's own date made
  // "Move workout" a no-op that looked like a real choice.
  const [target, setTarget] = useState<Date | null>(null);
  const [timeInput, setTimeInput] = useState<string>("");
  const [view, setView] = useState<"week" | "month">("week");
  const [anchorOverride, setAnchorOverride] = useState<Date | null>(null);
  const [conflictChoice, setConflictChoice] = useState<"swap" | "both">("swap");

  useEffect(() => {
    if (!open) return;
    setTarget(initialTargetDate ?? null);
    setView("week");
    setAnchorOverride(null);
    setConflictChoice("swap");
    setTimeInput((ctx?.instance?.scheduled_time as string | null) ?? "");
  }, [dayId, scheduledWorkoutId, initialTargetDate, open, ctx?.instance?.scheduled_time]);

  const currentDate = useMemo(() => {
    if (ctx?.day?.scheduled_date) return parseISO(ctx.day.scheduled_date);
    return currentScheduledDate ?? null;
  }, [ctx?.day?.scheduled_date, currentScheduledDate]);

  const effectiveTarget = target;

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
  const otherNotes = conflicts.filter((c) => c.kind !== "sameDayWorkout");
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

  // What's already on each date (this workout excluded), so every day in the
  // picker says what's there before it's tapped. Instance mode reads the
  // client's scheduled instances; legacy days read pl_days.scheduled_date.
  const busyByDate = useMemo(() => {
    const m = new Map<string, string[]>();
    const add = (ymd: string | null | undefined, title: string) => {
      if (!ymd) return;
      const key = ymd.slice(0, 10);
      m.set(key, [...(m.get(key) ?? []), title]);
    };
    if (!ctx) return m;
    if (isInstanceMode) {
      for (const s of (ctx.siblingInstances ?? []) as any[]) {
        if (String(s.id) === effectiveScheduledWorkoutId) continue;
        add(s.scheduled_date, s.title || "Workout");
      }
    } else {
      for (const d of ctx.allBlockDays ?? []) {
        if (d.id === dayId) continue;
        add(d.scheduled_date, d.title?.trim() || `Day ${d.day_index}`);
      }
    }
    return m;
  }, [ctx, isInstanceMode, effectiveScheduledWorkoutId, dayId]);

  const trainingDays = useMemo(
    () =>
      new Set<number>(
        (ctx?.week?.training_days ?? [])
          .map((w: string) => WEEKDAY_TO_INT[String(w).toLowerCase().slice(0, 3)])
          .filter((n: number | undefined): n is number => typeof n === "number"),
      ),
    [ctx?.week?.training_days],
  );

  // Open on the week the athlete most likely means: the workout's own week,
  // or this week when the workout is already behind them.
  const defaultAnchor = initialTargetDate ?? (currentDate && currentDate > today ? currentDate : today);
  const anchor = anchorOverride ?? defaultAnchor;
  const weekStart = startOfWeek(anchor, { weekStartsOn: 1 });
  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const monthStart = startOfMonth(anchor);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const monthCells = Array.from({ length: 42 }, (_, i) => addDays(gridStart, i));
  const thisWeekStart = startOfWeek(today, { weekStartsOn: 1 });
  const weekOffset = Math.round((weekStart.getTime() - thisWeekStart.getTime()) / (7 * 86_400_000));
  const rangeLabel =
    view === "month"
      ? format(monthStart, "MMMM yyyy")
      : weekOffset === 0
        ? "This week"
        : weekOffset === 1
          ? "Next week"
          : weekOffset === -1
            ? "Last week"
            : `${format(weekStart, "MMM d")}–${format(addDays(weekStart, 6), isSameMonth(weekStart, addDays(weekStart, 6)) ? "d" : "MMM d")}`;
  const step = (dir: 1 | -1) =>
    setAnchorOverride(view === "month" ? addMonths(monthStart, dir) : addDays(weekStart, 7 * dir));

  const pick = (d: Date) => {
    setTarget(d);
    setConflictChoice("swap");
  };
  const isCurrent = (d: Date) => !!currentDate && isSameDay(d, currentDate);
  const targetBusy = target ? busyByDate.get(toYMD(target)) ?? [] : [];
  const canSwap = showSwapButton && !!sameDayConflict && typeof sameDayConflict.payload?.otherDayId === "string";
  const willSwap = canSwap && conflictChoice === "swap";
  const swapTitle = targetBusy[0] ?? "that workout";

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
      invalidateScheduleOnly();
      toast.success("Workouts swapped.", {
        action: res.batchId
          ? {
              label: "Undo",
              onClick: async () => {
                try {
                  await undo({ data: { batchId: res.batchId! } });
                  toast.success("Swap undone.");
                  invalidateScheduleOnly();
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
      invalidateScheduleOnly();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not update time."),
  });

  const removeMutation = useMutation({
    mutationFn: async () =>
      removeInstanceFn({ data: { instanceId: effectiveScheduledWorkoutId! } }),
    onSuccess: () => {
      toast.success("Removed from schedule.");
      invalidateScheduleOnly();
      onOpenChange(false);
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not remove."),
  });

  const handleConfirm = () => {
    if (!effectiveTarget) return;
    if (willSwap) {
      swapMutation.mutate(sameDayConflict!.payload!.otherDayId as string);
      return;
    }
    moveMutation.mutate({ newDate: effectiveTarget });
  };
  const busyMutating = moveMutation.isPending || swapMutation.isPending;
  const confirmLabel = !effectiveTarget
    ? "Pick a day"
    : willSwap
      ? "Swap days"
      : `Move to ${format(effectiveTarget, "EEE, MMM d")}`;

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
              Now on <span className="font-medium text-foreground">{currentDateLabel}</span>
              {!isCompleted && inProgress && (
                <span className="text-amber-600 dark:text-amber-400"> · in progress, your logged sets move with it</span>
              )}
            </div>
          </DrawerDescription>
        </DrawerHeader>

        <div className="px-4 space-y-3 max-h-[55vh] overflow-y-auto">
          {!ctxQuery.isLoading && ctxQuery.isError && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />
                <div className="flex-1">
                  <div className="font-medium">Couldn't load your schedule.</div>
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

          {/* Week list by default (each day says what's on it); Month for longer moves. */}
          <div className="flex items-center justify-between gap-2">
            <div className="inline-flex rounded-lg border border-border bg-card p-0.5 text-xs" role="tablist" aria-label="Calendar view">
              {(["week", "month"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  role="tab"
                  aria-selected={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    "rounded-md px-3 py-1.5 font-bold capitalize",
                    view === v ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}
                >
                  {v}
                </button>
              ))}
            </div>
            <div className="flex min-w-0 items-center gap-0.5">
              <button type="button" onClick={() => step(-1)} aria-label={view === "month" ? "Previous month" : "Previous week"} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <ChevronLeft className="h-4 w-4" />
              </button>
              <span className="min-w-0 truncate text-center text-xs font-semibold" data-testid="move-range-label">{rangeLabel}</span>
              <button type="button" onClick={() => step(1)} aria-label={view === "month" ? "Next month" : "Next week"} className="inline-flex h-9 w-9 items-center justify-center rounded-full text-muted-foreground hover:bg-muted">
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>

          {ctxQuery.isLoading && (
            <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> Checking your schedule…
            </div>
          )}

          {view === "week" ? (
            <div className="space-y-1.5" role="radiogroup" aria-label="Pick a day">
              {weekDays.map((d) => {
                const key = toYMD(d);
                const busy = busyByDate.get(key) ?? [];
                const current = isCurrent(d);
                const selected = !!target && isSameDay(d, target);
                const rel = isSameDay(d, today) ? "Today" : isSameDay(d, addDays(today, 1)) ? "Tomorrow" : null;
                return (
                  <button
                    key={key}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    disabled={current}
                    onClick={() => pick(d)}
                    data-testid="move-day"
                    className={cn(
                      "flex w-full items-center gap-3 rounded-xl border px-3 py-1.5 text-left transition active:scale-[0.99]",
                      selected
                        ? "border-primary bg-primary/10"
                        : current
                          ? "border-dashed border-border bg-muted/30"
                          : "border-border bg-card hover:bg-muted/40",
                      d < today && !current && !selected && "opacity-60",
                    )}
                  >
                    <div className="w-10 shrink-0 text-center leading-tight">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{format(d, "EEE")}</div>
                      <div className="text-lg font-black tabular-nums">{format(d, "d")}</div>
                    </div>
                    <div className="min-w-0 flex-1">
                      {current ? (
                        <div className="truncate text-sm font-bold">
                          This workout <span className="ml-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-bold uppercase text-muted-foreground">Now</span>
                        </div>
                      ) : busy.length ? (
                        busy.map((t, i) => (
                          <div key={i} className="truncate text-sm font-semibold">{t}</div>
                        ))
                      ) : (
                        <div className="text-sm text-muted-foreground">
                          Free{trainingDays.has(d.getDay()) && <span className="text-foreground/80"> · usual training day</span>}
                        </div>
                      )}
                      {rel && <div className="text-[11px] font-semibold text-primary">{rel}</div>}
                    </div>
                    {selected && <Check className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />}
                  </button>
                );
              })}
            </div>
          ) : (
            <div role="grid" aria-label={format(monthStart, "MMMM yyyy")}>
              <div className="grid grid-cols-7 pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((w) => <span key={w}>{w}</span>)}
              </div>
              <div className="grid grid-cols-7 gap-1">
                {monthCells.map((d) => {
                  const key = toYMD(d);
                  const busy = (busyByDate.get(key) ?? []).length > 0;
                  const current = isCurrent(d);
                  const selected = !!target && isSameDay(d, target);
                  const inMonth = isSameMonth(d, monthStart);
                  return (
                    <button
                      key={key}
                      type="button"
                      disabled={current}
                      onClick={() => pick(d)}
                      aria-label={`${format(d, "EEEE, MMMM d")}${current ? ", this workout" : busy ? ", has a workout" : ", free"}`}
                      aria-pressed={selected}
                      data-testid="move-month-day"
                      className={cn(
                        "relative flex h-11 flex-col items-center justify-center rounded-lg text-sm font-semibold tabular-nums transition",
                        selected
                          ? "bg-primary text-primary-foreground"
                          : current
                            ? "border border-dashed border-muted-foreground/50 text-foreground"
                            : "hover:bg-muted/50",
                        !inMonth && !selected && "text-muted-foreground/40",
                        isSameDay(d, today) && !selected && "text-primary",
                      )}
                    >
                      {format(d, "d")}
                      <span
                        className={cn(
                          "mt-0.5 h-1 w-1 rounded-full",
                          busy || current ? (selected ? "bg-primary-foreground" : "bg-muted-foreground") : "bg-transparent",
                        )}
                        aria-hidden="true"
                      />
                    </button>
                  );
                })}
              </div>
              <div className="mt-2 flex items-center gap-3 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="h-1 w-1 rounded-full bg-muted-foreground" /> has a workout</span>
                <span className="inline-flex items-center gap-1"><span className="h-3 w-3 rounded border border-dashed border-muted-foreground/50" /> this workout</span>
              </div>
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

        <DrawerFooter className="gap-2 pt-2">
          {/* One place that says what will happen. */}
          <div className="min-h-[2.5rem] space-y-2" aria-live="polite" data-testid="move-result">
            {!effectiveTarget ? (
              <p className="text-center text-xs text-muted-foreground">Tap a day to move this workout there.</p>
            ) : targetBusy.length === 0 ? (
              <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="h-3.5 w-3.5" /> {format(effectiveTarget, "EEE, MMM d")} is free.
              </p>
            ) : (
              <div>
                <p className="text-xs">
                  <span className="font-semibold">{format(effectiveTarget, "EEE, MMM d")}</span> already has{" "}
                  <span className="font-semibold">{targetBusy.join(" + ")}</span>.
                </p>
                {canSwap ? (
                  <div className="mt-1.5 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="What to do with the other workout">
                    {([
                      ["swap", "Swap days", `${swapTitle} moves to ${currentDate ? format(currentDate, "EEE, MMM d") : "this workout's day"}`],
                      ["both", "Do both", `Two workouts on ${format(effectiveTarget, "EEE")}`],
                    ] as const).map(([v, label, hint]) => (
                      <button
                        key={v}
                        type="button"
                        role="radio"
                        aria-checked={conflictChoice === v}
                        onClick={() => setConflictChoice(v)}
                        className={cn(
                          "rounded-lg border px-2.5 py-2 text-left transition",
                          conflictChoice === v ? "border-primary bg-primary/10" : "border-border bg-card",
                        )}
                      >
                        <div className="flex items-center gap-1 text-xs font-bold">
                          {v === "swap" && <Replace className="h-3.5 w-3.5" />} {label}
                        </div>
                        <div className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{hint}</div>
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">This adds it as a second workout that day.</p>
                )}
              </div>
            )}
            {effectiveTarget && otherNotes.length > 0 && (
              <ul className="space-y-0.5">
                {otherNotes.map((c, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-[11px] text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> {c.message}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="flex flex-row gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              className="min-w-0 flex-[1.6]"
              disabled={!effectiveTarget || busyMutating}
              onClick={handleConfirm}
              data-testid="move-confirm"
            >
              {busyMutating ? (
                <Loader2 className="mr-1 h-4 w-4 animate-spin" />
              ) : willSwap ? (
                <Replace className="mr-1 h-4 w-4" />
              ) : (
                <CalendarIcon className="mr-1 h-4 w-4" />
              )}
              <span className="truncate">{confirmLabel}</span>
            </Button>
          </div>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}