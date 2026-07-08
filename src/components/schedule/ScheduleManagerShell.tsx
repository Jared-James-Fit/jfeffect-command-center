import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Loader2, History as HistoryIcon, ListChecks, CalendarRange } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { getClientSchedule } from "@/lib/schedule-bulk.functions";
import { reorderScheduledWorkouts } from "@/lib/scheduled-workouts.functions";
import { toast } from "sonner";
import { ScheduleCalendar } from "./ScheduleCalendar";
import { BulkMoveDialog } from "./BulkMoveDialog";
import { MoveWorkoutSheet } from "./MoveWorkoutSheet";
import { ScheduleHistoryDrawer } from "./ScheduleHistoryDrawer";
import { WeeklyScheduleEditor } from "./WeeklyScheduleEditor";
import { CoachOverridePanel } from "./CoachOverridePanel";

export interface ScheduleManagerShellProps {
  clientId: string;
  /** Coach/admin gets the override panel and bypasses lock UI. */
  mode: "client" | "coach";
}

export function ScheduleManagerShell({ clientId, mode }: ScheduleManagerShellProps) {
  const fetchFn = useServerFn(getClientSchedule);
  const reorderFn = useServerFn(reorderScheduledWorkouts);
  const queryClient = useQueryClient();
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

  if (isLoading || !data) {
    return <div className="flex items-center gap-2 text-sm text-muted-foreground p-8"><Loader2 className="h-4 w-4 animate-spin" /> Loading schedule…</div>;
  }
  const { client, blocks, weeks, days, completions, scheduledInstances } = data as any;
  const locked = !!client?.schedule_locked && mode === "client";

  const handleMove = (
    target: { dayId: string; instanceId: string | null },
    targetDate: Date,
  ) => {
    setMoveDayId(target.dayId);
    setMoveInstanceId(target.instanceId);
    setMoveInitialDate(targetDate);
  };
  const handleSelectDay = (target: { dayId: string; instanceId: string | null }) => {
    setMoveDayId(target.dayId);
    setMoveInstanceId(target.instanceId);
    setMoveInitialDate(null);
  };

  const reorderMutation = useMutation({
    mutationFn: async (args: { date: string; orderedInstanceIds: string[] }) =>
      reorderFn({ data: { clientId, date: args.date, orderedInstanceIds: args.orderedInstanceIds } }),
    onSuccess: () => {
      void queryClient.invalidateQueries();
    },
    onError: (e: any) => toast.error(e?.message ?? "Could not reorder."),
  });
  const handleReorder = (date: string, orderedInstanceIds: string[]) => {
    reorderMutation.mutate({ date, orderedInstanceIds });
  };

  const sortedWeeks = [...(weeks as any[])].sort((a, b) => a.week_index - b.week_index);

  return (
    <div className="space-y-6">
      {locked && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Your coach has locked schedule editing on your account. Reach out via messages to make changes.
        </div>
      )}

      <Card>
        <CardContent className="p-3 sm:p-4">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <div className="text-sm text-muted-foreground">
              Drag workouts to reschedule. Tap to pick a date.
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => { setBulkAnchor(days[0]?.id ?? null); setBulkOpen(true); }} disabled={locked || days.length === 0}>
                <ListChecks className="h-4 w-4 mr-1" /> Bulk move
              </Button>
              <Button size="sm" variant="outline" onClick={() => setHistoryOpen(true)}>
                <HistoryIcon className="h-4 w-4 mr-1" /> History
              </Button>
            </div>
          </div>

          <ScheduleCalendar
            days={days}
            weeks={weeks}
            blocks={blocks}
            completions={completions}
            scheduledInstances={scheduledInstances ?? []}
            canEdit={!locked}
            onMoveDay={handleMove}
            onSelectDay={handleSelectDay}
            onReorder={handleReorder}
          />
        </CardContent>
      </Card>

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
          {weeklyWeekId && !locked && (
            <WeeklyScheduleEditor days={days} weeks={weeks} weekId={weeklyWeekId} scheduledInstances={scheduledInstances ?? []} />
          )}
        </CardContent>
      </Card>

      {mode === "coach" && (
        <CoachOverridePanel
          clientId={clientId}
          clientName={client?.full_name ?? "Client"}
          scheduleLocked={!!client?.schedule_locked}
          days={days}
          completions={completions}
        />
      )}

      <MoveWorkoutSheet
        dayId={moveDayId}
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
    </div>
  );
}
