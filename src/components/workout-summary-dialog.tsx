import { useMemo } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Trophy, Flame, Dumbbell, Timer, CheckCircle2, Star } from "lucide-react";

type Row = {
  id: string;
  sets: number | null;
  measurement_type?: string | null;
};

type Result = {
  row_id: string;
  actual_reps: number | null;
  normalized_kg: number | null;
  completed_duration_seconds: number | null;
  is_working_set?: boolean | null;
};

type Feedback = {
  overall_rating: number | null;
  session_rpe: number | null;
} | null;

const RATING_EMOJI: Record<number, string> = { 1: "😖", 2: "😕", 3: "🙂", 4: "💪", 5: "🔥" };
const RATING_LABEL: Record<number, string> = { 1: "Rough", 2: "Below avg", 3: "Solid", 4: "Great", 5: "Excellent" };

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: Row[];
  results: Result[];
  feedback: Feedback;
  durationMin?: number | null;
};

export function WorkoutSummaryDialog({ open, onOpenChange, rows, results, feedback, durationMin }: Props) {
  const stats = useMemo(() => {
    let prescribedSets = 0;
    let completedSets = 0;
    let totalVolumeKg = 0;
    let totalDurationSec = 0;
    const byRow = new Map<string, Result[]>();
    for (const r of results) {
      const arr = byRow.get(r.row_id) ?? [];
      arr.push(r);
      byRow.set(r.row_id, arr);
    }
    for (const row of rows) {
      const sets = row.sets ?? 0;
      prescribedSets += sets;
      const rs = byRow.get(row.id) ?? [];
      const isTime = row.measurement_type === "time";
      for (const r of rs) {
        if (isTime) {
          if ((r.completed_duration_seconds ?? 0) > 0) {
            completedSets += 1;
            totalDurationSec += r.completed_duration_seconds ?? 0;
          }
        } else {
          if ((r.actual_reps ?? 0) > 0) {
            completedSets += 1;
            const kg = Number(r.normalized_kg ?? 0);
            const reps = r.actual_reps ?? 0;
            if (kg > 0) totalVolumeKg += kg * reps;
          }
        }
      }
    }
    const completionPct = prescribedSets > 0
      ? Math.min(100, Math.round((completedSets / prescribedSets) * 100))
      : 0;
    return { prescribedSets, completedSets, completionPct, totalVolumeKg, totalDurationSec };
  }, [rows, results]);

  const rating = feedback?.overall_rating ?? null;
  const rpe = feedback?.session_rpe ?? null;

  const volumeLabel = stats.totalVolumeKg >= 1000
    ? `${(stats.totalVolumeKg / 1000).toFixed(1)}t`
    : `${Math.round(stats.totalVolumeKg).toLocaleString()}kg`;

  const durationLabel = durationMin && durationMin > 0
    ? `${durationMin}m`
    : stats.totalDurationSec > 0
      ? `${Math.floor(stats.totalDurationSec / 60)}m ${stats.totalDurationSec % 60}s`
      : null;

  const headline = stats.completionPct >= 100 ? "Crushed it!"
    : stats.completionPct >= 80 ? "Great work!"
    : stats.completionPct >= 50 ? "Solid effort"
    : "Logged — keep going";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <div className="bg-gradient-to-br from-primary/15 via-primary/5 to-transparent px-6 pt-6 pb-4">
          <div className="flex items-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/20 text-primary">
              <Trophy className="h-6 w-6" />
            </div>
            <div className="flex-1">
              <DialogHeader className="space-y-0">
                <DialogTitle className="text-2xl font-black leading-tight">{headline}</DialogTitle>
                <DialogDescription className="text-xs">
                  Workout complete · summary below
                </DialogDescription>
              </DialogHeader>
            </div>
          </div>
        </div>

        <div className="space-y-4 px-6 pb-4">
          {/* Big completion score */}
          <div className="rounded-2xl border border-border bg-card p-4 text-center">
            <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workout score</div>
            <div className="mt-1 flex items-baseline justify-center gap-1">
              <span className="text-5xl font-black text-primary">{stats.completionPct}</span>
              <span className="text-xl font-bold text-muted-foreground">%</span>
            </div>
            <div className="mt-1 text-xs text-muted-foreground">
              {stats.completedSets} of {stats.prescribedSets} sets completed
            </div>
          </div>

          {/* Stat grid */}
          <div className="grid grid-cols-2 gap-2">
            <StatTile icon={<Dumbbell className="h-4 w-4" />} label="Volume" value={volumeLabel} muted={stats.totalVolumeKg === 0} />
            <StatTile icon={<Timer className="h-4 w-4" />} label="Duration" value={durationLabel ?? "—"} muted={!durationLabel} />
            <StatTile
              icon={<Flame className="h-4 w-4" />}
              label="Session RPE"
              value={rpe != null ? `${rpe}/10` : "—"}
              muted={rpe == null}
            />
            <StatTile
              icon={<Star className="h-4 w-4" />}
              label="Rating"
              value={rating != null ? `${RATING_EMOJI[rating] ?? ""} ${rating}/5` : "—"}
              subValue={rating != null ? RATING_LABEL[rating] : undefined}
              muted={rating == null}
            />
          </div>

          <div className="flex items-center gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs">
            <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-300" />
            <span className="text-foreground">Feedback sent to your coach.</span>
          </div>
        </div>

        <DialogFooter className="border-t bg-background/95 px-6 py-3">
          <Button className="w-full" onClick={() => onOpenChange(false)}>Nice — done</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatTile({ icon, label, value, subValue, muted }: { icon: React.ReactNode; label: string; value: string; subValue?: string; muted?: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-lg font-black leading-tight ${muted ? "text-muted-foreground" : "text-foreground"}`}>{value}</div>
      {subValue && <div className="text-[10px] text-muted-foreground">{subValue}</div>}
    </div>
  );
}