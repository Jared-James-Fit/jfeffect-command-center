/**
 * Lifetime: everything logged in JF Effect, added up (lifetime-stats.ts).
 * The loaded volume in both units as the hero, the counts that matter
 * (workouts, sets, reps, training days, blocks completed, PRs), the running
 * total month by month, where it came from (year, block, exercise, lift),
 * milestones reached and the next ones, and what isn't counted.
 */
import { useState } from "react";
import { format } from "date-fns";
import { Check, ChevronRight } from "lucide-react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { InfoTip } from "@/components/analytics/info-tip";
import { Figure, LabHeader, Seg } from "@/components/analytics/lab-ui";
import type { LifetimeStats } from "@/lib/analytics/lifetime-stats";
import { otherUnit, volumeCompact, volumeNum, type Unit } from "@/lib/analytics/units";
import { parseLocalDate } from "@/lib/today";

const fmtDay = (d: string | null, f = "MMM d, yyyy") => {
  const x = d ? parseLocalDate(d) : null;
  return x ? format(x, f) : "";
};
const monthLabel = (m: string, f = "MMM yyyy") => fmtDay(`${m}-01`, f);

type By = "year" | "block" | "exercise" | "lift";

export function LifetimeSection({
  stats,
  unit,
  compact = false,
  onOpen,
}: {
  stats: LifetimeStats;
  unit: Unit;
  compact?: boolean;
  onOpen?: () => void;
}) {
  const [by, setBy] = useState<By>("lift");
  const [all, setAll] = useState(false);
  const other = otherUnit(unit);

  if (!stats.sets)
    return compact ? null : (
      <Card className="p-4 text-sm text-muted-foreground">
        Nothing logged yet. Your lifetime numbers start with your first workout.
      </Card>
    );

  if (compact) {
    return (
      <Card className="p-0" data-lifetime="compact">
        <button
          type="button"
          onClick={onOpen}
          className="block w-full rounded-2xl p-4 text-left transition active:bg-muted/40"
          aria-label="Open Lifetime"
        >
          <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
            <span className="min-w-0 flex-1 truncate">
              Lifetime · since {fmtDay(stats.first, "MMM yyyy")}
            </span>
            <ChevronRight className="h-4 w-4 shrink-0" aria-hidden />
          </div>
          <div className="mt-1.5 flex flex-wrap items-baseline gap-x-2">
            <span className="text-2xl font-semibold tabular-nums tracking-tight text-foreground">
              {volumeNum(stats.volumeLb, unit)} {unit}
            </span>
            <span className="text-[14px] tabular-nums text-muted-foreground">
              {volumeNum(stats.volumeLb, other)} {other}
            </span>
          </div>
          <div className="text-[12px] text-muted-foreground">lifted (weight × reps)</div>
          <div className="mt-3 grid grid-cols-3 gap-3">
            <Figure label="Workouts" value={stats.workouts.toLocaleString()} />
            <Figure label="Sets" value={stats.sets.toLocaleString()} />
            <Figure label="PRs" value={stats.prs.toLocaleString()} />
          </div>
        </button>
      </Card>
    );
  }

  const groups = {
    year: stats.byYear,
    block: stats.byBlock,
    exercise: stats.byExercise,
    lift: stats.byLift,
  }[by];
  const shown = all ? groups : groups.slice(0, 8);
  const maxVol = Math.max(1, ...groups.map((g) => g.volumeLb));
  const chart = stats.months.map((m) => ({
    ...m,
    value: unit === "kg" ? m.cumulativeLb / 2.2046226 : m.cumulativeLb,
  }));

  return (
    <div className="space-y-4" data-lifetime="full">
      <Card className="space-y-4 p-4">
        <LabHeader
          title="Lifetime"
          sub={`Everything logged in JF Effect since ${fmtDay(stats.first)}`}
          tip={
            <InfoTip label="How lifetime is counted" title="How it's counted" align="start">
              Volume is weight × reps of working sets with a weight. Bodyweight sets add sets and
              reps, never a weight; assisted sets add nothing to volume; warm-ups aren't counted. A
              workout is a program day with a logged set. Both units are the same weight, converted
              once. PRs are all-time estimated-max records.
            </InfoTip>
          }
        />
        <div data-lifetime-volume>
          <div className="text-[12px] text-muted-foreground">Total lifted</div>
          <div className="text-[34px] font-semibold leading-tight tabular-nums tracking-tight text-foreground">
            {volumeNum(stats.volumeLb, unit)}{" "}
            <span className="text-[20px] font-medium">{unit}</span>
          </div>
          <div className="text-[18px] font-medium tabular-nums text-muted-foreground">
            {volumeNum(stats.volumeLb, other)} {other}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-x-3 gap-y-4 border-t border-border/60 pt-4">
          <Figure
            label="Workouts"
            value={stats.workouts.toLocaleString()}
            sub={`${stats.finishedWorkouts} finished`}
          />
          <Figure label="Training days" value={stats.trainingDays.toLocaleString()} />
          <Figure
            label="Sets"
            value={stats.sets.toLocaleString()}
            sub={`${stats.loadedSets.toLocaleString()} with weight`}
          />
          <Figure label="Reps" value={stats.reps.toLocaleString()} />
          <Figure label="Blocks done" value={stats.blocksCompleted} sub="completed and trained" />
          <Figure label="PRs" value={stats.prs.toLocaleString()} sub="all-time records" />
        </div>
      </Card>

      {chart.length >= 2 && (
        <Card className="p-4" data-lifetime-chart>
          <LabHeader title="Running total" sub="Weight lifted, added up month by month" />
          <div className="mt-3 h-44 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chart} margin={{ top: 6, right: 8, bottom: 0, left: 0 }}>
                <CartesianGrid
                  vertical={false}
                  stroke="color-mix(in oklab, var(--border) 70%, transparent)"
                />
                <XAxis
                  dataKey="month"
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  tickFormatter={(m: string) => monthLabel(m, "MMM")}
                  minTickGap={16}
                />
                <YAxis
                  tick={{ fontSize: 10 }}
                  stroke="var(--muted-foreground)"
                  width={44}
                  tickFormatter={(v: number) =>
                    volumeCompact(unit === "kg" ? v * 2.2046226 : v, unit)
                  }
                />
                <Tooltip
                  cursor={{ stroke: "var(--foreground)", strokeOpacity: 0.3 }}
                  content={({ active, payload }) => {
                    const p = active && payload?.[0]?.payload;
                    if (!p) return null;
                    return (
                      <div className="rounded-lg border border-border bg-popover px-3 py-2 text-[12px] shadow-sm">
                        <div className="font-semibold text-foreground">
                          {monthLabel(p.month, "MMMM yyyy")}
                        </div>
                        <div className="tabular-nums text-foreground">
                          {volumeNum(p.cumulativeLb, unit)} {unit} so far
                        </div>
                        <div className="tabular-nums text-muted-foreground">
                          {volumeNum(p.cumulativeLb, other)} {other}
                        </div>
                        <div className="mt-1 tabular-nums text-muted-foreground">
                          This month: {volumeNum(p.volumeLb, unit)} {unit} · {p.workouts} workout
                          {p.workouts === 1 ? "" : "s"}
                        </div>
                      </div>
                    );
                  }}
                />
                <Area
                  type="linear"
                  dataKey="value"
                  stroke="var(--heat-3)"
                  strokeWidth={2}
                  fill="var(--heat-1)"
                  fillOpacity={0.6}
                  isAnimationActive={false}
                  dot={{ r: 2.5, fill: "var(--heat-3)", strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      <Card className="space-y-3 p-4" data-lifetime-by={by}>
        <LabHeader title="Where it came from" />
        <Seg
          label="Group by"
          value={by}
          options={[
            ["lift", "Lift"],
            ["exercise", "Exercise"],
            ["block", "Block"],
            ["year", "Year"],
          ]}
          onChange={(v) => {
            setBy(v);
            setAll(false);
          }}
          stretch
          testId="lifetime-by"
        />
        <ul className="space-y-2.5">
          {shown.map((g) => (
            <li key={g.key} className="text-[13px]" data-lifetime-row={g.key}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="min-w-0 truncate font-medium text-foreground">{g.label}</span>
                <span className="shrink-0 tabular-nums text-foreground">
                  {g.volumeLb > 0 ? `${volumeCompact(g.volumeLb, unit)} ${unit}` : "no weight"}
                  <span className="text-muted-foreground"> · {g.sets.toLocaleString()} sets</span>
                </span>
              </div>
              <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full rounded-full bg-[var(--heat-3)]"
                  style={{
                    width: `${Math.max(g.volumeLb > 0 ? 1.5 : 0, (g.volumeLb / maxVol) * 100)}%`,
                  }}
                />
              </div>
            </li>
          ))}
        </ul>
        {groups.length > 8 && (
          <button
            type="button"
            className="text-[12px] font-medium text-muted-foreground hover:text-foreground"
            onClick={() => setAll((v) => !v)}
          >
            {all ? "Show fewer" : `Show all ${groups.length}`}
          </button>
        )}
      </Card>

      {(stats.milestones.reached.length > 0 || stats.milestones.next.length > 0) && (
        <Card className="space-y-3 p-4" data-lifetime-milestones>
          <LabHeader title="Milestones" />
          {stats.milestones.next.length > 0 && (
            <ul className="space-y-2.5">
              {stats.milestones.next.map((m) => (
                <li key={m.label} className="text-[13px]">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-foreground">Next: {m.label}</span>
                    <span className="tabular-nums text-muted-foreground">
                      {Math.floor(m.progress * 100)}%
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted">
                    <div
                      className="h-full rounded-full bg-foreground/70"
                      style={{ width: `${m.progress * 100}%` }}
                    />
                  </div>
                </li>
              ))}
            </ul>
          )}
          {stats.milestones.reached.length > 0 && (
            <ul className="divide-y divide-border/60">
              {stats.milestones.reached.slice(0, 5).map((m) => (
                <li key={m.label} className="flex items-center gap-2 py-2 text-[13px]">
                  <Check className="h-4 w-4 shrink-0 text-[var(--success)]" aria-hidden />
                  <span className="min-w-0 flex-1 truncate text-foreground">{m.label}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {fmtDay(m.reached, "MMM d, yyyy")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}

      <p
        className={cn("px-1 text-[12px] leading-snug text-muted-foreground")}
        data-lifetime-coverage
      >
        Counted from {fmtDay(stats.coverage.since)}, your first set logged in JF Effect; training
        before that isn't here.
        {stats.coverage.noWeightSets > 0 &&
          ` ${stats.coverage.noWeightSets.toLocaleString()} set${stats.coverage.noWeightSets === 1 ? " was" : "s were"} logged without a weight: they count as sets and reps, never as weight lifted.`}
        {stats.bodyweightSets + stats.assistedSets > 0 &&
          ` ${(stats.bodyweightSets + stats.assistedSets).toLocaleString()} bodyweight or assisted set${stats.bodyweightSets + stats.assistedSets === 1 ? "" : "s"} add sets and reps only.`}
      </p>
    </div>
  );
}
