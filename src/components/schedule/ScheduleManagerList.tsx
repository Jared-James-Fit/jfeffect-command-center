/**
 * ScheduleManagerList: the coach's Program view (and the athlete's Schedule
 * Manager), every workout in the program grouped Block → Week, one line a
 * workout (its mark, its date, its name, the status word only when it's
 * news), the block being trained open and the rest folded to one line with
 * how it went. It is a read model over the
 * exact same data the calendar uses (pl_days + pl_scheduled_workouts +
 * pl_day_completions) and reuses the same canonical merge rules:
 *
 *  - pl_scheduled_workouts is the source of truth for WHEN a workout happens.
 *    A day with instances renders one row per instance; its legacy
 *    pl_days.scheduled_date is NOT also surfaced (would double-count).
 *  - A day with a legacy scheduled_date and no instance renders once as a
 *    legacy row (instanceId: null) so the move sheet uses the dayId path.
 *  - A day with neither renders as "No date".
 *  - Completions link instance-first via scheduled_workout_id; legacy
 *    completions (scheduled_workout_id IS NULL) attach to legacy rows only.
 *
 * All mutations funnel through the existing MoveWorkoutSheet (onSelectDay),
 * so completed-workout protection, conflict detection, undo, audit logging,
 * and calendar invalidation behave exactly like the calendar flow. Nothing
 * in this file writes to the database.
 */
import { useMemo, useState } from "react";
import { addDays, format, startOfToday, startOfWeek } from "date-fns";
import { ChevronDown, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { WorkoutStatusMark } from "@/components/workouts/workout-status-mark";
import {
  coachMark, dateRange, isoDate, STATUS_TONE, STATUS_WORD, statusOfRow, workoutName, type CoachStatus,
} from "@/lib/coach-schedule";

export interface ScheduleManagerListProps {
  days: any[];
  weeks: any[];
  blocks: any[];
  completions: any[];
  scheduledInstances: any[];
  /** Whether rows can be moved (always true now: clients move their own workouts anytime). */
  canEdit: boolean;
  /** Opens the existing MoveWorkoutSheet for the row's day/instance. */
  onSelectDay: (target: { dayId: string; instanceId: string | null }) => void;
}

export type ScheduleRowStatus =
  | "completed"
  | "in_progress"
  | "missing"
  | "past_due"
  | "scheduled";

export interface ScheduleManagerRow {
  key: string;
  dayId: string;
  instanceId: string | null;
  blockId: string;
  weekId: string;
  /** ISO yyyy-mm-dd, or null when unscheduled. */
  date: string | null;
  status: ScheduleRowStatus;
  day: any;
  /** 1-based copy label when a day has multiple scheduled instances. */
  copyIndex: number | null;
}

function rowStatus(opts: {
  completion: any | null;
  date: string | null;
  todayISO: string;
}): ScheduleRowStatus {
  const { completion, date, todayISO } = opts;
  // Canonical completion state: only completed_at locks a workout. A row
  // with 0 logs / 0% can still carry stale started markers — those are
  // "in progress" at most and stay reschedulable through the move sheet's
  // server-side guard.
  if (completion?.completed_at) return "completed";
  if (completion?.in_progress_at || completion?.started_at) return "in_progress";
  if (!date) return "missing";
  if (date < todayISO) return "past_due";
  return "scheduled";
}

/** Pure row builder — unit-tested in src/test/schedule-manager-list.test.ts. */
export function buildScheduleManagerRows(opts: {
  days: any[];
  scheduledInstances: any[];
  completions: any[];
  todayISO: string;
}): { rows: ScheduleManagerRow[]; total: number; scheduledCount: number; missingCount: number } {
  const { days, scheduledInstances, completions, todayISO } = opts;

  const instancesByDay = new Map<string, any[]>();
  for (const inst of scheduledInstances ?? []) {
    const list = instancesByDay.get(inst.source_day_id) ?? [];
    list.push(inst);
    instancesByDay.set(inst.source_day_id, list);
  }
  for (const list of instancesByDay.values()) {
    list.sort((a, b) => {
      const dc = String(a.scheduled_date).localeCompare(String(b.scheduled_date));
      if (dc !== 0) return dc;
      return (a.order_index ?? 0) - (b.order_index ?? 0);
    });
  }

  const completionByInstance = new Map<string, any>();
  const legacyCompletionByDay = new Map<string, any>();
  for (const c of completions ?? []) {
    if (c.scheduled_workout_id) completionByInstance.set(c.scheduled_workout_id, c);
    else legacyCompletionByDay.set(c.day_id, c);
  }

  const rows: ScheduleManagerRow[] = [];
  let scheduledCount = 0;
  let missingCount = 0;

  for (const day of days ?? []) {
    const dayInstances = instancesByDay.get(day.id) ?? [];
    if (dayInstances.length > 0) {
      scheduledCount += 1;
      dayInstances.forEach((inst, i) => {
        const completion = completionByInstance.get(inst.id) ?? null;
        rows.push({
          key: `inst:${inst.id}`,
          dayId: day.id,
          instanceId: inst.id,
          blockId: "", // filled by caller grouping via week lookup
          weekId: day.week_id,
          date: inst.scheduled_date ?? null,
          status: rowStatus({ completion, date: inst.scheduled_date ?? null, todayISO }),
          day,
          copyIndex: dayInstances.length > 1 ? i + 1 : null,
        });
      });
      continue;
    }
    const legacyDate: string | null = day.scheduled_date ?? null;
    const completion = legacyCompletionByDay.get(day.id) ?? null;
    const status = rowStatus({ completion, date: legacyDate, todayISO });
    if (legacyDate) scheduledCount += 1;
    // A workout already done (or started) with no date isn't one to place.
    else if (status === "missing") missingCount += 1;
    rows.push({
      key: `day:${day.id}`,
      dayId: day.id,
      instanceId: null,
      blockId: "",
      weekId: day.week_id,
      date: legacyDate,
      status,
      day,
      copyIndex: null,
    });
  }

  return { rows, total: (days ?? []).length, scheduledCount, missingCount };
}

type Filter = "all" | "todo" | "done" | "missed" | "no_date";

// What needs the coach first, so a phone's narrow row cuts off Done, never Missed or No date.
const FILTERS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "todo", label: "To do" },
  { id: "missed", label: "Missed" },
  { id: "no_date", label: "No date" },
  { id: "done", label: "Done" },
];

