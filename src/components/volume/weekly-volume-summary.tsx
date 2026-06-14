import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ChevronDown, ChevronUp, BarChart3 } from "lucide-react";
import { computeWeeklyVolume, type PlannedWeek, type ExerciseTag } from "@/lib/volume";

interface Props {
  week: PlannedWeek;
  exercises: ExerciseTag[];
  weekIndex?: number | string;
}

export function WeeklyVolumeSummary({ week, exercises, weekIndex }: Props) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<"pattern" | "muscle" | "family">("pattern");
  const v = useMemo(() => computeWeeklyVolume(week, exercises), [week, exercises]);

  if (v.totalRawSets === 0) return null;

  const buckets =
    view === "pattern" ? v.byPattern : view === "muscle" ? v.byMuscle : v.byFamily;
  const maxEff = Math.max(1, ...buckets.map((b) => b.effectiveSets));

  return (
    <Card className="border-primary/20 bg-primary/[0.03] p-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 text-left"
      >
        <BarChart3 className="h-4 w-4 text-primary" />
        <div className="flex-1">
          <div className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
            {weekIndex ? `Week ${weekIndex} · ` : ""}Weekly volume (coach)
          </div>
          <div className="text-sm font-semibold">
            {v.totalRawSets} raw sets ·{" "}
            <span className="text-primary">{v.totalEffectiveSets} effective</span>
            {v.untaggedRowCount > 0 && (
              <Badge variant="outline" className="ml-2 text-[10px]">
                {v.untaggedRowCount} untagged
              </Badge>
            )}
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="mt-3 space-y-2">
          <div className="flex gap-1">
            {(["pattern", "muscle", "family"] as const).map((k) => (
              <Button
                key={k}
                type="button"
                variant={view === k ? "default" : "outline"}
                size="sm"
                className="h-7 px-2 text-[11px] capitalize"
                onClick={() => setView(k)}
              >
                {k}
              </Button>
            ))}
          </div>

          {buckets.length === 0 ? (
            <div className="text-xs text-muted-foreground">No data.</div>
          ) : (
            <div className="space-y-1.5">
              {buckets.map((b) => {
                const pct = (b.effectiveSets / maxEff) * 100;
                const isUntagged = b.key === "untagged";
                return (
                  <div key={b.key} className="text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={
                          isUntagged
                            ? "font-medium text-amber-600 dark:text-amber-400"
                            : "font-medium"
                        }
                      >
                        {b.label}
                      </span>
                      <span className="tabular-nums text-muted-foreground">
                        {b.rawSets} raw · <span className="text-foreground">{b.effectiveSets} eff</span>{" "}
                        · {b.exerciseCount} ex
                      </span>
                    </div>
                    <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className={
                          isUntagged
                            ? "h-full rounded-full bg-amber-500/70"
                            : "h-full rounded-full bg-primary"
                        }
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {v.untaggedRowCount > 0 && (
            <div className="rounded-md border border-amber-500/30 bg-amber-500/[0.06] p-2 text-[11px] text-amber-700 dark:text-amber-300">
              {v.untaggedRowCount} programmed row{v.untaggedRowCount === 1 ? "" : "s"} use an
              untagged exercise. Tag them in the Exercise Library to get accurate effective-set
              counts.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}