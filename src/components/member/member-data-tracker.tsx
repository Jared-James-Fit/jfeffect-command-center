import { parseLocalDate } from "@/lib/today";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Flame, Dumbbell, CheckCircle2, TrendingUp } from "lucide-react";
import { differenceInCalendarDays, format, startOfWeek, endOfWeek } from "date-fns";
import { MemberBodyweightCard } from "./member-bodyweight-card";

export function MemberDataTracker({ enrollmentId, enrollment }: { enrollmentId: string; enrollment: any }) {
  const { data: completions = [] } = useQuery({
    queryKey: ["m-data-completions", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions").select("week_index, day_index, completed_at")
        .eq("enrollment_id", enrollmentId).order("completed_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const { data: logs = [] } = useQuery({
    queryKey: ["m-data-logs", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_set_logs").select("reps, load_lb, created_at")
        .eq("enrollment_id", enrollmentId);
      return (data ?? []) as any[];
    },
  });

  const total = enrollment?.workouts_total ?? 0;
  const done = enrollment?.workouts_completed ?? completions.length;
  const pct = Math.round((done / Math.max(total, 1)) * 100);

  // streak: consecutive days back from today with at least one completion
  const completedDays = new Set(completions.map((c) => format(parseLocalDate(c.completed_at)!, "yyyy-MM-dd")));
  let streak = 0;
  for (let i = 0; i < 365; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key = format(d, "yyyy-MM-dd");
    if (completedDays.has(key)) streak++; else if (i > 0) break;
  }

  // this week
  const weekStart = startOfWeek(new Date(), { weekStartsOn: 1 });
  const weekEnd = endOfWeek(new Date(), { weekStartsOn: 1 });
  const thisWeek = completions.filter((c) => {
    const d = parseLocalDate(c.completed_at)!;
    return d >= weekStart && d <= weekEnd;
  }).length;

  const totalVolume = logs.reduce((sum, l) => sum + (Number(l.load_lb) || 0) * (Number(l.reps) || 0), 0);
  const setsLogged = logs.length;

  const lastSession = completions[0];
  const daysSince = lastSession ? differenceInCalendarDays(new Date(), parseLocalDate(lastSession.completed_at)!) : null;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatTile icon={<Flame className="h-5 w-5 text-orange-500" />} label="Streak" value={`${streak}d`} />
        <StatTile icon={<CheckCircle2 className="h-5 w-5 text-green-500" />} label="This week" value={`${thisWeek}`} />
        <StatTile icon={<Dumbbell className="h-5 w-5 text-primary" />} label="Sets logged" value={setsLogged.toLocaleString()} />
        <StatTile icon={<TrendingUp className="h-5 w-5 text-blue-500" />} label="Volume (lb)" value={Math.round(totalVolume).toLocaleString()} />
      </div>

      <Card className="p-5">
        <div className="flex items-center justify-between gap-2">
          <div className="text-sm font-semibold">Plan progress</div>
          <Badge variant="outline">{pct}%</Badge>
        </div>
        <Progress value={pct} className="mt-3 h-3" />
        <div className="mt-2 text-xs text-muted-foreground">{done} of {total} workouts complete</div>
      </Card>

      <Card className="p-5">
        <div className="text-sm font-semibold">Recent workouts</div>
        {completions.length === 0 ? (
          <div className="mt-3 text-sm text-muted-foreground">No workouts logged yet — finish one to start your streak.</div>
        ) : (
          <ul className="mt-3 divide-y">
            {completions.slice(0, 8).map((c) => (
              <li key={`${c.week_index}:${c.day_index}:${c.completed_at}`} className="flex items-center justify-between py-2 text-sm">
                <span>Week {c.week_index} · Day {c.day_index}</span>
                <span className="text-xs text-muted-foreground">{format(parseLocalDate(c.completed_at)!, "EEE, MMM d")}</span>
              </li>
            ))}
          </ul>
        )}
        {daysSince !== null && (
          <div className="mt-3 text-xs text-muted-foreground">
            Last workout {daysSince === 0 ? "today" : `${daysSince} day${daysSince === 1 ? "" : "s"} ago`}
          </div>
        )}
      </Card>

      <MemberBodyweightCard />
    </div>
  );
}

function StatTile({ icon, label, value }: { icon: React.ReactNode; label: string; value: string }) {
  return (
    <Card className="p-3">
      <div className="flex items-center gap-2">{icon}<div className="text-xs text-muted-foreground">{label}</div></div>
      <div className="mt-1 text-xl font-black">{value}</div>
    </Card>
  );
}