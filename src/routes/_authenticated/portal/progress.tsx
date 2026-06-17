import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ProgressSection } from "@/components/progress/progress-section";

export const Route = createFileRoute("/_authenticated/portal/progress")({
  component: PortalProgress,
});

function PortalProgress() {
  const userId = usePortalUserId();
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
      <ProgressSection
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
    </>
  );
}
