import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  PlayCircle, RotateCcw, BookOpen, Eye, Plus, Calendar, Clock,
  CalendarDays, AlertCircle, CheckCircle2, Loader2,
} from "lucide-react";
import { restartPlan } from "@/lib/member-plans.functions";
import { listMembershipLibrary, enrollLibraryPlan } from "@/lib/membership-library.functions";
import { WorkoutScheduleSetup } from "@/components/member/workout-schedule-setup";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

export const Route = createFileRoute("/_authenticated/m/my-plans")({ component: MyPlans });

function MyPlans() {
  const fetchMe = useServerFn(getCurrentMember);
  const restart = useServerFn(restartPlan);
  const qc = useQueryClient();
  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });

  // After enrollment, show schedule setup
  const [scheduleSetup, setScheduleSetup] = useState<{
    enrollmentId: string;
    planName: string;
    daysPerWeek: number;
    totalWeeks: number;
    workoutDays: { week: number; day: number; title?: string | null }[];
  } | null>(null);

  const { data: enrollments = [], refetch, isLoading } = useQuery({
    queryKey: ["m-enrollments", me?.member?.id],
    enabled: !!me?.member?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(id, name, weeks, days_per_week, cover_image_url, published_payload)")
        .eq("member_id", me!.member!.id)
        .order("started_at", { ascending: false });
      return (data ?? []) as any[];
    },
  });

  const active = enrollments.filter((e) => e.status === "Active");
  const completed = enrollments.filter((e) => e.status === "Completed");
  const abandoned = enrollments.filter((e) => e.status === "Abandoned");

  const onRestart = async (id: string) => {
    try {
      await restart({ data: { enrollmentId: id } });
      toast.success("Plan restarted");
      await refetch();
    } catch (e: any) {
      toast.error(e?.message ?? "Couldn't restart");
    }
  };

  const onScheduled = async () => {
    await refetch();
    qc.invalidateQueries({ queryKey: ["m-schedule"] });
    qc.invalidateQueries({ queryKey: ["m-enrollment"] });
  };

  return (
    <div className="space-y-6">
      <PageHeader title="Training" subtitle="Your plans and the full Program Library." />

      <Tabs defaultValue="my-plans" className="space-y-6">
        <TabsList>
          <TabsTrigger value="my-plans">My Plans</TabsTrigger>
          <TabsTrigger value="library">
            <BookOpen className="mr-1.5 h-3.5 w-3.5" />
            Program Library
          </TabsTrigger>
        </TabsList>

        <TabsContent value="my-plans" className="space-y-6">
          {isLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading your plans…
            </div>
          ) : (
            <>
              <Section title="Active">
                {active.length === 0 ? (
                  <Empty
                    msg="No active plan. Browse the Program Library to get started."
                    action={
                      <Button variant="outline" size="sm" asChild>
                        <span>
                          <BookOpen className="mr-2 h-4 w-4" />
                          Browse Program Library
                        </span>
                      </Button>
                    }
                  />
                ) : (
                  active.map((e) => (
                    <EnrollmentCard
                      key={e.id}
                      e={e}
                      primary
                      onSetupSchedule={() => {
                        const plan = e.member_plans;
                        const weeksData = plan?.published_payload?.weeks_data ?? [];
                        const workoutDays: { week: number; day: number; title?: string | null }[] = [];
                        for (const w of weeksData) {
                          for (const d of (w.days ?? [])) {
                            workoutDays.push({
                              week: w.week_index,
                              day: d.day_index,
                              title: d.title ?? d.focus ?? null,
                            });
                          }
                        }
                        setScheduleSetup({
                          enrollmentId: e.id,
                          planName: plan?.name ?? "Plan",
                          daysPerWeek: plan?.days_per_week ?? 3,
                          totalWeeks: plan?.weeks ?? 4,
                          workoutDays,
                        });
                      }}
                    />
                  ))
                )}
              </Section>

              {completed.length > 0 && (
                <Section title="Completed">
                  {completed.map((e) => (
                    <EnrollmentCard key={e.id} e={e} onRestart={() => onRestart(e.id)} />
                  ))}
                </Section>
              )}

              {abandoned.length > 0 && (
                <Section title="Previous Plans">
                  {abandoned.map((e) => (
                    <EnrollmentCard key={e.id} e={e} onRestart={() => onRestart(e.id)} />
                  ))}
                </Section>
              )}
            </>
          )}
        </TabsContent>

        <TabsContent value="library" className="space-y-3">
          <LibraryTab
            onEnrolled={(enrollmentId, plan) => {
              refetch();
              // Show schedule setup after enrollment
              const weeksData = plan?.published_payload?.weeks_data ?? [];
              const workoutDays: { week: number; day: number; title?: string | null }[] = [];
              for (const w of weeksData) {
                for (const d of (w.days ?? [])) {
                  workoutDays.push({
                    week: w.week_index,
                    day: d.day_index,
                    title: d.title ?? d.focus ?? null,
                  });
                }
              }
              setScheduleSetup({
                enrollmentId,
                planName: plan?.name ?? "Plan",
                daysPerWeek: plan?.days_per_week ?? 3,
                totalWeeks: plan?.weeks ?? 4,
                workoutDays,
              });
            }}
          />
        </TabsContent>
      </Tabs>

      {/* Schedule setup sheet */}
      {scheduleSetup && (
        <WorkoutScheduleSetup
          open={!!scheduleSetup}
          onOpenChange={(open) => { if (!open) setScheduleSetup(null); }}
          enrollmentId={scheduleSetup.enrollmentId}
          planName={scheduleSetup.planName}
          daysPerWeek={scheduleSetup.daysPerWeek}
          totalWeeks={scheduleSetup.totalWeeks}
          workoutDays={scheduleSetup.workoutDays}
          onScheduled={onScheduled}
        />
      )}
    </div>
  );
}

