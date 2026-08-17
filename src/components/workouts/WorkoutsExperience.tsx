import { useEffect, useMemo, useState, lazy, Suspense } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addDays, addWeeks, format, isSameDay, isSameMonth, startOfWeek,
  addMonths, startOfMonth, endOfMonth, endOfWeek, eachDayOfInterval,
} from "date-fns";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, ClipboardList,
  History, Loader2, Move, MoreVertical, Play, Pencil, Sun, Activity, Download,
  RotateCcw, MessageSquare, Trophy, ChevronDown,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { getClientWorkouts, getBlockTree } from "@/lib/pl-programs";
import { cleanDayTitle, type WorkoutItem, dayScheduledDate } from "@/lib/workout-today";
import { getWorkoutStatus, type WorkoutStatus } from "@/lib/workout-status";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import { derivePurposeLabels, purposeLabelBadgeClass } from "@/lib/exercise-metadata";
import { pickCurrentBlock } from "@/lib/block-dates";
import { MoveWorkoutSheet } from "@/components/schedule/MoveWorkoutSheet";
import { ScheduleHistoryDrawer } from "@/components/schedule/ScheduleHistoryDrawer";
import { ClientBlockView } from "@/components/client-block-view";
import { WorkoutStatusSheet } from "@/components/workout-status-sheet";
import { CircleDot } from "lucide-react";
import { InlineWorkoutPreview } from "@/components/workout/shared/inline-workout-preview";
import { usePreviewOpen } from "@/lib/preview-open-store";
import { InlineWorkoutEditor } from "@/components/workout/shared/inline-workout-editor";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { WorkoutProgressRing } from "@/components/workout/shared/workout-progress-ring";
import { useWorkoutProgress } from "@/lib/workout-progress";
import { TrainingScheduleCard } from "@/components/training-schedule-card";
import { toast } from "sonner";
import { ClientCardioSection } from "@/components/cardio/ClientCardioSection";
import {
  WorkoutReviewEditor,
  type ReviewInitial,
} from "@/components/workout/shared/workout-review-editor";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
// Lazy: this card pulls recharts (~120KB). Defer it so the main Workouts
// view can render without waiting on the chart bundle.
const TrainingAnalyticsPreviewCard = lazy(() =>
  import("@/components/training-analytics-preview-card").then((m) => ({
    default: m.TrainingAnalyticsPreviewCard,
  })),
);
import { RecoveryPreviewCard } from "@/components/analytics/recovery-preview-card";
import { AtHomeBackupCard } from "@/components/workouts/at-home-backup-card";
import {
  cancelAtHomeBackupSession,
  getAtHomeBackupSessionState,
  removeEmptyAtHomeBackupSession,
} from "@/lib/at-home-backup.functions";
import { AT_HOME_BACKUP_BADGE, isAtHomeBackupClient, isAtHomeBackupSessionBlock } from "@/lib/at-home-backup";

type Mode = "self" | "coach";

