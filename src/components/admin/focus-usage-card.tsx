import { useQuery } from "@tanstack/react-query";
import { RectangleVertical } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";

type Report = {
  days: number;
  intro_people: number;
  intro_shown: number;
  intro_dismissed: number;
  tried: number;
  tried_after_intro: number;
  on_focus_now: number;
  workouts: number;
  workouts_with_focus: number;
  finished_in_focus: number;
  finished_in_list: number;
  sets_focus: number;
  sets_list: number;
  switch_backs: number;
  people_using: number;
  people_logging: number;
};

const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "—");

/** Is Focus (one exercise at a time) worth keeping? workout_focus_report, admins only. */
export function FocusUsageCard({ days = 30 }: { days?: number }) {
  const { data, isError } = useQuery({
    queryKey: ["workout-focus-report", days],
    staleTime: 10 * 60_000,
    queryFn: async (): Promise<Report> => {
      const { data, error } = await (supabase as any).rpc("workout_focus_report", { _days: days });
      if (error) throw error;
      return data as Report;
    },
  });
  if (isError || !data) return null;
  const sets = data.sets_focus + data.sets_list;
  const finished = data.finished_in_focus + data.finished_in_list;
  const stats: Array<{ label: string; value: string; sub: string }> = [
    { label: "Tried it", value: String(data.tried), sub: `${data.intro_people} saw the intro` },
    { label: "Still on Focus", value: pct(data.on_focus_now, data.tried), sub: `${data.on_focus_now} of ${data.tried} who tried` },
    { label: "Sets logged in Focus", value: pct(data.sets_focus, sets), sub: `${data.sets_focus} of ${sets} sets` },
    { label: "Finished in Focus", value: pct(data.finished_in_focus, finished), sub: `${data.finished_in_focus} of ${finished} workouts` },
  ];
  const read =
    data.tried < 5
      ? "Too early to call: fewer than 5 people have tried it."
      : data.on_focus_now / data.tried >= 0.4
        ? "People who try it tend to keep it."
        : "Most people who try it go back to the list.";
  return (
    <Card data-testid="focus-usage-card" className="space-y-3 p-4">
      <div className="flex items-start gap-2.5">
        <RectangleVertical className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <div className="text-sm font-bold">Focus mode · last {data.days} days</div>
          <div className="text-xs text-muted-foreground">One exercise at a time in the workout logger. {read}</div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label} className="rounded-xl bg-secondary/50 px-3 py-2">
            <div className="text-[11px] font-semibold text-muted-foreground">{s.label}</div>
            <div className="text-lg font-bold tabular-nums">{s.value}</div>
            <div className="text-[11px] text-muted-foreground">{s.sub}</div>
          </div>
        ))}
      </div>
      <div className="text-[11px] text-muted-foreground">
        {data.people_using} of {data.people_logging} people who logged used it · switched back to the list {data.switch_backs} times · intro closed with "Not now" {data.intro_dismissed} times
      </div>
    </Card>
  );
}
