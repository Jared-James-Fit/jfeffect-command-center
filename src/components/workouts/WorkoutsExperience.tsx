import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  addDays, addWeeks, format, isSameDay, isSameMonth, startOfWeek,
  addMonths, startOfMonth, endOfMonth, endOfWeek, eachDayOfInterval,
} from "date-fns";
import {
  Calendar as CalendarIcon, ChevronLeft, ChevronRight, ClipboardList,
  History, Loader2, Move, MoreVertical, Play, Pencil, Sun, Activity,
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
import { getClientWorkouts, durationRange } from "@/lib/pl-programs";
import { cleanDayTitle, type WorkoutItem, dayScheduledDate } from "@/lib/workout-today";
import { getWorkoutStatus, type WorkoutStatus } from "@/lib/workout-status";
import { localStartOfToday, toLocalISO } from "@/lib/today";
import { MoveWorkoutSheet } from "@/components/schedule/MoveWorkoutSheet";
import { ScheduleHistoryDrawer } from "@/components/schedule/ScheduleHistoryDrawer";
import { ClientBlockView } from "@/components/client-block-view";
import { TrainingAnalyticsPreviewCard } from "@/components/training-analytics-preview-card";

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
    queryFn: () => getClientWorkouts(clientId) as Promise<WorkoutItem[]>,
  });

  // --- Build a date → item map from scheduled_date (canonical helper). -----
  const dayItems = useMemo(
    () => (items ?? []).filter((it) => it.day?.id) as WorkoutItem[],
    [items],
  );
  const byDate = useMemo(() => {
    const map = new Map<string, WorkoutItem>();
    for (const it of dayItems) {
      const d = dayScheduledDate(it);
      if (d) map.set(toLocalISO(d), it);
    }
    return map;
  }, [dayItems]);

  // --- Current block / week label for the header subtitle. -----------------
  const today = localStartOfToday();
  const todayItem = byDate.get(toLocalISO(today)) ?? null;
  const headerBlock =
    todayItem?.block ??
    dayItems.find((it) => {
      const d = dayScheduledDate(it);
      return d && d >= today;
    })?.block ??
    dayItems[dayItems.length - 1]?.block ?? null;
  const headerWeek =
    todayItem?.week ??
    dayItems.find((it) => it.block?.id === headerBlock?.id && (() => {
      const d = dayScheduledDate(it); return d && d >= today;
    })())?.week ?? null;
  const subtitle = [
    headerBlock?.name ? headerBlock.name : null,
    headerWeek?.week_index ? `Week ${headerWeek.week_index}` : null,
  ].filter(Boolean).join(" · ");

  // --- Resume banner: any open in-progress session anywhere in the program.
  const inProgress = useMemo(
    () =>
      dayItems.find(
        (it) => it.completion && !it.completion?.completed_at,
      ) ?? null,
    [dayItems],
  );

  // --- Selected date drives the calendar tab. Defaults to today. ----------
  const [selectedDate, setSelectedDate] = useState<Date>(today);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [calView, setCalView] = useState<"week" | "month">("week");
  const navigate = useNavigate();

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
        {mode === "self" && (
          <TrainingAnalyticsPreviewCard clientId={clientId} />
        )}
        {inProgress && (
          <ResumeBanner item={inProgress} />
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
                  />
                )}
                <SelectedDayCard
                  item={byDate.get(toLocalISO(selectedDate)) ?? null}
                  date={selectedDate}
                  readonly={mode === "coach"}
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
              <BlockViewTab items={dayItems} clientId={clientId} mode={mode} />
            )}
          </TabsContent>
        </Tabs>
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
/* Resume banner                                                          */
/* ---------------------------------------------------------------------- */

function ResumeBanner({ item }: { item: WorkoutItem }) {
  const title = cleanDayTitle(item.day?.title, item.day?.day_index);
  return (
    <Card className="flex flex-wrap items-center justify-between gap-3 border-amber-500/40 bg-amber-500/10 p-3">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <Play className="h-4 w-4 text-amber-500" />
        <div className="min-w-0">
          <div className="truncate font-bold">Workout in progress</div>
          <div className="truncate text-xs text-muted-foreground">{title}</div>
        </div>
      </div>
      <Button asChild size="sm" className="bg-amber-500 text-black hover:bg-amber-400">
        <Link to="/portal/workouts/$dayId" params={{ dayId: item.day.id }}>
          Resume <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Link>
      </Button>
    </Card>
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
    case "missed": return "bg-amber-500";
    case "upcoming": return "bg-muted-foreground/60";
    case "available": return "bg-muted-foreground/40";
    default: return "bg-transparent";
  }
}

function WeekStrip({
  selectedDate, onSelectDate, byDate,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem>;
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
          const item = byDate.get(iso);
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
              aria-label={`${format(d, "EEEE MMMM d")}${item ? `, ${getWorkoutStatus(item).label}` : ", rest day"}`}
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
  selectedDate, onSelectDate, byDate,
}: {
  selectedDate: Date;
  onSelectDate: (d: Date) => void;
  byDate: Map<string, WorkoutItem>;
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
          const item = byDate.get(iso);
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
                  {title}
                </span>
              )}
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

