import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ProgressSection, type ProgressInitialAction } from "@/components/progress/progress-section";
import { CheckInScheduleCard } from "@/components/progress/check-in-schedule-card";
import { StreakCelebration } from "@/components/progress/streak-celebration";

export const Route = createFileRoute("/_authenticated/portal/progress")({
  component: PortalProgress,
  validateSearch: (s: Record<string, unknown>) => {
    const a = s.action as string | undefined;
    const allowed: ProgressInitialAction[] = ["photo", "video", "lift", "weight", "bodyweight", "measure", "history"];
    return { action: (allowed as string[]).includes(a ?? "") ? (a as ProgressInitialAction) : undefined };
  },
});

function PortalProgress() {
  const userId = usePortalUserId();
  const { action } = Route.useSearch();
  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client-progress-ctx", userId],
    enabled: !!userId,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, preferred_weight_unit, assigned_coach_id")
        .eq("user_id", userId!).maybeSingle();
      return data;
    },
  });

  if (!userId || isLoading) {
    return (
      <>
        <PageHeader title="Progress" subtitle="Photos, videos, weight, and measurements." />
        <div className="p-6"><Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card></div>
      </>
    );
  }

  return (
    <>
      <PageHeader title="Progress" subtitle="Track visual, physical, and performance progress." />
      <div className="px-3 md:px-6 pt-3">
        <StreakCelebration userId={userId} />
      </div>
      <ProgressSection
        initialAction={action}
        ctx={{
          userId,
          ownerType: "client",
          clientId: client?.id ?? null,
          memberId: null,
          assignedCoachId: (client as any)?.assigned_coach_id ?? null,
          viewerRole: "owner",
          preferredWeightUnit: ((client as any)?.preferred_weight_unit as any) ?? "lb",
          canRequestReview: true,
        }}
      />
      <div className="px-3 md:px-6 pb-6">
        <CheckInScheduleCard
          userId={userId}
          title="Your progress reminders"
          subtitle="Pick how often you want to be reminded to update each part of your progress."
        />
      </div>
    </>
  );
}
