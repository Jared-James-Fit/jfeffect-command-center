import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import {
  Dumbbell, BookOpen, CalendarDays, CalendarClock, History, Archive,
  Download, Loader2, Plus, Layers, AlertTriangle, ChevronRight, Pencil,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { listClientBlocks, listClientPreps, getBlockSummary } from "@/lib/pl-programs";
import { deriveBlockStatuses, blockStatusTone, todayISOLocal } from "@/lib/block-status";
import { buildProgramScheduleStatus } from "@/lib/program-schedule-status";
import { AssignProgramDialog } from "@/components/clients/assign-program-dialog";
import { WorkoutArchiveDialog } from "@/components/clients/workout-archive-dialog";
import { ScheduleWorkoutSheet } from "@/components/schedule/ScheduleWorkoutSheet";
import { downloadFullTrainingReportForClient } from "@/lib/workouts/download-full-training-report";
import { cn } from "@/lib/utils";

/**
 * Training Program hub — the single coach/admin entry point for a client's
 * training. Groups the existing tools (Open Program, Edit Program, Schedule
 * Manager, Program History, Workout Archive, Training Report, Schedule
 * Workout) into one Trainerize-style section: current program front and
 * center, schedule status obvious, secondary tools tucked into one row.
 *
 * Additive only: every action here calls the same routes/dialogs the
 * existing scattered buttons use. Nothing is removed from the app.
 */
export function TrainingProgramHub({ clientId, clientName }: { clientId: string; clientName?: string | null }) {
  const today = todayISOLocal();
  const [assignOpen, setAssignOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [reportPending, setReportPending] = useState(false);

  const { data: preps = [], isLoading: prepsLoading } = useQuery({
    queryKey: ["assigned-preps", clientId],
    queryFn: () => listClientPreps(clientId),
  });
  const { data: blocks = [], isLoading: blocksLoading } = useQuery({
    queryKey: ["assigned-blocks", clientId],
    queryFn: () => listClientBlocks(clientId),
  });

  const statusMap = useMemo(() => deriveBlockStatuses(blocks as any[], today), [blocks, today]);
  const liveBlocks = useMemo(
    () => (blocks as any[]).filter((b) => {
      const s = statusMap.get(b.id);
      return s !== "Archived" && s !== "Completed";
    }),
    [blocks, statusMap],
  );
  const activeBlock = liveBlocks.find((b: any) => statusMap.get(b.id) === "Active") ?? null;
  // The block the coach most likely wants to edit: the active one, else the
  // first upcoming/draft block so "Edit Program" never dead-ends.
  const editBlock = activeBlock ?? liveBlocks[0] ?? null;

  const activePrep = useMemo(() => {
    const list = (preps as any[]).filter((p) => p.status === "Active" || p.status === "Planned");
    if (activeBlock?.prep_id) {
      const own = list.find((p) => p.id === activeBlock.prep_id);
      if (own) return own;
    }
    return list[0] ?? null;
  }, [preps, activeBlock]);

  const { data: summary } = useQuery({
    queryKey: ["block-summary", activeBlock?.id],
    queryFn: () => getBlockSummary(activeBlock!.id),
    enabled: !!activeBlock?.id,
  });

  // Schedule stats for the active block: scheduled vs missing dates,
  // and the next upcoming workout. Missing = no scheduled_date in the
  // current or a future week (past unscheduled days don't count).
  const { data: sched } = useQuery({
    queryKey: ["hub-block-schedule", activeBlock?.id, summary?.current_week_index ?? null],
    enabled: !!activeBlock?.id && !!summary,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("pl_days")
        .select("id, scheduled_date, pl_weeks!inner(block_id, week_index)")
        .eq("pl_weeks.block_id", activeBlock!.id);
      if (error) throw error;
      const days = (data ?? []) as any[];
      const currentWk = summary?.current_week_index ?? 1;
      // Canonical schedule = pl_scheduled_workouts instances; the legacy
      // pl_days.scheduled_date is only a fallback for days with no instance.
      // Counting legacy dates alone would disagree with the calendar.
      const dayIds = days.map((d) => d.id as string);
      const instances = dayIds.length
        ? (((await supabase
            .from("pl_scheduled_workouts")
            .select("id, source_day_id, scheduled_date")
            .eq("client_id", clientId)
            .in("source_day_id", dayIds)).data ?? []) as any[])
        : [];
      const statusMap = buildProgramScheduleStatus({ days, instances, completions: [] });
      let scheduled = 0;
      let missing = 0;
      for (const d of days) {
        const st = statusMap.get(d.id);
        if (st?.canonicalDate) scheduled += 1;
        else if ((d.pl_weeks?.week_index ?? 0) >= currentWk) missing += 1;
      }
      const next =
        days
          .map((d) => statusMap.get(d.id)?.canonicalDate)
          .filter((dt): dt is string => !!dt && dt >= today)
          .sort()[0] ?? null;
      return { total: days.length, scheduled, missing, next };
    },
  });

  const downloadReport = async () => {
    setReportPending(true);
    const toastId = toast.loading("Generating training report…");
    try {
      const res = await downloadFullTrainingReportForClient({
        clientId,
        clientDisplayName: clientName ?? null,
      });
      if (!res.ok) {
        toast.error(res.reason, { id: toastId });
        return;
      }
      toast.success("Training report downloaded", { id: toastId });
    } catch (err) {
      console.error("Training report download failed", err);
      toast.error("Could not generate training report.", { id: toastId });
    } finally {
      setReportPending(false);
    }
  };

  const loading = prepsLoading || blocksLoading;
  const hasAnyProgram = liveBlocks.length > 0 || (preps as any[]).some((p) => p.status !== "Archived" && p.status !== "Completed");

  const nextWorkoutLabel = sched?.next
    ? format(parseISO(sched.next), "MMM d")
    : summary
      ? "Not scheduled"
      : null;
  const startLabel = activeBlock?.start_date
    ? format(parseISO(activeBlock.start_date), "MMM d, yyyy")
    : null;
  const weekLabel = summary?.current_week_index
    ? `Week ${summary.current_week_index} of ${summary.weeks.length || activeBlock?.weeks || "?"}`
    : null;

  return (
    <section aria-label="Training Program" className="w-full min-w-0 space-y-4 md:col-span-3">

      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-bold uppercase tracking-widest text-muted-foreground">
          <Dumbbell className="h-4 w-4 text-primary" /> Training Program
        </h2>
        {hasAnyProgram && (
          <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
            <Button size="sm" variant="ghost" className="text-xs">
              All programs <ChevronRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          </Link>
        )}
      </div>

      {loading ? (
        <Card className="border-border bg-card p-6 text-sm text-muted-foreground">Loading training program…</Card>
      ) : !hasAnyProgram ? (
        <Card className="border-border bg-card p-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <div className="text-base font-bold">No active training program</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Create a new program for {clientName ?? "this client"}, or assign an existing template from the Program Library.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
                <Button className="min-h-[44px]">
                  <Plus className="mr-1 h-4 w-4" /> Create Program
                </Button>
              </Link>
              <Button variant="outline" className="min-h-[44px]" onClick={() => setAssignOpen(true)}>
                <Layers className="mr-1 h-4 w-4" /> Assign Existing Program
              </Button>
            </div>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-3">
          {/* Current Program — front and center */}
          <Card className="border-border bg-card p-5 md:col-span-2">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Current Program</div>
                <div className="mt-1 truncate text-lg font-bold">
                  {activePrep?.title ?? activeBlock?.name ?? editBlock?.name ?? "Training Program"}
                </div>
                {activeBlock ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1.5">
                      Active block: <span className="font-semibold text-foreground">{activeBlock.name}</span>
                      <Badge variant="outline" className={cn("text-[10px]", blockStatusTone("Active"))}>Active</Badge>
                    </span>
                    {weekLabel && <span className="font-medium text-foreground">{weekLabel}</span>}
                    {startLabel && <span>Started {startLabel}</span>}
                  </div>
                ) : (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs">
                    <span className="text-muted-foreground">
                      No block is currently active — {liveBlocks.length} block{liveBlocks.length === 1 ? "" : "s"} in progress:
                    </span>
                    {liveBlocks.slice(0, 3).map((b: any) => (
                      <Badge key={b.id} variant="outline" className={cn("text-[10px]", blockStatusTone(statusMap.get(b.id)))}>
                        {b.name} · {statusMap.get(b.id)}
                      </Badge>
                    ))}
                  </div>
                )}
                {activeBlock && (
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                    <span className="inline-flex items-center gap-1 text-muted-foreground">
                      <CalendarDays className="h-3.5 w-3.5" />
                      Next workout: <span className={cn("font-semibold", sched?.next ? "text-foreground" : "text-amber-600 dark:text-amber-400")}>{nextWorkoutLabel}</span>
                    </span>
                    {!!sched && sched.missing > 0 && (
                      <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-600 dark:text-amber-400">
                        <AlertTriangle className="mr-1 h-3 w-3" /> {sched.missing} workout{sched.missing === 1 ? "" : "s"} missing dates
                      </Badge>
                    )}
                  </div>
                )}
              </div>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              <Link to="/admin/client-programs/$clientId" params={{ clientId }}>
                <Button size="sm" className="min-h-[40px]">
                  <BookOpen className="mr-1 h-4 w-4" /> Open Program
                </Button>
              </Link>
              {editBlock && (
                <Link to="/admin/blocks/$blockId" params={{ blockId: editBlock.id }}>
                  <Button size="sm" variant="outline" className="min-h-[40px]">
                    <Pencil className="mr-1 h-4 w-4" /> Edit Program
                  </Button>
                </Link>
              )}
              <Link to="/admin/clients/$id/schedule" params={{ id: clientId }}>
                <Button size="sm" variant="outline" className="min-h-[40px]">
                  <CalendarDays className="mr-1 h-4 w-4" /> View Schedule
                </Button>
              </Link>
            </div>
          </Card>

          {/* Schedule — status at a glance */}
          <Card className="border-border bg-card p-5">
            <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Schedule</div>
            {activeBlock && sched ? (
              <>
                <div className="mt-2 text-sm font-semibold">
                  {sched.scheduled} workout{sched.scheduled === 1 ? "" : "s"} scheduled
                  {sched.missing > 0 && (
                    <span className="text-amber-600 dark:text-amber-400"> · {sched.missing} missing dates</span>
                  )}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {sched.next ? `Next: ${format(parseISO(sched.next), "EEEE, MMM d")}` : "No upcoming workout scheduled"}
                </div>
              </>
            ) : (
              <div className="mt-2 text-sm text-muted-foreground">
                {activeBlock ? "Loading schedule…" : "No active block to schedule."}
              </div>
            )}
            <div className="mt-4 flex flex-col gap-2">
              <Link to="/admin/clients/$id/schedule" params={{ id: clientId }}>
                <Button size="sm" variant={sched && sched.missing > 0 ? "default" : "outline"} className="w-full min-h-[40px]">
                  <CalendarClock className="mr-1 h-4 w-4" />
                  {sched && sched.missing > 0 ? "Fix Schedule" : "Manage Schedule"}
                </Button>
              </Link>
              <Button size="sm" variant="ghost" className="w-full min-h-[40px] text-xs" onClick={() => setScheduleOpen(true)}>
                <Plus className="mr-1 h-3.5 w-3.5" /> Schedule Workout
              </Button>
            </div>
          </Card>
        </div>
      )}

      {/* Program tools — secondary, one compact row */}
      {hasAnyProgram && !loading && (
        <Card className="border-border bg-card/60 p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-1 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Program tools</span>
            <Link to="/admin/client-programs/$clientId/history" params={{ clientId }}>
              <Button size="sm" variant="outline" className="min-h-[40px] text-xs">
                <History className="mr-1 h-3.5 w-3.5" /> Program History
              </Button>
            </Link>
            <Button size="sm" variant="outline" className="min-h-[40px] text-xs" onClick={() => setArchiveOpen(true)}>
              <Archive className="mr-1 h-3.5 w-3.5" /> Workout Archive
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="min-h-[40px] text-xs"
              disabled={reportPending}
              onClick={downloadReport}
            >
              {reportPending ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Download className="mr-1 h-3.5 w-3.5" />}
              Download Training Report
            </Button>
          </div>
        </Card>
      )}

      <AssignProgramDialog open={assignOpen} onOpenChange={setAssignOpen} clientId={clientId} clientName={clientName} />
      <WorkoutArchiveDialog open={archiveOpen} onOpenChange={setArchiveOpen} clientId={clientId} clientName={clientName} />
      <ScheduleWorkoutSheet open={scheduleOpen} onOpenChange={setScheduleOpen} clientId={clientId} clientName={clientName} />
    </section>
  );
}