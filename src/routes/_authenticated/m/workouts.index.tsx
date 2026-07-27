import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { supabase } from "@/integrations/supabase/client";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import {
  Sheet, SheetContent, SheetHeader, SheetTitle,
} from "@/components/ui/sheet";
import { PlayCircle, CalendarDays, Plus, BookOpen, Loader2 } from "lucide-react";
import { PlanLibrary } from "./plans";
import { ClientAnalyticsDashboard } from "@/components/analytics/client-analytics-dashboard";
import { RecoveryPreviewCard } from "@/components/analytics/recovery-preview-card";

export const Route = createFileRoute("/_authenticated/m/workouts/")({
  component: MemberWorkouts,
});

function MemberWorkouts() {
  const fetchMe = useServerFn(getCurrentMember);
  const qc = useQueryClient();
  const [libraryOpen, setLibraryOpen] = useState(false);

  const { data: me } = useQuery({ queryKey: ["m-me"], queryFn: () => fetchMe() });
  const memberId = me?.member?.id;
  const clientId = (me as any)?.member?.client_id ?? null;
  const preferredUnit: "lb" | "kg" =
    (me?.member as any)?.preferred_weight_unit === "kg" ? "kg" : "lb";

  const { data: activeEnrollment, isLoading: activeLoading } = useQuery({
    queryKey: ["m-active", memberId],
    enabled: !!memberId,
    queryFn: async () => {
      const { data } = await supabase
        .from("member_plan_enrollments")
        .select("*, member_plans(id,name,weeks,days_per_week,cover_image_url)")
        .eq("member_id", memberId!)
        .eq("status", "Active")
        .maybeSingle();
      return data as any;
    },
  });

  const progress = activeEnrollment
    ? Math.round(
        ((activeEnrollment.workouts_completed ?? 0) /
          Math.max(activeEnrollment.workouts_total ?? 1, 1)) * 100,
      )
    : 0;

  return (
    <div className="space-y-6 pb-safe-bottom">
      <PageHeader title="Workouts" subtitle="Your current program and analytics." />

      {/* Current Active Program */}
      {activeLoading ? (
        <Card className="flex items-center gap-2 p-6 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading your program…
        </Card>
      ) : activeEnrollment ? (
        <Card className="border-primary/30 bg-primary/5 p-5 sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-xs uppercase tracking-wider text-muted-foreground">
                Current Program
              </div>
              <div className="mt-1 truncate text-lg font-bold">
                {activeEnrollment.member_plans?.name ?? "Plan"}
              </div>
              <div className="mt-0.5 text-sm text-muted-foreground">
                Week {activeEnrollment.current_week} of {activeEnrollment.member_plans?.weeks ?? "?"} ·{" "}
                {activeEnrollment.workouts_completed}/{activeEnrollment.workouts_total} workouts
              </div>
            </div>
          </div>
          <Progress value={progress} className="mt-4 h-1.5" />
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              to="/m/my-plans/$enrollmentId"
              params={{ enrollmentId: activeEnrollment.id }}
              className="flex-1 min-w-[180px]"
            >
              <Button className="h-11 w-full font-semibold">
                <PlayCircle className="mr-2 h-4 w-4" />
                Continue Workout
              </Button>
            </Link>
            <Link
              to="/m/my-plans/$enrollmentId"
              params={{ enrollmentId: activeEnrollment.id }}
              search={{ tab: "calendar" } as any}
            >
              <Button variant="outline" className="h-11">
                <CalendarDays className="mr-2 h-4 w-4" />
                Calendar
              </Button>
            </Link>
          </div>
        </Card>
      ) : (
        <Card className="p-6">
          <div className="text-sm text-muted-foreground">You don't have an active program yet.</div>
          <Button className="mt-3" onClick={() => setLibraryOpen(true)}>
            <BookOpen className="mr-2 h-4 w-4" /> Browse Program Library
          </Button>
        </Card>
      )}

      {/* Add Program (opens library sheet) */}
      <div>
        <Button variant="outline" className="w-full sm:w-auto" onClick={() => setLibraryOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Workout Program
        </Button>
      </div>

      {/* Workout Analytics — same component as Coaching */}
      {clientId ? (
        <div className="space-y-4 pt-2">
          {/* Training Readiness / Recovery — matches Coaching client parity */}
          <RecoveryPreviewCard clientId={clientId} analyticsTo="/m/workouts#recovery" />
          <ClientAnalyticsDashboard
            clientId={clientId}
            preferredUnit={preferredUnit}
          />
        </div>
      ) : (
        <Card className="p-6 text-sm text-muted-foreground">
          Analytics and readiness insights will appear here once your first
          workouts are logged.
        </Card>
      )}

      {/* Program Library Sheet */}
      <Sheet open={libraryOpen} onOpenChange={setLibraryOpen}>
        <SheetContent
          side="bottom"
          className="h-[92dvh] overflow-y-auto p-4 sm:p-6"
        >
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