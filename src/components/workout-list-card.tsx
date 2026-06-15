import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Dumbbell, ChevronRight, Calendar as CalendarIcon, Pencil, MessageSquare, Move } from "lucide-react";
import { format } from "date-fns";
import { getWorkoutStatus } from "@/lib/workout-status";
import { durationRange } from "@/lib/pl-programs";
import { cleanDayTitle } from "@/lib/workout-today";
import { MoveWorkoutSheet } from "@/components/schedule/MoveWorkoutSheet";

export function WorkoutListCard({ item, readonly = false }: { item: any; readonly?: boolean }) {
  if (!item.day?.id) return null;
  const status = getWorkoutStatus(item);
  const title = cleanDayTitle(item.day.title, item.day.day_index);
  const dur = item.day.duration_override_min ?? item.day.duration_estimate_min ?? null;
  const weekLabel = item.week?.week_index ? `Week ${item.week.week_index}` : "";
  const isCompleted = !!item.completion?.completed_at;
  const hasReview = !!item.completion?.has_feedback;
  const [moveOpen, setMoveOpen] = useState(false);
  return (
    <div className="space-y-1.5">
    <Link
      to="/portal/workouts/$dayId"
      params={{ dayId: item.day.id }}
      search={readonly ? { readonly: 1 } : undefined as any}
      className="block"
    >
      <Card className="flex items-center gap-3 p-3 transition-colors hover:bg-secondary/30">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
          <Dumbbell className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="truncate font-bold">{title}</div>
            <Badge variant="outline" className={`text-[10px] ${status.tone}`}>{status.label}</Badge>
            {isCompleted && !hasReview && (
              <Badge variant="outline" className="border-amber-500/40 bg-amber-500/10 text-[10px] text-amber-700 dark:text-amber-300">
                Review pending
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            {weekLabel && <span>{weekLabel}</span>}
            {item.day.focus && <span>· {item.day.focus}</span>}
            {status.scheduled && (
              <span className="inline-flex items-center gap-1">
                <CalendarIcon className="h-3 w-3" /> {format(status.scheduled, "EEE MMM d")}
              </span>
            )}
            {dur && <span>· {durationRange(dur)}</span>}
          </div>
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    </Link>
    <div className="flex flex-wrap items-center gap-1.5 pl-1">
      {!readonly && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setMoveOpen(true); }}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Move className="h-3 w-3" /> Move
        </button>
      )}
      {isCompleted && (<>
        <Link
          to="/portal/workouts/$dayId"
          params={{ dayId: item.day.id }}
          search={{ edit: 1 } as any}
          className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-secondary hover:text-foreground"
        >
          <Pencil className="h-3 w-3" /> Edit workout
        </Link>
        <Link
          to="/portal/workouts/$dayId"
          params={{ dayId: item.day.id }}
          search={{ review: 1 } as any}
          className={
            hasReview
              ? "inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/20 dark:text-emerald-300"
              : "inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/20 dark:text-amber-300"
          }
        >
          <MessageSquare className="h-3 w-3" /> {hasReview ? "Edit review" : "Leave review"}
        </Link>
      </>)}
    </div>
    {!readonly && (
      <MoveWorkoutSheet
        dayId={item.day.id}
        open={moveOpen}
        onOpenChange={setMoveOpen}
      />
    )}
    </div>
  );
}