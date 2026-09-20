import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { ProgressSection, type ProgressInitialAction } from "@/components/progress/progress-section";

export const Route = createFileRoute("/_authenticated/portal/progress")({
  component: PortalProgress,
  validateSearch: (s: Record<string, unknown>): { action?: ProgressInitialAction } => {
    const a = s.action as string | undefined;
    const allowed: ProgressInitialAction[] = ["photo", "video", "measure"];
    return { action: (allowed as string[]).includes(a ?? "") ? (a as ProgressInitialAction) : undefined };
  },
});

function PortalProgress() {
  const navigate = useNavigate();
  const userId = usePortalUserId();
  const { action } = Route.useSearch();

  useEffect(() => {
    if (!action) {
      navigate({ to: "/portal", replace: true });
    }
  }, [action, navigate]);

  const { data: client } = useQuery({
    queryKey: ["my-client-progress-ctx", userId],
    enabled: !!userId && !!action,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    queryFn: async () => {
      const { data } = await supabase
        .from("clients")
        .select("id, preferred_weight_unit, assigned_coach_id")
        .eq("user_id", userId!)
        .maybeSingle();
      return data;
    },
  });

  if (!action || !userId) return null;

  return (
    <ProgressSection
      actionOnly
      initialAction={action}
      onActionClose={() => navigate({ to: "/portal", replace: true })}
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
  );
}
