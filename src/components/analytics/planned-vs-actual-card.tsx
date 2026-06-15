import { useQuery } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ChevronDown, Target } from "lucide-react";
import { useState } from "react";
import { format } from "date-fns";
import { getRecentPlannedVsActual } from "@/lib/analytics/planned-vs-actual";

function fmtDuration(secs: number): string {
  if (!secs || secs <= 0) return "—";
  const m = Math.floor(secs / 60);
  const s = Math.round(secs % 60);
  if (m === 0) return `${s}s`;
  if (s === 0) return `${m}m`;
  return `${m}m ${s}s`;
}

function toneFor(pct: number | null): string {
  if (pct == null) return "bg-muted text-muted-foreground";
  if (pct >= 90) return "bg-emerald-500/15 text-emerald-500";
  if (pct >= 70) return "bg-amber-500/15 text-amber-500";
  return "bg-rose-500/15 text-rose-500";
}

export function PlannedVsActualCard({
  clientId,
  formula,
  workingRpeMin,
}: {
  clientId: string;
  formula?: "epley" | "brzycki";
  workingRpeMin?: number;
}) {
  const [expandedDay, setExpandedDay] = useState<string | null>(null);

  const { data: days = [], isLoading } = useQuery({
    queryKey: ["planned-vs-actual", clientId, formula, workingRpeMin],
    enabled: !!clientId,
    queryFn: () =>
      getRecentPlannedVsActual(clientId, { limit: 5, formula, workingRpeMin }),
  });

  if (isLoading) {
    return (
      <Card className="p-4 text-sm text-muted-foreground">Loading planned vs actual…</Card>
    );
  }
  if (!days.length) {
    return (
      <Card className="p-4">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Target className="h-4 w-4 text-primary" />
          Planned vs Actual
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          Not enough data — complete a programmed workout to see how your sets and reps stack up.
        </p>
      </Card>
    );
  }

  return (
    <Card className="overflow-hidden">
      <div className="border-b border-border p-4">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold">Planned vs Actual</h3>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          How closely your last {days.length} workout{days.length === 1 ? "" : "s"} matched
          the prescription — sets completed and reps on target.
        </p>
      </div>
      <ul className="divide-y divide-border">
        {days.map((d) => {
          const open = expandedDay === d.dayId;
          const dateLabel = d.completedAt
            ? format(new Date(d.completedAt), "MMM d")
            : "—";
          return (
            <li key={d.dayId}>
              <button
                type="button"
                onClick={() => setExpandedDay(open ? null : d.dayId)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-muted/40"
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-semibold">
                    {d.dayName || "Workout"}{" "}
                    <span className="font-normal text-muted-foreground">· {dateLabel}</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-muted-foreground">
                    {d.totals.actualSets}/{d.totals.plannedSets || "?"} sets
                    {d.totals.repsHitPct != null && ` · ${d.totals.repsHitPct}% reps on target`}
                  </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Badge variant="outline" className={`border-0 ${toneFor(d.totals.setsPct)}`}>
                    {d.totals.setsPct != null ? `${d.totals.setsPct}% sets` : "—"}
                  </Badge>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
                  />
                </div>
              </button>
              {open && (
                <ul className="border-t border-border bg-muted/20 px-4 py-2">
                  {d.rows.map((r) => {
                    const isTime = r.measurementType === "time";
                    const plannedLabel = isTime
                      ? `${r.plannedSets ?? "?"}×${fmtDuration(r.plannedDurationSeconds ?? 0)}`
                      : `${r.plannedSets ?? "?"}×${r.plannedRepsText ?? "?"}`;
                    const actualLabel = isTime
                      ? `${r.actualSets} sets · ${fmtDuration(r.actualDurationTotalSeconds)} total`
                      : `${r.actualSets} sets · ${r.actualRepsTotal} reps`;
                    const hitPct = isTime ? r.durationHitPct : r.repsHitPct;
                    return (
                      <li key={r.rowId} className="flex items-center justify-between py-1.5 text-xs">
                        <div className="min-w-0 flex-1 truncate">
                          <span className="font-medium">{r.exerciseName}</span>{" "}
                          <span className="text-muted-foreground">· planned {plannedLabel}</span>
                        </div>
                        <div className="ml-2 shrink-0 text-muted-foreground">
                          {actualLabel}
                          {hitPct != null && (
                            <span className={`ml-2 ${toneFor(hitPct).split(" ")[1]}`}>
                              {hitPct}%
                            </span>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </Card>
  );
}