import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card } from "@/components/ui/card";
import { Target, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { getMyRecentAdherenceFn } from "@/lib/nutrition-updates.functions";

/**
 * Member-facing widget: shows the latest weekly compliance % plus a small
 * bar trend of the previous reported windows. Sourced from
 * `nutrition_update_submissions.compliance_pct` (self-reported each cycle).
 */
export function RecentAdherenceWidget() {
  const fn = useServerFn(getMyRecentAdherenceFn);
  const q = useQuery({
    queryKey: ["my-recent-adherence"],
    queryFn: () => fn(),
    staleTime: 60_000,
  });

  const rows = q.data?.rows ?? [];
  if (q.isLoading || rows.length === 0) return null;

  const latest = rows[rows.length - 1];
  const prev = rows.length > 1 ? rows[rows.length - 2] : null;
  const latestPct = latest.compliance_pct ?? 0;
  const delta = prev?.compliance_pct != null ? latestPct - prev.compliance_pct : null;
  const avg = Math.round(
    rows.reduce((s, r) => s + (r.compliance_pct ?? 0), 0) / rows.length,
  );

  const TrendIcon = delta == null ? Minus : delta > 0 ? TrendingUp : delta < 0 ? TrendingDown : Minus;
  const trendColor =
    delta == null ? "text-muted-foreground"
    : delta > 0 ? "text-emerald-500"
    : delta < 0 ? "text-rose-500"
    : "text-muted-foreground";

  const tone = (pct: number) =>
    pct >= 85 ? "bg-emerald-500"
    : pct >= 70 ? "bg-amber-500"
    : "bg-rose-500";

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Target className="h-4 w-4 text-primary" />
          <div>
            <div className="text-sm font-bold leading-tight">Recent adherence</div>
            <div className="text-[11px] text-muted-foreground">
              Self-reported across your last {rows.length} update{rows.length === 1 ? "" : "s"}
            </div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black leading-none tabular-nums">{latestPct}%</div>
          <div className={`mt-1 flex items-center justify-end gap-1 text-[11px] ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            <span>
              {delta == null ? "first report" : delta === 0 ? "no change" : `${delta > 0 ? "+" : ""}${delta} pts`}
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 flex items-end gap-1.5" aria-label="Adherence history">
        {rows.map((r) => {
          const pct = r.compliance_pct ?? 0;
          return (
            <div key={r.id} className="flex flex-1 flex-col items-center gap-1">
              <div
                className={`w-full rounded-sm ${tone(pct)} transition-all`}
                style={{ height: `${Math.max(6, (pct / 100) * 56)}px`, opacity: 0.85 }}
                title={`${pct}% on ${new Date(r.submitted_at).toLocaleDateString()}`}
              />
            </div>
          );
        })}
      </div>
      <div className="mt-2 flex justify-between text-[10px] uppercase tracking-wide text-muted-foreground">
        <span>{new Date(rows[0].submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
        <span>Avg {avg}%</span>
        <span>{new Date(latest.submitted_at).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
      </div>
    </Card>
  );
}