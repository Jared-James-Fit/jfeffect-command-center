/**
 * ScheduleManagerList — additive all-in-one list view of every workout in a
 * client's program, grouped Block → Week → Day. It is a read model over the
 * exact same data the calendar uses (pl_days + pl_scheduled_workouts +
 * pl_day_completions) and reuses the same canonical merge rules:
 *
 *  - pl_scheduled_workouts is the source of truth for WHEN a workout happens.
 *    A day with instances renders one row per instance; its legacy
 *    pl_days.scheduled_date is NOT also surfaced (would double-count).
 *  - A day with a legacy scheduled_date and no instance renders once as a
 *    legacy row (instanceId: null) so the move sheet uses the dayId path.
 *  - A day with neither renders as "Missing Date".
 *  - Completions link instance-first via scheduled_workout_id; legacy
 *    completions (scheduled_workout_id IS NULL) attach to legacy rows only.
 *
 * All mutations funnel through the existing MoveWorkoutSheet (onSelectDay),
 * so completed-workout protection, conflict detection, undo, audit logging,
 * and calendar invalidation behave exactly like the calendar flow. Nothing
 * in this file writes to the database.
 */
import { useMemo, useState } from "react";
import { format, parseISO, startOfToday } from "date-fns";
import { AlertTriangle, CalendarPlus, Eye, PencilLine } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface ScheduleManagerListProps {
  days: any[];
  weeks: any[];
  blocks: any[];
  completions: any[];
  scheduledInstances: any[];
  /** False when the client's schedule is locked (client mode). */
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
    if (legacyDate) scheduledCount += 1;
    else missingCount += 1;
    const completion = legacyCompletionByDay.get(day.id) ?? null;
    rows.push({
      key: `day:${day.id}`,
      dayId: day.id,
      instanceId: null,
      blockId: "",
      weekId: day.week_id,
      date: legacyDate,
      status: rowStatus({ completion, date: legacyDate, todayISO }),
      day,
      copyIndex: null,
    });
  }

  return { rows, total: (days ?? []).length, scheduledCount, missingCount };
}

type Filter = "all" | "missing" | "scheduled" | "completed";

const FILTER_LABELS: Array<{ id: Filter; label: string }> = [
  { id: "all", label: "All" },
  { id: "missing", label: "Missing Date" },
  { id: "scheduled", label: "Scheduled" },
  { id: "completed", label: "Completed" },
];

