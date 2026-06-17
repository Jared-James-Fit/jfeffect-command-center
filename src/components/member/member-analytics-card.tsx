import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { BarChart3, TrendingUp, Trophy, Activity } from "lucide-react";
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { format, startOfWeek, addWeeks, differenceInCalendarWeeks } from "date-fns";
import { estimate1RM } from "@/lib/analytics/e1rm";

/**
 * Membership-friendly analytics card.
 * Pulls strictly from member_set_logs for the given enrollment — never
 * writes, never mutates plan structure. Shows weekly volume trend, working
 * sets, average RPE, and best estimated 1RM across the plan.
 */
export function MemberAnalyticsCard({ enrollmentId }: { enrollmentId: string }) {
  const { data: logs = [], isLoading } = useQuery({
    queryKey: ["m-analytics-logs", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_set_logs")
        .select(
          "reps, load_lb, normalized_lb, rpe, is_working_set, logged_at, week_index, day_index",
        )
        .eq("enrollment_id", enrollmentId)
        .order("logged_at", { ascending: true });
      return (data ?? []) as any[];
    },
  });

  const stats = useMemo(() => {
    if (logs.length === 0) return null;

    // Weekly buckets (last 8 weeks)
    const now = new Date();
    const thisWeek = startOfWeek(now, { weekStartsOn: 1 });
    const weeks: { label: string; key: string; volume: number; sets: number }[] = [];
    for (let i = 7; i >= 0; i--) {
      const ws = addWeeks(thisWeek, -i);
      weeks.push({
        label: format(ws, "MMM d"),
        key: format(ws, "yyyy-MM-dd"),
        volume: 0,
        sets: 0,
      });
    }
    const weekIndexByKey = new Map(weeks.map((w, i) => [w.key, i]));

    let totalSets = 0;
    let workingSets = 0;
    let rpeSum = 0;
    let rpeCount = 0;
    let bestE1RM = 0;

    for (const l of logs) {
      const reps = Number(l.reps) || 0;
      const load = Number(l.normalized_lb ?? l.load_lb) || 0;
      const vol = reps * load;
      totalSets += 1;
      if (l.is_working_set !== false) workingSets += 1;
      if (l.rpe != null) {
        rpeSum += Number(l.rpe);
        rpeCount += 1;
      }
      if (reps > 0 && load > 0) {
        const e = estimate1RM(load, reps, "epley");
        if (e > bestE1RM) bestE1RM = e;
      }
      const d = new Date(l.logged_at);
      const ws = startOfWeek(d, { weekStartsOn: 1 });
      const key = format(ws, "yyyy-MM-dd");
      const idx = weekIndexByKey.get(key);
      if (idx != null) {
        weeks[idx].volume += vol;
        weeks[idx].sets += 1;
      }
    }

    const thisIdx = weeks.length - 1;
    const prevIdx = thisIdx - 1;
    const thisVol = weeks[thisIdx]?.volume ?? 0;
    const prevVol = weeks[prevIdx]?.volume ?? 0;
    const trendPct = prevVol > 0 ? Math.round(((thisVol - prevVol) / prevVol) * 100) : null;

    return {
      weeks,
      totalSets,
      workingSets,
      avgRpe: rpeCount > 0 ? rpeSum / rpeCount : null,
      bestE1RM,
      thisVol,
      trendPct,
    };
  }, [logs]);

  if (isLoading) {
    return (
      <Card className="p-5 text-sm text-muted-foreground">Loading analytics…</Card>
    );
  }

  if (!stats) {
    return (
      <Card className="p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" /> Analytics
        </div>
        <div className="mt-2 text-sm text-muted-foreground">
          Log a set during a workout and your training analytics will appear here automatically.
        </div>
      </Card>
    );
  }

  return (
    <Card className="p-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <BarChart3 className="h-4 w-4 text-primary" /> Analytics
        </div>
        {stats.trendPct != null && (
          <Badge variant={stats.trendPct >= 0 ? "default" : "outline"}>
            {stats.trendPct >= 0 ? "▲" : "▼"} {Math.abs(stats.trendPct)}% vs last week
          </Badge>
        )}
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MiniStat
          icon={<TrendingUp className="h-4 w-4 text-blue-500" />}
          label="This week volume"
          value={`${Math.round(stats.thisVol).toLocaleString()} lb`}
        />
        <MiniStat
          icon={<Activity className="h-4 w-4 text-emerald-500" />}
          label="Working sets"
          value={stats.workingSets.toLocaleString()}
        />
        <MiniStat
          icon={<Activity className="h-4 w-4 text-amber-500" />}
          label="Avg RPE"
          value={stats.avgRpe != null ? stats.avgRpe.toFixed(1) : "—"}
        />
        <MiniStat
          icon={<Trophy className="h-4 w-4 text-orange-500" />}
          label="Best est. 1RM"
          value={stats.bestE1RM > 0 ? `${Math.round(stats.bestE1RM)} lb` : "—"}
        />
      </div>

      <div className="mt-5">
        <div className="mb-2 text-xs font-bold uppercase tracking-wider text-muted-foreground">
          Weekly volume (last 8 weeks)
        </div>
        <div className="h-44 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={stats.weeks} margin={{ top: 8, right: 8, left: -8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey="label" fontSize={10} tickLine={false} axisLine={false} />
              <YAxis
                fontSize={10}
                tickLine={false}
                axisLine={false}
                tickFormatter={(v) =>
                  v >= 1000 ? `${Math.round(v / 1000)}k` : `${v}`
                }
              />
              <Tooltip
                formatter={(v: any) => [`${Math.round(Number(v)).toLocaleString()} lb`, "Volume"]}
                cursor={{ opacity: 0.1 }}
              />
              <Bar dataKey="volume" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
        <div className="mt-2 text-[11px] text-muted-foreground">
          Volume = reps × load across all sets logged this week.
        </div>
      </div>
    </Card>
  );
}

function MiniStat({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-lg border bg-card/40 p-3">
      <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        {icon}
        {label}
      </div>
      <div className="mt-1 text-lg font-black leading-tight">{value}</div>
    </div>
  );
}