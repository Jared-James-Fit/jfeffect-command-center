import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trophy, Dumbbell, Activity, CheckCircle2, XCircle, Flame } from "lucide-react";
import type { WorkoutSummary } from "@/lib/workout-summary";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  summary: WorkoutSummary;
  workoutTitle?: string | null;
  onClose?: () => void;
};

export function WorkoutSubmissionSummary({ open, onOpenChange, summary, workoutTitle, onClose }: Props) {
  const headline =
    summary.score >= 90 ? "Crushed it!"
    : summary.score >= 75 ? "Great work!"
    : summary.score >= 50 ? "Solid effort"
    : "Logged — keep going";

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) onClose?.(); }}>
      <DialogContent className="max-w-md p-0 overflow-hidden pb-[env(safe-area-inset-bottom)]">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <Trophy className="h-6 w-6" />
            </div>
            <div className="flex-1 min-w-0">
              <DialogHeader className="space-y-0">
                <DialogTitle className="text-2xl font-black leading-tight">{headline}</DialogTitle>
                <DialogDescription className="text-xs truncate">
                  {workoutTitle ?? "Workout"} · summary
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
        </div>

        <div className="space-y-3 px-5 pb-4">
          {/* Score */}
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workout Score</div>
            <div className="mt-1 flex items-baseline justify-center gap-1">
              <span className="text-5xl font-black text-primary">{summary.score}</span>
              <span className="text-xl font-bold text-muted-foreground">/100</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {summary.completionPct}% completed
            </div>
          </div>

          {/* Total lifted */}
          <div className="rounded-2xl border border-border bg-card p-4">
            <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
              <Dumbbell className="h-3.5 w-3.5" /> Total Weight Lifted
            </div>
            <div className="mt-0.5 text-2xl font-black">{summary.totalLiftedFmt}</div>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-3 gap-2">
            <StatTile label="Exercises" value={`${summary.exercisesCompleted}/${summary.exercisesTotal}`} icon={<CheckCircle2 className="h-3.5 w-3.5" />} />
            <StatTile label="Sets" value={`${summary.completedSets}/${summary.prescribedSets}`} icon={<Activity className="h-3.5 w-3.5" />} />
            <StatTile label="Total Reps" value={`${summary.totalReps}`} icon={<Activity className="h-3.5 w-3.5" />} />
            <StatTile
              label="Avg RPE"
              value={summary.avgRpe != null ? `${summary.avgRpe}` : "—"}
              icon={<Flame className="h-3.5 w-3.5" />}
              muted={summary.avgRpe == null}
            />
            <StatTile
              label="Missed"
              value={`${summary.missedExercises.length}`}
              icon={<XCircle className="h-3.5 w-3.5" />}
              muted={summary.missedExercises.length === 0}
              className="col-span-2"
            />
          </div>

          {summary.missedExercises.length > 0 && (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-xs">
              <div className="mb-1 font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                Skipped / not logged
              </div>
              <div className="text-muted-foreground">
                {summary.missedExercises.slice(0, 6).join(", ")}
                {summary.missedExercises.length > 6 ? "…" : ""}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t bg-background/95 px-5 py-3">
          <Button className="h-12 w-full text-base font-bold" onClick={() => { onOpenChange(false); onClose?.(); }}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatTile({ icon, label, value, muted, className }: { icon: React.ReactNode; label: string; value: string; muted?: boolean; className?: string }) {
  return (
    <div className={`rounded-xl border border-border bg-card px-3 py-2 ${className ?? ""}`}>
      <div className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-0.5 text-lg font-black leading-tight ${muted ? "text-muted-foreground" : "text-foreground"}`}>
        {value}
      </div>
    </div>
  );
}

// Compact header used inside admin/coach workout review cards.
export function WorkoutReviewSummaryHeader({
  summary,
  difficulty,
  energy,
  pain,
}: {
  summary: WorkoutSummary;
  difficulty?: number | null;   // session_rpe (1-10)
  energy?: number | null;       // overall_rating (1-5)
  pain?: boolean | null;
}) {
  return (
    <div className="rounded-xl border border-border bg-muted/30 p-3 mb-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
        <Cell label="Score" value={`${summary.score}/100`} highlight />
        <Cell label="Total Lifted" value={summary.totalLiftedFmt} />
        <Cell label="Completion" value={`${summary.completionPct}%`} />
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
        <Cell label="Missed" value={`${summary.missedExercises.length}`} />
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