export function WorkoutsExperience({
  clientId,
  mode = "self",
  clientName,
}: {
  clientId: string;
  mode?: Mode;
  clientName?: string | null;
}) {
  const { data: client } = useQuery({
    queryKey: ["workouts-experience-client", clientId],
    queryFn: async () =>
      (await supabase.from("clients").select("*").eq("id", clientId).maybeSingle()).data,
  });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["my-workouts", clientId],
    queryFn: () => getClientWorkouts(
      clientId,
      { includeAtHomeBackupSessions: isAtHomeBackupClient(clientId) },
    ) as Promise<WorkoutItem[]>,
  });

  // --- Build a date → item map from scheduled_date (canonical helper). -----
  const dayItems = useMemo(
    () => (items ?? []).filter((it) => it.day?.id) as WorkoutItem[],
    [items],
  );
  // Backup sessions remain visible as additional calendar/history entries, but
  // they never participate in selecting, replacing, or measuring the primary
  // gym program.
  const primaryDayItems = useMemo(
    () => dayItems.filter((it) => !isAtHomeBackupSessionBlock(it.block)),
    [dayItems],
  );
  // Extract committed training days from client for calendar date resolution.
  // ROOT CAUSE FIX 2026-06-26: pass to dayScheduledDate so it uses the client's
  // actual schedule (e.g. Mon/Wed/Fri) when pl_weeks.training_days is not set.
  const committedDays = (client as any)?.committed_training_days ?? null;

  const byDate = useMemo(() => {
    // Multiple workouts can land on the same calendar date (e.g. a
    // reschedule stacks Day 2 onto Day 4's Friday). Group them so no
    // workout is silently dropped from the calendar / selected-day view.
    const map = new Map<string, WorkoutItem[]>();
    for (const it of dayItems) {
      const d = dayScheduledDate(it, committedDays);
      if (!d) continue;
      const key = toLocalISO(d);
      const list = map.get(key) ?? [];
      list.push(it);
      map.set(key, list);
    }
    return map;
  }, [dayItems, committedDays]);

  // Fetch priority-labelled rows for every visible scheduled day so the
  // month/week grids can render compact priority chips. Only pulls the
  // metadata columns needed to derive labels.
  const dayIds = useMemo(
    () => dayItems.map((it) => it.day?.id).filter(Boolean) as string[],
    [dayItems],
  );
  const { data: priorityRows = [] } = useQuery({
    queryKey: ["workouts-priority-rows", clientId, dayIds.length],
    enabled: dayIds.length > 0,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_exercise_rows")
        .select("day_id, sort_order, purpose_label, movement_family, card_color, exercise_id, exercises(competition_lift_type, is_competition_lift, exercise_category)")
        .in("day_id", dayIds)
        .order("sort_order");
      return (data ?? []) as any[];
    },
  });

  const priorityChipsByDate = useMemo(() => {
    const rowsByDay = new Map<string, any[]>();
    for (const r of priorityRows) {
      const list = rowsByDay.get(r.day_id) ?? [];
      list.push(r);
      rowsByDay.set(r.day_id, list);
    }
    const FAMILY: Record<string, string> = {
      squat: "Squat", bench: "Bench", deadlift: "Deadlift",
      upper: "Upper", lower: "Lower", other: "Other",
    };
    const out = new Map<string, Array<{ label: string; family: string }>>();
    for (const it of dayItems) {
      const id = it.day?.id;
      if (!id) continue;
      const rows = rowsByDay.get(id) ?? [];
      if (!rows.length) continue;
      const labels = derivePurposeLabels(rows, (r: any) => r.exercises ?? null);
      const chips: Array<{ label: string; family: string }> = [];
      rows.forEach((r: any, i: number) => {
        const label = labels[i];
        if (!label || label === "Assistance") return;
        const famRaw = (r.movement_family as string | null) ?? r.exercises?.competition_lift_type ?? "";
        chips.push({ label, family: FAMILY[String(famRaw).toLowerCase()] ?? "" });
      });
      if (!chips.length) continue;
      const d = dayScheduledDate(it, committedDays);
      if (!d) continue;
      out.set(toLocalISO(d), chips);
    }
    return out;
  }, [priorityRows, dayItems, committedDays]);

  // --- Current block / week label for the header subtitle. -----------------
  const today = localStartOfToday();
  const todayItems = byDate.get(toLocalISO(today)) ?? [];
  const todayPrimaryItems = todayItems.filter((it) => !isAtHomeBackupSessionBlock(it.block));
  const todayItem = todayPrimaryItems[0] ?? null;
  // Collect unique blocks across scheduled days and pick the current one
  // by date range (with sort_order / earliest-start tiebreakers). Falls back
  // to today's item or the most recent scheduled item if no block covers today.
  const allBlocks = useMemo(() => {
    const seen = new Map<string, any>();
    for (const it of primaryDayItems) {
      if (it.block?.id && !seen.has(it.block.id)) seen.set(it.block.id, it.block);
    }
    return [...seen.values()];
  }, [primaryDayItems]);
  const headerBlock =
    pickCurrentBlock(allBlocks, today) ??
    todayItem?.block ??
    primaryDayItems.find((it) => {
      const d = dayScheduledDate(it, committedDays);
      return d && d >= today;
    })?.block ??
    primaryDayItems[primaryDayItems.length - 1]?.block ?? null;
  const headerWeek =
    todayItem?.week ??
    primaryDayItems.find((it) => it.block?.id === headerBlock?.id && (() => {
      const d = dayScheduledDate(it, committedDays); return d && d >= today;
    })())?.week ?? null;
  const subtitle = [
    headerBlock?.name ? headerBlock.name : null,
    headerWeek?.week_index ? `Week ${headerWeek.week_index}` : null,
  ].filter(Boolean).join(" · ");


  // --- Selected date drives the calendar tab. Defaults to today. ----------
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [calView, setCalView] = useState<"week" | "month">("week");
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const navigate = useNavigate();

  const handleDownloadPdf = async () => {
    setDownloadingPdf(true);
    try {
      // Pull every client-visible block, then their weeks/days/exercises,
      // completions, and every logged set — so the report includes both
      // the prescribed program and everything the athlete actually did.
      const { data: blocks } = await supabase
        .from("pl_blocks")
        .select("*")
        .eq("client_id", clientId)
        .eq("client_visible", true)
        .neq("status", "Archived")
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });

      const blockRows = (blocks ?? []) as any[];
      if (!blockRows.length) {
        toast.error("No blocks to download yet.");
        return;
      }

      const trees = await Promise.all(
        blockRows.map(async (b) => ({ block: b, tree: await getBlockTree(b.id) })),
      );

      const allDayIds: string[] = [];
      const allRowIds: string[] = [];
      for (const { tree } of trees) {
        for (const d of tree?.days ?? []) allDayIds.push(d.id);
        for (const r of tree?.rows ?? []) allRowIds.push(r.id);
      }

      const [completionsRes, resultsRes] = await Promise.all([
        allDayIds.length
          ? supabase
              .from("pl_day_completions")
              .select("day_id, started_at, in_progress_at, completed_at, client_notes, actual_duration_min, logging_percentage, logged_sets_count")
              .in("day_id", allDayIds)
              .eq("client_id", clientId)
          : Promise.resolve({ data: [] as any[] }),
        allRowIds.length
          ? supabase
              .from("pl_row_results")
              .select(
                "row_id, set_index, actual_reps, actual_load, actual_load_lb, actual_load_kg, actual_load_unit, entered_value, entered_unit, normalized_lb, normalized_kg, actual_rpe, actual_rpe_num, actual_rir, completed_duration_seconds, notes",
              )
              .in("row_id", allRowIds)
              .eq("client_id", clientId)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      if ((completionsRes as any).error) throw (completionsRes as any).error;
      if ((resultsRes as any).error) throw (resultsRes as any).error;
      // Client-authored exercise notes for every day in the report.
      const notesRes: any = allDayIds.length
        ? await supabase
            .from("pl_exercise_notes")
            .select("day_id, row_id, exercise_name, content, status, created_at, updated_at")
            .in("day_id", allDayIds)
            .eq("client_id", clientId)
            .order("updated_at", { ascending: true })
        : { data: [] as any[] };
      if (notesRes?.error) throw notesRes.error;
      const notesByDay = new Map<string, any[]>();
      for (const n of (notesRes.data ?? []) as any[]) {
        const list = notesByDay.get(n.day_id) ?? [];
        list.push(n);
        notesByDay.set(n.day_id, list);
      }
      const completionByDay = new Map<string, any>();
      for (const c of (completionsRes.data ?? []) as any[]) {
        // If there are somehow multiple, prefer the completed one.
        const prev = completionByDay.get(c.day_id);
        if (!prev || (c.completed_at && !prev.completed_at)) {
          completionByDay.set(c.day_id, c);
        }
      }
      const resultsByRow = new Map<string, any[]>();
      for (const r of (resultsRes.data ?? []) as any[]) {
        const list = resultsByRow.get(r.row_id) ?? [];
        list.push(r);
        resultsByRow.set(r.row_id, list);
      }

      const { downloadFullTrainingReportPdf } = await import(
        "@/lib/workouts/workout-pdf"
      );
      const clientDisplayName =
        clientName ||
        [(client as any)?.first_name, (client as any)?.last_name]
          .filter(Boolean)
          .join(" ") ||
        (client as any)?.full_name ||
        null;

      downloadFullTrainingReportPdf({
        client_name: clientDisplayName,
        generated_at: new Date(),
        blocks: trees.map(({ block, tree }) => {
          const weeksSorted = (tree?.weeks ?? [])
            .slice()
            .sort((a: any, b: any) => (a.week_index ?? 0) - (b.week_index ?? 0));
          const daysByWeek = new Map<string, any[]>();
          for (const d of tree?.days ?? []) {
            const list = daysByWeek.get(d.week_id) ?? [];
            list.push(d);
            daysByWeek.set(d.week_id, list);
          }
          const rowsByDay = new Map<string, any[]>();
          for (const r of tree?.rows ?? []) {
            const list = rowsByDay.get(r.day_id) ?? [];
            list.push(r);
            rowsByDay.set(r.day_id, list);
          }
          return {
            block_name: block?.name ?? null,
            block_status: block?.status ?? null,
            block_start: block?.start_date ?? null,
            block_end: block?.end_date ?? null,
            weeks: weeksSorted.map((w: any) => ({
              id: w.id,
              week_index: w.week_index,
              notes: w.notes ?? null,
              days: (daysByWeek.get(w.id) ?? [])
                .slice()
                .sort((a: any, b: any) => (a.day_index ?? 0) - (b.day_index ?? 0))
                .map((d: any) => {
                  const c = completionByDay.get(d.id);
                  return {
                    id: d.id,
                    day_index: d.day_index,
                    title: cleanDayTitle(d.title) ?? d.title ?? null,
                    notes: d.notes ?? null,
                    notes_client_visible: d.notes_client_visible ?? null,
                    scheduled_date: d.scheduled_date ?? null,
                    started_at: c?.started_at ?? null,
                    in_progress_at: c?.in_progress_at ?? null,
                    completed_at: c?.completed_at ?? null,
                    completion_note: c?.client_notes ?? null,
                    rows: (rowsByDay.get(d.id) ?? []).map((r: any) => ({
                      ...r,
                      logged_sets: resultsByRow.get(r.id) ?? [],
                    })),
                    client_exercise_notes: notesByDay.get(d.id) ?? [],
                  };
                }),
            })),
          };
        }),
      });
    } catch (err) {
      console.error("Workout PDF download failed", err);
      toast.error("Could not generate workout PDF. Please try again.");
    } finally {
      setDownloadingPdf(false);
    }
  };

  return (
    <>
      <PageHeader
        title={mode === "coach" ? `${clientName ?? "Client"} — Workouts` : "Workouts"}
        subtitle={subtitle || undefined}
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              onClick={handleDownloadPdf}
              disabled={downloadingPdf}
              aria-label="Download complete training report as PDF (all blocks + logged data)"
              title="Download complete training report (all blocks + logged workouts)"
            >
              {downloadingPdf ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              <span className="hidden sm:inline">PDF</span>
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              onClick={() => setSelectedDate(localStartOfToday())}
            >
              <Sun className="h-3.5 w-3.5" /> Today
            </Button>
            <Button asChild size="sm" variant="outline" className="h-8 gap-1">
              <Link
                to={(mode === "coach" ? "/admin/clients/$id/schedule" : "/portal/schedule") as any}
                params={mode === "coach" ? ({ id: clientId } as any) : (undefined as any)}
                aria-label="Open full calendar"
              >
                <CalendarIcon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">Calendar</span>
              </Link>
            </Button>
            {mode === "self" && (
              <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                <Link to={"/portal/workouts/analytics" as any} aria-label="Open training analytics">
                  <Activity className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Analytics</span>
                </Link>
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="More actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>
                  <History className="mr-2 h-4 w-4" /> Schedule history
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() =>
                    navigate({
                      to: (mode === "coach" ? "/admin/clients/$id/schedule" : "/portal/schedule") as any,
                      params: mode === "coach" ? ({ id: clientId } as any) : (undefined as any),
                    } as any)
                  }
                >
                  <ClipboardList className="mr-2 h-4 w-4" /> Manage schedule
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onSelect={() =>
                    navigate({ to: "/portal/workouts/analytics" as any } as any)
                  }
                >
                  <Activity className="mr-2 h-4 w-4" /> Training analytics
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="space-y-4 p-4 pb-32 md:p-6">

        {client && (
          <TrainingScheduleCard
            client={client as any}
            editable={mode === "self"}
            compact
          />
        )}

        <Tabs defaultValue="calendar" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-flex">
            <TabsTrigger value="calendar" className="gap-1">
              <CalendarIcon className="h-3.5 w-3.5" /> Calendar
            </TabsTrigger>
            <TabsTrigger value="block" className="gap-1">
              <ClipboardList className="h-3.5 w-3.5" /> Block View
            </TabsTrigger>
          </TabsList>

          <TabsContent value="calendar" className="space-y-4">
            {isLoading ? (
              <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading your schedule…
              </Card>
            ) : dayItems.length === 0 ? (
              <EmptyState />
            ) : (
              <>
                <div className="flex items-center justify-end">
                  <div className="inline-flex rounded-md border bg-card p-0.5 text-xs">
                    <button
                      type="button"
                      onClick={() => setCalView("week")}
                      className={cn(
                        "rounded px-2.5 py-1 font-bold uppercase tracking-wider",
                        calView === "week" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
                      )}
                      aria-pressed={calView === "week"}
                    >
                      Week
                    </button>
                    <button
                      type="button"
                      onClick={() => setCalView("month")}
                      className={cn(
                        "rounded px-2.5 py-1 font-bold uppercase tracking-wider",
                        calView === "month" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-secondary",
                      )}
                      aria-pressed={calView === "month"}
                    >
                      Month
                    </button>
                  </div>
                </div>
                {calView === "week" ? (
                  <WeekStrip
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    byDate={byDate}
                  />
                ) : (
                  <MonthGrid
                    selectedDate={selectedDate}
                    onSelectDate={setSelectedDate}
                    byDate={byDate}
                    chipsByDate={priorityChipsByDate}
                  />
                )}
                <SelectedDayList
                  items={byDate.get(toLocalISO(selectedDate)) ?? []}
                  date={selectedDate}
                  readonly={mode === "coach"}
                  clientId={clientId}
                  mode={mode}
                  backupEnabled={isAtHomeBackupClient(clientId)}
                />
              </>
            )}
          </TabsContent>

          <TabsContent value="block" className="space-y-3">
            {isLoading ? (
              <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading program…
              </Card>
            ) : (
              <BlockViewTab items={primaryDayItems} clientId={clientId} mode={mode} />
            )}
          </TabsContent>
        </Tabs>

        {mode === "self" && (
          <>
            <ClientCardioSection
              clientId={clientId}
              hideWhenEmpty
              // Cardio is resolved by the selected calendar date via
              // resolveClientWeekDays — pass selectedDate so tapping a
              // different day updates the cardio target/label. dayContext is
              // only a fallback hint for empty-state copy.
              dayContext={
                (byDate.get(toLocalISO(selectedDate))?.length ?? 0) > 0 ? "training" : "rest"
              }
              date={selectedDate}
            />
            <RecoveryPreviewCard
              clientId={clientId}
              analyticsTo={"/portal/workouts/analytics"}
            />
            <DeferredAnalytics clientId={clientId} />
          </>
        )}
      </div>

      <ScheduleHistoryDrawer
        clientId={clientId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
    </>
  );
}

/* ---------------------------------------------------------------------- */
/* Deferred analytics — only mounts when scrolled near viewport, so the   */
/* recharts bundle + data query never block the initial workouts paint.   */
/* ---------------------------------------------------------------------- */

function DeferredAnalytics({ clientId }: { clientId: string }) {
  // Render the analytics card immediately alongside the rest of the page so
  // sections appear together instead of popping in one-by-one on scroll.
  return (
    <div className="min-h-[220px]">
      <Suspense
        fallback={
          <Card className="h-[220px] animate-pulse bg-muted/30" aria-hidden />
        }
      >
        <TrainingAnalyticsPreviewCard clientId={clientId} />
      </Suspense>
    </div>
  );
}


/* ---------------------------------------------------------------------- */
/* Week strip                                                             */
/* ---------------------------------------------------------------------- */

function statusDotClass(status: WorkoutStatus | "none"): string {
  switch (status) {
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day":
      return "bg-emerald-500";
    case "today": return "bg-primary";
    case "in_progress": return "bg-amber-500";
    case "missed": return "bg-rose-500";
    case "upcoming": return "bg-muted-foreground/60";
    case "available":
    case "not_started":
      return "bg-muted-foreground/40";
    default: return "bg-transparent";
  }
}

function WeekStrip({
  selectedDate, onSelectDate, byDate,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem[]>;
}) {
  // Week the selected date belongs to. Mon-first to match existing schedule UI.
  const weekStart = startOfWeek(selectedDate, { weekStartsOn: 1 });
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const today = localStartOfToday();
  return (
    <Card className="p-2">
      <div className="mb-1 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, -1))}
          aria-label="Previous week"
          className="rounded p-1 hover:bg-secondary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-xs font-semibold text-muted-foreground">
          {format(weekStart, isSameMonth(weekStart, days[6]) ? "MMMM yyyy" : "MMM d")}
          {!isSameMonth(weekStart, days[6]) && ` – ${format(days[6], "MMM d")}`}
        </div>
        <button
          type="button"
          onClick={() => onSelectDate(addWeeks(selectedDate, 1))}
          aria-label="Next week"
          className="rounded p-1 hover:bg-secondary"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const iso = toLocalISO(d);
          const list = byDate.get(iso) ?? [];
          const item = list[0];
          const extra = Math.max(0, list.length - 1);
          const status: WorkoutStatus | "none" = item
            ? getWorkoutStatus(item).status
            : "none";
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selectedDate);
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(d)}
              className={cn(
                "flex flex-col items-center justify-between rounded-lg px-1 py-2 text-center transition",
                "min-h-[64px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "bg-primary text-primary-foreground"
                  : isToday
                    ? "border border-primary/60 bg-primary/10"
                    : "hover:bg-secondary",
              )}
              aria-pressed={isSelected}
              aria-label={`${format(d, "EEEE MMMM d")}${item ? `, ${getWorkoutStatus(item).label}${extra ? ` (+${extra} more)` : ""}` : ", rest day"}`}
            >
              <span className={cn(
                "text-[10px] font-bold uppercase tracking-wider",
                isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
              )}>
                {format(d, "EEE")}
              </span>
              <span className={cn(
                "text-base font-black",
                isSelected ? "" : isToday ? "text-primary" : "",
              )}>
                {format(d, "d")}
              </span>
              <span className={cn("mt-0.5 h-1.5 w-1.5 rounded-full", statusDotClass(status))} />
              {extra > 0 && (
                <span className={cn(
                  "text-[9px] font-bold leading-none",
                  isSelected ? "text-primary-foreground/80" : "text-muted-foreground",
                )}>+{extra}</span>
              )}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Selected day card — single primary CTA                                 */
/* ---------------------------------------------------------------------- */

function MonthGrid({
  selectedDate, onSelectDate, byDate, chipsByDate,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem[]>;
  chipsByDate?: Map<string, Array<{ label: string; family: string }>>;
}) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = localStartOfToday();
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    <Card className="p-3">
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onSelectDate(addMonths(selectedDate, -1))}
          aria-label="Previous month"
          className="rounded p-1 hover:bg-secondary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="text-sm font-bold">
          {format(monthStart, "MMMM yyyy")}
        </div>
        <button
          type="button"
          onClick={() => onSelectDate(addMonths(selectedDate, 1))}
          aria-label="Next month"
          className="rounded p-1 hover:bg-secondary"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 px-1 pb-1 text-center text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {weekdayLabels.map((d) => (<div key={d}>{d}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const iso = toLocalISO(d);
          const list = byDate.get(iso) ?? [];
          const item = list[0];
          const extraCount = Math.max(0, list.length - 1);
          const status: WorkoutStatus | "none" = item
            ? getWorkoutStatus(item).status
            : "none";
          const inMonth = isSameMonth(d, monthStart);
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selectedDate);
          const title = item ? cleanDayTitle(item.day?.title, item.day?.day_index) : null;
          return (
            <button
              key={iso}
              type="button"
              onClick={() => onSelectDate(d)}
              className={cn(
                "flex min-h-[64px] flex-col items-stretch rounded-lg border p-1 text-left transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                isSelected
                  ? "border-primary bg-primary/15"
                  : isToday
                    ? "border-primary/60 bg-primary/5"
                    : "border-transparent hover:bg-secondary",
                !inMonth && "opacity-40",
              )}
              aria-pressed={isSelected}
              aria-label={`${format(d, "EEEE MMMM d")}${item ? `, ${getWorkoutStatus(item).label}` : ", rest day"}`}
            >
              <div className="flex items-center justify-between">
                <span className={cn(
                  "text-xs font-black",
                  isToday && !isSelected ? "text-primary" : "",
                )}>
                  {format(d, "d")}
                </span>
                <span className={cn("h-1.5 w-1.5 rounded-full", statusDotClass(status))} />
              </div>
              {title && (
                <span className="mt-1 line-clamp-2 text-[10px] leading-tight text-muted-foreground">
                  {title}{extraCount > 0 ? ` +${extraCount}` : ""}
                </span>
              )}
              {(() => {
                const chips = chipsByDate?.get(iso) ?? [];
                if (!chips.length) return null;
                const shown = chips.slice(0, 2);
                const extra = chips.length - shown.length;
                return (
                  <div className="mt-1 flex flex-wrap gap-0.5">
                    {shown.map((c, i) => (
                      <span
                        key={i}
                        className={cn(
                          "truncate rounded border px-1 text-[9px] font-semibold leading-tight",
                          purposeLabelBadgeClass(c.label),
                        )}
                        title={c.family ? `${c.label} ${c.family}` : c.label}
                      >
                        {c.label[0]}{c.family ? ` ${c.family}` : ""}
                      </span>
                    ))}
                    {extra > 0 && (
                      <span className="truncate rounded border border-muted-foreground/30 bg-muted px-1 text-[9px] font-semibold leading-tight text-muted-foreground">
                        +{extra}
                      </span>
                    )}
                  </div>
                );
              })()}
            </button>
          );
        })}
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------- */
/* Selected day card                                                      */
/* ---------------------------------------------------------------------- */

