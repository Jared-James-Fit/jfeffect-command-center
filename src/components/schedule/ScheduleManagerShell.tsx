import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, History as HistoryIcon, ListChecks, CalendarRange, CalendarDays, ListTodo, MoreHorizontal, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { getClientSchedule } from "@/lib/schedule-bulk.functions";
import { reorderScheduledWorkouts } from "@/lib/scheduled-workouts.functions";
import { useMoveWorkout } from "@/lib/use-move-workout";
import { scheduleQueryKeys } from "@/lib/workout-move";
import { format } from "date-fns";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { ScheduleManagerList } from "./ScheduleManagerList";
import { BulkMoveDialog } from "./BulkMoveDialog";
import { MoveWorkoutSheet } from "./MoveWorkoutSheet";
import { ScheduleHistoryDrawer } from "./ScheduleHistoryDrawer";
import { WeeklyScheduleEditor } from "./WeeklyScheduleEditor";
import { ScheduleWorkoutSheet } from "./ScheduleWorkoutSheet";

export interface ScheduleManagerShellProps {
  clientId: string;
  /**
   * "coach": the client's Training tab: one Schedule card (Calendar / Whole
   * program, + Add workout, ⋯ Bulk move · History), no weekly editor (drag,
   * Move and Bulk move cover it). "client": the athlete's own page, as before.
   */
  mode: "client" | "coach";
}

