import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trophy, Dumbbell, Activity, CheckCircle2, Flame, Clock, Star, ChevronLeft, Heart, X, Gauge, Repeat2, CircleX } from "lucide-react";
import type { WorkoutSummary } from "@/lib/workout-summary";
import { format } from "date-fns";
import { computeRecoveryScore } from "@/lib/analytics/recovery-score";
import {
  buildWorkoutTakeaways,
  formatPR,
  type CardioTakeawayInput,
  type SessionPR,
} from "@/lib/workout-takeaways";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: WorkoutSummary;
  workoutTitle?: string | null;
  durationMin?: number | null;
  workoutDate?: string | Date | null;
  sessionRating?: number | null;
  /** Self-reported session RPE (1–10). Optional. */
  sessionRpe?: number | null;
  /** Client-reported pain flag. Optional. */
  pain?: boolean | null;
  /** PRs hit during this session (already de-duplicated per exercise). */
  prs?: SessionPR[];
  /** Prescribed cardio status for the same day, when there is one. */
  cardio?: CardioTakeawayInput;
  onClose?: () => void;
};

export function WorkoutSubmissionSummary({ open, onOpenChange, summary, workoutTitle, durationMin, workoutDate, sessionRating, sessionRpe, pain, prs, cardio, onClose }: Props) {
  const prList = prs ?? [];
  const headline =
    prList.length > 0 ? "New PR!"
    : summary.score >= 90 ? "Crushed it!"
    : summary.score >= 75 ? "Great work!"
    : summary.score >= 50 ? "Solid effort"
    : "Logged — keep going";
  const motivational =
    summary.score >= 90 ? "Elite session. Recover hard — momentum is yours."
    : summary.score >= 75 ? "Strong work today. Consistency stacks results."
    : summary.score >= 50 ? "Reps in the bank. Show up again tomorrow."
    : "Logged is better than skipped. Back at it next session.";
  const takeaways = buildWorkoutTakeaways(summary, prList, cardio ?? null);
  // The star rating on the celebration screen represents session quality.
  // Historically it only showed the client's self-reported `overall_rating`,
  // which caused confusing screens like "100/100" alongside "3/5 stars" when
  // the client left the rating at its default. Derive stars from the
  // computed workout score and, when a self-rating exists, take whichever
  // is higher so an intentionally high self-rating still wins.
  const scoreStars = Math.max(0, Math.min(5, Math.round(summary.score / 20)));
  const selfStars = sessionRating != null
    ? Math.max(0, Math.min(5, Math.round(sessionRating)))
    : 0;
  const ratingStars = Math.max(scoreStars, selfStars);
  const dateLabel = (() => {
    if (!workoutDate) return null;
    try { return format(new Date(workoutDate), "EEE, MMM d, yyyy"); } catch { return null; }
  })();
  const recovery = computeRecoveryScore({
    completionPct: summary.completionPct,
    avgRpe: summary.avgRpe ?? null,
    sessionRpe: sessionRpe ?? null,
    overallRating: sessionRating ?? null,
    pain: pain ?? null,
  });

  const displayTakeaways = prList.length > 0
    ? takeaways.filter((t) => !/^🏆/.test(t.trim()))
    : takeaways;

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) onClose?.(); }}>
      <DialogContent
        className="flex max-h-[90svh] w-[calc(100vw-1rem)] max-w-[440px] flex-col overflow-hidden rounded-[24px] border-border/80 bg-background p-0 shadow-2xl [&>button]:hidden"
      >
        <header className="shrink-0 border-b border-border/70 bg-gradient-to-b from-primary/[0.09] to-background px-4 pb-3 pt-3.5 sm:px-5">
          <div className="flex items-start gap-3">
            <div className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-primary/[0.12] text-primary ring-1 ring-primary/15">
              <Trophy className="h-5 w-5" />
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex items-start justify-between gap-2">
                <DialogHeader className="min-w-0 space-y-0 text-left">
                  <DialogTitle className="truncate text-[1.35rem] font-black leading-tight tracking-tight">
                    {headline}
                  </DialogTitle>
                  <DialogDescription className="mt-0.5 line-clamp-1 text-[11px] leading-snug">
                    {workoutTitle ?? "Workout"}{dateLabel ? ` · ${dateLabel}` : ""}
                  </DialogDescription>
                </DialogHeader>

                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="-mr-1 -mt-1 h-8 w-8 shrink-0 rounded-full text-muted-foreground"
                  onClick={() => { onOpenChange(false); onClose?.(); }}
                  aria-label="Close workout summary"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                {ratingStars > 0 && (
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((i) => (
                      <Star
                        key={i}
                        className={`h-3.5 w-3.5 ${i <= ratingStars ? "fill-amber-400 text-amber-400" : "text-muted-foreground/20"}`}
                      />
                    ))}
                    <span className="ml-1 text-[10px] font-bold text-muted-foreground">{ratingStars}/5</span>
                  </div>
                )}
                <span className="text-[10px] font-semibold text-foreground/[0.65]">
                  {motivational}
                </span>
              </div>
            </div>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-3 [scrollbar-width:none] sm:px-5 [&::-webkit-scrollbar]:hidden">
          <div className="space-y-3">
            {prList.length > 0 && (
              <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-3">
                <div className="flex items-center gap-1.5 text-[10px] font-black uppercase tracking-[0.14em] text-amber-700 dark:text-amber-300">
                  <Trophy className="h-3.5 w-3.5" />
                  Personal records
                </div>
                <div className="mt-1.5 space-y-1">
                  {prList.slice(0, 4).map((pr) => (
                    <div key={`${pr.exerciseName}-${pr.reps}`} className="text-[13px] font-bold leading-snug text-foreground">
                      {formatPR(pr)}
                    </div>
                  ))}
                </div>
              </section>
            )}

            {displayTakeaways.length > 0 && (
              <section className="rounded-2xl border border-border/80 bg-card/70 p-3">
                <div className="text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                  Today's takeaways
                </div>
                <div className="mt-2 space-y-1.5">
                  {displayTakeaways.slice(0, 3).map((t) => (
                    <div key={t} className="text-[13px] leading-[1.35] text-foreground">
                      {t}
                    </div>
                  ))}
                </div>
              </section>
            )}

            <div className="grid grid-cols-2 gap-2">
              <MetricHero
                icon={<Gauge className="h-3.5 w-3.5" />}
                label="Workout score"
                value={`${summary.score}`}
                suffix="/100"
                sub={`${summary.completionPct}% complete`}
              />
              <MetricHero
                icon={<Heart className="h-3.5 w-3.5" />}
                label="Est. recovery"
                value={recovery.hasData ? `${recovery.score}` : "—"}
                suffix={recovery.hasData ? "/100" : ""}
                sub={
                  recovery.hasData
                    ? recovery.score >= 80 ? "Fresh"
                      : recovery.score >= 60 ? "Steady"
                      : recovery.score >= 40 ? "Depleted"
                      : "Very depleted"
                    : "Add a review"
                }
              />
            </div>

            <section className="rounded-2xl border border-border/80 bg-card/[0.55] p-3">
              <div className="mb-2 text-[10px] font-black uppercase tracking-[0.14em] text-muted-foreground">
                Session stats
              </div>
              <div className="grid grid-cols-2 gap-x-3 gap-y-3 sm:grid-cols-3">
                <CompactStat
                  icon={<Dumbbell className="h-3.5 w-3.5" />}
                  label="Volume"
                  value={summary.totalLiftedFmt}
                />
                <CompactStat
                  icon={<CheckCircle2 className="h-3.5 w-3.5" />}
                  label="Exercises"
                  value={`${summary.exercisesCompleted}/${summary.exercisesTotal}`}
                />
                <CompactStat
                  icon={<Activity className="h-3.5 w-3.5" />}
                  label="Sets"
                  value={`${summary.completedSets}/${summary.prescribedSets}`}
                />
                <CompactStat
                  icon={<Repeat2 className="h-3.5 w-3.5" />}
                  label="Reps"
                  value={`${summary.totalReps}`}
                />
                <CompactStat
                  icon={<Clock className="h-3.5 w-3.5" />}
                  label="Duration"
                  value={durationMin != null && durationMin > 0 ? `${durationMin} min` : "—"}
                />
                <CompactStat
                  icon={<Flame className="h-3.5 w-3.5" />}
                  label="Avg RPE"
                  value={summary.avgRpe != null ? `${summary.avgRpe}` : "—"}
                />
              </div>
            </section>

            {(cardio || summary.missedExercises.length > 0) && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {cardio && (
                  <div className="flex items-center gap-2 rounded-xl border border-border bg-card px-3 py-2.5 text-xs">
                    <Heart className="h-4 w-4 shrink-0 text-primary" />
                    <div className="min-w-0 flex-1">
                      <div className="font-bold">Cardio</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {cardio.status === "logged"
                          ? cardio.minutes && cardio.minutes > 0 ? `Logged · ${cardio.minutes} min` : "Logged"
                          : cardio.status === "skipped" ? "Skipped" : "Not logged yet"}
                      </div>
                    </div>
                  </div>
                )}

                {summary.missedExercises.length > 0 && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.06] px-3 py-2.5 text-xs">
                    <CircleX className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-300" />
                    <div className="min-w-0">
                      <div className="font-bold text-amber-700 dark:text-amber-300">
                        {summary.missedExercises.length} missed / not logged
                      </div>
                      <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
                        {summary.missedExercises.slice(0, 4).join(", ")}
                        {summary.missedExercises.length > 4 ? "…" : ""}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        <DialogFooter
          className="shrink-0 border-t border-border/70 bg-background/95 px-4 py-2.5 backdrop-blur sm:px-5"
          style={{ paddingBottom: "max(env(safe-area-inset-bottom), 0.65rem)" }}
        >
          <Button
            className="h-10 w-full rounded-xl text-sm font-bold"
            onClick={() => { onOpenChange(false); onClose?.(); }}
          >
            <ChevronLeft className="mr-1.5 h-4 w-4" />
            Back to workout
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function MetricHero({
  icon,
  label,
  value,
  suffix,
  sub,
}: {
  icon?: React.ReactNode;
  label: string;
  value: string;
  suffix?: string;
  sub?: string;
}) {
  return (
    <div className="min-w-0 rounded-2xl border border-border/80 bg-card px-3 py-3">
      <div className="flex items-center gap-1.5 text-[9px] font-black uppercase tracking-[0.12em] text-muted-foreground">
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1.5 flex min-w-0 items-baseline gap-1">
        <span className="text-[1.85rem] font-black leading-none text-primary">{value}</span>
        {suffix && <span className="text-xs font-bold leading-none text-muted-foreground">{suffix}</span>}
      </div>
      {sub && <div className="mt-1 truncate text-[10px] font-medium text-muted-foreground">{sub}</div>}
    </div>
  );
}

function CompactStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-1 text-[9px] font-black uppercase tracking-[0.1em] text-muted-foreground">
        <span className="shrink-0">{icon}</span>
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-0.5 truncate text-[1.05rem] font-black leading-tight text-foreground">{value}</div>
    </div>
  );
}

