import { Trophy } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { WeightOther } from "@/components/dual-weight";
import { cn } from "@/lib/utils";
import {
  exerciseBestLines,
  type CommunityExercise,
  type CommunityPost,
  type WorkoutShareStats,
} from "@/lib/community";
import { usePostDetail } from "@/lib/community.queries";
import { exerciseSetRows, recapExercises, recapPr, workoutTotals } from "@/lib/workout-recap";

/**
 * Every exercise of a workout with its sets (Nov 21 2026): the Workout tab
 * of a post's sheet and the post page's "every set". It never says the
 * workout's name or numbers again (the recap above it already does): one
 * quiet line of how many exercises and the volume, then each exercise by
 * name with its record (the workout's headline PR loud, any other quiet),
 * its sets under it in the order they were done, identical sets said once
 * with their numbers ("2–4  375 lb × 4  @ 6"), the weight as typed with the
 * other unit quieter at the end. A post that hides its weights shows reps.
 */
export function WorkoutSetList({
  exercises,
  stats,
  unit,
  className,
  totals: showTotals = true,
}: {
  exercises: CommunityExercise[];
  stats: WorkoutShareStats;
  unit: "kg" | "lb";
  className?: string;
  /** The line of how many exercises and the volume (off where the numbers are already on screen). */
  totals?: boolean;
}) {
  const totals = workoutTotals(stats, exercises.length, unit);
  return (
    <div className={className} data-workout-sets>
      {showTotals && (
        <p className="text-[13px] text-muted-foreground" data-workout-totals>
          {totals.text}
          {totals.other && <WeightOther className="ml-1 text-[12px]">({totals.other})</WeightOther>}
        </p>
      )}
      <ol className="mt-1">
        {exercises.map((e, i) => {
          const pr = recapPr(e, stats);
          const rows = exerciseSetRows(e, unit);
          const best = rows.length ? null : exerciseBestLines(e, unit);
          return (
            <li
              key={`${e.name}-${i}`}
              className="border-b border-border/60 py-3 last:border-b-0"
              data-workout-detail-exercise
            >
              <div className="flex items-start justify-between gap-3">
                <h4 className="min-w-0 break-words text-[15px] font-semibold leading-snug">
                  {e.name}
                </h4>
                {pr && (
                  <span
                    className={cn(
                      "mt-0.5 inline-flex shrink-0 items-center gap-1 text-[12px] leading-tight",
                      pr.loud ? "font-semibold text-warning" : "text-muted-foreground",
                    )}
                    data-detail-pr={pr.loud ? "headline" : "quiet"}
                  >
                    {pr.loud && <Trophy className="h-3.5 w-3.5" aria-hidden />}
                    {pr.label}
                  </span>
                )}
              </div>
              {rows.length > 0 ? (
                <ul className="mt-1.5 space-y-1">
                  {rows.map((r) => (
                    <li
                      key={r.label}
                      className="flex items-baseline gap-3 text-[14px] leading-snug tabular-nums"
                      data-set-row
                    >
                      <span
                        className="w-9 shrink-0 text-[12px] text-muted-foreground"
                        aria-label={r.count > 1 ? `Sets ${r.label}` : `Set ${r.label}`}
                      >
                        {r.label}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="font-medium">{r.main}</span>
                        {r.rpe && <span className="ml-1.5 text-muted-foreground">{r.rpe}</span>}
                      </span>
                      {r.other && (
                        <span className="shrink-0 text-[12px] text-muted-foreground">
                          {r.other}
                        </span>
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                // an older read with no sets: the best set and how many
                <p className="mt-0.5 text-[14px] tabular-nums">
                  <span className="font-medium">{best?.main}</span>
                  <span className="text-muted-foreground">
                    {" · "}
                    {e.sets} {e.sets === 1 ? "set" : "sets"}
                  </span>
                </p>
              )}
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** The Workout tab of a post's sheet: its exercises, read once (the recap already asked for them, so they're there). */
export function WorkoutDetails({ post, unit }: { post: CommunityPost; unit: "kg" | "lb" }) {
  const s = post.stats;
  const detail = usePostDetail(s ? post.id : null);
  const exercises = recapExercises(detail.data?.exercises);
  if (!s) return null;
  if (detail.isLoading || (!detail.data && !detail.isError)) {
    return (
      <div className="space-y-4 px-4 pt-2" aria-hidden>
        <Skeleton className="h-3.5 w-40 rounded" />
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-2">
            <Skeleton className="h-4 w-1/2 rounded" />
            <Skeleton className="h-3.5 w-2/3 rounded" />
            <Skeleton className="h-3.5 w-3/5 rounded" />
          </div>
        ))}
      </div>
    );
  }
  if (detail.isError)
    return (
      <p className="px-4 pt-4 text-[14px] text-muted-foreground">
        Couldn't load the workout. Pull down to close and try again.
      </p>
    );
  if (exercises.length === 0)
    return (
      <p className="px-4 pt-4 text-[14px] text-muted-foreground">
        No sets were logged on this workout.
      </p>
    );
  return <WorkoutSetList exercises={exercises} stats={s} unit={unit} className="px-4 pb-6 pt-1" />;
}