function LibraryTab({ onEnrolled }: { onEnrolled?: (enrollmentId: string, plan: any) => void }) {
  const fetchLibrary = useServerFn(listMembershipLibrary);
  const enroll = useServerFn(enrollLibraryPlan);
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ["m-membership-library"],
    queryFn: () => fetchLibrary(),
  });
  const plans = (data?.plans ?? []) as any[];

  const handleAdd = async (plan: any, confirmReplace = false) => {
    try {
      const res = await enroll({ data: { planId: plan.id, importMode: "full", confirmReplace } });
      if (res.conflict) {
        const ok = window.confirm(
          "You already have an active plan. Starting this one will end your current plan. Continue?"
        );
        if (ok) return handleAdd(plan, true);
        return;
      }
      toast.success("Program added to your training");
      qc.invalidateQueries({ queryKey: ["m-enrollments"] });
      onEnrolled?.(res.enrollmentId, plan);
    } catch (e: any) {
      toast.error(e?.message ?? "Could not add program");
    }
  };

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading programs…
      </div>
    );
  }
  if (plans.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
        No programs are available in your library yet. Check back soon.
      </div>
    );
  }
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {plans.map((p) => (
        <Card key={p.id} className="flex flex-col overflow-hidden p-5">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="truncate font-semibold">{p.public_title || p.name}</div>
              <div className="mt-0.5 text-xs uppercase tracking-wider text-muted-foreground">
                {p.training_style ?? "custom"} · {p.difficulty ?? "All Levels"}
              </div>
            </div>
            {p.featured && <Badge>Featured</Badge>}
          </div>
          <div className="mt-3 flex flex-wrap gap-3 text-xs text-muted-foreground">
            <span className="inline-flex items-center gap-1">
              <Calendar className="h-3.5 w-3.5" />
              {p.weeks ?? "—"}w · {p.days_per_week ?? "—"}/wk
            </span>
            {p.est_minutes_per_workout && (
              <span className="inline-flex items-center gap-1">
                <Clock className="h-3.5 w-3.5" />{p.est_minutes_per_workout} min
              </span>
            )}
          </div>
          {p.description && (
            <p className="mt-3 line-clamp-3 text-sm text-muted-foreground">{p.description}</p>
          )}
          <div className="mt-auto flex gap-2 pt-4">
            <Link to="/m/plans/$planId" params={{ planId: p.id }} className="flex-1">
              <Button variant="outline" size="sm" className="w-full">
                <Eye className="mr-1 h-3.5 w-3.5" /> Preview
              </Button>
            </Link>
            <Button size="sm" className="flex-1" onClick={() => handleAdd(p)}>
              <Plus className="mr-1 h-3.5 w-3.5" /> Add to My Training
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <div className="text-xs font-bold uppercase tracking-wider text-muted-foreground">{title}</div>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </div>
  );
}

function Empty({ msg, action }: { msg: string; action?: React.ReactNode }) {
  return (
    <div className="sm:col-span-2 rounded-xl border border-dashed border-border p-6 text-center space-y-3">
      <p className="text-sm text-muted-foreground">{msg}</p>
      {action}
    </div>
  );
}

function EnrollmentCard({
  e,
  primary,
  onRestart,
  onSetupSchedule,
}: {
  e: any;
  primary?: boolean;
  onRestart?: () => void;
  onSetupSchedule?: () => void;
}) {
  const pct = Math.round(((e.workouts_completed ?? 0) / Math.max(e.workouts_total ?? 1, 1)) * 100);
  const plan = e.member_plans;

  // Check if schedule has been set up (training_days is populated)
  const hasSchedule = Array.isArray(e.training_days) && e.training_days.length > 0;
  const needsSchedule = primary && !hasSchedule && e.status === "Active";

  return (
    <Card className={["p-4 sm:p-5 flex flex-col gap-3", primary ? "border-primary/30 bg-primary/5" : ""].join(" ")}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-base font-bold">{plan?.name ?? "Plan"}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span>Week {e.current_week} of {plan?.weeks ?? "?"}</span>
            <span>·</span>
            <span>{e.workouts_completed}/{e.workouts_total} workouts</span>
            {plan?.days_per_week && (
              <>
                <span>·</span>
                <span>{plan.days_per_week}×/week</span>
              </>
            )}
          </div>
        </div>
        <Badge
          variant={
            e.status === "Completed" ? "default"
            : e.status === "Active" ? "secondary"
            : "outline"
          }
        >
          {e.status}
        </Badge>
      </div>

      {/* Progress bar */}
      <Progress value={pct} className="h-1.5" />

      {/* Schedule setup prompt */}
      {needsSchedule && (
        <div
          className="flex cursor-pointer items-center gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 hover:bg-amber-500/15 transition-colors"
          onClick={onSetupSchedule}
        >
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="font-medium">Set your training schedule to sync workouts to your calendar</span>
        </div>
      )}

      {/* Schedule summary if set */}
      {primary && hasSchedule && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <CalendarDays className="h-3.5 w-3.5 shrink-0" />
          <span>Training days: {e.training_days.join(", ")}</span>
        </div>
      )}

      {/* Start date if available */}
      {primary && e.start_date && (
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Calendar className="h-3.5 w-3.5 shrink-0" />
          <span>Started {format(parseISO(e.start_date), "MMM d, yyyy")}</span>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2 pt-1">
        <Link
          to="/m/my-plans/$enrollmentId"
          params={{ enrollmentId: e.id }}
          className="flex-1"
        >
          <Button
            variant={primary ? "default" : "outline"}
            className="h-11 w-full font-semibold"
          >
            <PlayCircle className="mr-2 h-4 w-4" />
            {e.status === "Active" ? "Continue Training" : "View Plan"}
          </Button>
        </Link>
        {onSetupSchedule && e.status === "Active" && (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={onSetupSchedule}
            title="Set schedule"
          >
            <CalendarDays className="h-4 w-4" />
          </Button>
        )}
        {onRestart && (
          <Button
            variant="outline"
            size="icon"
            className="h-11 w-11 shrink-0"
            onClick={onRestart}
            title="Restart plan"
          >
            <RotateCcw className="h-4 w-4" />
          </Button>
        )}
      </div>
    </Card>
  );
}
