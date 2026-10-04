import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePortalUserId } from "@/lib/client-impersonation";
import { PageHeader } from "@/components/app-shell";
import { ProgressSection, type ProgressInitialAction } from "@/components/progress/progress-section";

/** Quick-add actions open just the add sheet over Home; everything else opens the full progress view. */
const QUICK_ADD: ProgressInitialAction[] = ["photo", "video", "measure"];
const VIEW_TABS: ProgressInitialAction[] = ["bodyweight", "history"];

export const Route = createFileRoute("/_authenticated/portal/progress")({
  component: PortalProgress,
  validateSearch: (s: Record<string, unknown>): { action?: ProgressInitialAction } => {
    let a = s.action as string | undefined;
    if (a === "photos") a = "photo"; // legacy alias
    const allowed: string[] = [...QUICK_ADD, ...VIEW_TABS];
    return { action: allowed.includes(a ?? "") ? (a as ProgressInitialAction) : undefined };
  },
});

function PortalProgress() {
  const navigate = useNavigate();
  const userId = usePortalUserId();
  const { action } = Route.useSearch();
  const quickAdd = !!action && QUICK_ADD.includes(action);

  const { data: client, isLoading } = useQuery({
    queryKey: ["my-client-progress-ctx", userId],
    enabled: !!userId,
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

  const ctx = userId
    ? {
        userId,
        ownerType: "client" as const,
        clientId: client?.id ?? null,
        memberId: null,
        assignedCoachId: (client as any)?.assigned_coach_id ?? null,
        viewerRole: "owner" as const,
        preferredWeightUnit: ((client as any)?.preferred_weight_unit as any) ?? "lb",
        canRequestReview: true,
      }
    : null;

  if (quickAdd) {
    if (!ctx || isLoading) return null;
    return (
      <ProgressSection
        actionOnly
        initialAction={action}
        onActionClose={() => navigate({ to: "/portal", replace: true })}
        ctx={ctx}
      />
    );
  }

  return (
    <div className="mx-auto w-full max-w-5xl pb-safe-bottom">
      <PageHeader
        title="Your Progress"
        subtitle="Every photo, video, weigh-in and measurement you've logged."
        backTo="/portal"
        backLabel="Home"
      />
      {ctx && !isLoading ? (
        <ProgressSection key={action ?? "overview"} initialAction={action} ctx={ctx} />
      ) : null}
    </div>
  );
}