function SelectedDayList({
  items, date, readonly, clientId, mode, backupEnabled,
}: {
  items: WorkoutItem[];
  date: Date;
  readonly: boolean;
  clientId: string;
  mode: Mode;
  backupEnabled: boolean;
}) {
  // A backup is an optional, secondary session. Primary cards always render
  // first, and the chooser is available only while no backup exists that day.
  const primaryItems = items.filter((item) => !isAtHomeBackupSessionBlock(item.block));
  const backupItems = items.filter((item) => isAtHomeBackupSessionBlock(item.block));
  const card = (item: WorkoutItem, index: number) => (
    <SelectedDayCard
      key={`${item.scheduledWorkoutId ?? "legacy"}:${item.day?.id ?? `idx-${index}`}`}
      item={item}
      date={date}
      readonly={readonly}
      clientId={clientId}
      mode={mode}
    />
  );

  return (
    <div className="space-y-3">
      {primaryItems.length === 0 && backupItems.length === 0 && (
        <SelectedDayCard item={null} date={date} readonly={readonly} clientId={clientId} mode={mode} />
      )}
      {primaryItems.map(card)}
      {backupEnabled && mode === "self" && backupItems.length === 0 && (
        <AtHomeBackupCard
          clientId={clientId}
          date={date}
          readonly={readonly}
          hasPrimaryWorkout={primaryItems.length > 0}
        />
      )}
      {backupItems.map((item, index) => card(item, primaryItems.length + index))}
    </div>
  );
}

