import { Link } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Dumbbell, ChevronRight } from "lucide-react";
import { derivePhase, displayTitle, toneClasses as phaseToneClasses, type TrainingPhase } from "@/lib/training-phases";
import { format, parseISO } from "date-fns";

export function TrainingBlockCard({ phase }: { phase: TrainingPhase }) {
  const d = derivePhase(phase);
  return (
    <Link to="/portal/workouts" className="block">
      <Card className="border-border bg-card p-5 transition active:bg-secondary/30">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Dumbbell className="h-5 w-5 shrink-0 text-primary" />
            <h3 className="truncate text-base font-bold">{displayTitle(phase)}</h3>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge variant="outline" className={phaseToneClasses(d.tone)}>{d.label}</Badge>
          <Badge variant="outline" className="text-[10px]">{phase.phase_type}</Badge>
        </div>

        <div className="mt-2 text-xs text-muted-foreground">
          {format(parseISO(phase.start_date), "MMM d")} – {format(parseISO(phase.end_date), "MMM d, yyyy")}
        </div>

        <div className="mt-3 flex items-center justify-between gap-2 text-sm">
          <div>
            <span className="font-bold">Week {d.currentWeek}</span>
            <span className="text-muted-foreground"> of {d.totalWeeks}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            {d.daysRemaining < 0 ? `${Math.abs(d.daysRemaining)}d over` : `${d.daysRemaining}d left`}
          </div>
          <div className="text-sm font-bold">{d.percentComplete}%</div>
        </div>

        <Progress value={d.percentComplete} className="mt-2 h-2" />
      </Card>
    </Link>
  );
}