export function ScheduleManagerShell({ clientId, mode }: ScheduleManagerShellProps) {
  const fetchFn = useServerFn(getClientSchedule);
  const reorderFn = useServerFn(reorderScheduledWorkouts);
  const queryClient = useQueryClient();
  const optimisticMove = useMoveWorkout(clientId);
  const { data, isLoading } = useQuery({
    queryKey: ["client-schedule", clientId],
    enabled: !!clientId,
    queryFn: () => fetchFn({ data: { clientId } }),
  });

  const [moveDayId, setMoveDayId] = useState<string | null>(null);
  const [moveInstanceId, setMoveInstanceId] = useState<string | null>(null);
  const [moveInitialDate, setMoveInitialDate] = useState<Date | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkAnchor, setBulkAnchor] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [weeklyWeekId, setWeeklyWeekId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  // Additive view toggle: the existing calendar stays the default; the
  // Schedule Manager list is a faster overview layer over the same data.
  const [view, setView] = useState<"calendar" | "list">("calendar");

  const reorderMutation = useMutation({
    mutationFn: async (args: { date: string; orderedInstanceIds: string[] }) =>
      reorderFn({ data: { clientId, date: args.date, orderedInstanceIds: args.orderedInstanceIds } }),
    onSuccess: () => {
      for (const key of scheduleQueryKeys(clientId)) {
        void queryClient.invalidateQueries({ queryKey: key, refetchType: "active" });
      }
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not reorder."),
  });

  if (isLoading || !data) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…</div>;
  }
  const { client, blocks, weeks, days, completions, scheduledInstances } = data as any;

  const handleMove = (
    target: { dayId: string; instanceId: string | null },
    targetDate: Date,
  ) => {
    // Calendar drag/drop is the fast path: exact scheduled instances move
    // optimistically through the same canonical hook as MoveWorkoutSheet.
    // Legacy program-day cards retain the existing sheet flow.
    if (target.instanceId) {
      const instance = (scheduledInstances as any[])?.find((row) => row.id === target.instanceId);
      const completion = (completions as any[])?.find(
        (row) => row.scheduled_workout_id === target.instanceId,
      );
      if (instance && !completion?.completed_at) {
        optimisticMove.mutate({
          target: {
            scheduledWorkoutId: target.instanceId,
            dayId: target.dayId,
            fromDate: instance.scheduled_date,
          },
          newDate: format(targetDate, "yyyy-MM-dd"),
        });
        return;
      }
    }
    setMoveDayId(target.dayId);
    setMoveInstanceId(target.instanceId);
    setMoveInitialDate(targetDate);
  };
  const handleSelectDay = (target: { dayId: string; instanceId: string | null }) => {
    setMoveDayId(target.dayId);
    setMoveInstanceId(target.instanceId);
    setMoveInitialDate(null);
  };

  const handleReorder = (date: string, orderedInstanceIds: string[]) => {
    reorderMutation.mutate({ date, orderedInstanceIds });
  };

  const sortedWeeks = [...(weeks as any[])].sort((a, b) => a.week_index - b.week_index);
  const coach = mode === "coach";

  return (
    <div className="space-y-6">

      <Card>
        <CardContent className="p-3 sm:p-4">
          {coach ? (
            <div className="mb-3 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <h2 className="text-base font-bold">Schedule</h2>
                  <p className="text-xs text-muted-foreground">
                    {view === "calendar" ? "Drag a workout to move it, or tap it." : "Every workout in the program, by week."}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <Button size="sm" variant="outline" className="h-10 gap-1 px-3" onClick={() => setAddOpen(true)} aria-label="Add a workout">
                    <Plus className="h-4 w-4" /> <span className="hidden sm:inline">Add workout</span>
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="outline" className="h-10 w-10" aria-label="More schedule tools">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        disabled={days.length === 0}
                        onClick={() => { setBulkAnchor(days[0]?.id ?? null); setBulkOpen(true); }}
                      >
                        <ListChecks className="mr-2 h-4 w-4" /> Move several workouts
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => setHistoryOpen(true)}>
                        <HistoryIcon className="mr-2 h-4 w-4" /> Change history
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div className="grid grid-cols-2 rounded-lg border border-border bg-muted/30 p-1" role="tablist" aria-label="Schedule view">
                {([["calendar", "Calendar", CalendarDays], ["list", "Whole program", ListTodo]] as const).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    role="tab"
                    aria-selected={view === key}
                    onClick={() => setView(key)}
                    className={cn(
                      "inline-flex min-h-[36px] items-center justify-center gap-1.5 rounded-md text-xs font-semibold",
                      view === key ? "bg-background shadow-sm" : "text-muted-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" /> {label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex rounded-md border border-border p-0.5" role="tablist" aria-label="Schedule view">
                <Button
                  size="sm"
                  variant={view === "calendar" ? "default" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setView("calendar")}
                >
                  <CalendarDays className="h-3.5 w-3.5 mr-1" /> Calendar
                </Button>
                <Button
                  size="sm"
                  variant={view === "list" ? "default" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setView("list")}
                >
                  <ListTodo className="h-3.5 w-3.5 mr-1" /> Schedule Manager
                </Button>
              </div>
              <div className="text-sm text-muted-foreground">
                {view === "calendar"
                  ? "Drag workouts to reschedule. Tap to pick a date."
                  : "Every workout in the program — schedule or change dates fast."}
              </div>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setBulkAnchor(days[0]?.id ?? null); setBulkOpen(true); }} disabled={days.length === 0}>
                <ListChecks className="h-4 w-4 mr-1" /> Bulk move
              </Button>
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                <HistoryIcon className="h-4 w-4 mr-1" /> History
              </Button>
            </div>
          </div>
          )}

          {view === "calendar" ? (
            <ScheduleCalendar
              days={days}
              weeks={weeks}
              blocks={blocks}
              completions={completions}
              scheduledInstances={scheduledInstances ?? []}
              canEdit
              onMoveDay={handleMove}
              onSelectDay={handleSelectDay}
              onReorder={handleReorder}
            />
          ) : (
            <ScheduleManagerList
              days={days}
              weeks={weeks}
              blocks={blocks}
              completions={completions}
              scheduledInstances={scheduledInstances ?? []}
              canEdit
              onSelectDay={handleSelectDay}
            />
          )}
        </CardContent>
      </Card>

      {!coach && (
      <Card>
        <CardContent className="p-3 sm:p-4 space-y-3">
          <div className="flex items-center gap-2">
            <CalendarRange className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm font-medium">Weekly editor</span>
            <Select value={weeklyWeekId ?? ""} onValueChange={(v) => setWeeklyWeekId(v)}>
              <SelectTrigger className="w-64"><SelectValue placeholder="Pick a week to edit…" /></SelectTrigger>
              <SelectContent>
                {sortedWeeks.map((w) => {
                  const blk = blocks.find((b: any) => b.id === w.block_id);
                  return (
                    <SelectItem key={w.id} value={w.id}>
                      {(blk?.name ?? "Block")} — Week {w.week_index}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {weeklyWeekId && (
            <WeeklyScheduleEditor days={days} weeks={weeks} weekId={weeklyWeekId} scheduledInstances={scheduledInstances ?? []} />
          )}
        </CardContent>
      </Card>
      )}

      <MoveWorkoutSheet
        dayId={moveDayId}
        clientId={clientId}
        scheduledWorkoutId={moveInstanceId}
        coachControls={mode === "coach"}
        open={!!moveDayId}
        onOpenChange={(o) => { if (!o) { setMoveDayId(null); setMoveInstanceId(null); setMoveInitialDate(null); } }}
        initialTargetDate={moveInitialDate}
        viewWorkoutAs={
          mode === "coach"
            ? {
                clientId,
                clientUserId: client?.user_id ?? null,
                clientName: client?.full_name ?? null,
              }
            : null
        }
      />
      <BulkMoveDialog
        open={bulkOpen}
        onOpenChange={setBulkOpen}
        anchorDayId={bulkAnchor}
        ctx={{ days, weeks, blocks, completions, scheduledInstances: scheduledInstances ?? [] }}
      />
      <ScheduleHistoryDrawer clientId={clientId} open={historyOpen} onOpenChange={setHistoryOpen} />
      {coach && (
        <ScheduleWorkoutSheet open={addOpen} onOpenChange={setAddOpen} clientId={clientId} clientName={client?.full_name ?? null} />
      )}
    </div>
  );
}