// Compact header used inside admin/coach workout review cards.
export function WorkoutReviewSummaryHeader({
  summary,
  difficulty,
  energy,
  pain,
  durationMin,
}: {
  summary: WorkoutSummary;
  difficulty?: number | null;   // session_rpe (1-10)
  energy?: number | null;       // overall_rating (1-5)
  pain?: boolean | null;
  durationMin?: number | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 mb-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Cell label="Score" value={`${summary.score}/100`} highlight />
        <Cell label="Total Volume" value={summary.totalLiftedFmt} />
        <Cell label="Completion" value={`${summary.completionPct}%`} />
        <Cell label="Duration" value={durationMin != null && durationMin > 0 ? `${durationMin} min` : "—"} />
        <Cell
          label="Difficulty"
          value={difficulty != null ? `RPE ${difficulty}/10` : "—"}
        />
        <Cell label="Energy" value={energy != null ? `${energy}/5` : "—"} />
        <Cell label="Avg RPE" value={summary.avgRpe != null ? `${summary.avgRpe}` : "—"} />
        <Cell
          label="Pain"
          value={pain ? "Yes" : "No"}
          tone={pain ? "warn" : "ok"}
        />
      </div>
    </div>
  );
}

function Cell({ label, value, highlight, tone }: { label: string; value: string; highlight?: boolean; tone?: "ok" | "warn" }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className={
        `text-sm font-black ${highlight ? "text-primary" : ""} ${tone === "warn" ? "text-amber-700 dark:text-amber-300" : ""}`
      }>{value}</div>
    </div>
  );
}
