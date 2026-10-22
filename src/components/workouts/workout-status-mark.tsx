import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { getWorkoutStatus, type WorkoutStatus } from "@/lib/workout-status";
import type { WorkoutItem } from "@/lib/workout-today";

/**
 * One workout status mark for every calendar (Home week, Workouts week and month):
 *   scheduled / not started → small grey dot
 *   in progress             → red ring filled to the real logged-set progress
 *   completed               → green check
 *   skipped                 → muted red minus (only when a workout is explicitly skipped;
 *                             an unfinished past workout is never shown as skipped)
 *   no workout              → nothing
 */
export type WorkoutMark =
  | { kind: "scheduled" }
  | { kind: "progress"; pct: number }
  | { kind: "done" }
  | { kind: "skipped" };

const DONE: WorkoutStatus[] = ["completed_today", "completed_on_scheduled", "completed_different_day", "review_pending"];

/** Explicitly skipped (nothing records this yet; never inferred from a missed day). */
function isSkipped(item: WorkoutItem): boolean {
  const c = item.completion as any;
  return !!(c?.skipped_at || c?.status === "skipped" || (item as any).skipped === true);
}

export function workoutMark(item: WorkoutItem | null | undefined, now: Date = new Date()): WorkoutMark | null {
  if (!item?.day) return null;
  if (isSkipped(item)) return { kind: "skipped" };
  const { status } = getWorkoutStatus(item, now);
  if (DONE.includes(status)) return { kind: "done" };
  if (status === "in_progress" || status === "incomplete") {
    return { kind: "progress", pct: Math.max(0, Math.min(100, Math.round(item.progress_pct ?? 0))) };
  }
  return { kind: "scheduled" };
}

/** Marks for a day with several workouts: the least-finished one speaks for the day. */
export function dayMark(items: Array<WorkoutItem | null | undefined>, now: Date = new Date()): WorkoutMark | null {
  const marks = items.map((i) => workoutMark(i, now)).filter((m): m is WorkoutMark => !!m);
  if (!marks.length) return null;
  const rank = { progress: 0, scheduled: 1, skipped: 2, done: 3 } as const;
  return marks.sort((a, b) => rank[a.kind] - rank[b.kind])[0];
}

/**
 * The mark itself: 10px, sitting where the old status dot sat. `onPrimary` keeps it
 * readable on the selected day's red background (the status itself never changes).
 */
export function WorkoutStatusMark({ mark, onPrimary = false, className }: { mark: WorkoutMark | null; onPrimary?: boolean; className?: string }) {
  if (!mark) return <span className={cn("inline-block h-2.5 w-2.5", className)} aria-hidden />;
  const box = cn("inline-grid h-2.5 w-2.5 shrink-0 place-items-center", className);
  if (mark.kind === "done") {
    return (
      <span className={cn(box, "rounded-full bg-emerald-500 text-white", onPrimary && "ring-1 ring-white/70")} aria-label="Completed">
        <Check className="h-2 w-2" strokeWidth={4} />
      </span>
    );
  }
  if (mark.kind === "skipped") {
    return (
      <span
        className={cn(box, "rounded-full border", onPrimary ? "border-white/60 text-white/70" : "border-rose-500/60 text-rose-500/70")}
        aria-label="Skipped"
      >
        <Minus className="h-2 w-2" strokeWidth={3.5} />
      </span>
    );
  }
  if (mark.kind === "progress") {
    const r = 4;
    const c = 2 * Math.PI * r;
    return (
      <svg viewBox="0 0 10 10" className={box} aria-label={`In progress, ${mark.pct}%`}>
        <circle cx="5" cy="5" r={r} fill="none" strokeWidth="1.6" className={onPrimary ? "stroke-white/30" : "stroke-muted-foreground/30"} />
        <circle
          cx="5" cy="5" r={r} fill="none" strokeWidth="1.6" strokeLinecap="round"
          strokeDasharray={`${(c * Math.max(mark.pct, 4)) / 100} ${c}`}
          transform="rotate(-90 5 5)"
          className={onPrimary ? "stroke-white" : "stroke-primary"}
        />
      </svg>
    );
  }
  return (
    <span className={box} aria-label="Scheduled">
      <span className={cn("h-1.5 w-1.5 rounded-full", onPrimary ? "bg-white/70" : "bg-muted-foreground/50")} />
    </span>
  );
}

/** One quiet line under a calendar saying what the marks mean. */
export function WorkoutMarkLegend({ className, sessions }: { className?: string; /** Also explain the violet session dot. */ sessions?: boolean }) {
  const items: Array<[WorkoutMark, string]> = [
    [{ kind: "scheduled" }, "Planned"],
    [{ kind: "progress", pct: 50 }, "In progress"],
    [{ kind: "done" }, "Done"],
  ];
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px] font-semibold text-muted-foreground", className)}>
      {items.map(([mark, label]) => (
        <span key={label} className="inline-flex items-center gap-1">
          <WorkoutStatusMark mark={mark} /> {label}
        </span>
      ))}
      {sessions && (
        <span className="inline-flex items-center gap-1">
          <span aria-hidden className="inline-block h-2 w-2 rounded-full bg-violet-500" /> Session
        </span>
      )}
    </div>
  );
}
