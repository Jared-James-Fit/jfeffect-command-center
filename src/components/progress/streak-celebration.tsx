import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Flame, Trophy, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";

type Props = { userId: string };

const STREAK_MILESTONES = [2, 4, 8, 12, 26, 52];
const COUNT_MILESTONES = [1, 5, 10, 25, 50, 100];

function isoWeekKey(d: Date): string {
  // ISO week (UTC) — Thursday in current week decides the year
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

function computeWeekStreak(dates: string[]): number {
  if (dates.length === 0) return 0;
  const weeks = new Set(dates.map((s) => isoWeekKey(new Date(s))));
  // Walk back from current week; allow current week to be empty (still counts prior streak).
  let streak = 0;
  const cur = new Date();
  let cursor = new Date(Date.UTC(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate()));
  const thisWeek = isoWeekKey(cursor);
  if (!weeks.has(thisWeek)) {
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  while (weeks.has(isoWeekKey(cursor))) {
    streak++;
    cursor.setUTCDate(cursor.getUTCDate() - 7);
  }
  return streak;
}

export function StreakCelebration({ userId }: Props) {
  const { data } = useQuery({
    queryKey: ["progress-streak", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("progress_submissions")
        .select("submission_date")
        .eq("user_id", userId)
        .order("submission_date", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data ?? []).map((r) => r.submission_date as string);
    },
  });

  const { streak, total } = useMemo(() => {
    const dates = data ?? [];
    return { streak: computeWeekStreak(dates), total: dates.length };
  }, [data]);

  useEffect(() => {
    if (!userId || !data) return;
    const fireOnce = (key: string, fn: () => void) => {
      const k = `streak-celeb:${userId}:${key}`;
      if (typeof window === "undefined") return;
      if (window.localStorage.getItem(k)) return;
      window.localStorage.setItem(k, "1");
      fn();
    };
    for (const m of STREAK_MILESTONES) {
      if (streak >= m) {
        fireOnce(`streak-${m}`, () =>
          toast.success(`🔥 ${m}-week streak!`, {
            description: "Consistency pays off — keep the check-ins coming.",
          }),
        );
      }
    }
    for (const m of COUNT_MILESTONES) {
      if (total >= m) {
        fireOnce(`count-${m}`, () =>
          toast.success(`🏆 ${m} check-in${m === 1 ? "" : "s"} logged!`, {
            description: m === 1 ? "First one done. Onward." : "Big milestone — nice work.",
          }),
        );
      }
    }
  }, [userId, data, streak, total]);

  if (!data || (streak === 0 && total === 0)) return null;

  return (
    <Card className="p-4 flex flex-wrap items-center gap-4">
      <div className="flex items-center gap-2">
        <Flame className="h-5 w-5 text-orange-500" />
        <div>
          <div className="text-sm text-muted-foreground">Current streak</div>
          <div className="text-xl font-semibold">{streak} {streak === 1 ? "week" : "weeks"}</div>
        </div>
      </div>
      <div className="flex items-center gap-2">
        <Trophy className="h-5 w-5 text-amber-500" />
        <div>
          <div className="text-sm text-muted-foreground">Total check-ins</div>
          <div className="text-xl font-semibold">{total}</div>
        </div>
      </div>
      {streak >= 4 && (
        <Badge variant="secondary" className="ml-auto gap-1">
          <Sparkles className="h-3 w-3" /> On fire
        </Badge>
      )}
    </Card>
  );
}