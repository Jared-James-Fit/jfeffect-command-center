import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getCurrentMember } from "@/lib/members.functions";
import { PageHeader } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { ProgressSection, type ProgressInitialAction } from "@/components/progress/progress-section";
import { canRequestProgressReviewForMember } from "@/lib/progress-access";

export const Route = createFileRoute("/_authenticated/m/progress")({
  component: MemberProgress,
  validateSearch: (s: Record<string, unknown>) => {
    const a = s.action as string | undefined;
    const allowed: ProgressInitialAction[] = ["photo", "video", "lift", "weight", "bodyweight", "measure", "history"];
    return { action: (allowed as string[]).includes(a ?? "") ? (a as ProgressInitialAction) : undefined };
  },
});

function MemberProgress() {
  const fetchMe = useServerFn(getCurrentMember);
  const { action } = Route.useSearch();
  const { data: me } = useQuery({
    queryKey: ["m-me"],
    queryFn: () => fetchMe(),
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
  });
  const member: any = me?.member;

  // Members get review access only when an active client_access_entitlements
  // row grants a reviews-bearing tier. Otherwise everything is self-tracking.
  const memberClientId = (me as any)?.member?.client_id ?? null;
  const { data: review } = useQuery({
    queryKey: ["member-review-eligibility", memberClientId],
    enabled: !!memberClientId,
    queryFn: () => canRequestProgressReviewForMember(memberClientId),
    staleTime: 60_000,
  });

  if (!member) {
    return (
      <>
        <PageHeader title="Progress" subtitle="Track your progress." />
        <div className="p-6"><Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card></div>
      </>
    );
  }

  return (
    <div className="pb-safe-bottom">
      <PageHeader title="Progress" subtitle="Photos, videos, weight, and measurements — saved to your account." />
      <ProgressSection
        initialAction={action}
        ctx={{
          userId: member.user_id,
          ownerType: "member",
          clientId: null,
          memberId: member.id,
          assignedCoachId: null,
          viewerRole: "owner",
          preferredWeightUnit: (member.preferred_weight_unit as any) ?? "lb",
          canRequestReview: review?.allowed ?? false,
        }}
      />
    </div>
  );
}
