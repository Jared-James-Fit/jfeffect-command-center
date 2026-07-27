import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { format, startOfDay } from "date-fns";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { parseLocalDate } from "@/lib/today";
import { buildWorkoutAdapter } from "@/lib/workout-context";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import {
  Play, LayoutGrid, CalendarDays, LineChart, Plus, BookOpen, Loader2, Activity,
} from "lucide-react";
import { PlanLibrary } from "./plans";
import { ClientAnalyticsDashboard } from "@/components/analytics/client-analytics-dashboard";
import { RecoveryPreviewCard } from "@/components/analytics/recovery-preview-card";
import { MemberBlockWeekColumns } from "@/components/member/member-block-week-columns";
import { MemberPlanCalendar } from "@/components/member/member-plan-calendar";
import { MemberDataTracker } from "@/components/member/member-data-tracker";

export const Route = createFileRoute("/_authenticated/m/workouts/")({
  component: MemberWorkouts,
});

function MemberWorkouts() {
  const fetchMe = useServerFn(getCurrentMember);
  const qc = useQueryClient();
  const [libraryOpen, setLibraryOpen] = useState(false);

  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const memberId = me?.member?.id;
  const userId = (me?.member as any)?.user_id ?? null;
  const clientId = (me as any)?.member?.client_id ?? null;
  const preferredUnit: "lb" | "kg" =
    (me?.member as any)?.preferred_weight_unit === "kg" ? "kg" : "lb";

  const { data: activeEnrollment, isLoading: activeLoading } = useQuery({
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

  const enrollmentId: string | null = activeEnrollment?.id ?? null;

  const adapter = useMemo(
    () =>
      userId && enrollmentId
        ? buildWorkoutAdapter({ kind: "member", userId, ownerId: userId, enrollmentId })
        : null,
    [userId, enrollmentId],
  );

  const { data: completions = [] } = useQuery({
    queryKey: ["m-completions", enrollmentId],
    enabled: !!enrollmentId,
    staleTime: 30_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_workout_completions").select("*")
        .eq("enrollment_id", enrollmentId!);
      return (data ?? []) as any[];
    },
  });

  const { data: scheduleData } = useQuery({
    queryKey: ["m-schedule", enrollmentId],
    enabled: !!adapter,
    staleTime: 30_000,
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
  });

  const doneSet = useMemo(
    () => new Set(completions.map((c: any) => `${c.week_index}:${c.day_index}`)),
    [completions],
  );

  const schedule = scheduleData?.schedule ?? [];
  const today = startOfDay(new Date());
  const todayKey = format(today, "yyyy-MM-dd");
  const todayEntry = schedule.find(
    (s) => s.date === todayKey && !doneSet.has(`${s.week}:${s.day}`),
  );
  const nextEntry =
    todayEntry ??
    schedule.find(
      (s) =>
        (parseLocalDate(s.date) ?? today) >= today &&
        !doneSet.has(`${s.week}:${s.day}`),
    );
  const nextTitle = nextEntry
    ? activeEnrollment?.member_plans?.published_payload?.weeks_data?.[nextEntry.week - 1]
        ?.days?.[nextEntry.day - 1]?.title ?? `Week ${nextEntry.week} · Day ${nextEntry.day}`
    : null;

  const pct = activeEnrollment
    ? Math.round(
        ((activeEnrollment.workouts_completed ?? 0) /
          Math.max(activeEnrollment.workouts_total ?? 1, 1)) * 100,
      )
    : 0;

  return (
    <div className="space-y-4 pb-safe-bottom">
      <PageHeader
        title="Workouts"
        subtitle={
          activeEnrollment
            ? `${activeEnrollment.member_plans?.name ?? "Plan"} · Week ${activeEnrollment.current_week}`
            : "Your current program and analytics."
        }
        actions={
          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 gap-1"
              onClick={() => setLibraryOpen(true)}
            >
              <BookOpen className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Library</span>
            </Button>
            {clientId && (
              <Button asChild size="sm" variant="outline" className="h-8 gap-1">
                <a href="#recovery" aria-label="Jump to training analytics">
                  <Activity className="h-3.5 w-3.5" />
                  <span className="hidden sm:inline">Analytics</span>
                </a>
              </Button>
            )}
          </div>
        }
      />

      {activeLoading ? (
        <Card className="mx-4 flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your program…
        </Card>
      ) : activeEnrollment ? (
        <div className="space-y-4 px-4">
          {/* Progress + primary Start CTA */}
          <Card className="border-primary/40 bg-primary/5 p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-primary">
                {nextEntry
                  ? nextEntry.date === todayKey
                    ? "Today's workout"
                    : `Up next · ${format(parseLocalDate(nextEntry.date)!, "EEE, MMM d")}`
                  : "Current program"}
              </div>
              <div className="text-xs text-muted-foreground">
                {activeEnrollment.workouts_completed}/{activeEnrollment.workouts_total} workouts
              </div>
            </div>
            <div className="mt-1 truncate text-lg font-black">
              {nextTitle ?? activeEnrollment.member_plans?.name}
            </div>
            <Progress value={pct} className="mt-3 h-1.5" />
            {nextEntry && (
              <Link
                to="/m/workouts/$enrollmentId/$week/$day"
                params={{
                  enrollmentId: activeEnrollment.id,
                  week: String(nextEntry.week),
                  day: String(nextEntry.day),
                }}
                className="mt-3 block"
              >
                <Button size="lg" className="h-12 w-full text-base font-semibold">
                  <Play className="mr-2 h-5 w-5" /> Start workout
                </Button>
              </Link>
            )}
          </Card>

          {/* Block / Calendar / Tracker tabs (matches coaching client experience) */}
          <Tabs defaultValue="block" className="space-y-3">
            <TabsList className="w-full justify-start overflow-x-auto sm:w-auto">
              <TabsTrigger value="block" className="gap-1.5">
                <LayoutGrid className="h-4 w-4" />Block
              </TabsTrigger>
              <TabsTrigger value="calendar" className="gap-1.5">
                <CalendarDays className="h-4 w-4" />Calendar
              </TabsTrigger>
              <TabsTrigger value="tracker" className="gap-1.5">
                <LineChart className="h-4 w-4" />Tracker
              </TabsTrigger>
            </TabsList>
            <TabsContent value="block">
              <MemberBlockWeekColumns
                enrollmentId={activeEnrollment.id}
                plan={activeEnrollment.member_plans}
                schedule={schedule}
                doneSet={doneSet}
              />
            </TabsContent>
            <TabsContent value="calendar">
              <MemberPlanCalendar
                enrollmentId={activeEnrollment.id}
                plan={activeEnrollment.member_plans}
                schedule={schedule}
                doneSet={doneSet}
              />
            </TabsContent>
            <TabsContent value="tracker">
              <MemberDataTracker
                enrollmentId={activeEnrollment.id}
                enrollment={activeEnrollment}
              />
            </TabsContent>
          </Tabs>

          <Button
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => setLibraryOpen(true)}
          >
            <Plus className="mr-2 h-4 w-4" /> Add Workout Program
          </Button>
        </div>
      ) : (
        <div className="px-4">
          <Card className="p-6">
            <div className="text-sm text-muted-foreground">
              You don't have an active program yet.
            </div>
            <Button className="mt-3" onClick={() => setLibraryOpen(true)}>
              <BookOpen className="mr-2 h-4 w-4" /> Browse Program Library
            </Button>
          </Card>
        </div>
      )}

      {/* Workout Analytics — same component as Coaching */}
      {clientId ? (
        <div id="recovery" className="space-y-4 px-4 pt-2 scroll-mt-20">
          <RecoveryPreviewCard clientId={clientId} analyticsTo="/m/workouts#recovery" />
          <ClientAnalyticsDashboard clientId={clientId} preferredUnit={preferredUnit} />
        </div>
      ) : (
        <div className="px-4">
          <Card className="p-6 text-sm text-muted-foreground">
            Analytics and readiness insights will appear here once your first
            workouts are logged.
          </Card>
        </div>
      )}

      {/* Program Library Sheet */}
      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent side="bottom" className="h-[92dvh] overflow-y-auto p-4 sm:p-6">
          <SheetHeader className="pl-0">
            <SheetTitle>Program Library</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <PlanLibrary
              defaultCategory="all"
              hideHeader
              onEnrolled={() => {
                setLibraryOpen(false);
                qc.invalidateQueries({ queryKey: ["m-active"] });
                qc.invalidateQueries({ queryKey: ["m-enrollments"] });
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}