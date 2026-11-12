import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
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
    <Card className="rounded-2xl p-0">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${weekIndex ? `Week ${weekIndex} ` : ""}volume: ${v.totalRawSets} sets, ${v.totalEffectiveSets} effective`}
        className="flex min-h-12 w-full items-center gap-2.5 px-3 py-2 text-left"
      >
        <BarChart3 className="h-4 w-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium">Volume</div>
          <div className="truncate text-xs text-muted-foreground">
            {v.totalRawSets} sets · {v.totalEffectiveSets} effective
            {v.untaggedRowCount > 0 && <> · {v.untaggedRowCount} not tagged</>}
          </div>
        </div>
        {open ? (
          <ChevronUp className="h-4 w-4 text-muted-foreground" />
        ) : (
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        )}
      </button>

      {open && (
        <div className="space-y-2 border-t border-border px-3 pb-3 pt-2.5">
          <div className="inline-flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Group by">
            {(["pattern", "muscle", "family"] as const).map((k) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={view === k}
                className={
                  "h-8 rounded-md px-2.5 text-xs font-medium capitalize transition-colors " +
                  (view === k ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground")
                }
                onClick={() => setView(k)}
              >
                {k}
              </button>
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
                            ? "font-medium text-warning"
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
                            ? "h-full rounded-full bg-warning/70"
                            : "h-full rounded-full bg-foreground/70"
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
            <div className="rounded-lg bg-warning/10 px-2.5 py-2 text-xs text-warning">
              {v.untaggedRowCount} row{v.untaggedRowCount === 1 ? " uses an exercise" : "s use exercises"} with no
              muscles tagged. Tag {v.untaggedRowCount === 1 ? "it" : "them"} in the exercise library for
              accurate effective sets.
            </div>
          )}
        </div>
      )}
    </Card>
  );
}