import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { BodyweightSheetHeader } from "@/components/bodyweight/bodyweight-sheet-header";
import { bodyweightStats, type ProgressBodyweight } from "@/lib/progress";
import { convertWeight, formatWeight, type WeightUnit } from "@/lib/progress-metrics";

type Range = "7d" | "30d" | "90d" | "all";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rows: ProgressBodyweight[];
  unit: WeightUnit;
}

function formatDate(value: string) {
  try {
    return format(parseISO(value), "MMM d");
  } catch {
    return value;
  }
}

export function BodyweightHistorySheet({ open, onOpenChange, rows, unit }: Props) {
  const [range, setRange] = useState<Range>("all");
  const stats = useMemo(() => bodyweightStats(rows), [rows]);

  const allPoints = useMemo(
    () =>
      [...rows]
        .sort((a, b) => a.logged_date.localeCompare(b.logged_date))
        .map((row) => ({
          date: row.logged_date,
          value: Number(convertWeight(row.weight_value, row.weight_unit, unit).toFixed(1)),
          note: row.note,
        })),
    [rows, unit],
  );

  const chartPoints = useMemo(() => {
    if (range === "all") return allPoints;
    const days = range === "7d" ? 7 : range === "30d" ? 30 : 90;
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - days);
    return allPoints.filter((point) => new Date(point.date) >= cutoff);
  }, [allPoints, range]);

  const yDomain = useMemo<[number | string, number | string]>(
    () =>
      chartPoints.length === 1
        ? [chartPoints[0].value - 1, chartPoints[0].value + 1]
        : ["auto", "auto"],
    [chartPoints],
  );

  const displayStats = stats
    ? {
        latest: convertWeight(stats.latest, stats.unit, unit),
        avg7: stats.avg7 == null ? null : convertWeight(stats.avg7, stats.unit, unit),
        change: convertWeight(stats.change, stats.unit, unit),
      }
    : null;

  const recentRows = useMemo(
    () => [...rows].sort((a, b) => b.logged_date.localeCompare(a.logged_date)).slice(0, 50),
    [rows],
  );

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="bottom"
        hideCloseButton
        className="flex h-[min(92dvh,46rem)] max-h-[92dvh] flex-col gap-0 rounded-t-2xl p-0 sm:mx-auto sm:max-w-2xl"
      >
        <BodyweightSheetHeader title="Bodyweight History" />
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-[calc(env(safe-area-inset-bottom)+1rem)] pt-4">
          {!displayStats ? (
            <div className="rounded-xl border border-dashed border-border px-5 py-10 text-center text-sm text-muted-foreground">
              No bodyweight entries yet. Log your first weigh-in to begin tracking your trend.
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-2 rounded-xl border border-border bg-card p-3 text-center">
                <Stat label="Latest" value={formatWeight(displayStats.latest, unit)} />
                <Stat
                  label="7-day avg"
                  value={displayStats.avg7 == null ? "—" : formatWeight(displayStats.avg7, unit)}
                />
                <Stat
                  label="Since start"
                  value={`${displayStats.change > 0 ? "+" : ""}${displayStats.change.toFixed(1)} ${unit}`}
                />
              </div>

              <section
                className="rounded-xl border border-border bg-card p-3"
                aria-label="Bodyweight chart"
              >
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <h3 className="text-sm font-semibold">Bodyweight trend</h3>
                  <div className="flex gap-1" aria-label="Chart range">
                    {(["7d", "30d", "90d", "all"] as const).map((value) => (
                      <Button
                        key={value}
                        type="button"
                        size="sm"
                        variant={range === value ? "default" : "outline"}
                        className="h-8 min-w-10 px-2 text-[11px] uppercase"
                        onClick={() => setRange(value)}
                      >
                        {value === "all" ? "All" : value}
                      </Button>
                    ))}
                  </div>
                </div>
                {chartPoints.length ? (
                  <div className="h-52 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart
                        data={chartPoints}
                        margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
                      >
                        <defs>
                          <linearGradient id="bodyweightHistoryArea" x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor="var(--primary)" stopOpacity={0.4} />
                            <stop offset="100%" stopColor="var(--primary)" stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <XAxis
                          dataKey="date"
                          tickFormatter={formatDate}
                          tick={{ fontSize: 10 }}
                          minTickGap={24}
                        />
                        <YAxis domain={yDomain} tick={{ fontSize: 10 }} width={36} />
                        <Tooltip
                          contentStyle={{ fontSize: 12, padding: 8 }}
                          labelFormatter={(value) => formatDate(String(value))}
                          formatter={(value: unknown) => [`${String(value)} ${unit}`, "Weight"]}
                        />
                        <Area
                          type="monotone"
                          dataKey="value"
                          stroke="var(--primary)"
                          strokeWidth={2}
                          fill="url(#bodyweightHistoryArea)"
                          isAnimationActive={false}
                        />
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-8 text-center text-sm text-muted-foreground">
                    No weigh-ins in this range.
                  </p>
                )}
              </section>

              <section
                className="overflow-hidden rounded-xl border border-border bg-card"
                aria-label="Recent bodyweight entries"
              >
                <div className="border-b border-border px-4 py-3">
                  <h3 className="text-sm font-semibold">Recent entries</h3>
                </div>
                <div className="divide-y divide-border">
                  {recentRows.map((row) => (
                    <div
                      key={row.id}
                      className="flex min-h-12 items-center justify-between gap-4 px-4 py-3"
                    >
                      <div className="min-w-0">
                        <p className="text-sm font-medium">{formatDate(row.logged_date)}</p>
                        {row.note ? (
                          <p className="truncate text-xs text-muted-foreground">{row.note}</p>
                        ) : null}
                      </div>
                      <p className="shrink-0 text-sm font-semibold">
                        {formatWeight(convertWeight(row.weight_value, row.weight_unit, unit), unit)}
                      </p>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-base font-bold">{value}</p>
      <p className="mt-0.5 text-[10px] uppercase tracking-wide text-muted-foreground">{label}</p>
    </div>
  );
}