function StatusBadge({ status }: { status: ScheduleRowStatus }) {
  switch (status) {
    case "completed":
      return <Badge variant="default">Completed</Badge>;
    case "in_progress":
      return (
        <Badge variant="outline" className="border-amber-500/50 text-amber-600 dark:text-amber-400">
          In Progress
        </Badge>
      );
    case "missing":
      return (
        <Badge variant="outline" className="border-amber-500/50 bg-amber-500/10 text-amber-600 dark:text-amber-400">
          Missing Date
        </Badge>
      );
    case "past_due":
      return <Badge variant="destructive">Past Due</Badge>;
    default:
      return <Badge variant="secondary">Scheduled</Badge>;
  }
}

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
  const todayISO = format(startOfToday(), "yyyy-MM-dd");

  const weekById = useMemo(() => new Map((weeks ?? []).map((w: any) => [w.id, w])), [weeks]);
  const blockById = useMemo(() => new Map((blocks ?? []).map((b: any) => [b.id, b])), [blocks]);

  const { rows, total, scheduledCount, missingCount } = useMemo(
    () =>
      buildScheduleManagerRows({
        days: days ?? [],
        scheduledInstances: scheduledInstances ?? [],
        completions: completions ?? [],
        todayISO,
      }),
    [days, scheduledInstances, completions, todayISO],
  );

  const filtered = useMemo(() => {
    switch (filter) {
      case "missing":
        return rows.filter((r) => r.status === "missing");
      case "scheduled":
        // "Has a date, not finished" — includes in-progress and past-due.
        return rows.filter(
          (r) => r.status === "scheduled" || r.status === "past_due" || r.status === "in_progress",
        );
      case "completed":
        return rows.filter((r) => r.status === "completed");
      default:
        return rows;
    }
  }, [rows, filter]);

  // Group filtered rows by block → week, preserving program order.
  const grouped = useMemo(() => {
    const out: Array<{ block: any; weeks: Array<{ week: any; rows: ScheduleManagerRow[] }> }> = [];
    const blockIdx = new Map<string, number>();
    for (const row of filtered) {
      const week: any = weekById.get(row.weekId);
      const blockId = week?.block_id ?? "unknown";
      let bi = blockIdx.get(blockId);
      if (bi == null) {
        bi = out.length;
        blockIdx.set(blockId, bi);
        out.push({ block: blockById.get(blockId) ?? null, weeks: [] });
      }
      const bucket = out[bi];
      let wk = bucket.weeks.find((w) => w.week?.id === row.weekId);
      if (!wk) {
        wk = { week: week ?? null, rows: [] };
        bucket.weeks.push(wk);
      }
      wk.rows.push(row);
    }
    return out;
  }, [filtered, weekById, blockById]);

  if (total === 0) {
    return (
      <div className="rounded-md border border-border/60 p-6 text-center text-sm text-muted-foreground">
        No workouts in this program yet.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top summary */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="text-sm font-medium">
          {total} workouts · {scheduledCount} scheduled ·{" "}
          <span className={missingCount > 0 ? "text-amber-600 dark:text-amber-400 font-semibold" : ""}>
            {missingCount} missing dates
          </span>
        </div>
        <div className="flex flex-wrap gap-1.5 ml-auto">
          {FILTER_LABELS.map((f) => (
            <Button
              key={f.id}
              size="sm"
              variant={filter === f.id ? "default" : "outline"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setFilter(f.id)}
            >
              {f.id === "missing" && missingCount > 0 ? `${f.label} (${missingCount})` : f.label}
            </Button>
          ))}
        </div>
      </div>

      {missingCount > 0 && filter !== "completed" && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
          <span>
            {missingCount} {missingCount === 1 ? "workout is" : "workouts are"} not scheduled and will
            not appear on the client calendar.
          </span>
        </div>
      )}

      {filtered.length === 0 && (
        <div className="rounded-md border border-border/60 p-6 text-center text-sm text-muted-foreground">
          {filter === "missing"
            ? "Every workout has a date. Nothing missing."
            : "No workouts match this filter."}
        </div>
      )}

      {grouped.map((g, gi) => (
        <div key={g.block?.id ?? `block-${gi}`} className="space-y-2">
          <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">
            {g.block?.name ?? `Block ${gi + 1}`}
          </div>
          {g.weeks.map((w) => (
            <div key={w.week?.id ?? Math.random()} className="space-y-1.5">
              <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground/80 pl-1">
                Week {w.week?.week_index ?? "—"}
              </div>
              <div className="space-y-1.5">
                {w.rows.map((row) => {
                  const title =
                    row.day.title?.trim() || `Day ${row.day.day_index}`;
                  const isCompleted = row.status === "completed";
                  const buttonLabel = isCompleted
                    ? "View"
                    : row.status === "missing"
                      ? "Schedule"
                      : "Change Date";
                  const ButtonIcon = isCompleted
                    ? Eye
                    : row.status === "missing"
                      ? CalendarPlus
                      : PencilLine;
                  return (
                    <div
                      key={row.key}
                      className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border/60 bg-card px-3 py-2.5"
                    >
                      <div className="min-w-0 flex-1 basis-48">
                        <div className="text-[11px] uppercase tracking-wide text-muted-foreground">
                          Day {row.day.day_index}
                          {row.copyIndex != null ? ` · copy ${row.copyIndex}` : ""}
                        </div>
                        <div className="truncate text-sm font-semibold">{title}</div>
                        <div
                          className={cn(
                            "text-xs",
                            row.date ? "text-muted-foreground" : "font-medium text-amber-600 dark:text-amber-400",
                          )}
                        >
                          {row.date
                            ? `Scheduled: ${format(parseISO(row.date), "MMM d, yyyy")}`
                            : "No date set"}
                        </div>
                      </div>
                      <StatusBadge status={row.status} />
                      <Button
                        size="sm"
                        variant={row.status === "missing" ? "default" : "outline"}
                        className="h-8"
                        disabled={!canEdit}
                        onClick={() =>
                          onSelectDay({ dayId: row.dayId, instanceId: row.instanceId })
                        }
                      >
                        <ButtonIcon className="h-3.5 w-3.5 mr-1" />
                        {buttonLabel}
                      </Button>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}