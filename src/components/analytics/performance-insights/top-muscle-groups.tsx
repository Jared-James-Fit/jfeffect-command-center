import type { ReactNode } from "react";
import { Card } from "@/components/ui/card";
import { Trophy, Dumbbell, TrendingUp, CalendarCheck } from "lucide-react";
import { MUSCLE_EMOJI } from "@/lib/analytics/muscle-map";
import type { TopMuscleGroups } from "@/lib/analytics/performance-insights";

export function TopMuscleGroupsCard({ top }: { top: TopMuscleGroups }) {
  const items = [
    top.most_trained && {
      icon: <Trophy className="h-4 w-4" />, label: "Most Trained",
      title: `${MUSCLE_EMOJI[top.most_trained.group]} ${top.most_trained.group}`,
      value: `${Math.round(top.most_trained.monthly_sets)} sets`,
    },
    top.highest_tonnage && {
      icon: <Dumbbell className="h-4 w-4" />, label: "Highest Tonnage",
      title: `${MUSCLE_EMOJI[top.highest_tonnage.group]} ${top.highest_tonnage.group}`,
      value: `${top.highest_tonnage.monthly_tonnage.toLocaleString()} lb`,
    },
    top.biggest_growth && {
      icon: <TrendingUp className="h-4 w-4" />, label: "Biggest Growth",
      title: `${MUSCLE_EMOJI[top.biggest_growth.group]} ${top.biggest_growth.group}`,
      value: `${top.biggest_growth.trend_pct! > 0 ? "+" : ""}${top.biggest_growth.trend_pct}%`,
    },
    top.most_consistent && {
      icon: <CalendarCheck className="h-4 w-4" />, label: "Most Consistent",
      title: `${MUSCLE_EMOJI[top.most_consistent.group]} ${top.most_consistent.group}`,
      value: `${top.most_consistent.weeks_hit}/${top.most_consistent.window_weeks} weeks`,
    },
  ].filter(Boolean) as { icon: ReactNode; label: string; title: string; value: string }[];

  if (!items.length) return null;

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {items.map((i) => (
        <Card key={i.label} className="rounded-2xl border-border/60 bg-gradient-to-br from-primary/10 to-transparent p-4">
          <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
            {i.icon} {i.label}
          </div>
          <div className="mt-2 text-base font-black">{i.title}</div>
          <div className="mt-1 text-sm font-semibold text-primary">{i.value}</div>
        </Card>
      ))}
    </div>
  );
}