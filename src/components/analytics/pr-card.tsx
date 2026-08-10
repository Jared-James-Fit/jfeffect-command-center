import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { format } from "date-fns";
import {
  ANALYTICS_COLORS,
  exerciseColor,
  fmtDelta,
  fmtNum,
  fmtWeight,
} from "@/lib/analytics-format";

export type Unit = "lb" | "kg";

export interface PRCardProps {
  pr: any;
  displayUnit: Unit;
  /** Converts a source-unit (lb) value into the current displayUnit. */
  conv: (v: number) => number;
  /** Optional tighter density for snapshot placements. */
  dense?: boolean;
}

export function PRCard({ pr, displayUnit, conv, dense = false }: PRCardProps) {
  const color = exerciseColor(pr.exercise_name, pr.muscle_group);
  return (
    <Card
      className={`relative overflow-hidden border-border/80 bg-card shadow-sm transition-colors hover:border-primary/40 ${
        dense ? "p-3" : "p-4"
      }`}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-2">
        <div className="min-w-0 text-sm font-extrabold leading-tight text-foreground sm:text-base">
          <span className="truncate">{pr.exercise_name}</span>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge
            className="border-transparent text-[11px] font-bold"
            style={{
              background: `color-mix(in oklab, ${ANALYTICS_COLORS.green} 18%, transparent)`,
              color: ANALYTICS_COLORS.green,
            }}
          >
            {fmtDelta(conv(pr.delta), displayUnit)}
          </Badge>
          <Badge variant="outline" className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">
            est 1RM PR
          </Badge>
        </div>
      </div>
      <div className="mt-0.5 text-[11px] font-medium text-muted-foreground">
        {format(new Date(pr.date), "MMM d, yyyy")}
      </div>
      <div className={`mt-2 font-black tracking-tight text-foreground ${dense ? "text-2xl" : "text-3xl"}`}>
        {fmtNum(conv(pr.est_1rm))}{" "}
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          {displayUnit} · est 1RM
        </span>
      </div>
      <div className="mt-1 text-xs font-medium text-foreground/80">
        {fmtWeight(conv(pr.load), displayUnit)} × {pr.reps}
      </div>
      <div className="text-[11px] text-muted-foreground">
        Previous best {fmtWeight(conv(pr.prior_est), displayUnit)}
      </div>
    </Card>
  );
}