import { useEffect, useMemo, useState, Suspense } from "react";
import { ProgramStartOptions } from "@/components/program-import/program-start-options";
import { lazyWithRetry } from "@/lib/lazy-chunk";
import { displayExerciseName } from "@/lib/exercise-display-name";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  addDays, addWeeks, format, isSameDay, isSameMonth, startOfWeek,
  addMonths, startOfMonth, endOfMonth, endOfWeek, eachDayOfInterval,
} from "date-fns";
import {
  Calendar as CalendarIcon, CalendarCheck, ChevronLeft, ChevronRight, ClipboardList, Clock,
  History, Loader2, Move, MoreVertical, Play, Pencil, Activity, Download,
  RotateCcw, MessageSquare, Trophy, ChevronDown, CircleDot, Check, Archive,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetFooter,
} from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { clientWorkoutsQuery, PAGE_CACHE_MS } from "@/lib/client-workouts-query";
import { useArrivalClass } from "@/hooks/use-arrival";
import { ProgramCardSkeleton, ScheduleSkeleton, WorkoutCardSkeleton } from "@/components/workouts/workouts-skeleton";
import { resolveEstimatedWorkoutMinutes } from "@/lib/workout-estimate";
import { cleanDayTitle, type WorkoutItem } from "@/lib/workout-today";
import { getWorkoutStatus, type WorkoutStatus } from "@/lib/workout-status";
import { localStartOfToday, parseLocalDate, toLocalISO } from "@/lib/today";
import { pickCurrentBlock } from "@/lib/block-dates";
import { MoveWorkoutSheet } from "@/components/schedule/MoveWorkoutSheet";
import { ScheduleHistoryDrawer } from "@/components/schedule/ScheduleHistoryDrawer";
import { TrainingReportSheet } from "@/components/workouts/training-report-sheet";
import { ClientBlockView } from "@/components/client-block-view";
import { WorkoutStatusSheet } from "@/components/workout-status-sheet";
import { WorkoutHistorySheet } from "@/components/workout-history-sheet";
import { InlineWorkoutPreview } from "@/components/workout/shared/inline-workout-preview";
import { usePreviewOpen } from "@/lib/preview-open-store";
import { InlineWorkoutEditor } from "@/components/workout/shared/inline-workout-editor";
import { useClientImpersonation } from "@/lib/client-impersonation";
import { useServiceTier } from "@/lib/service-tier";
import { useWorkoutProgress } from "@/lib/workout-progress";
import { TrainingDaysSheet, TrainingScheduleChip, trainingDaysState } from "@/components/training-schedule-card";
import { toast } from "sonner";
import { useDayCardio } from "@/components/cardio/ClientCardioSection";
import { CardioCompletionCard } from "@/components/cardio/CardioCompletionCard";
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
const TrainingAnalyticsPreviewCard = lazyWithRetry(() =>
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
import { AT_HOME_BACKUP_BADGE, isAtHomeBackupClient, isAtHomeBackupSessionBlock, isPrimaryProgramBlock } from "@/lib/at-home-backup";
import { activeCalendarBlockIds, filterCalendarItemsWithHistory, historicalAnchorDate } from "@/lib/active-calendar";
import { canDragRescheduleItem, moveTargetFromItem, workoutsAlreadyOn, type MoveTarget } from "@/lib/workout-move";
import { useMoveWithUndo } from "@/lib/use-move-workout";
import {
  CalendarDayCell,
  CalendarDndProvider,
  type CalendarDnd,
} from "@/components/workouts/calendar-day-dnd";
import { formatCompactWorkoutLabel } from "@/lib/workout-day-label";
import { SessionDot, WeekStrip } from "@/components/workouts/week-strip";
import { KIND_META, placeLabel, scheduleTitle, useClientSessionItems, type CalendarItem } from "@/lib/calendar-sources";
import { AGENDA_ROW, AgendaRow, FAMILY_ACCENT, startLabel } from "@/components/schedule/agenda";
import { ClientSessionSheet, type ClientSession } from "@/components/schedule/client-session-sheet";
import { compactTimeRange, compareInstants } from "@/lib/schedule-time";
import { WorkoutStatusMark, dayMark, workoutMark, type WorkoutMark } from "@/components/workouts/workout-status-mark";
import { buildWorkoutDateMap } from "@/lib/workout-calendar";
import { ProgramRoadmapCard, programHeading, useClientVisibleBlocks, useProgramRoadmap } from "@/components/workouts/program-roadmap";
import type { ProgramRoadmap } from "@/lib/training-roadmap";
import { ManageProgramSheet } from "@/components/athlete-programs/manage-program-sheet";
import { useProgramHistory, useProgramOrigin } from "@/components/athlete-programs/use-my-program";
import { PausedProgramCard } from "@/components/athlete-programs/program-history";
import { CardMenu, CardMenuItem, CardMenuSeparator } from "@/components/workout-day/card-menu";
import { pausedProgram, programProgressLine } from "@/lib/my-program";

type Mode = "self" | "coach";

/** ?open=<date> values already acted on in this page load (see WorkoutsExperience). */
const handledOpenDates = new Set<string>();

export function WorkoutsExperience({
  clientId,
  mode = "self",
  clientName,
  openDate,
  openDays = false,
  footer,
}: {
  clientId: string;
  mode?: Mode;
  clientName?: string | null;
  /** yyyy-mm-dd: open that day's workout (or show that day when it isn't exactly one). */
  openDate?: string | null;
  /** open the training days editor once the client is known */
  openDays?: boolean;
  /** last in the page's own flow (Past programs), above the tab bar's room, never after it */
  footer?: React.ReactNode;
}) {
  const { data: client, isFetched: clientFetched } = useQuery({
    queryKey: ["workouts-experience-client", clientId],
    queryFn: async () =>
      (await supabase.from("clients").select("*").eq("id", clientId).maybeSingle()).data,
    gcTime: PAGE_CACHE_MS,
  });
  // The program, shared with Home's calendar, Nutrition and the cardio card, and kept
  // on the phone a day: opening Workouts paints from it at once and refreshes behind.
  const { data: rawItems, isLoading, isError: workoutsFailed, refetch: refetchWorkouts } = useQuery(clientWorkoutsQuery(clientId));
  const items = (rawItems ?? []) as WorkoutItem[];
  const arrived = useArrivalClass(isLoading);

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

  // Date → workouts (shared with the coach's messenger workout peek).
  const byDate = useMemo(() => buildWorkoutDateMap(dayItems, committedDays), [dayItems, committedDays]);

  // Sessions and appointments with the coach, on the same calendar as the
  // workouts: clients look for their 1:1 here, so it has to be here (the
  // client's own view only; the same queries as the Calendar page and Home).
  const { items: sessionItems } = useClientSessionItems(mode === "self" ? clientId : null);
  const sessionsByDate = useMemo(() => {
    const m = new Map<string, CalendarItem[]>();
    for (const it of sessionItems) {
      if (/cancel|reschedul/i.test(it.status ?? "")) continue;
      m.set(it.date, [...(m.get(it.date) ?? []), it]);
    }
    for (const list of m.values()) list.sort((a, b) => compareInstants(a.startsAt, b.startsAt));
    return m;
  }, [sessionItems]);
  const sessionDays = useMemo(() => new Set(sessionsByDate.keys()), [sessionsByDate]);
  // Coaching clients book sessions: say where appointments live even on a week with none.
  const { isCoaching, isSelfServe } = useServiceTier();
  const showAppointmentsLink = mode === "self" && isCoaching;


  // --- Selected date drives the calendar tab and header context. ----------
  const today = localStartOfToday();
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const todayItems = byDate.get(toLocalISO(today)) ?? [];
  const todayPrimaryItems = todayItems.filter((it) => !isAtHomeBackupSessionBlock(it.block));
  const todayItem = todayPrimaryItems[0] ?? null;
  const allBlocks = useMemo(() => {
    const seen = new Map<string, any>();
    for (const it of primaryDayItems) {
      if (it.block?.id && !seen.has(it.block.id)) seen.set(it.block.id, it.block);
    }
    return [...seen.values()];
  }, [primaryDayItems]);
  // Where you are in the program (block, week) is said once, on the Program
  // card: the header is just "Workouts" and the strip says dates. A workout
  // from another block than the current one (a week ahead or behind) names
  // its own block on its card.
  const currentBlockId = todayItem?.block?.id ?? pickCurrentBlock(allBlocks, today)?.id ?? null;
  const [historyOpen, setHistoryOpen] = useState(false);
  const [daysOpen, setDaysOpen] = useState(false);
  // ?days=1 (after a program's workouts a week changed): the days editor, once
  useEffect(() => {
    if (openDays && mode === "self" && client) setDaysOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openDays, mode, !!client]);
  const daysState = client ? trainingDaysState(client as any, mode === "self") : null;
  // The athlete's days are in ⋯ once set (the strip already shows them); the
  // chip shows only while they still have to set them, or read-only for a coach.
  const showDaysChip = !!client && (mode === "coach" || !!daysState?.needed);

  // Program roadmap: under the calendar, shared by both tabs. Tapping
  // "Open workouts in Block View" on a block opens it there.
  const { data: visibleBlocks } = useClientVisibleBlocks(clientId);
  // Which program the roadmap shows; null = the current one. Viewing another
  // program is read-only and never touches the schedule.
  const [roadmapProgramId, setRoadmapProgramId] = useState<string | null>(null);
  const roadmap = useProgramRoadmap(clientId, visibleBlocks, {
    programId: roadmapProgramId,
    ownerName: (client as any)?.full_name ?? (client as any)?.first_name ?? null,
  });
  // A JF member's own program (a plan they started, or one they built) is
  // theirs to manage: Manage beside the program's name opens Edit / Training
  // days / Switch / End. A coach's program never offers it.
  const origin = useProgramOrigin(roadmap, visibleBlocks, mode === "self" ? (client as any)?.user_id ?? null : null);
  const canManageProgram = mode === "self" && isSelfServe && origin.owned && !!origin.blockId;
  const [manageOpen, setManageOpen] = useState(false);
  // A JF member with no program yet: the empty state is the page (no Week /
  // Month / Block switch, training-days chip or empty readiness and month cards
  // around a calendar with nothing on it).
  const noProgram = mode === "self" && isSelfServe && !isLoading && dayItems.length === 0;
  // A member's past programs: a paused one is offered back in place of the
  // empty state (Resume), and the ⋯ opens them all (Program history).
  const history = useProgramHistory(mode === "self" && isSelfServe);
  const paused = noProgram ? pausedProgram(history.data, false) : null;

  // One control for the three ways to look at the schedule: this week, the
  // month, or the block's workouts in order.
  const [view, setView] = useState<"week" | "month" | "block">("week");
  const [blockViewId, setBlockViewId] = useState<string | null>(null);

  // ---- Drag & drop rescheduling (pointer + touch) ------------------------
  // dnd-kit PointerSensor (mouse/iPad pointer) + TouchSensor (press-and-hold,
  // so vertical scrolling still works). Reschedule button stays as fallback.
  // Both a client in self mode and an authorized coach/admin viewing one
  // specific client calendar use the same canonical optimistic move path.
  const canReschedule = mode === "self" || mode === "coach";
  const moveWithUndo = useMoveWithUndo(clientId);
  const [drag, setDrag] = useState<{ target: MoveTarget; fromIso: string } | null>(null);
  // A drop on a day that already has a workout opens the move sheet on that
  // day (Swap days by default) instead of stacking the two.
  const [dropAsk, setDropAsk] = useState<{ target: MoveTarget; iso: string } | null>(null);
  // Stable dates: the sheet starts over whenever its start date changes.
  const dropAskDates = useMemo(
    () => ({ to: parseLocalDate(dropAsk?.iso), from: parseLocalDate(dropAsk?.target.fromDate) }),
    [dropAsk],
  );

  const startWorkoutDrag = (item: WorkoutItem, fromIso: string) => {
    if (!canReschedule || !canDragRescheduleItem(item)) return;
    const target = moveTargetFromItem(item, fromIso);
    if (!target) return;
    setDrag({ target, fromIso });
  };
  const endWorkoutDrag = () => setDrag(null);
  const dropWorkoutOnDate = (iso: string) => {
    const active = drag;
    setDrag(null);
    if (!active || active.fromIso === iso) return;
    const taken = workoutsAlreadyOn(byDate.get(iso), active.target).filter(
      (it) => !isAtHomeBackupSessionBlock(it.block),
    );
    if (taken.length > 0) {
      setDropAsk({ target: active.target, iso });
      return;
    }
    moveWithUndo({ target: active.target, newDate: iso });
  };
  const dnd = canReschedule
    ? {
        dragging: !!drag,
        draggingFromIso: drag?.fromIso ?? null,
        canDragItem: (item: WorkoutItem) => canDragRescheduleItem(item),
        onDragStartItem: startWorkoutDrag,
        onDragEndItem: endWorkoutDrag,
        onDropDate: dropWorkoutOnDate,
      }
    : null;
  const [reportOpen, setReportOpen] = useState(false);
  const navigate = useNavigate();

  // Arriving with ?open=<date> (a coach tapping "Open … workout" on a session):
  // once the dates are resolved, show that day and, when it holds exactly one
  // workout, open it the way its card's main button would. Once per page load,
  // so Back from the workout lands on that day instead of reopening it.
  useEffect(() => {
    if (!openDate || !/^\d{4}-\d{2}-\d{2}$/.test(openDate) || isLoading || !clientFetched) return;
    if (handledOpenDates.has(openDate)) return;
    handledOpenDates.add(openDate);
    const [y, m, d] = openDate.split("-").map(Number);
    setSelectedDate(new Date(y, m - 1, d));
    const onDay = (byDate.get(openDate) ?? []).filter((it) => !isAtHomeBackupSessionBlock(it.block));
    if (onDay.length !== 1) return;
    const item = onDay[0];
    const cta = primaryCtaFor(item, getWorkoutStatus(item).status);
    navigate({
      to: "/portal/workouts/$dayId",
      params: { dayId: item.day.id },
      search: { ...(cta.search as any), ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any,
    });
  }, [openDate, isLoading, clientFetched, byDate, navigate]);

  const reportName =
    clientName ||
    [(client as any)?.first_name, (client as any)?.last_name].filter(Boolean).join(" ") ||
    (client as any)?.full_name ||
    null;

  return (
    <>
      <PageHeader
        title={mode === "coach" ? `${clientName ?? "Client"} — Workouts` : "Workouts"}
        // the title and ⋮ on one row, nothing under them: the block and week are
        // the Program card's (the coach's "Name — Workouts" keeps its own row so
        // the name isn't cut). Today lives by the week / month arrows, only once
        // you've moved off today; analytics is the month card's and this ⋮.
        actionsInline={mode === "self"}
        actions={
          <div className="flex items-center gap-1">
            {/* The schedule's three views sit in the header, beside ⋯: a page
                control, not the first thing on the page (the calendar and
                today's workout are). */}
            {mode === "self" && !noProgram && <ScheduleViewSwitch view={view} onChange={setView} compact />}
            {/* A bottom sheet on a phone (within a thumb's reach), a dropdown elsewhere. */}
            <CardMenu
              name="Workouts"
              ariaLabel="More actions"
              description="Workout tools and settings"
              vertical
              align="end"
              buttonClassName="h-9 w-9 p-0"
            >
              {mode === "self" && (
                <CardMenuItem onSelect={() => navigate({ to: "/portal/workouts/analytics" as any })}>
                  <Activity className="mr-2 h-4 w-4" /> Training analytics
                </CardMenuItem>
              )}
              {/* A member's paused, ended and switched programs: resume, start over or remove. */}
              {mode === "self" && isSelfServe && (
                <CardMenuItem onSelect={() => navigate({ to: "/portal/programs/history" as any })} data-testid="menu-program-history">
                  <Archive className="mr-2 h-4 w-4" /> Program history
                  {!!history.data?.length && (
                    <span className="ml-auto pl-3 text-xs tabular-nums text-muted-foreground">{history.data.length}</span>
                  )}
                </CardMenuItem>
              )}
              {/* Coaching clients always have a way to their appointments, even on a week with none. */}
              {showAppointmentsLink && (
                <CardMenuItem
                  onSelect={() =>
                    navigate({ to: "/portal/calendar", search: { date: toLocalISO(selectedDate) } as any })
                  }
                >
                  <CalendarIcon className="mr-2 h-4 w-4" /> Appointments
                </CardMenuItem>
              )}
              {/* The athlete's training days, once set: the same editor the chip opened. */}
              {mode === "self" && daysState?.set && (
                <CardMenuItem onSelect={() => setDaysOpen(true)}>
                  <CalendarCheck className="mr-2 h-4 w-4" /> Training days
                  <span className="ml-auto pl-3 text-xs text-muted-foreground">{daysState.label}</span>
                </CardMenuItem>
              )}
              <CardMenuItem
                onSelect={() =>
                  navigate({
                    to: (mode === "coach" ? "/admin/clients/$id/schedule" : "/portal/schedule") as any,
                    params: mode === "coach" ? ({ id: clientId } as any) : (undefined as any),
                  } as any)
                }
              >
                <Move className="mr-2 h-4 w-4" /> Move several workouts
              </CardMenuItem>
              <CardMenuItem onSelect={() => setHistoryOpen(true)}>
                <History className="mr-2 h-4 w-4" /> Schedule changes
              </CardMenuItem>
              <CardMenuSeparator />
              <CardMenuItem onSelect={() => setReportOpen(true)}>
                <Download className="mr-2 h-4 w-4" />
                Training report (PDF)
              </CardMenuItem>
            </CardMenu>
          </div>
        }
      />

      <div className="space-y-4 p-4 pb-32 md:p-6">

        {/* One control for the schedule: this week, the month, or the block's workouts in order.
            (The Calendar page is for appointments; this is the training schedule.) */}
        {/* A coach's view of a client keeps the switch on its own row (the header holds the client's name). */}
        {mode === "coach" && <ScheduleViewSwitch view={view} onChange={setView} />}

        {/* Training days: only while they still have to be set (or read-only for a coach); the athlete's are in ⋯. */}
        {showDaysChip && !noProgram && <TrainingScheduleChip client={client as any} editable={mode === "self"} className="min-w-0" />}

        {view !== "block" ? (
          <div className="space-y-4">
            {isLoading ? (
              <ScheduleSkeleton />
            ) : workoutsFailed && !rawItems ? (
              <Card className="p-6 text-center" data-workouts-load-failed>
                <div className="text-base font-semibold">Couldn't load your workouts</div>
                <div className="mt-1 text-sm text-muted-foreground">Check your connection and try again.</div>
                <Button variant="outline" className="mt-4" onClick={() => void refetchWorkouts()}>Try again</Button>
              </Card>
            ) : dayItems.length === 0 ? (
              paused ? (
                <PausedProgramCard entry={paused} />
              ) : (
                <EmptyState mode={mode} hasHistory={!!history.data?.length} />
              )
            ) : (
              <div className={cn("space-y-4", arrived)}>
                <CalendarDndProvider dnd={dnd}>
                  {view === "week" ? (
                    <WeekStrip
                      selectedDate={selectedDate}
                      onSelectDate={setSelectedDate}
                      byDate={byDate}
                      dnd={dnd}
                      sessionDays={sessionDays}
                      flat
                    />
                  ) : (
                    <MonthGrid
                      selectedDate={selectedDate}
                      onSelectDate={setSelectedDate}
                      byDate={byDate}
                      dnd={dnd}
                      sessionDays={sessionDays}
                    />
                  )}
                </CalendarDndProvider>
                {dropAsk && (
                  <MoveWorkoutSheet
                    dayId={dropAsk.target.dayId}
                    clientId={clientId}
                    open
                    onOpenChange={(o) => { if (!o) setDropAsk(null); }}
                    initialTargetDate={dropAskDates.to}
                    currentScheduledDate={dropAskDates.from}
                    scheduledWorkoutId={dropAsk.target.scheduledWorkoutId}
                  />
                )}
                {/* No legend under the strip: the dot, ring and check say it, and a day with a
                    session lists it right under its workout. Appointments live in the header's ⋯. */}
                <SelectedDayList
                  next={nextWorkoutAfter(byDate, selectedDate)}
                  onSelectDate={setSelectedDate}
                  items={byDate.get(toLocalISO(selectedDate)) ?? []}
                  pageBlockId={currentBlockId}
                  sessions={sessionsByDate.get(toLocalISO(selectedDate)) ?? []}
                  date={selectedDate}
                  readonly={mode === "coach"}
                  clientId={clientId}
                  mode={mode}
                  backupEnabled={isAtHomeBackupClient(clientId)}
                />
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {isLoading ? (
              <div className="space-y-3" role="status" aria-label="Loading your program">
                <WorkoutCardSkeleton />
                <WorkoutCardSkeleton />
              </div>
            ) : (
              <BlockViewTab
                items={primaryDayItems}
                clientId={clientId}
                mode={mode}
                roadmap={roadmap}
                selectedBlockId={blockViewId}
                onSelectBlock={setBlockViewId}
              />
            )}
          </div>
        )}

        {/* The calendar says what to do today; the Program card says where you are and where it's going. */}
        {isLoading ? (
          <ProgramCardSkeleton />
        ) : (
          <div className={arrived}>
          <ProgramRoadmapCard
            roadmap={roadmap}
            selectedBlockId={view === "block" ? blockViewId ?? roadmap?.currentBlockId ?? null : null}
            onSelectBlock={(id) => {
              setBlockViewId(id);
              setView("block");
              if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
            }}
            coach={mode === "coach"}
            onSelectProgram={setRoadmapProgramId}
            onManage={canManageProgram ? () => setManageOpen(true) : undefined}
            nextProgramTo={mode === "self" && isSelfServe ? "/portal/programs" : undefined}
          />
          </div>
        )}

        {/* How it's going, secondary to the day: readiness and the month in one quiet card,
            each a row that opens its detail. Gone entirely until there's something in it
            (the day's cardio is the day's, up with the workout). */}
        {mode === "self" && !noProgram && (
          <Card className="divide-y divide-border overflow-hidden p-0 empty:hidden" data-workouts-progress>
            <RecoveryPreviewCard
              clientId={clientId}
              analyticsTo={"/portal/workouts/analytics"}
              hideWhenEmpty
              bare
            />
            <DeferredAnalytics clientId={clientId} />
          </Card>
        )}
        {footer}
      </div>

      <ScheduleHistoryDrawer
        clientId={clientId}
        open={historyOpen}
        onOpenChange={setHistoryOpen}
      />
      <TrainingReportSheet
        open={reportOpen}
        onOpenChange={setReportOpen}
        clientId={clientId}
        clientName={reportName}
        audience={mode === "coach" ? "coach" : "client"}
      />
      {mode === "self" && client && (
        <TrainingDaysSheet client={client as any} open={daysOpen} onOpenChange={setDaysOpen} />
      )}
      {canManageProgram && roadmap && (
        <ManageProgramSheet
          open={manageOpen}
          onOpenChange={setManageOpen}
          name={programHeading(roadmap.program)}
          progressLine={programProgressLine({
            programWeek: roadmap.programWeek,
            totalWeeks: roadmap.totalWeeks,
            start: roadmap.start,
            end: roadmap.end,
            today: toLocalISO(today),
          })}
          origin={origin}
        />
      )}
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
    // no reserved height: the card isn't there at all until there's a workout to count
    // (empty:hidden, so an empty wrapper takes no gap in the column either)
    <Suspense fallback={null}>
      <TrainingAnalyticsPreviewCard clientId={clientId} hideWhenEmpty bare />
    </Suspense>
  );
}


/* ---------------------------------------------------------------------- */
/* Week strip                                                             */
/* ---------------------------------------------------------------------- */

export type { CalendarDnd } from "@/components/workouts/calendar-day-dnd";


/* ---------------------------------------------------------------------- */
/* Selected day card — single primary CTA                                 */
/* ---------------------------------------------------------------------- */

function MonthGrid({
  selectedDate, onSelectDate, byDate, dnd, sessionDays,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem[]>;
  dnd?: CalendarDnd;
  sessionDays?: Set<string>;
}) {
  const monthStart = startOfMonth(selectedDate);
  const monthEnd = endOfMonth(selectedDate);
  const gridStart = startOfWeek(monthStart, { weekStartsOn: 1 });
  const gridEnd = endOfWeek(monthEnd, { weekStartsOn: 1 });
  const days = eachDayOfInterval({ start: gridStart, end: gridEnd });
  const today = localStartOfToday();
  const weekdayLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  return (
    // on the page itself, no card around it: the day picked under it is the card
    <div data-month-grid>
      <div className="mb-2 flex items-center justify-between px-1">
        <button
          type="button"
          onClick={() => onSelectDate(addMonths(selectedDate, -1))}
          aria-label="Previous month"
          className="-my-1 grid h-10 w-10 place-items-center rounded-lg hover:bg-secondary"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex items-center gap-1 text-sm font-bold">
          {format(monthStart, "MMMM yyyy")}
          <BackToToday selectedDate={selectedDate} onSelectDate={onSelectDate} />
        </div>
        <button
          type="button"
          onClick={() => onSelectDate(addMonths(selectedDate, 1))}
          aria-label="Next month"
          className="-my-1 grid h-10 w-10 place-items-center rounded-lg hover:bg-secondary"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 px-1 pb-1 text-center text-[11px] font-medium text-muted-foreground">
        {weekdayLabels.map((d) => (<div key={d}>{d}</div>))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {days.map((d) => {
          const iso = toLocalISO(d);
          const list = byDate.get(iso) ?? [];
          const item = list[0];
          const inMonth = isSameMonth(d, monthStart);
          const isToday = isSameDay(d, today);
          const isSelected = isSameDay(d, selectedDate);
          // The workout's name only labels a drag: a cell is the date and its
          // mark, and the day picked shows its workout under the calendar.
          const title = item
            ? formatCompactWorkoutLabel(item.day as any, item.week as any)
              ?? cleanDayTitle(item.day?.title, item.day?.day_index)
            : null;
          return (
            <CalendarDayCell key={iso} iso={iso} item={item} label={title ?? format(d, "MMM d")}>
              {(cellDnd) => (
            <button
              ref={cellDnd.setNodeRef as any}

              type="button"
              onClick={() => onSelectDate(d)}
              {...cellDnd.props}
              className={cn(
                cellDnd.className,
                "flex h-11 flex-col items-center justify-center gap-0.5 rounded-lg border transition",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                // neutral like the week strip: the day picked is a soft fill, today a filled number
                isSelected ? "border-foreground/25 bg-secondary" : "border-transparent hover:bg-secondary/60",
                !inMonth && "opacity-40",
              )}
              aria-pressed={isSelected}
              aria-current={isToday ? "date" : undefined}
              aria-label={`${format(d, "EEEE MMMM d")}${isToday ? " (today)" : ""}${item ? `, ${getWorkoutStatus(item).label}` : ", rest day"}${sessionDays?.has(iso) ? ", session with your coach" : ""}`}
            >
              <span className={cn(
                "grid h-6 min-w-6 place-items-center rounded-full px-1 text-[13px] font-semibold tabular-nums",
                isToday && "bg-foreground text-background",
              )}>
                {format(d, "d")}
              </span>
              <span className="flex h-2.5 items-center gap-0.5">
                {sessionDays?.has(iso) && <SessionDot />}
                <WorkoutStatusMark mark={dayMark(list)} />
              </span>
            </button>
              )}
            </CalendarDayCell>
          );

        })}
      </div>
      <MonthTally days={days.filter((d) => isSameMonth(d, monthStart))} byDate={byDate} />
    </div>
  );
}

/**
 * The month in one line, each count beside its own mark (so it reads as the
 * key too): done, missed, in progress, still ahead. Only what's there.
 */
function MonthTally({ days, byDate }: { days: Date[]; byDate: Map<string, WorkoutItem[]> }) {
  const counts = { done: 0, missed: 0, progress: 0, scheduled: 0 };
  for (const d of days) {
    for (const item of byDate.get(toLocalISO(d)) ?? []) {
      const m = workoutMark(item);
      if (m && m.kind in counts) counts[m.kind as keyof typeof counts] += 1;
    }
  }
  const parts: Array<{ mark: WorkoutMark; text: string }> = [];
  if (counts.done) parts.push({ mark: { kind: "done" }, text: `${counts.done} done` });
  if (counts.missed) parts.push({ mark: { kind: "missed" }, text: `${counts.missed} missed` });
  if (counts.progress) parts.push({ mark: { kind: "progress", pct: 50 }, text: `${counts.progress} not finished` });
  if (counts.scheduled) parts.push({ mark: { kind: "scheduled" }, text: `${counts.scheduled} ahead` });
  if (!parts.length) return null;
  return (
    <div className="mt-2 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 border-t border-border/60 pt-2 text-[12px] text-muted-foreground" data-month-tally>
      {parts.map((p) => (
        <span key={p.text} className="inline-flex items-center gap-1">
          <WorkoutStatusMark mark={p.mark} />
          {p.text}
        </span>
      ))}
    </div>
  );
}

/* ---------------------------------------------------------------------- */
/* Selected day card                                                      */
/* ---------------------------------------------------------------------- */

/**
 * One control for the schedule: this week, the month, or the block's workouts
 * in order (the Calendar page is for appointments). Compact in the athlete's
 * header; a full-width row on a coach's view of a client.
 */
function ScheduleViewSwitch({
  view,
  onChange,
  compact = false,
}: {
  view: "week" | "month" | "block";
  onChange: (v: "week" | "month" | "block") => void;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(compact ? "inline-flex rounded-lg bg-muted p-0.5" : "grid grid-cols-3 rounded-xl bg-muted p-1")}
      role="group"
      aria-label="Schedule view"
      data-testid="workouts-view"
    >
      {(["week", "month", "block"] as const).map((v) => (
        <button
          key={v}
          type="button"
          onClick={() => onChange(v)}
          aria-pressed={view === v}
          className={cn(
            "font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            // a 320pt phone keeps "Workouts" whole beside it
            compact ? "h-9 rounded-md px-2.5 text-[13px] max-[359px]:px-1.5 max-[359px]:text-[12px]" : "h-9 rounded-lg text-sm",
            view === v ? "bg-background text-foreground shadow-sm dark:bg-[oklch(0.34_0.008_280)]" : "text-muted-foreground hover:text-foreground",
          )}
        >
          {v === "week" ? "Week" : v === "month" ? "Month" : "Block"}
        </button>
      ))}
    </div>
  );
}

type NextWorkout = { date: Date; title: string };

/** The first day after `date` with a workout on it (backup sessions aside). */
function nextWorkoutAfter(byDate: Map<string, WorkoutItem[]>, date: Date): NextWorkout | null {
  const from = toLocalISO(date);
  let best: { iso: string; item: WorkoutItem } | null = null;
  for (const [iso, list] of byDate) {
    if (iso <= from || (best && iso >= best.iso)) continue;
    const item = list.find((it) => !isAtHomeBackupSessionBlock(it.block));
    if (item) best = { iso, item };
  }
  if (!best) return null;
  const [y, m, d] = best.iso.split("-").map(Number);
  const title = scheduleTitle({ kind: "workout", title: cleanDayTitle(best.item.day?.title, best.item.day?.day_index) });
  return { date: new Date(y, m - 1, d), title };
}

function SelectedDayList({
  items, sessions = [], date, readonly, clientId, mode, backupEnabled, pageBlockId = null, next = null, onSelectDate,
}: {
  items: WorkoutItem[];
  /** A day with nothing on it: the next workout, one tap to its day. */
  next?: NextWorkout | null;
  onSelectDate?: (d: Date) => void;
  /** The block the page's header names: a card in it doesn't say it again. */
  pageBlockId?: string | null;
  /** That day's sessions / appointments with the coach (client view). */
  sessions?: CalendarItem[];
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
  const dayOff = primaryItems.length === 0 && backupItems.length === 0;
  // The day's cardio plan session. On a training day it's the workout's last exercise
  // (its own row on the workout card); on a day off it's the day's card, logged right here.
  const cardio = useDayCardio(clientId, date);
  const dayCardio = cardio.target && !cardio.inWorkout ? cardio.target : null;
  const dayText = isSameDay(date, localStartOfToday()) ? "Today" : format(date, "EEE, MMM d");
  const nextRow = next && onSelectDate ? <NextWorkoutRow next={next} onSelectDate={onSelectDate} /> : null;
  const card = (item: WorkoutItem, index: number) => (
    <SelectedDayCard
      key={`${item.scheduledWorkoutId ?? "legacy"}:${item.day?.id ?? `idx-${index}`}`}
      item={item}
      date={date}
      readonly={readonly}
      clientId={clientId}
      mode={mode}
      pageBlockId={pageBlockId}
    />
  );

  return (
    <div className="space-y-3">
      {dayOff && (dayCardio ? (
        // a cardio-only day: the cardio is the day's workout, with its one red button
        <CardioCompletionCard
          key={`${dayCardio.id}:${toLocalISO(date)}`}
          target={dayCardio}
          clientId={clientId}
          date={date}
          readonly={readonly}
          emphasis="primary"
          dayLabel={dayText}
          footer={nextRow}
        />
      ) : cardio.isLoading ? (
        <WorkoutCardSkeleton />
      ) : (
        <RestDayCard dayText={dayText} next={next} nextRow={nextRow} />
      ))}
      {primaryItems.map(card)}
      {/* a training day whose workout doesn't hold the plan's cardio: under the workout,
          its Done the secondary button (the workout's Start is the day's red one) */}
      {!dayOff && dayCardio && (
        <CardioCompletionCard
          key={`${dayCardio.id}:${toLocalISO(date)}`}
          target={dayCardio}
          clientId={clientId}
          date={date}
          readonly={readonly}
          emphasis="secondary"
        />
      )}
      {backupEnabled && mode === "self" && backupItems.length === 0 && (
        <AtHomeBackupCard
          clientId={clientId}
          date={date}
          readonly={readonly}
          hasPrimaryWorkout={primaryItems.length > 0}
        />
      )}
      {backupItems.map((item, index) => card(item, primaryItems.length + index))}
      {sessions.length > 0 && <DaySessionsCard sessions={sessions} date={date} clientId={clientId} />}
    </div>
  );
}

/** A day with nothing on it: what it is, then the next workout, one tap to its day. */
function RestDayCard({ dayText, next, nextRow }: { dayText: string; next: NextWorkout | null; nextRow: React.ReactNode }) {
  return (
    <Card className="p-4 md:p-5" data-rest-day>
      <div className="text-lg font-semibold leading-snug">{next ? "Rest day" : "No workout"}</div>
      <div className="mt-1 text-[13px] text-muted-foreground">{dayText}</div>
      {nextRow}
    </Card>
  );
}

function NextWorkoutRow({ next, onSelectDate }: { next: NextWorkout; onSelectDate: (d: Date) => void }) {
  return (
    <button
      type="button"
      onClick={() => onSelectDate(next.date)}
      className="mt-3 flex min-h-11 w-full items-center gap-2 border-t border-border pt-3 text-left"
      data-next-workout
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-muted-foreground">Next workout · {format(next.date, "EEE, MMM d")}</span>
        <span className="block truncate text-[15px] font-semibold">{next.title}</span>
      </span>
      <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
    </button>
  );
}

/**
 * That day's sessions with the coach, under the workout: the same row as on
 * Home (a hairline, time, what and where). Each opens the Calendar on that
 * day, where they can see the details or ask to change it.
 */
function DaySessionsCard({ sessions, date, clientId }: { sessions: CalendarItem[]; date: Date; clientId: string }) {
  const day = toLocalISO(date);
  // A session opens its quick view here (details, Change time, Can't make it); an appointment opens the Calendar.
  const [openSession, setOpenSession] = useState<ClientSession | null>(null);
  return (
    <Card className="px-3.5 pb-1.5 pt-3">
      <div className="mb-1 flex items-center justify-between gap-2 px-0.5">
        <h3 className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
          <CalendarIcon className="h-4 w-4 text-foreground" />
          {sessions.length === 1 ? "Session with your coach" : "Sessions with your coach"}
        </h3>
        <Link to="/portal/calendar" search={{ date: day } as any} className="inline-flex shrink-0 items-center text-xs font-semibold text-muted-foreground hover:text-foreground">
          Calendar <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>
      <ol>
        {sessions.map((it) => {
          const range = it.startsAt ? compactTimeRange(it.startsAt, it.endsAt) : null;
          const row = (
            <AgendaRow
              time={it.startsAt ? startLabel(it.startsAt) : "All day"}
              timed={!!it.startsAt}
              accent={FAMILY_ACCENT.people}
              title={it.title}
              sub={[range, KIND_META[it.kind]?.label, placeLabel(it.location)].filter(Boolean).join(" · ")}
              trailing={it.status === "Completed" ? <span className="shrink-0 text-xs font-semibold text-emerald-500">Done</span> : null}
              chevron
            />
          );
          return (
            <li key={it.id}>
              {it.kind === "pt_session" && it.raw ? (
                <button type="button" onClick={() => setOpenSession(it.raw as ClientSession)} className={AGENDA_ROW}>{row}</button>
              ) : (
                <Link to="/portal/calendar" search={{ date: day } as any} className={AGENDA_ROW}>{row}</Link>
              )}
            </li>
          );
        })}
      </ol>
      <ClientSessionSheet clientId={clientId} session={openSession} onClose={() => setOpenSession(null)} />
    </Card>
  );
}

/**
 * The day card's status without its weekday ("Scheduled Mon" → "Upcoming"):
 * the card is already that day's. A workout done on another day keeps its
 * label ("Completed Tue instead of Mon"), since that's news.
 */
/** Statuses the day line already says ("Today", a date to come): no badge for them. */
const QUIET_DAY_STATUSES: WorkoutStatus[] = ["today", "upcoming", "available", "not_started"];

/** How a status reads on the day card: green done, red missed, amber "finish the review", neutral in progress. */
function dayStatusTone(status: WorkoutStatus): "done" | "missed" | "review" | "progress" | "quiet" {
  switch (status) {
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day":
      return "done";
    case "missed":
      return "missed";
    case "review_pending":
      return "review";
    case "in_progress":
    case "incomplete":
      return "progress";
    default:
      return "quiet";
  }
}

function dayCardStatusLabel(status: string, label: string): string {
  switch (status) {
    case "upcoming": return "Upcoming";
    case "missed": return "Missed";
    case "completed_on_scheduled":
    case "completed_today": return "Done";
    case "in_progress": return "In progress";
    default: return label;
  }
}

function SelectedDayCard({
  item, date, readonly, clientId, mode, pageBlockId = null,
}: {
  item: WorkoutItem | null;
  date: Date;
  readonly: boolean;
  clientId: string;
  mode: Mode;
  /** The block the page's header names (the card names only another block). */
  pageBlockId?: string | null;
}) {
  const navigate = useNavigate();
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
  const [historyOpen, setHistoryOpen] = useState(false);
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

  // Completion is a backend fact; the visual status can still be
  // "review_pending" until the quick post-workout check-out is submitted.
  const isCompleted = !!item?.completion?.completed_at;

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
        reviewVersion: existingReview.review_version ?? null,
        editCount: existingReview.review_edit_count ?? 0,
        submittedAt:
          existingReview.review_submitted_at ?? existingReview.created_at ?? null,
      }
    : null;
  const hasReview = !!reviewInitial?.submittedAt;

  // NOTE: must be called before any early return to preserve hook order
  // across rest days (item === null) and active days.
  // Seeded from the list's own numbers (and its load time), so a card only
  // asks the server when that copy has gone stale.
  const listUpdatedAt = qc.getQueryState(["my-workouts", clientId])?.dataUpdatedAt;
  const { data: progress } = useWorkoutProgress(item?.day?.id, clientId, { progress: item?.progress, updatedAt: listUpdatedAt });

  // Reset = the server's instance-scoped, undoable "Not Started" (see
  // WorkoutStatusSheet / workout_set_status) — never a client-side delete.
  // Always offered: typed-but-unchecked sets and warm-ups don't show up as
  // started/logged, and hiding Reset on a 0% workout made it look missing.
  const canReset = canChangeWorkoutStatus;
  // The card shows one main button (+ Preview); Reschedule, Change status and
  // Edit live in its ⋯ with the rest, once each.
  const canReschedule = !readonly;
  const canEditHere = canEditWorkout && !!item?.day?.id;
  const hasMenuActions = canReschedule || canEditHere || canChangeWorkoutStatus || isCompleted
    || (canManageBackupLifecycle && (backupState?.lifecycle === "in_progress" || backupState?.lifecycle === "empty"));

  if (!item) return null;

  const status = getWorkoutStatus(item);
  const needsReviewToFinish =
    !isCompleted &&
    progress?.prescribedSets != null &&
    progress.prescribedSets > 0 &&
    progress.status === "completed";
  const visibleStatus = needsReviewToFinish
    ? {
        ...status,
        status: "review_pending" as const,
        label: "Review to finish",
        tone: "border-amber-500/40 bg-amber-500/10 text-amber-700 dark:text-amber-300",
      }
    : status;
  // The day is already picked on the strip above and in the line under the
  // title, so the title drops its "Monday — " and the badge its weekday.
  const title = scheduleTitle({ kind: "workout", title: cleanDayTitle(item.day?.title, item.day?.day_index) });
  const badgeLabel = dayCardStatusLabel(visibleStatus.status, visibleStatus.label);
  // Its status only when it's news (done, missed, in progress, review), said in the
  // day line in words: "Today" / "Upcoming" just repeat the day.
  const showBadge = !QUIET_DAY_STATUSES.includes(visibleStatus.status);
  const tone = dayStatusTone(visibleStatus.status);
  // How far through it is, once a set is logged: the sets in words and one thin bar
  // (a 0% ring before the start says nothing; done says Done).
  const showProgress = !!progress && progress.prescribedSets > 0 && progress.completedSets > 0
    && tone === "progress";
  const dayText = isSameDay(date, localStartOfToday()) ? "Today" : format(date, "EEE, MMM d");
  const cta: WorkoutCta = needsReviewToFinish
    ? {
        label: "Finish Review",
        icon: <MessageSquare className="h-4 w-4" />,
        search: { review: 1 },
      }
    : primaryCtaFor(item, status.status);

  return (
    <>
      <Card className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="line-clamp-2 text-lg font-semibold leading-snug">{title}</div>
            {/* The day and how long; the block and week are said once, on the Program card
                (a workout from another block than the current one still names its own). */}
            <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground" data-testid="workout-day-meta">
              {item.block?.id && item.block.id !== pageBlockId && item.block.name && !isAtHomeBackupSessionBlock(item.block) && (
                <span className="font-medium text-foreground/80">{item.block.name} ·</span>
              )}
              <span>{dayText}</span>
              {/* an optional session (a recovery day, an extra easy run): skipping it is never a miss */}
              {item.day?.is_optional && !isCompleted && (
                <>
                  <span aria-hidden>·</span>
                  <span data-testid="workout-optional">Optional</span>
                </>
              )}
              {!isCompleted && (() => {
                const est = ((item as any).estimated_minutes ?? resolveEstimatedWorkoutMinutes({ day: item.day as any, block: item.block as any }));
                // how long only while it's still to do (in progress says its sets; review is the last step)
                return est != null && tone === "quiet" ? (
                  <>
                    <span aria-hidden>·</span>
                    <span className="inline-flex items-center gap-1" data-testid="workout-est-duration">
                      <Clock className="h-3 w-3" /> {est} min
                    </span>
                  </>
                ) : null;
              })()}
              {showBadge && (
                <>
                  <span aria-hidden>·</span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1 font-medium",
                      tone === "done" && "text-success",
                      tone === "missed" && "text-destructive",
                      tone === "review" && "text-amber-600 dark:text-amber-400",
                      (tone === "progress" || tone === "quiet") && "text-foreground/80",
                    )}
                    data-day-status={visibleStatus.status}
                  >
                    {tone === "done" && <Check className="h-3.5 w-3.5" aria-hidden />}
                    {showProgress && progress && tone === "progress"
                      ? `${badgeLabel} · ${progress.completedSets} of ${progress.prescribedSets} sets`
                      : badgeLabel}
                  </span>
                </>
              )}
              {isAtHomeBackupSessionBlock(item.block) && (
                <>
                  <span aria-hidden>·</span>
                  <span className="font-medium text-foreground/80">{AT_HOME_BACKUP_BADGE}</span>
                </>
              )}
            </div>
            {showProgress && progress && (
              <div
                className="mt-2.5 h-1 w-full max-w-[220px] overflow-hidden rounded-full bg-muted"
                role="progressbar"
                aria-valuemin={0}
                aria-valuemax={progress.prescribedSets}
                aria-valuenow={progress.completedSets}
                aria-label={`${progress.completedSets} of ${progress.prescribedSets} sets logged`}
                data-day-progress
              >
                <div className="h-full rounded-full bg-foreground/70" style={{ width: `${Math.min(100, progress.pct)}%` }} />
              </div>
            )}
          </div>
          {hasMenuActions && (!readonly || canEditHere) && (
            <CardMenu
              name={title}
              ariaLabel="Workout actions"
              description="Actions for this workout"
              vertical
              align="end"
              iconClassName="h-5 w-5"
              buttonClassName="-mr-2 -mt-1.5 h-10 w-10 shrink-0 text-muted-foreground"
            >
                {canManageBackupLifecycle && backupState?.lifecycle === "in_progress" && (
                  <CardMenuItem
                    onSelect={() =>
                      navigate({
                        to: "/portal/workouts/$dayId",
                        params: { dayId: item.day.id },
                        search: { ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any,
                      })
                    }
                  >
                    <Play className="mr-2 h-4 w-4" /> Resume workout
                  </CardMenuItem>
                )}
                {canManageBackupLifecycle && backupState?.lifecycle === "empty" && (
                  <CardMenuItem className="text-destructive focus:text-destructive" onSelect={() => setBackupAction("remove")}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Remove Backup
                  </CardMenuItem>
                )}
                {canManageBackupLifecycle && backupState?.lifecycle === "in_progress" && (
                  <CardMenuItem className="text-destructive focus:text-destructive" onSelect={() => setBackupAction("cancel")}>
                    <RotateCcw className="mr-2 h-4 w-4" /> Cancel Backup
                  </CardMenuItem>
                )}
                {canReschedule && (
                  <CardMenuItem onSelect={() => setMoveOpen(true)}>
                    <Move className="mr-2 h-4 w-4" /> Reschedule
                  </CardMenuItem>
                )}
                {canChangeWorkoutStatus && (
                  <CardMenuItem onSelect={() => setStatusOpen(true)}>
                    <CircleDot className="mr-2 h-4 w-4" /> Change status
                  </CardMenuItem>
                )}
                {canEditHere && (
                  <CardMenuItem onSelect={() => setEditOpen(true)}>
                    <Pencil className="mr-2 h-4 w-4" /> Edit workout
                  </CardMenuItem>
                )}
                {isCompleted && !readonly && (
                  <CardMenuItem onSelect={() => setReviewOpen(true)}>
                    <MessageSquare className="mr-2 h-4 w-4" /> {hasReview ? "View workout review" : "Add workout review"}
                  </CardMenuItem>
                )}
                {isCompleted && !readonly && (
                  <CardMenuItem
                    onSelect={() =>
                      navigate({
                        to: "/portal/workouts/$dayId",
                        params: { dayId: item.day.id },
                        search: { recap: 1, ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any,
                      })
                    }
                  >
                    <Trophy className="mr-2 h-4 w-4" /> View workout recap
                  </CardMenuItem>
                )}
                {canChangeWorkoutStatus && (
                  <CardMenuItem onSelect={() => setHistoryOpen(true)}>
                    <History className="mr-2 h-4 w-4" /> Version history
                  </CardMenuItem>
                )}
                {canReset && (
                  <>
                  <CardMenuSeparator />
                  <CardMenuItem onSelect={() => setResetOpen(true)} className="text-destructive focus:text-destructive">
                    <RotateCcw className="mr-2 h-4 w-4" /> Reset workout
                  </CardMenuItem>
                  </>
                )}
            </CardMenu>
          )}
        </div>

        {/* One main button, then Preview (the workout's exercises right here,
            without opening it). Everything else is in the ⋯ above. */}
        <div className="mt-4 flex items-center gap-2">
          <Button asChild size="lg" variant={cta.variant ?? "default"} className="min-w-0 flex-1 px-5 sm:flex-none">
            <Link
              to="/portal/workouts/$dayId"
              params={{ dayId: item.day.id }}
              search={{ ...(cta.search as any), ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
            >
              {cta.icon} {cta.label}
            </Link>
          </Button>
          <Button
            size="lg"
            variant="ghost"
            className="shrink-0 px-3 text-muted-foreground"
            onClick={() => toggleInlineOpen()}
            aria-expanded={inlineOpen}
          >
            <ChevronDown className={cn("h-4 w-4 transition-transform", inlineOpen && "rotate-180")} />
            {inlineOpen ? "Hide preview" : "Preview"}
          </Button>
        </div>
        {/* The day's cardio, its own thing: done before, during or after the
            lifting, or later in the day. One tap opens the workout on it
            (?focus=, never Focus mode), and logging it doesn't start the
            workout (workout-cardio.ts). */}
        {item.cardio && (() => {
          // The day's own read (useWorkoutProgress) wins: it's asked again every
          // few seconds, so a set logged in the logger shows here even while the
          // whole-program list is still the copy from before it.
          const cardioDone = progress?.cardioDone ?? item.cardio.done;
          return (
          <Link
            to="/portal/workouts/$dayId"
            params={{ dayId: item.day.id }}
            search={{ focus: item.cardio.rowId, ...(item.scheduledWorkoutId ? { instance: item.scheduledWorkoutId } : {}) } as any}
            className="mt-3 flex min-h-11 items-center gap-2.5 border-t border-border pt-3 text-sm"
            data-day-cardio={cardioDone ? "done" : "open"}
          >
            <Activity className={cn("h-4 w-4 shrink-0", cardioDone ? "text-success" : "text-muted-foreground")} aria-hidden />
            <span className="min-w-0 flex-1">
              <span className="font-semibold">Cardio</span>
              <span className="text-muted-foreground">
                {item.cardio.minutes ? ` · ${item.cardio.minutes} min` : ""}
                {!cardioDone && date && isSameDay(date, new Date()) ? " · any time today" : ""}
              </span>
            </span>
            {cardioDone ? (
              <span className="inline-flex items-center gap-1 text-xs font-semibold text-success"><Check className="h-3.5 w-3.5" aria-hidden /> Done</span>
            ) : !readonly ? (
              <span className="inline-flex items-center gap-0.5 text-xs font-semibold text-foreground">Log it <ChevronRight className="h-3.5 w-3.5" aria-hidden /></span>
            ) : null}
          </Link>
          );
        })()}
        {inlineOpen && item.day?.id && (
          <div className="mt-3">
            <InlineWorkoutPreview
              dayId={item.day.id}
              clientId={clientId}
              estimatedMinutes={((item as any).estimated_minutes ?? resolveEstimatedWorkoutMinutes({ day: item.day as any, block: item.block as any }))}
            />
          </div>
        )}
      </Card>

      {!readonly && (
        <MoveWorkoutSheet
          dayId={item.day.id}
          clientId={clientId}
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
          loggedSets={item.logged_sets_count ?? progress?.completedSets ?? null}
          showHistoryLink={false}
        />
      )}
      {canChangeWorkoutStatus && (
        <WorkoutHistorySheet
          open={historyOpen}
          onOpenChange={setHistoryOpen}
          dayId={item.day.id}
          clientId={clientId}
          scheduledWorkoutId={item.scheduledWorkoutId ?? null}
          invalidateKeys={[["workouts-experience-client", clientId]]}
        />
      )}
      {canReset && (
        <WorkoutStatusSheet
          mode="reset"
          open={resetOpen}
          onOpenChange={setResetOpen}
          dayId={item.day.id}
          clientId={clientId}
          completion={item.completion as any}
          scheduledWorkoutId={item.scheduledWorkoutId ?? null}
          invalidateKeys={[["workouts-experience-client", clientId]]}
          loggedSets={item.logged_sets_count ?? progress?.completedSets ?? null}
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
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ["pl-workout-feedback", item.day.id, clientId] });
            // Refresh the canonical workout item too so has_feedback flips
            // immediately and the orange "Review pending" state turns green.
            qc.invalidateQueries({ queryKey: ["my-workouts", clientId] });
          }}
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

    </>
  );
}

/**
 * The day card's one main button. Every workout opens the same logger page, so
 * a missed or upcoming workout has one button, never "View" beside "Start"
 * (they went to the same place). Primary (brand) for something to do; a
 * finished workout's View is an outline button, its status says it's done.
 */
type WorkoutCta = {
  label: string;
  icon?: React.ReactNode;
  search?: Record<string, any>;
  variant?: "default" | "outline";
};

function primaryCtaFor(item: WorkoutItem, status: WorkoutStatus): WorkoutCta {
  if (status === "in_progress") {
    return { label: "Continue Workout", icon: <Play className="h-4 w-4" /> };
  }
  switch (status) {
    case "review_pending":
      return {
        label: "Finish Review",
        icon: <MessageSquare className="h-4 w-4" />,
        search: { review: 1 },
      };
    case "incomplete":
      return {
        label: "Finish Workout",
        icon: <Pencil className="h-4 w-4" />,
        search: { edit: 1 },
      };
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day":
      return {
        label: "View Workout",
        variant: "outline",
        search: { edit: 1 },
      };
    case "missed":
      // Missed: training it now is the point, so Start is the main button.
      return {
        label: "Start Workout",
        icon: <Play className="h-4 w-4" />,
      };
    case "today":
      return {
        label: "Start Workout",
        icon: <Play className="h-4 w-4" />,
      };
    case "upcoming":
      return { label: "View Workout" };
    default:
      return { label: "Start Workout" };
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
        name: displayExerciseName(r),
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
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Badge variant="outline" className={cn("text-[10px]", status.tone)}>{status.label}</Badge>
          {(() => {
            const est = ((item as any).estimated_minutes ?? resolveEstimatedWorkoutMinutes({ day: item.day as any, block: item.block as any }));
            return est != null ? (
              <span
                className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground"
                data-testid="workout-est-duration"
              >
                <Clock className="h-3 w-3" /> Estimated duration · {est} min
              </span>
            ) : null;
          })()}
        </div>
        {exercises.length > 0 && (
          <div className="mt-4">
            <div className="text-xs font-medium text-muted-foreground">Main exercises</div>
            <ul className="mt-2 space-y-1 text-sm">
              {exercises.map((e: any) => (
                <li key={e.id} className="truncate">{e.name}</li>
              ))}
            </ul>
          </div>
        )}
        <SheetFooter className="mt-4 sm:justify-start">
          <Button asChild size="lg" variant={cta.variant ?? "default"} onClick={() => onOpenChange(false)}>
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
  items, clientId, mode, roadmap, selectedBlockId, onSelectBlock,
}: {
  items: WorkoutItem[]; clientId: string; mode: Mode;
  roadmap: ProgramRoadmap | null;
  /** null = the current block. Lifted so the program roadmap can open a block here. */
  selectedBlockId: string | null;
  onSelectBlock: (blockId: string) => void;
}) {
  // Pull EVERY client-visible block for this client directly, so previous
  // and upcoming blocks appear in the selector even when the current
  // workouts query hasn't materialized items for them (e.g. brand-new
  // upcoming blocks with no completions yet, or completed blocks the
  // client should still be able to review). Falls back to blocks derived
  // from items until the direct query resolves.
  const { data: allBlocks } = useClientVisibleBlocks(clientId);

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
    // The at-home backup sessions aren't a block of the program (the roadmap
    // leaves them out too), so the picker and "current block" never land on them.
    return [...seen.values()].filter((b) => isPrimaryProgramBlock(b));
  }, [allBlocks, items]);

  const today = localStartOfToday();
  // Date-range driven (with sort_order / earliest-start tiebreakers) so
  // multi-block templates pick the right "current" block instead of a
  // random Active one.
  const defaultBlock =
    pickCurrentBlock(blocks, today) ?? blocks[blocks.length - 1] ?? null;


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
    return <EmptyState mode={mode} />;
  }

  return (
    <ClientBlockView
      block={block}
      blocks={blocks}
      selectedBlockId={block.id}
      onBlockChange={onSelectBlock}
      roadmap={roadmap}
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

function EmptyState({ mode, hasHistory = false }: { mode?: string; hasHistory?: boolean }) {
  if (mode === "self") return <SelfEmptyState hasHistory={hasHistory} />;
  return <CoachedEmptyState />;
}

function CoachedEmptyState() {
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

/** The athlete's own Workouts page: a JF member picks a plan; a coaching client waits on their coach. */
function SelfEmptyState({ hasHistory = false }: { hasHistory?: boolean }) {
  const { isSelfServe } = useServiceTier();
  if (!isSelfServe) return <CoachedEmptyState />;
  return (
    <Card className="p-5 text-center sm:p-8" data-self-empty>
      <div className="mx-auto grid h-12 w-12 place-items-center rounded-full bg-muted">
        <ClipboardList className="h-6 w-6 text-muted-foreground" />
      </div>
      <div className="mt-3 text-base font-semibold">No program yet</div>
      <p className="mx-auto mt-1 max-w-xs text-sm text-muted-foreground">
        Follow one of ours, build your own or bring one you already have. Its workouts land on your training days here.
      </p>
      <ProgramStartOptions className="mx-auto mt-4 max-w-md" />
      {/* a program they ended or switched from can come back where they left off */}
      {hasHistory && (
        <Link
          to={"/portal/programs/history" as any}
          className="mt-4 inline-flex min-h-10 items-center gap-1 text-[14px] font-medium text-muted-foreground hover:text-foreground"
          data-empty-history
        >
          Resume a past program <ChevronRight className="h-4 w-4" aria-hidden />
        </Link>
      )}
    </Card>
  );
}

/** "Today" beside the week / month title, only once you've moved off today. */
export function BackToToday({ selectedDate, onSelectDate }: { selectedDate: Date; onSelectDate: (d: Date) => void }) {
  const today = localStartOfToday();
  if (isSameDay(selectedDate, today)) return null;
  return (
    <button
      type="button"
      onClick={() => onSelectDate(today)}
      className="-my-2 inline-flex h-10 items-center rounded-lg px-2 text-xs font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
    >
      Today
    </button>
  );
}