function SelectedDayCard({
  item, date, readonly, clientId, mode,
}: {
  item: WorkoutItem | null;
  date: Date;
  readonly: boolean;
  clientId: string;
  mode: Mode;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  // Preview open state is keyed by stable workout identity and lives outside
  // this component so refetches / remounts / navigation can't collapse it.
  const [inlineOpen, , toggleInlineOpen] = usePreviewOpen(
    item?.day?.id,
    item?.scheduledWorkoutId ?? null,
  );
  const [editOpen, setEditOpen] = useState(false);
  // Admin-only "Edit Workout": visible on the coach schedule surface
  // (mode="coach") and inside client POV (admin impersonating a client in
  // the portal, where mode stays "self"). Writes run under the admin's own
  // session, so admin RLS applies.
  const { isImpersonating } = useClientImpersonation();
  const canEditWorkout = mode === "coach" || isImpersonating;
  // Real clients can safely change only the lifecycle state through the
  // existing protected status sheet. Program editing and input reset remain
  // limited to coaches and Client POV.
  const canChangeWorkoutStatus = !readonly && (mode === "self" || canEditWorkout);
  const [moveOpen, setMoveOpen] = useState(false);
  const [statusOpen, setStatusOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [backupAction, setBackupAction] = useState<"remove" | "cancel" | null>(null);
  const qc = useQueryClient();
  const fetchBackupState = useServerFn(getAtHomeBackupSessionState);
  const removeBackup = useServerFn(removeEmptyAtHomeBackupSession);
  const cancelBackup = useServerFn(cancelAtHomeBackupSession);

  const dayId = item?.day?.id;
  const isBackupSession = !!item && isAtHomeBackupSessionBlock(item.block);
  const isRealClient = mode === "self" && !isImpersonating;
  const canManageBackupLifecycle = isBackupSession && isRealClient && !readonly;
  const { data: backupState } = useQuery({
    queryKey: ["at-home-backup-session-state", clientId, dayId],
    enabled: !!dayId && isBackupSession,
    staleTime: 15_000,
    queryFn: () => fetchBackupState({ data: { clientId, dayId: dayId! } }),
  });
  const [backupActionPending, setBackupActionPending] = useState(false);

  const invalidateBackupSurfaces = () => {
    qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
    qc.invalidateQueries({ queryKey: ["at-home-backup-sessions", clientId] });
    qc.invalidateQueries({ queryKey: ["at-home-backup-session-state", clientId, dayId] });
    qc.invalidateQueries({ queryKey: ["workouts-priority-rows", clientId] });
    qc.invalidateQueries({ queryKey: ["scheduled-workouts", clientId] });
    qc.invalidateQueries({ predicate: (q) => {
      const key = q.queryKey?.[0];
      return typeof key === "string" && (
        key.startsWith("training-analytics") ||
        key.startsWith("workout-") ||
        key.startsWith("pl-")
      );
    } });
  };

  const confirmBackupAction = async () => {
    if (!backupAction || !dayId) return;
    setBackupActionPending(true);
    try {
      if (backupAction === "remove") {
        await removeBackup({ data: { clientId, dayId } });
        toast.success("Backup removed");
      } else {
        await cancelBackup({ data: { clientId, dayId } });
        toast.success("Backup cancelled — your logged data was kept");
      }
      invalidateBackupSurfaces();
      setBackupAction(null);
    } catch (error: any) {
      toast.error(error?.message || "Could not update this backup workout");
    } finally {
      setBackupActionPending(false);
    }
  };

  const isCompleted =
    item ? (() => {
      const s = getWorkoutStatus(item).status;
      return s === "completed_today" || s === "completed_on_scheduled" || s === "completed_different_day";
    })() : false;

  const { data: existingReview } = useQuery({
    queryKey: ["pl-workout-feedback", dayId, clientId],
    enabled: !!dayId && !!clientId && isCompleted,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_workout_feedback")
        .select("*")
        .eq("day_id", dayId!)
        .eq("client_id", clientId)
        .maybeSingle();
      return data as any;
    },
  });
  const reviewInitial: ReviewInitial | null = existingReview
    ? {
        overallRating: existingReview.overall_rating ?? null,
        sessionRpe: existingReview.session_rpe ?? null,
        pain: existingReview.pain ?? false,
        painLevel: existingReview.pain_level ?? null,
        painArea: existingReview.pain_area ?? null,
        painNote: existingReview.pain_note ?? null,
        clientNote: existingReview.client_note ?? null,
        strengthFeel: existingReview.strength_feel ?? null,
        fatigueFeel: existingReview.fatigue_feel ?? null,
        hitTarget: existingReview.hit_target ?? null,
        recoveryToday: existingReview.recovery_today ?? null,
        sleepBucket: existingReview.sleep_bucket ?? null,
        sleepNotes: existingReview.sleep_notes ?? null,
        editCount: existingReview.review_edit_count ?? 0,
        submittedAt:
          existingReview.review_submitted_at ?? existingReview.created_at ?? null,
      }
    : null;
  const hasReview = !!reviewInitial?.submittedAt;

  // NOTE: must be called before any early return to preserve hook order
  // across rest days (item === null) and active days.
  const { data: progress } = useWorkoutProgress(item?.day?.id, clientId);

  const handleReset = async () => {
    if (!dayId) return;
    setResetting(true);
    try {
      // 1) Look up the exercise row ids for this workout day so we can scope
      //    the row_results delete (pl_row_results has row_id but no day_id).
      const { data: rows, error: rowsErr } = await supabase
        .from("pl_exercise_rows")
        .select("id")
        .eq("day_id", dayId);
      if (rowsErr) throw rowsErr;
      const rowIds = (rows ?? []).map((r: any) => r.id);

      // 2) Delete this client's logged sets (reps / weight / RPE / set notes
      //    / per-set timer) for the selected day only. Other days, other
      //    clients, and the programming rows themselves are untouched.
      if (rowIds.length) {
        const { error } = await supabase
          .from("pl_row_results")
          .delete()
          .eq("client_id", clientId)
          .in("row_id", rowIds);
        if (error) throw error;
      }

      // 3) Delete the client-authored per-exercise notes for this day.
      //    Coach/admin programming notes live on pl_exercise_rows / pl_days
      //    and are not affected.
      const { error: notesErr } = await supabase
        .from("pl_exercise_notes")
        .delete()
        .eq("client_id", clientId)
        .eq("day_id", dayId);
      if (notesErr) throw notesErr;

      // 4) Delete the post-workout review/feedback (session RPE, pain,
      //    client notes, rating) for this day.
      const { error: fbErr } = await supabase
        .from("pl_workout_feedback")
        .delete()
        .eq("client_id", clientId)
        .eq("day_id", dayId);
      if (fbErr) throw fbErr;

      // 5) Delete the completion row last — this clears completion status,
      //    workout-level notes, and the workout timer/duration, and makes
      //    the day available to log again.
      const { error: complErr } = await supabase
        .from("pl_day_completions")
        .delete()
        .eq("client_id", clientId)
        .eq("day_id", dayId);
      if (complErr) throw complErr;

      // Refresh the workouts schedule, analytics, and per-day caches so the
      // UI immediately reflects the reset state.
      qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
      qc.invalidateQueries({ queryKey: ["workouts-experience-client", clientId] });
      qc.invalidateQueries({ predicate: (q) => {
        const k = q.queryKey?.[0];
        return typeof k === "string" && (
          k.startsWith("pl-") ||
          k.startsWith("workout-") ||
          k.startsWith("training-analytics") ||
          k === "weight-lifted" ||
          k === "day-completion" ||
          k === "workout-feedback"
        );
      } });

      toast.success("Workout inputs reset");
      setResetOpen(false);
    } catch (e: any) {
      console.error("[reset-workout]", e);
      toast.error(e?.message || "Could not reset workout");
    } finally {
      setResetting(false);
    }
  };

  if (!item) {
    return (
      <Card className="p-6 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted">
          <Sun className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="mt-3 text-base font-bold">No lifting workout</div>
        <div className="text-xs text-muted-foreground">
          {format(date, "EEEE, MMMM d")}
        </div>
        <div className="mt-1 text-[11px] text-muted-foreground/80">
          Any prescribed cardio still shows below.
        </div>
      </Card>
    );
  }

  const status = getWorkoutStatus(item);
  const title = cleanDayTitle(item.day?.title, item.day?.day_index);
  const cta = primaryCtaFor(item, status.status);

  return (
    <>
      <Card className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-lg font-black">{title}</div>
              <Badge variant="outline" className={cn("text-[10px]", status.tone)}>{status.label}</Badge>
              {isAtHomeBackupSessionBlock(item.block) && (
                <Badge variant="secondary" className="text-[10px]">{AT_HOME_BACKUP_BADGE}</Badge>
              )}
              {progress && progress.prescribedSets > 0 && (
                <WorkoutProgressRing
                  pct={progress.pct}
                  status={progress.status}
                  size={36}
                />
              )}
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {[
                item.block?.name,
                item.week?.week_index ? `Week ${item.week.week_index}` : null,
                format(date, "EEE MMM d"),
              ].filter(Boolean).join(" · ")}
            </div>
          </div>
          {!readonly && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="h-8 w-8 p-0" aria-label="Workout actions">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {!isCompleted && (
                  <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                    <Move className="mr-2 h-4 w-4" /> Move workout
                  </DropdownMenuItem>
                )}
                {canManageBackupLifecycle && backupState?.lifecycle === "in_progress" && (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/portal/workouts/$dayId"
                      params={{ dayId: item.day.id }}
                      search={{ ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
                    >
                      <Play className="mr-2 h-4 w-4" /> Resume workout
                    </Link>
                  </DropdownMenuItem>
                )}
                {canManageBackupLifecycle && backupState?.lifecycle === "empty" && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      setBackupAction("remove");
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Remove Backup
                  </DropdownMenuItem>
                )}
                {canManageBackupLifecycle && backupState?.lifecycle === "in_progress" && (
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onSelect={(event) => {
                      event.preventDefault();
                      setBackupAction("cancel");
                    }}
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Cancel Backup
                  </DropdownMenuItem>
                )}
                {canChangeWorkoutStatus && (
                  <DropdownMenuItem onSelect={() => setStatusOpen(true)}>
                    <CircleDot className="mr-2 h-4 w-4" /> Change status
                  </DropdownMenuItem>
                )}
                {isCompleted && (
                  <DropdownMenuItem onSelect={() => setReviewOpen(true)}>
                    {hasReview ? (
                      <><MessageSquare className="mr-2 h-4 w-4" /> View workout review</>
                    ) : (
                      <><MessageSquare className="mr-2 h-4 w-4" /> Add workout review</>
                    )}
                  </DropdownMenuItem>
                )}
                {isCompleted && (
                  <DropdownMenuItem asChild>
                    <Link
                      to="/portal/workouts/$dayId"
                      params={{ dayId: item.day.id }}
                      search={{ recap: 1, ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
                    >
                      <Trophy className="mr-2 h-4 w-4" /> View workout recap
                    </Link>
                  </DropdownMenuItem>
                )}
                {canEditWorkout && (
                  <DropdownMenuItem
                    onSelect={(e) => {
                      e.preventDefault();
                      setResetOpen(true);
                    }}
                    className="text-destructive focus:text-destructive"
                  >
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset workout inputs
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild size="lg" className={cn("font-bold", cta.tone)}>
            <Link
              to="/portal/workouts/$dayId"
              params={{ dayId: item.day.id }}
              search={{ ...(cta.search as any), ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
            >
              {cta.icon} {cta.label}
            </Link>
          </Button>
          {canChangeWorkoutStatus && (
            <Button size="sm" variant="outline" onClick={() => setStatusOpen(true)}>
              <CircleDot className="mr-1 h-3.5 w-3.5" /> Change status
            </Button>
          )}
          {cta.secondary && (
            cta.secondary.label === "Reschedule" ? (
              <Button size="sm" variant="outline" onClick={() => setMoveOpen(true)}>
                {cta.secondary.label}
              </Button>
            ) : (
              <Button asChild size="sm" variant="outline">
                <Link
                  to="/portal/workouts/$dayId"
                  params={{ dayId: item.day.id }}
                  search={{ ...(cta.secondary.search as any), ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
                >
                  {cta.secondary.label}
                </Link>
              </Button>
            )
          )}
          {!readonly && status.status !== "completed_today"
            && status.status !== "completed_on_scheduled"
            && status.status !== "completed_different_day"
            && cta.secondary?.label !== "Reschedule"
            && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setMoveOpen(true)}>
                <Move className="mr-1 h-3.5 w-3.5" /> Reschedule
              </Button>
            )}
          <Button
            size="sm"
            variant="ghost"
            className="text-muted-foreground"
            onClick={() => toggleInlineOpen()}
            aria-expanded={inlineOpen}
          >
            <ChevronDown className={cn("mr-1 h-3.5 w-3.5 transition-transform", inlineOpen && "rotate-180")} />
            {inlineOpen ? "Hide Preview" : "Preview Workout"}
          </Button>
          {canEditWorkout && item.day?.id && (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="mr-1 h-3.5 w-3.5" /> Edit Workout
            </Button>
          )}
        </div>
        {inlineOpen && item.day?.id && (
          <div className="mt-3">
            <InlineWorkoutPreview dayId={item.day.id} clientId={clientId} />
          </div>
        )}
      </Card>

      {!readonly && (
        <MoveWorkoutSheet
          dayId={item.day.id}
          open={moveOpen}
          onOpenChange={setMoveOpen}
          currentScheduledDate={date}
          scheduledWorkoutId={item.scheduledWorkoutId ?? null}
        />
      )}

      {!readonly && (
        <WorkoutStatusSheet
          open={statusOpen}
          onOpenChange={setStatusOpen}
          dayId={item.day.id}
          clientId={clientId}
          completion={item.completion as any}
          scheduledWorkoutId={item.scheduledWorkoutId ?? null}
          invalidateKeys={[["workouts-experience-client", clientId]]}
        />
      )}

      <DayPreviewSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        item={item}
        date={date}
      />

      {canEditWorkout && item.day?.id && (
        <InlineWorkoutEditor
          open={editOpen}
          onOpenChange={setEditOpen}
          dayId={item.day.id}
          clientId={clientId}
          blockId={item.block?.id ?? null}
          scheduledDate={date}
          completed={isCompleted}
          loggedSets={progress?.completedSets ?? 0}
        />
      )}

      {isCompleted && (
        <WorkoutReviewEditor
          open={reviewOpen}
          onOpenChange={setReviewOpen}
          ctx={{ kind: "client", dayId: item.day.id, scheduledWorkoutId: item.scheduledWorkoutId ?? null }}
          hasCoach
          initial={reviewInitial}
          onSaved={() =>
            qc.invalidateQueries({ queryKey: ["pl-workout-feedback", item.day.id, clientId] })
          }
        />
      )}

      <AlertDialog open={backupAction !== null} onOpenChange={(open) => !backupActionPending && !open && setBackupAction(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {backupAction === "remove" ? "Remove this backup workout?" : "Cancel this backup workout?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {backupAction === "remove"
                ? "Nothing has been logged yet, so this workout can be removed."
                : "Your logged workout data will be kept, but this workout will no longer be active for today."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={backupActionPending}>
              {backupAction === "remove" ? "Keep Workout" : "Keep Training"}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={backupActionPending}
              onClick={(event) => {
                event.preventDefault();
                void confirmBackupAction();
              }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {backupActionPending ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating…</> : backupAction === "remove" ? "Remove" : "Cancel Workout"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={resetOpen} onOpenChange={(o) => !resetting && setResetOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset workout inputs?</AlertDialogTitle>
            <AlertDialogDescription>
              This will clear the workout data you entered for this day. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={resetting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                void handleReset();
              }}
              disabled={resetting}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {resetting ? (
                <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Resetting…</>
              ) : (
                "Reset"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function primaryCtaFor(item: WorkoutItem, status: WorkoutStatus): {
  label: string;
  tone: string;
  icon?: React.ReactNode;
  search?: Record<string, any>;
  secondary?: { label: string; search?: Record<string, any> };
} {
  const inProgress = !!item.completion && !item.completion?.completed_at;
  const partial = status === "in_progress" || (inProgress && (item.logged_sets_count ?? 0) > 0);
  if (partial) {
    return { label: "Continue Workout", tone: "bg-amber-500 text-black hover:bg-amber-400", icon: <Play className="mr-1 h-4 w-4" /> };
  }
  if (inProgress) {
    return { label: "Continue Workout", tone: "bg-amber-500 text-black hover:bg-amber-400", icon: <Play className="mr-1 h-4 w-4" /> };
  }
  switch (status) {
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day":
      return {
        label: "View Workout",
        tone: "bg-emerald-600 text-white hover:bg-emerald-500",
        icon: <Pencil className="mr-1 h-4 w-4" />,
        search: { edit: 1 },
      };
    case "missed":
      return {
        label: "Continue Workout",
        tone: "bg-primary text-primary-foreground hover:bg-primary/90",
        icon: <Play className="mr-1 h-4 w-4" />,
        secondary: { label: "Reschedule" },
      };
    case "today":
      return {
        label: "Start Workout",
        tone: "bg-primary text-primary-foreground hover:bg-primary/90",
        icon: <Play className="mr-1 h-4 w-4" />,
      };
    case "upcoming":
      return {
        label: "View Workout",
        tone: "bg-primary text-primary-foreground hover:bg-primary/90",
        secondary: { label: "Start Early" },
      };
    default:
      return {
        label: "Start Workout",
        tone: "bg-primary text-primary-foreground hover:bg-primary/90",
      };
  }
}

/* ---------------------------------------------------------------------- */
/* Day preview sheet                                                       */
/* ---------------------------------------------------------------------- */

function DayPreviewSheet({
  open, onOpenChange, item, date,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  item: WorkoutItem;
  date: Date;
}) {
  const title = cleanDayTitle(item.day?.title, item.day?.day_index);
  const status = getWorkoutStatus(item);
  const cta = primaryCtaFor(item, status.status);

  const { data: exercises = [] } = useQuery({
    queryKey: ["day-preview-exercises", item.day?.id, open],
    enabled: open && !!item.day?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_exercise_rows")
        .select("id, exercise_name_override, sort_order, exercises(name)")
        .eq("day_id", item.day.id)
        .order("sort_order", { ascending: true })
        .limit(8);
      return (data ?? []).map((r: any) => ({
        id: r.id,
        name: r.exercise_name_override || r.exercises?.name || "Exercise",
      }));
    },
  });

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="text-left">{title}</SheetTitle>
          <SheetDescription className="text-left">
            {[
              item.block?.name,
              item.week?.week_index ? `Week ${item.week.week_index}` : null,
              `Day ${item.day?.day_index ?? "?"}`,
              format(date, "EEE MMM d"),
            ].filter(Boolean).join(" · ")}
          </SheetDescription>
        </SheetHeader>
        <div className="mt-3">
          <Badge variant="outline" className={cn("text-[10px]", status.tone)}>{status.label}</Badge>
        </div>
        {exercises.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">Main exercises</div>
            <ul className="mt-2 space-y-1 text-sm">
              {exercises.map((e: any) => (
                <li key={e.id} className="truncate">{e.name}</li>
              ))}
            </ul>
          </div>
        )}
        <SheetFooter className="mt-4 sm:justify-start">
          <Button asChild size="lg" className={cn("font-bold", cta.tone)} onClick={() => onOpenChange(false)}>
            <Link
              to="/portal/workouts/$dayId"
              params={{ dayId: item.day.id }}
              search={{ ...(cta.search as any), ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
            >
              {cta.label}
            </Link>
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

/* ---------------------------------------------------------------------- */
/* Block view tab — thin wrapper over existing ClientBlockView            */
/* ---------------------------------------------------------------------- */

function BlockViewTab({
  items, clientId, mode,
}: {
  items: WorkoutItem[]; clientId: string; mode: Mode;
}) {
  // Pull EVERY client-visible block for this client directly, so previous
  // and upcoming blocks appear in the selector even when the current
  // workouts query hasn't materialized items for them (e.g. brand-new
  // upcoming blocks with no completions yet, or completed blocks the
  // client should still be able to review). Falls back to blocks derived
  // from items until the direct query resolves.
  const { data: allBlocks } = useQuery({
    queryKey: ["client-visible-blocks", clientId],
    enabled: !!clientId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("pl_blocks")
        .select("*")
        .eq("client_id", clientId)
        .eq("client_visible", true)
        .neq("status", "Archived")
        .order("start_date", { ascending: true, nullsFirst: false })
        .order("sort_order", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const blocks = useMemo(() => {
    const seen = new Map<string, any>();
    // Seed with the direct query so previous/upcoming blocks are guaranteed
    // to appear even before their day items load.
    for (const b of (allBlocks ?? [])) {
      if (b?.id) seen.set(b.id, b);
    }
    // Merge in anything from items in case a block is visible via items but
    // hasn't come back from the direct fetch yet.
    for (const it of items) {
      if (it.block?.id && !seen.has(it.block.id)) seen.set(it.block.id, it.block);
    }
    return [...seen.values()];
  }, [allBlocks, items]);

  const today = localStartOfToday();
  // Date-range driven (with sort_order / earliest-start tiebreakers) so
  // multi-block templates pick the right "current" block instead of a
  // random Active one.
  const defaultBlock =
    pickCurrentBlock(blocks, today) ?? blocks[blocks.length - 1] ?? null;

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(defaultBlock?.id ?? null);
  useEffect(() => {
    if (!selectedBlockId && defaultBlock?.id) setSelectedBlockId(defaultBlock.id);
  }, [defaultBlock?.id, selectedBlockId]);

  // Week + day selection also needs local state so clicks in
  // ClientBlockView actually change what's rendered. When the block
  // changes, reset the week/day selection so the child falls back to
  // "current week" for the newly-viewed block instead of a stale index
  // that may not exist in that block.
  const [selectedWeekIndex, setSelectedWeekIndex] = useState<number | null>(null);
  const [selectedDayId, setSelectedDayId] = useState<string | null>(null);
  useEffect(() => {
    setSelectedWeekIndex(null);
    setSelectedDayId(null);
  }, [selectedBlockId]);

  const block = blocks.find((b: any) => b.id === selectedBlockId) ?? defaultBlock;
  if (!block) {
    return <EmptyState />;
  }

  return (
    <ClientBlockView
      block={block}
      blocks={blocks}
      selectedBlockId={selectedBlockId}
      onBlockChange={(bid) => setSelectedBlockId(bid)}
      selectedWeekIndex={selectedWeekIndex}
      selectedDayId={selectedDayId}
      onWeekChange={(idx) => {
        setSelectedWeekIndex(idx);
        // Changing the week should also clear the pinned day so the
        // child re-derives the best default (today → first-open → first).
        setSelectedDayId(null);
      }}
      onDayChange={(id) => setSelectedDayId(id)}
      mode={mode === "coach" ? "admin" : "client"}
    />
  );
}

/* ---------------------------------------------------------------------- */
/* Empty state                                                            */
/* ---------------------------------------------------------------------- */

function EmptyState() {
  return (
    <Card className="p-10 text-center">
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
        <ClipboardList className="h-6 w-6 text-muted-foreground" />
      </div>
      <p className="mt-3 text-sm text-muted-foreground">
        No workouts assigned yet. Your coach will publish your block soon.
      </p>
    </Card>
  );
}
