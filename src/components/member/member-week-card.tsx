import { useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { CalendarDays, CheckCircle2, ChevronRight, Dumbbell } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { WeekStrip, weekDays } from "@/components/calendar/week-strip";
import { getEnrollmentSchedule } from "@/lib/member-plans.functions";
import { cn } from "@/lib/utils";

function todayIn(tz?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

function dayLabel(date: string, today: string) {
  const diff = Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff === -1) return "yesterday";
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" });
}

type Entry = { week: number; day: number; date: string };

/**
 * Member Home: the same 7-day strip as the coach dashboard and client Home,
 * built from the member's active plan (its default schedule plus any days
 * they moved). Tap a workout to open it. Hidden until they've started a plan.
 */
export function MemberWeekCard({ memberId }: { memberId: string | null | undefined }) {
  const fetchSchedule = useServerFn(getEnrollmentSchedule);
  const tz = typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const today = todayIn(tz);
  const [selected, setSelected] = useState(today);
  const thisWeek = useMemo(() => weekDays(selected).includes(today), [selected, today]);

  // Same query (and cache) as the Workouts page.
  const { data: enrollment } = useQuery({
    queryKey: ["m-active", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(*)")
        .eq("member_id", memberId!)
        .eq("status", "Active")
        .maybeSingle();
      return data as any;
    },
  });
  const enrollmentId: string | null = enrollment?.id ?? null;

  const { data: schedule = [] } = useQuery<Entry[]>({
    queryKey: ["m-today-schedule", enrollmentId, tz],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const r = await fetchSchedule({ data: { enrollmentId: enrollmentId!, timezone: tz } });
      return r.schedule as Entry[];
    },
  });
  const { data: completions = [] } = useQuery({
    queryKey: ["m-today-completions", enrollmentId],
    enabled: !!enrollmentId,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions")
        .select("week_index, day_index, completed_at")
        .eq("enrollment_id", enrollmentId!);
      return (data ?? []) as Array<{ week_index: number; day_index: number; completed_at: string | null }>;
    },
  });

  const done = useMemo(
    () => new Set(completions.filter((c) => c.completed_at).map((c) => `${c.week_index}:${c.day_index}`)),
    [completions],
  );
  const byDay = useMemo(() => {
    const m = new Map<string, Entry[]>();
    for (const e of schedule) {
      if (!m.has(e.date)) m.set(e.date, []);
      m.get(e.date)!.push(e);
    }
    return m;
  }, [schedule]);
  // Next workout still to do, for an empty day.
  const nextUp = useMemo(
    () =>
      [...schedule]
        .filter((e) => e.date > selected && !done.has(`${e.week}:${e.day}`))
        .sort((a, b) => a.date.localeCompare(b.date))[0] ?? null,
    [schedule, done, selected],
  );

  if (!enrollmentId) return null;

  const planName = enrollment?.member_plans?.name ?? "Your plan";
  const rows = byDay.get(selected) ?? [];
  const workoutLink = (e: Entry) => ({
    to: "/m/workouts/$enrollmentId/$week/$day" as const,
    params: { enrollmentId, week: String(e.week), day: String(e.day) },
  });

  return (
    <Card className="space-y-2.5 border-border bg-card p-3.5">
      <div className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3">
        <h3 className="flex min-w-0 items-center gap-2 text-[11px] font-black uppercase tracking-[0.18em] text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0 text-primary" />
          <span className="truncate">{thisWeek ? "This week" : "Week"}</span>
        </h3>
        <Link to="/m/workouts" className="inline-flex shrink-0 items-center gap-1 text-[11px] font-bold uppercase tracking-widest text-primary">
          Workouts <ChevronRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <WeekStrip
        today={today}
        selected={selected}
        onSelect={setSelected}
        count={(d) => (byDay.get(d) ?? []).length}
        dotClass="bg-cyan-400"
      />

      {rows.length === 0 ? (
        <div className="space-y-1.5">
          <p className="text-sm text-muted-foreground">{selected < today ? "Nothing scheduled" : "Rest day"} {dayLabel(selected, today)}.</p>
          {nextUp && (
            <Link {...workoutLink(nextUp)} className="flex items-center gap-2 rounded-lg border border-border bg-secondary/20 px-3 py-2">
              <Dumbbell className="h-4 w-4 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate text-sm font-semibold">
                Next: Week {nextUp.week} · Day {nextUp.day}, {dayLabel(nextUp.date, today)}
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          )}
        </div>
      ) : (
        <ul className="space-y-1.5">
          {rows.map((e) => {
            const isDone = done.has(`${e.week}:${e.day}`);
            return (
              <li key={`${e.week}:${e.day}`}>
                <Link
                  {...workoutLink(e)}
                  className={cn(
                    "grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-lg border px-3 py-2",
                    isDone ? "border-emerald-500/30 bg-emerald-500/10" : "border-primary/40 bg-primary/10",
                  )}
                >
                  {isDone ? <CheckCircle2 className="h-4 w-4 text-emerald-500" /> : <Dumbbell className="h-4 w-4 text-primary" />}
                  <div className="min-w-0">
                    <div className="truncate text-sm font-black">Week {e.week} · Day {e.day}</div>
                    <div className="truncate text-[11px] text-muted-foreground">
                      {planName}
                      {isDone ? " · Done" : ""}
                    </div>
                  </div>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
