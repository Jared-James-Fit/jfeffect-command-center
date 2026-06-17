import { parseLocalDate } from "@/lib/today";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Play, LayoutGrid, CalendarDays, LineChart } from "lucide-react";
import { format, startOfDay } from "date-fns";
import { MemberBlockWeekColumns } from "@/components/member/member-block-week-columns";
import { MemberPlanCalendar } from "@/components/member/member-plan-calendar";
import { MemberDataTracker } from "@/components/member/member-data-tracker";
import { buildWorkoutAdapter } from "@/lib/workout-context";

export const Route = createFileRoute("/_authenticated/m/my-plans/$enrollmentId")({ component: EnrollmentView });

function EnrollmentView() {
  const { enrollmentId } = Route.useParams();
  // Read schedule through the member adapter — single source of truth for
  // membership workout context. Underlying server fn is the same; this
  // keeps the call site uniform with completions/log writes once those
  // migrate too. See member-adapter-probe for drift verification.
  const { data: userId } = useQuery({
    queryKey: ["m-auth-user"],
    queryFn: async () => (await supabase.auth.getUser()).data.user?.id ?? null,
    staleTime: 60_000,
  });
  const adapter = useMemo(
    () =>
      userId
        ? buildWorkoutAdapter({ kind: "member", userId, ownerId: userId, enrollmentId })
        : null,
    [enrollmentId, userId],
  );

  const { data: enr } = useQuery({
    queryKey: ["m-enrollment", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(*)")
        .eq("id", enrollmentId).maybeSingle();
      return data as any;
    },
  });

  const { data: completions = [] } = useQuery({
    queryKey: ["m-completions", enrollmentId],
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions").select("*")
        .eq("enrollment_id", enrollmentId);
      return (data ?? []) as any[];
    },
  });

  const { data: scheduleData } = useQuery({
    queryKey: ["m-schedule", enrollmentId],
    queryFn: async () => {
      const days = await adapter!.listSchedule();
      return {
        schedule: days.map((d) => ({
          week: d.week,
          day: d.day,
          date: d.date,
          isOverride: false,
        })),
      };
    },
    enabled: !!adapter,
  });

  const doneSet = useMemo(
    () => new Set(completions.map((c: any) => `${c.week_index}:${c.day_index}`)),
    [completions],
  );

  if (!enr) return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;

  const schedule = scheduleData?.schedule ?? [];
  const today = startOfDay(new Date());

  // Find today's workout, or the next un-done future one
  const todayKey = format(today, "yyyy-MM-dd");
  const todayEntry = schedule.find((s) => s.date === todayKey && !doneSet.has(`${s.week}:${s.day}`));
  const nextEntry = todayEntry ?? schedule.find((s) => (parseLocalDate(s.date) ?? today) >= today && !doneSet.has(`${s.week}:${s.day}`));

  const pct = Math.round(((enr.workouts_completed ?? 0) / Math.max(enr.workouts_total ?? 1, 1)) * 100);
  const nextTitle = nextEntry
    ? enr.member_plans?.published_payload?.weeks_data?.[nextEntry.week - 1]?.days?.[nextEntry.day - 1]?.title ?? `Week ${nextEntry.week} · Day ${nextEntry.day}`
    : null;

  return (
    <div className="space-y-5">
      <PageHeader
        title={enr.member_plans?.name}
        subtitle={`Week ${enr.current_week} · ${enr.workouts_completed}/${enr.workouts_total} workouts`}
        actions={<Badge>{enr.status}</Badge>}
      />

      {/* Big primary action — dummy-proof start */}
      {nextEntry && enr.status === "Active" && (
        <Card className="border-primary/40 bg-primary/5 p-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <div className="text-[11px] font-bold uppercase tracking-wider text-primary">
                {nextEntry.date === todayKey ? "Today's workout" : `Up next · ${format(parseLocalDate(nextEntry.date)!, "EEE, MMM d")}`}
              </div>
              <div className="mt-0.5 truncate text-lg font-black">{nextTitle}</div>
            </div>
            <Link
              to="/m/workouts/$enrollmentId/$week/$day"
              params={{ enrollmentId, week: String(nextEntry.week), day: String(nextEntry.day) }}
              className="shrink-0"
            >
              <Button size="lg" className="h-12 w-full text-base sm:w-auto">
                <Play className="mr-2 h-5 w-5" />Start workout
              </Button>
            </Link>
          </div>
        </Card>
      )}

      <Progress value={pct} className="h-2" />

      <Tabs defaultValue="block" className="space-y-4">
        <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
          <TabsTrigger value="block" className="gap-1.5"><LayoutGrid className="h-4 w-4" />Block</TabsTrigger>
          <TabsTrigger value="calendar" className="gap-1.5"><CalendarDays className="h-4 w-4" />Calendar</TabsTrigger>
          <TabsTrigger value="tracker" className="gap-1.5"><LineChart className="h-4 w-4" />Tracker</TabsTrigger>
        </TabsList>
        <TabsContent value="block">
          <MemberBlockWeekColumns
            enrollmentId={enrollmentId}
            plan={enr.member_plans}
            schedule={schedule}
            doneSet={doneSet}
          />
        </TabsContent>
        <TabsContent value="calendar">
          <MemberPlanCalendar
            enrollmentId={enrollmentId}
            plan={enr.member_plans}
            schedule={schedule}
            doneSet={doneSet}
          />
        </TabsContent>
        <TabsContent value="tracker">
          <MemberDataTracker enrollmentId={enrollmentId} enrollment={enr} />
        </TabsContent>
      </Tabs>
    </div>
  );
}