function SelectedDayCard({
  item, date, readonly,
}: {
  item: WorkoutItem | null;
  date: Date;
  readonly: boolean;
}) {
  const [previewOpen, setPreviewOpen] = useState(false);
  const [moveOpen, setMoveOpen] = useState(false);

  if (!item) {
    return (
      <Card className="p-6 text-center">
        <div className="mx-auto grid h-10 w-10 place-items-center rounded-full bg-muted">
          <Sun className="h-5 w-5 text-muted-foreground" />
        </div>
        <div className="mt-3 text-base font-bold">No workout scheduled</div>
        <div className="text-xs text-muted-foreground">
          {format(date, "EEEE, MMMM d")} · rest day
        </div>
      </Card>
    );
  }

  const status = getWorkoutStatus(item);
  const title = cleanDayTitle(item.day?.title, item.day?.day_index);
  const dur = item.day?.duration_override_min ?? item.day?.duration_estimate_min ?? null;
  const cta = primaryCtaFor(item, status.status);

  return (
    <>
      <Card className="p-4 md:p-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <div className="truncate text-lg font-black">{title}</div>
              <Badge variant="outline" className={cn("text-[10px]", status.tone)}>{status.label}</Badge>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {[
                item.block?.name,
                item.week?.week_index ? `Week ${item.week.week_index}` : null,
                `Day ${item.day?.day_index ?? "?"}`,
                format(date, "EEE MMM d"),
                dur ? durationRange(dur) : null,
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
                <DropdownMenuItem onSelect={() => setPreviewOpen(true)}>
                  <ClipboardList className="mr-2 h-4 w-4" /> Preview workout
                </DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setMoveOpen(true)}>
                  <Move className="mr-2 h-4 w-4" /> Move workout
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button asChild size="lg" className={cn("font-bold", cta.tone)}>
            <Link
              to="/portal/workouts/$dayId"
              params={{ dayId: item.day.id }}
              search={cta.search as any}
            >
              {cta.icon} {cta.label}
            </Link>
          </Button>
          {cta.secondary && (
            <Button asChild size="sm" variant="outline">
              <Link
                to="/portal/workouts/$dayId"
                params={{ dayId: item.day.id }}
                search={cta.secondary.search as any}
              >
                {cta.secondary.label}
              </Link>
            </Button>
          )}
          {!readonly && status.status !== "completed_today"
            && status.status !== "completed_on_scheduled"
            && status.status !== "completed_different_day"
            && (
              <Button size="sm" variant="ghost" className="text-muted-foreground" onClick={() => setMoveOpen(true)}>
                <Move className="mr-1 h-3.5 w-3.5" /> Reschedule
              </Button>
            )}
        </div>
      </Card>

      {!readonly && (
        <MoveWorkoutSheet
          dayId={item.day.id}
          open={moveOpen}
          onOpenChange={setMoveOpen}
        />
      )}

      <DayPreviewSheet
        open={previewOpen}
        onOpenChange={setPreviewOpen}
        item={item}
        date={date}
      />
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
  if (inProgress) {
    return { label: "Continue Workout", tone: "bg-amber-500 text-black hover:bg-amber-400", icon: <Play className="mr-1 h-4 w-4" /> };
  }
  switch (status) {
    case "completed_today":
    case "completed_on_scheduled":
    case "completed_different_day":
      return {
        label: "View / Edit Log",
        tone: "bg-emerald-600 text-white hover:bg-emerald-500",
        icon: <Pencil className="mr-1 h-4 w-4" />,
        search: { edit: 1 },
      };
    case "missed":
      return {
        label: "Log Workout",
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
        label: "Open Workout",
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
            <Link to="/portal/workouts/$dayId" params={{ dayId: item.day.id }} search={cta.search as any}>
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
  void clientId;
  const blocks = useMemo(() => {
    const seen = new Map<string, any>();
    for (const it of items) {
      if (it.block?.id && !seen.has(it.block.id)) seen.set(it.block.id, it.block);
    }
    return [...seen.values()];
  }, [items]);

  const today = localStartOfToday();
  const defaultBlock =
    blocks.find((b: any) => {
      const s = b?.start_date ? new Date(b.start_date + "T00:00:00") : null;
      const e = b?.end_date ? new Date(b.end_date + "T00:00:00") : null;
      if (!s) return false;
      if (s > today) return false;
      if (e && e < today) return false;
      return true;
    }) ?? blocks[blocks.length - 1] ?? null;

  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(defaultBlock?.id ?? null);
  useEffect(() => {
    if (!selectedBlockId && defaultBlock?.id) setSelectedBlockId(defaultBlock.id);
  }, [defaultBlock?.id, selectedBlockId]);

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
      selectedWeekIndex={null}
      selectedDayId={null}
      onWeekChange={() => {}}
      onDayChange={() => {}}
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

/* Re-export for callers that want individual pieces. */
export { ResumeBanner };