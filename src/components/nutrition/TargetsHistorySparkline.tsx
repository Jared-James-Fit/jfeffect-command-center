import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getMemberTargetsHistory } from "@/lib/nutrition-targets/member-targets.functions";

type Row = {
  id: string;
  calories: number | null;
  protein_g: number | null;
  created_at: string;
  source: string | null;
  goal: string | null;
};

/** Compact trend chart of the member's calorie target over time. */
export function TargetsHistorySparkline() {
  const fn = useServerFn(getMemberTargetsHistory);
  const { data, isLoading } = useQuery({
    queryKey: ["m-targets-history"],
    queryFn: () => fn({}) as Promise<Row[]>,
    staleTime: 60_000,
  });

  if (isLoading || !data || data.length < 2) return null;

  // Server returns newest first — flip to chronological for the chart.
  const rows = [...data].reverse();
  const values = rows.map((r) => Number(r.calories ?? 0));
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  const W = 240;
  const H = 48;
  const stepX = values.length > 1 ? W / (values.length - 1) : 0;
  const points = values
    .map((v, i) => `${(i * stepX).toFixed(1)},${(H - ((v - min) / range) * H).toFixed(1)}`)
    .join(" ");

  const first = values[0];
  const last = values[values.length - 1];
  const delta = last - first;
  const pct = first > 0 ? (delta / first) * 100 : 0;
  const TrendIcon = delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor =
    delta > 0 ? "text-emerald-500" : delta < 0 ? "text-amber-500" : "text-muted-foreground";

  const latest = rows[rows.length - 1];
  const latestDate = new Date(latest.created_at).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wide text-muted-foreground">
            Calorie target history
          </div>
          <div className="mt-0.5 text-lg font-black leading-none">
            {last.toLocaleString()}{" "}
            <span className="text-xs font-normal text-muted-foreground">cal · {latestDate}</span>
          </div>
          <div className={`mt-1 flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
            <TrendIcon className="h-3.5 w-3.5" />
            {delta > 0 ? "+" : ""}
            {delta.toLocaleString()} cal ({pct > 0 ? "+" : ""}
            {pct.toFixed(1)}%) vs first
          </div>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="h-12 w-40 text-primary"
          preserveAspectRatio="none"
          aria-hidden="true"
        >
          <polyline
            points={points}
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {values.map((v, i) => (
            <circle
              key={i}
              cx={(i * stepX).toFixed(1)}
              cy={(H - ((v - min) / range) * H).toFixed(1)}
              r={i === values.length - 1 ? 3 : 1.8}
              fill="currentColor"
            />
          ))}
        </svg>
      </div>
      <div className="mt-2 text-[11px] text-muted-foreground">
        {rows.length} target {rows.length === 1 ? "version" : "versions"} tracked
      </div>
    </Card>
  );
}