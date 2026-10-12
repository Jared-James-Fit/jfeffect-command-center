import { useMemo } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ChevronRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getEnrollmentSchedule } from "@/lib/member-plans.functions";
import {
  ActionPill, AGENDA_LINK, AGENDA_ROW, AgendaCard, AgendaEmpty, AgendaFooter, AgendaHeader,
  AgendaNext, AgendaNextRow, AgendaRow, FAMILY_ACCENT, shortDay,
} from "@/components/schedule/agenda";

function todayIn(tz?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}


type Entry = { week: number; day: number; date: string };

/** Workouts after today shown on Home; the rest is on the Workouts page. */
const UPCOMING_ROWS = 3;

/**
 * Member Home: the same schedule look as every other Home (today, then the
 * next few workouts), built from the member's active plan (its default
 * schedule plus any days they moved). Tap a workout to open it. Hidden until
 * they've started a plan.
 */
export function MemberWeekCard({ memberId }: { memberId: string | null | undefined }) {
  const fetchSchedule = useServerFn(getEnrollmentSchedule);
  const tz = typeof window !== "undefined" ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined;
  const today = todayIn(tz);

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
  // The next few workouts still to do.
  const upcoming = useMemo(
    () =>
      [...schedule]
        .filter((e) => e.date > today && !done.has(`${e.week}:${e.day}`))
        .sort((a, b) => a.date.localeCompare(b.date) || a.week - b.week || a.day - b.day)
        .slice(0, UPCOMING_ROWS),
    [schedule, done, today],
  );

  if (!enrollmentId) return null;

  const planName = enrollment?.member_plans?.name ?? "Your plan";
  const todays = byDay.get(today) ?? [];
  const workoutLink = (e: Entry) => ({
    to: "/m/workouts/$enrollmentId/$week/$day" as const,
    params: { enrollmentId, week: String(e.week), day: String(e.day) },
  });

  return (
    <AgendaCard>
      <AgendaHeader today={today} />

      <div className="mt-1.5">
        {todays.length === 0 ? (
          <AgendaEmpty>Rest day. A good day to recover.</AgendaEmpty>
        ) : (
          <ol aria-label="Today">
            {todays.map((e) => {
              const isDone = done.has(`${e.week}:${e.day}`);
              return (
                <li key={`${e.week}:${e.day}`} className="min-w-0">
                  <Link {...workoutLink(e)} className={AGENDA_ROW}>
                    <AgendaRow
                      time="Anytime"
                      timed={false}
                      accent={FAMILY_ACCENT.training}
                      title={`Week ${e.week} · Day ${e.day}`}
                      sub={planName}
                      trailing={<ActionPill label={isDone ? "Done" : "Start"} done={isDone} />}
                    />
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </div>

      <AgendaNext show={upcoming.length > 0}>
        {upcoming.map((e, i) => (
          <li key={`${e.week}:${e.day}`} className="min-w-0">
            <Link {...workoutLink(e)} className={AGENDA_ROW}>
              <AgendaNextRow
                dayText={i === 0 || upcoming[i - 1].date !== e.date ? shortDay(e.date, today) : ""}
                accent={FAMILY_ACCENT.training}
                title={`Week ${e.week} · Day ${e.day}`}
              />
            </Link>
          </li>
        ))}
      </AgendaNext>

      <AgendaFooter>
        <span />
        <Link to="/m/workouts" className={AGENDA_LINK}>
          All workouts
          <ChevronRight className="h-4 w-4" />
        </Link>
      </AgendaFooter>
    </AgendaCard>
  );
}