function inFilter(status: CoachStatus, filter: Filter): boolean {
  switch (filter) {
    case "todo": return status === "today" || status === "upcoming" || status === "in_progress";
    case "done": return status === "done";
    case "missed": return status === "missed";
    case "no_date": return status === "no_date";
    default: return true;
  }
}

/** The status word on a Program row: never "Done" (the green check says it) or one still ahead. */
function rowWord(status: CoachStatus): string {
  if (status === "done" || status === "upcoming" || status === "no_date") return "";
  return STATUS_WORD[status];
}

type Row = ScheduleManagerRow & { coach: CoachStatus };

export function ScheduleManagerList({
  days,
  weeks,
  blocks,
  completions,
  scheduledInstances,
  canEdit,
  onSelectDay,
}: ScheduleManagerListProps) {
  const [filter, setFilter] = useState<Filter>("all");
  // Blocks and weeks opened or closed by hand; the rest follow the default
  // (the block being trained open, and in it every week but the ones done).
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const [weekToggled, setWeekToggled] = useState<Record<string, boolean>>({});
  const todayISO = format(startOfToday(), "yyyy-MM-dd");
  const thisWeekStart = format(startOfWeek(startOfToday(), { weekStartsOn: 1 }), "yyyy-MM-dd");
  const thisWeekEnd = format(addDays(startOfWeek(startOfToday(), { weekStartsOn: 1 }), 6), "yyyy-MM-dd");

  const weekById = useMemo(() => new Map((weeks ?? []).map((w: any) => [w.id, w])), [weeks]);
  const blockById = useMemo(() => new Map((blocks ?? []).map((b: any) => [b.id, b])), [blocks]);

  const { rows, total } = useMemo(
    () =>
      buildScheduleManagerRows({
        days: days ?? [],
        scheduledInstances: scheduledInstances ?? [],
        completions: completions ?? [],
        todayISO,
      }),
    [days, scheduledInstances, completions, todayISO],
  );

  const all: Row[] = useMemo(() => rows.map((r) => ({ ...r, coach: statusOfRow(r, todayISO) })), [rows, todayISO]);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: all.length, todo: 0, done: 0, missed: 0, no_date: 0 };
    for (const r of all) for (const f of ["todo", "done", "missed", "no_date"] as const) if (inFilter(r.coach, f)) c[f] += 1;
    return c;
  }, [all]);

  // Every block in program order, its weeks and rows (all of them, so a
  // folded block's line says how the whole block went).
  const grouped = useMemo(() => {
    const out: Array<{ id: string; block: any; weeks: Array<{ id: string; week: any; rows: Row[] }> }> = [];
    const blockIdx = new Map<string, number>();
    for (const row of all) {
      const week: any = weekById.get(row.weekId);
      const blockId = week?.block_id ?? "unknown";
      let bi = blockIdx.get(blockId);
      if (bi == null) {
        bi = out.length;
        blockIdx.set(blockId, bi);
        out.push({ id: blockId, block: blockById.get(blockId) ?? null, weeks: [] });
      }
      const bucket = out[bi];
      let wk = bucket.weeks.find((w) => w.id === row.weekId);
      if (!wk) {
        wk = { id: row.weekId, week: week ?? null, rows: [] };
        bucket.weeks.push(wk);
      }
      wk.rows.push(row);
    }
    for (const g of out) {
      g.weeks.sort((a, b) => (a.week?.week_index ?? 0) - (b.week?.week_index ?? 0));
      for (const w of g.weeks) {
        w.rows.sort((a, b) => {
          if (a.date && b.date && a.date !== b.date) return a.date.localeCompare(b.date);
          if (!!a.date !== !!b.date) return a.date ? -1 : 1;
          return (a.day?.day_index ?? 0) - (b.day?.day_index ?? 0);
        });
      }
    }
    return out;
  }, [all, weekById, blockById]);

  // The block being trained: the one with a workout this week, else the
  // first with something still to do, else the last.
  const currentBlockId = useMemo(() => {
    const thisWeek = grouped.find((g) => g.weeks.some((w) => w.rows.some((r) => r.date && r.date >= thisWeekStart && r.date <= thisWeekEnd)));
    if (thisWeek) return thisWeek.id;
    const todo = grouped.find((g) => g.weeks.some((w) => w.rows.some((r) => inFilter(r.coach, "todo") || r.coach === "no_date")));
    return todo?.id ?? grouped[grouped.length - 1]?.id ?? null;
  }, [grouped, thisWeekStart, thisWeekEnd]);

  if (total === 0) {
    return (
      <div className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
        No workouts in this program yet.
      </div>
    );
  }

  const filtering = filter !== "all";
  const shown = grouped
    .map((g) => ({ ...g, weeks: g.weeks.map((w) => ({ ...w, rows: w.rows.filter((r) => inFilter(r.coach, filter)) })).filter((w) => w.rows.length) }))
    .filter((g) => g.weeks.length);

  return (
    <div className="space-y-3" data-schedule-program>
      <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]" role="group" aria-label="Show">
        {FILTERS.filter((f) => f.id === "all" || f.id === filter || counts[f.id] > 0).map((f) => (
          <button
            key={f.id}
            type="button"
            aria-pressed={filter === f.id}
            onClick={() => setFilter(f.id)}
            className={cn(
              "inline-flex h-9 shrink-0 items-center gap-1 rounded-full border px-2.5 text-[13px] font-medium transition-colors",
              filter === f.id ? "border-foreground bg-foreground text-background" : "border-border text-foreground hover:bg-muted",
            )}
          >
            {f.label}
            <span className={cn("tabular-nums", filter === f.id ? "text-background/70" : "text-muted-foreground")}>{counts[f.id]}</span>
            {f.id === "no_date" && filter !== f.id && <span className="h-1.5 w-1.5 rounded-full bg-warning" aria-hidden />}
          </button>
        ))}
      </div>

      {shown.length === 0 && (
        <div className="rounded-lg border border-border/60 p-6 text-center text-sm text-muted-foreground">
          Nothing here.
        </div>
      )}

      <div className="divide-y divide-border/60 overflow-hidden rounded-xl border border-border/70">
        {shown.map((g, gi) => {
          const full = grouped.find((x) => x.id === g.id)!;
          const blockRows = full.weeks.flatMap((w) => w.rows);
          const done = blockRows.filter((r) => r.coach === "done").length;
          const missed = blockRows.filter((r) => r.coach === "missed").length;
          const dated = blockRows.filter((r) => r.date).map((r) => r.date!).sort();
          const range = dated.length ? dateRange(dated[0], dated[dated.length - 1]) : null;
          const isCurrent = g.id === currentBlockId;
          const open = filtering || (toggled[g.id] ?? isCurrent);
          const name = g.block?.name?.trim() || `Block ${gi + 1}`;
          return (
            <section key={g.id} data-schedule-block={g.id} data-open={open || undefined}>
              <button
                type="button"
                aria-expanded={open}
                disabled={filtering}
                onClick={() => setToggled((t) => ({ ...t, [g.id]: !open }))}
                className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-muted/50 disabled:cursor-default disabled:hover:bg-transparent"
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold">{name}</span>
                    {isCurrent && <span className="shrink-0 rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Now</span>}
                  </span>
                  <span className="mt-0.5 block truncate text-xs text-muted-foreground tabular-nums">
                    {[range, `${done} of ${blockRows.length} done`].filter(Boolean).join(" · ")}
                    {missed > 0 && <span className={STATUS_TONE.missed}> · {missed} missed</span>}
                  </span>
                </span>
                {!filtering && (open ? <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />)}
              </button>
              {open && (
                <div className="space-y-1.5 px-3 pb-3">
                  {g.weeks.map((w) => {
                    const fullWeek = full.weeks.find((x) => x.id === w.id);
                    const wkRows = fullWeek?.rows ?? w.rows;
                    const wkDates = wkRows.filter((r) => r.date).map((r) => r.date!).sort();
                    const isThisWeek = wkDates.some((d) => d >= thisWeekStart && d <= thisWeekEnd);
                    const wkDone = wkRows.filter((r) => r.coach === "done").length;
                    // A week that's behind them with every workout done (or an
                    // optional one let go) folds to its line; anything missed stays open.
                    const settled = !isThisWeek && wkRows.every((r) => r.coach === "done" || r.coach === "optional");
                    const weekOpen = filtering || (weekToggled[w.id] ?? !settled);
                    return (
                      <div key={w.id} data-schedule-program-week={w.id} data-this-week={isThisWeek || undefined} data-open={weekOpen || undefined}>
                        <button
                          type="button"
                          aria-expanded={weekOpen}
                          disabled={filtering}
                          onClick={() => setWeekToggled((t) => ({ ...t, [w.id]: !weekOpen }))}
                          className={cn("flex min-h-[36px] w-full items-center justify-between gap-2 rounded-md px-1 text-left disabled:cursor-default", weekOpen && "pb-1")}
                        >
                          <span className="min-w-0 truncate text-[13px] font-semibold">
                            Week {w.week?.week_index ?? "—"}
                            {wkDates.length > 0 && <span className="font-normal text-muted-foreground"> · {dateRange(wkDates[0], wkDates[wkDates.length - 1])}</span>}
                            {isThisWeek && <span className="font-normal text-muted-foreground"> · This week</span>}
                          </span>
                          <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground tabular-nums">
                            {settled && !weekOpen && <WorkoutStatusMark mark={{ kind: "done" }} />}
                            {wkDone}/{wkRows.length}
                            {!filtering && (weekOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />)}
                          </span>
                        </button>
                        {weekOpen && (
                        <div className={cn("divide-y divide-border/50 overflow-hidden rounded-lg border", isThisWeek ? "border-foreground/30" : "border-border/60")}>
                          {w.rows.map((row) => {
                            const word = rowWord(row.coach);
                            const mark = coachMark(row.coach);
                            return (
                              <button
                                key={row.key}
                                type="button"
                                disabled={!canEdit}
                                onClick={() => onSelectDay({ dayId: row.dayId, instanceId: row.instanceId })}
                                data-schedule-row={row.key}
                                className="flex min-h-[44px] w-full items-center gap-2.5 bg-card px-3 py-2 text-left transition-colors hover:bg-muted/60 disabled:cursor-not-allowed disabled:opacity-60"
                              >
                                <span className="grid w-4 shrink-0 place-items-center">{mark ? <WorkoutStatusMark mark={mark} /> : <span className="h-2.5 w-2.5 rounded-full border border-dashed border-warning" />}</span>
                                <span className={cn("w-[52px] shrink-0 text-xs tabular-nums", row.date ? (row.date === todayISO ? "font-semibold text-foreground" : "text-muted-foreground") : "font-medium text-warning")}>
                                  {row.date ? format(isoDate(row.date), "EEE d") : "No date"}
                                </span>
                                <span className={cn("min-w-0 flex-1 truncate text-[14px] font-medium", row.coach === "done" && "text-muted-foreground")}>
                                  {workoutName(row.day)}
                                  {row.copyIndex != null && <span className="font-normal text-muted-foreground"> · copy {row.copyIndex}</span>}
                                  {row.day?.is_optional && <span className="font-normal text-muted-foreground"> · Optional</span>}
                                </span>
                                {word && <span className={cn("shrink-0 text-xs font-medium", STATUS_TONE[row.coach])}>{word}</span>}
                                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                              </button>
                            );
                          })}
                        </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          );
        })}
      </div>
    </div>
  );
}
