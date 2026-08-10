import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Share2, TrendingUp, TrendingDown, Minus } from "lucide-react";
import { MUSCLE_EMOJI, type MuscleGroup } from "@/lib/analytics/muscle-map";
import type { MuscleStat } from "@/lib/analytics/performance-insights";

export function MuscleGroupGrid({
  stats,
  onShare,
  fmtTon,
}: {
  stats: MuscleStat[];
  onShare: (group: MuscleGroup, stat: MuscleStat) => void;
  fmtTon: (lb: number) => string;
}) {
  const active = stats.filter((s) => s.monthly_sets > 0 || s.weekly_sets > 0);
  const dormant = stats.filter((s) => !active.includes(s));
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {active.map((s) => (
          <MuscleCard key={s.group} stat={s} onShare={() => onShare(s.group, s)} fmtTon={fmtTon} />
        ))}
      </div>
      {dormant.length > 0 && (
        <div className="rounded-2xl border border-dashed border-border/60 p-3 text-xs text-muted-foreground">
          Not trained in this window: {dormant.map((d) => d.group).join(" · ")}
        </div>
      )}
    </div>
  );
}

function MuscleCard({ stat, onShare, fmtTon }: { stat: MuscleStat; onShare: () => void; fmtTon: (lb: number) => string }) {
  const t = stat.trend_pct;
  const trendIcon =
    t == null ? <Minus className="h-3 w-3" /> :
    t > 3 ? <TrendingUp className="h-3 w-3" /> :
    t < -3 ? <TrendingDown className="h-3 w-3" /> : <Minus className="h-3 w-3" />;
  const trendClass =
    t == null ? "text-muted-foreground" :
    t > 3 ? "text-emerald-500" :
    t < -3 ? "text-rose-500" : "text-muted-foreground";
  const trendLabel = t == null ? "—" : `${t > 0 ? "+" : ""}${t}%`;
  return (
    <Card className="relative overflow-hidden rounded-2xl border-border/60 bg-gradient-to-br from-card to-card/60 p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="text-2xl leading-none">{MUSCLE_EMOJI[stat.group]}</div>
          <div className="mt-1 text-sm font-bold">{stat.group}</div>
        </div>
        <button
          type="button"
          onClick={onShare}
          className="rounded-full p-1.5 text-muted-foreground transition hover:bg-muted"
          aria-label={`Share ${stat.group} stats`}
        >
          <Share2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-2 gap-y-2 text-xs">
        <Stat label="Weekly sets" value={String(stat.weekly_sets)} />
        <Stat label="Monthly sets" value={String(stat.monthly_sets)} />
        <Stat label="Avg weekly" value={String(stat.avg_weekly_sets)} />
        <Stat label="Tonnage (mo)" value={fmtTon(stat.monthly_tonnage)} />
      </div>
      <div className={`mt-3 inline-flex items-center gap-1 rounded-full bg-muted/60 px-2 py-1 text-xs font-semibold ${trendClass}`}>
        {trendIcon} <span>{trendLabel}</span>
      </div>
    </Card>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[10px] uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="truncate text-sm font-semibold">{value}</div>
    </div>
  );
}